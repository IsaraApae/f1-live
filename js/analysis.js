// Replays only: fastest laps, overtakes (and where on the track they happened), track dominance between chosen drivers,
// and car telemetry (speed, gear, throttle, brake, RPM, DRS) for the driver you follow, moving with the replay clock.
import { esc, lapText, tagVars, hex, TYRES } from "./util.js";
import { of1 } from "./api.js";
import { R, mapState, pointAt, rotate, pathOf, setFollow, following, seekTo, lapAt, zonesOnMap } from "./timing.js";

let D = null, alive = false;
const $ = id => document.getElementById(id);
const info = n => { const d = (D.drivers || []).find(x => String(x.driver_number) === String(n)) || {}; return { tla: d.name_acronym || n, name: d.full_name || "", colour: hex(d.team_colour), team: d.team_name || "" }; };
const tag = n => { const d = info(n); return `<span class="dtag small" style="${tagVars(d.colour)}"><span class="n">${esc(n)}</span><span class="t">${esc(d.tla)}</span></span>`; };
const iso = t => new Date(t).toISOString();

// ---------- the panels' places on the timing screen ----------
export const panelsLeft = panel =>
  panel("p-fast", "analysis", `<span>Fastest laps <small>so far</small></span>`, `<ol class="fastlaps" id="fastLaps"></ol>`);
export const panelsRight = panel =>
  panel("p-dom", "analysis", `<span>Track dominance</span><small>fastest laps of the session</small>`,
    `<div class="chips" id="domPick"></div><div class="domwrap"><svg id="domMap" viewBox="0 0 400 300" role="img" aria-label="Which driver was quickest on each part of the track"></svg></div><div class="domkey" id="domKey"></div>`)
  + panel("p-ot", "analysis", `<span>Overtakes <small id="otN"></small></span><label class="switch"><input type="checkbox" id="otMap" checked>On the map</label>`,
    `<ol class="otlist" id="otList"></ol>`);
export const followExtra = () => `<div class="tele" id="tele" hidden>
  <div class="tele-g"><div><small>Speed</small><b id="tSpeed">–</b><i>km/h</i></div><div><small>Gear</small><b id="tGear">–</b></div><div><small>RPM</small><b id="tRpm">–</b></div><div><small>DRS</small><b id="tDrs">–</b></div></div>
  <div class="tele-bars"><span>Throttle</span><div class="tbar thr"><i id="tThr"></i></div><span>Brake</span><div class="tbar brk"><i id="tBrk"></i></div></div>
  <svg class="tele-trace" id="tTrace" viewBox="0 0 300 60" preserveAspectRatio="none"></svg>
  <p class="tele-note" id="tNote">Car telemetry from OpenF1, about 4 readings a second.</p></div>`;

// ---------- start, stop ----------
let ots = [], otKey = "", fastKey = "", dom = { pick: [], data: {}, key: "" }, seen = null;
export function start(data) {
  D = data; alive = true; ots = []; otKey = ""; fastKey = ""; dom = { pick: [], data: {}, key: "" }; tele = { n: null, from: 0, to: 0, rows: [], loading: false };
  const race = D.sess.session_type === "Race";
  if (race) of1(`overtakes?session_key=${D.sess.session_key}`, { ttl: 7 * 86400000 }).then(list => {
    if (!alive || D !== data) return;
    // only overtakes on track: a place lost while either car was in the pit lane isn't one
    const inPit = (n, t) => D.pits.some(p => p.n === String(n) && p.in - 3000 <= t && t <= p.out + 3000);
    ots = list.map(o => ({ at: Date.parse(o.date), a: String(o.overtaking_driver_number), b: String(o.overtaken_driver_number), pos: o.position }))
      .filter(o => o.at && !inPit(o.a, o.at) && !inPit(o.b, o.at)).sort((x, y) => x.at - y.at);
    otKey = ""; render();
  }).catch(() => { ots = null; render(); });
  // dominance: by default the three quickest laps of the session
  const best = Object.entries(D.byDriver).map(([n, laps]) => [n, fastestLap(laps)]).filter(([, l]) => l).sort((a, b) => a[1].dur - b[1].dur);
  dom.pick = best.slice(0, 3).map(([n]) => n);
  dom.order = best.map(([n]) => n);
  // load the dominance map once its panel is on screen (it takes a few requests)
  seen = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { seen.disconnect(); seen = null; loadDominance(); } });
  const p = $("p-dom"); if (p) seen.observe(p);
  if (!race) { const ot = $("p-ot"); if (ot) ot.hidden = true; }
  $("domPick").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const n = b.dataset.n, has = dom.pick.includes(n);
    dom.pick = has ? dom.pick.filter(x => x !== n) : [...dom.pick, n].slice(-3);   // up to three at once
    loadDominance();
  });
  $("otList").addEventListener("click", e => { const li = e.target.closest("li[data-at]"); if (li) seekTo(+li.dataset.at - 6000); });
  $("otMap").addEventListener("change", () => { otKey = ""; render(); });
  $("fastLaps").addEventListener("click", e => { const li = e.target.closest("li[data-n]"); if (li) setFollow(li.dataset.n); });
}
export function stop() { alive = false; D = null; if (seen) { seen.disconnect(); seen = null; } }
export function shown(k) { if (k === "analysis" && alive && seen) { seen.disconnect(); seen = null; loadDominance(); } }
export function mapReady() { otKey = ""; dom.key = ""; if (alive) { drawDominance(); render(); } }

