const express = require('express');
const { Listing, Material, Request, User } = require('../models');
const ai = require('../lib/aiClient');
const { co2Saved, MATERIALS } = require('../lib/catalog');
const { haversineKm } = require('../lib/geo');
const { searchListings } = require('../lib/search');
const { notifyBuyersForListing } = require('../lib/wanted');
const {
  HttpError, authenticate, requireRole, objectId, num, str,
} = require('../middleware');

const router = express.Router();
router.use(authenticate);

// GET /api/listings?nl=steel under 30k near me&material=&maxPrice=&maxDistanceKm=&minCondition=&sort=&page=
router.get('/', async (req, res) => {
  const q = req.query;
  let filters = {};
  let parser = null;
  const nl = str(q.nl, { name: 'Search', max: 300 });
  if (nl) {
    const parsed = await ai.parse(nl);
    filters = { ...parsed.filters };
    parser = parsed.parser;
  }
  // explicit filter controls override what the parser inferred
  if (q.material) filters.material = MATERIALS[q.material] ? q.material : undefined;
  const maxPrice = num(q.maxPrice, { name: 'maxPrice', min: 0 });
  const minPrice = num(q.minPrice, { name: 'minPrice', min: 0 });
  const maxDist = num(q.maxDistanceKm, { name: 'maxDistanceKm', min: 1, max: 5000 });
  const minCond = num(q.minCondition, { name: 'minCondition', min: 0, max: 100 });
  if (maxPrice !== undefined) filters.max_price = maxPrice;
  if (minPrice !== undefined) filters.min_price = minPrice;
  if (maxDist !== undefined) filters.max_distance_km = maxDist;
  if (minCond !== undefined) filters.min_condition = minCond;
  if (q.sort) filters.sort = q.sort === 'price' ? 'price' : 'match';
  Object.keys(filters).forEach((k) => filters[k] === undefined && delete filters[k]);

  const page = num(q.page, { name: 'page', min: 1, max: 1000 }) || 1;
  const limit = num(q.limit, { name: 'limit', min: 1, max: 50 }) || 12;
  const result = await searchListings({ filters, user: req.user, page, limit });
  res.json({ ...result, filters, parser });
});

router.get('/mine', requireRole('Company'), async (req, res) => {
  const items = await Listing.find({ seller: req.user._id }).sort({ createdAt: -1 }).limit(500).lean();
  const counts = await Request.aggregate([
    { $match: { seller: req.user._id, status: 'pending' } },
    { $group: { _id: '$listing', n: { $sum: 1 } } },
  ]);
  const pending = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json({ items: items.map((l) => ({ ...l, pendingRequests: pending[String(l._id)] || 0 })) });
});

router.post('/', requireRole('Company'), async (req, res) => {
  const body = req.body || {};
  const material = await Material.findOne({ _id: objectId(body.materialId), owner: req.user._id });
  if (!material) throw new HttpError(404, 'Material not found');
  if (material.status !== 'inventory') throw new HttpError(409, `This material is already ${material.status}`);

  const price = num(body.price, { name: 'Price', min: 0, max: 1e10, required: true });
  const suggested = material.ai?.suggestedPrice || material.estimatedPrice;
  const listing = await Listing.create({
    material: material._id,
    seller: req.user._id,
    title: str(body.title, { name: 'Title', max: 120 }) || material.title,
    description: str(body.description, { name: 'Description', max: 2000 }) || material.notes,
    materialType: material.materialType,
    conditionScore: material.conditionScore,
    conditionLabel: material.conditionLabel,
    quantityKg: material.quantityKg,
    price,
    suggestedPrice: suggested,
    priceAccepted: suggested ? Math.abs(price - suggested) / suggested <= 0.02 : undefined,
    imageUrl: material.imageUrl,
    city: material.city || req.user.city,
    location: material.location?.lat != null ? material.location : req.user.location,
    co2SavedKg: co2Saved(material.materialType, material.quantityKg, 'Sell'),
  });
  material.status = 'listed';
  material.chosenAction = 'Sell';
  await material.save();
  const buyersAlerted = await notifyBuyersForListing(listing);
  res.status(201).json({ listing, buyersAlerted });
});

