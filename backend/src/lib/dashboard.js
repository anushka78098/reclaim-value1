// Role dashboards: every number below is read from MongoDB for the signed-in
// account (seller = own listings/requests, buyer = own requests, admin = platform).
// The role always comes from the authenticated user, never from the request.
const {
  User, Listing, Request, ImpactRecord,
} = require('../models');
const { MATERIAL_TYPES } = require('./catalog');
const {
  supplySummary, demandSummary, ensureBackfilled, monthKey, lastMonths, r1,
} = require('./impact');

const COUNT_KEYS = ['pending', 'accepted', 'completed', 'rejected', 'cancelled'];

const since = (months) => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - (months - 1));
  return d;
};

const tally = (rows, key = 'status') => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});

// One row per month with the given counters, filled from dated rows.
function monthly(fields, sources) {
  const rows = Object.fromEntries(lastMonths(6).map((m) => [m, { month: m, ...Object.fromEntries(fields.map((f) => [f, 0])) }]));
  for (const { rows: list, field, at, value } of sources) {
    for (const item of list) {
      const when = at(item);
      const bucket = when && rows[monthKey(when)];
      if (bucket) bucket[field] += value ? value(item) : 1;
    }
  }
  return Object.values(rows).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? r1(v) : v])));
}

const personName = (u) => u?.organization || u?.name || 'Unknown';

async function platformImpact() {
  const s = await supplySummary();
  return { co2SavedKg: s.co2SavedKg, divertedKg: s.divertedKg, trades: s.tradesRecorded };
}

async function sellerDashboard(user) {
  const [summary, listings, requests, platform] = await Promise.all([
    supplySummary({ owner: user._id }),
    Listing.find({ seller: user._id }).sort({ createdAt: -1 }).lean(),
    Request.find({ seller: user._id }).sort({ createdAt: -1 }).limit(500)
      .populate('listing', 'title materialType').populate('buyer', 'name organization').lean(),
    platformImpact(),
  ]);
  const byStatus = tally(listings);
  const reqCounts = tally(requests);

  const events = [];
  for (const l of listings.slice(0, 30)) events.push({ at: l.publishedAt || l.createdAt, kind: 'listing', text: `Listed “${l.title}”` });
  for (const r of requests.slice(0, 60)) {
    const t = r.listing?.title || 'a listing';
    events.push({ at: r.createdAt, kind: 'request', text: `${personName(r.buyer)} requested “${t}”` });
    if (r.status === 'accepted' || r.status === 'completed') events.push({ at: r.respondedAt || r.updatedAt, kind: 'accepted', text: `You accepted ${personName(r.buyer)}'s request for “${t}”` });
    if (r.status === 'rejected') events.push({ at: r.respondedAt || r.updatedAt, kind: 'rejected', text: `Request from ${personName(r.buyer)} for “${t}” was declined` });
    if (r.status === 'completed') events.push({ at: r.completedAt, kind: 'completed', text: `Trade completed with ${personName(r.buyer)} for “${t}”` });
  }

  return {
    role: 'seller',
    totals: {
      listings: listings.length,
      activeListings: byStatus.active || 0,
      reservedListings: byStatus.reserved || 0,
      completedListings: byStatus.sold || 0,
      withdrawnListings: byStatus.withdrawn || 0,
      incomingRequests: requests.length,
      pendingRequests: reqCounts.pending || 0,
      requests: Object.fromEntries(COUNT_KEYS.map((k) => [k, reqCounts[k] || 0])),
      wasteRecoveredKg: summary.divertedKg,
      co2SavedKg: summary.co2SavedKg,
      revenue: summary.revenue,
      trades: summary.tradesRecorded,
    },
    platform,
    monthly: monthly(['listings', 'requests', 'trades', 'recoveredKg', 'co2SavedKg'], [
      { rows: listings, field: 'listings', at: (l) => l.createdAt },
      { rows: requests, field: 'requests', at: (r) => r.createdAt },
      { rows: requests.filter((r) => r.status === 'completed'), field: 'trades', at: (r) => r.completedAt },
    ]).map((m, i) => ({ ...m, recoveredKg: summary.monthly[i].divertedKg, co2SavedKg: summary.monthly[i].co2SavedKg })),
    byMaterial: summary.byMaterial.map((b) => ({ ...b, listings: listings.filter((l) => l.materialType === b.material).length })),
    recentActivity: events.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 10),
    recentRequests: requests.slice(0, 8).map((r) => ({
      _id: r._id, listing: r.listing?.title, buyer: personName(r.buyer), status: r.status, offerPrice: r.offerPrice, quantityKg: r.quantityKg, at: r.createdAt,
    })),
  };
}

async function buyerDashboard(user) {
  const [summary, requests, platform] = await Promise.all([
    demandSummary(user._id),
    Request.find({ buyer: user._id }).sort({ createdAt: -1 }).limit(500)
      .populate('listing', 'title materialType').populate('seller', 'name organization').lean(),
    platformImpact(),
  ]);
  const counts = tally(requests);
  return {
    role: 'buyer',
    totals: {
      requests: requests.length,
      pending: counts.pending || 0,
      accepted: counts.accepted || 0,
      completed: counts.completed || 0,
      rejected: counts.rejected || 0,
      cancelled: counts.cancelled || 0,
      purchases: summary.purchases,
      spend: summary.spend,
      materialKg: summary.divertedKg,
      co2SavedKg: summary.co2SavedKg,
    },
    platform,
    monthly: monthly(['requests', 'purchases', 'materialKg', 'co2SavedKg'], [
      { rows: requests, field: 'requests', at: (r) => r.createdAt },
      { rows: requests.filter((r) => r.status === 'completed'), field: 'purchases', at: (r) => r.completedAt },
    ]).map((m, i) => ({ ...m, materialKg: summary.monthly[i].divertedKg, co2SavedKg: summary.monthly[i].co2SavedKg })),
    byMaterial: summary.byMaterial,
    history: requests.slice(0, 10).map((r) => ({
      _id: r._id, listing: r.listing?.title || 'Deleted listing', materialType: r.listing?.materialType, seller: personName(r.seller),
      status: r.status, offerPrice: r.offerPrice, quantityKg: r.quantityKg, at: r.createdAt,
    })),
  };
}

