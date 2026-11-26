# Reclaim Value

An AI-powered circular marketplace for construction and demolition (C&D) material recovery.

Site managers photograph salvageable material. The AI suggests the material type, condition, a fair price and the best action (Reuse, Sell, Recycle or Dispose). The item is listed on a marketplace where buyers and recyclers search in plain language. An impact dashboard tracks landfill diversion and CO₂ savings.

| Tier | Stack | Folder | Port |
|---|---|---|---|
| Presentation | React 18, Vite, Tailwind CSS | `frontend/` | 5173 |
| API gateway | Node.js, Express 5, MongoDB/Mongoose, JWT, bcrypt, RBAC | `backend/` | 5000 |
| AI microservice | Python, FastAPI: vision (YOLO or demo heuristic), price model, salvage recommender, NLP parser and agent intents | `ai-service/` | 8000 |
| Data | MongoDB (local or Atlas); images on local disk or Cloudinary | | |

## Deploying

The whole app runs free on Vercel: the website and API as one project, and the AI service (trained models exported to ONNX) as another, with data in MongoDB Atlas. Steps are in [DEPLOY.md](DEPLOY.md).

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer
- MongoDB 6 or newer, running locally or a free MongoDB Atlas cluster

## Quick start

Open three terminals, one per service.

```bash
# 1. AI service
cd ai-service
python -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 2. Backend
cd backend
cp .env.example .env               # Windows: copy .env.example .env  - then set JWT_SECRET (and MONGO_URI for Atlas)
npm install
npm run seed:demo                  # optional: 50 clearly-marked sample listings + demo accounts
npm run dev

# 3. Frontend
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

## Try the full flow

1. Register as a **Company** in one browser. Go to **Capture**, upload a photo and enter a rough quantity. Review the AI result, correct anything that's wrong and choose **Save to inventory**.
2. In **Inventory**, choose **Publish**. The suggested price is pre-filled.
3. In a second browser (or a private window), register as a **Buyer**, or sign in as `demo.buyer@example.com` with password `demo-password-123` after running the seed. Search the **Marketplace** in plain language, e.g. *steel under 30k near me in good condition*. Open the listing and send a request.
4. As the Company, open **Requests** and choose **Accept**. The listing is now reserved.
5. As the Buyer, open **My requests** and choose **Confirm after inspection**, which completes the trade. Choosing **Cancel** instead puts the listing back on the market.
6. As the Buyer, open **Wanted alerts** and post what you need (for example bricks, at least 2,000 kg, up to ₹3.5/kg, within 50 km). When a Company publishes a matching listing, the bell shows a notification that opens it. Companies see open requests under **Buyer demand**.
7. If a trade goes wrong, open **Requests** and press **Raise a dispute** on an accepted, completed or cancelled request. Add photos and notes, and chat with the other side under **Disputes**. An Admin (set `role` to `Admin` on a user in Atlas) opens **Resolver**, reads the evidence, and records Approve, Reject, Refund or Resolve with a reason. Both sides are notified and the full history is kept.
7. Open **Impact** to see diverted kg, CO₂e, diversion rate, time-to-match, classification accuracy and price acceptance.

The **Assistant** answers questions about your own data ("show my inventory", "how much is 500 kg of steel worth?", "any pending requests?") by calling backend tools. It only reads; every change happens on a page where you confirm it.

## Modules

| # | Module | Where |
|---|---|---|
| 1 | AI material recognition: trained YOLO detector + classifier (per-class thresholds, asks the user when unsure); demo heuristic if no weights | `ai-service/vision.py`, `ai-service/training/` |
| 2 | Smart salvage engine: weighted Reuse/Sell/Recycle/Dispose scores plus CO₂ | `ai-service/recommend.py` |
| 3 | Price estimation: scrap-index baseline, replaced by a trained regression once trades exist | `ai-service/price.py`, `train_price.py` |
| 4 | Inventory CRUD | `backend/src/routes/materials.js` |
| 5 | Marketplace and two-step purchase workflow | `backend/src/routes/listings.js`, `requests.js` |
| 6 | Smart matching: S = w1·Sim + w2·Dist + w3·Price + w4·Rating | `backend/src/lib/matching.js` |
| 7 | Natural-language search and AI agent with function calling | `ai-service/nlp.py`, `backend/src/lib/agent.js` |
| 8 | ESG / impact analytics | `backend/src/lib/impact.js` |
| 9 | Admin moderation | `backend/src/routes/admin.js` |
| 10 | Wanted alerts and notifications: buyers post what they need and are notified when a matching listing goes live; suppliers see open demand and get a nudge when they hold matching stock | `backend/src/lib/wanted.js`, `routes/wanted.js`, `routes/notifications.js` |
| 11 | Dispute resolution: evidence (photos, notes), dispute chat, status tracking, admin Resolver dashboard with final decisions, history and notifications | `backend/src/routes/disputes.js`, `lib/disputes.js`, `frontend/src/pages/Resolver.jsx`, `DisputeDetail.jsx` |

If the AI service is offline, the backend falls back to simpler built-in rules for search, price and recommendations. Photo analysis then asks for manual entry, and the UI says so.

## Optional: Gemini for general questions

Without a key, general questions are answered from a built-in product guide. To use Gemini:

1. Create a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Put it in `backend/.env` as `GEMINI_API_KEY=...`.
3. Run `npm run test:gemini` in `backend/` to find a model your key can use, and set `GEMINI_MODEL` to it.

Gemini never sees live inventory, and the assistant falls back to the guide if Gemini can't be reached. Never put API keys in frontend code or commit `.env`. Free-tier content may be used by Google to improve its products, so don't send sensitive data on the free tier.

## Optional: Cloudinary image storage

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` in `backend/.env`. Otherwise images are stored in `backend/uploads/`.

