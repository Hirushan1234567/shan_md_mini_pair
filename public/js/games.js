import { $, api, toast } from "./api.js";

const INFO = {
  snake: ["🐍 Snake", "Eat food. Every 3 food = 1 coin (max 10 per run). Swipe or use the arrows."],
  g2048: ["🔢 2048", "Reach 128+ for coins: 128=2, 256=5, 512=8, 1024=12, 2048=15."],
  memory: ["🧠 Memory match", "Match all 8 pairs quickly. Up to 6 coins."]
};

let timer = null, sid = "", current = "", move = () => {};
let keyHandler = null;

const dpad = `<div class="dpad">
  <span></span><button class="btn ghost" data-d="0,-1" aria-label="Up">⬆️</button><span></span>
  <button class="btn ghost" data-d="-1,0" aria-label="Left">⬅️</button><button class="btn ghost" data-d="0,1" aria-label="Down">⬇️</button><button class="btn ghost" data-d="1,0" aria-label="Right">➡️</button></div>`;

function swipe(el, fn) {
  let x, y;
  el.ontouchstart = e => { x = e.touches[0].clientX; y = e.touches[0].clientY; };
  el.ontouchend = e => {
    const dx = e.changedTouches[0].clientX - x, dy = e.changedTouches[0].clientY - y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    Math.abs(dx) > Math.abs(dy) ? fn(dx > 0 ? 1 : -1, 0) : fn(0, dy > 0 ? 1 : -1);
  };
}
function bindKeys(fn) {
  unbindKeys();
  keyHandler = e => {
    const m = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (m) { e.preventDefault(); fn(...m); }
  };
  document.addEventListener("keydown", keyHandler);
}
function unbindKeys() { if (keyHandler) document.removeEventListener("keydown", keyHandler); keyHandler = null; }

export function closeGame(onDone) {
  clearInterval(timer); timer = null; unbindKeys();
  $("gameModal").classList.remove("show");
  onDone && onDone();
}

async function end(score, extra) {
  clearInterval(timer); timer = null; unbindKeys();
  try {
    const d = await api("POST", "/games/finish", { sid, score, extra });
    $("gMsg").textContent = `Score ${score}. ${d.msg}`;
  } catch (e) { $("gMsg").textContent = e.message; }
  $("gArea").insertAdjacentHTML("beforeend", `<button class="btn" id="again" style="margin-top:12px">Play again</button>`);
  $("again").onclick = () => playGame(current);
}

export async function playGame(g) {
  clearInterval(timer); unbindKeys();
  current = g;
  try { sid = (await api("POST", "/games/start", { game: g })).sid; } catch (e) { return toast(e.message, true); }
  $("gTitle").textContent = INFO[g][0];
  $("gBody").innerHTML = `<p class="muted">${INFO[g][1]}</p><div id="gArea" style="margin-top:10px"></div><p class="muted" id="gMsg" style="margin-top:8px;text-align:center"></p>`;
  $("gameModal").classList.add("show");
  ({ snake, g2048, memory })[g]();
}

// delegated dpad clicks
document.addEventListener("click", e => {
  const b = e.target.closest?.(".dpad [data-d]");
  if (b) move(...b.dataset.d.split(",").map(Number));
});

function snake() {
  const N = 15, C = 20;
  let sn = [[7, 7]], d = [1, 0], nd = d, sc = 0, f = [3, 3];
  $("gArea").innerHTML = `<canvas id="cv" width="300" height="300" style="width:100%;max-width:300px;display:block;margin:auto;background:#000;border:1px solid var(--cyan);border-radius:10px;touch-action:none"></canvas>${dpad}`;
  const cx = $("cv").getContext("2d");
  const spawn = () => { let p; do { p = [Math.random() * N | 0, Math.random() * N | 0]; } while (sn.some(a => a[0] === p[0] && a[1] === p[1])); return p; };
  move = (x, y) => { if (!(x === -d[0] && y === -d[1])) nd = [x, y]; };
  swipe($("cv"), move); bindKeys(move);
  const draw = () => {
    cx.fillStyle = "#000"; cx.fillRect(0, 0, 300, 300);
    cx.fillStyle = "#ff3d6e"; cx.fillRect(f[0] * C + 2, f[1] * C + 2, C - 4, C - 4);
    cx.fillStyle = "#35d4ff"; sn.forEach(p => cx.fillRect(p[0] * C + 1, p[1] * C + 1, C - 2, C - 2));
    $("gMsg").textContent = "Food: " + sc;
  };
  draw();
  timer = setInterval(() => {
    d = nd;
    const h = [sn[0][0] + d[0], sn[0][1] + d[1]];
    if (h[0] < 0 || h[1] < 0 || h[0] >= N || h[1] >= N || sn.some(p => p[0] === h[0] && p[1] === h[1])) return end(sc);
    sn.unshift(h);
    if (h[0] === f[0] && h[1] === f[1]) { sc++; f = spawn(); } else sn.pop();
    draw();
  }, 140);
}

