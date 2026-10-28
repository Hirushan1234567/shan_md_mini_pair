export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt = t => new Date(t).toLocaleString("en-LK");

export function toast(msg, bad = false) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2800);
}

export const session = {
  get token() { try { return localStorage.getItem("sc_token") || ""; } catch { return ""; } },
  set token(v) { try { v ? localStorage.setItem("sc_token", v) : localStorage.removeItem("sc_token"); } catch {} },
  admin: ""
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = fn => { onUnauthorized = fn; };

export async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (session.token) headers.Authorization = "Bearer " + session.token;
  if (session.admin) headers["X-Admin"] = session.admin;

  let r, data;
  try {
    r = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    data = await r.json();
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }
  if (!r.ok) {
    if (r.status === 401 && !session.admin) onUnauthorized();
    throw new ApiError(data.error || "Request failed.", r.status);
  }
  return data;
}

/** NDJSON stream (pair code flow). onEvent(ev) for each line. */
export async function streamPost(url, body, { signal, headers = {}, onEvent }) {
  const r = await fetch(url, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new ApiError((d.error || "Something went wrong. Try again.") + (d.detail ? ` [${d.detail}]` : ""), r.status);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { onEvent(JSON.parse(line)); } catch {} }
    }
  }
}

export function countdown(el, seconds, onEnd, prefix = "Expires in ") {
  let left = seconds;
  const draw = () => { el.textContent = left > 0 ? `${prefix}${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : ""; };
  draw();
  const id = setInterval(() => { left--; draw(); if (left <= 0) { clearInterval(id); onEnd && onEnd(); } }, 1000);
  return () => clearInterval(id);
}
