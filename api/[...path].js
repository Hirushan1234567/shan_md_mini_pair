import crypto from "crypto";
import { aux, cleanNumber, validNumber, rateLimited, clientIp } from "./_lib/db.js";
import { HttpError, sign, verify, bearer, isAdmin, adminPasswordOk } from "./_lib/auth.js";
import { issueOtp, checkOtp } from "./_lib/otp.js";
import { senderInfo } from "./_lib/wa-sender.js";
import { issueKey, checkKey } from "./_lib/botkey.js";
import {
  DAY, GAME_DAILY_CAP, WELCOME, REF_BONUS, REF_REWARD,
  CATALOG, TASKS, DEFAULT_SETTINGS
} from "./_lib/config.js";

const SESSION_TTL = 30 * DAY;
const today = () => new Date().toISOString().slice(0, 10);
const str = (v, n) => String(v ?? "").trim().slice(0, n);
const users = async () => aux("users");

/* ---------- helpers ---------- */

async function me(req) {
  const p = verify(bearer(req));
  if (!p?.n) throw new HttpError(401, "Please login first.");
  const u = await (await users()).findOne({ _id: p.n });
  if (!u) throw new HttpError(401, "Please login first.");
  if (u.banned) throw new HttpError(403, "This account is banned.");
  return u;
}
function needAdmin(req) { if (!isAdmin(req)) throw new HttpError(403, "Admin only."); }

const entry = (type, amt, note) => ({ t: Date.now(), type, amt, note });
const logPush = msg => ({ log: { $each: [{ t: Date.now(), msg }], $position: 0, $slice: 60 } });

async function credit(u, amt, note, extra = {}) {
  await (await users()).updateOne({ _id: u._id }, {
    $inc: { coins: amt, earned: amt, ...extra },
    $push: { tx: { $each: [entry("earn", amt, note)], $position: 0, $slice: 60 } }
  });
}
async function debit(u, amt, note) {
  const r = await (await users()).updateOne({ _id: u._id, coins: { $gte: amt } }, {
    $inc: { coins: -amt, spent: amt },
    $push: { tx: { $each: [entry("spend", amt, note)], $position: 0, $slice: 60 } }
  });
  if (!r.modifiedCount) throw new HttpError(400, "Not enough coins.");
}
async function note(u, msg) { await (await users()).updateOne({ _id: u._id }, { $push: logPush(msg) }); }

const pub = u => ({
  name: u.name, number: u._id, coins: u.coins, joined: u.joined,
  vip: (u.mine || []).includes("vip")
});

const owned = (u, id) => id === "boost" ? Date.now() < (u.boostUntil || 0) : (u.mine || []).includes(id);

/* ---------- routes ---------- */

const R = {};