router.get('/:id', async (req, res) => {
  const listing = await Listing.findById(objectId(req.params.id))
    .populate('seller', 'name organization rating ratingCount city').lean();
  if (!listing || (listing.status === 'withdrawn' && String(listing.seller._id) !== String(req.user._id)
    && req.user.role !== 'Admin')) throw new HttpError(404, 'Listing not found');
  const mine = await Request.findOne({ listing: listing._id, buyer: req.user._id }, 'status').sort({ createdAt: -1 }).lean();
  res.json({
    listing: {
      ...listing,
      distanceKm: haversineKm(req.user.location, listing.location),
      isOwn: String(listing.seller._id) === String(req.user._id),
      myRequest: mine ? { _id: mine._id, status: mine.status } : null,
    },
  });
});

// Seller edits price/description, or withdraws / re-activates the listing.
router.patch('/:id', requireRole('Company'), async (req, res) => {
  const listing = await Listing.findOne({ _id: objectId(req.params.id), seller: req.user._id });
  if (!listing) throw new HttpError(404, 'Listing not found');
  const body = req.body || {};
  if (['reserved', 'sold'].includes(listing.status)) throw new HttpError(409, `Listing is ${listing.status}`);
  if (body.price !== undefined) listing.price = num(body.price, { name: 'Price', min: 0, max: 1e10, required: true });
  if (body.description !== undefined) listing.description = str(body.description, { name: 'Description', max: 2000 });
  if (body.status === 'withdrawn' || body.status === 'active') {
    if (body.status === 'active' && listing.status === 'withdrawn') {
      const m = listing.material && await Material.findById(listing.material);
      if (!m || m.status !== 'inventory') throw new HttpError(409, 'The inventory item was deleted, closed or published again');
    }
    listing.status = body.status;
    if (body.status === 'withdrawn') {
      await Request.updateMany({ listing: listing._id, status: 'pending' },
        { status: 'rejected', respondedAt: new Date() });
    }
    if (listing.material) {
      await Material.updateOne({ _id: listing.material },
        { status: body.status === 'withdrawn' ? 'inventory' : 'listed' });
    }
  }
  await listing.save();
  // re-activated or price changed: buyers whose alerts now match hear about it (once per alert)
  if (listing.status === 'active') await notifyBuyersForListing(listing);
  res.json({ listing });
});

// Rank Buyers/Recyclers for a listing: interest in this material, distance, rating.
router.get('/:id/buyers', requireRole('Company'), async (req, res) => {
  const listing = await Listing.findOne({ _id: objectId(req.params.id), seller: req.user._id }).lean();
  if (!listing) throw new HttpError(404, 'Listing not found');
  const users = await User.find({ role: { $in: ['Buyer', 'Recycler'] }, suspended: false }).limit(500).lean();
  const history = await Request.aggregate([
    { $match: { buyer: { $in: users.map((u) => u._id) } } },
    { $lookup: { from: 'listings', localField: 'listing', foreignField: '_id', as: 'l' } },
    { $unwind: '$l' },
    { $group: { _id: '$buyer', total: { $sum: 1 }, same: { $sum: { $cond: [{ $eq: ['$l.materialType', listing.materialType] }, 1, 0] } } } },
  ]);
  const hist = Object.fromEntries(history.map((h) => [String(h._id), h]));
  const recyclable = MATERIALS[listing.materialType].recyclability;
  const ranked = users.map((u) => {
    const h = hist[String(u._id)];
    let interest = h ? 0.3 + 0.7 * (h.same / h.total) : 0.3;
    if (u.role === 'Recycler' && listing.conditionScore < 60) interest = Math.max(interest, 0.4 + 0.5 * recyclable);
    const distanceKm = haversineKm(listing.location, u.location);
    const dist = distanceKm == null ? 0.5 : Math.max(0, 1 - distanceKm / 50);
    const score = 0.5 * interest + 0.35 * dist + 0.15 * (u.rating / 5);
    return {
      _id: u._id, name: u.name, organization: u.organization, role: u.role, city: u.city, distanceKm,
      pastRequests: h?.total || 0, score: Math.round(score * 1000) / 1000,
    };
  }).sort((a, b) => b.score - a.score).slice(0, 10);
  res.json({ items: ranked });
});

module.exports = router;
