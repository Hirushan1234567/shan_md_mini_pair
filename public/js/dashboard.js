import { $, api, esc, fmt, toast, session, setUnauthorizedHandler } from "./api.js";
import { initAuth, resetGate } from "./auth.js";
import { playGame, closeGame } from "./games.js";
import { initAdmin } from "./admin.js";

const show = (el, on) => { el.hidden = !on; };
let SHOP = 0, PLUG = [], PEND = null, PENDU = "";

/* ---------- gate / app switch ---------- */
function showGate() { session.token = ""; show($("app"), false); show($("gate"), true); resetGate(); }
function showApp() { show($("gate"), false); show($("app"), true); go("coins"); }
setUnauthorizedHandler(showGate);

/* ---------- navigation ---------- */
const loaders = { coins: loadCoins, shop: loadShop, bot: loadBot, log: loadLog, me: loadMe };
function go(v) {
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-" + v));
  document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  scrollTo(0, 0);
  loaders[v]();
}
document.querySelector(".tabbar").addEventListener("click", e => { const b = e.target.closest("button"); if (b) go(b.dataset.v); });

/* ---------- coins ---------- */
async function loadCoins() {
  try {
    const d = await api("GET", "/coins");
    $("bal").textContent = d.balance; $("earn").textContent = d.earned; $("spent").textContent = d.spent;
    $("refCode").textContent = d.code || "-";
    $("refInfo").textContent = `Friends joined: ${d.refs || 0}. You get +${d.refReward} coins per friend and they get +${d.refBonus}.`;
    $("gInfo").textContent = d.gInfo || "";
    $("dailyBtn").disabled = !d.canDaily;
    $("dailyBtn").textContent = d.canDaily ? "Claim daily reward" : "Daily reward claimed";
    $("txList").innerHTML = d.tx.length
      ? d.tx.map(t => `<div class="row"><span>${esc(t.note)}<small>${fmt(t.t)}</small></span><b class="${t.type === "earn" ? "g" : "r"}">${t.type === "earn" ? "+" : "-"}${esc(t.amt)}</b></div>`).join("")
      : `<p class="muted">No transactions yet. Claim your daily reward to start.</p>`;
    loadExtras();
  } catch (e) { toast(e.message, true); }
}

async function loadExtras() {
  try {
    const a = await api("GET", "/announce");
    $("annBox").textContent = "📢 " + a.text; show($("annBox"), !!a.text);
    const t = await api("GET", "/tasks");
    $("taskList").innerHTML = t.map(x => `<div class="row"><span>${esc(x.name)}<small>+${esc(x.reward)} coins · ${x.type === "daily" ? "daily" : "one time"}</small></span>
      ${x.done ? `<span class="pill on">Done</span>` : `<button class="pill on" data-task="${esc(x.id)}" data-link="${esc(x.link || "")}" type="button">${x.link ? "Go" : "Claim"}</button>`}</div>`).join("");
    const l = await api("GET", "/leaderboard");
    $("lbList").innerHTML = l.length
      ? l.map((x, i) => `<div class="row"><span>${["🥇", "🥈", "🥉"][i] || (i + 1) + "."} ${esc(x.name)}</span><b class="g">${esc(x.earned)}</b></div>`).join("")
      : `<p class="muted">No data yet.</p>`;
  } catch {}
}

async function taskClaim(id) {
  try { await api("POST", "/tasks/claim", { id }); toast("🎉 Reward claimed"); loadCoins(); } catch (e) { toast(e.message, true); }
}

/* ---------- OTP confirm sheet ---------- */
function otpAsk(txId, title, url) {
  PEND = txId; PENDU = url;
  $("otpTitle").textContent = title; $("otpIn").value = "";
  $("otpModal").classList.add("show"); setTimeout(() => $("otpIn").focus(), 80);
}
$("otpIn").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
$("otpCancel").onclick = () => $("otpModal").classList.remove("show");
$("otpOk").onclick = async () => {
  try {
    await api("POST", PENDU, { txId: PEND, otp: $("otpIn").value.trim() });
    $("otpModal").classList.remove("show"); toast("✅ Done");
    PENDU === "/plugins/confirm" ? loadShop() : loadCoins();
  } catch (e) { toast(e.message, true); }
};

