// Governance: user moderation and listing take-downs.
const express = require('express');
const {
  User, Listing, Request, Material, ImpactRecord, ROLES,
} = require('../models');
const { supplySummary } = require('../lib/impact');
const {
  HttpError, authenticate, requireRole, objectId,
} = require('../middleware');

const router = express.Router();
router.use(authenticate, requireRole('Admin'));

router.get('/overview', async (_req, res) => {
  const [summary, users] = await Promise.all([
    supplySummary(),
    User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
  ]);
  res.json({ ...summary, users: Object.fromEntries(users.map((u) => [u._id, u.n])) });
});

router.get('/users', async (req, res) => {
  const q = {};
  if (req.query.role && ROLES.includes(req.query.role)) q.role = req.query.role;
  if (req.query.q) {
    const rx = { $regex: String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    q.$or = [{ name: rx }, { email: rx }, { organization: rx }];
  }
  res.json({ items: await User.find(q).sort({ createdAt: -1 }).limit(500) });
});

router.patch('/users/:id', async (req, res) => {
  const user = await User.findById(objectId(req.params.id));
  if (!user) throw new HttpError(404, 'User not found');
  if (String(user._id) === String(req.user._id)) throw new HttpError(400, 'You cannot change your own account here');
  const { role, suspended } = req.body || {};
  if (role !== undefined) {
    if (!ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
    user.role = role;
  }
  if (suspended !== undefined) {
    user.suspended = Boolean(suspended);
    if (user.suspended) {
      // take a suspended seller's live listings off the market
      const live = await Listing.find({ seller: user._id, status: 'active' }, '_id material');
      await Listing.updateMany({ _id: { $in: live.map((l) => l._id) } }, { status: 'withdrawn' });
      await Material.updateMany({ _id: { $in: live.map((l) => l.material).filter(Boolean) } }, { status: 'inventory' });
      await Request.updateMany({ listing: { $in: live.map((l) => l._id) }, status: 'pending' }, { status: 'rejected', respondedAt: new Date() });
    }
  }
  await user.save();
  res.json({ user });
});

router.get('/listings', async (req, res) => {
  const q = {};
  if (req.query.status) q.status = String(req.query.status);
  const items = await Listing.find(q).sort({ createdAt: -1 }).limit(500)
    .populate('seller', 'name email organization').lean();
  res.json({ items });
});

router.patch('/listings/:id', async (req, res) => {
  const listing = await Listing.findById(objectId(req.params.id));
  if (!listing) throw new HttpError(404, 'Listing not found');
  if (req.body?.status !== 'withdrawn') throw new HttpError(400, 'Admins can only withdraw listings');
  if (listing.status === 'sold') throw new HttpError(409, 'Sold listings cannot be withdrawn');
  listing.status = 'withdrawn';
  await listing.save();
  if (listing.material) await Material.updateOne({ _id: listing.material }, { status: 'inventory' });
  await Request.updateMany({ listing: listing._id, status: { $in: ['pending', 'accepted'] } },
    { status: 'rejected', respondedAt: new Date() });
  res.json({ listing });
});

// All trades on the platform, with the CO2 each completed one saved.
router.get('/transactions', async (req, res) => {
  const q = {};
  if (req.query.status) q.status = String(req.query.status);
  const rows = await Request.find(q).sort({ createdAt: -1 }).limit(300)
    .populate('listing', 'title materialType quantityKg price')
    .populate('buyer', 'name organization role').populate('seller', 'name organization').lean();
  const records = await ImpactRecord.find({ listing: { $in: rows.map((r) => r.listing?._id).filter(Boolean) } }, 'listing co2SavedKg').lean();
  const co2 = new Map(records.map((r) => [String(r.listing), r.co2SavedKg]));
  res.json({
    items: rows.map((r) => ({ ...r, co2SavedKg: r.status === 'completed' ? co2.get(String(r.listing?._id)) ?? null : null })),
  });
});

module.exports = router;
