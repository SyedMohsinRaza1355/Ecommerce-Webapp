// Weekly backup: writes every store database and the platform database as one JSON-lines file.
// Usage: MONGODB_URI=... PLATFORM_DB_NAME=platform node scripts/backup.mjs backup.ndjson
// The file contains personal data and password hashes: the workflow encrypts it before storing it.
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import mongodb from "mongodb";
const { MongoClient, BSON } = mongodb;
const { EJSON } = BSON;

const out = process.argv[2] ?? "backup.ndjson";
const uri = process.env.MONGODB_URI;
const platform = process.env.PLATFORM_DB_NAME || "platform";
if (!uri) { console.error("MONGODB_URI is not set"); process.exit(1); }

const SKIP = new Set(["rate_limits", "carts", "customer_tokens"]); // short-lived data, not worth keeping
const client = new MongoClient(uri);
await client.connect();
const names = (await client.db().admin().listDatabases()).databases.map((d) => d.name).filter((n) => n === platform || n.startsWith("tenant_"));
const ws = createWriteStream(out);
let docs = 0;
for (const name of names) {
  const db = client.db(name);
  for (const { name: coll } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (SKIP.has(coll) || coll.startsWith("system.")) continue;
    for await (const doc of db.collection(coll).find({})) {
      if (!ws.write(EJSON.stringify({ db: name, coll, doc }, { relaxed: false }) + "\n")) await once(ws, "drain");
      docs++;
    }
  }
}
ws.end();
await once(ws, "finish");
await client.close();
console.log(`Backed up ${docs} documents from ${names.length} databases to ${out}`);
