import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import { aux, mongoAuthState } from "./db.js";
import { HttpError } from "./auth.js";

const makeWASocket =
  typeof baileys.default === "function" ? baileys.default : baileys.makeWASocket;
const { DisconnectReason, fetchLatestWaWebVersion } = baileys;

const logger = pino({ level: "silent" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const SENDER_COLLECTION = "otp_sender";

async function waVersion() {
  if (globalThis.__waVer) return globalThis.__waVer;
  try {
    const l = await fetchLatestWaWebVersion();
    if (Array.isArray(l?.version) && l.version.length === 3) return (globalThis.__waVer = l.version);
  } catch {}
  return undefined; // Baileys default
}

// එකම sender session එක එකවර sockets දෙකකින් පාවිච්චි කරන්න බැහැ -> lock
async function lock() {
  const col = await aux("otp_sender_lock");
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    const now = Date.now();
    try {
      await col.updateOne({ _id: "lock", exp: { $lt: now } }, { $set: { exp: now + 40000 } }, { upsert: true });
      return;
    } catch (e) {
      if (e?.code !== 11000) throw e;
      await sleep(600);
    }
  }
  throw new HttpError(503, "OTP service is busy. Try again in a few seconds.");
}
async function unlock() {
  try { await (await aux("otp_sender_lock")).deleteOne({ _id: "lock" }); } catch {}
}

export async function senderInfo() {
  const meta = await (await aux("meta")).findOne({ _id: "otp_sender" });
  return { linked: !!meta?.number, number: meta?.number || null };
}

/** Bot (sender) number එකෙන් WhatsApp text message එකක් යවනවා. */
export async function sendWhatsApp(number, text) {
  if (globalThis.__fakeSender) return globalThis.__fakeSender(number, text); // tests

  const col = await aux(SENDER_COLLECTION);
  await lock();
  let sock;
  try {
    const { state, saveCreds } = await mongoAuthState(col, baileys);
    if (!state.creds.registered) throw new HttpError(503, "OTP sender is not linked yet. Admin: open /sender and link the bot number.");

    let pending = Promise.resolve();
    sock = makeWASocket({
      version: await waVersion(),
      auth: state,
      logger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 20000,
      defaultQueryTimeoutMs: 20000,
      generateHighQualityLinkPreview: false,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
    });
    sock.ev.on("creds.update", () => { pending = pending.then(saveCreds).catch(() => {}); });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new HttpError(502, "Could not reach WhatsApp. Try again.")), 22000);
      sock.ev.on("connection.update", u => {
        if (u.connection === "open") { clearTimeout(t); resolve(); }
        if (u.connection === "close") {
          clearTimeout(t);
          const code = u.lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut)
            reject(new HttpError(503, "OTP sender was logged out. Admin: re-link it at /sender."));
          else if (code === DisconnectReason.connectionReplaced)
            reject(new HttpError(503, "OTP sender is open somewhere else. Close the other session."));
          else reject(new HttpError(502, "Could not reach WhatsApp. Try again."));
        }
      });
    });

    const [r] = (await sock.onWhatsApp(`${number}@s.whatsapp.net`)) || [];
    if (!r?.exists) throw new HttpError(400, "This number is not on WhatsApp.");

    await sock.sendMessage(r.jid, { text });
    await sleep(800);
    await pending;
  } finally {
    try { sock?.ev?.removeAllListeners?.(); sock?.end?.(undefined); } catch {}
    await unlock();
  }
}