// ===== Auth (WhatsApp OTP only) =====
R["POST /auth/otp"] = async (req, b) => {
  const number = cleanNumber(b.number);
  if (!validNumber(number)) throw new HttpError(400, "Invalid number. Use country code without + or 0.");
  if (await rateLimited(`otpip:${clientIp(req)}`, 12, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts. Please wait a few minutes.");
  await checkKey(number, b.key); // Bot Key නැතුව OTP යවන්නේ නෑ
  const u = await (await users()).findOne({ _id: number });
  if (u?.banned) throw new HttpError(403, "This account is banned.");
  const r = await issueOtp(number, "login");
  return { ok: true, isNew: !u, ...r };
};

// Key අමතක නම්: අලුත් key එකක් user ගේ WhatsApp එකටම යවනවා (පරණ එක අවලංගු)
R["POST /auth/key-resend"] = async (req, b) => {
  const number = cleanNumber(b.number);
  if (!validNumber(number)) throw new HttpError(400, "Invalid number.");
  if (await rateLimited(`keyip:${clientIp(req)}`, 5, 60 * 60 * 1000)) throw new HttpError(429, "Too many requests. Try again later.");
  if (await rateLimited(`keysend:${number}`, 3, 60 * 60 * 1000)) throw new HttpError(429, "Key already sent recently. Check your WhatsApp.");
  const has = await (await aux("bot_keys")).findOne({ _id: number }, { projection: { _id: 1 } });
  if (!has) throw new HttpError(404, "No bot linked to this number yet. Link your bot on the home page first.");
  try { await issueKey(number); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, "Could not send the key. Try again."); }
  return { ok: true };
};

R["POST /auth/verify"] = async (req, b) => {
  const number = cleanNumber(b.number);
  if (!validNumber(number)) throw new HttpError(400, "Invalid number.");
  await checkOtp(number, "login", b.otp);

  const col = await users();
  let u = await col.findOne({ _id: number });
  if (u?.banned) throw new HttpError(403, "This account is banned.");

  if (!u) {
    const ref = str(b.ref, 12).toUpperCase();
    const referrer = ref ? await col.findOne({ code: ref }) : null;
    const bonus = referrer && referrer._id !== number ? REF_BONUS : 0;
    const start = WELCOME + bonus;
    u = {
      _id: number,
      name: str(b.name, 30) || `User ${number.slice(-4)}`,
      coins: start, earned: start, spent: 0,
      last: 0, streak: 0, joined: Date.now(),
      code: "SHAN-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
      refs: 0, mine: [], boostUntil: 0, redeemed: [], tk: {}, g: { day: "", earned: 0 },
      settings: { ...DEFAULT_SETTINGS }, botStatus: "offline", keys: [],
      tx: [entry("earn", start, bonus ? "Welcome bonus + promo code" : "Welcome bonus")],
      log: [{ t: Date.now(), msg: "Account created" }]
    };
    await col.insertOne(u);
    if (bonus) await credit(referrer, REF_REWARD, "Friend joined with your promo code", { refs: 1 });
  } else {
    await note(u, "Logged in");
  }
  return { token: sign({ n: number }, SESSION_TTL), user: pub(u) };
};

// ===== Account / coins =====
R["GET /me"] = async req => pub(await me(req));

R["GET /coins"] = async req => {
  const u = await me(req);
  const g = u.g?.day === today() ? u.g.earned : 0;
  return {
    balance: u.coins, earned: u.earned, spent: u.spent, tx: u.tx || [],
    canDaily: Date.now() - (u.last || 0) > DAY,
    code: u.code, refs: u.refs || 0, refReward: REF_REWARD, refBonus: REF_BONUS,
    gInfo: `Game coins today: ${g}/${GAME_DAILY_CAP}`
  };
};

R["POST /coins/daily"] = async req => {
  const u = await me(req);
  const now = Date.now();
  const streak = now - (u.last || 0) < 2 * DAY ? (u.streak || 0) + 1 : 1;
  const base = 15 + (streak % 7 === 0 ? 40 : 0);
  const r = base * (now < (u.boostUntil || 0) ? 2 : 1);
  const res = await (await users()).updateOne({ _id: u._id, last: { $lte: now - DAY } }, {
    $set: { last: now, streak },
    $inc: { coins: r, earned: r },
    $push: { tx: { $each: [entry("earn", r, `Daily reward (day ${streak})`)], $position: 0, $slice: 60 }, ...logPush(`Daily reward +${r}`) }
  });
  if (!res.modifiedCount) throw new HttpError(400, "Already claimed. Come back later.");
  return { balance: u.coins + r };
};

R["POST /coins/redeem"] = async (req, b) => {
  const u = await me(req);
  const code = str(b.code, 20).toUpperCase();
  const c = await (await aux("coupons")).findOneAndUpdate(
    { _id: code, by: { $ne: u._id }, $expr: { $lt: ["$used", "$uses"] } },
    { $inc: { used: 1 }, $push: { by: u._id } },
    { returnDocument: "before" }
  );
  const doc = c?.value !== undefined ? c.value : c; // driver version differences
  if (!doc) throw new HttpError(400, "Invalid, used or expired code.");
  await credit(u, doc.coins, `Coupon ${code}`);
  await note(u, `Redeemed coupon ${code}`);
  return { coins: doc.coins };
};

R["POST /coins/send"] = async (req, b) => {
  const u = await me(req);
  const to = cleanNumber(b.number), a = Math.floor(+b.amount);
  if (!validNumber(to)) throw new HttpError(400, "Invalid number.");
  if (to === u._id) throw new HttpError(400, "You cannot send to yourself.");
  if (!(a >= 10 && a <= 500)) throw new HttpError(400, "Amount must be 10-500.");
  if (u.coins < a) throw new HttpError(400, "Not enough coins.");
  if (!(await (await users()).findOne({ _id: to }, { projection: { _id: 1 } }))) throw new HttpError(400, "That number has no SHAN account yet.");
  await issueOtp(u._id, "send", { to, a });
  return { otpRequired: true, txId: "send" };
};

R["POST /coins/send/confirm"] = async (req, b) => {
  const u = await me(req);
  const { to, a } = (await checkOtp(u._id, "send", b.otp)) || {};
  const col = await users();
  const rec = await col.findOne({ _id: to });
  if (!rec || rec.banned) throw new HttpError(400, "Receiver not found.");
  await debit(u, a, `Sent to +${to}`);
  await credit(rec, a, `Received from +${u._id}`);
  await note(u, `Sent ${a} coins to +${to}`);
  return { ok: 1 };
};

// ===== Shop =====
R["GET /plugins"] = async req => {
  const u = await me(req);
  return CATALOG.map(c => ({ ...c, owned: owned(u, c.id) }));
};

R["POST /plugins/buy"] = async (req, b) => {
  const u = await me(req);
  const c = CATALOG.find(x => x.id === b.id);
  if (!c) throw new HttpError(404, "Plugin not found.");
  if (owned(u, c.id)) throw new HttpError(400, "Already active/owned.");
  if (u.coins < c.price) throw new HttpError(400, "Not enough coins.");
  await issueOtp(u._id, "purchase", { id: c.id });
  return { otpRequired: true, txId: c.id };
};

R["POST /plugins/confirm"] = async (req, b) => {
  const u = await me(req);
  const data = await checkOtp(u._id, "purchase", b.otp);
  const c = CATALOG.find(x => x.id === data?.id && x.id === b.txId);
  if (!c) throw new HttpError(400, "Purchase does not match the OTP.");
  const fresh = await (await users()).findOne({ _id: u._id });
  if (owned(fresh, c.id)) throw new HttpError(400, "Already active/owned.");
  await debit(u, c.price, `Bought ${c.name}`);
  await (await users()).updateOne({ _id: u._id },
    c.id === "boost" ? { $set: { boostUntil: Date.now() + 7 * DAY }, $push: logPush(`Purchased: ${c.name}`) }
                     : { $addToSet: { mine: c.id }, $push: logPush(`Purchased: ${c.name}`) });
  return { ok: 1 };
};

// ===== Games =====
R["POST /games/start"] = async (req, b) => {
  const u = await me(req);
  if (!["snake", "g2048", "memory"].includes(b.game)) throw new HttpError(400, "Unknown game.");
  const sid = crypto.randomBytes(6).toString("hex");
  await (await users()).updateOne({ _id: u._id }, { $set: { gs: { game: b.game, t0: Date.now(), sid } } });
  return { sid };
};

R["POST /games/finish"] = async (req, b) => {
  const u = await me(req);
  const prev = await (await users()).findOneAndUpdate({ _id: u._id, "gs.sid": String(b.sid) }, { $unset: { gs: "" } }, { returnDocument: "before" });
  const G = (prev?.value !== undefined ? prev.value : prev)?.gs;
  if (!G) throw new HttpError(400, "No active game.");
  const sec = (Date.now() - G.t0) / 1000, sc = +b.score || 0;
  let r = 0;
  if (G.game === "snake") { if (sec >= sc * 0.6) r = Math.min(10, Math.floor(sc / 3)); }
  else if (G.game === "g2048") { if (sec >= sc / 8) r = sc >= 2048 ? 15 : sc >= 1024 ? 12 : sc >= 512 ? 8 : sc >= 256 ? 5 : sc >= 128 ? 2 : 0; }
  else if (sec >= 8) r = Math.min(6, Math.floor(sc / 20));

  const gDay = u.g?.day === today() ? u.g.earned : 0;
  const a = Math.max(0, Math.min(r, GAME_DAILY_CAP - gDay));
  if (a > 0) {
    await credit(u, a, `Game reward: ${G.game}`);
    await (await users()).updateOne({ _id: u._id }, { $set: { g: { day: today(), earned: gDay + a } } });
  }
  await note(u, `Played ${G.game} (score ${sc})`);
  return { msg: a ? `🎉 +${a} coins!` : r ? "Daily game coin limit reached." : "No coins this time — try again!" };
};

// ===== Tasks / announce / leaderboard =====
R["GET /announce"] = async () => {
  const d = await (await aux("meta")).findOne({ _id: "announce" });
  return { text: d?.text || "" };
};

R["GET /leaderboard"] = async () => {
  const l = await (await users()).find({ banned: { $ne: true } }, { projection: { name: 1, earned: 1 } }).sort({ earned: -1 }).limit(10).toArray();
  return l.map(x => ({ name: x.name, earned: x.earned }));
};

R["GET /tasks"] = async req => {
  const u = await me(req);
  return TASKS.map(t => ({ ...t, done: t.type === "once" ? !!u.tk?.[t.id] : u.tk?.[t.id] === today() }));
};

R["POST /tasks/claim"] = async (req, b) => {
  const u = await me(req);
  const t = TASKS.find(x => x.id === b.id);
  if (!t) throw new HttpError(404, "Unknown task.");
  const val = t.type === "once" ? 1 : today();
  if (u.tk?.[t.id] === val) throw new HttpError(400, "Already claimed.");
  if (t.id === "cmd" && u.botStatus !== "online") throw new HttpError(400, "Start your bot first (Bot tab).");
  const r = await (await users()).updateOne({ _id: u._id, [`tk.${t.id}`]: { $ne: val } }, { $set: { [`tk.${t.id}`]: val } });
  if (!r.modifiedCount) throw new HttpError(400, "Already claimed.");
  await credit(u, t.reward, `Task: ${t.name}`);
  await note(u, `Task done: ${t.name}`);
  return { ok: 1 };
};

// ===== Bot settings / control / keys / activity =====
R["GET /settings"] = async req => {
  const u = await me(req);
  return { ...DEFAULT_SETTINGS, ...(u.settings || {}), canImg: (u.mine || []).includes("wimg") };
};

R["PUT /settings"] = async (req, b) => {
  const u = await me(req);
  const s = {
    prefix: str(b.prefix || ".", 3), mode: b.mode === "private" ? "private" : "public",
    name: str(b.name || "SHAN MINI BOT", 30), seen: !!b.seen, typing: !!b.typing,
    img: (u.mine || []).includes("wimg") ? str(b.img, 300) : ""
  };
  await (await users()).updateOne({ _id: u._id }, { $set: { settings: s }, $push: logPush("Settings updated") });
  return s;
};

R["GET /bot"] = async req => ({ status: (await me(req)).botStatus || "offline" });

R["POST /bot"] = async (req, b) => {
  const u = await me(req);
  const status = b.action === "start" ? "online" : "offline";
  await (await users()).updateOne({ _id: u._id }, { $set: { botStatus: status }, $push: logPush(`Bot ${status === "online" ? "started" : "stopped"}`) });
  return { status };
};

R["GET /keys"] = async req => {
  const u = await me(req);
  return (u.keys || []).map(k => ({ id: k.id, name: k.name, key: k.preview, created: k.created }));
};

R["POST /keys"] = async (req, b) => {
  const u = await me(req);
  if ((u.keys || []).length >= 5) throw new HttpError(400, "Max 5 API keys. Revoke one first.");
  const key = "shan_" + crypto.randomBytes(16).toString("hex");
  const k = { id: crypto.randomBytes(5).toString("hex"), name: str(b.name || "key", 30), preview: key.slice(0, 9) + "••••••••", hash: crypto.createHash("sha256").update(key).digest("hex"), created: Date.now() };
  await (await users()).updateOne({ _id: u._id }, { $push: { keys: k, ...logPush("API key generated") } });
  return { key }; // full key එක පෙන්නන්නේ මේ එක පාරයි
};

R["DELETE /keys"] = async (req, b, q) => {
  const u = await me(req);
  await (await users()).updateOne({ _id: u._id }, { $pull: { keys: { id: String(q.get("id")) } }, $push: logPush("API key revoked") });
  return { ok: 1 };
};

R["GET /activity"] = async req => (await me(req)).log || [];

// ===== Comments (public read, rate-limited post) =====
R["GET /comments"] = async () =>
  (await (await aux("comments")).find({}).sort({ t: -1 }).limit(50).toArray()).map(c => ({ id: String(c._id), name: c.name, msg: c.msg, t: c.t }));

R["POST /comments"] = async (req, b) => {
  const msg = str(b.msg, 300);
  if (!msg) throw new HttpError(400, "Write a comment first.");
  let name = str(b.name, 30) || "Guest";
  if (bearer(req)) { try { name = (await me(req)).name; } catch {} }
  if (await rateLimited(`cm:${clientIp(req)}`, 5, 10 * 60 * 1000)) throw new HttpError(429, "Too many comments. Try again later.");
  await (await aux("comments")).insertOne({ name, msg, t: Date.now() });
  return { ok: 1 };
};

R["DELETE /comments"] = async (req, b, q) => {
  needAdmin(req);
  const { ObjectId } = await import("mongodb");
  const id = String(q.get("id"));
  await (await aux("comments")).deleteOne({ _id: ObjectId.isValid(id) ? new ObjectId(id) : id });
  return { ok: 1 };
};

// ===== Admin =====
R["POST /admin/login"] = async (req, b) => {
  if (await rateLimited(`adm:${clientIp(req)}`, 8, 10 * 60 * 1000)) throw new HttpError(429, "Too many attempts.");
  if (!adminPasswordOk(b.password)) throw new HttpError(401, "Wrong admin password.");
  return { token: sign({ adm: 1 }, 2 * 60 * 60 * 1000) };
};

R["GET /admin/stats"] = async req => {
  needAdmin(req);
  const col = await users();
  const agg = await col.aggregate([{ $group: { _id: null, coins: { $sum: "$coins" }, n: { $sum: 1 }, sold: { $sum: { $size: { $ifNull: ["$mine", []] } } } } }]).toArray();
  return { users: agg[0]?.n || 0, coins: agg[0]?.coins || 0, sold: agg[0]?.sold || 0, comments: await (await aux("comments")).countDocuments() };
};

R["GET /admin/users"] = async req => {
  needAdmin(req);
  return (await (await users()).find({}, { projection: { name: 1, coins: 1, banned: 1 } }).sort({ joined: -1 }).limit(100).toArray())
    .map(x => ({ name: x.name, number: x._id, coins: x.coins, banned: !!x.banned }));
};

R["POST /admin/coins"] = async (req, b) => {
  needAdmin(req);
  const n = cleanNumber(b.number), amt = Math.trunc(+b.amount);
  if (!amt) throw new HttpError(400, "Enter an amount.");
  const r = await (await users()).updateOne({ _id: n, ...(amt < 0 ? { coins: { $gte: -amt } } : {}) }, {
    $inc: { coins: amt, ...(amt > 0 ? { earned: amt } : {}) },
    $push: { tx: { $each: [entry(amt > 0 ? "earn" : "spend", Math.abs(amt), "Admin adjustment")], $position: 0, $slice: 60 } }
  });
  if (!r.matchedCount) throw new HttpError(400, "User not found or balance too low.");
  return { ok: 1 };
};

R["POST /admin/ban"] = async (req, b) => {
  needAdmin(req);
  await (await users()).updateOne({ _id: cleanNumber(b.number) }, { $set: { banned: !!b.ban } });
  return { ok: 1 };
};

R["POST /admin/announce"] = async (req, b) => {
  needAdmin(req);
  await (await aux("meta")).updateOne({ _id: "announce" }, { $set: { text: str(b.text, 150) } }, { upsert: true });
  return { ok: 1 };
};

R["POST /admin/coupons"] = async (req, b) => {
  needAdmin(req);
  const code = str(b.code, 20).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const coins = Math.floor(+b.coins), uses = Math.floor(+b.uses);
  if (!code || !(coins > 0) || !(uses > 0)) throw new HttpError(400, "Enter code, coins and max uses.");
  await (await aux("coupons")).updateOne({ _id: code }, { $set: { coins, uses }, $setOnInsert: { used: 0, by: [] } }, { upsert: true });
  return { ok: 1 };
};

R["GET /admin/sender"] = async req => { needAdmin(req); return senderInfo(); };

/* ---------- entry ---------- */

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
    const fn = R[`${req.method} ${path}`];
    if (!fn) return res.status(404).json({ error: "Unknown route." });
    const out = await fn(req, req.body && typeof req.body === "object" ? req.body : {}, url.searchParams);
    res.status(200).json(out ?? { ok: 1 });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error("api error:", e?.message || e);
    res.status(500).json({ error: "Server error. Try again." });
  }
}
