// Impact / ESG metrics. Computed in JS over lean documents - fine at pilot
// scale (thousands of records); move to $group pipelines if it grows.
const {
  Material, Listing, Request, ImpactRecord,
} = require('../models');
const { co2Saved, MATERIAL_TYPES } = require('./catalog');

const r1 = (x) => Math.round(x * 10) / 10;

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(monthKey(new Date(d.getFullYear(), d.getMonth() - i, 1)));
  }
  return out;
}

// One "outcome" = some kg of a material that left the site by some route.
function summarise(outcomes) {
  const byMaterial = Object.fromEntries(MATERIAL_TYPES.map((m) => [m, { material: m, divertedKg: 0, disposedKg: 0, co2SavedKg: 0 }]));
  const months = lastMonths(6);
  const monthly = Object.fromEntries(months.map((m) => [m, { month: m, divertedKg: 0, co2SavedKg: 0 }]));
  let diverted = 0;
  let disposed = 0;
  let co2 = 0;
  const byAction = { Reuse: 0, Sell: 0, Recycle: 0, Dispose: 0 };
  for (const o of outcomes) {
    const bucket = byMaterial[o.materialType];
    if (!bucket) continue;
    byAction[o.action] += o.quantityKg;
    if (o.action === 'Dispose') {
      disposed += o.quantityKg;
      bucket.disposedKg += o.quantityKg;
      continue;
    }
    // trades carry the CO2 that was saved in the database when they completed
    const c = o.co2SavedKg != null ? o.co2SavedKg : co2Saved(o.materialType, o.quantityKg, o.action);
    diverted += o.quantityKg;
    co2 += c;
    bucket.divertedKg += o.quantityKg;
    bucket.co2SavedKg += c;
    const mk = o.at && monthKey(o.at);
    if (monthly[mk]) {
      monthly[mk].divertedKg += o.quantityKg;
      monthly[mk].co2SavedKg += c;
    }
  }
  return {
    divertedKg: r1(diverted),
    disposedKg: r1(disposed),
    co2SavedKg: r1(co2),
    diversionRate: diverted + disposed > 0 ? r1((diverted / (diverted + disposed)) * 100) : null,
    byAction: Object.fromEntries(Object.entries(byAction).map(([k, v]) => [k, r1(v)])),
    byMaterial: Object.values(byMaterial).map((b) => ({
      ...b, divertedKg: r1(b.divertedKg), disposedKg: r1(b.disposedKg), co2SavedKg: r1(b.co2SavedKg),
    })),
    monthly: Object.values(monthly).map((m) => ({ ...m, divertedKg: r1(m.divertedKg), co2SavedKg: r1(m.co2SavedKg) })),
  };
}

const pct = (num, den) => (den ? r1((num / den) * 100) : null);

// ---- Saving a completed trade's impact (exactly once) -----------------------

// Called when the buyer confirms a trade. Safe to call again for the same listing:
// the unique index on `listing` plus $setOnInsert means the first record wins.
async function recordImpact({ listing, request, completedAt = new Date() }) {
  const quantityKg = request?.quantityKg || listing.quantityKg;
  const doc = {
    request: request?._id,
    seller: listing.seller,
    buyer: request?.buyer,
    materialType: listing.materialType,
    quantityKg,
    divertedKg: quantityKg,
    co2SavedKg: co2Saved(listing.materialType, quantityKg, 'Sell'),
    value: request?.offerPrice ?? listing.price,
    completedAt: request?.completedAt || completedAt,
  };
  try {
    const r = await ImpactRecord.updateOne({ listing: listing._id }, { $setOnInsert: doc }, { upsert: true });
    return r.upsertedCount === 1;
  } catch (err) {
    if (err.code === 11000) return false; // a parallel call recorded it first
    throw err;
  }
}

// Creates records for trades that were completed before records existed
// (or were created outside the normal flow). Idempotent and never deletes anything.
async function backfillImpact() {
  const sold = await Listing.find({ status: 'sold' }, 'seller materialType quantityKg price soldAt updatedAt').lean();
  if (!sold.length) return 0;
  const have = new Set((await ImpactRecord.find({ listing: { $in: sold.map((l) => l._id) } }, 'listing').lean())
    .map((r) => String(r.listing)));
  const missing = sold.filter((l) => !have.has(String(l._id)));
  if (!missing.length) return 0;
  const done = await Request.find({ listing: { $in: missing.map((l) => l._id) }, status: 'completed' }).sort({ completedAt: -1 }).lean();
  const byListing = new Map();
  for (const r of done) if (!byListing.has(String(r.listing))) byListing.set(String(r.listing), r);
  let created = 0;
  for (const l of missing) {
    const req = byListing.get(String(l._id));
    // eslint-disable-next-line no-await-in-loop
    if (await recordImpact({ listing: l, request: req, completedAt: l.soldAt || l.updatedAt })) created += 1;
  }
  return created;
}