const fastestLap = laps => laps.filter(l => l.dur && !l.out).sort((a, b) => a.dur - b.dur)[0] || null;
const compoundOn = (n, lap) => { const s = D.stints.find(x => String(x.driver_number) === n && x.lap_start <= lap && (x.lap_end || 999) >= lap); return s && s.compound; };

// ---------- every frame the replay changes ----------
export function render() {
  if (!alive || !D) return;
  renderFast(); renderOvertakes(); renderTele();
}
function renderFast() {   // each driver's best lap so far, quickest first
  const at = R.t;
  const rows = Object.entries(D.byDriver).map(([n, laps]) => [n, fastestLap(laps.filter(l => l.end <= at))]).filter(([, l]) => l).sort((a, b) => a[1].dur - b[1].dur);
  const key = rows.map(([n, l]) => n + l.n).join() + following();
  if (key === fastKey) return; fastKey = key;
  const top = rows.length ? rows[0][1].dur : 0;
  $("fastLaps").innerHTML = rows.length ? rows.map(([n, l], i) => {
    const c = compoundOn(n, l.n), [ltr, ring] = TYRES[c] || ["", "#777"];
    return `<li data-n="${esc(n)}" class="${following() === n ? "fol" : ""}" style="--tc:${info(n).colour}"><span class="p">${i + 1}</span>${tag(n)}
      <span class="lt ${i ? "" : "t-purple"}">${lapText(l.dur)}</span><span class="gp">${i ? "+" + (l.dur - top).toFixed(3) : ""}</span>
      <span class="ln">Lap ${l.n}</span>${c ? `<span class="tyre" style="--ty:${ring}" title="${esc(c)}">${ltr}</span>` : "<span></span>"}</li>`;
  }).join("") : `<li class="empty">No timed laps yet</li>`;
}
function renderOvertakes() {
  const el = $("otList"); if (!el) return;
  if (ots === null) { el.innerHTML = `<li class="empty">Overtakes couldn't be loaded</li>`; return; }
  const so = ots.filter(o => o.at <= R.t), showMap = $("otMap").checked;
  const key = so.length + "|" + showMap + "|" + (mapState().circuit ? 1 : 0);
  if (key === otKey) return; otKey = key;
  $("otN").textContent = so.length ? `· ${so.length}` : "";
  el.innerHTML = so.length ? so.slice().reverse().slice(0, 120).map(o => `<li data-at="${o.at}"><span class="lap">Lap ${Math.max(1, lapAt(o.at))}</span>
      <span class="who">${tag(o.a)}<span class="arrow">passes</span>${tag(o.b)}</span><span class="pos">P${o.pos}</span></li>`).join("")
    : `<li class="empty">${ots.length ? "No overtakes yet" : "No overtakes in this session"}</li>`;
  drawZones(showMap ? so : []);
}
function drawZones(list) {   // where the overtakes happened: 50 stretches of track, a circle sized by how many
  const g = $("ots"), { circuit } = mapState(); if (!g || !circuit) return;
  const bins = new Array(50).fill(0);
  for (const o of list) {
    const laps = D.byDriver[o.a] || [], L = laps.find(l => l.start <= o.at && o.at < l.end);
    if (!L || !L.dur || L.n === 1) continue;   // the start's shuffle isn't an overtaking spot
    const f = (o.at - L.start) / (L.dur * 1000);
    bins[Math.floor(((f % 1) + 1) % 1 * 50)]++;
  }
  const most = Math.max(1, ...bins);
  const spots = bins.map((k, i) => { if (!k) return null; const [x, y] = pointAt((i + 0.5) / 50); return { x, y, r: 5 + 9 * k / most, n: k }; }).filter(Boolean);
  g.innerHTML = spots.map(z => `<g class="otz"><circle cx="${z.x.toFixed(1)}" cy="${z.y.toFixed(1)}" r="${z.r.toFixed(1)}"/><text x="${z.x.toFixed(1)}" y="${(z.y + 3).toFixed(1)}">${z.n}</text></g>`).join("");
  zonesOnMap(spots);   // and on the real map
}

