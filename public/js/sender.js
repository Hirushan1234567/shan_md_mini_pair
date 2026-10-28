import { $, api, streamPost, countdown, session, toast } from "./api.js";

const show = (el, on) => { el.hidden = !on; };

async function status() {
  try {
    const d = await api("POST", "/admin/login", { password: $("pw").value });
    session.admin = d.token;
    const s = await api("GET", "/admin/sender");
    $("stLine").innerHTML = s.linked ? `Status: <span class="g">linked (+${s.number})</span>` : `Status: <span class="r">not linked</span>`;
  } catch (e) { toast(e.message, true); }
}
$("stLine").textContent = "Enter the admin password below to see the status.";
$("pw").addEventListener("change", () => $("pw").value && status());

$("go").addEventListener("click", async () => {
  show($("err"), false);
  const number = $("num").value.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(number)) { $("err").textContent = "Invalid number. Use country code without + or 0."; return show($("err"), true); }
  $("go").disabled = true;
  let stop = null;
  try {
    await streamPost("/api/sender-pair", { number }, {
      headers: { "x-admin-key": $("pw").value },
      onEvent: ev => {
        if (ev.type === "code") { $("code").textContent = ev.code; show($("codeCard"), true); stop = countdown($("timer"), ev.expiresIn || 180); }
        if (ev.type === "status" && (ev.status === "linking" || ev.status === "linked")) $("msg").textContent = "Linked. Saving the session…";
        if (ev.type === "status" && ev.status === "sender_ready") { stop && stop(); $("msg").innerHTML = `<span class="g">✅ OTP sender is ready. Users can log in now.</span>`; $("timer").textContent = ""; status(); }
        if (ev.type === "error") { stop && stop(); $("msg").innerHTML = `<span class="r">${ev.reason === "expired" ? "Code expired. Try again." : "Pairing failed. Try again."}</span>`; }
      }
    });
  } catch (e) { $("err").textContent = e.message; show($("err"), true); }
  $("go").disabled = false;
});
