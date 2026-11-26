// Dispute resolution helpers: access checks, notifications and what a decision changes.
const {
  Dispute, Listing, Material, Notification, Request, User,
} = require('../models');
const { notifyBuyersForListing } = require('./wanted');

const CATEGORY_LABEL = {
  description: 'Item not as described',
  pricing: 'Pricing',
  quality: 'Quality',
  order: 'Order issue',
  other: 'Other',
};
const OUTCOME_LABEL = {
  approve: 'Claim approved',
  reject: 'Claim rejected',
  refund: 'Refund',
  resolve: 'Resolved',
};
const OPEN_STATUSES = ['open', 'under_review'];
// requests that can be disputed: the seller has accepted at least once
const DISPUTABLE_REQUEST = ['accepted', 'completed', 'cancelled'];

const same = (a, b) => String(a?._id || a) === String(b?._id || b);
const isParty = (dispute, user) => same(dispute.buyer, user._id) || same(dispute.seller, user._id);
const isOpen = (dispute) => OPEN_STATUSES.includes(dispute.status);
const otherParty = (dispute, user) => (same(dispute.buyer, user._id) ? dispute.seller : dispute.buyer);

// One in-app notification per (event, person); never breaks the main action.
async function notify(userIds, { keyBase, title, body, link }) {
  try {
    const ids = [...new Set(userIds.filter(Boolean).map((u) => String(u._id || u)))];
    if (!ids.length) return;
    await Notification.insertMany(ids.map((user) => ({
      user, kind: 'dispute', title: title.slice(0, 160), body: body ? body.slice(0, 400) : undefined,
      link, key: `${keyBase}:${user}`,
    })), { ordered: false });
  } catch (err) {
    if (err.code !== 11000) console.error('dispute notifications:', err.message);
  }
}

async function adminIds() {
  const admins = await User.find({ role: 'Admin', suspended: false }, '_id').limit(25).lean();
  return admins.map((a) => a._id);
}

const trim = (t, n = 120) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// Applies the practical effect of an admin decision. No money moves through the
// platform, so a refund means the trade is cancelled and the material goes back on sale.
async function applyOutcome(dispute, outcome) {
  if (outcome !== 'refund') {
    return {
      approve: 'Recorded: the claim is upheld. No change to the trade.',
      reject: 'Recorded: the claim is dismissed. No change to the trade.',
      resolve: 'Recorded: both sides settled this. No change to the trade.',
    }[outcome];
  }
  const request = await Request.findById(dispute.request);
  const listing = request && await Listing.findById(request.listing);
  if (!request || !['accepted', 'completed'].includes(request.status)) {
    return 'Refund recorded. The trade was already cancelled, so nothing else changed.';
  }
  const wasCompleted = request.status === 'completed';
  request.status = 'cancelled';
  request.cancelReason = 'Refunded after dispute resolution';
  await request.save();
  // only put the listing back on sale if it is still held by this very trade
  const heldByTrade = listing && ((wasCompleted && listing.status === 'sold') || (!wasCompleted && listing.status === 'reserved'));
  if (!heldByTrade) return 'Refund recorded and the trade cancelled.';
  listing.status = 'active';
  listing.soldAt = undefined;
  await listing.save();
  if (listing.material) await Material.updateOne({ _id: listing.material }, { status: 'listed', $unset: { closedAt: 1 } });
  await notifyBuyersForListing(listing);
  return 'Refund recorded: the trade was cancelled and the listing is back on the market. No money moves through the platform.';
}

module.exports = {
  CATEGORY_LABEL,
  OUTCOME_LABEL,
  OPEN_STATUSES,
  DISPUTABLE_REQUEST,
  same,
  isParty,
  isOpen,
  otherParty,
  notify,
  adminIds,
  applyOutcome,
  trim,
  Dispute,
};