let backfilled = null;
// Runs the backfill once per server process (lazily, so a fresh deploy upgrades old data on its own).
function ensureBackfilled() {
  if (!backfilled) backfilled = backfillImpact().catch((err) => { backfilled = null; throw err; });
  return backfilled;
}
const resetBackfill = () => { backfilled = null; };

const recordOutcome = (r) => ({
  materialType: r.materialType, quantityKg: r.divertedKg, action: 'Sell', co2SavedKg: r.co2SavedKg, at: r.completedAt,
});

async function supplySummary(match = {}) {
  await ensureBackfilled();
  const [materials, listings, requests, records] = await Promise.all([
    Material.find(match.owner ? { owner: match.owner } : {}).lean(),
    Listing.find(match.owner ? { seller: match.owner } : {}).lean(),
    Request.find(match.owner ? { seller: match.owner } : {}).lean(),
    ImpactRecord.find(match.owner ? { seller: match.owner } : {}).lean(),
  ]);

  // Sales come from the saved impact records; own reuse, recycling and disposal from the inventory.
  const outcomes = records.map(recordOutcome);
  for (const m of materials) {
    const action = { reused: 'Reuse', recycled: 'Recycle', disposed: 'Dispose' }[m.status];
    if (action) outcomes.push({ materialType: m.materialType, quantityKg: m.quantityKg, action, at: m.closedAt || m.updatedAt });
  }

  const ttmHours = listings.filter((l) => l.firstInterestAt)
    .map((l) => (new Date(l.firstInterestAt) - new Date(l.publishedAt)) / 36e5);
  const withAi = materials.filter((m) => m.ai && m.ai.material);
  const priced = listings.filter((l) => typeof l.priceAccepted === 'boolean');
  const requestCounts = requests.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  return {
    scope: match.owner ? 'company' : 'platform',
    counts: {
      materials: materials.length,
      inInventory: materials.filter((m) => m.status === 'inventory').length,
      activeListings: listings.filter((l) => l.status === 'active').length,
      soldListings: listings.filter((l) => l.status === 'sold').length,
      requests: requestCounts,
    },
    revenue: r1(records.reduce((s, r) => s + (r.value || 0), 0)),
    tradesRecorded: records.length,
    ...summarise(outcomes),
    ttm: {
      medianHours: ttmHours.length ? r1(median(ttmHours)) : null,
      matchedListings: ttmHours.length,
      within48h: pct(ttmHours.filter((h) => h <= 48).length, ttmHours.length),
      targetHours: 48,
    },
    classificationAccuracy: pct(withAi.filter((m) => !m.materialOverridden).length, withAi.length),
    aiReviewed: withAi.length,
    priceAcceptanceRate: pct(priced.filter((l) => l.priceAccepted).length, priced.length),
  };
}

async function demandSummary(buyerId) {
  await ensureBackfilled();
  const [requests, records] = await Promise.all([
    Request.find({ buyer: buyerId }).lean(),
    ImpactRecord.find({ buyer: buyerId }).lean(),
  ]);
  const s = summarise(records.map(recordOutcome));
  return {
    scope: 'buyer',
    counts: { requests: requests.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}) },
    spend: r1(records.reduce((sum, r) => sum + (r.value || 0), 0)),
    purchases: records.length,
    divertedKg: s.divertedKg,
    co2SavedKg: s.co2SavedKg,
    byMaterial: s.byMaterial,
    monthly: s.monthly,
  };
}

function summaryFor(user) {
  if (user.role === 'Admin') return supplySummary();
  if (user.role === 'Company') return supplySummary({ owner: user._id });
  return demandSummary(user._id);
}

module.exports = {
  summaryFor, supplySummary, demandSummary, median, summarise, recordImpact, backfillImpact, ensureBackfilled, resetBackfill,
  monthKey, lastMonths, r1,
};
