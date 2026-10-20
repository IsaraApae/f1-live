// The lap battle film: two laps turned into functions of time, drawn together as one moving picture on a canvas,
// and recorded to a video file. Drawing happens in fixed "logical" units; the canvas scales them to its real pixels.
import { clamp, ink } from "./util.js";

export const PRE = 1, HOLD = 3.2;   // seconds on the line before the lap, and on the final times after it
const MINI = 24;                    // mini-sectors for the "who was faster where" colouring of the track
const DISPLAY = "'Titillium Web', 'Segoe UI', system-ui, sans-serif", UI = "system-ui, 'Segoe UI', Roboto, sans-serif";

// the i with a[i] <= v < a[i + 1] (a sorted), kept inside the array
export function seek(a, v) {
  let lo = 0, hi = a.length - 1;
  if (hi < 1 || v <= a[0]) return 0;
  if (v >= a[hi]) return hi - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= v) lo = m; else hi = m; }
  return lo;
}
export const fmtLap = t => { const ms = Math.round(Math.max(0, t) * 1000), m = Math.floor(ms / 60000); return `${m}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`; };
const rgb = h => { const s = (h || "#777777").replace("#", ""); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) || 0); };
// two team colours too close to tell apart (team mates): the second driver gets an outline look instead
export const similar = (a, b) => { const [p, q] = [rgb(a), rgb(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 70; };
const cr = (p0, p1, p2, p3, u) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
const rotate = (x, y, deg) => { const a = deg * Math.PI / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; };

// ---------- one lap as functions of time (t = seconds since the lap started) ----------
// raw: { c: [[ms, speed, throttle, brake, gear, rpm, drs]], l: [[ms, x, y]] }, ms relative to the lap start
export function lapModel({ c, l }, dur) {
  const uniq = a => a.filter((p, i) => i === 0 || p[0] > a[i - 1][0]);
  const car = uniq(c.filter(p => p[1] != null).map(p => [p[0] / 1000, ...p.slice(1)]).sort((p, q) => p[0] - q[0]));
  const loc = [];   // drop location glitches: jumps no car could make (units are about 10 cm)
  for (const p of uniq(l.filter(p => p[1] || p[2]).map(p => [p[0] / 1000, p[1], p[2]]).sort((p, q) => p[0] - q[0]))) {
    const q = loc[loc.length - 1];
    if (!q || Math.hypot(p[1] - q[1], p[2] - q[2]) < 1200 * Math.max(0.1, p[0] - q[0]) + 300) loc.push(p);
  }
  // distance: speed integrated over time (speed is linear between samples, so distance is exact per piece)
  const n = car.length, ts = car.map(p => p[0]), v = car.map(p => p[1] / 3.6), cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + (v[i - 1] + v[i]) / 2 * (ts[i] - ts[i - 1]));
  const raw = t => {
    if (t <= ts[0]) return cum[0] + v[0] * (t - ts[0]);
    if (t >= ts[n - 1]) return cum[n - 1] + v[n - 1] * (t - ts[n - 1]);
    const i = seek(ts, t), h = ts[i + 1] - ts[i], dt = t - ts[i];
    return cum[i] + v[i] * dt + (v[i + 1] - v[i]) / h * dt * dt / 2;
  };
  const d0 = raw(0), total = raw(dur) - d0;
  const lt = loc.map(p => p[0]), lx = loc.map(p => p[1]), ly = loc.map(p => p[2]);
  const m = {
    dur, total, L: total, k: 1, hasPos: loc.length >= 20, T: null, G: null,
    // stretch this lap to a shared length, so both drivers start and finish at the same spot
    setLength(L) {
      m.L = L; m.k = L / total;
      const N = Math.ceil(dur / 0.02) + 1;
      m.T = new Float64Array(N); m.G = new Float64Array(N);
      for (let i = 0; i < N; i++) { m.T[i] = Math.min(i * 0.02, dur); m.G[i] = m.dist(m.T[i]); }
      return m;
    },
    dist: t => t <= 0 ? 0 : t >= dur ? m.L : clamp((raw(t) - d0) * m.k, 0, m.L),
    timeAt(d) {   // when the car reached a distance
      if (d <= 0) return 0;
      if (d >= m.L) return dur;
      const i = seek(m.G, d), g = m.G[i + 1] - m.G[i];
      return m.T[i] + (m.T[i + 1] - m.T[i]) * (g > 0 ? (d - m.G[i]) / g : 0);
    },
    tel(t) {   // speed, pedals and gear at a moment (between samples: blended; gear changes at the sample)
      t = clamp(t, 0, dur);
      const i = seek(ts, t), a = car[i], b = car[Math.min(i + 1, n - 1)], h = b[0] - a[0], u = h > 0 ? clamp((t - a[0]) / h, 0, 1) : 0;
      const mix = (p, q) => p + (q - p) * u, on = x => x > 0 ? 100 : 0, at = u < 1 ? a : b;
      return { speed: mix(a[1], b[1]), thr: clamp(mix(a[2] || 0, b[2] || 0), 0, 100), brk: mix(on(a[3]), on(b[3])), gear: at[4] || 0, rpm: mix(a[5] || 0, b[5] || 0), drs: at[6] >= 10 };
    },
    pos(t) {   // where the car was (track units), smoothed through the samples so motion is fluid at any frame rate
      if (!m.hasPos) return null;
      t = clamp(t, 0, dur);
      const N = lt.length, i = seek(lt, t), h = lt[i + 1] - lt[i], u = h > 0 ? clamp((t - lt[i]) / h, 0, 1) : 0;
      const i0 = Math.max(0, i - 1), i3 = Math.min(N - 1, i + 2);
      return [cr(lx[i0], lx[i], lx[i + 1], lx[i3], u), cr(ly[i0], ly[i], ly[i + 1], ly[i3], u)];
    },
    path: () => loc.filter(p => p[0] >= 0 && p[0] <= dur).map(p => [p[1], p[2]])
  };
  return m;
}

// ---------- the film ----------
export const STYLES = {
  dark: { bg: "#0b0b11", glow: "rgba(225,6,0,.17)", panel: "rgba(255,255,255,.05)", line: "rgba(255,255,255,.1)", text: "#f2f2f6", dim: "#8d8d9c",
          road: "#262634", edge: "#3a3a4d", corner: "#1d1d29", cornerText: "#8d8d9c", ring: "#ffffff", alt: "#ffffff", altInk: "#0b0b11",
          good: "#22c55e", bad: "#ff3b30", chip: "rgba(255,255,255,.1)", red: "#e10600", veil: "rgba(11,11,17,.86)", shadow: "rgba(0,0,0,.6)" },
  light: { bg: "#f3f4f7", glow: "rgba(225,6,0,.1)", panel: "rgba(0,0,0,.045)", line: "rgba(0,0,0,.09)", text: "#111118", dim: "#686c79",
           road: "#dcdfe6", edge: "#c3c7d1", corner: "#e7e9ee", cornerText: "#686c79", ring: "#ffffff", alt: "#15151c", altInk: "#ffffff",
           good: "#16a34a", bad: "#e10600", chip: "rgba(0,0,0,.08)", red: "#e10600", veil: "rgba(243,244,247,.9)", shadow: "rgba(0,0,0,.25)" }
};
// everything's place, in logical units: wide (16:9) for computers, tall for phones
const LAYOUTS = {
  wide: { W: 880, H: 495, road: 10, car: 7, track: { x: 24, y: 92, w: 560, h: 362 }, timer: { x: 856, y: 32, size: 30 },
          head: { x: 24, y: 32, title: 22, max: 560 }, side: { x: 604, w: 252 }, cardA: { x: 604, y: 92, w: 252, h: 104 }, gap: { x: 604, y: 204, w: 252, h: 40 },
          cardB: { x: 604, y: 252, w: 252, h: 104 }, secs: { x: 604, y: 366, w: 252, h: 88 }, prog: { x0: 24, x1: 856, y: 472 }, foot: 489 },
  tall: { W: 400, H: 588, road: 8, car: 6, track: { x: 16, y: 76, w: 368, h: 262 }, timer: { x: 384, y: 26, size: 24 },
          head: { x: 16, y: 26, title: 18, max: 240 }, cardA: { x: 16, y: 388, w: 180, h: 96 }, gap: { x: 16, y: 346, w: 368, h: 34 },
          cardB: { x: 204, y: 388, w: 180, h: 96 }, secs: { x: 16, y: 492, w: 368, h: 56 }, prog: { x0: 16, x1: 384, y: 562 }, foot: 581, small: true }
};
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); };