## Creating an admin

Admins cannot self-register. Register a normal account, then in `mongosh`:

```js
use reclaim_value
db.users.updateOne({ email: "you@example.com" }, { $set: { role: "Admin" } })
```

## Tests

```bash
cd ai-service && pip install -r requirements-dev.txt && pytest   # vision (incl. trained-model voting, ONNX helpers), price, recommender, NLP, API
cd backend && npm test                       # unit tests; the API flow test is skipped without a DB
MONGO_TEST_URI=mongodb://127.0.0.1:27017/reclaim_test npm test   # + full API flow (wipes that DB)
cd frontend && npm run build
```

GitHub Actions (`.github/workflows/ci.yml`) runs all three on every push and pull request. MongoDB runs as a service container; no credentials, trained weights or AI keys are needed.

## API summary

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | anyone |
| GET/PATCH | `/api/auth/me` | signed in |
| GET/POST/PUT/DELETE | `/api/materials`, `POST /api/materials/:id/close` | Company |
| POST | `/api/ai/analyze` (photo), `/api/ai/estimate`, `/api/ai/agent`; GET `/api/ai/status` | Company / all |
| GET | `/api/listings?nl=…&material=&maxPrice=&maxDistanceKm=&minCondition=&sort=` | signed in |
| POST/PATCH | `/api/listings`, `/api/listings/:id`; GET `/api/listings/mine`, `/api/listings/:id/buyers` | Company |
| POST/GET/PATCH | `/api/requests` (actions: accept, reject, cancel, complete) | Buyer, Recycler, Company |
| GET/POST/PATCH/DELETE | `/api/wanted`, `GET /api/wanted/:id/matches` | Buyer, Recycler |
| GET | `/api/wanted/demand` | Company, Admin |
| GET/POST | `/api/disputes`, `/api/disputes/:id`, `/:id/evidence`, `/:id/messages`, `/:id/withdraw` | Buyer, Recycler, Company (parties); Admin reads and chats |
| GET/POST | `/api/disputes/stats`, `/:id/review`, `/:id/decision` | Admin |
| GET/POST/PATCH | `/api/notifications`, `POST /api/notifications/read-all`, `PATCH /api/notifications/:id/read` | signed in |
| GET | `/api/analytics/summary` | signed in (scoped by role) |
| GET/PATCH | `/api/admin/overview`, `/api/admin/users`, `/api/admin/listings` | Admin |

AI service: `GET /health`, `POST /analyze`, `/price`, `/recommend`, `/nlp/parse`, `/agent`. Interactive docs at <http://localhost:8000/docs>.

## Notes and honesty

- **Material recognition needs trained models to be real.** Train them with `ai-service/training/train_colab.ipynb` on a free Colab GPU (steps in `ai-service/TRAINING.md`). Put `materials.pt`, `materials_thresholds.json` and `materials_cls.pt` in `ai-service/weights/`, run `pip install ultralytics`, and restart the service; <http://localhost:8000/health> should then show `"mode": "trained"`. When the models aren't confident, the app asks the user to pick the material instead of guessing. Without models it runs in **demo mode** (colour/texture heuristic, confidence capped at 65%, flagged in the API and UI).
- **Condition scores are always advisory.** Photos can hide internal rust or cracks, so buyers confirm only after physical inspection.
- **Prices start from indicative INR scrap-index values per kg.** Run `train_price.py` on exported real trades once you have them.
- **CO₂ figures are order-of-magnitude estimates** from embodied-carbon factors per material.
- **Demo listings are generated examples** marked `[Demo]`, not real inventory, quotes or sales.
- **The NLP parser and agent are rule-based**, so no LLM key is needed. `parse_query` and `agent_intent` in `nlp.py` can be swapped for an LLM chain that returns the same shape.
- **Roles:** Company (supply), Buyer/Recycler (demand), Admin (governance).
