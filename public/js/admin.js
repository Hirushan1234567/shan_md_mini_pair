import { $, api, esc, toast, session } from "./api.js";

const show = (el, on) => { el.hidden = !on; };

async function load() {
  try {
    const st = await api("GET", "/admin/stats");
    show($("admLogin"), false); show($("admPanel"), true);
    $("admStats").innerHTML = [["Users", st.users], ["Coins in wallets", st.coins], ["Plugins sold", st.sold], ["Comments", st.comments]]
      .map(x => `<div class="card" style="margin:0;text-align:center"><small class="muted">${x[0]}</small><b style="display:block;font-size:20px">${esc(x[1])}</b></div>`).join("");
    const s = await api("GET", "/admin/sender");
    $("admSender").innerHTML = s.linked
      ? `OTP sender: <b class="g">linked (+${esc(s.number)})</b>`
      : `OTP sender: <b class="r">not linked</b>. Open <a href="/sender" style="color:var(--cyan)">/sender</a> to link the bot number.`;
    const u = await api("GET", "/admin/users");
    $("admUsers").innerHTML = u.length ? u.map(x => `<div class="row"><span>${esc(x.name)}<small>+${esc(x.number)} · ${esc(x.coins)} 🪙${x.banned ? " · BANNED" : ""}</small></span>
      <span><button class="pill on" data-adm="coins" data-n="${esc(x.number)}" type="button">Coins</button>
      <button class="pill off" data-adm="ban" data-n="${esc(x.number)}" data-ban="${x.banned ? 0 : 1}" type="button">${x.banned ? "Unban" : "Ban"}</button></span></div>`).join("") : `<p class="muted">No users yet.</p>`;
    const c = await api("GET", "/comments");
    $("admCms").innerHTML = c.length ? c.map(x => `<div class="cm"><b>${esc(x.name)}</b><br>${esc(x.msg)}
      <button class="btn danger sm" data-adm="delcm" data-id="${esc(x.id)}" type="button" style="margin-top:8px">Delete</button></div>`).join("") : `<p class="muted">No comments.</p>`;
  } catch (e) {
    toast(e.message, true);
    session.admin = "";
    show($("admLogin"), true); show($("admPanel"), false);
  }
}

export function openAdmin() { $("admModal").classList.add("show"); if (session.admin) load(); }

export function initAdmin() {
  $("admClose").onclick = () => $("admModal").classList.remove("show");
  $("admGo").onclick = async () => {
    try {
      const d = await api("POST", "/admin/login", { password: $("admPass").value });
      session.admin = d.token; $("admPass").value = ""; load();
    } catch (e) { toast(e.message, true); }
  };
  $("admModal").addEventListener("click", async e => {
    const b = e.target.closest("[data-adm]");
    if (!b) return;
    const k = b.dataset.adm;
    try {
      if (k === "ann") { await api("POST", "/admin/announce", { text: $("admAnn").value.trim() }); toast("Announcement updated"); }
      if (k === "coupon") {
        await api("POST", "/admin/coupons", { code: $("cpCode").value.trim(), coins: +$("cpCoins").value, uses: +$("cpUses").value });
        toast("Coupon created"); $("cpCode").value = "";
      }
      if (k === "coins") {
        const a = prompt("Coins to add (negative to remove):");
        if (a === null || isNaN(+a) || +a === 0) return;
        await api("POST", "/admin/coins", { number: b.dataset.n, amount: +a }); toast("Done"); load();
      }
      if (k === "ban") { await api("POST", "/admin/ban", { number: b.dataset.n, ban: b.dataset.ban === "1" }); load(); }
      if (k === "delcm") { if (!confirm("Delete this comment?")) return; await api("DELETE", "/comments?id=" + encodeURIComponent(b.dataset.id)); load(); }
    } catch (err) { toast(err.message, true); }
  });

  // “Comments” heading 5 taps -> admin
  let taps = 0, t = null;
  $("adminTap").addEventListener("click", () => {
    taps++; clearTimeout(t); t = setTimeout(() => taps = 0, 1500);
    if (taps >= 5) { taps = 0; openAdmin(); }
  });
}