export class Film {
  // o: { A, B, outline: { x, y, rotation, corners } | null, title, sub, style }; A/B: { m: lapModel, tla, num, team, colour, sectors }
  constructor(canvas, o) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.o = o; this.A = o.A; this.B = o.B;
    this.L = o.A.m.L; this.end = Math.max(o.A.m.dur, o.B.m.dur); this.total = PRE + this.end + HOLD;
    this.same = similar(o.A.colour, o.B.colour);
    this.outline();
    const A = this.A.m, B = this.B.m, L = this.L;
    this.mini = Array.from({ length: MINI }, (_, k) => {
      const s = k * L / MINI, e = (k + 1) * L / MINI, ta = A.timeAt(e) - A.timeAt(s), tb = B.timeAt(e) - B.timeAt(s);
      return { s, e, win: ta <= tb ? "A" : "B", at: Math.max(A.timeAt(e), B.timeAt(e)) };
    });
    this.setStyle(o.style || "dark");
  }
  // the track in driving order from the start line, with how far along the lap each point is
  outline() {
    const o = this.o.outline, A = this.A.m;
    let pts = o ? o.x.map((x, i) => [x, o.y[i]]) : A.path();
    const near = p => { let bi = 0, bd = Infinity; pts.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
    const p0 = A.pos(0);
    if (o && p0) {   // MultiViewer's outline starts anywhere and may run either way round
      const n = pts.length, i0 = near(p0), i1 = near(A.pos(Math.min(4, A.dur / 4))), dir = (i1 - i0 + n) % n < n / 2 ? 1 : -1;
      pts = Array.from({ length: n }, (_, k) => pts[((i0 + dir * k) % n + n) % n]);
    }
    pts.push(pts[0]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const tot = cum[cum.length - 1] || 1;
    this.pts = pts; this.od = Float64Array.from(cum, v => v / tot * this.L);
    this.corners = ((o && o.corners) || []).map(k => ({ ...k, d: this.od[near([k.x, k.y])] }));
  }
  at(d) {   // a point on the outline a distance into the lap (track units)
    const od = this.od, i = seek(od, clamp(d, 0, this.L)), g = od[i + 1] - od[i], u = g > 0 ? clamp((d - od[i]) / g, 0, 1) : 0, p = this.pts[i], q = this.pts[i + 1];
    return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  }
  setStyle(name) {
    this.style = STYLES[name] ? name : "dark"; const st = this.st = STYLES[this.style];
    const col = (D, alt) => alt ? { fill: st.alt, ring: D.colour, ink: st.altInk, line: st.alt } : { fill: D.colour, ring: st.ring, ink: ink(D.colour), line: D.colour };
    this.ca = col(this.A, false); this.cb = col(this.B, this.same);
    this.grad = null;
  }
  // the canvas's real pixel size for its width on screen; the layout flips to tall on narrow screens
  size(cssW) {
    if (this.fixed) return;
    this.setLayout(cssW < 620 ? "tall" : "wide");
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3), w = Math.round(Math.min(cssW * dpr, 2560)), h = Math.round(w * this.lay.H / this.lay.W);
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
  }
  fix(on) {   // while recording: a fixed, crisp frame size (even numbers, which video encoders need)
    this.fixed = on;
    if (on) { const w = this.layName === "wide" ? 1920 : 1080; this.c.width = w; this.c.height = Math.round(w * this.lay.H / this.lay.W / 2) * 2; }
  }
  setLayout(name) {
    if (this.layName === name) return;
    this.layName = name; const Y = this.lay = LAYOUTS[name], R = Y.track, pad = Y.small ? 16 : 22;
    // a track drawn from a car's own trace has no preferred angle: turn it to fill the space best
    const fit = rot => {
      const P = this.pts.map(p => rotate(p[0], p[1], rot)), xs = P.map(p => p[0]), ys = P.map(p => p[1]);
      const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      b.k = Math.min((R.w - 2 * pad) / (b.maxX - b.minX || 1), (R.h - 2 * pad) / (b.maxY - b.minY || 1)); b.rot = rot;
      return b;
    };
    let b = fit(this.o.outline ? this.o.outline.rotation || 0 : 0);
    if (!this.o.outline) for (let r = 15; r < 180; r += 15) { const f = fit(r); if (f.k > b.k * 1.02) b = f; }
    const ox = R.x + (R.w - (b.maxX - b.minX) * b.k) / 2, oy = R.y + (R.h - (b.maxY - b.minY) * b.k) / 2;
    this.map = p => { const [x, y] = rotate(p[0], p[1], b.rot); return [ox + (x - b.minX) * b.k, oy + (b.maxY - y) * b.k]; };
    const S = this.pts.map(this.map), path = pts => { const p = new Path2D(); pts.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); return p; };
    this.road = path(S); this.road.closePath();
    this.miniPaths = this.mini.map(m => {
      const pts = [this.map(this.at(m.s))];
      for (let i = 0; i < S.length; i++) if (this.od[i] > m.s && this.od[i] < m.e) pts.push(S[i]);
      pts.push(this.map(this.at(m.e)));
      return path(pts);
    });
    this.cornerPts = this.corners.map(k => {
      const [x, y] = this.map([k.x, k.y]), a = (k.a || 0) * Math.PI / 180, off = Y.small ? 12 : 15;   // set off to the side of the track
      return { n: k.n, x: x + Math.cos(a) * off, y: y - Math.sin(a) * off };
    });
    const s0 = this.map(this.at(0)), s1 = this.map(this.at(Math.min(30, this.L / 50)));
    this.startLine = { x: s0[0], y: s0[1], ang: Math.atan2(s1[1] - s0[1], s1[0] - s0[0]) };
    this.grad = null;
  }
  where(D, t) {   // a driver's spot on screen: their own recorded position, or the outline at their distance
    const p = D.m.pos(t);
    return this.map(p || this.at(D.m.dist(t)));
  }

  // ---------- drawing ----------
  text(s, x, y, { size = 12, weight = 700, color, align = "left", font = UI, ls = 0, max = 0 } = {}) {
    const c = this.ctx; s = String(s);
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = color || this.st.text; c.textAlign = align; c.textBaseline = "alphabetic";
    if ("letterSpacing" in c) c.letterSpacing = `${ls}px`;
    if (max && c.measureText(s).width > max) { while (s.length > 1 && c.measureText(s + "…").width > max) s = s.slice(0, -1); s += "…"; }
    c.fillText(s, x, y);
    const w = c.measureText(s).width;
    if ("letterSpacing" in c) c.letterSpacing = "0px";
    return w;
  }
  num(s, x, y, { size = 12, weight = 900, color, align = "left", font = DISPLAY } = {}) {   // digits on a fixed pitch, so counters don't wobble
    const c = this.ctx; s = String(s);
    c.font = `${weight} ${size}px ${font}`; c.fillStyle = color || this.st.text; c.textAlign = "left"; c.textBaseline = "alphabetic";
    const d = c.measureText("0").width, ws = [...s].map(ch => /\d/.test(ch) ? d : c.measureText(ch).width), w = ws.reduce((a, b) => a + b, 0);
    let px = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    [...s].forEach((ch, i) => { c.fillText(ch, px + (/\d/.test(ch) ? (d - c.measureText(ch).width) / 2 : 0), y); px += ws[i]; });
    return w;
  }
  draw(tl) {
    const c = this.ctx, Y = this.lay, st = this.st, t = tl - PRE, A = this.A, B = this.B;
    if (!Y) return;
    const s = this.c.width / Y.W;
    c.setTransform(s, 0, 0, s, 0, 0);
    c.fillStyle = st.bg; c.fillRect(0, 0, Y.W, Y.H);
    if (!this.grad) { this.grad = c.createRadialGradient(Y.W, 0, 0, Y.W, 0, Y.W * 0.85); this.grad.addColorStop(0, st.glow); this.grad.addColorStop(1, "rgba(0,0,0,0)"); }
    c.fillStyle = this.grad; c.fillRect(0, 0, Y.W, Y.H);
    this.header(t);
    this.track(t);
    this.cars(t);
    this.finale(t);
    this.card(A, Y.cardA, t, this.ca);
    this.card(B, Y.cardB, t, this.cb);
    this.gapBox(t);
    this.sectors(t);
    this.progress(t);
    this.footer();
  }
  header(t) {
    const Y = this.lay, H = Y.head, st = this.st;
    this.text("LAP BATTLE", H.x, H.y, { size: Y.small ? 9.5 : 11, weight: 900, color: st.red, ls: 1.6 });
    this.text(this.o.title, H.x, H.y + (Y.small ? 21 : 26), { size: H.title, weight: 900, font: DISPLAY, max: H.max });
    this.text(this.o.sub, H.x, H.y + (Y.small ? 38 : 46), { size: Y.small ? 10.5 : 12, weight: 600, color: st.dim, max: H.max });
    const T = Y.timer;
    this.text("LAP TIME", T.x, T.y, { size: Y.small ? 8.5 : 10, weight: 800, color: st.dim, align: "right", ls: 1.2 });
    this.num(fmtLap(clamp(t, 0, this.end)), T.x, T.y + T.size + (Y.small ? 0 : 2), { size: T.size, align: "right" });
  }
  track(t) {
    const c = this.ctx, Y = this.lay, st = this.st;
    c.lineJoin = c.lineCap = "round";
    c.strokeStyle = st.edge; c.lineWidth = Y.road + 3; c.stroke(this.road);
    c.strokeStyle = st.road; c.lineWidth = Y.road; c.stroke(this.road);
    // each mini-sector takes the colour of whoever was quicker through it, once both are past
    c.lineWidth = Y.road * 0.42;
    this.mini.forEach((m, k) => {
      const a = clamp((t - m.at) / 0.35, 0, 1);
      if (a <= 0) return;
      c.globalAlpha = a; c.strokeStyle = m.win === "A" ? this.ca.line : this.cb.line; c.stroke(this.miniPaths[k]);
    });
    c.globalAlpha = 1;
    // start / finish: a chequered strip across the track
    const L = this.startLine, sq = Y.road * 0.42;
    c.save(); c.translate(L.x, L.y); c.rotate(L.ang + Math.PI / 2);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? "#111" : "#fff"; c.fillRect(-3 * sq + i * sq, -sq + j * sq, sq, sq); }
    c.restore();
    c.textAlign = "center"; c.textBaseline = "middle"; c.font = `800 ${Y.small ? 6.5 : 7.5}px ${UI}`;
    for (const k of this.cornerPts) {
      c.fillStyle = st.corner; c.beginPath(); c.arc(k.x, k.y, Y.small ? 5.5 : 6.5, 0, 7); c.fill();
      c.fillStyle = st.cornerText; c.fillText(k.n, k.x, k.y + 0.5);
    }
    c.textBaseline = "alphabetic";
    const R = Y.track;
    this.text("Track colour: who was quicker, mini-sector by mini-sector", R.x, R.y + R.h - 2, { size: Y.small ? 8 : 9, weight: 600, color: st.dim });
  }
  cars(t) {
    const c = this.ctx, Y = this.lay, st = this.st;
    const a = [this.A, this.ca, 1], b = [this.B, this.cb, -1];
    const list = this.B.m.dist(t) > this.A.m.dist(t) ? [a, b] : [b, a];   // the car in front is drawn last, on top
    // fading trails: the last 1.6 seconds of each car's path
    c.lineCap = "round"; c.lineWidth = Y.road * 0.5;
    for (const [D, col] of list) {
      let prev = this.where(D, t);
      for (let k = 1; k <= 32; k++) {
        const p = this.where(D, t - k * 0.05);
        c.globalAlpha = 0.6 * (1 - k / 32); c.strokeStyle = col.line;
        c.beginPath(); c.moveTo(prev[0], prev[1]); c.lineTo(p[0], p[1]); c.stroke();
        prev = p;
      }
    }
    c.globalAlpha = 1;
    for (const [D, col, side] of list) {
      const [x, y] = this.where(D, t), a = this.where(D, t - 0.12), b = this.where(D, t + 0.12);
      let nx = -(b[1] - a[1]), ny = b[0] - a[0], len = Math.hypot(nx, ny);
      if (len < 0.5) { nx = 0; ny = -1; len = 1; }
      // name tag beside the car: A on one side, B on the other, so they never sit on top of each other
      const off = Y.car + 15, tx = x + nx / len * off * side, ty = y + ny / len * off * side;
      c.font = `900 ${Y.small ? 9.5 : 10.5}px ${UI}`;
      const w = c.measureText(D.tla).width + 10, h = Y.small ? 14 : 16;
      c.shadowColor = st.shadow; c.shadowBlur = 6;
      rr(c, tx - w / 2, ty - h / 2, w, h, 4); c.fillStyle = col.fill; c.fill();
      if (col.ring !== st.ring) { c.lineWidth = 1.5; c.strokeStyle = col.ring; c.stroke(); }
      c.beginPath(); c.arc(x, y, Y.car, 0, 7); c.fillStyle = col.fill; c.fill();
      c.shadowBlur = 0;
      c.lineWidth = col.ring === st.ring ? 2.2 : 3; c.strokeStyle = col.ring; c.stroke();
      c.fillStyle = col.ink; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(D.tla, tx, ty + 0.5);
      c.textBaseline = "alphabetic";
    }
  }
  winner() {
    const a = this.A.m.dur, b = this.B.m.dur;
    return a === b ? null : a < b ? [this.A, this.ca, this.B, b - a] : [this.B, this.cb, this.A, a - b];
  }
  finale(t) {   // once both have finished: who was faster, over the track
    const a = clamp((t - this.end - 0.3) / 0.5, 0, 1);
    if (a <= 0) return;
    const c = this.ctx, Y = this.lay, st = this.st, R = Y.track, w = Y.small ? 230 : 270, h = Y.small ? 92 : 104, x = R.x + (R.w - w) / 2, y = R.y + (R.h - h) / 2, win = this.winner();
    c.globalAlpha = a;
    rr(c, x, y, w, h, 14); c.fillStyle = st.veil; c.fill(); c.lineWidth = 1; c.strokeStyle = st.line; c.stroke();
    if (!win) {
      this.text("DEAD HEAT", x + w / 2, y + h / 2 + 8, { size: 26, weight: 900, font: DISPLAY, align: "center" });
    } else {
      const [W, col, O, by] = win;
      this.text("FASTER LAP", x + w / 2, y + 22, { size: 9.5, weight: 900, color: st.dim, align: "center", ls: 1.4 });
      c.font = `900 ${Y.small ? 26 : 30}px ${DISPLAY}`;
      const tw = c.measureText(W.tla).width, lw = (Y.small ? 22 : 26) * 4.1, gap = 10, x0 = x + w / 2 - (tw + gap + lw) / 2;
      this.text(W.tla, x0, y + (Y.small ? 53 : 58), { size: Y.small ? 26 : 30, weight: 900, font: DISPLAY, color: col.line === st.alt ? st.text : col.line });
      this.num(fmtLap(W.m.dur), x0 + tw + gap, y + (Y.small ? 53 : 58), { size: Y.small ? 22 : 26 });
      this.text(`by ${by.toFixed(3)}s over ${O.tla}`, x + w / 2, y + h - (Y.small ? 14 : 18), { size: Y.small ? 11 : 12.5, weight: 700, color: st.dim, align: "center" });
    }
    c.globalAlpha = 1;
  }
  card(D, b, t, col) {
    const c = this.ctx, st = this.st, m = D.m, v = m.tel(t), fin = t >= m.dur, sm = this.lay.small, win = this.winner();
    rr(c, b.x, b.y, b.w, b.h, 10); c.fillStyle = st.panel; c.fill();
    rr(c, b.x, b.y + 10, 4, b.h - 20, 2); c.fillStyle = col.line; c.fill();
    if (col.ring !== st.ring) { c.lineWidth = 1.5; c.strokeStyle = col.ring; c.stroke(); }
    const x = b.x + 14, r = b.x + b.w - 12;
    const nw = this.text(D.tla, x, b.y + (sm ? 22 : 26), { size: sm ? 16 : 20, weight: 900, font: DISPLAY });
    this.text(`#${D.num}`, x + nw + 6, b.y + (sm ? 22 : 26), { size: sm ? 9.5 : 10.5, weight: 700, color: st.dim });
    if (fin) {
      const best = win && win[0] === D;
      this.num(fmtLap(m.dur), r, b.y + (sm ? 22 : 26), { size: sm ? 13 : 16, color: best ? st.good : st.text, align: "right" });
    } else if (!sm) this.text(D.team, r, b.y + 25, { size: 10, weight: 700, color: st.dim, align: "right", max: b.w - nw - 70 });
    // speed and gear
    const sy = b.y + (sm ? 54 : 66), sw = this.num(String(Math.round(v.speed)), x, sy, { size: sm ? 24 : 32 });
    this.text("km/h", x + sw + 4, sy, { size: sm ? 9 : 10.5, weight: 700, color: st.dim });
    const gs = sm ? 28 : 36, gx = r - gs + 2, gy = b.y + (sm ? 30 : 36);
    rr(c, gx, gy, gs, gs, 7); c.fillStyle = st.chip; c.fill();
    this.text("GEAR", gx + gs / 2, gy + (sm ? 8 : 10), { size: sm ? 6 : 7, weight: 800, color: st.dim, align: "center", ls: 0.6 });
    this.num(v.gear || "N", gx + gs / 2, gy + gs - (sm ? 5 : 6), { size: sm ? 15 : 19, align: "center" });
    if (v.drs) {
      const dw = sm ? 26 : 30, dx = gx - dw - 6, dy = gy + gs / 2 - 7;
      rr(c, dx, dy, dw, 14, 4); c.fillStyle = st.good; c.fill();
      this.text("DRS", dx + dw / 2, dy + 10.5, { size: 8.5, weight: 900, color: "#000", align: "center" });
    }
    // pedals
    const bar = (label, f, colr, y) => {
      this.text(label, x, y + 5, { size: sm ? 7 : 8, weight: 800, color: st.dim, ls: 0.5 });
      const bx = x + (sm ? 24 : 30), bw = r - bx;
      rr(c, bx, y, bw, sm ? 4 : 5, 3); c.fillStyle = st.chip; c.fill();
      if (f > 0.005) { rr(c, bx, y, bw * f, sm ? 4 : 5, 3); c.fillStyle = colr; c.fill(); }
    };
    bar("THR", v.thr / 100, st.good, b.y + (sm ? 69 : 80));
    bar("BRK", v.brk / 100, st.bad, b.y + (sm ? 81 : 92));
  }
  gapBox(t) {
    const Y = this.lay, b = Y.gap, st = this.st, c = this.ctx, A = this.A, B = this.B, mid = b.y + b.h / 2 + (Y.small ? 5 : 6), big = Y.small ? 16 : 19;
    rr(c, b.x, b.y, b.w, b.h, 10); c.fillStyle = st.panel; c.fill();
    const tla = (D, col, x, align, size = 13) => this.text(D.tla, x, mid, { size, weight: 900, font: DISPLAY, align, color: col.line === st.alt ? st.text : col.line });
    if (t <= 0) {
      this.text("GAP", b.x + 12, mid - 1, { size: 9, weight: 800, color: st.dim, ls: 1 });
      this.text("Ready", b.x + b.w - 12, mid, { size: 13, weight: 800, color: st.dim, align: "right" });
      return;
    }
    if (t >= this.end) {
      const win = this.winner();
      this.text("FINAL", b.x + 12, mid - 1, { size: 9, weight: 800, color: st.dim, ls: 1 });
      if (!win) { this.text("Dead heat", b.x + b.w - 12, mid, { size: big, weight: 900, font: DISPLAY, align: "right" }); return; }
      const w = this.num(`${win[3].toFixed(3)}s`, b.x + b.w - 12, mid, { size: big, align: "right" });
      const w2 = this.text("by", b.x + b.w - 12 - w - 6, mid, { size: 11, weight: 700, color: st.dim, align: "right" });
      tla(win[0], win[1], b.x + b.w - 12 - w - w2 - 12, "right", big - 3);
      return;
    }
    // gap: how long ago the car in front was where the car behind is now
    const dA = A.m.dist(t), dB = B.m.dist(t), [lead, lc, trail, tc] = dB > dA ? [B, this.cb, A, this.ca] : [A, this.ca, B, this.cb];
    const gap = Math.max(0, t - lead.m.timeAt(trail.m.dist(t)));
    const lw = this.text("AHEAD", b.x + 12, mid - 1, { size: 9, weight: 800, color: st.dim, ls: 1 });
    tla(lead, lc, b.x + 12 + lw + 6, "left");
    const w = this.num(`+${gap.toFixed(3)}s`, b.x + b.w - 12, mid, { size: big, align: "right" });
    tla(trail, tc, b.x + b.w - 12 - w - 7, "right", big - 3);
  }
  sectors(t) {
    const Y = this.lay, b = Y.secs, st = this.st, c = this.ctx, A = this.A, B = this.B, sm = Y.small;
    rr(c, b.x, b.y, b.w, b.h, 10); c.fillStyle = st.panel; c.fill();
    const done = (D, k) => { const s = D.sectors || []; let sum = 0; for (let i = 0; i <= k; i++) sum += s[i] || 0; return s[k] != null && t >= (k === 2 ? D.m.dur : sum) ? s[k] : null; };
    const nm = (D, col) => col.line === st.alt ? st.text : col.line;
    if (!sm) {
      const c1 = b.x + 170, c2 = b.x + b.w - 12;
      this.text("SECTORS", b.x + 12, b.y + 19, { size: 9, weight: 800, color: st.dim, ls: 1 });
      this.text(A.tla, c1, b.y + 19, { size: 10, weight: 900, color: nm(A, this.ca), align: "right" });
      this.text(B.tla, c2, b.y + 19, { size: 10, weight: 900, color: nm(B, this.cb), align: "right" });
      for (let k = 0; k < 3; k++) {
        const y = b.y + 40 + k * 19, a = done(A, k), z = done(B, k), both = a != null && z != null;
        this.text(`S${k + 1}`, b.x + 12, y, { size: 11, weight: 800, color: st.dim });
        this.num(a != null ? a.toFixed(3) : "–", c1, y, { size: 13, weight: 800, align: "right", color: both && a > z ? st.dim : st.text, font: UI });
        this.num(z != null ? z.toFixed(3) : "–", c2, y, { size: 13, weight: 800, align: "right", color: both && z > a ? st.dim : st.text, font: UI });
      }
      return;
    }
    const cw = b.w / 3;
    for (let k = 0; k < 3; k++) {
      const x = b.x + 12 + k * cw, a = done(A, k), z = done(B, k);
      this.text(`SECTOR ${k + 1}`, x, b.y + 19, { size: 8, weight: 800, color: st.dim, ls: 0.8 });
      if (a != null && z != null) {
        const [W, col, by] = a <= z ? [A, this.ca, z - a] : [B, this.cb, a - z];
        const w = this.text(W.tla, x, b.y + 41, { size: 13, weight: 900, font: DISPLAY, color: nm(W, col) });
        this.num(`−${by.toFixed(3)}`, x + w + 5, b.y + 41, { size: 12, weight: 800, font: UI });
      } else {
        const one = a != null ? [A, this.ca, a] : z != null ? [B, this.cb, z] : null;
        if (one) { const w = this.text(one[0].tla, x, b.y + 41, { size: 13, weight: 900, font: DISPLAY, color: nm(one[0], one[1]) }); this.num(one[2].toFixed(3), x + w + 5, b.y + 41, { size: 12, weight: 800, font: UI }); }
        else this.text("–", x, b.y + 41, { size: 13, weight: 800, color: st.dim });
      }
    }
  }
  progress(t) {   // both cars on a straight line from start to finish, with the sector splits marked
    const c = this.ctx, P = this.lay.prog, st = this.st, w = P.x1 - P.x0, L = this.L;
    rr(c, P.x0, P.y - 2, w, 4, 2); c.fillStyle = st.chip; c.fill();
    const s = this.A.sectors || [];
    if (s[0] && s[1]) for (const v of [s[0], s[0] + s[1]]) { c.fillStyle = st.line; c.fillRect(P.x0 + this.A.m.dist(v) / L * w - 0.5, P.y - 6, 1, 12); }
    const list = [[this.B, this.cb], [this.A, this.ca]];
    if (this.B.m.dist(t) > this.A.m.dist(t)) list.reverse();
    for (const [D, col] of list) {
      const x = P.x0 + D.m.dist(t) / L * w;
      c.beginPath(); c.arc(x, P.y, 5, 0, 7); c.fillStyle = col.fill; c.fill(); c.lineWidth = 2; c.strokeStyle = col.ring === st.ring ? st.bg : col.ring; c.stroke();
    }
  }
  footer() {
    const c = this.ctx, Y = this.lay, st = this.st, y = Y.foot, x0 = Y.prog.x0;
    rr(c, x0, y - 8, 9, 9, 2.5); c.fillStyle = st.red; c.fill();
    const w = this.text("F1 Live", x0 + 13, y, { size: 9.5, weight: 800, color: st.dim });
    this.text("· unofficial fan replay", x0 + 13 + w + 4, y, { size: 9, weight: 600, color: st.dim });
    this.text("Data: OpenF1", Y.prog.x1, y, { size: 9, weight: 600, color: st.dim, align: "right" });
  }
}

// ---------- recording the film to a video file ----------
export function videoType() {
  const R = window.MediaRecorder;
  if (!R || !R.isTypeSupported) return null;
  return ["video/mp4;codecs=avc1.640033", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(t => R.isTypeSupported(t)) || null;
}
export function startRecording(canvas, type) {
  const stream = canvas.captureStream(60), chunks = [];
  // flat colours and text stay sharp at a low bitrate, and a 100-second lap stays around 20 MB to send in a chat
  // (Chrome's H.264 holds 1.5 Mbps; asked for 2.5 or more it drifts up to 4-6 Mbps)
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1.5e6 });
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res, rej) => {
    rec.onstop = () => { stream.getTracks().forEach(k => k.stop()); res(new Blob(chunks, { type: type.split(";")[0] })); };
    rec.onerror = e => { stream.getTracks().forEach(k => k.stop()); rej(e.error || new Error("recording failed")); };
  });
  rec.start(250);
  return {
    done, type,
    stop() { if (rec.state !== "inactive") rec.stop(); },
    pause() { if (rec.state === "recording") rec.pause(); },
    resume() { if (rec.state === "paused") rec.resume(); }
  };
}
