import crypto from "crypto";
import { aux, rateLimited } from "./db.js";
import { HttpError, hmac, safeEqual } from "./auth.js";
import { sendWhatsApp } from "./wa-sender.js";

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const part = () => Array.from(crypto.randomBytes(4), b => ALPHA[b % ALPHA.length]).join("");
export const normKey = k => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashKey = (number, key) => hmac(`key:${number}:${normKey(key)}`);

/** අලුත් Bot Key එකක් හදලා (කලින් එක අවලංගු වෙනවා), user ගේ WhatsApp එකට bot එකෙන් යවනවා. */
export async function issueKey(number) {
  const key = `SHAN-${part()}-${part()}`;
  const col = await aux("bot_keys");
  const old = await col.findOne({ _id: number });
  await col.replaceOne({ _id: number }, { _id: number, h: hashKey(number, key), created: Date.now() }, { upsert: true });
  try {
    await sendWhatsApp(number,
      `🔑 *SHAN MINI BOT*\n\nYour Bot Key: *${key}*\n\n` +
      `Use it with your number to log in to the SHAN Coins dashboard. Keep it private.`);
  } catch (e) {
    // යවන්න බැරි වුණොත් කලින් key එකම තියාගන්නවා
    if (old) await col.replaceOne({ _id: number }, old); else await col.deleteOne({ _id: number });
    throw e;
  }
}

export async function checkKey(number, key) {
  if (await rateLimited(`keytry:${number}`, 8, 10 * 60 * 1000)) throw new HttpError(429, "Too many wrong keys. Try again in 10 minutes.");
  const doc = await (await aux("bot_keys")).findOne({ _id: number });
  if (!doc) throw new HttpError(404, "No Bot Key for this number yet. Link your bot on the home page first. The key arrives on your WhatsApp.");
  if (!normKey(key) || !safeEqual(hashKey(number, key), doc.h)) throw new HttpError(400, "Wrong Bot Key.");
}
