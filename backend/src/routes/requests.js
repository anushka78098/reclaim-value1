// Purchase requests with a two-step check (stands in for escrow):
// pending -> accepted (seller; listing reserved) -> completed (buyer confirms after inspection)
// buyer may cancel while pending or after a failed inspection; seller may reject while pending.
const express = require('express');
const { notifyBuyersForListing } = require('../lib/wanted');
const { Dispute, Listing, Material, Request, User } = require('../models');
const { haversineKm } = require('../lib/geo');
const {
  HttpError, authenticate, requireRole, objectId, num, str,
} = require('../middleware');

const router = express.Router();
router.use(authenticate);

const populate = (q) => q
  .populate('listing', 'title materialType quantityKg price imageUrl status city conditionScore isDemo')
  .populate('buyer', 'name organization city role')
  .populate('seller', 'name organization city rating');

router.post('/', requireRole('Buyer', 'Recycler'), async (req, res) => {
  const body = req.body || {};
  const listing = await Listing.findById(objectId(body.listingId));
  if (!listing || listing.status !== 'active') throw new HttpError(404, 'This listing is no longer available');
  const existing = await Request.findOne({ listing: listing._id, buyer: req.user._id, status: { $in: ['pending', 'accepted'] } });
  if (existing) throw new HttpError(409, 'You already have an open request on this listing');

  const quantityKg = num(body.quantityKg, { name: 'Quantity', min: 0.1, max: listing.quantityKg }) || listing.quantityKg;
  const request = await Request.create({
    listing: listing._id,
    buyer: req.user._id,
    seller: listing.seller,
    quantityKg,
    offerPrice: num(body.offerPrice, { name: 'Offer', min: 0, max: 1e10 }) ?? listing.price,
    message: str(body.message, { name: 'Message', max: 1000 }),
    distanceKm: haversineKm(req.user.location, listing.location),
  });
  if (!listing.firstInterestAt) {
    listing.firstInterestAt = request.createdAt;
    await listing.save();
  }
  res.status(201).json({ request: await populate(Request.findById(request._id)) });
});

router.get('/', async (req, res) => {
  const q = {};
  if (req.user.role === 'Company') q.seller = req.user._id;
  else if (req.user.role !== 'Admin') q.buyer = req.user._id;
  if (req.query.status) q.status = String(req.query.status);
  const rows = await populate(Request.find(q).sort({ createdAt: -1 }).limit(300));
  // newest dispute per request, so the page can offer "raise" or "view"
  const disputes = await Dispute.find({ request: { $in: rows.map((r) => r._id) } }, 'request status createdAt').sort({ createdAt: 1 }).lean();
  const latest = new Map(disputes.map((d) => [String(d.request), { _id: d._id, status: d.status }]));
  res.json({ items: rows.map((r) => ({ ...r.toObject(), dispute: latest.get(String(r._id)) || null })) });
});

router.patch('/:id', async (req, res) => {
  const request = await Request.findById(objectId(req.params.id));
  if (!request) throw new HttpError(404, 'Request not found');
  const isSeller = String(request.seller) === String(req.user._id);
  const isBuyer = String(request.buyer) === String(req.user._id);
  const { action } = req.body || {};
  const listing = await Listing.findById(request.listing);
  const now = new Date();
  const need = (cond, msg) => { if (!cond) throw new HttpError(409, msg); };

  switch (action) {
    case 'accept':
      if (!isSeller) throw new HttpError(403, 'Only the seller can accept');
      need(request.status === 'pending', `Request is already ${request.status}`);
      need(listing && listing.status === 'active', 'Listing is not active');
      request.status = 'accepted';
      request.respondedAt = now;
      listing.status = 'reserved';
      await Request.updateMany({ listing: listing._id, _id: { $ne: request._id }, status: 'pending' },
        { status: 'rejected', respondedAt: now });
      if (listing.material) await Material.updateOne({ _id: listing.material }, { status: 'reserved' });
      break;
    case 'reject':
      if (!isSeller) throw new HttpError(403, 'Only the seller can reject');
      need(request.status === 'pending', `Request is already ${request.status}`);
      request.status = 'rejected';
      request.respondedAt = now;
      break;
    case 'cancel':
      if (!isBuyer) throw new HttpError(403, 'Only the buyer can cancel');
      need(['pending', 'accepted'].includes(request.status), `Request is already ${request.status}`);
      if (request.status === 'accepted' && listing) { // failed inspection -> back on the market
        listing.status = 'active';
        if (listing.material) await Material.updateOne({ _id: listing.material }, { status: 'listed' });
      }
      request.status = 'cancelled';
      request.cancelReason = str(req.body.reason, { name: 'Reason', max: 300 });
      break;
    case 'complete': {
      if (!isBuyer) throw new HttpError(403, 'Only the buyer confirms receipt after inspection');
      need(request.status === 'accepted', 'The seller has to accept first');
      const rating = num(req.body.rating, { name: 'Rating', min: 1, max: 5 });
      request.status = 'completed';
      request.completedAt = now;
      listing.status = 'sold';
      listing.soldAt = now;
      if (listing.material) await Material.updateOne({ _id: listing.material }, { status: 'sold', closedAt: now });
      if (rating) {
        request.buyerRating = rating;
        const seller = await User.findById(request.seller);
        // the default 4.0 counts as one prior vote so a single rating can't swing it fully
        const k = seller.ratingCount;
        seller.rating = Math.round(((seller.rating * (k + 1) + rating) / (k + 2)) * 100) / 100;
        seller.ratingCount = k + 1;
        await seller.save();
      }
      break;
    }
    default:
      throw new HttpError(400, 'Action must be accept, reject, cancel or complete');
  }
  await request.save();
  if (listing) await listing.save();
  if (action === 'cancel' && listing?.status === 'active') await notifyBuyersForListing(listing);
  res.json({ request: await populate(Request.findById(request._id)) });
});

module.exports = router;
