// Dispute resolution against a real MongoDB (runs only with MONGO_TEST_URI; wipes that DB).
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:9';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'rv-test-uploads');
process.env.GEMINI_API_KEY = '';

const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../src/app');
const { User, Listing, Request, Notification } = require('../src/models');

const URI = process.env.MONGO_TEST_URI;
const d = URI ? describe : describe.skip;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

d('Dispute resolution', () => {
  let app;
  const tok = {};
  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  let requestId;
  let listingId;
  let disputeId;

  beforeAll(async () => {
    await mongoose.connect(URI);
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    app = createApp();
    const reg = async (who, role) => {
      const r = await request(app).post('/api/auth/register')
        .send({ name: `${who} user`, email: `${who}@test.dev`, password: 'password123', role, city: 'Patiala' }).expect(201);
      tok[who] = r.body.token;
    };
    await reg('company', 'Company');
    await reg('buyer', 'Buyer');
    await reg('recycler', 'Recycler');
    await reg('admin', 'Buyer');
    await User.updateOne({ email: 'admin@test.dev' }, { role: 'Admin' });

    const m = await request(app).post('/api/materials').set(auth('company'))
      .send({ title: 'Red bricks', materialType: 'brick', conditionScore: 75, quantityKg: 3000 }).expect(201);
    const l = await request(app).post('/api/listings').set(auth('company')).send({ materialId: m.body.material._id, price: 9000 }).expect(201);
    listingId = l.body.listing._id;
    const r = await request(app).post('/api/requests').set(auth('buyer')).send({ listingId }).expect(201);
    requestId = r.body.request._id;
  });
  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  const raise = (who, body = {}) => request(app).post('/api/disputes').set(auth(who))
    .send({ requestId, category: 'description', subject: 'Bricks are cracked', description: 'Half of the delivered bricks are cracked.', ...body });

  test('only a request the seller has accepted can be disputed, and only by its two sides', async () => {
    await raise('buyer').expect(409); // still pending
    await request(app).patch(`/api/requests/${requestId}`).set(auth('company')).send({ action: 'accept' }).expect(200);
    await raise('recycler').expect(404); // not a party
    await raise('admin').expect(403); // admins decide, they do not raise
    await raise('buyer', { category: 'nonsense' }).expect(400);
    await raise('buyer', { description: 'bad' }).expect(400);
    await raise('buyer', { subject: '' }).expect(400);
  });

  test('raising notifies the other side and the admins, and blocks a second open dispute', async () => {
    const r = await raise('buyer').expect(201);
    disputeId = r.body.dispute._id;
    expect(r.body.dispute.status).toBe('open');
    expect(r.body.dispute.history[0].action).toBe('raised');
    await raise('company').expect(409);

    const company = await User.findOne({ email: 'company@test.dev' });
    const admin = await User.findOne({ email: 'admin@test.dev' });
    const buyer = await User.findOne({ email: 'buyer@test.dev' });
    expect(await Notification.countDocuments({ user: company._id, kind: 'dispute' })).toBe(1);
    expect(await Notification.countDocuments({ user: admin._id, kind: 'dispute' })).toBe(1);
    expect(await Notification.countDocuments({ user: buyer._id, kind: 'dispute' })).toBe(0); // not the raiser

    const reqs = await request(app).get('/api/requests').set(auth('buyer')).expect(200);
    expect(reqs.body.items[0].dispute).toMatchObject({ _id: disputeId, status: 'open' });
  });

  test('access: parties and admins only', async () => {
    await request(app).get(`/api/disputes/${disputeId}`).set(auth('company')).expect(200);
    await request(app).get(`/api/disputes/${disputeId}`).set(auth('admin')).expect(200);
    await request(app).get(`/api/disputes/${disputeId}`).set(auth('recycler')).expect(404);
    const mine = await request(app).get('/api/disputes').set(auth('recycler')).expect(200);
    expect(mine.body.items).toHaveLength(0);
    const all = await request(app).get('/api/disputes').set(auth('admin')).expect(200);
    expect(all.body.items).toHaveLength(1);
    await request(app).get('/api/disputes/stats').set(auth('buyer')).expect(403);
  });

  test('both sides add evidence (photos and statements) and chat; the recycler cannot', async () => {
    const photo = await request(app).post(`/api/disputes/${disputeId}/evidence`).set(auth('buyer'))
      .attach('photo', PNG, { filename: 'crack.png', contentType: 'image/png' }).field('text', 'Cracked on delivery').expect(201);
    const first = photo.body.dispute.evidence[0];
    expect(first.kind).toBe('image');
    expect(first.url).toMatch(/^\/(api\/images|uploads)\//);

    await request(app).post(`/api/disputes/${disputeId}/evidence`).set(auth('company'))
      .send({ text: 'They were sold as seconds, see the listing note.' }).expect(201);
    await request(app).post(`/api/disputes/${disputeId}/evidence`).set(auth('company')).send({}).expect(400);
    await request(app).post(`/api/disputes/${disputeId}/evidence`).set(auth('admin')).send({ text: 'x y z' }).expect(403);
    await request(app).post(`/api/disputes/${disputeId}/evidence`).set(auth('recycler')).send({ text: 'hello there' }).expect(404);

    await request(app).post(`/api/disputes/${disputeId}/messages`).set(auth('buyer')).send({ text: 'Can you take them back?' }).expect(201);
    const chat = await request(app).post(`/api/disputes/${disputeId}/messages`).set(auth('company')).send({ text: 'Send me photos please.' }).expect(201);
    expect(chat.body.dispute.messages).toHaveLength(2);
    await request(app).post(`/api/disputes/${disputeId}/messages`).set(auth('recycler')).send({ text: 'hi' }).expect(404);
    await request(app).post(`/api/disputes/${disputeId}/messages`).set(auth('buyer')).send({ text: '   ' }).expect(400);
  });

  test('an admin takes the case and joins the chat', async () => {
    await request(app).post(`/api/disputes/${disputeId}/review`).set(auth('company')).expect(403);
    const r = await request(app).post(`/api/disputes/${disputeId}/review`).set(auth('admin')).expect(200);
    expect(r.body.dispute.status).toBe('under_review');
    expect(r.body.dispute.assignedTo.name).toBe('admin user');
    const m = await request(app).post(`/api/disputes/${disputeId}/messages`).set(auth('admin')).send({ text: 'Please upload the delivery note.' }).expect(201);
    expect(m.body.dispute.messages.at(-1).role).toBe('Admin');
    const buyer = await User.findOne({ email: 'buyer@test.dev' });
    const n = await Notification.find({ user: buyer._id, kind: 'dispute' }).lean();
    expect(n.length).toBeGreaterThanOrEqual(3); // company evidence + company message + review/admin message
  });

  test('the assistant reports open disputes but explains how they work from the guide', async () => {
    const open = await request(app).post('/api/ai/agent').set(auth('admin')).send({ message: 'any open disputes?' }).expect(200);
    expect(open.body.intent.tool).toBe('my_disputes');
    expect(open.body.reply).toMatch(/1 open dispute/);
    expect(open.body.reply).toMatch(/Resolver/);
    const how = await request(app).post('/api/ai/agent').set(auth('buyer')).send({ message: 'how does a dispute work?' }).expect(200);
    expect(how.body.source).toBe('guide');
    expect(how.body.reply).toMatch(/evidence/i);
    const none = await request(app).post('/api/ai/agent').set(auth('recycler')).send({ message: 'do I have any disputes' }).expect(200);
    expect(none.body.reply).toMatch(/No open disputes/);
  });

  test('a decision needs a reason, a refund reverses the trade, and a closed dispute is read-only', async () => {
    await request(app).post(`/api/disputes/${disputeId}/decision`).set(auth('company')).send({ outcome: 'refund', reason: 'I decide this myself' }).expect(403);
    await request(app).post(`/api/disputes/${disputeId}/decision`).set(auth('admin')).send({ outcome: 'maybe', reason: 'A long enough reason' }).expect(400);
    await request(app).post(`/api/disputes/${disputeId}/decision`).set(auth('admin')).send({ outcome: 'refund', reason: 'short' }).expect(400);

    expect((await Listing.findById(listingId)).status).toBe('reserved');
    const r = await request(app).post(`/api/disputes/${disputeId}/decision`).set(auth('admin'))
      .send({ outcome: 'refund', reason: 'Photos show the bricks were cracked before dispatch.' }).expect(200);
    const dispute = r.body.dispute;
    expect(dispute.status).toBe('resolved');
    expect(dispute.decision).toMatchObject({ outcome: 'refund', decidedByName: 'admin user' });
    expect(dispute.decision.effect).toMatch(/back on the market/);
    expect(dispute.history.map((h) => h.action)).toEqual(['raised', 'evidence', 'evidence', 'review', 'decision']);

    expect((await Request.findById(requestId)).status).toBe('cancelled');
    expect((await Listing.findById(listingId)).status).toBe('active');

    await request(app).post(`/api/disputes/${disputeId}/messages`).set(auth('buyer')).send({ text: 'Thanks' }).expect(409);
    await request(app).post(`/api/disputes/${disputeId}/decision`).set(auth('admin')).send({ outcome: 'reject', reason: 'Changing my mind later' }).expect(409);

    const buyer = await User.findOne({ email: 'buyer@test.dev' });
    expect(await Notification.countDocuments({ user: buyer._id, title: /Dispute decided: Refund/ })).toBe(1);

    const stats = await request(app).get('/api/disputes/stats').set(auth('admin')).expect(200);
    expect(stats.body).toMatchObject({ total: 1, byStatus: { resolved: 1 }, byOutcome: { refund: 1 } });
    expect(stats.body.avgResolutionHours).not.toBeNull();
  });

  test('a cancelled request can be disputed again, and only the person who raised it can withdraw', async () => {
    const r = await raise('company', { category: 'pricing', subject: 'Late cancel', description: 'The buyer cancelled after agreeing a price.' }).expect(201);
    const id = r.body.dispute._id;
    await request(app).post(`/api/disputes/${id}/withdraw`).set(auth('buyer')).expect(403);
    const w = await request(app).post(`/api/disputes/${id}/withdraw`).set(auth('company')).expect(200);
    expect(w.body.dispute.status).toBe('withdrawn');
    await request(app).post(`/api/disputes/${id}/withdraw`).set(auth('company')).expect(409);
    const closed = await request(app).get('/api/disputes?status=closed').set(auth('admin')).expect(200);
    expect(closed.body.items).toHaveLength(2);
    const open = await request(app).get('/api/disputes?status=open').set(auth('admin')).expect(200);
    expect(open.body.items).toHaveLength(0);
  });
});
