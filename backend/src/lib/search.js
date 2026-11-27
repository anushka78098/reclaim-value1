// Marketplace search shared by GET /api/listings and the AI agent tool.
const { Listing, Request } = require('../models');
const { MATERIALS } = require('./catalog');
const { cityLocation } = require('./geo');
const { scoreListings } = require('./matching');

const CANDIDATE_LIMIT = 500;

function buildQuery(f) {
  const q = { status: 'active' };
  if (f.material && MATERIALS[f.material]) q.materialType = f.material;
  if (f.min_price != null || f.max_price != null) {
    q.price = {};
    if (f.min_price != null) q.price.$gte = f.min_price;
    if (f.max_price != null) q.price.$lte = f.max_price;
  }
  if (f.min_condition != null) q.conditionScore = { $gte: f.min_condition };
  if (f.min_quantity_kg != null) q.quantityKg = { $gte: f.min_quantity_kg };
  return q;
}

async function searchListings({ filters = {}, user, page = 1, limit = 12 }) {
  const cityLoc = cityLocation(filters.city);
  const origin = cityLoc || (user?.location?.lat != null ? user.location : null);
  const candidates = await Listing.find(buildQuery(filters))
    .sort({ publishedAt: -1 })
    .limit(CANDIDATE_LIMIT)
    .populate('seller', 'name organization rating ratingCount city')
    .lean();

  let scored = scoreListings(candidates, { filters, origin });
  if (filters.max_distance_km != null && origin) {
    scored = scored.filter((s) => s.distanceKm != null && s.distanceKm <= filters.max_distance_km);
  }
  scored.sort(filters.sort === 'price'
    ? (a, b) => a.listing.price - b.listing.price
    : (a, b) => b.match.score - a.match.score);

  const total = scored.length;
  const start = (Math.max(page, 1) - 1) * limit;
  const pageRows = scored.slice(start, start + limit);
  // the caller's own latest request on each listing, so the page can show its status
  const mine = new Map();
  if (user && pageRows.length) {
    const rows = await Request.find({ buyer: user._id, listing: { $in: pageRows.map((r) => r.listing._id) } }, 'listing status').sort({ createdAt: 1 }).lean();
    rows.forEach((r) => mine.set(String(r.listing), { _id: r._id, status: r.status }));
  }
  const items = pageRows.map(({ listing, distanceKm, match }) => ({
    ...listing,
    distanceKm,
    match,
    isOwn: user ? String(listing.seller?._id) === String(user._id) : false,
    myRequest: mine.get(String(listing._id)) || null,
  }));
  return { items, total, page, pages: Math.ceil(total / limit) || 1, origin: origin ? (cityLoc?.city || user?.city) : null };
}

module.exports = { searchListings, buildQuery };