function g2048() {
  let B = Array(16).fill(0), sc = 0, over = false;
  const add = () => { const e = []; B.forEach((v, i) => v || e.push(i)); if (e.length) B[e[Math.random() * e.length | 0]] = Math.random() < .9 ? 2 : 4; };
  const col = { 0: "#0b1022", 2: "#12305a", 4: "#0f4a82", 8: "#0d5fa8", 16: "#0a82c8", 32: "#1fa2e6", 64: "#35d4ff", 128: "#2ee26b", 256: "#ffbf3c", 512: "#ff7a45", 1024: "#ff3d6e", 2048: "#b76cff" };
  $("gArea").innerHTML = `<div id="gB" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;background:var(--ink);padding:6px;border-radius:12px;border:1px solid var(--cyan);touch-action:none"></div>
    <p class="muted" id="gSc" style="text-align:center;margin-top:6px"></p>${dpad}
    <button class="btn wa" id="fin">Finish and claim</button>`;
  const draw = () => {
    $("gB").innerHTML = B.map(v => `<div style="background:${col[v] || "#fff"};color:${v >= 256 || v >= 2048 ? "#04170c" : "#fff"};border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${v >= 1024 ? 14 : v >= 128 ? 18 : 22}px;aspect-ratio:1">${v || ""}</div>`).join("");
    $("gSc").textContent = `Score ${sc} · Best tile ${Math.max(...B)}`;
  };
  const finish = () => { if (over) return; over = true; end(Math.max(...B), { sc }); };
  move = (dx, dy) => {
    if (over) return;
    let moved = false;
    for (let k = 0; k < 4; k++) {
      const idx = [0, 1, 2, 3].map(j => dx ? (dx > 0 ? k * 4 + 3 - j : k * 4 + j) : (dy > 0 ? (3 - j) * 4 + k : j * 4 + k));
      const line = idx.map(i => B[i]).filter(Boolean), out = [];
      for (let i = 0; i < line.length; i++) { if (line[i] === line[i + 1]) { out.push(line[i] * 2); sc += line[i] * 2; i++; } else out.push(line[i]); }
      while (out.length < 4) out.push(0);
      idx.forEach((bi, j) => { if (B[bi] !== out[j]) { moved = true; B[bi] = out[j]; } });
    }
    if (moved) { add(); draw(); }
    if (!(B.includes(0) || B.some((v, i) => (i % 4 < 3 && v === B[i + 1]) || (i < 12 && v === B[i + 4])))) finish();
  };
  $("fin").onclick = finish;
  add(); add(); draw(); swipe($("gB"), move); bindKeys(move);
}

function memory() {
  const em = ["🐱", "🐶", "🦊", "🐼", "🐸", "🦁", "🐵", "🐙"];
  let open = [], done = 0, moves = 0, lock = false;
  const t0 = Date.now();
  $("gArea").innerHTML = `<div id="mm" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px"></div>`;
  [...em, ...em].sort(() => Math.random() - .5).forEach(e => {
    const b = document.createElement("button");
    b.style.cssText = "aspect-ratio:1;font-size:28px;background:#12305a;border:1px solid var(--cyan);border-radius:10px;color:#fff;cursor:pointer";
    b.textContent = "❔";
    b.onclick = () => {
      if (lock || b.dataset.d || open.includes(b)) return;
      b.textContent = e; open.push(b);
      if (open.length === 2) {
        moves++;
        const [a, c] = open;
        if (a.textContent === c.textContent) {
          a.dataset.d = c.dataset.d = 1; a.style.background = c.style.background = "#0f3d27"; open = [];
          if (++done === 8) end(Math.max(10, 160 - moves * 4 - Math.round((Date.now() - t0) / 1000)), { moves });
        } else { lock = true; setTimeout(() => { a.textContent = c.textContent = "❔"; open = []; lock = false; }, 700); }
      }
    };
    $("mm").appendChild(b);
  });
}
