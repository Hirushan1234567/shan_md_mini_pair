import { $, esc, toast, api, streamPost, countdown, fmt } from "./api.js";
import { SITE } from "./config.js";

/* ---- static bits ---- */
$("logoImg").src = $("logoImg2").src = SITE.logo;
$("lnkWa").href = SITE.waChannel;
$("lnkTg").href = SITE.telegram;
$("supportList").innerHTML = SITE.support.map(s => `
  <div class="contact">
    <img src="${esc(s.photo)}" alt="" referrerpolicy="no-referrer" loading="lazy">
    <div><b>${esc(s.label)}</b><span class="muted">+${esc(s.number)}</span></div>
    <a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/${esc(s.number)}?text=Hi%20SHAN%20MINI%20BOT%20-%20I%20need%20help">Chat</a>
  </div>`).join("");

function tick() {
  const d = new Date();
  $("clock").textContent = d.toLocaleTimeString("en-LK", { hour12: true, timeZone: "Asia/Colombo" });
  $("date").textContent = d.toLocaleDateString("en-LK", { timeZone: "Asia/Colombo" });
}
tick(); setInterval(tick, 1000);

// bottom nav highlight
const navs = [...document.querySelectorAll("[data-nav]")];
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) navs.forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
}), { threshold: .35 });
navs.forEach(a => { const s = document.querySelector(a.getAttribute("href")); s && io.observe(s); });

/* ---- comments (shared, server side) ---- */
async function loadComments() {
  try {
    const c = await api("GET", "/comments");
    $("cmList").innerHTML = c.length
      ? c.map(x => `<div class="cm"><b>${esc(x.name)}</b><br>${esc(x.msg)}<small>${fmt(x.t)}</small></div>`).join("")
      : `<p class="muted" style="margin-top:12px">No comments yet. Be the first to write one.</p>`;
  } catch { $("cmList").innerHTML = ""; }
}
$("cmForm").addEventListener("submit", async e => {
  e.preventDefault();
  const msg = $("cMsg").value.trim();
  if (!msg) return toast("Write a comment first.", true);
  try {
    await api("POST", "/comments", { name: $("cName").value.trim(), msg });
    $("cMsg").value = "";
    toast("Comment posted");
    loadComments();
  } catch (err) { toast(err.message, true); }
});
loadComments();

/* ---- pair flow ---- */
let stopTimer = null, poll = null, ctrl = null, number = "", done = false, linked = false;

const show = (el, on) => { el.hidden = !on; };

function stopAll() { stopTimer && stopTimer(); stopTimer = null; clearInterval(poll); poll = null; }
function pErr(m) { $("pErr").textContent = m; show($("pErr"), true); }

function reset() {
  stopAll(); done = linked = false;
  try { ctrl && ctrl.abort(); } catch {}
  show($("pCodeBox"), false); show($("pForm"), true); show($("pErr"), false);
  $("pGo").disabled = false; $("pGo").textContent = "Get pair code";
  $("pState").className = "state wait"; $("pSpin").style.display = "";
  $("pStText").textContent = "Waiting for you to enter the code…";
  show($("pDash"), false); show($("pAgain"), false); $("pCopy").hidden = false;
  $("pCode").textContent = "----"; $("pTimer").textContent = "";
}

function openPair() { $("pairModal").classList.add("show"); setTimeout(() => $("pNum").focus(), 80); }
function closePair() { reset(); $("pairModal").classList.remove("show"); }

function active() {
  done = true; stopAll();
  $("pState").className = "state ok"; $("pSpin").style.display = "none";
  $("pStText").textContent = "Connected! Your bot is active. Your Bot Key is in your WhatsApp. Send .menu to your own chat.";
  $("pTimer").textContent = ""; $("pCopy").hidden = true; show($("pDash"), true);
}
function failed(reason) {
  done = true; stopAll();
  $("pCopy").hidden = true; $("pCode").textContent = "----"; $("pTimer").textContent = "";
  $("pStText").textContent = reason === "expired" ? "Code expired. Start over to get a new one." : "Pairing did not finish. Start over and try again.";
  $("pSpin").style.display = "none"; show($("pAgain"), true);
}
function linkedUi() { $("pStText").textContent = "Device linked! Starting your bot…"; $("pTimer").textContent = ""; stopTimer && stopTimer(); }
function pollActive() {
  let n = 0;
  poll = setInterval(async () => {
    n++;
    try { const d = await (await fetch("/api/status?number=" + number)).json(); if (d.status === "active") return active(); } catch {}
    if (n > 40) { stopAll(); $("pStText").textContent = "Linked! Your bot should be active shortly. Send .menu to your own chat."; }
  }, 3000);
}
function handle(ev) {
  if (ev.type === "code") {
    $("pCode").textContent = ev.code; show($("pForm"), false); show($("pCodeBox"), true);
    stopTimer = countdown($("pTimer"), ev.expiresIn || 180);
  } else if (ev.type === "status") {
    if (ev.status === "linking") linkedUi();
    if (ev.status === "linked") { linkedUi(); linked = true; }
    if (ev.status === "key_sent") $("pStText").textContent = "Linked! Your Bot Key was sent to your WhatsApp. Use it to log in to the dashboard.";
    if (ev.status === "active") active();
  } else if (ev.type === "error" && ev.reason !== "aborted") failed(ev.reason);
}

async function start() {
  show($("pErr"), false);
  number = $("pNum").value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(number)) return pErr("Invalid number. Use country code without + or 0 (example: 94771234567).");
  $("pGo").disabled = true; $("pGo").textContent = "Generating…";
  done = linked = false; ctrl = new AbortController();
  try {
    await streamPost("/api/pair", { number }, { signal: ctrl.signal, onEvent: handle });
    if (!done) { if (linked) pollActive(); else if (!$("pCodeBox").hidden) failed("failed"); }
  } catch (e) {
    if (e.name === "AbortError") return;
    if (!$("pCodeBox").hidden) { if (!done) failed("failed"); }
    else { pErr(e.message); $("pGo").disabled = false; $("pGo").textContent = "Get pair code"; }
  }
}

$("deployBtn").addEventListener("click", openPair);
$("pClose").addEventListener("click", closePair);
$("pGo").addEventListener("click", start);
$("pAgain").addEventListener("click", reset);
$("pNum").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });
$("pNum").addEventListener("keydown", e => { if (e.key === "Enter") start(); });
$("pCopy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("pCode").textContent.replace("-", "")); $("pCopy").textContent = "Copied ✔"; setTimeout(() => $("pCopy").textContent = "Copy code", 1500); } catch {}
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closePair(); });
