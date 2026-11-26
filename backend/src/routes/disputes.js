// Dispute resolution. Buyer and seller of a request can raise a dispute, add
// evidence (photos and written statements) and talk in a dispute chat; an Admin
// reviews it and records a final decision. Every step is kept in `history`.
const express = require('express');
const { Dispute, Request, DISPUTE_CATEGORIES, DISPUTE_OUTCOMES } = require('../models');
const { saveImage } = require('../lib/storage');
const D = require('../lib/disputes');
const {
  HttpError, authenticate, requireRole, upload, objectId, str,
} = require('../middleware');

const router = express.Router();
router.use(authenticate);

const MAX_EVIDENCE = 15;
const MAX_MESSAGES = 400;

const POPULATE = [
  ['buyer', 'name organization role city'],
  ['seller', 'name organization role city'],
  ['raisedBy', 'name role'],
  ['assignedTo', 'name'],
  ['listing', 'title materialType quantityKg price imageUrl status'],
  ['request', 'status quantityKg offerPrice createdAt'],
];
const withRefs = (q) => POPULATE.reduce((query, [path, select]) => query.populate(path, select), q);

// Parties and admins only. Anyone else gets "not found" so ids are not revealed.
async function loadFor(req) {
  const dispute = await Dispute.findById(objectId(req.params.id));
  if (!dispute) throw new HttpError(404, 'Dispute not found');
  if (req.user.role !== 'Admin' && !D.isParty(dispute, req.user)) throw new HttpError(404, 'Dispute not found');
  return dispute;
}
const mustBeOpen = (d) => { if (!D.isOpen(d)) throw new HttpError(409, 'This dispute is closed'); };
const send = async (res, id, status = 200) => res.status(status).json({ dispute: await withRefs(Dispute.findById(id)) });
const actor = (u) => ({ actor: u._id, actorName: u.name });
const who = (u) => u.organization || u.name;

function summary(d) {
  return {
    _id: d._id,
    subject: d.subject,
    category: d.category,
    status: d.status,
    buyer: d.buyer,
    seller: d.seller,
    raisedBy: d.raisedBy,
    assignedTo: d.assignedTo,
    listing: d.listing,
    request: d.request,
    evidenceCount: d.evidence?.length || 0,
    messageCount: d.messages?.length || 0,
    decision: d.decision?.outcome ? {
      outcome: d.decision.outcome, reason: d.decision.reason, decidedByName: d.decision.decidedByName, decidedAt: d.decision.decidedAt,
    } : undefined,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    closedAt: d.closedAt,
  };
}

// ---------------------------------------------------------------- reading
router.get('/', async (req, res) => {
  const q = {};
  if (req.user.role !== 'Admin') q.$or = [{ buyer: req.user._id }, { seller: req.user._id }];
  const { status, category } = req.query;
  if (status === 'open') q.status = { $in: D.OPEN_STATUSES };
  else if (status === 'closed') q.status = { $in: ['resolved', 'withdrawn'] };
  else if (status) q.status = String(status);
  if (category && DISPUTE_CATEGORIES.includes(category)) q.category = category;
  const items = await withRefs(Dispute.find(q, '-evidence.text -messages.text').sort({ updatedAt: -1 }).limit(300)).lean();
  res.json({ items: items.map(summary) });
});

router.get('/stats', requireRole('Admin'), async (_req, res) => {
  const [byStatus, byCategory, byOutcome, timing] = await Promise.all([
    Dispute.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Dispute.aggregate([{ $group: { _id: '$category', n: { $sum: 1 } } }]),
    Dispute.aggregate([{ $match: { status: 'resolved' } }, { $group: { _id: '$decision.outcome', n: { $sum: 1 } } }]),
    Dispute.aggregate([
      { $match: { status: 'resolved', closedAt: { $ne: null } } },
      { $group: { _id: null, ms: { $avg: { $subtract: ['$closedAt', '$createdAt'] } } } },
    ]),
  ]);
  const pick = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  res.json({
    byStatus: pick(byStatus),
    byCategory: pick(byCategory),
    byOutcome: pick(byOutcome),
    avgResolutionHours: timing[0] ? Math.round((timing[0].ms / 36e5) * 10) / 10 : null,
    total: byStatus.reduce((s, r) => s + r.n, 0),
  });
});

