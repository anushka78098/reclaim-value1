const express = require('express');
const ai = require('../lib/aiClient');
const gemini = require('../lib/gemini');
const config = require('../config');
const { saveImage, storageMode } = require('../lib/storage');
const { runAgent } = require('../lib/agent');
const { Conversation } = require('../models');
const { MATERIALS, conditionLabel } = require('../lib/catalog');
const {
  HttpError, authenticate, requireRole, upload, num, str,
} = require('../middleware');

const router = express.Router();
router.use(authenticate);

router.get('/status', async (_req, res) => {
  res.json({
    aiService: await ai.health(),
    gemini: { configured: gemini.isConfigured(), model: config.gemini.model },
    storage: storageMode(),
  });
});

// Photo -> AI inspection. The image is stored first so it can be attached to
// the inventory item; the analysis itself is NOT saved until the user confirms.
router.post('/analyze', requireRole('Company'), upload.single('image'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Attach a photo (field name "image")');
  const quantityKg = num(req.body.quantityKg, { name: 'Quantity (kg)', min: 0.1, max: 1e7 }) || 100;
  const distanceKm = num(req.body.distanceKm, { name: 'Distance', min: 0, max: 5000 }) ?? 10;
  const imageUrl = await saveImage(req.file.buffer, req.file.mimetype, req.user._id);
  try {
    const analysis = await ai.analyze({
      buffer: req.file.buffer, filename: req.file.originalname, mimetype: req.file.mimetype, quantityKg, distanceKm,
    });
    res.json({ imageUrl, analysis });
  } catch (err) {
    if (err instanceof ai.AiUnavailableError) {
      // Let the user continue with manual entry instead of losing the upload.
      return res.status(503).json({ imageUrl, error: `${err.message}. You can still enter the details manually.` });
    }
    throw err;
  }
});

function materialBody(body = {}) {
  if (!MATERIALS[body.material]) throw new HttpError(400, 'Unknown material');
  return {
    material: body.material,
    condition_score: num(body.conditionScore, { name: 'Condition', min: 0, max: 100 }) ?? 70,
    quantity_kg: num(body.quantityKg, { name: 'Quantity', min: 0.1, max: 1e7 }) || 100,
    distance_km: num(body.distanceKm, { name: 'Distance', min: 0, max: 5000 }) ?? 10,
  };
}

// Re-price / re-recommend after the user corrects the AI's material or condition.
router.post('/estimate', async (req, res) => {
  const b = materialBody(req.body);
  const [price, recommendation] = await Promise.all([ai.price(b), ai.recommend(b)]);
  res.json({ price, recommendation, conditionLabel: conditionLabel(b.condition_score) });
});

// Assistant conversations belong to the signed-in account. The owner is always
// req.user (from the JWT) - there is no id in the URL or body to tamper with.
const KEEP_MESSAGES = 100;

router.get('/agent/history', async (req, res) => {
  const convo = await Conversation.findOne({ user: req.user._id }).lean();
  res.json({ messages: convo?.messages || [] });
});

router.post('/agent', async (req, res) => {
  const message = str(req.body?.message, { name: 'Message', max: 500, required: true });
  // context for the model comes from the saved conversation, not from the browser
  const convo = await Conversation.findOne({ user: req.user._id }, { messages: { $slice: -8 } }).lean();
  const history = (convo?.messages || []).map(({ role, text }) => ({ role, text }));
  const out = await runAgent({ message, history, user: req.user });
  const now = new Date();
  await Conversation.updateOne({ user: req.user._id }, {
    $push: {
      messages: {
        $each: [
          { role: 'user', text: message, createdAt: now },
          { role: 'assistant', text: String(out.reply || '').slice(0, 4000), source: out.source, createdAt: new Date() },
        ],
        $slice: -KEEP_MESSAGES,
      },
    },
  }, { upsert: true });
  res.json(out);
});

router.delete('/agent/history', async (req, res) => {
  await Conversation.updateOne({ user: req.user._id }, { $set: { messages: [] } });
  res.status(204).end();
});

module.exports = router;
