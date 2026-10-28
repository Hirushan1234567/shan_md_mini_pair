import * as baileys from "@whiskeysockets/baileys";
import { aux, cleanNumber, validNumber } from "./_lib/db.js";
import { adminPasswordOk } from "./_lib/auth.js";
import { runPairing, CODE_TTL_MS } from "./_lib/pairing.js";
import { SENDER_COLLECTION } from "./_lib/wa-sender.js";

const MAX_DURATION_MS = 285 * 1000;

// Admin only: OTP යවන bot number එක link කරනවා (users ගේ pair එකට වෙනස්, වෙනම collection එකක)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!adminPasswordOk(req.headers["x-admin-key"])) return res.status(401).json({ error: "Wrong admin password." });

  const number = cleanNumber(req.body?.number);
  if (!validNumber(number)) return res.status(400).json({ error: "Invalid number. Use country code without + or 0." });

  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" });
  const send = o => { try { res.write(JSON.stringify(o) + "\n"); } catch {} };
  let aborted = false;
  res.on("close", () => { aborted = true; });

  try {
    const files = await runPairing(number, {
      deadlineAt: Date.now() + MAX_DURATION_MS,
      isAborted: () => aborted,
      onCode: code => send({ type: "code", code, expiresIn: Math.floor(CODE_TTL_MS / 1000) }),
      onStatus: status => send({ type: "status", status })
    });

    const col = await aux(SENDER_COLLECTION);
    await col.deleteMany({});
    // useMultiFileAuthState file names -> auth doc ids (creds, pre-key-1, session-xx.0 ...)
    const docs = files.map(f => ({ _id: f.name.replace(/\.json$/, "").replace(/__/g, "/"), v: f.data }));
    if (docs.length) await col.insertMany(docs);
    await (await aux("meta")).updateOne({ _id: "otp_sender" }, { $set: { number, linkedAt: new Date() } }, { upsert: true });
    send({ type: "status", status: "sender_ready" });
  } catch (e) {
    const msg = String(e?.message || e);
    send({ type: "error", reason: msg.startsWith("expired") ? "expired" : msg.startsWith("aborted") ? "aborted" : "failed" });
  }
  res.end();
}
