// Restores a backup made by backup.mjs into NEW databases (names get a prefix), never over live ones.
// Usage: MONGODB_URI=... node scripts/restore.mjs backup.ndjson [prefix]   (default prefix: restored_)
// After checking the data, copy what you need or rename databases in Atlas.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import mongodb from "mongodb";
const { MongoClient, BSON } = mongodb;
const { EJSON } = BSON;

const file = process.argv[2];
const prefix = process.argv[3] ?? "restored_";
if (!file || !process.env.MONGODB_URI) { console.error("Usage: MONGODB_URI=... node scripts/restore.mjs backup.ndjson [prefix]"); process.exit(1); }
if (!prefix || /[\/\. "$]/.test(prefix)) { console.error("Choose a simple prefix such as restored_"); process.exit(1); }

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
let n = 0;
const batch = new Map();
const flush = async () => {
  for (const [key, docs] of batch) { const [db, coll] = key.split("\u0000"); if (docs.length) await client.db(prefix + db).collection(coll).insertMany(docs, { ordered: false }).catch(() => undefined); }
  batch.clear();
};
for await (const line of createInterface({ input: createReadStream(file) })) {
  if (!line.trim()) continue;
  const { db, coll, doc } = EJSON.parse(line, { relaxed: false });
  const key = `${db}\u0000${coll}`;
  if (!batch.has(key)) batch.set(key, []);
  batch.get(key).push(doc);
  if (++n % 500 === 0) await flush();
}
await flush();
await client.close();
console.log(`Restored ${n} documents into databases starting with "${prefix}"`);
