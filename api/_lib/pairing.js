import * as baileys from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import os from "os";
import path from "path";

const makeWASocket =
  typeof baileys.default === "function" ? baileys.default : baileys.makeWASocket;

const { DisconnectReason, useMultiFileAuthState, fetchLatestWaWebVersion } =
  baileys;

const logger = pino({ level: "silent" });
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const CODE_TTL_MS = 3 * 60 * 1000;
const SETTLE_MS = 8000;

export function prettyCode(code) {
  const c = String(code || "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

function readSessionFiles(dir) {
  const files = [];
  let total = 0;

  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;

    const data = fs.readFileSync(full, "utf8");
    total += data.length;
    files.push({ name, data });
  }

  if (total > 12 * 1024 * 1024) throw new Error("Session too large");

  return files;
}

/**
 * Pairing එක මුළුමනින්ම මේ function එක ඇතුළේ (එක invocation එකක) වෙනවා.
 * - onCode(code)   : pairing code එක ලැබුණාම
 * - onStatus(s)    : "linking" ...
 * - isAborted()    : user tab එක වහලා නම් true (code ගහන්න කලින් විතරක් නවත්තනවා)
 * Resolve: session files array. Reject: Error (message = expired | failed | aborted)
 */
export async function runPairing(number, { onCode, onStatus, isAborted, deadlineAt }) {
  const dir = path.join(os.tmpdir(), `shan-pair-${number}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });

  const latest = await fetchLatestWaWebVersion();
  if (!Array.isArray(latest?.version) || latest.version.length !== 3) {
    throw new Error("failed: invalid WhatsApp version");
  }
  const version = latest.version;

  let sock = null;
  let finished = false;
  let registered = false;
  let reconnects = 0;
  let codeAt = 0;

  const cleanup = () => {
    finished = true;
    try { sock?.ev?.removeAllListeners?.(); } catch {}
    try { sock?.end?.(undefined); } catch {}
    sock = null;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  };

  return await new Promise((resolve, reject) => {
    const done = (err, files) => {
      if (finished) return;
      const wasSock = sock;
      cleanup();
      clearInterval(watchdog);
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(files);
      void wasSock;
    };

    const watchdog = setInterval(() => {
      const now = Date.now();
      if (finished) return;

      if (!registered && isAborted?.()) return done(new Error("aborted"));
      if (!registered && codeAt && now - codeAt > CODE_TTL_MS) return done(new Error("expired"));
      if (now > deadlineAt) return done(new Error("failed: timeout"));
    }, 2000);

    const connect = async requestCode => {
      const { state, saveCreds } = await useMultiFileAuthState(dir);

      const s = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        generateHighQualityLinkPreview: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
      });

      sock = s;

      s.ev.on("creds.update", async () => {
        try { await saveCreds(); } catch {}
      });

      s.ev.on("connection.update", async update => {
        if (sock !== s || finished) return;
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          registered = true;
          onStatus?.("linking");

          setTimeout(async () => {
            if (finished || sock !== s) return;

            try {
              await saveCreds();
              const files = readSessionFiles(dir);

              // socket වහනවා (logout නැහැ) — Panel එකට එකම session එක ගන්න දෙන්න
              try { s.ev.removeAllListeners(); s.end(undefined); } catch {}
              sock = null;
              await sleep(2000);

              done(null, files);
            } catch (e) {
              done(new Error("failed: " + (e?.message || e)));
            }
          }, SETTLE_MS);
        }

        if (connection === "close") {
          const code =
            lastDisconnect?.error?.output?.statusCode ||
            lastDisconnect?.error?.statusCode ||
            null;

          // Code ගහපු පස්සේ WhatsApp restart ඉල්ලනවා -> reconnect
          if (state.creds.registered && code !== DisconnectReason.loggedOut) {
            registered = true;
            onStatus?.("linking");
            reconnects += 1;

            if (reconnects > 6) return done(new Error("failed: too many reconnects"));

            try { s.ev.removeAllListeners(); s.end(undefined); } catch {}
            await sleep(1000);

            if (!finished) connect(false).catch(e => done(new Error("failed: " + (e?.message || e))));
            return;
          }

          done(new Error(`failed: closed before link (${code})`));
        }
      });

      if (requestCode && !state.creds.registered) {
        await sleep(3000);
        const code = await s.requestPairingCode(number);
        codeAt = Date.now();
        onCode(prettyCode(code));
      }
    };

    connect(true).catch(e => done(new Error("failed: " + (e?.message || e))));
  });
}
