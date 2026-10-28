import { $, api, toast, session, countdown } from "./api.js";

let number = "", isNew = false, stopCd = null;

const show = (el, on) => { el.hidden = !on; };
const err = (id, m) => { const e = $(id); e.textContent = m || ""; show(e, !!m); };

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.dataset.label ??= btn.textContent;
  btn.innerHTML = busy ? `<span class="spin"></span> ${label}` : btn.dataset.label;
}

function startCooldown(sec) {
  stopCd && stopCd();
  const b = $("resendBtn");
  b.disabled = true;
  stopCd = countdown(b, sec, () => { b.disabled = false; b.textContent = "Resend OTP"; }, "Resend in ");
}

async function sendOtp() {
  err("aErr", ""); err("aErr2", "");
  number = $("aNum").value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(number)) return err("aErr", "Invalid number. Use country code without + or 0 (example: 94771234567).");
  const key = $("aKey").value.trim();
  if (key.replace(/[^A-Za-z0-9]/g, "").length < 8) return err("aErr", "Enter your Bot Key (SHAN-XXXX-XXXX).");
  const btn = $("sendBtn");
  setBusy(btn, true, "Sending OTP…");
  try {
    const d = await api("POST", "/auth/otp", { number, key });
    isNew = d.isNew;
    $("sentTo").textContent = "+" + number;
    show($("newBox"), isNew);
    show($("stepNum"), false); show($("stepOtp"), true);
    startCooldown(d.cooldown || 45);
    setTimeout(() => $("aOtp").focus(), 80);
  } catch (e) {
    // otp step එකේ resend නම් ඒ error එකම පෙන්නනවා
    err(!$("stepOtp").hidden ? "aErr2" : "aErr", e.message);
  } finally { setBusy(btn, false); }
}

export function initAuth(onLogin) {
  $("stepNum").addEventListener("submit", e => { e.preventDefault(); sendOtp(); });
  $("aNum").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });
  $("aOtp").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });

  $("resendBtn").addEventListener("click", async () => {
    err("aErr2", "");
    try { const d = await api("POST", "/auth/otp", { number, key: $("aKey").value.trim() }); startCooldown(d.cooldown || 45); toast("New OTP sent to your WhatsApp"); }
    catch (e) { err("aErr2", e.message); }
  });
  $("keyResend").addEventListener("click", async e => {
    e.preventDefault(); err("aErr", "");
    const n = $("aNum").value.replace(/\D/g, "");
    if (!/^[1-9]\d{7,14}$/.test(n)) return err("aErr", "Enter your WhatsApp number first.");
    try { await api("POST", "/auth/key-resend", { number: n }); toast("New Bot Key sent to your WhatsApp"); }
    catch (er) { err("aErr", er.message); }
  });
  $("changeBtn").addEventListener("click", () => {
    stopCd && stopCd(); err("aErr2", "");
    $("aOtp").value = "";
    show($("stepOtp"), false); show($("stepNum"), true);
  });

  $("stepOtp").addEventListener("submit", async e => {
    e.preventDefault();
    err("aErr2", "");
    const otp = $("aOtp").value.trim();
    if (otp.length !== 6) return err("aErr2", "Enter the 6-digit OTP from WhatsApp.");
    const btn = $("verifyBtn");
    setBusy(btn, true, "Checking…");
    try {
      const d = await api("POST", "/auth/verify", {
        number, otp,
        name: $("aName").value.trim(),
        ref: $("aRef").value.trim().toUpperCase()
      });
      session.token = d.token;
      $("aOtp").value = "";
      toast(isNew ? "Account created. Welcome!" : "Welcome back, " + d.user.name);
      onLogin(d.user);
    } catch (e2) { err("aErr2", e2.message); }
    finally { setBusy(btn, false); }
  });
}

export function resetGate() {
  stopCd && stopCd();
  show($("stepOtp"), false); show($("stepNum"), true);
  err("aErr", ""); err("aErr2", "");
}