// ---------- track dominance ----------
async function loadDominance() {
  if (!alive) return;
  drawPicker();
  const mine = D;
  for (const n of dom.pick) {
    if (dom.data[n]) continue;
    const L = fastestLap(D.byDriver[n] || []); if (!L) continue;
    dom.data[n] = "loading"; drawDominance();
    try {
      const pts = (await of1(`location?session_key=${D.sess.session_key}&driver_number=${n}&date>=${iso(L.start)}&date<=${iso(L.start + L.dur * 1000)}`, { ttl: 7 * 86400000 })).filter(p => p.x || p.y);
      if (!alive || D !== mine) return;
      dom.data[n] = { lap: L, pts: pts.map(p => ({ t: Date.parse(p.date), x: p.x, y: p.y })) };
    } catch (e) { dom.data[n] = null; }
    drawDominance();
  }
  drawDominance();
}
function drawPicker() {
  $("domPick").innerHTML = (dom.order || []).map(n => { const d = info(n);
    return `<button type="button" data-n="${esc(n)}" style="${tagVars(d.colour)}" aria-pressed="${dom.pick.includes(n)}">${esc(d.tla)}</button>`; }).join("");
}
function drawDominance() {
  const svg = $("domMap"), { circuit, mapBox } = mapState(); if (!svg) return;
  if (!circuit || !circuit.screen) { svg.innerHTML = ""; $("domKey").innerHTML = `<p class="empty">Waiting for the track map…</p>`; return; }
  svg.setAttribute("viewBox", `0 0 ${circuit.w} ${circuit.h}`);
  const T = circuit.screen, n = T.length;
  const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(T[i][0] - T[i - 1][0], T[i][1] - T[i - 1][1]));
  const total = cum[n - 1] || 1, frac = cum.map(c => c / total);
  const base = `<path d="${pathOf(T)}Z" fill="none" stroke="var(--track-edge)" stroke-width="11" stroke-linejoin="round"/>`;
  const ready = dom.pick.filter(k => dom.data[k] && dom.data[k] !== "loading");
  const loading = dom.pick.some(k => dom.data[k] === "loading");
  if (ready.length < 2) {
    svg.innerHTML = base;
    $("domKey").innerHTML = `<p class="empty">${loading ? "Loading the laps…" : "Pick two or three drivers to compare their fastest laps."}</p>`;
    return;
  }
  // each driver: the time at each point of the lap, by placing every location reading on the track outline
  const rot = circuit.rotation || 0, near = (x, y) => { let bi = 0, bd = Infinity; for (let i = 0; i < n; i += 1) { const d = (T[i][0] - x) ** 2 + (T[i][1] - y) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const timeAt = {};
  for (const k of ready) {
    const { pts, lap } = dom.data[k];
    let f = pts.map(p => { const [x, y] = mapBox(rotate(p.x, p.y, rot)); return [frac[near(x, y)], p.t - lap.start]; });
    // the start line isn't the outline's first point: readings just after it come out near 1, the last ones near 0
    f = f.map(([v, t], i) => [i < f.length / 4 && v > 0.75 ? v - 1 : i > f.length * 3 / 4 && v < 0.25 ? v + 1 : v, t]);
    for (let i = 1; i < f.length; i++) if (f[i][0] < f[i - 1][0]) f[i][0] = f[i - 1][0];   // never backwards
    timeAt[k] = v => { let i = 1; while (i < f.length - 1 && f[i][0] < v) i++; const [a, ta] = f[i - 1], [b, tb] = f[i]; return b > a ? ta + (tb - ta) * (v - a) / (b - a) : ta; };
  }
  const M = 25, won = {}, segs = [], cols = {};
  ready.forEach((k, i) => { const c = info(k).colour; cols[k] = ready.slice(0, i).some(j => cols[j] === c) ? (i === 1 ? "#ffffff" : "#9ca3af") : c; });   // teammates: a second colour
  for (let s = 0; s < M; s++) {
    const a = s / M, b = (s + 1) / M;
    const best = ready.map(k => [k, timeAt[k](b) - timeAt[k](a)]).sort((x, y) => x[1] - y[1])[0][0];
    won[best] = (won[best] || 0) + 1;
    const i0 = frac.findIndex(v => v >= a), i1 = frac.findIndex(v => v >= b);
    const part = T.slice(Math.max(0, i0), (i1 < 0 ? n - 1 : i1) + 1);
    if (part.length > 1) segs.push(`<path d="${pathOf(part)}" fill="none" stroke="${cols[best]}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  svg.innerHTML = base + segs.join("");
  $("domKey").innerHTML = ready.map(k => { const d = dom.data[k];
    return `<span class="dk"><i style="background:${cols[k]}"></i>${tag(k)}<b>${lapText(d.lap.dur)}</b><small>Lap ${d.lap.n} · quickest on ${Math.round(100 * (won[k] || 0) / M)}% of the lap</small></span>`; }).join("")
    + (loading ? `<p class="empty">Loading…</p>` : "");
}

// ---------- car telemetry for the followed driver ----------
let tele = { n: null, from: 0, to: 0, rows: [], loading: false };
const WINDOW = 10 * 60000;   // one request covers ten minutes of the session
async function loadTele(n, at) {
  tele.loading = true;
  const from = at - 30000, to = from + WINDOW, mine = D;
  try {
    const rows = await of1(`car_data?session_key=${D.sess.session_key}&driver_number=${n}&date>=${iso(from)}&date<=${iso(to)}`, { ttl: 0 });
    if (!alive || D !== mine || following() !== n) return;
    tele = { n, from, to, rows: rows.map(r => ({ t: Date.parse(r.date), v: r.speed, g: r.n_gear, thr: r.throttle, brk: r.brake, rpm: r.rpm, drs: r.drs })).sort((a, b) => a.t - b.t), loading: false };
  } catch (e) { tele.loading = false; tele.failed = true; }
}
function renderTele() {
  const box = $("tele"), n = following(); if (!box) return;
  box.hidden = !n;
  if (!n) return;
  const at = R.t;
  if ((tele.n !== n || at < tele.from || at > tele.to - 20000) && !tele.loading) { if (tele.n !== n) tele = { n, from: 0, to: 0, rows: [], loading: false }; loadTele(n, at); }
  const rows = tele.n === n ? tele.rows : [];
  let i = -1, lo = 0, hi = rows.length - 1;   // the last reading at or before now
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].t <= at) { i = m; lo = m + 1; } else hi = m - 1; }
  const r = rows[i];
  const fresh = r && at - r.t < 5000;
  $("tSpeed").textContent = fresh ? r.v : "–"; $("tGear").textContent = fresh ? (r.g || "N") : "–"; $("tRpm").textContent = fresh ? (r.rpm || 0).toLocaleString() : "–";
  $("tDrs").textContent = fresh ? (r.drs >= 10 ? "OPEN" : "–") : "–"; $("tDrs").classList.toggle("on", !!(fresh && r.drs >= 10));
  $("tThr").style.width = (fresh ? Math.max(0, Math.min(100, r.thr)) : 0) + "%"; $("tBrk").style.width = (fresh && r.brk ? 100 : 0) + "%";
  $("tNote").textContent = tele.loading && !fresh ? "Loading car telemetry…" : !fresh ? "No car telemetry for this moment." : "Car telemetry from OpenF1, about 4 readings a second.";
  // the last 30 seconds of speed
  const span = rows.slice(Math.max(0, i - 120), i + 1).filter(x => x.t >= at - 30000);
  const c = info(n).colour;
  $("tTrace").innerHTML = span.length > 1 ? `<polyline points="${span.map(x => `${(300 * (1 - (at - x.t) / 30000)).toFixed(1)},${(58 - 54 * Math.min(1, x.v / 360)).toFixed(1)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/>` : "";
}
