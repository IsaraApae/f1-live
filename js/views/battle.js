// Lap battle: pick a session and two drivers, then watch their laps race each other round the circuit (a canvas "film"),
// compare the telemetry by distance, and save the film as a video to share.
import { $, $$, esc, clamp, store, hex, slug, lapText, photo, dtagHtml, skeleton, ICONS } from "../util.js";
import { of1 } from "../api.js";
import { season, currentSeason, allSessions } from "../season.js";
import { lapModel, Film, PRE, fmtLap, similar, videoType, startRecording } from "../battle-film.js";

const DAY = 86400000, FIRST_YEAR = 2023;
const iso = ms => new Date(ms).toISOString();
const over = s => !!(s && s.key && s.end < Date.now());
// a chosen lap rides along in the address with its car number: 16041 = car 16, lap 41 (car numbers stop at 99)
const withLap = (num, lap) => lap === "best" ? num : `${num}${String(lap).padStart(3, "0")}`;
const splitLap = v => v && v.length > 3 ? [v.slice(0, -3), String(+v.slice(-3))] : [v, "best"];
const SWAP = `<svg viewBox="0 0 24 24"><path d="M7 6h11.2l-2.6-2.6L17 2l5 5-5 5-1.4-1.4L18.2 8H7zm10 12H5.8l2.6 2.6L7 22l-5-5 5-5 1.4 1.4L5.8 16H17z"/></svg>`;
const RESTART = `<svg viewBox="0 0 24 24"><path d="M12 5V1.5L7 6l5 4.5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>`;
const REC = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5"/></svg>`;
const LINK = `<svg viewBox="0 0 24 24"><path d="M9.9 15.5 8.5 14.1l5.6-5.6 1.4 1.4zM7.1 19.8a4 4 0 0 1-2.9-6.8l2.8-2.8 1.4 1.4-2.8 2.8a2 2 0 1 0 2.8 2.8l2.8-2.8 1.4 1.4-2.8 2.8a4 4 0 0 1-2.7 1.2zm9.9-6L15.6 12.4l2.8-2.8a2 2 0 1 0-2.8-2.8l-2.8 2.8L11.4 8.2l2.8-2.8a4 4 0 1 1 5.6 5.6z"/></svg>`;

// ---------- small caches of our own (compact, so a few battles don't fill the browser's storage) ----------
function kept(key, ttl) { try { const x = JSON.parse(localStorage.getItem(key)); if (x && Date.now() - x.t < ttl) return x.v; } catch (e) {} return null; }
function keep(key, v) { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch (e) {} }
function keepTel(key, v) {   // telemetry: keep the newest couple of dozen laps
  try {
    const mine = Object.keys(localStorage).filter(k => k.startsWith("f1c:bt:tel:"));
    if (mine.length >= 24) mine.map(k => [k, (JSON.parse(localStorage.getItem(k)) || {}).t || 0]).sort((a, b) => a[1] - b[1]).slice(0, mine.length - 23).forEach(([k]) => localStorage.removeItem(k));
  } catch (e) {}
  keep(key, v);
}

