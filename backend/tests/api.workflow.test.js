// Multi-account workflow: separate seller, buyer, second buyer and admin accounts.
// Covers per-user assistant history, the buyer/seller request flow, CO2 recorded
// exactly once, role-scoped dashboards and cross-account privacy.
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'rv-test-uploads');
process.env.GEMINI_API_KEY = '';

const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../src/app');
const {
  User, Listing, Request, ImpactRecord, Conversation,
} = require('../src/models');
const { co2Saved } = require('../src/lib/catalog');
const { backfillImpact, resetBackfill } = require('../src/lib/impact');

const URI = process.env.MONGO_TEST_URI;
const d = URI ? describe : describe.skip;

d('Workflow, isolation and CO2 records', () => {
  let app;
  const tok = {};
  const id = {};
  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const post = (who, url, body) => request(app).post(url).set(auth(who)).send(body);
  const get = (who, url) => request(app).get(url).set(auth(who));
  const patch = (who, url, body) => request(app).patch(url).set(auth(who)).send(body);

  async function publish(who, { title, materialType, quantityKg, price, conditionScore = 80 }) {
    const m = await post(who, '/api/materials', { title, materialType, quantityKg, conditionScore }).expect(201);
    const l = await post(who, '/api/listings', { materialId: m.body.material._id, price }).expect(201);
    return l.body.listing;
  }

  beforeAll(async () => {
    await mongoose.connect(URI);
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    resetBackfill();
    app = createApp();
    const reg = async (who, role, city) => {
      const r = await request(app).post('/api/auth/register')
        .send({ name: `${who} user`, email: `${who}@wf.dev`, password: 'password123', role, city, organization: `${who} org` }).expect(201);
      tok[who] = r.body.token;
      id[who] = r.body.user._id;
    };
    await reg('seller', 'Company', 'Patiala');
    await reg('seller2', 'Company', 'Patiala');
    await reg('buyer', 'Buyer', 'Patiala');
    await reg('buyer2', 'Recycler', 'Patiala');
    await reg('admin', 'Buyer', 'Delhi');
    await User.updateOne({ email: 'admin@wf.dev' }, { role: 'Admin' });
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  // ---------------------------------------------------------------- 1. chatbot
  test('assistant history is stored per account and never shared', async () => {
    await request(app).get('/api/ai/agent/history').expect(401);
    expect((await get('buyer', '/api/ai/agent/history').expect(200)).body.messages).toEqual([]);

    await post('buyer', '/api/ai/agent', { message: 'hello there' }).expect(200);
    await post('seller', '/api/ai/agent', { message: 'Any pending requests?' }).expect(200);

    const b = (await get('buyer', '/api/ai/agent/history').expect(200)).body.messages;
    const s = (await get('seller', '/api/ai/agent/history').expect(200)).body.messages;
    const a = (await get('admin', '/api/ai/agent/history').expect(200)).body.messages;
    expect(b.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(b[0].text).toBe('hello there');
    expect(s[0].text).toBe('Any pending requests?');
    expect(s.some((m) => m.text === 'hello there')).toBe(false);
    expect(a).toEqual([]);

    // a client cannot choose whose history to read or write
    const forged = await request(app).post('/api/ai/agent').set(auth('admin'))
      .send({ message: 'hi', user: id.buyer, history: b }).expect(200);
    expect(forged.body.reply).toBeTruthy();
    expect((await get('buyer', '/api/ai/agent/history')).body.messages).toHaveLength(2);
    expect((await Conversation.countDocuments({ user: id.buyer }))).toBe(1);

    // clearing only clears your own
    await request(app).delete('/api/ai/agent/history').set(auth('buyer')).expect(204);
    expect((await get('buyer', '/api/ai/agent/history')).body.messages).toEqual([]);
    expect((await get('seller', '/api/ai/agent/history')).body.messages.length).toBe(2);
    // and it survives logging in again
    const login = await request(app).post('/api/auth/login').send({ email: 'seller@wf.dev', password: 'password123' }).expect(200);
    const again = await request(app).get('/api/ai/agent/history').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(again.body.messages).toHaveLength(2);
  });

  // ------------------------------------------------- 4 + 5. request workflow, RBAC
  let listing;
  let req1;
  test('seller publishes; buyers see it with their own request state', async () => {
    listing = await publish('seller', { title: 'Steel beams', materialType: 'steel', quantityKg: 1000, price: 40000 });
    const seen = await get('buyer', '/api/listings').expect(200);
    const row = seen.body.items.find((l) => l._id === listing._id);
    expect(row).toBeTruthy();
    expect(row.myRequest).toBeNull();
    expect(row.isOwn).toBe(false);
    const own = await get('seller', '/api/listings').expect(200);
    expect(own.body.items.find((l) => l._id === listing._id).isOwn).toBe(true);
    const detail = await get('buyer', `/api/listings/${listing._id}`).expect(200);
    expect(detail.body.listing.myRequest).toBeNull();
  });

  test('only buyers/recyclers can request, never their own listing, never twice', async () => {
    await post('seller', '/api/requests', { listingId: listing._id }).expect(403);   // sellers cannot request
    await post('admin', '/api/requests', { listingId: listing._id }).expect(403);    // admins monitor only
    await request(app).post('/api/requests').send({ listingId: listing._id }).expect(401);
    await post('buyer', '/api/requests', { listingId: 'not-an-id' }).expect(404);

    // two clicks at the same instant: exactly one request is created
    const [a, b] = await Promise.all([
      post('buyer', '/api/requests', { listingId: listing._id, offerPrice: 38000, message: 'Can collect Monday' }),
      post('buyer', '/api/requests', { listingId: listing._id, offerPrice: 38000 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    req1 = (a.status === 201 ? a : b).body.request;
    expect(String(req1.buyer._id)).toBe(id.buyer);
    expect(String(req1.seller._id)).toBe(id.seller);
    expect(String(req1.listing._id)).toBe(listing._id);
    await post('buyer', '/api/requests', { listingId: listing._id }).expect(409);
    expect(await Request.countDocuments({ listing: listing._id, buyer: id.buyer })).toBe(1);

    const seen = await get('buyer', '/api/listings').expect(200);
    expect(seen.body.items.find((l) => l._id === listing._id).myRequest.status).toBe('pending');
  });

  test('requests are visible only to the seller, the buyer and admins', async () => {
    const sellerSees = await get('seller', '/api/requests').expect(200);
    expect(sellerSees.body.items.map((r) => r._id)).toContain(req1._id);
    expect((await get('seller2', '/api/requests')).body.items).toEqual([]);
    expect((await get('buyer2', '/api/requests')).body.items).toEqual([]);
    expect((await get('admin', '/api/requests')).body.items.map((r) => r._id)).toContain(req1._id);

    await get('buyer2', `/api/requests/${req1._id}`).expect(404);
    await get('seller2', `/api/requests/${req1._id}`).expect(404);
    await get('buyer', `/api/requests/${req1._id}`).expect(200);
    await get('admin', `/api/requests/${req1._id}`).expect(200);
    // strangers cannot act on someone else's request
    await patch('seller2', `/api/requests/${req1._id}`, { action: 'accept' }).expect(404);
    await patch('buyer2', `/api/requests/${req1._id}`, { action: 'cancel' }).expect(404);
    await patch('admin', `/api/requests/${req1._id}`, { action: 'accept' }).expect(403);
    // the buyer cannot accept their own request, the seller cannot confirm receipt
    await patch('buyer', `/api/requests/${req1._id}`, { action: 'accept' }).expect(403);
    await patch('seller', `/api/requests/${req1._id}`, { action: 'complete' }).expect(403);
  });

  test('buyer 2 can also request; accepting one declines the rest', async () => {
    const r2 = await post('buyer2', '/api/requests', { listingId: listing._id }).expect(201);
    await patch('seller', `/api/requests/${req1._id}`, { action: 'accept' }).expect(200);
    const asBuyer2 = await get('buyer2', '/api/requests').expect(200);
    expect(asBuyer2.body.items.find((r) => r._id === r2.body.request._id).status).toBe('rejected');
    const asBuyer = await get('buyer', '/api/requests').expect(200);
    expect(asBuyer.body.items[0].status).toBe('accepted'); // status synchronises across accounts
    // the listing is reserved, so nobody can request it any more
    await post('buyer2', '/api/requests', { listingId: listing._id }).expect(404);
  });

  // ------------------------------------------------------------- 2. CO2 once only
  test('completing the trade saves the CO2 record exactly once', async () => {
    expect(await ImpactRecord.countDocuments()).toBe(0);
    // double click: two confirmations at once
    const [a, b] = await Promise.all([
      patch('buyer', `/api/requests/${req1._id}`, { action: 'complete', rating: 5 }),
      patch('buyer', `/api/requests/${req1._id}`, { action: 'complete', rating: 5 }),
    ]);
    expect([a.status, b.status]).toContain(200);
    await patch('buyer', `/api/requests/${req1._id}`, { action: 'complete' }).expect(409);

    const records = await ImpactRecord.find({}).lean();
    expect(records).toHaveLength(1);
    const expected = co2Saved('steel', 1000, 'Sell');
    expect(records[0].co2SavedKg).toBe(expected);
    expect(String(records[0].seller)).toBe(id.seller);
    expect(String(records[0].buyer)).toBe(id.buyer);
    expect(String(records[0].listing)).toBe(listing._id);

    // running the migration again changes nothing
    expect(await backfillImpact()).toBe(0);
    expect(await ImpactRecord.countDocuments()).toBe(1);
  });

  test('seller, buyer and platform see the same recorded saving, and it persists after login', async () => {
    const expected = co2Saved('steel', 1000, 'Sell');
    const seller = (await get('seller', '/api/analytics/summary').expect(200)).body;
    const buyer = (await get('buyer', '/api/analytics/summary').expect(200)).body;
    const admin = (await get('admin', '/api/analytics/summary').expect(200)).body;
    expect(seller.co2SavedKg).toBe(expected);
    expect(buyer.co2SavedKg).toBe(expected);
    expect(admin.co2SavedKg).toBe(expected);
    // another account has none
    expect((await get('seller2', '/api/analytics/summary')).body.co2SavedKg).toBe(0);
    expect((await get('buyer2', '/api/analytics/summary')).body.co2SavedKg).toBe(0);

    const login = await request(app).post('/api/auth/login').send({ email: 'buyer@wf.dev', password: 'password123' }).expect(200);
    const after = await request(app).get('/api/analytics/summary').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(after.body.co2SavedKg).toBe(expected);

    const recs = (await get('buyer', '/api/analytics/impact-records').expect(200)).body;
    expect(recs.items).toHaveLength(1);
    expect(recs.items[0].co2SavedKg).toBe(expected);
    expect(recs.totals.co2SavedKg).toBe(expected);
    expect((await get('seller2', '/api/analytics/impact-records')).body.items).toEqual([]);
  });

  test('old completed trades without a record are filled in once by the migration', async () => {
    const legacy = await Listing.create({
      seller: id.seller2, title: 'Old bricks', materialType: 'brick', conditionScore: 70, quantityKg: 500, price: 1500,
      status: 'sold', soldAt: new Date(), city: 'Patiala',
    });
    await Request.create({ listing: legacy._id, buyer: id.buyer2, seller: id.seller2, quantityKg: 500, offerPrice: 1500, status: 'completed', completedAt: new Date() });
    expect(await ImpactRecord.countDocuments({ listing: legacy._id })).toBe(0);
    expect(await backfillImpact()).toBe(1);
    expect(await backfillImpact()).toBe(0);
    const rec = await ImpactRecord.findOne({ listing: legacy._id }).lean();
    expect(rec.co2SavedKg).toBe(co2Saved('brick', 500, 'Sell'));
    expect(String(rec.buyer)).toBe(id.buyer2);
  });

  // ------------------------------------------------------- 3. dashboards use real data
  test('seller dashboard is built from the database', async () => {
    const { body: s } = await get('seller', '/api/analytics/dashboard').expect(200);
    expect(s.role).toBe('seller');
    expect(s.totals).toMatchObject({ listings: 1, completedListings: 1, activeListings: 0, incomingRequests: 2, pendingRequests: 0 });
    expect(s.totals.requests).toMatchObject({ completed: 1, rejected: 1 });
    expect(s.totals.wasteRecoveredKg).toBe(1000);
    expect(s.totals.co2SavedKg).toBe(co2Saved('steel', 1000, 'Sell'));
    expect(s.totals.revenue).toBe(38000);
    expect(s.monthly).toHaveLength(6);
    const thisMonth = s.monthly[5];
    expect(thisMonth).toMatchObject({ listings: 1, requests: 2, trades: 1, recoveredKg: 1000 });
    expect(s.recentActivity.length).toBeGreaterThan(3);
    expect(s.recentRequests).toHaveLength(2);
    expect(s.byMaterial.find((m) => m.material === 'steel').divertedKg).toBe(1000);
    // seller 2 sees none of it
    const { body: s2 } = await get('seller2', '/api/analytics/dashboard').expect(200);
    // (seller 2 only has the old brick trade created above)
    expect(s2.totals.incomingRequests).toBe(1);
    expect(s2.recentRequests.map((r) => r.listing)).toEqual(['Old bricks']);
    expect(s2.totals.wasteRecoveredKg).toBe(500);
  });

  test('buyer dashboard shows only that buyer\'s requests and purchases', async () => {
    const { body: b } = await get('buyer', '/api/analytics/dashboard').expect(200);
    expect(b.role).toBe('buyer');
    expect(b.totals).toMatchObject({ requests: 1, completed: 1, pending: 0, purchases: 1, spend: 38000, materialKg: 1000 });
    expect(b.history).toHaveLength(1);
    expect(b.history[0]).toMatchObject({ listing: 'Steel beams', status: 'completed' });
    const { body: b2 } = await get('buyer2', '/api/analytics/dashboard').expect(200);
    // (buyer 2 was declined on the steel and bought the old bricks)
    expect(b2.totals).toMatchObject({ requests: 2, rejected: 1, purchases: 1, materialKg: 500 });
    expect(b2.history.map((h) => h.listing).sort()).toEqual(['Old bricks', 'Steel beams']);
    expect(b2.history.find((h) => h.listing === 'Steel beams').status).toBe('rejected');
  });

  test('admin dashboard covers the whole platform and nobody else can read it', async () => {
    const { body: a } = await get('admin', '/api/analytics/dashboard').expect(200);
    expect(a.role).toBe('admin');
    expect(a.totals).toMatchObject({ users: 5, sellers: 2, buyers: 2, admins: 1, transactions: 2 });
    expect(a.totals.listings).toBe(2);
    expect(a.totals.recoveredKg).toBe(1500);
    expect(a.totals.co2SavedKg).toBe(Math.round((co2Saved('steel', 1000) + co2Saved('brick', 500)) * 10) / 10);
    expect(a.categories.find((c) => c.material === 'steel')).toMatchObject({ listings: 1, recoveredKg: 1000 });
    expect(a.recentTransactions).toHaveLength(2);
    expect(a.monthly).toHaveLength(6);

    const tx = await get('admin', '/api/admin/transactions').expect(200);
    expect(tx.body.items.length).toBe(3);
    const done = tx.body.items.filter((r) => r.status === 'completed');
    expect(done.every((r) => typeof r.co2SavedKg === 'number')).toBe(true);
    await get('buyer', '/api/admin/transactions').expect(403);
    await get('seller', '/api/admin/transactions').expect(403);
    await get('buyer', '/api/admin/overview').expect(403);
    // a buyer asking for "admin" data still only gets their own numbers: the role is read from the JWT
    expect((await request(app).get('/api/analytics/dashboard?role=Admin').set(auth('buyer'))).body.role).toBe('buyer');
  });

  test('a refunded trade gives its CO2 saving back, and a later sale is recorded again', async () => {
    const before = (await get('admin', '/api/analytics/summary')).body.co2SavedKg;
    const d1 = await post('buyer', '/api/disputes', { requestId: req1._id, category: 'quality', subject: 'Rusted beams', description: 'The beams were rusted through, not as described.' }).expect(201);
    await post('admin', `/api/disputes/${d1.body.dispute._id}/review`, {}).expect(200);
    await post('admin', `/api/disputes/${d1.body.dispute._id}/decision`, { outcome: 'refund', reason: 'Photos show the rust, refund agreed.' }).expect(200);
    expect(await ImpactRecord.countDocuments({ listing: listing._id })).toBe(0);
    const expectedAfter = Math.round((before - co2Saved('steel', 1000, 'Sell')) * 10) / 10;
    expect((await get('admin', '/api/analytics/summary')).body.co2SavedKg).toBe(expectedAfter);
    expect((await get('buyer', '/api/analytics/summary')).body.co2SavedKg).toBe(0);
    expect((await get('seller', '/api/analytics/summary')).body.co2SavedKg).toBe(0);

    // the listing is back on the market; the second buyer buys it and it is recorded once more
    const r = await post('buyer2', '/api/requests', { listingId: listing._id }).expect(201);
    await patch('seller', `/api/requests/${r.body.request._id}`, { action: 'accept' }).expect(200);
    await patch('buyer2', `/api/requests/${r.body.request._id}`, { action: 'complete', rating: 4 }).expect(200);
    const rec = await ImpactRecord.find({ listing: listing._id }).lean();
    expect(rec).toHaveLength(1);
    expect(String(rec[0].buyer)).toBe(id.buyer2);
    expect((await get('buyer', '/api/analytics/summary')).body.co2SavedKg).toBe(0);
  });

  test('role boundaries on seller-only and buyer-only endpoints', async () => {
    await get('buyer', '/api/materials').expect(403);
    await get('buyer', '/api/listings/mine').expect(403);
    await post('buyer', '/api/listings', { materialId: '000000000000000000000000', price: 1 }).expect(403);
    await get('seller', '/api/wanted').expect(403);
    await get('seller', '/api/admin/users').expect(403);
    await get('buyer2', '/api/admin/listings').expect(403);
  });
});
