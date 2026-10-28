import { sessions, aux, cleanNumber, validNumber } from "./_lib/db.js";
import { runPairing, CODE_TTL_MS } from "./_lib/pairing.js";
import { issueKey } from "./_lib/botkey.js";

const RATE_LIMIT = Number(process.env.RATE_LIMIT || 6);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MIN || 10) * 60 * 1000;
const MAX_DURATION_MS = 285 * 1000; // vercel.json maxDuration 300s ට වඩා අඩුවෙන්

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress || "unknown";
}

// Serverless වල memory එක share වෙන්නේ නැති නිසා rate limit එක MongoDB එකේ
async function rateLimited(ip) {
  const col = await aux("pair_ratelimit");
  const now = Date.now();
  const doc = await col.findOne({ _id: ip });

  if (!doc || now - doc.start > RATE_WINDOW_MS) {
    await col.updateOne({ _id: ip }, { $set: { start: now, count: 1 } }, { upsert: true });
    return false;
  }

  if (doc.count >= RATE_LIMIT) return true;

  await col.updateOne({ _id: ip }, { $inc: { count: 1 } });
  return false;
}

// එකම number එකට එකවර pairing දෙකක් වෙන්නේ නැහැ
async function acquireLock(number) {
  const col = await aux("pair_locks");
  const now = Date.now();

  try {
    await col.updateOne(
      { _id: number, expires: { $lt: now } },
      { $set: { expires: now + MAX_DURATION_MS } },
      { upsert: true }
    );
    return true;
  } catch (e) {
    if (e?.code === 11000) return false; // duplicate key = lock තාම ඇති
    throw e;
  }
}

async function releaseLock(number) {
  try { await (await aux("pair_locks")).deleteOne({ _id: number }); } catch {}
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const number = cleanNumber(req.body?.number);

  if (!validNumber(number)) {
    return res.status(400).json({
      error: "Invalid number. Use country code without + or 0 (example: 94771234567)."
    });
  }

  let locked = false;

  try {
    if (await rateLimited(clientIp(req))) {
      return res.status(429).json({ error: "Too many attempts. Please wait a few minutes." });
    }

    const col = await sessions();
    const existing = await col.findOne({ _id: number }, { projection: { status: 1, active: 1 } });

    if (existing?.status === "ready" && existing?.active) {
      return res.status(409).json({
        error: "This number is already connected to the bot. To re-pair, remove the linked device in WhatsApp first."
      });
    }

    locked = await acquireLock(number);
    if (!locked) {
      return res.status(409).json({ error: "A pairing for this number is already in progress." });
    }

    // ---- Streaming response (NDJSON) ----
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    });

    const send = obj => { try { res.write(JSON.stringify(obj) + "\n"); } catch {} };

    let aborted = false;
    res.on("close", () => { aborted = true; });

    const startedAt = Date.now();
    const deadlineAt = startedAt + MAX_DURATION_MS;

    try {
      const files = await runPairing(number, {
        deadlineAt,
        isAborted: () => aborted,
        onCode: code => send({ type: "code", code, expiresIn: Math.floor(CODE_TTL_MS / 1000) }),
        onStatus: status => send({ type: "status", status })
      });

      await col.updateOne(
        { _id: number },
        {
          $set: { status: "ready", files, active: false, claimedAt: null, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      );

      send({ type: "status", status: "linked" });

      // Bot Key එක user ගේ WhatsApp එකට යවනවා (dashboard login එකට)
      try { await issueKey(number); send({ type: "status", status: "key_sent" }); }
      catch (e) { console.error("key send failed:", e?.message || e); send({ type: "status", status: "key_failed" }); }

      // Panel bot එක ගන්නකල් (active) පොඩ්ඩක් බලා ඉන්නවා
      while (Date.now() < deadlineAt - 3000 && !aborted) {
        const d = await col.findOne({ _id: number }, { projection: { active: 1 } });
        if (d?.active) { send({ type: "status", status: "active" }); break; }
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      const msg = String(e?.message || e);
      send({ type: "error", reason: msg.startsWith("expired") ? "expired" : msg.startsWith("aborted") ? "aborted" : "failed" });
    }

    res.end();
  } catch (error) {
    console.error("pair error:", error?.message || error);

    if (!res.headersSent) {
      res.status(500).json({ error: "Could not generate a pairing code. Try again.", detail: String(error?.message || error).slice(0, 200) });
    } else {
      try { res.end(); } catch {}
    }
  } finally {
    if (locked) await releaseLock(number);
  }
}