router.get('/:id', async (req, res) => {
  const dispute = await loadFor(req);
  await send(res, dispute._id);
});

// ---------------------------------------------------------------- raising
router.post('/', requireRole('Company', 'Buyer', 'Recycler'), async (req, res) => {
  const body = req.body || {};
  const request = await Request.findById(objectId(body.requestId)).populate('listing', 'title');
  if (!request || ![request.buyer, request.seller].some((u) => D.same(u, req.user._id))) {
    throw new HttpError(404, 'Request not found');
  }
  if (!D.DISPUTABLE_REQUEST.includes(request.status)) {
    throw new HttpError(409, 'A dispute can be raised once the seller has accepted the request');
  }
  if (await Dispute.exists({ request: request._id, status: { $in: D.OPEN_STATUSES } })) {
    throw new HttpError(409, 'There is already an open dispute on this request');
  }
  if (!DISPUTE_CATEGORIES.includes(body.category)) throw new HttpError(400, 'Choose what the dispute is about');
  const subject = str(body.subject, { name: 'Title', max: 120, required: true });
  const description = str(body.description, { name: 'Description', max: 2000, required: true });
  if (description.length < 10) throw new HttpError(400, 'Describe the problem in a sentence or two');

  const dispute = await Dispute.create({
    request: request._id,
    listing: request.listing?._id || request.listing,
    buyer: request.buyer,
    seller: request.seller,
    raisedBy: req.user._id,
    category: body.category,
    subject,
    description,
    history: [{ ...actor(req.user), action: 'raised', note: D.CATEGORY_LABEL[body.category] }],
  });
  const link = `/disputes/${dispute._id}`;
  await D.notify([D.otherParty(dispute, req.user)], {
    keyBase: `dispute-raised:${dispute._id}`,
    title: `${who(req.user)} raised a dispute`,
    body: `${D.CATEGORY_LABEL[dispute.category]}: ${D.trim(subject)}. Add your side with evidence or a message.`,
    link,
  });
  await D.notify(await D.adminIds(), {
    keyBase: `dispute-new:${dispute._id}`,
    title: 'New dispute to review',
    body: `${D.CATEGORY_LABEL[dispute.category]}: ${D.trim(subject)}`,
    link,
  });
  await send(res, dispute._id, 201);
});

// ---------------------------------------------------------------- evidence and chat
router.post('/:id/evidence', upload.single('photo'), async (req, res) => {
  const dispute = await loadFor(req);
  if (req.user.role === 'Admin') throw new HttpError(403, 'Only the buyer or seller can add evidence');
  mustBeOpen(dispute);
  const text = str(req.body?.text, { name: 'Description', max: 1000 });
  if (!req.file && !text) throw new HttpError(400, 'Add a photo or write a short description');
  if (dispute.evidence.length >= MAX_EVIDENCE) throw new HttpError(409, `You can add up to ${MAX_EVIDENCE} pieces of evidence`);
  const url = req.file ? await saveImage(req.file.buffer, req.file.mimetype, req.user._id) : undefined;
  dispute.evidence.push({
    by: req.user._id, name: req.user.name, role: req.user.role, kind: req.file ? 'image' : 'note', url, text,
  });
  dispute.history.push({ ...actor(req.user), action: 'evidence', note: req.file ? 'Added a photo' : 'Added a statement' });
  await dispute.save();
  const added = dispute.evidence[dispute.evidence.length - 1];
  const audience = [D.otherParty(dispute, req.user), dispute.assignedTo];
  await D.notify(audience, {
    keyBase: `dispute-evidence:${dispute._id}:${added._id}`,
    title: `New evidence on "${D.trim(dispute.subject, 60)}"`,
    body: `${who(req.user)} ${req.file ? 'added a photo' : 'added a statement'}.`,
    link: `/disputes/${dispute._id}`,
  });
  await send(res, dispute._id, 201);
});