async function adminDashboard() {
  await ensureBackfilled();
  const from = since(6);
  const [summary, roles, listingStatus, reqStatus, newUsers, newListings, listingsByType, records, recent] = await Promise.all([
    supplySummary(),
    User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
    Listing.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Request.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    User.find({ createdAt: { $gte: from } }, 'createdAt').lean(),
    Listing.find({ createdAt: { $gte: from } }, 'createdAt').lean(),
    Listing.aggregate([{ $group: { _id: '$materialType', n: { $sum: 1 } } }]),
    ImpactRecord.find({}).lean(),
    ImpactRecord.find({}).sort({ completedAt: -1 }).limit(10)
      .populate('seller', 'name organization').populate('buyer', 'name organization').populate('listing', 'title').lean(),
  ]);
  const role = Object.fromEntries(roles.map((r) => [r._id, r.n]));
  const ls = Object.fromEntries(listingStatus.map((r) => [r._id, r.n]));
  const rs = Object.fromEntries(reqStatus.map((r) => [r._id, r.n]));
  const typeCount = Object.fromEntries(listingsByType.map((r) => [r._id, r.n]));
  const totalRequests = Object.values(rs).reduce((a, b) => a + b, 0);

  return {
    role: 'admin',
    totals: {
      users: Object.values(role).reduce((a, b) => a + b, 0),
      sellers: role.Company || 0,
      buyers: (role.Buyer || 0) + (role.Recycler || 0),
      admins: role.Admin || 0,
      listings: Object.values(ls).reduce((a, b) => a + b, 0),
      activeListings: ls.active || 0,
      reservedListings: ls.reserved || 0,
      soldListings: ls.sold || 0,
      withdrawnListings: ls.withdrawn || 0,
      requests: totalRequests,
      pendingRequests: rs.pending || 0,
      transactions: rs.completed || 0,
      transactionValue: r1(records.reduce((s, r) => s + (r.value || 0), 0)),
      recoveredKg: summary.divertedKg,
      co2SavedKg: summary.co2SavedKg,
      diversionRate: summary.diversionRate,
    },
    monthly: monthly(['users', 'listings', 'transactions', 'recoveredKg', 'co2SavedKg'], [
      { rows: newUsers, field: 'users', at: (u) => u.createdAt },
      { rows: newListings, field: 'listings', at: (l) => l.createdAt },
      { rows: records, field: 'transactions', at: (r) => r.completedAt },
    ]).map((m, i) => ({ ...m, recoveredKg: summary.monthly[i].divertedKg, co2SavedKg: summary.monthly[i].co2SavedKg })),
    categories: MATERIAL_TYPES.map((m) => {
      const b = summary.byMaterial.find((x) => x.material === m) || {};
      return { material: m, listings: typeCount[m] || 0, recoveredKg: b.divertedKg || 0, co2SavedKg: b.co2SavedKg || 0 };
    }),
    recentTransactions: recent.map((r) => ({
      _id: r._id, listing: r.listing?.title || 'Deleted listing', materialType: r.materialType, seller: personName(r.seller),
      buyer: personName(r.buyer), quantityKg: r.quantityKg, co2SavedKg: r.co2SavedKg, value: r.value, at: r.completedAt,
    })),
  };
}

function dashboardFor(user) {
  if (user.role === 'Admin') return adminDashboard();
  if (user.role === 'Company') return sellerDashboard(user);
  return buyerDashboard(user);
}

// The caller's own CO2 records (seller: their sales, buyer: their purchases, admin: all).
async function impactRecordsFor(user, limit = 50) {
  await ensureBackfilled();
  const q = user.role === 'Admin' ? {} : user.role === 'Company' ? { seller: user._id } : { buyer: user._id };
  const rows = await ImpactRecord.find(q).sort({ completedAt: -1 }).limit(limit)
    .populate('listing', 'title').populate('seller', 'name organization').populate('buyer', 'name organization').lean();
  const total = await ImpactRecord.aggregate([{ $match: q }, { $group: { _id: null, co2: { $sum: '$co2SavedKg' }, kg: { $sum: '$divertedKg' }, n: { $sum: 1 } } }]);
  return {
    items: rows.map((r) => ({
      _id: r._id, listing: r.listing?.title || 'Deleted listing', materialType: r.materialType, quantityKg: r.quantityKg,
      co2SavedKg: r.co2SavedKg, value: r.value, at: r.completedAt,
      counterparty: user.role === 'Company' ? personName(r.buyer) : personName(r.seller),
      seller: personName(r.seller), buyer: personName(r.buyer),
    })),
    totals: { co2SavedKg: r1(total[0]?.co2 || 0), divertedKg: r1(total[0]?.kg || 0), trades: total[0]?.n || 0 },
  };
}

module.exports = { dashboardFor, impactRecordsFor, sellerDashboard, buyerDashboard, adminDashboard };