// ---------- data ----------
// a session's drivers and every timed lap: { drivers: Map num -> driver, laps: { num: [lap] }, best: { num: lap }, order: [num, fastest first] }
async function sessionPack(sk, done) {
  const key = `f1c:bt:laps:${sk}`;
  let laps = done ? kept(key, 7 * DAY) : null;
  const [drv, raw] = await Promise.all([of1(`drivers?session_key=${sk}`, { ttl: done ? 7 * DAY : 0 }), laps ? null : of1(`laps?session_key=${sk}`)]);
  if (!laps) {
    laps = {};
    for (const l of raw) if (l.date_start && l.lap_duration) (laps[l.driver_number] = laps[l.driver_number] || []).push(
      [l.lap_number, Date.parse(l.date_start), l.lap_duration, l.duration_sector_1, l.duration_sector_2, l.duration_sector_3, l.is_pit_out_lap ? 1 : 0, l.st_speed]);
    if (done && raw.length) keep(key, laps);
  }
  const drivers = new Map();
  for (const d of drv) if (!drivers.has(String(d.driver_number))) drivers.set(String(d.driver_number), {
    num: String(d.driver_number), tla: d.name_acronym || String(d.driver_number), name: d.full_name ? d.full_name.replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase()) : `Car ${d.driver_number}`,
    team: d.team_name || "", colour: hex(d.team_colour), HeadshotUrl: d.headshot_url, FirstName: d.first_name, LastName: d.last_name, TeamName: d.team_name });
  const L = {}, best = {};
  for (const [num, list] of Object.entries(laps)) {
    if (!drivers.has(num)) drivers.set(num, { num, tla: `#${num}`, name: `Car ${num}`, team: "", colour: "#777777" });
    L[num] = list.map(([n, start, dur, s1, s2, s3, out, st]) => ({ n, start, dur, s: [s1, s2, s3], out: !!out, st })).sort((a, b) => a.n - b.n);
    const timed = L[num].filter(l => !l.out);
    if (timed.length) best[num] = timed.reduce((a, b) => b.dur < a.dur ? b : a);
  }
  const order = [...drivers.keys()].sort((a, b) => (best[a] ? best[a].dur : 1e9) - (best[b] ? best[b].dur : 1e9) || a - b);
  return { drivers, laps: L, best, order };
}
// one lap's car data and positions, with times in ms from the lap's start
async function telemetry(sk, num, lap, done) {
  const key = `f1c:bt:tel:${sk}:${num}:${lap.n}`, hit = done ? kept(key, 30 * DAY) : null;
  if (hit) return hit;
  const q = `session_key=${sk}&driver_number=${num}&date>=${iso(lap.start - 1500)}&date<=${iso(lap.start + lap.dur * 1000 + 1500)}`;
  const car = await of1(`car_data?${q}`), loc = await of1(`location?${q}`);
  const v = { c: car.map(c => [Date.parse(c.date) - lap.start, c.speed, c.throttle, c.brake, c.n_gear, c.rpm, c.drs]), l: loc.map(p => [Date.parse(p.date) - lap.start, p.x, p.y]) };
  if (done && v.c.length > 50 && v.l.length > 50) keepTel(key, v);
  return v;
}
// the circuit outline from MultiViewer (same units as OpenF1's positions)
const circuits = new Map();
function circuitOf(key, year) {
  if (!key) return Promise.resolve(null);
  const id = `${key}:${year}`;
  if (!circuits.has(id)) circuits.set(id, (async () => {
    const ck = `f1c:bt:mv:${id}`, hit = kept(ck, 30 * DAY);
    if (hit) return hit;
    for (const y of [year, year - 1, year - 2]) {
      try {
        const r = await fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${y}`);
        if (!r.ok) continue;
        const c = await r.json();
        if (!c || !c.x || c.x.length < 20) continue;
        const v = { x: c.x, y: c.y, rotation: c.rotation || 0, corners: (c.corners || []).map(k => ({ n: k.number, a: k.angle, x: k.trackPosition.x, y: k.trackPosition.y })) };
        keep(ck, v);
        return v;
      } catch (e) {}
    }
    return null;
  })());
  return circuits.get(id);
}

export default {
  title: "Lap battle",
  tab: "battle",
  async mount(el, params, app) {
    const S = { year: 0, maxYear: 0, rounds: [], round: null, sess: null, pack: null, a: null, b: null, lapA: "best", lapB: "best", tok: 0 };
    const V = { film: null, A: null, B: null, tl: 0, playing: false, speed: 1, raf: 0, last: 0, rec: null, urls: [], sheet: null, charts: null, token: 0, drag: false, retry: null };
    let alive = true;
    const live = () => alive && el.isConnected;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const look = () => store.get("f1.battleLook", "dark");

    el.innerHTML = `
      <section class="card bt-pick">${skeleton(3)}</section>
      <div class="bt-main">
        <section class="card bt-film">
          <div class="bt-stage" tabindex="0" aria-label="Lap battle film. Space plays or pauses, arrow keys skip."><div class="bt-wait"><span>Finding the latest session…</span></div></div>
          <div class="bt-ctls" hidden>
            <div class="bt-recbar" hidden><span class="dot"></span><b>Recording</b><span class="pct">0%</span><i><s></s></i><button class="btn small" type="button" data-act="cancel">Cancel</button></div>
            <div class="bt-bar">
              <button class="bt-play" type="button" aria-label="Play">${ICONS.play}</button>
              <span class="bt-now">0:00.000</span>
              <input class="bt-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Position in the lap">
              <span class="bt-len dim"></span>
            </div>
            <div class="bt-row">
              <div class="seg" data-g="speed" role="group" aria-label="Playback speed">${[0.25, 0.5, 1].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === 1}">${v}×</button>`).join("")}</div>
              <div class="bt-look"><span>Film</span><div class="seg" data-g="look" role="group" aria-label="Film style">${["dark", "light"].map(v => `<button type="button" data-v="${v}" aria-pressed="${look() === v}">${v === "dark" ? "Dark" : "Light"}</button>`).join("")}</div></div>
              <div class="bt-acts">
                <button class="btn small ghost" type="button" data-act="restart">${RESTART}Restart</button>
                <button class="btn small" type="button" data-act="link">${LINK}Copy link</button>
                <button class="btn small primary" type="button" data-act="rec">${REC}Save video</button>
              </div>
            </div>
          </div>
        </section>
        <aside class="bt-aside"><section class="card bt-sum"><h2 class="card-h">Head to head</h2>${skeleton(5)}</section></aside>
      </div>
      <section class="card bt-charts"><h2 class="card-h">Telemetry <small>by distance</small></h2>${skeleton(6)}</section>`;
    const pick = $(".bt-pick", el), stage = $(".bt-stage", el), ctls = $(".bt-ctls", el), sum = $(".bt-sum", el), charts = $(".bt-charts", el);
    app.setTools(`<button class="iconbtn" type="button" data-act="link" aria-label="Copy link to this battle" title="Copy link">${LINK}</button>`)
      .querySelector("[data-act=link]").addEventListener("click", copyLink);

    // ---------- picking a session and two drivers ----------
    const doneRounds = () => S.rounds.filter(r => r.sessions.some(over));
    const defaultSession = r => { const d = r.sessions.filter(over); return d.filter(s => s.kind === "q" || s.kind === "race").pop() || d.pop() || null; };
    const lapOf = (num, pick) => { const P = S.pack; if (!P || !num) return null; return pick === "best" ? P.best[num] || null : (P.laps[num] || []).find(l => String(l.n) === String(pick)) || null; };

    function pickerHtml() {
      const years = []; for (let y = S.maxYear; y >= FIRST_YEAR; y--) years.push(y);
      const rounds = doneRounds(), sess = S.round ? S.round.sessions.filter(over) : [];
      const side = k => {
        const P = S.pack, num = S[k], d = P && P.drivers.get(num), lapPick = k === "a" ? S.lapA : S.lapB, K = k.toUpperCase();
        if (!P) return `<div class="bt-who ${k}"><span class="face"></span><div class="sel"><select class="pick" disabled><option>Loading drivers…</option></select><select class="pick" disabled><option>Lap</option></select></div></div>`;
        const opts = P.order.map(n => { const x = P.drivers.get(n), b = P.best[n];
          return `<option value="${esc(n)}" style="color:${esc(x.colour)}"${n === num ? " selected" : ""}>${esc(`${x.tla} · ${x.name}${b ? "" : " (no timed lap)"}`)}</option>`; }).join("");
        const best = P.best[num], laps = P.laps[num] || [];
        const lapOpts = `<option value="best">${esc(best ? `Fastest · L${best.n} · ${lapText(best.dur)}` : "Fastest")}</option>` +
          laps.map(l => `<option value="${l.n}"${String(l.n) === String(lapPick) ? " selected" : ""}>${esc(`Lap ${l.n} · ${lapText(l.dur)}${l.out ? " · out lap" : ""}`)}</option>`).join("");
        return `<div class="bt-who ${k}" style="--tc:${d ? esc(d.colour) : "var(--chip)"}">
          <span class="face bt-face">${d && d.HeadshotUrl ? `<img src="${esc(S.year >= new Date().getFullYear() ? photo(d, 96, S.year) : d.HeadshotUrl)}" data-f="${esc(d.HeadshotUrl)}" alt=""
            onerror="if(this.dataset.f){this.src=this.dataset.f;this.dataset.f=''}else this.remove()">` : ""}</span>
          <div class="sel">
            <select class="pick bt-drv" data-k="${k}" aria-label="Driver ${K}">${opts}</select>
            <select class="pick bt-lap" data-k="lap${K}" aria-label="Lap for driver ${K}">${lapOpts}</select>
          </div>
        </div>`;
      };
      return `<div class="bt-where">
          <label class="bt-f y"><span>Season</span><select class="pick" data-k="year">${years.map(y => `<option value="${y}"${y === S.year ? " selected" : ""}>${y}</option>`).join("")}</select></label>
          <label class="bt-f r"><span>Weekend</span><select class="pick" data-k="round"${rounds.length ? "" : " disabled"}>${rounds.length ? rounds.map(r =>
            `<option value="${r.round}"${r === S.round ? " selected" : ""}>${esc(`R${r.round} · ${r.name.replace(/ Grand Prix$/, " GP")}`)}</option>`).join("") : "<option>No finished weekends yet</option>"}</select></label>
          <label class="bt-f s"><span>Session</span><select class="pick" data-k="sess"${sess.length ? "" : " disabled"}>${sess.map(s =>
            `<option value="${s.key}"${s === S.sess ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
        </div>
        <div class="bt-duel">
          ${side("a")}
          <div class="bt-vs"><span>VS</span><button class="iconbtn bt-swap" type="button" data-act="swap" aria-label="Swap drivers" title="Swap drivers"${S.pack ? "" : " disabled"}>${SWAP}</button></div>
          ${side("b")}
        </div>`;
    }
    const renderPicker = () => { if (live()) pick.innerHTML = pickerHtml(); };

    pick.addEventListener("change", e => {
      const k = e.target.dataset.k, v = e.target.value;
      if (!k || V.rec) return;
      if (k === "year") chooseYear(+v);
      else if (k === "round") chooseRound(S.rounds.find(r => String(r.round) === v));
      else if (k === "sess") chooseSession(S.round.sessions.find(s => String(s.key) === v));
      else if (k === "a" || k === "b") {
        const o = k === "a" ? "b" : "a";
        if (v === S[o]) S[o] = S[k];   // picked the other side's driver: swap them
        S[k] = v; S.lapA = S.lapB = "best";
        renderPicker(); loadBattle();
      } else if (k === "lapA" || k === "lapB") { S[k] = v; loadBattle(); }
    });
    pick.addEventListener("click", e => {
      if (!e.target.closest("[data-act=swap]") || !S.pack || V.rec) return;
      [S.a, S.b, S.lapA, S.lapB] = [S.b, S.a, S.lapB, S.lapA];
      renderPicker(); loadBattle();
    });

    async function chooseYear(y) {
      const my = ++S.tok;
      S.year = y; S.rounds = []; S.round = S.sess = S.pack = null; renderPicker(); wait("Loading the season…");
      try {
        const s = await season(y);
        if (my !== S.tok || !live()) return;
        S.rounds = s.rounds;
        const r = doneRounds().pop();
        if (!r) { renderPicker(); message(`No finished sessions in ${y} yet.`); clearBelow(); return; }
        chooseRound(r);
      } catch (e) { if (my === S.tok) failed(() => chooseYear(y)); }
    }
    function chooseRound(r) {
      if (!r) return;
      S.round = r;
      chooseSession(defaultSession(r));
    }
    async function chooseSession(s, want) {
      const my = ++S.tok;
      S.sess = s; S.pack = null; renderPicker();
      if (!s) { message("No finished sessions at this weekend yet."); clearBelow(); return; }
      wait("Loading lap times…");
      try {
        const P = await sessionPack(s.key, s.end < Date.now() - 3600000);
        if (my !== S.tok || !live()) return;
        S.pack = P;
        const ok = n => n && P.drivers.has(n);
        // keep the same two drivers when moving to another session, if they're in it
        const [a, b] = want && ok(want[0]) && ok(want[1]) && want[0] !== want[1] ? want : ok(S.a) && ok(S.b) && S.a !== S.b && P.best[S.a] && P.best[S.b] ? [S.a, S.b] : P.order;
        S.a = a; S.b = b;
        const laps = want && want[2];
        S.lapA = laps && lapOf(a, laps[0]) ? laps[0] : "best"; S.lapB = laps && lapOf(b, laps[1]) ? laps[1] : "best";
        renderPicker();
        if (!Object.keys(P.laps).length) { message("OpenF1 has no lap times for this session yet. Try again a little later."); clearBelow(); return; }
        loadBattle();
      } catch (e) { if (my === S.tok && live()) failed(() => chooseSession(s, want)); }
    }

    // ---------- the address: #/battle/session/A/B ----------
    // only the part after # may change: the router follows hashchange, which Back doesn't fire if the ?query differs too
    function setUrl() {
      if (!S.sess || !S.a || !S.b) return;
      history.replaceState(history.state, "", `${location.pathname}${location.search}#/battle/${S.sess.key}/${withLap(S.a, S.lapA)}/${withLap(S.b, S.lapB)}`);
    }
    async function copyLink() {
      const url = location.href;
      try { await navigator.clipboard.writeText(url); app.toast(`<div><b>Link copied</b><br><span class="dim">It opens this exact battle.</span></div>`, { ms: 3500 }); }
      catch (e) { app.toast(`<div><b>Copy this link</b><input class="bt-copy" value="${esc(url)}" readonly onfocus="this.select()"></div>`); }
    }

    // ---------- the stage: waiting, messages, errors ----------
    function stopFilm() {
      if (V.rec) finishRecording(true);
      V.token++;   // any battle still loading is now out of date
      V.playing = false; if (V.raf) cancelAnimationFrame(V.raf); V.raf = 0;
      V.film = null; V.charts = null; ctls.hidden = true;
    }
    function wait(text) { stopFilm(); stage.innerHTML = `<div class="bt-wait"><span>${esc(text)}</span></div>`; }
    function message(text) { stopFilm(); stage.innerHTML = `<div class="bt-wait msg"><span>${esc(text)}</span></div>`; }
    function failed(retry) {
      stopFilm(); V.retry = retry;
      stage.innerHTML = `<div class="bt-wait msg"><span><b>OpenF1 is busy or unavailable right now.</b><br>Its free service limits how often we can ask. Give it a moment.</span><button class="btn primary small" type="button" data-act="retry">Try again</button></div>`;
    }
    function clearBelow() {
      sum.innerHTML = `<h2 class="card-h">Head to head</h2><p class="note-line">Pick two drivers with a timed lap.</p>`;
      charts.innerHTML = `<h2 class="card-h">Telemetry <small>by distance</small></h2><p class="note-line">The charts appear with the film.</p>`;
    }

    // ---------- loading one battle ----------
    async function loadBattle() {
      setUrl();
      const P = S.pack, la = lapOf(S.a, S.lapA), lb = lapOf(S.b, S.lapB);
      if (!S.a || !S.b) { message("This session doesn't have two drivers with lap times."); clearBelow(); return; }
      if (!la || !lb) {
        const who = [!la && S.a, !lb && S.b].filter(Boolean).map(n => P.drivers.get(n).tla).join(" and ");
        message(`${who} ${who.includes(" and ") ? "have" : "has"} no timed lap in this session. Pick another driver or session.`); clearBelow(); return;
      }
      wait("Loading telemetry…");
      const my = V.token;
      sum.innerHTML = `<h2 class="card-h">Head to head</h2>${skeleton(5)}`;
      charts.innerHTML = `<h2 class="card-h">Telemetry <small>by distance</small></h2>${skeleton(6)}`;
      const s = S.sess, done = s.end < Date.now() - 3600000;
      try {
        let ck = S.round.circuitKey;
        if (!ck) ck = ((await of1(`sessions?session_key=${s.key}`, { ttl: 7 * DAY }))[0] || {}).circuit_key;
        const [ta, tb, circ] = await Promise.all([telemetry(s.key, S.a, la, done), telemetry(s.key, S.b, lb, done), circuitOf(ck, S.year)]);
        if (my !== V.token || !live()) return;
        const da = P.drivers.get(S.a), db = P.drivers.get(S.b);
        const thin = [[ta, da, la], [tb, db, lb]].filter(([t]) => t.c.length < 30).map(([, d, l]) => `${d.tla}'s lap ${l.n}`);
        if (thin.length) { message(`OpenF1 doesn't have car data for ${thin.join(" or ")} yet. Try another lap.`); clearBelow(); return; }
        const mA = lapModel(ta, la.dur), mB = lapModel(tb, lb.dur);
        if (!circ && !mA.hasPos) { message(`There's no track map or car position data for ${da.tla}'s lap. Try another lap.`); clearBelow(); return; }
        const L = (mA.total + mB.total) / 2;   // both laps stretched to one shared length, so they start and finish together
        mA.setLength(L); mB.setLength(L);
        V.A = { m: mA, tla: da.tla, num: da.num, team: da.team, colour: da.colour, sectors: la.s, lap: la, d: da };
        V.B = { m: mB, tla: db.tla, num: db.num, team: db.team, colour: db.colour, sectors: lb.s, lap: lb, d: db };
        V.L = L;
        show(circ);
      } catch (e) { console.error(e); if (my === V.token && live()) failed(loadBattle); }
    }

    // ---------- the film ----------
    function show(circ) {
      const A = V.A, B = V.B;
      stage.innerHTML = `<canvas class="bt-canvas" aria-hidden="true"></canvas>
        <button class="bt-big" type="button" aria-label="Play">${ICONS.play}</button>`;
      const canvas = $("canvas", stage);
      V.film = new Film(canvas, { A, B, outline: circ, style: look(), title: S.round.name,
        sub: `${S.year} · ${S.sess.name} · ${A.tla} lap ${A.lap.n} vs ${B.tla} lap ${B.lap.n}` });
      V.tl = 0; V.playing = false;
      ctls.hidden = false;
      const scrub = $(".bt-scrub", ctls);
      scrub.max = Math.round(V.film.total * 100); scrub.value = 0;
      $(".bt-len", ctls).textContent = fmtLap(V.film.end);
      fit();
      document.fonts && document.fonts.load(`900 20px "Titillium Web"`).then(() => { if (V.film) paint(); }).catch(() => {});
      buildCharts();
      stats();
      sum.innerHTML = summaryHtml();
      if (!reduce) play(); else paint();
    }
    function fit() {
      const f = V.film; if (!f) return;
      f.size(stage.clientWidth || 600);
      f.c.style.aspectRatio = `${f.lay.W} / ${f.lay.H}`;
      paint();
    }
    function paint() {
      const f = V.film; if (!f) return;
      f.draw(V.tl);
      const t = V.tl - PRE;
      $(".bt-now", ctls).textContent = fmtLap(clamp(t, 0, f.end));
      if (!V.drag) $(".bt-scrub", ctls).value = Math.round(V.tl * 100);
      cursor(t);
      if (V.rec) { const p = Math.round(V.tl / f.total * 100); $(".bt-recbar .pct", ctls).textContent = `${p}%`; $(".bt-recbar s", ctls).style.width = `${p}%`; }
    }
    function tick(now) {
      V.raf = 0;
      if (!V.film || !live()) return;
      if (V.playing) {
        V.tl += Math.min(0.1, (now - V.last) / 1000) * V.speed;   // a stall (or a hidden tab) slows the film rather than jumping it
        if (V.tl >= V.film.total) { V.tl = V.film.total; V.playing = false; }
      }
      V.last = now;
      paint();
      if (V.playing) V.raf = requestAnimationFrame(tick);
      else { playIcon(); if (V.rec && V.tl >= V.film.total) finishRecording(false); }
    }
    function kick() { if (!V.raf) { V.last = performance.now(); V.raf = requestAnimationFrame(tick); } }
    function play() { if (!V.film) return; if (V.tl >= V.film.total) V.tl = 0; V.playing = true; playIcon(); kick(); }
    function pause() { V.playing = false; playIcon(); kick(); }
    function seekTo(tl) { if (!V.film) return; V.tl = clamp(tl, 0, V.film.total); kick(); }
    function playIcon() {
      const b = $(".bt-play", ctls); b.innerHTML = V.playing ? ICONS.pause : ICONS.play; b.setAttribute("aria-label", V.playing ? "Pause" : "Play");
      const big = $(".bt-big", stage); if (big) big.hidden = V.playing || !!V.rec || !V.film || V.tl >= V.film.total;   // at the end the film shows the result instead
    }

    ctls.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b || !V.film) return;
      if (b.dataset.act === "cancel") return finishRecording(true);
      if (V.rec) return;
      if (b.classList.contains("bt-play")) return V.playing ? pause() : play();
      const g = b.closest(".seg");
      if (g) {
        for (const x of $$("button", g)) x.setAttribute("aria-pressed", x === b);
        if (g.dataset.g === "speed") V.speed = +b.dataset.v;
        else { store.set("f1.battleLook", b.dataset.v); V.film.setStyle(b.dataset.v); kick(); }
        return;
      }
      const act = b.dataset.act;
      if (act === "restart") { V.tl = 0; play(); }
      else if (act === "link") copyLink();
      else if (act === "rec") record();
    });
    const scrub = $(".bt-scrub", ctls);
    scrub.addEventListener("input", () => seekTo(+scrub.value / 100));
    scrub.addEventListener("pointerdown", () => { V.drag = true; });
    for (const ev of ["pointerup", "pointercancel", "change"]) scrub.addEventListener(ev, () => { V.drag = false; });
    stage.addEventListener("click", e => {
      if (e.target.closest("[data-act=retry]")) return V.retry && V.retry();
      if (!V.film || V.rec) return;
      if (e.target.closest(".bt-big, canvas")) V.playing ? pause() : play();
    });
    stage.addEventListener("keydown", e => {
      if (!V.film || V.rec) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); V.playing ? pause() : play(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); seekTo(V.tl + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : 1)); }
    });
    const ro = new ResizeObserver(() => { if (V.film && !V.film.fixed) fit(); if (V.charts && Math.abs(V.charts.box.clientWidth - V.charts.W) > 4) buildCharts(); });
    ro.observe(stage); ro.observe(charts);

    // ---------- charts: speed, pedals, gear and the time delta, by distance ----------
    function buildCharts() {
      const A = V.A, B = V.B, L = V.L, alt = similar(A.colour, B.colour);
      const ca = A.colour, cb = alt ? "var(--text)" : B.colour;
      charts.style.setProperty("--ca", ca); charts.style.setProperty("--cb", cb);
      const key = (D, c) => `<span class="bt-key"><i style="background:${c}"></i>${esc(D.tla)} · L${D.lap.n}</span>`;
      if (!$(".bt-chart", charts)) charts.innerHTML = `<h2 class="card-h">Telemetry <small class="bt-keys"></small></h2><div class="bt-chart"></div>`;
      $(".bt-keys", charts).innerHTML = `${key(A, ca)}${key(B, cb)}`;
      const box = $(".bt-chart", charts), W = Math.max(280, Math.round(box.clientWidth || 600)), phone = W < 560;
      const padL = 40, padR = 10, w = W - padL - padR, xOf = d => padL + d / L * w;
      const N = clamp(Math.round(w), 200, 900), D = Array.from({ length: N }, (_, i) => i / (N - 1) * L);
      const ta = D.map(d => A.m.timeAt(d)), tb = D.map(d => B.m.timeAt(d));
      const sa = ta.map(t => A.m.tel(t)), sb = tb.map(t => B.m.tel(t)), delta = ta.map((t, i) => t - tb[i]);
      const f1 = v => v.toFixed(1), parts = [], P = {};
      let y = 30;
      const panel = (id, h, title) => { P[id] = { y0: y, y1: y + h, h }; parts.push(`<text class="t" x="${padL}" y="${y - 7}">${title}</text>`); y += h + 24; return P[id]; };
      // corners along the top
      const corners = V.film.corners.filter(k => k.d > 0 && k.d < L).sort((a, b) => a.d - b.d);
      // speed
      const sp = panel("speed", phone ? 120 : 160, "Speed km/h");
      const all = sa.concat(sb).map(v => v.speed), lo = Math.floor(Math.min(...all) / 50) * 50, hi = Math.ceil(Math.max(...all) / 50) * 50;
      const ySp = v => sp.y1 - (v - lo) / (hi - lo || 1) * sp.h;
      for (let v = Math.ceil(lo / 100) * 100; v <= hi; v += 100) parts.push(`<line class="g" x1="${padL}" x2="${W - padR}" y1="${f1(ySp(v))}" y2="${f1(ySp(v))}"/><text class="a" x="${padL - 6}" y="${f1(ySp(v) + 3.5)}" text-anchor="end">${v}</text>`);
      const line = (vals, yOf) => "M" + vals.map((v, i) => `${f1(xOf(D[i]))},${f1(yOf(v))}`).join("L");
      parts.push(`<path class="l" d="${line(sb.map(s => s.speed), ySp)}" stroke="var(--cb)"/><path class="l" d="${line(sa.map(s => s.speed), ySp)}" stroke="var(--ca)"/>`);
      // throttle: one strip per driver, filled by how far down the pedal is
      const th = panel("thr", 28, "Throttle");
      const strip = (vals, top, h, c) => `<path d="M${f1(xOf(0))},${top + h}L${vals.map((v, i) => `${f1(xOf(D[i]))},${f1(top + h - v / 100 * h)}`).join("L")}L${f1(xOf(L))},${top + h}Z" fill="${c}" opacity=".85"/>`;
      parts.push(strip(sa.map(s => s.thr), th.y0, 12, "var(--ca)"), strip(sb.map(s => s.thr), th.y0 + 16, 12, "var(--cb)"));
      parts.push(`<text class="a" x="${padL - 6}" y="${th.y0 + 10}" text-anchor="end">${esc(A.tla)}</text><text class="a" x="${padL - 6}" y="${th.y0 + 26}" text-anchor="end">${esc(B.tla)}</text>`);
      // brake: marks where each driver is on the brakes
      const br = panel("brk", 18, "Brake");
      const runs = (vals, top, h, c) => { let d = "", s = -1; vals.forEach((v, i) => { if (v.brk > 50 && s < 0) s = i; if ((v.brk <= 50 || i === vals.length - 1) && s >= 0) { d += `M${f1(xOf(D[s]))},${top}H${f1(Math.max(xOf(D[i]), xOf(D[s]) + 1.5))}V${top + h}H${f1(xOf(D[s]))}Z`; s = -1; } }); return `<path d="${d}" fill="${c}"/>`; };
      parts.push(runs(sa, br.y0, 7, "var(--ca)"), runs(sb, br.y0 + 10, 7, "var(--cb)"));
      parts.push(`<text class="a" x="${padL - 6}" y="${br.y0 + 7}" text-anchor="end">${esc(A.tla)}</text><text class="a" x="${padL - 6}" y="${br.y0 + 17}" text-anchor="end">${esc(B.tla)}</text>`);
      // gear
      const gr = panel("gear", phone ? 54 : 64, "Gear");
      const yG = g => gr.y1 - (clamp(g, 1, 8) - 1) / 7 * gr.h;
      for (const g of [2, 4, 6, 8]) parts.push(`<line class="g" x1="${padL}" x2="${W - padR}" y1="${f1(yG(g))}" y2="${f1(yG(g))}"/><text class="a" x="${padL - 6}" y="${f1(yG(g) + 3.5)}" text-anchor="end">${g}</text>`);
      const steps = vals => `M${f1(xOf(D[0]))},${f1(yG(vals[0]))}` + vals.map((g, i) => `H${f1(xOf(D[i]))}V${f1(yG(g))}`).join("");
      parts.push(`<path class="l thin" d="${steps(sb.map(s => s.gear))}" stroke="var(--cb)"/><path class="l thin" d="${steps(sa.map(s => s.gear))}" stroke="var(--ca)"/>`);
      // delta: A's time minus B's at each point; above the line B is ahead
      const dl = panel("delta", phone ? 84 : 104, "Delta s");
      const M = Math.max(0.1, Math.ceil(Math.max(...delta.map(Math.abs)) * 10) / 10), yZ = dl.y0 + dl.h / 2, yD = v => yZ - v / M * dl.h / 2;
      for (const v of [M, 0, -M]) parts.push(`<line class="g${v ? "" : " z"}" x1="${padL}" x2="${W - padR}" y1="${f1(yD(v))}" y2="${f1(yD(v))}"/><text class="a" x="${padL - 6}" y="${f1(yD(v) + 3.5)}" text-anchor="end">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}</text>`);
      const area = `M${f1(xOf(0))},${f1(yZ)}L${delta.map((v, i) => `${f1(xOf(D[i]))},${f1(yD(v))}`).join("L")}L${f1(xOf(L))},${f1(yZ)}Z`;
      parts.push(`<clipPath id="btUp"><rect x="0" y="${dl.y0 - 2}" width="${W}" height="${f1(yZ - dl.y0 + 2)}"/></clipPath><clipPath id="btDn"><rect x="0" y="${f1(yZ)}" width="${W}" height="${f1(dl.y1 - yZ + 2)}"/></clipPath>
        <path d="${area}" fill="var(--cb)" opacity=".22" clip-path="url(#btUp)"/><path d="${area}" fill="var(--ca)" opacity=".22" clip-path="url(#btDn)"/>
        <path class="l" d="${line(delta, yD)}" stroke="var(--text)"/>
        <text class="a" x="${W - padR - 4}" y="${dl.y0 + 11}" text-anchor="end" fill="var(--cb)">${esc(B.tla)} ahead</text><text class="a" x="${W - padR - 4}" y="${dl.y1 - 4}" text-anchor="end" fill="var(--ca)">${esc(A.tla)} ahead</text>`);
      // distance along the bottom, corners along the top
      const H = y - 4, step = phone ? 1000 : 500;
      for (let d = 0; d <= L; d += step) parts.push(`<line class="g" x1="${f1(xOf(d))}" x2="${f1(xOf(d))}" y1="${dl.y1}" y2="${dl.y1 + 4}"/>${d % 1000 === 0 ? `<text class="a" x="${f1(xOf(d))}" y="${dl.y1 + 15}" text-anchor="middle">${d ? `${d / 1000} km` : "0"}</text>` : ""}`);
      let lastX = -99;
      for (const k of corners) {
        const x = xOf(k.d);
        parts.push(`<line class="c" x1="${f1(x)}" x2="${f1(x)}" y1="${sp.y0}" y2="${dl.y1}"/>`);
        if (x - lastX > 13) { parts.push(`<text class="cn" x="${f1(x)}" y="11" text-anchor="middle">${esc(k.n)}</text>`); lastX = x; }
      }
      parts.push(`<line class="bt-cur" x1="0" x2="0" y1="${sp.y0}" y2="${dl.y1}"/><circle class="bt-dot" r="4" fill="var(--cb)"/><circle class="bt-dot" r="4" fill="var(--ca)"/><circle class="bt-dot" r="3.5" fill="var(--text)"/>
        <rect class="bt-hit" x="${padL}" y="0" width="${w}" height="${H}" fill="transparent"/>`);
      box.innerHTML = `<svg viewBox="0 0 ${W} ${H + 18}" width="${W}" height="${H + 18}" role="img" aria-label="Speed, throttle, brake, gear and time delta for ${esc(A.tla)} and ${esc(B.tla)} by distance">${parts.join("")}</svg>`;
      const svg = $("svg", box), [dB, dA, dD] = $$(".bt-dot", svg);
      V.charts = { box, W, xOf, ySp, yD, cur: $(".bt-cur", svg), dA, dB, dD };
      // tap or drag on the charts to jump the film to that point of the lap
      const hit = $(".bt-hit", svg);
      const go = e => { const r = svg.getBoundingClientRect(), d = clamp((e.clientX - r.left) * (W / r.width) - padL, 0, w) / w * L; seekTo(Math.min(A.m.timeAt(d), B.m.timeAt(d)) + PRE); };
      hit.addEventListener("pointerdown", e => { if (V.rec) return; hit.setPointerCapture(e.pointerId); go(e); });
      hit.addEventListener("pointermove", e => { if (hit.hasPointerCapture(e.pointerId)) go(e); });
      cursor(V.tl - PRE);
    }
    function cursor(t) {
      const C = V.charts; if (!C || !V.A) return;
      const A = V.A.m, B = V.B.m, da = A.dist(t), db = B.dist(t), dc = Math.max(da, db), x = C.xOf(dc).toFixed(1);
      C.cur.setAttribute("x1", x); C.cur.setAttribute("x2", x);
      C.dA.setAttribute("cx", C.xOf(da).toFixed(1)); C.dA.setAttribute("cy", C.ySp(A.tel(t).speed).toFixed(1));
      C.dB.setAttribute("cx", C.xOf(db).toFixed(1)); C.dB.setAttribute("cy", C.ySp(B.tel(t).speed).toFixed(1));
      C.dD.setAttribute("cx", x); C.dD.setAttribute("cy", C.yD(A.timeAt(dc) - B.timeAt(dc)).toFixed(1));
    }

    // ---------- head to head ----------
    function stats() {   // on a fixed 5 m grid, so every screen size shows the same numbers
      const A = V.A, B = V.B, L = V.L, N = Math.round(L / 5) + 1, D = Array.from({ length: N }, (_, i) => i / (N - 1) * L);
      const ta = D.map(d => A.m.timeAt(d)), tb = D.map(d => B.m.timeAt(d)), sa = ta.map(t => A.m.tel(t)), sb = tb.map(t => B.m.tel(t));
      const pct = (arr, f) => arr.filter(f).length / arr.length * 100, of = s => ({ top: Math.max(...s.map(x => x.speed)), full: pct(s, x => x.thr >= 98), brake: pct(s, x => x.brk > 50) });
      V.stats = { a: of(sa), b: of(sb) };
      // where the most time changed hands: the biggest swing in the delta over 250 m
      const span = 50, delta = ta.map((t, i) => t - tb[i]);
      let swing = { v: 0, i: 0 };
      for (let i = 0; i + span < N; i++) { const v = delta[i + span] - delta[i]; if (Math.abs(v) > Math.abs(swing.v)) swing = { v, i }; }
      const mid = D[Math.min(N - 1, swing.i + span / 2)], near = V.film.corners.reduce((a, k) => !a || Math.abs(k.d - mid) < Math.abs(a.d - mid) ? k : a, null);
      V.swing = { who: swing.v > 0 ? B : A, by: Math.abs(swing.v), where: near && Math.abs(near.d - mid) < 400 ? `around turn ${near.n}` : `at ${(mid / 1000).toFixed(1)} km` };
    }
    function summaryHtml() {
      const A = V.A, B = V.B, la = A.lap, lb = B.lap, ga = V.stats.a, gb = V.stats.b, alt = similar(A.colour, B.colour);
      const has = v => v != null && isFinite(v);
      const rows = [["Lap time", la.dur, lb.dur, -1, lapText], ["Sector 1", la.s[0], lb.s[0], -1, v => v.toFixed(3)], ["Sector 2", la.s[1], lb.s[1], -1, v => v.toFixed(3)],
        ["Sector 3", la.s[2], lb.s[2], -1, v => v.toFixed(3)], ["Top speed", ga.top, gb.top, 1, v => `${Math.round(v)} km/h`], ["Speed trap", la.st, lb.st, 1, v => `${v} km/h`],
        ["Full throttle", ga.full, gb.full, 1, v => `${Math.round(v)}%`], ["On the brakes", ga.brake, gb.brake, 0, v => `${Math.round(v)}%`]];
      const cell = (v, o, better, f, c) => { const win = better && has(v) && has(o) && (better < 0 ? v < o : v > o); return `<b class="${win ? "win" : ""}" style="--tc:${c}">${has(v) ? esc(f(v)) : "–"}</b>`; };
      const mini = V.film.mini, wa = mini.filter(m => m.win === "A").length, gapAll = Math.abs(la.dur - lb.dur), fast = la.dur <= lb.dur ? A : B;
      const sw = V.swing, secs = [0, 1, 2].filter(k => has(la.s[k]) && has(lb.s[k])).map(k => [k, la.s[k] - lb.s[k]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
      return `<h2 class="card-h">Head to head <small>${esc(S.sess.name)}</small></h2>
        <div class="bt-h2h">
          <div class="hd"><span></span>${dtagHtml(A.num, A.tla, A.colour, true)}${dtagHtml(B.num, B.tla, B.colour, true)}</div>
          ${rows.map(([label, a, b, better, f]) => `<div class="r"><span>${label}</span>${cell(a, b, better, f, A.colour)}${cell(b, a, better, f, alt ? "var(--text)" : B.colour)}</div>`).join("")}
        </div>
        <ul class="bt-notes">
          <li>${gapAll ? `<b>${esc(fast.tla)}</b> was quicker by <b>${gapAll.toFixed(3)}s</b>.` : "Identical lap times."}</li>
          <li><b>${esc(A.tla)}</b> was faster in ${wa} of ${mini.length} mini-sectors, <b>${esc(B.tla)}</b> in ${mini.length - wa}.</li>
          ${secs && Math.abs(secs[1]) >= 0.001 ? `<li>Biggest sector gap: <b>${esc((secs[1] < 0 ? A : B).tla)}</b> by ${Math.abs(secs[1]).toFixed(3)}s in sector ${secs[0] + 1}.</li>` : ""}
          ${sw && sw.by >= 0.01 ? `<li>Most time gained in one place: <b>${esc(sw.who.tla)}</b>, ${sw.by.toFixed(3)}s ${esc(sw.where)}.</li>` : ""}
        </ul>`;
    }

    // ---------- saving the film as a video ----------
    async function record() {
      if (!V.film || V.rec) return;
      const type = videoType();
      if (!type || !V.film.c.captureStream) { app.toast(`<div><b>This browser can't record video.</b><br><span class="dim">Try a recent Chrome, Edge, Firefox or Safari.</span></div>`); return; }
      V.playing = false;
      V.film.fix(true); paint();
      try { V.rec = startRecording(V.film.c, type); }
      catch (e) { console.error(e); V.film.fix(false); fit(); app.toast(`<div><b>Recording couldn't start.</b></div>`); return; }
      V.keepSpeed = V.speed; V.speed = 1;
      el.classList.add("bt-recording"); $(".bt-recbar", ctls).hidden = false;
      V.tl = 0; play();
    }
    async function finishRecording(cancel) {
      const R = V.rec; if (!R) return;
      V.rec = null; R.stop();
      let blob = null;
      try { blob = await R.done; } catch (e) { console.error(e); }
      el.classList.remove("bt-recording");
      if (V.keepSpeed) V.speed = V.keepSpeed;
      $(".bt-recbar", ctls).hidden = true;
      if (V.film) { V.film.fix(false); fit(); playIcon(); }
      if (cancel || !live()) return;
      if (!blob || !blob.size) { app.toast(`<div><b>The recording came out empty.</b><br><span class="dim">Keep this tab in view while it records, then try again.</span></div>`); return; }
      offer(blob, R.type);
    }
    function offer(blob, type) {
      const A = V.A, B = V.B, ext = /mp4/.test(type) ? "mp4" : "webm";
      const name = `lap-battle-${A.tla}-vs-${B.tla}-${slug(S.round.name)}-${S.year}-${slug(S.sess.name)}.${ext}`.toLowerCase();
      const file = new File([blob], name, { type: blob.type });
      let canShare = false; try { canShare = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) {}
      closeSheet();
      const url = URL.createObjectURL(blob), secs = Math.round(V.film.total);
      V.urls.push(url);
      const sh = V.sheet = document.createElement("div");
      sh.dataset.url = url;
      sh.className = "sheet bt-sheet";
      sh.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Your lap battle video">
        <h3>Your video is ready <button class="x" type="button" aria-label="Close">✕</button></h3>
        <section>
          <video src="${url}" controls playsinline muted loop autoplay></video>
          <p class="dim">${esc(`${A.tla} vs ${B.tla} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · ${ext.toUpperCase()} · ${(blob.size / 1048576).toFixed(1)} MB`)}</p>
          <div class="bt-sheet-acts">
            ${canShare ? `<button class="btn primary" type="button" data-act="share">${ICONS.share}Share</button>` : ""}
            <a class="btn${canShare ? "" : " primary"}" href="${url}" download="${esc(name)}">${ICONS.download}Download</a>
          </div>
        </section></div>`;
      sh.addEventListener("click", e => {
        if (e.target === sh || e.target.closest(".x")) return closeSheet();
        if (e.target.closest("[data-act=share]")) navigator.share({ files: [file], title: `${A.tla} vs ${B.tla} · lap battle`, text: `${S.round.name} ${S.year} · ${S.sess.name}` }).catch(() => {});
      });
      document.body.append(sh);
      $(".x", sh).focus();
    }
    function closeSheet() {   // the video can be big: let the browser drop it
      if (!V.sheet) return;
      URL.revokeObjectURL(V.sheet.dataset.url); V.urls = V.urls.filter(u => u !== V.sheet.dataset.url);
      V.sheet.remove(); V.sheet = null;
    }
    const onKey = e => { if (e.key === "Escape" && V.sheet) closeSheet(); };
    // a hidden tab stops drawing: pause the recording with it so the video has no frozen stretch
    const onVis = () => { if (!V.rec) return; if (document.hidden) { V.rec.pause(); V.playing = false; } else { V.rec.resume(); play(); } };
    addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);

    // ---------- start: the session in the address, or the latest finished qualifying or race ----------
    async function start() {
      const my = ++S.tok;
      try {
        const cur = await currentSeason();
        if (my !== S.tok || !live()) return;
        S.maxYear = Math.max(cur.year, FIRST_YEAR);
        const [pa, la] = splitLap(params[1]), [pb, lb] = splitLap(params[2]);
        const want = pa && pb ? [pa, pb, [la, lb]] : null;
        let s = null, rounds = cur.rounds, year = cur.year;
        const find = rs => allSessions(rs).find(x => String(x.key) === String(params[0]));
        if (params[0]) {
          s = find(rounds);
          if (!s) {
            const info = (await of1(`sessions?session_key=${params[0]}`, { ttl: 7 * DAY }))[0];
            if (!info) { message("That session isn't in OpenF1. Pick another one."); }
            else { year = info.year; rounds = (await season(year)).rounds; s = find(rounds); }
          }
        }
        if (!s) {
          const last = rs => allSessions(rs).filter(x => over(x) && (x.kind === "q" || x.kind === "race")).sort((a, b) => b.end - a.end)[0];
          s = last(rounds);
          if (!s && cur.year > FIRST_YEAR) { year = cur.year - 1; rounds = (await season(year)).rounds; s = last(rounds); }
        }
        if (my !== S.tok || !live()) return;
        S.year = year; S.rounds = rounds;
        if (!s) { renderPicker(); message("No finished sessions yet. Come back after the first session of the season."); clearBelow(); return; }
        S.round = rounds.find(r => r.sessions.some(x => x.key === s.key));
        chooseSession(S.round.sessions.find(x => x.key === s.key), want);
      } catch (e) { console.error(e); if (my === S.tok && live()) { failed(start); pick.innerHTML = `<p class="note-line">The season couldn't load.</p>`; } }
    }
    start();

    return () => {
      alive = false;
      if (V.rec) { const R = V.rec; V.rec = null; R.stop(); }
      if (V.raf) cancelAnimationFrame(V.raf);
      ro.disconnect();
      closeSheet();
      for (const u of V.urls) URL.revokeObjectURL(u);
      removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
    };
  }
};
