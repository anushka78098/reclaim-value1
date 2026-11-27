const mongoose = require('mongoose');
const { MATERIAL_TYPES, ACTIONS } = require('./lib/catalog');

const { Schema } = mongoose;
const ROLES = ['Company', 'Buyer', 'Recycler', 'Admin'];

const locationSchema = new Schema({ lat: Number, lng: Number }, { _id: false });

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true },
  organization: { type: String, trim: true, maxlength: 120 },
  city: String,
  location: locationSchema,
  rating: { type: Number, default: 4, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0 },
  suspended: { type: Boolean, default: false },
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });

userSchema.set('toJSON', {
  transform: (_, ret) => { delete ret.passwordHash; delete ret.__v; return ret; },
});

const STATUSES = ['inventory', 'listed', 'reserved', 'sold', 'reused', 'recycled', 'disposed'];

const materialSchema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  materialType: { type: String, enum: MATERIAL_TYPES, required: true },
  conditionScore: { type: Number, min: 0, max: 100, required: true },
  conditionLabel: String,
  quantityKg: { type: Number, required: true, min: 0.1 },
  notes: { type: String, maxlength: 1000 },
  imageUrl: String,
  city: String,
  location: locationSchema,
  // Snapshot of what the AI suggested, kept for accuracy / acceptance metrics.
  ai: {
    material: String,
    confidence: Number,
    model: String,
    demoMode: Boolean,
    conditionScore: Number,
    recommendedAction: { type: String, enum: [...ACTIONS, null] },
    suggestedPrice: Number,
  },
  materialOverridden: { type: Boolean, default: false },
  chosenAction: { type: String, enum: [...ACTIONS, null] },
  estimatedPrice: Number,
  status: { type: String, enum: STATUSES, default: 'inventory', index: true },
  closedAt: Date,
}, { timestamps: true });

const listingSchema = new Schema({
  material: { type: Schema.Types.ObjectId, ref: 'Material' },
  seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, maxlength: 2000 },
  materialType: { type: String, enum: MATERIAL_TYPES, required: true },
  conditionScore: { type: Number, min: 0, max: 100, required: true },
  conditionLabel: String,
  quantityKg: { type: Number, required: true, min: 0.1 },
  price: { type: Number, required: true, min: 0 },
  suggestedPrice: Number,
  priceAccepted: Boolean,
  imageUrl: String,
  city: String,
  location: locationSchema,
  co2SavedKg: Number,
  status: { type: String, enum: ['active', 'reserved', 'sold', 'withdrawn'], default: 'active' },
  isDemo: { type: Boolean, default: false },
  publishedAt: { type: Date, default: Date.now },
  firstInterestAt: Date, // used for the time-to-match (TTM) metric
  soldAt: Date,
}, { timestamps: true });
listingSchema.index({ status: 1, materialType: 1, price: 1 });
listingSchema.index({ title: 'text', description: 'text' });

const requestSchema = new Schema({
  listing: { type: Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
  buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  quantityKg: Number,
  offerPrice: { type: Number, min: 0 },
  message: { type: String, maxlength: 1000 },
  distanceKm: Number,
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'cancelled', 'completed'],
    default: 'pending',
  },
  respondedAt: Date,
  completedAt: Date,
  buyerRating: { type: Number, min: 1, max: 5 },
  cancelReason: String,
}, { timestamps: true });
// One open (pending or accepted) request per buyer and listing. The route checks
// first for a friendly message; this index is what stops two simultaneous clicks.
requestSchema.index({ listing: 1, buyer: 1 }, {
  unique: true,
  partialFilterExpression: { status: { $in: ['pending', 'accepted'] } },
});

// Environmental impact of one completed trade, saved the moment the buyer confirms.
// `listing` is unique: a listing can only be sold once, so its CO2 is counted exactly
// once however often the request is retried or the migration is re-run.
const impactRecordSchema = new Schema({
  listing: { type: Schema.Types.ObjectId, ref: 'Listing', required: true, unique: true },
  request: { type: Schema.Types.ObjectId, ref: 'Request', index: true },
  seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  buyer: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  materialType: { type: String, enum: MATERIAL_TYPES, required: true },
  quantityKg: { type: Number, required: true, min: 0 },
  divertedKg: { type: Number, required: true, min: 0 },
  co2SavedKg: { type: Number, required: true, min: 0 },
  value: Number, // agreed price (INR)
  completedAt: { type: Date, required: true },
}, { timestamps: true });
impactRecordSchema.index({ completedAt: -1 });