router.post('/:id/messages', async (req, res) => {
  const dispute = await loadFor(req);
  mustBeOpen(dispute);
  const text = str(req.body?.text, { name: 'Message', max: 1000, required: true });
  if (dispute.messages.length >= MAX_MESSAGES) throw new HttpError(409, 'This chat has reached its message limit');
  dispute.messages.push({ author: req.user._id, name: req.user.name, role: req.user.role, text });
  await dispute.save();
  const msg = dispute.messages[dispute.messages.length - 1];
  const fromAdmin = req.user.role === 'Admin';
  const audience = fromAdmin
    ? [dispute.buyer, dispute.seller]
    : [D.otherParty(dispute, req.user), dispute.assignedTo];
  await D.notify(audience.filter((u) => !D.same(u, req.user._id)), {
    keyBase: `dispute-msg:${dispute._id}:${msg._id}`,
    title: `${fromAdmin ? 'Resolver' : who(req.user)}: ${D.trim(dispute.subject, 60)}`,
    body: D.trim(text, 200),
    link: `/disputes/${dispute._id}`,
  });
  await send(res, dispute._id, 201);
});

// ---------------------------------------------------------------- party actions
router.post('/:id/withdraw', async (req, res) => {
  const dispute = await loadFor(req);
  if (!D.same(dispute.raisedBy, req.user._id)) throw new HttpError(403, 'Only the person who raised the dispute can withdraw it');
  mustBeOpen(dispute);
  dispute.status = 'withdrawn';
  dispute.closedAt = new Date();
  dispute.history.push({ ...actor(req.user), action: 'withdrawn', note: 'Withdrawn by the person who raised it' });
  await dispute.save();
  await D.notify([D.otherParty(dispute, req.user), dispute.assignedTo], {
    keyBase: `dispute-withdrawn:${dispute._id}`,
    title: `Dispute withdrawn: ${D.trim(dispute.subject, 60)}`,
    body: `${who(req.user)} withdrew it.`,
    link: `/disputes/${dispute._id}`,
  });
  await send(res, dispute._id);
});

// ---------------------------------------------------------------- admin actions
router.post('/:id/review', requireRole('Admin'), async (req, res) => {
  const dispute = await loadFor(req);
  mustBeOpen(dispute);
  const first = dispute.status === 'open';
  dispute.status = 'under_review';
  dispute.assignedTo = req.user._id;
  dispute.history.push({ ...actor(req.user), action: 'review', note: first ? 'Review started' : 'Case taken over' });
  await dispute.save();
  if (first) {
    await D.notify([dispute.buyer, dispute.seller], {
      keyBase: `dispute-review:${dispute._id}`,
      title: `A resolver is reviewing "${D.trim(dispute.subject, 60)}"`,
      body: 'Add any evidence now. A decision follows once both sides have been heard.',
      link: `/disputes/${dispute._id}`,
    });
  }
  await send(res, dispute._id);
});

router.post('/:id/decision', requireRole('Admin'), async (req, res) => {
  const dispute = await loadFor(req);
  mustBeOpen(dispute);
  const { outcome } = req.body || {};
  if (!DISPUTE_OUTCOMES.includes(outcome)) throw new HttpError(400, 'Choose approve, reject, refund or resolve');
  const reason = str(req.body.reason, { name: 'Reason', max: 1000, required: true });
  if (reason.length < 10) throw new HttpError(400, 'Explain the decision in a sentence or two. Both sides will read it.');

  const effect = await D.applyOutcome(dispute, outcome);
  dispute.status = 'resolved';
  dispute.closedAt = new Date();
  dispute.assignedTo = dispute.assignedTo || req.user._id;
  dispute.decision = {
    outcome, reason, effect, decidedBy: req.user._id, decidedByName: req.user.name, decidedAt: new Date(),
  };
  dispute.history.push({ ...actor(req.user), action: 'decision', note: `${D.OUTCOME_LABEL[outcome]}: ${reason}` });
  await dispute.save();
  await D.notify([dispute.buyer, dispute.seller], {
    keyBase: `dispute-decision:${dispute._id}`,
    title: `Dispute decided: ${D.OUTCOME_LABEL[outcome]}`,
    body: `"${D.trim(dispute.subject, 60)}": ${D.trim(reason, 200)}`,
    link: `/disputes/${dispute._id}`,
  });
  await send(res, dispute._id);
});

module.exports = router;
