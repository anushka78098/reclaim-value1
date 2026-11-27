# Deploying Reclaim Value (free, on Vercel)

Everything runs on Vercel's free **Hobby** plan, as two projects built from the same GitHub repository. Data lives in a free **MongoDB Atlas** cluster.

| Vercel project | Root Directory | What it runs |
|---|---|---|
| `reclaim-value-ai` | `ai-service` | FastAPI AI service. The trained models run from `weights/*.onnx` with onnxruntime (no PyTorch). |
| `reclaim-value` | *(repository root)* | The React website (static) and the Express API as one function (`api/index.js`). |

How it fits together:

- **Photos** are shrunk in the browser to 1600 px before upload. Vercel caps a request at 4.5 MB.
- **Uploaded photos** are stored in MongoDB and served from `/api/images/:id`, because Vercel has no lasting disk. Set the Cloudinary variables to use Cloudinary instead.
- **Region:** both projects run in Mumbai (`bom1`, set in `vercel.json`), next to the Atlas cluster.
- **Cold start:** after a period of no use, the first photo takes a few seconds longer while the AI function starts.
- **Plan terms:** the Hobby plan is for non-commercial use.

## 1. Database: MongoDB Atlas (free M0)

1. Create an **M0 / Free** cluster, preferably in Mumbai.
2. Create a **database user** (Database & Network Access → Database Users).
3. Under **IP Access List**, add `0.0.0.0/0`, because Vercel has no fixed IP addresses.
4. Build the connection string:
   - Go to **Connect → Drivers** and copy the string.
   - Insert the password in place of `<db_password>`.
   - Add the database name after `.mongodb.net/`, for example `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/reclaim_value`.
5. If this database already has data from an earlier version, bring it up to date once (safe to repeat, deletes nothing):

   ```bash
   cd backend && MONGO_URI="..." npm run migrate
   ```

6. Optional: load the demo accounts and listings from `backend/`:

   ```bash
   MONGO_URI="..." npm run seed:demo
   ```

## 2. Export the trained models to ONNX (once, on the machine with the .pt files)

```bash
cd ai-service && source .venv/bin/activate
pip install onnx onnxslim onnxruntime
python training/export_onnx.py --check ~/Desktop/reclaim_web_test   # the folder is optional
```

This writes `weights/materials.onnx` and `weights/materials_cls.onnx`. The `--check` option runs every photo through the app's own code with both the `.pt` and the `.onnx` models, and reports whether the answers match.

`.gitignore` lets the `.onnx` files and `materials_thresholds.json` into Git; the `.pt` files stay local. Commit and push.

## 3. Vercel project 1: the AI service

1. At <https://vercel.com>, sign up with GitHub. Then go to **Add New → Project** and import the repository.
2. Set **Project Name** to `reclaim-value-ai` and **Root Directory** to `ai-service`. The Framework Preset should become **FastAPI**.
3. Click **Deploy**.
4. Open `https://<your-ai-project>.vercel.app/health`:
   - `material_model.mode` must be `"trained"`.
   - Both `loaded` values must be `true`.

## 4. Vercel project 2: website and API

1. Go to **Add New → Project** and import the **same** repository again.
2. Set **Project Name** to `reclaim-value` and leave **Root Directory** at the repository root. The Framework Preset should be **Other**; `vercel.json` sets the build.
3. Add the environment variables:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `MONGO_URI` | the Atlas connection string |
   | `JWT_SECRET` | a long random string, e.g. from `openssl rand -hex 32` |
   | `AI_SERVICE_URL` | `https://<your-ai-project>.vercel.app` (no trailing slash) |

4. Click **Deploy**, then open `https://<your-project>.vercel.app`.

Use the project's main `.vercel.app` domain for `AI_SERVICE_URL`. Per-deployment URLs (with a random suffix) may be behind Vercel's login protection.

## Updating

Run `git add . && git commit -m "Update" && git push`, and both projects redeploy automatically.

## Optional

- **Cloudinary for photos:** set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.
- **Gemini for general assistant questions:** set `GEMINI_API_KEY`.
- **Admin account:** register normally, then in Atlas open **Browse Collections → users** and set your user's `role` to `Admin`.

## Alternative: Render (website and API only)

Render's free web service has 512 MB of memory, which is too little for the AI models. Set it up as follows:

| Setting | Value |
|---|---|
| Build Command | `cd frontend && npm ci --include=dev && npm run build && cd ../backend && npm ci --omit=dev` |
| Start Command | `cd backend && npm start` |
| Health Check Path | `/api/health` |
| Environment variables | `NODE_ENV=production`, `NODE_VERSION=22`, `MONGO_URI`, `JWT_SECRET` |
| `AI_SERVICE_URL` | `off`, or the AI project's Vercel URL to get photo recognition |