// One assistant conversation per account. The owner is always taken from the
// signed-in user on the server, never from the request body, so histories can't mix.
const conversationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  messages: [{
    _id: false,
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true, maxlength: 4000 },
    source: String,
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

// "Wanted" alert: a Buyer/Recycler describes what they need and is notified
// when a matching listing is published. Companies see open demand.
const wantedSchema = new Schema({
  buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  materialType: { type: String, enum: MATERIAL_TYPES, required: true },
  minQuantityKg: { type: Number, min: 0 },
  maxPricePerKg: { type: Number, min: 0 },
  minCondition: { type: Number, min: 0, max: 100 },
  maxDistanceKm: { type: Number, min: 1, max: 5000, default: 50 },
  city: String,
  location: locationSchema,
  note: { type: String, maxlength: 300 },
  active: { type: Boolean, default: true },
}, { timestamps: true });
wantedSchema.index({ active: 1, materialType: 1 });

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['wanted_match', 'demand_nudge', 'dispute'], required: true },
  title: { type: String, required: true, maxlength: 160 },
  body: { type: String, maxlength: 400 },
  link: String,
  read: { type: Boolean, default: false },
  // one notification per (alert, listing) or (alert, supplier): reruns never duplicate
  key: { type: String, required: true, unique: true },
}, { timestamps: true });
notificationSchema.index({ user: 1, createdAt: -1 });

// Dispute between the two sides of a request (wrong description, price, quality
// or order problems). Evidence and the chat live inside the dispute; an admin
// reviews both sides and records one final decision. Nothing is ever deleted:
// `history` keeps every step.
const DISPUTE_CATEGORIES = ['description', 'pricing', 'quality', 'order', 'other'];
const DISPUTE_OUTCOMES = ['approve', 'reject', 'refund', 'resolve'];
const DISPUTE_STATUSES = ['open', 'under_review', 'resolved', 'withdrawn'];

const disputeSchema = new Schema({
  request: { type: Schema.Types.ObjectId, ref: 'Request', required: true, index: true },
  listing: { type: Schema.Types.ObjectId, ref: 'Listing' },
  buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, enum: DISPUTE_CATEGORIES, required: true },
  subject: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  status: { type: String, enum: DISPUTE_STATUSES, default: 'open' },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  evidence: [{
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    name: String,
    role: String,
    kind: { type: String, enum: ['image', 'note'] },
    url: String,
    text: { type: String, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
  }],
  messages: [{
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    name: String,
    role: String,
    text: { type: String, required: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
  }],
  history: [{
    at: { type: Date, default: Date.now },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: String,
    action: String, // raised | evidence | review | decision | withdrawn
    note: String,
  }],
  decision: {
    outcome: { type: String, enum: [...DISPUTE_OUTCOMES, null] },
    reason: String,
    effect: String, // what the decision changed, in plain words
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedByName: String,
    decidedAt: Date,
  },
  closedAt: Date,
}, { timestamps: true });
disputeSchema.index({ status: 1, createdAt: -1 });

// Uploaded photos when no Cloudinary account is set up and the host has no
// lasting disk (Render free, Vercel). Photos are shrunk in the browser first.
const imageSchema = new Schema({
  data: { type: Buffer, required: true },
  contentType: { type: String, required: true },
  size: Number,
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = {
  ROLES,
  STATUSES,
  User: mongoose.model('User', userSchema),
  Material: mongoose.model('Material', materialSchema),
  Listing: mongoose.model('Listing', listingSchema),
  Request: mongoose.model('Request', requestSchema),
  ImpactRecord: mongoose.model('ImpactRecord', impactRecordSchema),
  Conversation: mongoose.model('Conversation', conversationSchema),
  Wanted: mongoose.model('Wanted', wantedSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  Dispute: mongoose.model('Dispute', disputeSchema),
  DISPUTE_CATEGORIES,
  DISPUTE_OUTCOMES,
  DISPUTE_STATUSES,
  StoredImage: mongoose.model('StoredImage', imageSchema),
};
