// Brings an existing database up to date. Safe to run any number of times and
// never deletes or rewrites existing data:
//   1. creates the new collections and indexes (impact records, conversations,
//      one-open-request-per-buyer-and-listing),
//   2. writes a CO2 impact record for every trade that was completed before
//      records existed (exactly one per sold listing).
//
//   npm run migrate
const mongoose = require('mongoose');
const config = require('../src/config');
const {
  ImpactRecord, Conversation, Request, Listing,
} = require('../src/models');
const { backfillImpact } = require('../src/lib/impact');

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
  for (const model of [ImpactRecord, Conversation, Request, Listing]) {
    try {
      await model.createIndexes();
      console.log(`indexes ok: ${model.collection.name}`);
    } catch (err) {
      // e.g. old duplicate open requests block the new unique index: report it, change nothing
      console.warn(`index problem on ${model.collection.name}: ${err.message}`);
    }
  }
  const created = await backfillImpact();
  const total = await ImpactRecord.countDocuments();
  console.log(`impact records created now: ${created}; total records: ${total}`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