/* ---------- shop ---------- */
async function loadShop() {
  try {
    PLUG = await api("GET", "/plugins");
    const c = await api("GET", "/coins");
    $("shopBal").textContent = `Your balance: ${c.balance} 🪙`;
    drawShop();
  } catch (e) { toast(e.message, true); }
}
function drawShop() {
  $("tShop").classList.toggle("on", !SHOP); $("tMine").classList.toggle("on", !!SHOP);
  const L = SHOP ? PLUG.filter(p => p.owned) : PLUG;
  $("shopList").innerHTML = L.length ? L.map(p => `<div class="card plug">
    <div class="row" style="border:0;padding:0"><h3 style="margin:0">${esc(p.name)}</h3>${SHOP ? `<span class="pill on">Owned</span>` : `<b class="g">${esc(p.price)} 🪙</b>`}</div>
    <p class="muted" style="margin:8px 0">${esc(p.desc)}</p><code>${esc(p.cmd)}</code>
    <p class="muted">${p.ver === "perk" ? "Perk" : "Version " + esc(p.ver)}</p>
    ${SHOP ? "" : p.owned ? `<button class="btn ghost" disabled>Purchased</button>` : `<button class="btn" data-buy="${esc(p.id)}" type="button">Buy for ${esc(p.price)} coins</button>`}</div>`).join("")
    : `<div class="card"><p>You have no plugins yet. Open the Shop tab to buy one.</p></div>`;
}
async function buy(id) {
  const p = PLUG.find(x => x.id === id);
  if (!p || !confirm(`Buy ${p.name} for ${p.price} coins? We'll send an OTP to your WhatsApp.`)) return;
  try {
    const d = await api("POST", "/plugins/buy", { id });
    if (d.otpRequired) { otpAsk(d.txId, "Enter the OTP the bot sent you to buy " + p.name, "/plugins/confirm"); toast("OTP sent to your WhatsApp"); }
  } catch (e) { toast(e.message, true); }
}

/* ---------- bot ---------- */
async function loadBot() {
  try {
    const s = await api("GET", "/bot"), on = s.status === "online";
    $("stDot").className = "dot" + (on ? "" : " off"); $("stTxt").textContent = on ? "Online" : "Offline";
    $("stPill").textContent = on ? "Running" : "Stopped"; $("stPill").className = "pill " + (on ? "on" : "off");
    $("bStart").disabled = on; $("bStop").disabled = !on;
    const c = await api("GET", "/settings");
    $("sPrefix").value = c.prefix; $("sName").value = c.name; $("sMode").value = c.mode;
    $("sSeen").checked = c.seen; $("sTyping").checked = c.typing;
    show($("wimgBox"), !!c.canImg); $("sImg").value = c.img || "";
    const k = await api("GET", "/keys");
    $("keyList").innerHTML = k.length ? k.map(x => `<div class="keyrow row" style="display:block"><b>${esc(x.name)}</b> <small class="muted">${fmt(x.created)}</small>
      <code>${esc(x.key)}</code><button class="btn danger sm" data-revoke="${esc(x.id)}" type="button">Revoke</button></div>`).join("")
      : `<p class="muted">No API keys yet.</p>`;
  } catch (e) { toast(e.message, true); }
}

/* ---------- activity / me / comments ---------- */
async function loadLog() {
  try {
    const l = await api("GET", "/activity");
    $("logList").innerHTML = l.length ? l.map(x => `<div class="row"><span>${esc(x.msg)}<small>${fmt(x.t)}</small></span></div>`).join("") : `<p class="muted">No activity yet.</p>`;
  } catch (e) { toast(e.message, true); }
}
async function loadMe() {
  try {
    const u = await api("GET", "/me");
    $("mName").textContent = (u.vip ? "⭐ " : "") + u.name; $("mNum").textContent = "+" + u.number;
    $("mCoins").textContent = u.coins; $("mJoin").textContent = u.joined ? new Date(u.joined).toLocaleDateString("en-LK") : "-";
  } catch (e) { toast(e.message, true); }
  loadCm();
}
async function loadCm() {
  try {
    const c = await api("GET", "/comments");
    $("cmList").innerHTML = c.length ? c.map(x => `<div class="cm"><b>⭐ ${esc(x.name)}</b><br>${esc(x.msg)}<small>${fmt(x.t)}</small></div>`).join("") : `<p class="muted" style="text-align:center">No comments yet. Write the first one.</p>`;
  } catch {}
}

