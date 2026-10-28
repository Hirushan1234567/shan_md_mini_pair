import { MongoClient } from "mongodb";

const COLLECTION = process.env.PAIR_SITE_COLLECTION || "pair_sessions";

// Invocations අතරේ connection එක reuse කරනවා
let clientPromise = globalThis.__shanMongo;

export async function getDb() {
  if (!process.env.MONGODB_URI && !globalThis.__shanMongo) {
    throw new Error("MONGODB_URI is not set");
  }

  if (!clientPromise) {
    clientPromise = globalThis.__shanMongo = new MongoClient(
      process.env.MONGODB_URI,
      { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 }
    ).connect();
  }

  const client = await clientPromise;
  return client.db();
}

export async function sessions() {
  return (await getDb()).collection(COLLECTION);
}

export async function aux(name) {
  return (await getDb()).collection(name);
}

export function cleanNumber(v = "") {
  return String(v).replace(/\D/g, "");
}

export function validNumber(n) {
  return /^[1-9]\d{7,14}$/.test(n);
}

/** Fixed-window rate limit (MongoDB එකේ, serverless වල memory share වෙන්නේ නැති නිසා). true = limit ඉක්මවා. */
export async function rateLimited(key, max, windowMs) {
  const col = await aux("pair_ratelimit");
  const now = Date.now();
  const doc = await col.findOne({ _id: key });

  if (!doc || now - doc.start > windowMs) {
    await col.updateOne({ _id: key }, { $set: { start: now, count: 1 } }, { upsert: true });
    return false;
  }
  if (doc.count >= max) return true;
  await col.updateOne({ _id: key }, { $inc: { count: 1 } });
  return false;
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress || "unknown";
}

/** Mongo-backed Baileys auth state (OTP sender session එක සඳහා). */
export async function mongoAuthState(col, baileys) {
  const { initAuthCreds, BufferJSON, proto } = baileys;
  const write = (data, id) =>
    col.replaceOne({ _id: id }, { _id: id, v: JSON.stringify(data, BufferJSON.replacer) }, { upsert: true });
  const read = async id => {
    const d = await col.findOne({ _id: id });
    return d ? JSON.parse(d.v, BufferJSON.reviver) : null;
  };

  const creds = (await read("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async id => {
            let v = await read(`${type}-${id}`);
            if (type === "app-state-sync-key" && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            data[id] = v;
          }));
          return data;
        },
        set: async data => {
          const tasks = [];
          for (const cat in data) {
            for (const id in data[cat]) {
              const v = data[cat][id];
              tasks.push(v ? write(v, `${cat}-${id}`) : col.deleteOne({ _id: `${cat}-${id}` }));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => write(creds, "creds")
  };
}
