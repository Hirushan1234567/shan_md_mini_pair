import crypto from "crypto";
import { aux, rateLimited } from "./db.js";
import { HttpError, hmac, safeEqual } from "./auth.js";
import { sendWhatsApp } from "./wa-sender.js";

const TTL = 5 * 60 * 1000;
const COOLDOWN = 45 * 1000;

const LABEL = {
  login: "login",
  purchase: "plugin purchase",
  send: "coin transfer"
};

/** 6-digit OTP හදලා, bot එකෙන් user ගේ WhatsApp number එකට යවනවා. */
export async function issueOtp(number, purpose, data = null) {
  const col = await aux("otps");
  const now = Date.now();
  const old = await col.findOne({ _id: number });

  if (old && old.purpose === purpose && now - old.sent < COOLDOWN) {
    const wait = Math.ceil((COOLDOWN - (now - old.sent)) / 1000);
    throw new HttpError(429, `Wait ${wait}s before requesting another OTP.`);
  }
  if (await rateLimited(`otp:${number}`, 6, 60 * 60 * 1000)) {
    throw new HttpError(429, "Too many OTP requests for this number. Try again in an hour.");
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await col.replaceOne(
    { _id: number },
    { _id: number, h: hmac(`${number}:${purpose}:${code}`), purpose, data, exp: now + TTL, tries: 0, sent: now },
    { upsert: true }
  );

  const text =
    `🔐 *SHAN MINI BOT*\n\n` +
    `Your ${LABEL[purpose] || "verification"} OTP: *${code}*\n\n` +
    `Valid for 5 minutes. Never share this code with anyone.`;

  try {
    await sendWhatsApp(number, text);
  } catch (e) {
    await col.deleteOne({ _id: number });
    if (e instanceof HttpError) throw e;
    console.error("otp send failed:", e?.message || e);
    throw new HttpError(502, "Could not send the OTP. Try again.");
  }
  return { cooldown: COOLDOWN / 1000, ttl: TTL / 1000 };
}

/** OTP එක check කරනවා. හරි නම් data ආපහු දෙනවා (එක පාරයි පාවිච්චි කරන්න පුළුවන්). */
export async function checkOtp(number, purpose, code) {
  const col = await aux("otps");
  const doc = await col.findOne({ _id: number });
  if (!doc || doc.purpose !== purpose || Date.now() > doc.exp) {
    throw new HttpError(400, "OTP expired. Request a new one.");
  }
  if (doc.tries >= 5) {
    await col.deleteOne({ _id: number });
    throw new HttpError(429, "Too many wrong attempts. Request a new OTP.");
  }
  const ok = safeEqual(hmac(`${number}:${purpose}:${String(code || "").trim()}`), doc.h);
  if (!ok) {
    await col.updateOne({ _id: number }, { $inc: { tries: 1 } });
    throw new HttpError(400, "Wrong OTP.");
  }
  await col.deleteOne({ _id: number });
  return doc.data;
}