/* ---------- one delegated click handler ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act],[data-task],[data-buy],[data-shop],[data-bot],[data-revoke],[data-game]");
  if (!t) return;
  const D = t.dataset;
  try {
    if (D.game) return playGame(D.game);
    if (D.shop !== undefined) { SHOP = +D.shop; return drawShop(); }
    if (D.buy) return buy(D.buy);
    if (D.task) { if (D.link) { window.open(D.link, "_blank", "noopener"); toast("Checking…"); setTimeout(() => taskClaim(D.task), 7000); } else taskClaim(D.task); return; }
    if (D.bot) {
      if (D.bot === "stop" && !confirm("Stop your bot?")) return;
      await api("POST", "/bot", { action: D.bot }); toast(D.bot === "start" ? "▶ Bot started" : "⏹ Bot stopped"); return loadBot();
    }
    if (D.revoke) { if (!confirm("Revoke this key?")) return; await api("DELETE", "/keys?id=" + encodeURIComponent(D.revoke)); toast("Key revoked"); return loadBot(); }
    switch (D.act) {
      case "daily": await api("POST", "/coins/daily"); toast("🎉 Daily reward claimed"); return loadCoins();
      case "redeem": { const code = $("rdCode").value.trim().toUpperCase(); if (!code) return;
        const d = await api("POST", "/coins/redeem", { code }); $("rdCode").value = ""; toast(`🎟 +${d.coins} coins`); return loadCoins(); }
      case "send": { const d = await api("POST", "/coins/send", { number: $("snNum").value.replace(/\D/g, ""), amount: +$("snAmt").value });
        if (d.otpRequired) { otpAsk("send", "Enter the OTP the bot sent you to confirm this transfer", "/coins/send/confirm"); toast("OTP sent to your WhatsApp"); } return; }
      case "copyRef": await navigator.clipboard?.writeText($("refCode").textContent); return toast("Code copied");
      case "saveSet": await api("PUT", "/settings", { prefix: $("sPrefix").value || ".", name: $("sName").value || "SHAN MINI BOT", mode: $("sMode").value, seen: $("sSeen").checked, typing: $("sTyping").checked, img: $("sImg").value.trim() }); return toast("💾 Settings saved");
      case "newKey": { const d = await api("POST", "/keys", { name: $("kName").value.trim() || "key" }); $("kName").value = "";
        $("newKeyVal").textContent = d.key; $("keyModal").classList.add("show"); return loadBot(); }
      case "postCm": { const msg = $("dcMsg").value.trim(); if (!msg) return toast("Write a comment first.", true);
        await api("POST", "/comments", { msg }); $("dcMsg").value = ""; toast("💬 Comment posted"); return loadCm(); }
      case "logout": showGate(); return toast("Logged out");
    }
  } catch (err) { toast(err.message, true); }
});

$("keyClose").onclick = () => $("keyModal").classList.remove("show");
$("keyCopy").onclick = async () => { try { await navigator.clipboard.writeText($("newKeyVal").textContent); toast("Key copied"); } catch {} };
$("gClose").onclick = () => closeGame(loadCoins);
document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".modal.show").forEach(m => m.id === "gameModal" ? closeGame(loadCoins) : m.classList.remove("show")); });

/* ---------- boot ---------- */
initAuth(() => showApp());
initAdmin();
(async () => {
  if (!session.token) return showGate();
  try { await api("GET", "/me"); showApp(); } catch { showGate(); }
})();
