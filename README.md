# Reclaim Value

https://reclaim-value.vercel.app

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
npm run migrate                    # existing database only: adds the CO2 impact records (safe to re-run, deletes nothing)
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
7. If a trade goes wrong, open **Requests** and press **Raise a dispute** on an accepted, completed or cancelled request. Add photos and notes, and chat with the other side under **Disputes**. An Admin (see [Creating an admin](#creating-an-admin)) opens **Resolver**, reads the evidence, and records Approve, Reject, Refund or Resolve with a reason. Both sides are notified and the full history is kept.
8. Open **Impact** to see diverted kg, CO₂e, diversion rate, time-to-match, classification accuracy and price acceptance.

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

## Dashboards, CO₂ records and assistant history

- **Dashboards.** The Overview page is built from `GET /api/analytics/dashboard`, which reads MongoDB for the signed-in account (taken from the JWT, never from the request): a seller sees their own listings, requests and trades, a buyer their own requests and purchases, an admin the whole platform. Charts use Recharts, each has a "Show as tables" switch, and the page refreshes itself every 30 seconds and when you return to the tab.
- **CO₂ records.** When a buyer confirms a trade, one `ImpactRecord` is saved (material, kilograms, CO₂e from the per-material factors in `lib/catalog.js`, price, date). It is unique per listing, so double clicks, retries and re-running the migration never count a trade twice. A dispute that ends in a refund removes that trade's record, and a later sale of the same listing is recorded again. Sellers, buyers and the platform totals all read these saved records.
- **Assistant history.** Each account has its own conversation in MongoDB (`Conversation`, one per user). The server decides whose it is from the JWT, so there is nothing to tamper with, and the browser no longer keeps chat in session storage.
- **Requests.** A buyer can request an active listing once (a database index also stops two clicks at the same instant), never their own, and sees the status on the marketplace card and under My requests. Only the buyer and seller of a request can read or change it.
- **Upgrading an existing database.** Run `cd backend && npm run migrate` once. It creates the new collections and indexes and writes the missing CO₂ record for every trade completed before records existed. The app also does this automatically the first time the analytics are opened after a deploy.

## Dispute resolution

When a trade goes wrong, buyers and sellers can raise a dispute and an Admin settles it. Nothing is decided silently: both sides can add evidence, talk in a chat, and read the final reason.

**Who can do what**

| Role | Can do |
|---|---|
| Company, Buyer, Recycler (the two sides of a trade) | Raise a dispute, add photos and written statements, chat, withdraw their own dispute, see its status and history |
| Admin | Read all disputes and evidence, join the chat, take a case, record the final decision. Admins cannot raise disputes or add evidence |
| Anyone else | Cannot see the dispute (the app answers "not found") |

**How it works**

1. **Raise.** On **Requests**, press **Raise a dispute** on a request the seller has accepted (accepted, completed or cancelled). Choose a category (incorrect description, pricing, quality, order issue or other), give it a title, describe what happened and attach up to 4 photos. A request can have one open dispute at a time.
2. **Notify.** The other side and all Admins get a notification in the bell.
3. **Evidence and chat.** Each side adds photos and written statements on the dispute page and talks in the dispute chat. The chat refreshes about every 10 seconds, so no refresh is needed.
4. **Review.** An Admin opens **Resolver**, picks a case from the **Queue** and presses **Take this case**. Status changes from *Open* to *Under review* and both sides are told.
5. **Decide.** The Admin records one outcome and a written reason (at least 10 characters):

| Outcome | Effect |
|---|---|
| Approve | The claim is upheld. Nothing changes in the trade; the decision is recorded |
| Reject | The claim is dismissed. Nothing changes in the trade; the decision is recorded |
| Refund | The trade is cancelled and the listing goes back on the marketplace. No money moves through the platform |
| Resolve | The two sides settled it themselves. The case is closed with no change to the trade |

6. **Close.** Status becomes *Resolved*, both sides are notified with the reason, and the chat becomes read-only. The raiser can instead **Withdraw** an open dispute.

**Resolver dashboard** (Admin only): counts of disputes waiting, under review and resolved, the average time to resolve, a **Queue** tab, and a **Resolution history** tab with every outcome. Both tabs can be filtered by category. Every action (raised, evidence added, review started, decision) is stored with who did it and when, and shown as the dispute's history.

**Where it lives**

| Part | Files |
|---|---|
| API | `backend/src/routes/disputes.js` (mounted at `/api/disputes`), `backend/src/lib/disputes.js` |
| Data | `Dispute` model in `backend/src/models.js` (evidence, messages, history and decision are stored inside each dispute) |
| Pages | `frontend/src/pages/Disputes.jsx`, `DisputeDetail.jsx`, `Resolver.jsx`, `frontend/src/components/RaiseDispute.jsx` |
| Tests | `backend/tests/api.disputes.test.js` |

The Assistant can also answer "do I have any disputes?" for the signed-in user. Evidence photos are stored with the other uploaded images. An Admin account is made as described in [Creating an admin](#creating-an-admin).

## Optional: Gemini for general questions

Without a key, general questions are answered from a built-in product guide. To use Gemini:

1. Create a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. Put it in `backend/.env` as `GEMINI_API_KEY=...`.
3. Run `npm run test:gemini` in `backend/` to find a model your key can use, and set `GEMINI_MODEL` to it.

Gemini never sees live inventory, and the assistant falls back to the guide if Gemini can't be reached. Never put API keys in frontend code or commit `.env`. Free-tier content may be used by Google to improve its products, so don't send sensitive data on the free tier.

## Optional: Cloudinary image storage

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` in `backend/.env`. Otherwise images are stored in `backend/uploads/`.

## Training notebooks (Google Colab)

The material recognition models are trained in free Google Colab notebooks. Open one in Colab, choose *Runtime → Change runtime type → T4 GPU*, and run the cells from top to bottom. The full walkthrough is in [`ai-service/TRAINING.md`](ai-service/TRAINING.md).

| Notebook | Use it to |
|---|---|
| [`train_colab.ipynb`](ai-service/training/train_colab.ipynb) | Train the first models (detector and whole-photo classifier) and write `materials.pt`, `materials_thresholds.json` and `materials_cls.pt` |
| [`train_v2_colab.ipynb`](ai-service/training/train_v2_colab.ipynb) | Fix class imbalance (too much wood data) and add more tiles and "not a material" examples |
| [`train_v3_colab.ipynb`](ai-service/training/train_v3_colab.ipynb) | Fix concrete rubble being treated as "other" |

Notes for all three:

- Keep your Roboflow key in a Colab secret named `ROBOFLOW_API_KEY`. Never paste it into a notebook cell or commit it.
- Copy the finished files into `ai-service/weights/`. The `.pt` files are large and are not committed to Git; the deployed site uses their ONNX exports (see [DEPLOY.md](DEPLOY.md)).
- Quote the accuracy printed by `eval_real_photos.py` in reports, not the YOLO mAP.

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
| GET | `/api/analytics/summary`, `/api/analytics/dashboard`, `/api/analytics/impact-records` | signed in (always scoped to your own account; Admin sees the platform) |
| GET | `/api/ai/agent/history`; DELETE `/api/ai/agent/history` | signed in (your own conversation only) |
| GET | `/api/requests/:id` | the buyer, the seller or an Admin (anyone else gets 404) |
| GET | `/api/admin/transactions` | Admin |
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
