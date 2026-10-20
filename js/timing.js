// The timing screen, used by the Live tab and by replays: live from Formula 1's own feed (the browser connects straight to it),
// or any past session rebuilt from OpenF1 in the live feed's shapes. Only one is on screen at a time.
import { esc, store, sleep, photo as photoOf, teamLogo as logoOf, ink, tagVars, slug, TYRES, lapText, ICONS, countdownHtml, fmtWhen, SHORT } from "./util.js";
import { of1, jolpica, forecast, forecastFor } from "./api.js";
import { currentSeason, season as seasonOf, allSessions } from "./season.js";
import * as A from "./analysis.js";
import * as G from "./geomap.js";

const FEED = /^ws:\/\/(localhost|127\.0\.0\.1):\d+$/.test(new URLSearchParams(location.search).get("feed") || "")   // a local test feed
  ? new URLSearchParams(location.search).get("feed") : "wss://livetiming.formula1.com/signalrcore";
const STATIC = "https://livetiming.formula1.com/static/";
const TOPICS = ["Heartbeat", "SessionInfo", "SessionStatus", "TrackStatus", "LapCount", "ExtrapolatedClock", "TimingData",
                "TimingAppData", "TimingStats", "DriverList", "WeatherData", "RaceControlMessages", "TeamRadio", "LapSeries", "PitLaneTimeCollection"];
const RS = "\u001e";

let S = {};                            // what's on screen, one object per F1 topic (the live feed's shapes; a replay fills the same)
let mode = "off";                      // live | replay | off (not on screen)
const prog = {};                       // live map: mini-sectors passed this lap per car
const segFrac = [];                    // live map: learned from clean laps, how far through a lap each mini-sector ends
const now = () => mode === "replay" ? R.t : Date.now();
let dirty = true, APP = null;

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const list = x => Array.isArray(x) ? x : x && typeof x === "object" ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : [];
const driver = n => ((S.DriverList || {})[n]) || {};
const colour = d => "#" + (d.TeamColour || "777777");
const year = () => +((S.SessionInfo && S.SessionInfo.StartDate || "").slice(0, 4)) || new Date().getFullYear();
const utc = t => typeof t === "number" ? t : Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t || "") ? t : t + "Z");   // F1 often leaves off the "Z" of UTC
const timeOf = t => new Date(utc(t)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: store.get("f1.clock", "24") === "12" });
const hhmm = t => new Date(utc(t)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });   // short, for the radio timeline
function seconds(t) { if (t == null || t === "") return null; if (typeof t === "number") return t; const p = String(t).split(":").map(Number); return p.reduce((a, b) => a * 60 + b, 0); }
const photo = (d, px) => photoOf(d, px, year());
const teamLogo = (team, white) => logoOf(team, white, year());
const dtag = (n, small) => { const d = driver(n), c = colour(d); return `<span class="dtag${small ? " small" : ""}" style="${tagVars(c)}"><span class="n">${esc(d.RacingNumber || n)}</span><span class="t">${esc(d.Tla || n)}</span></span>`; };
const segClass = s => ({ 2048: "y", 2049: "g", 2051: "p", 2064: "pit" })[s] || "";
const timeClass = x => x && x.OverallFastest ? "t-purple" : x && x.PersonalFastest ? "t-green" : "";
const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

function merge(target, delta) {        // F1 sends changes only; lists change by index ({"3": {...}})
  if (delta === null || typeof delta !== "object") return delta;
  if (Array.isArray(delta)) return delta;
  if (target === null || typeof target !== "object") target = {};
  for (const [k, v] of Object.entries(delta)) { if (k !== "_kf") target[k] = merge(target[k], v); }
  return target;
}

// ---------- live: F1's feed, straight into the browser ----------
const lapLog = [], pitLog = {};
const QUALI_BREAK = 7 * 60000;   // F1's break between Q1, Q2 and Q3
function apply(topic, data, ts) {
  S[topic] = merge(S[topic], data);
  if (topic === "LapCount" && S.LapCount && S.LapCount.CurrentLap && (!lapLog.length || lapLog[lapLog.length - 1].lap !== S.LapCount.CurrentLap))
    lapLog.push({ lap: S.LapCount.CurrentLap, at: ts });   // when the lap counter changed while the page was open
  if (topic === "TimingData") trackLive(ts);
  if (topic === "TeamRadio") radioArrived();
  if (topic === "PitLaneTimeCollection")   // live: F1 keeps only each car's latest stop, so remember them all
    for (const [n, x] of Object.entries((data || {}).PitTimes || {})) if (x && x.Duration && x.Lap) pitLog[n + "|" + x.Lap] = { n: x.RacingNumber || n, lap: +x.Lap, dur: +x.Duration };
  if (topic === "SessionInfo") { loadCircuit(); loadPlace(); }
  dirty = true;
}
function segmentsPassed(line) {
  let n = 0, total = 0;
  for (const sec of list(line && line.Sectors)) for (const seg of list(sec.Segments)) { total++; if (seg && seg.Status) n++; }
  return [n, total];
}
function trackLive(ts) {
  for (const [num, line] of Object.entries((S.TimingData || {}).Lines || {})) {
    const [n, total] = segmentsPassed(line);
    const p = prog[num] || (prog[num] = { n: -1, at: ts, marks: [] });
    if (n === p.n) continue;
    if (n < p.n) {                       // the marks reset: a new lap began at the previous lap's last mark
      const end = p.marks[p.total - 1], lap = seconds((line.LastLapTime || {}).Value) * 1000;
      if (p.start && end && p.marks.filter(Boolean).length === p.total && Math.abs(end - p.start - lap) < 2000) {
        for (let k = 0; k < p.total; k++) {   // a clean lap seen whole: learn where each mini-sector ends
          const f = (p.marks[k] - p.start) / (end - p.start);
          segFrac[k] = segFrac[k] == null ? f : segFrac[k] * 0.8 + f * 0.2;
        }
      }
      p.start = end || null; p.marks = []; p.n = 0;
    }
    for (let k = Math.max(0, p.n); k < n; k++) p.marks[k] = ts;
    p.n = n; p.at = ts; p.total = total;
  }
}
let ws, pingTimer, retryTimer, retry = 0;
function connect() {
  if (mode !== "live") return;
  setLive("connecting");
  ws = new WebSocket(FEED);
  const sock = ws;
  let subscribed = false, buffer = "";
  sock.onopen = () => sock.send(JSON.stringify({ protocol: "json", version: 1 }) + RS);
  sock.onmessage = e => {
    if (mode !== "live" || sock !== ws) return;
    buffer += e.data;
    const parts = buffer.split(RS); buffer = parts.pop();
    for (const part of parts) {
      if (!part) continue;
      let m; try { m = JSON.parse(part); } catch (err) { continue; }
      if (!subscribed) {           // handshake answered: ask for every topic
        subscribed = true; retry = 0;
        sock.send(JSON.stringify({ type: 1, invocationId: "1", target: "Subscribe", arguments: [TOPICS] }) + RS);
        clearInterval(pingTimer); pingTimer = setInterval(() => sock.readyState === 1 && sock.send(JSON.stringify({ type: 6 }) + RS), 15000);
        continue;
      }
      if (m.type === 3 && m.result) {  // the full state, then changes as they happen
        S = {}; radioSeen = null; rcSeen = null;
        for (const [topic, data] of Object.entries(m.result)) apply(topic, data, now());
      } else if (m.type === 1 && Array.isArray(m.arguments)) {
        const [topic, data, ts] = m.arguments;
        if (typeof topic === "string") apply(topic, data, utc(ts) || now());
      } else if (m.type === 7) sock.close();
    }
  };
  sock.onclose = () => {
    clearInterval(pingTimer);
    if (mode !== "live" || sock !== ws) return;   // left the page, or a replay closed it on purpose
    setLive("offline");
    retryTimer = setTimeout(connect, Math.min(30000, 2000 * 2 ** retry++));
  };
}
function setLive(state) {
  const el = $("live"); if (!el) return;
  el.className = "badge" + (state === "live" ? " red live" : state === "replay" ? " blue" : "");
  el.textContent = { live: "LIVE", replay: "REPLAY", connecting: "CONNECTING", offline: "OFFLINE", ended: "ENDED", waiting: "NOT STARTED", loading: "LOADING" }[state] || state;
}

// ---------- replay: any past session, rebuilt from OpenF1 ----------
export const R = { t: 0, start: 0, end: 0, playing: false, speed: 1, data: null, last: 0, dirty: false };
let replayToken = 0;
async function startReplay(key) {
  const token = ++replayToken;
  mode = "replay"; R.playing = false; R.data = null; S = {}; radioSeen = null; rcSeen = null; towerHead = ""; dirty = true; resetCars();
  if (ws) { const old = ws; ws = null; old.close(); }
  setLive("loading"); $("rbar").hidden = false; $("event").textContent = "Loading the replay…"; $("sub").textContent = "";
  try {
    const [sess] = await of1(`sessions?session_key=${key}`, { ttl: 7 * 86400000 });
    if (!sess) throw new Error("no such session");
    if (Date.parse(sess.date_end) > Date.now()) { $("event").textContent = "This session hasn't finished yet"; $("sub").textContent = "Replays are ready once a session is over. Watch it on the Live tab."; setLive("waiting"); return; }
    const names = ["drivers", "laps", "position", "stints", "pit", "race_control", "team_radio", "weather", "session_result"];
    if (sess.session_type === "Race") names.push("championship_drivers", "championship_teams");
    const got = {};
    for (const n of names) {
      if (token !== replayToken) return;
      $("sub").textContent = `${Math.round(100 * Object.keys(got).length / names.length)}%`;
      got[n] = await of1(`${n}?session_key=${key}`, { ttl: n === "position" || n === "laps" ? 0 : 7 * 86400000 });
    }
    const [meet] = await of1(`meetings?meeting_key=${sess.meeting_key}`, { ttl: 7 * 86400000 });
    got.extra = {};   // in the championship but not in this session: their latest team, and an older entry's photo
    for (const c of got.championship_drivers || []) {
      if (got.drivers.some(d => d.driver_number === c.driver_number) || token !== replayToken) continue;
      const all = (await of1(`drivers?driver_number=${c.driver_number}`, { ttl: 7 * 86400000 })).filter(d => !d.meeting_key || d.meeting_key <= sess.meeting_key);
      const last = all[all.length - 1];
      if (last) got.extra[c.driver_number] = { ...last, headshot_url: (all.slice().reverse().find(d => d.headshot_url) || {}).headshot_url };
    }
    if (token !== replayToken || mode !== "replay") return;
    R.data = prepare(sess, meet || {}, got);
    R.start = R.data.start; R.end = R.data.end; R.t = R.start; R.speed = store.get("f1.speed", 1); R.last = 0;
    for (const x of $("rSpeed").children) x.setAttribute("aria-pressed", String(+x.dataset.s === R.speed));
    buildReplay(); drawMarks(); setLive("replay"); R.playing = true; syncReplayBar();
    A.start(R.data);
    if (APP) APP.setTitle(`${SHORT[sess.session_name] || sess.session_name} · ${(R.data.meet.meeting_name || sess.country_name || "").replace("Grand Prix", "GP")}`);
  } catch (e) {
    if (token !== replayToken) return;
    $("event").textContent = "Couldn't load that replay"; $("sub").textContent = "OpenF1 didn't answer. Try again in a minute.";
    setLive("offline");
  }
}
function prepare(sess, meet, g) {
  const t = s => s ? Date.parse(s) : null;
  const byDriver = {};
  for (const l of g.laps) {
    const st = t(l.date_start); if (!st) continue;
    (byDriver[l.driver_number] = byDriver[l.driver_number] || []).push({ n: l.lap_number, start: st, dur: l.lap_duration,
      sec: [l.duration_sector_1, l.duration_sector_2, l.duration_sector_3], segs: [l.segments_sector_1 || [], l.segments_sector_2 || [], l.segments_sector_3 || []],
      st: l.st_speed, out: l.is_pit_out_lap });
  }
  for (const laps of Object.values(byDriver)) {
    laps.sort((a, b) => a.n - b.n);
    laps.forEach((l, i) => { const next = laps[i + 1]; if (!l.dur && next) l.dur = (next.start - l.start) / 1000; l.end = l.dur ? l.start + l.dur * 1000 : l.start + 120000; });
  }
  const all = Object.values(byDriver);
  const firstLap = Math.min(...all.map(l => l[0] ? l[0].start : Infinity));
  const lastEnd = Math.max(0, ...all.map(l => l.length ? l[l.length - 1].end : 0));
  // races: the scheduled time is when the formation lap begins; lights out is lap 1's start
  const sched = t(sess.date_start), form = sess.session_type === "Race" && isFinite(firstLap) && firstLap - sched > 60000 && firstLap - sched < 20 * 60000 ? { from: sched, to: firstLap } : null;
  const start = form ? form.from - 30000 : isFinite(firstLap) ? firstLap - 60000 : sched;
  return {
    sess, meet, byDriver, start, form, end: Math.max(lastEnd + 60000, start + 60000),
    totalLaps: Math.max(0, ...g.laps.map(l => l.lap_number || 0)),
    drivers: g.drivers, positions: g.position.map(p => ({ at: t(p.date), n: String(p.driver_number), p: p.position })).sort((a, b) => a.at - b.at),
    stints: g.stints, // OpenF1's pit time is near the END of the pit lane: checked against car positions (Singapore 2026), cars leave the track
    // about (lane time + 2) s before it and rejoin about 5.5 s after it
    pits: g.pit.map(p => { const at = t(p.date), lane = p.lane_duration || p.pit_duration || 25;
      return { at, n: String(p.driver_number), lap: p.lap_number, lane: p.lane_duration || p.pit_duration, dur: lane, in: at - (lane + 2) * 1000, out: at + 5500 }; }),
    // qualifying parts: starts (and restarts after a red flag) and chequered flags. OpenF1 sometimes leaves Q1 unlabelled: that's Q1
    ...(() => {
      const quali = /Qualifying|Shootout/.test(sess.session_name) && g.race_control.some(m => m.qualifying_phase);
      const of = re => quali ? g.race_control.filter(m => re.test(m.message)).map(m => ({ p: m.qualifying_phase || 1, at: t(m.date) })).sort((a, b) => a.at - b.at) : [];
      const parts = of(/SESSION STARTED/), stops = of(/SESSION ABORTED/).map(a => [a.at, (parts.find(x => x.at > a.at) || {}).at || a.at]);   // red-flag stoppages
      return { parts, qflags: of(/CHEQUERED FLAG/), stops };
    })(),
    rc: g.race_control.map(m => ({ at: t(m.date), m })).sort((a, b) => a.at - b.at),
    radio: g.team_radio.map(r => ({ at: t(r.date), n: String(r.driver_number), url: r.recording_url })).sort((a, b) => a.at - b.at),
    weather: g.weather.map(w => ({ at: t(w.date), w })).sort((a, b) => a.at - b.at),
    result: Object.fromEntries((g.session_result || []).map(r => [String(r.driver_number), r])),
    champD: g.championship_drivers || [], champT: g.championship_teams || [], extra: g.extra || {},
    lapPos: lapPositions(byDriver, g.position)
  };
}
function lapPositions(byDriver, positions) {   // [lap][driver] = position: lap 0 is the grid, then the order each lap was finished in
  const grid = {}; for (const p of positions) if (!(p.driver_number in grid)) grid[p.driver_number] = { p: p.position, at: Date.parse(p.date) };
  const rows = [Object.fromEntries(Object.entries(grid).map(([n, x]) => [n, x.p]))];
  const most = Math.max(0, ...Object.values(byDriver).map(l => l.length));
  for (let k = 1; k <= most; k++) {
    const done = Object.entries(byDriver).map(([n, laps]) => [n, (laps.find(l => l.n === k) || {}).end]).filter(([, e]) => e).sort((a, b) => a[1] - b[1]);
    rows.push(Object.fromEntries(done.map(([n, e], i) => [n, { p: i + 1, at: e }])));
  }
  return rows;
}
const upTo = (arr, at) => { let lo = 0, hi = arr.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].at <= at) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const fastest = laps => Math.min(Infinity, ...laps.filter(l => l.dur && !l.out).map(l => l.dur));
function buildReplay() {   // the session as it stood at R.t, in the live feed's shapes
  const D = R.data, at = R.t, s = D.sess, race = s.session_type === "Race";
  const first = !S.SessionInfo;
  S.SessionInfo = { Key: s.session_key, Name: s.session_name, Type: s.session_type, StartDate: s.date_start, Path: "",
                    Meeting: { Name: D.meet.meeting_name || s.country_name, Circuit: { Key: s.circuit_key }, Country: { Name: s.country_name } } };
  if (first) { loadCircuit(); loadPlace(); }
  S.DriverList = Object.fromEntries(D.drivers.map(d => [String(d.driver_number), { RacingNumber: String(d.driver_number), Tla: d.name_acronym, FirstName: d.first_name,
    LastName: d.last_name, TeamName: d.team_name, TeamColour: d.team_colour, HeadshotUrl: d.headshot_url }]));
  const done = {}; let bestLap = Infinity, bestST = 0; const bestSec = [Infinity, Infinity, Infinity];
  for (const [n, laps] of Object.entries(D.byDriver)) {
    done[n] = laps.filter(l => l.end <= at);
    bestLap = Math.min(bestLap, fastest(done[n]));
    for (const l of done[n]) { l.sec.forEach((v, i) => { if (v) bestSec[i] = Math.min(bestSec[i], v); }); if (l.st) bestST = Math.max(bestST, l.st); }
  }
  const everyone = [...new Set(D.drivers.map(d => String(d.driver_number)).concat(Object.keys(D.byDriver)))];
  let order, quali = null, classified = 0;
  if (race) {   // the running order; before the start, the grid
    const pos = {};
    for (const p of D.positions) { if (p.at > at) break; pos[p.n] = p.p; }
    for (const p of D.positions) if (!(p.n in pos)) pos[p.n] = p.p;
    order = everyone.sort((a, b) => (pos[a] || 99) - (pos[b] || 99));
    // once the winner has taken the flag: the official classification (OpenF1's laps can include an extra trip to the pits)
    const win = Object.values(D.result).find(r => r.position === 1), wl = win && (D.byDriver[String(win.driver_number)] || []).find(x => x.n === win.number_of_laps);
    classified = wl && at >= wl.end ? wl.end : 0;   // when the winner took the flag
    if (classified) order = everyone.sort((a, b) => ((D.result[a] || {}).position || 99) - ((D.result[b] || {}).position || 99) || a - b);
  } else if (D.parts.length) {   // qualifying: ranked within the part running now; those knocked out sit below, by their own part's time
    quali = qualiAt(D, done, everyone, at);
    const timed = n => isFinite(quali.best[n]) ? 0 : 1;
    order = everyone.sort((a, b) => quali.out[a] - quali.out[b] || timed(a) - timed(b) || (timed(a) ? (quali.prev[a] ?? 99) - (quali.prev[b] ?? 99) : quali.best[a] - quali.best[b]) || a - b);
  } else order = everyone.sort((a, b) => fastest(done[a] || []) - fastest(done[b] || []) || a - b);
  const grid = {}; for (const p of D.positions) if (!(p.n in grid)) grid[p.n] = p.p;
  const lapEnd = (n, k) => { const l = (D.byDriver[n] || []).find(x => x.n === k); return l && l.end <= at ? l.end : null; };
  const rankT = n => quali ? quali.best[n] : fastest(done[n] || []);
  const leader = order[0], leadDone = (done[leader] || []).length, lead = rankT(leader);
  const lines = {}, stats = {};
  order.forEach((n, i) => {
    const laps = D.byDriver[n] || [], fin = done[n] || [], cur = laps.find(l => l.start <= at && at < l.end);
    const last = fin[fin.length - 1], pb = quali ? quali.best[n] : fastest(fin), res = D.result[n] || {};
    const retired = (res.dnf || res.dns) && (!laps.length || at > laps[laps.length - 1].end + 30000);
    const pit = D.pits.find(p => p.n === n && p.in <= at && at <= p.out);
    const sectors = [0, 1, 2].map(k => {   // this lap's finished sectors; the running one's mini-sectors filling in
      const L = cur || last; if (!L) return { Value: "", Segments: [] };
      const startK = L.start + 1000 * L.sec.slice(0, k).reduce((a, b) => a + (b || 0), 0), endK = startK + 1000 * (L.sec[k] || 0);
      const segs = L.segs[k] || [], finished = !cur || (L.sec[k] && endK <= at);
      const shown = finished ? segs.length : at > startK && L.sec[k] ? Math.floor(segs.length * (at - startK) / (endK - startK)) : 0;
      const v = finished ? L.sec[k] : null;
      return { Value: v ? v.toFixed(3) : "", OverallFastest: !!v && v <= bestSec[k], PersonalFastest: !!v && v <= Math.min(...fin.map(l => l.sec[k] || Infinity)),
               Segments: segs.map((x, j) => ({ Status: j < shown ? (x || 2048) : 0 })) };
    });
    let gap = "", intv = "";   // from when each car crossed the line, like the timing screens
    if (race && last) {
      if (n === leader) gap = intv = "LAP " + Math.min(D.totalLaps, leadDone + 1);
      else {
        const le = lapEnd(leader, fin.length);
        // interval: time since the car ahead last crossed the line, even if it's a lap up (as F1 shows it), not its crossing of this car's lap
        const aheadLaps = i ? (D.byDriver[order[i - 1]] || []).filter(x => x.end <= last.end) : [], ae = aheadLaps.length ? aheadLaps[aheadLaps.length - 1].end : null;
        // laps down: the leader's extra laps finished before this car last crossed the line (not just "the leader has crossed more times right now")
        const down = (D.byDriver[leader] || []).filter(x => x.n > fin.length && x.end <= last.end).length;
        gap = down ? `+${down} LAP${down > 1 ? "S" : ""}` : le ? "+" + ((last.end - le) / 1000).toFixed(3) : "";
        // the car ahead crossed the line first; if the order changed mid-lap (a pit stop), use the gaps instead, never a negative
        const ahead = lines[order[i - 1]], diff = ae ? (last.end - ae) / 1000 : null, gapNum = parseFloat(gap), aheadGap = ahead ? parseFloat(ahead.GapToLeader) || 0 : 0;
        // an interval is never a lap or more: if it looks like one, the cars swapped places mid-lap, so use the gaps instead
        intv = diff != null && diff >= 0 && diff < 0.9 * (isFinite(fastest(fin)) ? fastest(fin) : 90) ? "+" + diff.toFixed(3) : isFinite(gapNum) && gapNum - aheadGap >= 0 ? "+" + (gapNum - aheadGap).toFixed(3) : "";
      }
      const r = classified && D.result[n];
      if (r && n !== leader && (fin.length >= (r.number_of_laps || 0) || last.end >= classified)) {   // this car has finished too (OpenF1 can miss a lap): its official gap
        const g = r.gap_to_leader, ga = (D.result[order[i - 1]] || {}).gap_to_leader;
        gap = typeof g === "number" ? "+" + g.toFixed(3) : g ? String(g).toUpperCase() : gap;
        intv = typeof g === "number" ? (typeof ga === "number" ? "+" + (g - ga).toFixed(3) : gap) : "";
      }
      if (retired) gap = intv = "";   // out of the race: no gap, like F1's timing
    } else if (!race && isFinite(pb)) {
      const prev = i ? rankT(order[i - 1]) : Infinity, sameGroup = !quali || quali.out[n] === quali.out[order[i - 1]];
      gap = i && (!quali || !quali.out[n]) ? "+" + (pb - lead).toFixed(3) : ""; intv = i && isFinite(prev) && sameGroup ? "+" + (pb - prev).toFixed(3) : "";
    }
    const curLap = cur ? cur.n : fin.length;
    const stints = D.stints.filter(x => String(x.driver_number) === n && x.lap_start <= Math.max(1, curLap)).sort((a, b) => a.stint_number - b.stint_number)
      .map(x => ({ Compound: x.compound, StartLaps: x.tyre_age_at_start || 0, New: String(!x.tyre_age_at_start),
                   TotalLaps: Math.max(0, Math.min(curLap, x.lap_end || curLap) - x.lap_start + 1) + (x.tyre_age_at_start || 0) }));
    lines[n] = {
      Line: i + 1, Position: String(i + 1), ShowPosition: true, RacingNumber: n, NumberOfLaps: fin.length,
      GapToLeader: race ? gap : undefined, IntervalToPositionAhead: race ? { Value: intv } : undefined,
      TimeDiffToFastest: race ? undefined : gap, TimeDiffToPositionAhead: race ? undefined : intv,
      LastLapTime: last && last.dur ? { Value: lapText(last.dur), PersonalFastest: last.dur <= pb, OverallFastest: last.dur <= bestLap } : {},
      BestLapTime: isFinite(pb) ? { Value: lapText(pb), Position: pb <= bestLap ? 1 : 2 } : {},
      Sectors: sectors, Speeds: { ST: last && last.st ? { Value: String(last.st), OverallFastest: last.st >= bestST, PersonalFastest: last.st >= Math.max(...fin.map(l => l.st || 0)) } : {} },
      InPit: !!pit, PitOut: !!(cur && cur.out && !pit), Retired: !!retired, Stopped: false, KnockedOut: !!(quali && quali.out[n]),
      NumberOfPitStops: D.pits.filter(p => p.n === n && p.in <= at).length, _stints: stints, _grid: grid[n], _lap: cur, _laps: laps
    };
    stats[n] = { BestSectors: [0, 1, 2].map(k => { const v = Math.min(...fin.map(l => l.sec[k] || Infinity)); return isFinite(v) ? { Value: v.toFixed(3), _v: v } : {}; }) };
  });
  for (let k = 0; k < 3; k++)   // rank everyone's best sectors
    Object.values(stats).filter(s => s.BestSectors[k]._v).sort((a, b) => a.BestSectors[k]._v - b.BestSectors[k]._v).forEach((s, i) => s.BestSectors[k].Position = i + 1);
  S.TimingData = { Lines: lines, SessionPart: quali ? quali.part : undefined };
  S.TimingAppData = { Lines: Object.fromEntries(Object.entries(lines).map(([n, l]) => [n, { Stints: l._stints, GridPos: race && l._grid ? String(l._grid) : undefined }])) };
  S.TimingStats = { Lines: stats };
  if (race) {   // positions lap by lap, up to now
    const series = {};
    D.lapPos.forEach((row, k) => { for (const [n, x] of Object.entries(row)) { if (k && x.at > at) continue; (series[n] = series[n] || { LapPosition: [] }).LapPosition[k] = String(k ? x.p : x); } });
    S.LapSeries = series;
  } else S.LapSeries = undefined;
  S.LapCount = race ? { CurrentLap: Math.min(D.totalLaps, leadDone + 1), TotalLaps: D.totalLaps } : undefined;
  const rcSoFar = D.rc.slice(0, upTo(D.rc, at) + 1);
  S.RaceControlMessages = { Messages: rcSoFar.map(({ at, m }) => ({ Utc: at, Lap: m.lap_number, Category: m.category, Flag: m.flag, Scope: m.scope, Sector: m.sector, Message: m.message })) };
  S.TrackStatus = { Status: flagState(S.RaceControlMessages.Messages).status };
  const w = D.weather[upTo(D.weather, at)];
  S.WeatherData = w ? { AirTemp: w.w.air_temperature, TrackTemp: w.w.track_temperature, WindSpeed: w.w.wind_speed, Rainfall: w.w.rainfall ? "1" : "0" } : undefined;
  S.TeamRadio = { Captures: D.radio.slice(0, upTo(D.radio, at) + 1).map(r => ({ Utc: r.at, RacingNumber: r.n, Path: r.url })) };
  S.SessionStatus = { Status: at >= D.end - 60000 ? "Finalised" : "Started" };
  radioArrived();
  dirty = true;
}
function qualiAt(D, done, everyone, at) {   // which part (Q1-Q3) is running, everyone's best in it, and who's been knocked out (1: in Q1, 2: in Q2)
  const parts = D.parts.filter(x => x.at <= at), part = parts.length ? parts[parts.length - 1].p : 1;
  const span = k => { const a = (D.parts.find(x => x.p === k) || {}).at || 0, b = (D.parts.find(x => x.p === k + 1) || {}).at || Infinity; return [a, b]; };
  const bestIn = (n, k) => { const [a, b] = span(k); return fastest((done[n] || []).filter(l => l.start >= a && l.start < b)); };
  const drop = Math.round((everyone.length - 10) / 2), out = {}, best = {};
  for (const n of everyone) out[n] = 0;
  for (let k = 1; k < part; k++) {   // at the end of each finished part, the slowest of those still in drop out
    const still = everyone.filter(n => !out[n]).sort((a, b) => bestIn(a, k) - bestIn(b, k));
    for (const n of still.slice(still.length - drop)) { out[n] = 3 - k; best[n] = bestIn(n, k); }   // Q2's knockouts rank above Q1's
  }
  for (const n of everyone) if (!out[n]) best[n] = bestIn(n, part);
  const before = part > 1 ? everyone.slice().sort((a, b) => bestIn(a, part - 1) - bestIn(b, part - 1) || a - b) : [];
  const prev = Object.fromEntries(before.map((n, i) => [n, i]));   // until they set a time, drivers keep their place from the last part
  return { part, out, best, prev };
}
export function flagState(msgs) {   // the track's state from race control's messages so far, in F1's codes: 1 clear, 2 yellow,
  let st = "1"; const yellow = {};   // 4 safety car, 5 red flag, 6 VSC, 7 VSC ending; and which marshal sectors are yellow (2: double)
  for (const m of msgs) {
    const text = (m.Message || "").toUpperCase(), flag = (m.Flag || "").toUpperCase(), sector = m.Sector || (/SECTOR (\d+)/.exec(text) || [])[1];
    if (m.Category === "SafetyCar" || /SAFETY CAR|^VSC /.test(text)) {
      if (/^(VSC|VIRTUAL SAFETY CAR) DEPLOYED/.test(text)) st = "6";
      else if (/^(VSC|VIRTUAL SAFETY CAR) ENDING/.test(text)) st = "7";
      else if (/^SAFETY CAR (DEPLOYED|IN THIS LAP)/.test(text)) st = "4";
    }
    // red flag: the flag itself, or the words (OpenF1 often sends "RED FLAG - RACE SUSPENDED" with no flag colour)
    if ((flag === "RED" && m.Scope !== "Sector") || /^RED FLAG|^SESSION ABORTED|^STARTING PROCEDURE SUSPENDED/.test(text)) st = "5";
    if (st === "5" && /^SESSION STARTED|^START ORDER/.test(text)) st = "1";   // racing again
    if (/^TRACK CLEAR|^GREEN LIGHT - PIT EXIT OPEN/.test(text) || ((flag === "GREEN" || flag === "CLEAR") && m.Scope === "Track")) {
      st = "1"; for (const k in yellow) delete yellow[k];
    }
    if (sector && (m.Scope === "Sector" || /IN TRACK SECTOR/.test(text))) {
      if (/YELLOW/.test(flag) || /^(DOUBLE )?YELLOW IN TRACK SECTOR/.test(text)) yellow[sector] = /DOUBLE/.test(flag + text) ? 2 : 1;
      else if (flag === "CLEAR" || /^CLEAR IN TRACK SECTOR/.test(text)) delete yellow[sector];
    }
  }
  return { status: st === "1" && Object.keys(yellow).length ? "2" : st, yellow };
}
function replayTick() {
  if (mode !== "replay" || !R.data) return;
  const real = performance.now(), dt = R.last ? real - R.last : 0; R.last = real;
  if (R.playing) { R.t = Math.min(R.end, R.t + dt * R.speed); if (R.t >= R.end) R.playing = false; }
  if (R.playing || R.dirty) { R.dirty = false; buildReplay(); syncReplayBar(); }
}
export function lapAt(t) {   // the leader's lap at a moment of the replay
  const D = R.data; if (!D) return 0;
  let best = 0; for (const laps of Object.values(D.byDriver)) { const k = laps.filter(l => l.start <= t).length; if (k > best) best = k; }
  return Math.min(best, D.totalLaps);
}
function clock(ms) { const el = Math.max(0, ms / 1000), h = Math.floor(el / 3600), m = Math.floor(el / 60) % 60, s = Math.floor(el % 60);
  return `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`; }
function syncReplayBar() {
  $("rPlay").innerHTML = R.playing ? ICONS.pause : ICONS.play;
  const part = (R.t - R.start) / (R.end - R.start || 1);
  if (!seeking) $("rSeek").value = String(Math.round(1000 * part));
  $("rDone").style.width = (100 * part).toFixed(2) + "%";
  const race = R.data && R.data.sess.session_type === "Race";
  $("rTime").textContent = clock(R.t - R.start);
  $("rLap").innerHTML = `${race ? "Lap " + Math.max(1, lapAt(R.t)) + "/" + R.data.totalLaps : ""}<span class="tod">${race ? " · " : ""}${timeOf(R.t)}</span>`;
}
let seeking = false;
function drawMarks() {   // the replay timeline: safety car, VSC and red flag periods, and every 10th lap
  const D = R.data, span = R.end - R.start, x = t => 100 * Math.min(1, Math.max(0, (t - R.start) / span));
  const msgs = D.rc.map(({ at, m }) => ({ at, Message: m.message, Category: m.category, Flag: m.flag, Scope: m.scope, Sector: m.sector }));
  const kindOf = st => ({ "4": "sc", "6": "vsc", "7": "vsc", "5": "red" })[st] || null;
  const bands = []; let open = null;
  msgs.forEach((m, i) => {
    const kind = kindOf(flagState(msgs.slice(0, i + 1)).status);
    if (open && open.kind !== kind) { bands.push({ ...open, to: m.at }); open = null; }
    if (kind && !open) open = { kind, from: m.at };
  });
  if (open) bands.push({ ...open, to: R.end });
  const names = { sc: "Safety car", vsc: "Virtual safety car", red: "Red flag" };
  $("rBands").innerHTML = bands.map(b => `<i class="band ${b.kind}" style="left:${x(b.from).toFixed(2)}%;width:max(3px,${(x(b.to) - x(b.from)).toFixed(2)}%)" title="${names[b.kind]}"></i>`).join("");
  const lead = Object.values(D.byDriver).sort((a, b) => b.length - a.length)[0] || [];
  const every = D.totalLaps > 40 ? 10 : 5;
  $("rLaps").innerHTML = D.sess.session_type === "Race" ? lead.filter(l => l.n % every === 0).map(l => `<span class="lapmark" style="left:${x(l.start).toFixed(2)}%">L${l.n}</span>`).join("") : "";
  $("rTitle").textContent = `${(D.meet.meeting_name || D.sess.country_name || "").replace("Grand Prix", "GP")} · ${D.sess.session_name}`;
  // what happened when: stretches on the rail (formation lap, Q1-Q3) and labelled markers above it
  const segs = [], evs = [], said = re => D.rc.filter(r => re.test(r.m.message)).map(r => r.at);
  const starts = said(/^SESSION STARTED/), flags = said(/CHEQUERED FLAG/);
  if (D.sess.session_type === "Race") {
    const lap1 = Math.min(...Object.values(D.byDriver).map(l => (l.find(x => x.n === 1) || {}).start || Infinity));
    if (D.form) segs.push({ cls: "form", from: D.form.from, to: D.form.to, label: "Formation lap", pri: 1 });
    if (isFinite(lap1)) evs.push({ at: lap1, label: "Start", cls: "go", pri: 3 });
    const aborted = said(/^SESSION ABORTED|^RED FLAG/);
    for (const r of starts.filter(t => t > lap1 + 60000 && aborted.some(a => a < t))) evs.push({ at: r, label: "Restart", cls: "go", pri: 2 });
    const fin = flags.find(t => t > lap1); if (fin) evs.push({ at: fin, label: "Finish", cls: "chq", pri: 3 });
  } else if (D.parts.length) {
    for (const k of [1, 2, 3]) {
      const from = (D.parts.find(x => x.p === k) || {}).at; if (!from) continue;
      const to = (D.qflags.find(x => x.p === k && x.at >= from) || {}).at || R.end;
      segs.push({ cls: "q q" + k, from, to, label: "Q" + k, pri: 3 });
      if (to < R.end) evs.push({ at: to, label: "", cls: "chq", pri: 2 });
    }
  } else {
    if (starts[0]) evs.push({ at: starts[0], label: "Start", cls: "go", pri: 3 });
    if (flags[0]) evs.push({ at: flags[0], label: "Finish", cls: "chq", pri: 3 });
  }
  $("rSegs").innerHTML = segs.map(g => `<i class="tseg ${g.cls}" style="left:${x(g.from).toFixed(2)}%;width:${(x(g.to) - x(g.from)).toFixed(2)}%" title="${esc(g.label)}"></i>`).join("");
  // labels above the rail; one that would overlap a more important one is left out (its marker stays)
  // the formation lap's label goes in the row below (with the lap numbers, which start at lap 10)
  $("rLaps").innerHTML += segs.filter(g => g.cls === "form").map(g => `<span class="formlabel" style="left:${x(g.from).toFixed(2)}%">Formation lap</span>`).join("");
  const W = $("rLine").clientWidth || 600, labels = [
    ...segs.filter(g => g.cls !== "form").map(g => ({ at: (g.from + g.to) / 2, label: g.label, cls: "seglabel " + g.cls, pri: g.pri })),
    ...evs.map(e => ({ ...e, cls: "ev " + e.cls }))];
  const kept = [];
  for (const L of labels.slice().sort((a, b) => b.pri - a.pri)) {
    // starts read rightwards from their marker, finishes leftwards; part labels sit centred
    const wd = L.label.length * 6 + 14, px = x(L.at) / 100 * W, lo = /go/.test(L.cls) ? px : /chq/.test(L.cls) ? px - wd : px - wd / 2;
    if (!L.label || !kept.some(k => lo < k.lo + k.wd && k.lo < lo + wd)) kept.push({ ...L, px, lo, wd });
  }
  $("rEvents").innerHTML = kept.map(L => `<span class="${L.cls}" style="left:${x(L.at).toFixed(2)}%">${L.cls.startsWith("ev") ? "<i></i>" : ""}${esc(L.label)}</span>`).join("")
    + evs.filter(e => !kept.some(k => k.at === e.at && k.label === e.label)).map(e => `<span class="ev ${e.cls}" style="left:${x(e.at).toFixed(2)}%"><i></i></span>`).join("");
}

// ---------- the session bar ----------
let placeFor = "", place = null, rainChance = null;
async function loadPlace() {   // the weekend this session belongs to: its flag, and where it is (for the rain forecast)
  const info = S.SessionInfo || {}, key = (((info.Meeting || {}).Circuit || {}).Key) + "|" + year();
  if (!info.Meeting || key === placeFor) return; placeFor = key; place = null; rainChance = null;
  try {
    const s = await seasonOf(year()), ck = +((info.Meeting.Circuit || {}).Key);
    const t = utc(info.StartDate) || now();
    place = s.rounds.filter(r => r.circuitKey === ck).sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t))[0] || null;
    if (place && place.flag) { $("flag").src = place.flag; $("flag").hidden = false; }
    if (place && mode === "live") updateRain();
  } catch (e) {}
  dirty = true;
}
async function updateRain() {   // live: the chance of rain at the circuit in the next hour
  if (!place || mode !== "live") return;
  try { const f = await forecast(place.lat, place.lon), x = forecastFor(f, Date.now(), Date.now() + 3600000); rainChance = x ? x.rain : null; } catch (e) { rainChance = null; }
  dirty = true;
}
function renderHeader() {
  const info = S.SessionInfo || {}, meeting = info.Meeting || {};
  if (meeting.Name) { $("event").textContent = `${meeting.Name.replace("Grand Prix", "GP")} · ${info.Name || ""}`; if (mode === "live") $("sub").textContent = ((meeting.Circuit || {}).ShortName || meeting.Location || ""); }
  else if (mode === "live") { $("event").textContent = "Waiting for live timing…"; $("sub").textContent = ""; }
  if (mode === "replay" && R.data) $("sub").textContent = "Replay · " + new Date(R.start).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  const status = (S.SessionStatus || {}).Status;
  if (mode === "live" && ws && ws.readyState === 1) setLive(status === "Started" ? "live" : ["Finished", "Finalised", "Ends"].includes(status) ? "ended" : status === "Inactive" ? "waiting" : "live");
  const lap = S.LapCount;
  show("lapBox", lap && lap.TotalLaps); if (lap && lap.TotalLaps) $("lap").textContent = `${lap.CurrentLap}/${lap.TotalLaps}`;
  const ts = S.TrackStatus || {}, chip = $("track");
  const kinds = { "1": ["Track clear", ""], "2": ["Yellow flag", "yellow"], "4": ["Safety car", "sc"], "5": ["Red flag", "red"], "6": ["VSC", "sc"], "7": ["VSC ending", "sc"] };
  const [label, cls] = kinds[ts.Status] || [ts.Message || "–", "off"];
  chip.textContent = label; chip.className = "status " + cls;
  const w = S.WeatherData;
  for (const id of ["airBox", "trackTBox", "windBox"]) show(id, !!w);
  show("rainBox", w && w.Rainfall === "1");
  show("chanceBox", mode === "live" && rainChance != null && !(w && w.Rainfall === "1"));
  if (rainChance != null) $("chance").textContent = `${Math.round(rainChance)}%`;
  if (w) { $("air").textContent = `${(+w.AirTemp).toFixed(1)}°`; $("trackT").textContent = `${(+w.TrackTemp).toFixed(1)}°`; $("wind").textContent = `${(+w.WindSpeed * 3.6).toFixed(0)} km/h`; }
}
function renderClock() {   // time left; in qualifying, a countdown to the end of Q1, Q2, Q3 (and to the next part's start)
  const quali = (S.SessionInfo || {}).Type === "Qualifying";
  let label = "Time left", left = null, running = false;
  if (mode === "replay") {
    const D = R.data;
    if (quali && D && D.parts.length) {
      const now_ = R.t, part = D.parts.filter(x => x.at <= now_).pop(), next = D.parts.find(x => x.at > now_);
      const flag = part && D.qflags.find(x => x.p === part.p && x.at >= part.at);
      // stopped (red flag): race control's last word on the session was "aborted" ("track clear" comes before the restart)
      const said = list((S.RaceControlMessages || {}).Messages).filter(m => /^SESSION (STARTED|ABORTED)/.test(m.Message || "")).pop();
      const red = !!said && /ABORTED/.test(said.Message);
      if (!part) { label = "Q1 starts in"; left = next.at - now_; }
      else if (red && next && next.p === part.p) { label = `Q${part.p} restarts in`; left = next.at - now_; }   // red flag: until the restart
      else if (flag && now_ < flag.at) {   // like F1's clock: stoppages still to come don't count
        const paused = D.stops.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, flag.at) - Math.max(a, now_)), 0);
        label = `Q${part.p} ends in`; left = flag.at - now_ - paused; running = true;
      }
      else if (next) { label = `Q${next.p} ${next.p === part.p ? "restarts" : "starts"} in`; left = next.at - now_; }   // after a red flag: the same part restarts
      else { label = "Qualifying"; left = "done"; }
    }
  } else {
    const c = S.ExtrapolatedClock, part = (S.TimingData || {}).SessionPart, status = (S.SessionStatus || {}).Status;
    if (c && c.Remaining) {
      left = seconds(c.Remaining) * 1000;
      if (c.Extrapolating && c.Utc) left -= now() - utc(c.Utc);
      running = !!c.Extrapolating;
      if (quali && part) label = running ? `Q${part} ends in` : status === "Aborted" || (S.TrackStatus || {}).Status === "5" ? `Q${part} stopped` : `Q${part}`;   // red flag: F1's clock stops
      // between parts F1's clock stands still: count down the break from when the last part ended
      const next = status === "Finished" ? part + 1 : status === "Inactive" && part > 1 ? part : 0;
      if (quali && part && !running && next) {
        if (next > 3) { label = "Qualifying"; left = "done"; }
        else {   // from race control's chequered flag for the part that just ended
          const flag = list((S.RaceControlMessages || {}).Messages).filter(m => /CHEQUERED FLAG/.test(m.Message || "")).pop();
          label = `Q${next} starts in`; left = flag ? Math.max(0, utc(flag.Utc) + QUALI_BREAK - now()) : "Soon";
        }
      }
    }
  }
  show("clockBox", left != null);
  if (left == null) return;
  $("clockLabel").textContent = label;
  $("clock").textContent = typeof left === "string" ? (left === "done" ? "Finished" : left) : clock(Math.max(0, left));
  $("clockBox").classList.toggle("hot", running && typeof left === "number" && left < 120000);   // the last 2 minutes
}

// ---------- timing tower ----------
const COLS = [["int", "Interval"], ["gap", "Gap"], ["last", "Last lap"], ["best", "Best lap"], ["s1", "Sector 1"], ["s2", "Sector 2"], ["s3", "Sector 3"],
              ["mini", "Mini sectors"], ["speed", "Speed trap"], ["tyres", "Tyres (stints)"], ["pit", "Pit stops"], ["moved", "Places gained"]];
const COL_NOTES = { int: "Time to the car ahead", gap: "Time to the leader", mini: "The coloured bars under each sector", speed: "Top speed at the speed trap",
                    tyres: "Every set of tyres and how many laps", moved: "Places gained or lost since the start (races)" };
let hiddenCols = new Set();
function applyColumns() {
  $("colcss").textContent = [...hiddenCols].map(k => k === "mini" ? "#tower .segs{display:none}" : `#tower [data-c="${k}"]{display:none}`).join("");
}
let towerRows = {}, towerHead = "", battleSet = new Set(), battlePairs = [];
function renderTower() {
  const td = S.TimingData, lines = td && td.Lines;
  const table = $("tower");
  if (!lines) { table.innerHTML = `<tr><td class="empty">${mode === "replay" ? "Loading…" : "Waiting for timing data…"}</td></tr>`; towerRows = {}; towerHead = ""; return; }
  const race = (S.SessionInfo || {}).Type === "Race";   // the race or the sprint
  const part = td.SessionPart;   // qualifying: 1, 2, 3
  $("part").textContent = part ? `Q${part}` : "";
  const app = (S.TimingAppData || {}).Lines || {};
  const rows = Object.entries(lines).sort((a, b) => (+a[1].Line || 99) - (+b[1].Line || 99));
  // qualifying: a red line under the last car that's safe (Q1: 16th of 22, Q2: 10th)
  const cutAt = (S.SessionInfo || {}).Type === "Qualifying" && (part === 1 || part === 2) ? (part === 1 ? rows.length - Math.round((rows.length - 10) / 2) : 10) : 0;
  const head = `<tr><th>Pos · Driver</th><th data-c="int">${race ? "Interval" : "Gap"}</th><th data-c="gap">${race ? "Gap" : "Int"}</th><th data-c="last">Last lap</th>
              <th data-c="best">Best lap</th><th data-c="s1">Sector 1</th><th data-c="s2">Sector 2</th><th data-c="s3">Sector 3</th><th data-c="speed">Speed</th><th data-c="tyres">Tyres</th><th data-c="pit">Pit</th>${race ? `<th data-c="moved">+/-</th>` : ""}</tr>`;
  if (head !== towerHead) { table.innerHTML = head; towerHead = head; towerRows = {}; }   // a different session: start over
  const body = table.tBodies[0] || table;
  // battles: a car within 1 s of the one ahead (racing, not in the pits)
  battleSet = new Set(); battlePairs = [];
  if (race) rows.forEach(([n, l], i) => {
    if (!i) return;
    const v = String((l.IntervalToPositionAhead || {}).Value || ""), [m, a] = rows[i - 1];
    if (/^\+?\d+\.\d+$/.test(v) && parseFloat(v.replace("+", "")) < 1 && !l.InPit && !a.InPit && !l.Retired && !a.Retired && !l.Stopped && !a.Stopped) { battleSet.add(n); battleSet.add(m); battlePairs.push([m, n]); }
  });
  $("batN").textContent = battlePairs.length ? `· ${battlePairs.length} battle${battlePairs.length > 1 ? "s" : ""} within 1s` : "";
  $("followHint").hidden = !!follow;
  for (const [num, l] of rows) {
    const d = driver(num), c = colour(d), stats = list(l.Stats)[part ? part - 1 : 0] || {};
    let gap = l.GapToLeader != null ? l.GapToLeader : l.TimeDiffToFastest != null ? l.TimeDiffToFastest : stats.TimeDiffToFastest;
    let intv = l.IntervalToPositionAhead ? l.IntervalToPositionAhead.Value : l.TimeDiffToPositionAhead != null ? l.TimeDiffToPositionAhead : stats.TimeDifftoPositionAhead;
    if (/^LAP/i.test(gap || "")) gap = "—";   // the leader's row shows the lap number in F1's feed
    if (l.Retired || l.Stopped) gap = intv = "";   // out of the race: no gap (F1 can leave the last one there)
    if (/^LAP/i.test(intv || "")) intv = "—";
    const lapsDown = v => String(v || "").replace(/^\+?(\d+)\s*L(?:APS?)?$/i, (_, k) => `+${k} Lap${k > 1 ? "s" : ""}`);
    gap = lapsDown(gap); intv = lapsDown(intv);
    const catching = l.IntervalToPositionAhead && l.IntervalToPositionAhead.Catching;
    const best = (l.BestLapTime && l.BestLapTime.Value) || (list(l.BestLapTimes)[part ? part - 1 : 0] || {}).Value || "";
    const out = l.Retired || l.Stopped || l.KnockedOut;
    const tags = (l.InPit ? `<span class="tag pit">PIT</span>` : l.PitOut ? `<span class="tag outlap">OUT</span>` : "")
               + (l.Retired ? `<span class="tag ko">OUT</span>` : l.KnockedOut ? `<span class="tag ko">KO</span>` : "");
    const a = app[num] || {}, stints = list(a.Stints);
    const stintHtml = stints.map((st, i) => {
      const [ltr, ring] = TYRES[st.Compound] || ["?", "#777"];
      return `<span class="stint${i === stints.length - 1 ? " now" : ""}" title="${esc(st.Compound || "")}, ${esc(st.TotalLaps)} laps"><span style="border-color:${ring};color:${ring}">${ltr}</span>${esc(st.TotalLaps != null ? st.TotalLaps : "")}</span>`;
    }).join("");
    const trap = (l.Speeds || {}).ST || {};
    const moved = race && a.GridPos && l.Position ? (+a.GridPos - +l.Position) : 0;
    const secCells = list(l.Sectors).map((sec, k) => ["s" + (k + 1), "", `<span class="sector"><span class="${timeClass(sec)}">${esc(sec.Value || "")}</span>
        <span class="segs">${list(sec.Segments).map(g => `<b class="${segClass(g && g.Status)}"></b>`).join("")}</span></span>`]);
    while (secCells.length < 3) secCells.push(["s" + (secCells.length + 1), "", ""]);
    const pos = l.ShowPosition === false || out ? "" : l.Position, owed = penaltyOwed(num);
    const lastV = (l.LastLapTime || {}).Value || "", lastC = timeClass(l.LastLapTime);
    const cells = [
      ["", "", `<span class="posn">${esc(pos || "–")}</span>${dtag(num)}<span class="tags">${tags}${owed ? `<span class="pen" title="Penalty not yet served">${esc(owed)}</span>` : ""}</span>`],
      ["int", "", race && battleSet.has(num) && battlePairs.some(p => p[1] === num) ? `<span class="pill bat">${esc(intv)}</span>`
                : race && catching && intv && intv !== "—" ? `<span class="pill ring">${esc(intv)}</span>` : esc(race ? intv : gap) || "–"],
      ["gap", "", esc(race ? gap : intv) || ""],
      ["last", lastC, lastC === "t-purple" ? `<span class="pill purple">${esc(lastV)}</span>` : esc(lastV)],
      ["best", "", l.BestLapTime && l.BestLapTime.Position === 1 ? `<span class="pill purple">${esc(best)}</span>` : esc(best)],
      ...secCells,
      ["speed", timeClass(trap), trap.Value ? esc(trap.Value) + ` <small class="u">km/h</small>` : ""],
      ["tyres", "", `<span class="stints">${stintHtml}</span>`],
      ["pit", "", esc(l.NumberOfPitStops != null ? l.NumberOfPitStops : Math.max(0, stints.length - 1))],
      ...(race ? [["moved", moved > 0 ? "up" : moved < 0 ? "down" : "same", moved > 0 ? "▲" + moved : moved < 0 ? "▼" + -moved : "–"]] : [])
    ];
    let tr = towerRows[num];
    if (!tr) { tr = towerRows[num] = document.createElement("tr"); tr.dataset.n = num; tr.style.setProperty("--tc", c); cells.forEach(([k]) => { const td = document.createElement("td"); if (k) td.dataset.c = k; tr.appendChild(td); }); }
    tr.className = (out ? "out" : "") + (+l.Position === cutAt && !out ? " cut" : "") + (num === follow ? " fol" : "") + (battleSet.has(num) ? " bat" : "");
    cells.forEach(([, cls, html], i) => {   // rewrite a cell only when it changed
      const cell = tr.cells[i];
      if (cell.className !== cls) cell.className = cls;
      if (cell._html !== html) { cell.innerHTML = html; cell._html = html; }
    });
    body.appendChild(tr);   // in running order
  }
  for (const [num, tr] of Object.entries(towerRows)) if (!lines[num]) { tr.remove(); delete towerRows[num]; }
}

// ---------- fastest sectors ----------
function renderBests() {
  const lines = (S.TimingStats || {}).Lines || {}, out = [];
  for (let i = 0; i < 3; i++) {
    const top = Object.entries(lines).map(([n, l]) => [n, list(l.BestSectors)[i] || {}]).filter(([, b]) => b.Value && b.Position)
                      .sort((a, b) => a[1].Position - b[1].Position).slice(0, 3);
    out.push(`<div><h3>Sector ${i + 1}</h3>${top.map(([n, b]) => `<p>${dtag(n, true)}<span>${esc(b.Value)}</span></p>`).join("") || `<p class="when">–</p>`}</div>`);
  }
  const html = out.join("");
  if ($("bests")._html !== html) { $("bests").innerHTML = html; $("bests")._html = html; }
}

// ---------- live championship ----------
const POINTS = { Race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], Sprint: [8, 7, 6, 5, 4, 3, 2, 1] };
let standings = null, champTab = "d", champKey = "";
async function loadStandings() {   // the championship so far, from Jolpica (Ergast's successor)
  try {
    const [d, c, last] = await Promise.all(["current/driverStandings.json", "current/constructorStandings.json", "current/last/results.json"].map(u => jolpica(u)));
    const dl = d.MRData.StandingsTable.StandingsLists[0] || {}, cl = c.MRData.StandingsTable.StandingsLists[0] || {};
    standings = {
      round: +dl.round || 0, raceRound: +((last.MRData.RaceTable.Races[0] || {}).round || 0),
      drivers: (dl.DriverStandings || []).map(x => ({ code: x.Driver.code, first: x.Driver.givenName, last: x.Driver.familyName,
                 cid: (x.Constructors.slice(-1)[0] || {}).constructorId, team: (x.Constructors.slice(-1)[0] || {}).name, pts: +x.points, pos: +x.position })),
      teams: (cl.ConstructorStandings || []).map(x => ({ cid: x.Constructor.constructorId, name: x.Constructor.name, pts: +x.points, pos: +x.position }))
    };
  } catch (e) { standings = { error: true }; }
  dirty = true;
}
function champBase() {   // where everyone stood before this sprint or race, and whether to add the points they're running in
  const info = S.SessionInfo || {}, kind = info.Type === "Race" ? (/sprint/i.test(info.Name || "") ? "Sprint" : "Race") : null;
  const codeToNum = {}; for (const [n, d] of Object.entries(S.DriverList || {})) if (d.Tla) codeToNum[d.Tla] = n;
  if (mode === "replay") {   // OpenF1 has every driver's and team's points before the session
    const D = R.data; if (!D || !D.champD.length) return null;
    const drivers = D.champD.map(c => { const n = String(c.driver_number), x = D.extra[c.driver_number];
      const d = S.DriverList[n] || (x ? { Tla: x.name_acronym, FirstName: x.first_name, LastName: x.last_name, TeamName: x.team_name, HeadshotUrl: x.headshot_url } : {});
      return { code: d.Tla || n, num: S.DriverList && S.DriverList[n] ? n : null, first: d.FirstName, last: d.LastName, team: d.TeamName, headshot: d.HeadshotUrl, pts: c.points_start || 0, pos: c.position_start || 99 }; });
    return { drivers, teams: D.champT.map(c => ({ name: c.team_name, pts: c.points_start || 0, pos: c.position_start || 99 })), live: !!kind, kind };
  }
  if (!standings || standings.error) return null;
  const round = +((info.Meeting || {}).Number || (place && place.round) || 0);
  const counted = kind === "Race" ? standings.raceRound >= round : standings.round >= round;   // already in the standings
  const teamOf = cid => { const d = standings.drivers.find(x => x.cid === cid && codeToNum[x.code]); return (d && driver(codeToNum[d.code]).TeamName) || null; };
  const drivers = standings.drivers.map(x => ({ ...x, num: codeToNum[x.code] || null, team: (codeToNum[x.code] && driver(codeToNum[x.code]).TeamName) || teamOf(x.cid) || x.team }));
  for (const [n, d] of Object.entries(S.DriverList || {}))   // a driver without points so far
    if (d.Tla && !drivers.some(x => x.code === d.Tla)) drivers.push({ code: d.Tla, num: n, first: d.FirstName, last: d.LastName, team: d.TeamName, pts: 0, pos: 99 });
  return { drivers, teams: standings.teams.map(t => ({ name: teamOf(t.cid) || t.name, pts: t.pts, pos: t.pos })), live: !!kind && !counted, kind };
}
function renderChampionship() {
  const el = $("champ"), base = champBase();
  if (!base) { el.innerHTML = `<li class="empty">${mode === "replay" ? "The championship is shown for sprints and races." : standings ? "Standings unavailable right now" : "Loading standings…"}</li>`; champKey = ""; return; }
  const { kind, live } = base, lines = (S.TimingData || {}).Lines || {};
  const scored = num => { const l = live && num && lines[num]; return l && !l.Retired && !l.Stopped ? POINTS[kind][(+l.Position || 99) - 1] || 0 : 0; };
  const rank = rows => { rows.forEach(r => r.total = r.pts + r.add); rows.sort((a, b) => b.total - a.total || a.pos - b.pos); rows.forEach((r, i) => r.now = i + 1); return rows; };
  const drivers = rank(base.drivers.map(x => ({ ...x, add: scored(x.num) })));
  const teams = rank(base.teams.map(t => ({ ...t, add: drivers.filter(d => slug(d.team) === slug(t.name)).reduce((s, d) => s + d.add, 0) })));
  // redraw when the order or points change, or when the drivers' details (team colours, photos) arrive after the standings
  const key = champTab + JSON.stringify((champTab === "d" ? drivers : teams).map(r => [r.code || r.name, r.total, r.now, r.num, r.team]))
            + JSON.stringify(Object.values(S.DriverList || {}).map(d => [d.Tla, d.TeamColour, d.TeamName])) + document.documentElement.dataset.mode;
  if (key === champKey) return;   // unchanged: keep the photos as they are
  champKey = key;
  const teamColour = name => { const d = drivers.find(x => slug(x.team) === slug(name) && x.num); return d ? colour(driver(d.num)) : "#777"; };
  const move = r => { const m = r.pos - r.now; return r.pos === 99 || !m ? `<span class="mv same">–</span>` : `<span class="mv ${m > 0 ? "up" : "down"}">${m > 0 ? "▲" + m : "▼" + -m}</span>`; };
  const pts = r => `<span class="pts">${r.total}${live ? `<small class="${r.add ? "" : "none"}">${r.add ? "+" + r.add : "–"}</small>` : ""}</span>`;
  el.innerHTML = champTab === "d"
    ? drivers.map(r => { const tc = r.num ? colour(driver(r.num)) : teamColour(r.team), d = { HeadshotUrl: r.headshot, ...driver(r.num), FirstName: r.first, LastName: r.last, TeamName: r.team };
        return `<li style="--tc:${tc}"><span class="p">${r.now}</span>${move(r)}<img class="face" src="${photo(d, 64)}" alt="" style="background:${tc}">
          <span class="nm"><span class="dtag small" style="${tagVars(tc)}"><span class="t">${esc(r.code)}</span></span><small>${esc(`${r.first || ""} ${r.last || ""}`)}</small></span>${pts(r)}</li>`; }).join("")
    : teams.map(r => `<li><span class="p">${r.now}</span>${move(r)}
          <span><img class="tl lg-light" src="${teamLogo(r.name)}" alt="" onerror="this.remove()"><img class="tl lg-dark" src="${teamLogo(r.name, true)}" alt="" onerror="this.remove()"></span>
          <span class="nm"><span style="width:4px;height:18px;border-radius:2px;background:${teamColour(r.name)};flex:0 0 4px"></span><b>${esc(r.name)}</b></span>${pts(r)}</li>`).join("");
}

// ---------- race control ----------
export const RC_ICON = {
  flag: `<svg viewBox="0 0 24 24"><path d="M5 2h2v20H5zm3 1h12l-3 4.5 3 4.5H8z"/></svg>`,
  car: `<svg viewBox="0 0 24 24"><path d="M5 11l1.6-4.6A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.4L19 11v6a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zm2.6-1h8.8l-1-3H8.6zM7.6 14.2a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zm8.8 0a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z"/></svg>`,
  gavel: `<svg viewBox="0 0 24 24"><path d="M1 21h12v2H1zM5.2 8.1l2.9-2.9 14.1 14.2-2.8 2.8zM12.3 1 18 6.7l-2.9 2.8-5.6-5.7zM3.8 9.5l5.7 5.7-2.8 2.8L1 12.3z"/></svg>`,
  warn: `<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/></svg>`,
  drs: `<svg viewBox="0 0 24 24"><path d="M2 6h20v3H2zm3 5h14l-1.5 4h-11zm3 6h8v2H8z"/></svg>`,
  info: `<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v2h-2zm0 4h2v6h-2z"/></svg>`,
  ok: `<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.4 14.2-4.2-4.2 1.4-1.4 2.8 2.8 5.6-5.6 1.4 1.4z"/></svg>`
};
function rcKind(m) {   // [icon colour, icon, label, filter group]
  const t = (m.Message || "").toUpperCase(), f = (m.Flag || "").toUpperCase();
  if (m.Category === "SafetyCar" || /SAFETY CAR|^VSC /.test(t)) return ["sc", "car", /VIRTUAL|^VSC/.test(t) ? "Virtual safety car" : "Safety car", "sc"];
  if (/STEWARDS|PENALTY|INVESTIGAT|INCIDENT|BLACK AND WHITE|WARNING/.test(t)) return ["pen", "gavel", "Stewards", "pen"];
  if (/TRACK LIMITS|DELETED/.test(t)) return ["yellow", "warn", "Track limits", "tl"];
  if (f === "CHEQUERED") return ["chq", "flag", "Chequered flag", "flags"];
  if (f === "RED") return ["red", "flag", "Red flag", "flags"];
  if (f === "DOUBLE YELLOW") return ["yellow", "flag", "Double yellow", "flags"];
  if (f === "YELLOW") return ["yellow", "flag", "Yellow flag", "flags"];
  if (f === "BLUE") return ["blue", "flag", "Blue flag", "flags"];
  if (f === "GREEN" || f === "CLEAR") return ["green", "flag", f === "GREEN" ? "Green flag" : "Track clear", "flags"];
  if (m.Category === "Drs" || /\bDRS\b/.test(t)) return ["", "drs", "DRS", "other"];
  return ["", "info", "Info", "other"];
}
const withTags = text => esc(text).replace(/(?:CARS? )?(\d+) \(([A-Z]{2,3})\)/g, (_, n) => dtag(n, true));   // "CAR 81 (PIA)" -> the driver's tag
const RC_FILTERS = [["all", "All"], ["flags", "Flags"], ["sc", "Safety car"], ["pen", "Stewards"], ["tl", "Track limits"]];
let rcFilter = "all";
function renderRaceControl() {
  const all = list((S.RaceControlMessages || {}).Messages).map(m => ({ m, k: rcKind(m) }));
  const count = g => g === "all" ? all.length : all.filter(x => x.k[3] === g).length;
  const chips = RC_FILTERS.map(([g, label]) => `<button data-g="${g}" aria-pressed="${g === rcFilter}">${label} ${count(g) || ""}</button>`).join("");
  if ($("rcKinds")._html !== chips) { $("rcKinds").innerHTML = chips; $("rcKinds")._html = chips; }
  const msgs = all.filter(x => rcFilter === "all" || x.k[3] === rcFilter).slice(-80).reverse();
  const html = msgs.length ? msgs.map(({ m, k: [cls, icon, label] }) =>
    `<li><span class="rc-ico ${cls}">${RC_ICON[icon]}</span><div class="rc-body"><div class="rc-msg">${withTags(m.Message)}</div>
      <div class="rc-meta"><span class="rc-kind">${label}</span><span class="when">${m.Lap ? "Lap " + esc(m.Lap) + " · " : ""}${timeOf(m.Utc)}</span></div></div></li>`).join("")
    : `<li class="empty">No messages yet</li>`;
  if ($("rc")._html !== html) { $("rc").innerHTML = html; $("rc")._html = html; }
}

// ---------- pop-up alerts: new race control messages ----------
let rcSeen = null;
const alertable = m => {   // what's worth a pop-up; the rest is in the race control panel (and the map)
  const t = (m.Message || "").toUpperCase(), f = (m.Flag || "").toUpperCase();
  if (f === "BLUE" || /WAVED BLUE/.test(t)) return false;                       // many, every race
  if (m.Scope === "Sector" || /IN TRACK SECTOR/.test(t)) return false;          // one sector's yellow: lit up on the map
  if (/DELETED/.test(t) && /TRACK LIMITS/.test(t)) return false;                // deleted laps: counted in Penalties
  return true;
};
function notifyRaceControl() {
  if (mode === "replay" && !R.data) return;   // still loading: what's there at the start isn't news
  const msgs = list((S.RaceControlMessages || {}).Messages);
  if (rcSeen == null || msgs.length < rcSeen) { rcSeen = msgs.length; return; }   // just opened, or a replay went back: nothing old pops up
  const fresh = msgs.slice(rcSeen); rcSeen = msgs.length;
  if (!fresh.length || !store.get("f1.alerts", true) || (mode === "replay" && fresh.length > 8)) return;   // a replay jumped ahead: skip
  for (const m of fresh.filter(alertable).slice(-3)) toast(m);
}
function toast(m) {
  if (!APP) return;
  const [cls, icon, label] = rcKind(m);
  APP.toast(`<span class="rc-ico ${cls}">${RC_ICON[icon]}</span><div class="rc-body"><div class="rc-kind">${label}${m.Lap ? " · Lap " + esc(m.Lap) : ""}</div>
    <div class="rc-msg">${withTags(m.Message)}</div></div>`);
  // and as a system notification when the page is in the background (if allowed in Settings)
  if (mode === "live" && document.hidden && store.get("f1.notify", false) && "Notification" in window && Notification.permission === "granted")
    try { new Notification(label, { body: m.Message, icon: "icons/icon-192.png", tag: "rc" + rcSeen }); } catch (e) {}
}

// ---------- penalties ----------
let penCache = { key: null, v: null };
function penaltyInfo() {   // the stewards' decisions so far, read from race control's messages
  const msgs = list((S.RaceControlMessages || {}).Messages), lastM = msgs[msgs.length - 1] || {};
  const key = msgs.length + "|" + lastM.Message;
  if (penCache.key === key) return penCache.v;
  const pens = [], invs = {}, limits = {}, flags = [];
  const carsIn = t => [...t.matchAll(/(\d+) \([A-Z]{2,3}\)/g)].map(x => x[1]);
  for (const m of msgs) {
    const t = (m.Message || "").toUpperCase().replace(/^(FIA STEWARDS: )?UPDATE:\s*/, "$1"), why = t.split(" - ").slice(1).join(" - ").replace(/\s*\(\d\d:\d\d(:\d\d)?\)$/, "");
    const car = (/FOR CAR (\d+)/.exec(t) || [])[1];
    if (/PENALTY SERVED/.test(t)) { const p = pens.find(x => x.n === car && !x.served); if (p) p.served = true; continue; }
    const secs = /(\d+) SECOND TIME PENALTY/.exec(t);
    const kind = secs ? `+${secs[1]}s` : /DRIVE[ -]THROUGH/.test(t) ? "DT" : /STOP[ /-]?(?:AND[ -])?GO/.test(t) ? "SG" : null;
    if (car && kind && /PENALTY/.test(t)) {
      pens.push({ n: car, kind, what: secs ? `${secs[1]} second time penalty` : kind === "DT" ? "Drive-through penalty" : "Stop-and-go penalty", why, lap: m.Lap, served: false });
      for (const v of Object.values(invs)) if (v.open && v.cars.includes(car)) { v.open = false; v.status = "Penalty"; }   // decided
      continue;
    }
    const inv = /^(?:FIA STEWARDS: )?(.*?)\s+(UNDER INVESTIGATION|WILL BE INVESTIGATED AFTER THE RACE|NOTED|REVIEWED NO FURTHER INVESTIGATION|NO FURTHER INVESTIGATION|NO FURTHER ACTION)\b/.exec(t);
    if (inv && /INCIDENT|CARS? \d/.test(inv[1])) {
      const v = invs[inv[1]] = invs[inv[1]] || { cars: carsIn(inv[1]), what: inv[1].replace(/\s*INCIDENT INVOLVING.*$/, "").trim(), why, lap: m.Lap };
      v.open = /INVESTIGAT(ION|ED AFTER)/.test(inv[2]) && !/NO FURTHER/.test(inv[2]);
      v.status = /AFTER THE RACE/.test(inv[2]) ? "After race" : v.open ? "Investigating" : /NOTED/.test(inv[2]) ? "Noted" : "No action";
      if (why) v.why = why;
      continue;
    }
    const lim = /CAR (\d+) \([A-Z]+\) (?:TIME|LAP).*DELETED/.exec(t);
    if (lim) { limits[lim[1]] = (limits[lim[1]] || 0) + 1; continue; }
    const bw = /BLACK AND WHITE FLAG FOR CAR (\d+)/.exec(t);
    if (bw) flags.push({ n: bw[1], why, lap: m.Lap });
  }
  const owed = {};
  for (const p of pens) if (!p.served) owed[p.n] = (owed[p.n] ? owed[p.n] + " " : "") + p.kind;
  return (penCache = { key, v: { pens, invs: Object.values(invs), limits, flags, owed } }).v;
}
const penaltyOwed = n => penaltyInfo().owed[n] || "";
function renderPenalties() {
  const { pens, invs, limits, flags } = penaltyInfo();
  const row = (cars, what, why, st, cls, done) => `<li class="penrow${done ? " done" : ""}"><span>${cars.map(n => dtag(n, true)).join(" ")}</span>
    <span><div class="what">${esc(what)}</div>${why ? `<div class="why">${esc(why)}</div>` : ""}</span><span class="st ${cls}">${esc(st)}</span></li>`;
  const lap = l => l ? ` · Lap ${l}` : "";
  const active = pens.filter(p => !p.served), open = invs.filter(v => v.open);
  let html = active.length ? "" : `<div class="nopen">${RC_ICON.ok}No active penalties</div>`;
  const parts = [];
  if (pens.length) parts.push(`<h4>Penalties</h4>` + [...active, ...pens.filter(p => p.served)].map(p => row([p.n], p.what, p.why.toLowerCase() + lap(p.lap), p.served ? "Served" : "Active", p.served ? "served" : "active", p.served)).join(""));
  if (invs.length) parts.push(`<h4>Investigations</h4>` + [...open, ...invs.filter(v => !v.open)].map(v => row(v.cars, v.what.toLowerCase() || "Incident", v.why.toLowerCase() + lap(v.lap), v.status, v.open ? "inv" : "served", !v.open)).join(""));
  const tl = Object.entries(limits).sort((a, b) => b[1] - a[1]);
  if (tl.length || flags.length) parts.push(`<h4>Warnings</h4>` + flags.map(f => row([f.n], "Black and white flag", f.why.toLowerCase() + lap(f.lap), "Warning", "warn")).join("")
    + tl.map(([n, k]) => row([n], `${k} lap time${k > 1 ? "s" : ""} deleted`, "track limits", `${k}×`, "warn")).join(""));
  html += parts.length ? `<ul class="penlist">${parts.join("")}</ul>` : "";
  if ($("pens")._html !== html) { $("pens").innerHTML = html; $("pens")._html = html; }
}

// ---------- race positions ----------
let follow = null, posPick = null, posKey = "", fKey = "";
export const following = () => follow;
export function setFollow(n) {   // tap a driver anywhere: highlight them everywhere; tap again to stop
  follow = n && n !== follow ? n : null; posPick = follow; store.set("f1.follow", follow);
  posKey = ""; fKey = ""; dirty = true;
}
function renderPositions() {
  const series = S.LapSeries, race = (S.SessionInfo || {}).Type === "Race";
  const rows = race && series ? Object.entries(series).map(([n, x]) => [n, list(x.LapPosition).map(Number)]).filter(([, p]) => p.length > 1) : [];
  show("p-pos", rows.length > 0);
  if (!rows.length) return;
  const key = rows.map(([n, p]) => n + ":" + p.join(",")).join("|") + posPick + JSON.stringify(Object.keys(S.DriverList || {}));
  if (key === posKey) return; posKey = key;
  const laps = Math.max(((S.LapCount || {}).TotalLaps) || 0, ...rows.map(([, p]) => p.length - 1));
  const cars = Math.max(rows.length, ...rows.flatMap(([, p]) => p.filter(isFinite)));
  const W = 640, L = 22, Rt = 40, T = 8, rowH = 15, H = T + (cars - 1) * rowH + 26;
  const x = k => L + (W - L - Rt) * k / Math.max(1, laps), y = p => T + (p - 1) * rowH;
  const seen = {};   // the second driver of each team gets a dashed line
  const lines = rows.map(([n, p]) => {
    const d = driver(n), c = colour(d), dash = seen[d.TeamName] ? ' stroke-dasharray="5 3"' : ""; seen[d.TeamName] = 1;
    const pts = p.map((v, k) => isFinite(v) && v > 0 ? `${x(k).toFixed(1)},${y(v).toFixed(1)}` : null).filter(Boolean);
    const lastK = p.reduce((a, v, k) => isFinite(v) && v > 0 ? k : a, 0), dim = posPick && posPick !== n;
    return { n, z: posPick === n ? 1 : 0, svg: `<g class="who" data-n="${n}" opacity="${dim ? 0.15 : 1}"><polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="${posPick === n ? 3.2 : 2}"${dash} stroke-linejoin="round"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="transparent" stroke-width="10"/>
      <circle cx="${x(lastK)}" cy="${y(p[lastK])}" r="3" fill="${c}"/><text x="${x(lastK) + 6}" y="${y(p[lastK]) + 3.5}" font-size="10" font-weight="800" fill="var(--text)">${esc(d.Tla || n)}</text></g>` };
  }).sort((a, b) => a.z - b.z).map(l => l.svg).join("");
  let grid = "";
  for (let k = 1; k <= cars; k++) grid += `<text x="${L - 6}" y="${y(k) + 3.5}" font-size="9.5" font-weight="700" fill="var(--dim)" text-anchor="end">${k}</text>`;
  const step = laps > 40 ? 10 : 5;
  for (let k = 0; k <= laps; k += step) grid += `<line x1="${x(k)}" x2="${x(k)}" y1="${T - 4}" y2="${H - 18}" stroke="var(--line)"/><text x="${x(k)}" y="${H - 5}" font-size="9.5" font-weight="700" fill="var(--dim)" text-anchor="middle">${k ? "L" + k : "Grid"}</text>`;
  $("posChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid}${lines}</svg>`;
}

// ---------- following a driver ----------
function renderFollow() {
  const lines = (S.TimingData || {}).Lines || {}, l = follow && lines[follow];
  show("p-follow", !!l);
  if (!l) return;
  const d = driver(follow), c = colour(d), race = (S.SessionInfo || {}).Type === "Race";
  const key = follow + "|" + d.TeamName + "|" + d.LastName;
  if (key !== fKey) {   // the photo and name only when the driver changes, so the picture doesn't reload
    fKey = key; $("p-follow").style.setProperty("--tc", c);
    $("fHead").innerHTML = `<img class="ph" src="${photo(d, 128)}" alt="">
      <div class="nm"><b>${esc(d.FirstName || "")} ${esc(d.LastName || d.Tla || follow)}</b>
        <span><img class="tl lg-light" src="${teamLogo(d.TeamName)}" alt="" onerror="this.remove()"><img class="tl lg-dark" src="${teamLogo(d.TeamName, true)}" alt="" onerror="this.remove()">${esc(d.TeamName || "")}</span></div>
      <div class="pos" id="fPos"></div>`;
  }
  const out = l.Retired || l.Stopped || l.KnockedOut;
  $("fPos").textContent = out ? (l.KnockedOut ? "KO" : "OUT") : "P" + (l.Position || "–");
  const rows = Object.entries(lines).sort((a, b) => (+a[1].Line || 99) - (+b[1].Line || 99)), i = rows.findIndex(([n]) => n === follow);
  const behind = rows[i + 1] && rows[i + 1][1], app = ((S.TimingAppData || {}).Lines || {})[follow] || {}, stints = list(app.Stints), tyre = stints[stints.length - 1];
  const val = x => esc(x) || "–", ivl = x => x && x.IntervalToPositionAhead ? x.IntervalToPositionAhead.Value : x && x.TimeDiffToPositionAhead;
  const moved = race && app.GridPos && l.Position ? +app.GridPos - +l.Position : null, owed = penaltyOwed(follow);
  const cell = (label, html, cls = "") => `<div><small>${label}</small><b class="${cls}">${html}</b></div>`;
  const html = [
    cell(race ? "Gap to leader" : "Gap to fastest", val(race ? l.GapToLeader : l.TimeDiffToFastest)),
    cell("Car ahead", val(ivl(l))),
    cell("Car behind", val(ivl(behind))),
    cell(race ? "Places" : "Laps", race ? (moved == null ? "–" : moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : "=") : val(l.NumberOfLaps), race && moved > 0 ? "t-green" : ""),
    cell("Last lap", val((l.LastLapTime || {}).Value), timeClass(l.LastLapTime)),
    cell("Best lap", val((l.BestLapTime || {}).Value), (l.BestLapTime || {}).Position === 1 ? "t-purple" : ""),
    cell("Tyre", tyre ? `${tyreIcon(tyre.Compound)} ${esc(tyre.TotalLaps)} laps` : "–"),
    cell(owed ? "Penalty" : "Pit stops", owed ? esc(owed) : val(l.NumberOfPitStops != null ? l.NumberOfPitStops : Math.max(0, stints.length - 1))),
    ...list(l.Sectors).slice(0, 3).map((sec, k) => cell("Sector " + (k + 1), val(sec.Value), timeClass(sec))),
    cell("Top speed", (l.Speeds || {}).ST && l.Speeds.ST.Value ? esc(l.Speeds.ST.Value) + " km/h" : "–", timeClass((l.Speeds || {}).ST))
  ].join("");
  if ($("fStats")._html !== html) { $("fStats").innerHTML = html; $("fStats")._html = html; }
}

// ---------- pit stops ----------
const tyreIcon = c => { const [ltr, ring] = TYRES[c] || ["?", "#777"]; return `<span class="stint"><span style="border-color:${ring};color:${ring}">${ltr}</span></span>`; };
function renderPits() {
  const race = (S.SessionInfo || {}).Type === "Race";
  show("p-pits", race);
  if (!race) return;
  const stops = mode === "replay" ? R.data.pits.filter(p => p.lap && p.out <= R.t).map(p => ({ n: p.n, lap: p.lap, dur: p.lane })) : Object.values(pitLog);
  const app = (S.TimingAppData || {}).Lines || {};
  const tyresAt = (n, lap) => {   // the sets before and after a stop: the stint that began nearest that lap
    const st = list((app[n] || {}).Stints); let cum = 0, best = -1, bd = Infinity;
    st.forEach((x, i) => { if (i && Math.abs(cum - lap) < bd) { bd = Math.abs(cum - lap); best = i; } cum += Math.max(0, (+x.TotalLaps || 0) - (+x.StartLaps || 0)); });
    return best > 0 ? `${tyreIcon(st[best - 1].Compound)}→${tyreIcon(st[best].Compound)}` : "";
  };
  // F1's free feed has only the pit lane time (~20 s). The time stood still is estimated: lane time minus the drive through the lane,
  // taken as the race's quickest lane time less a quick 2.2 s stop (checked on three 2026 races: usually within 0.2-0.3 s)
  const lanes = (mode === "replay" ? R.data.pits.map(p => p.lane) : stops.map(s => s.dur)).filter(x => x > 0);
  const drive = lanes.length ? Math.min(...lanes) - 2.2 : null;
  for (const st of stops) st.stop = st.dur && drive != null && st.dur - drive < 15 ? Math.max(1.8, st.dur - drive) : null;   // longer: a red flag or a repair
  const quick = Math.min(...stops.map(s => s.stop || Infinity)), who = stops.find(s => s.stop === quick);
  $("pitBest").innerHTML = who ? `≈ estimated · quickest ${quick.toFixed(1)}s ${esc(driver(who.n).Tla || who.n)}` : "";
  const html = stops.length ? stops.sort((a, b) => b.lap - a.lap || (a.stop || 99) - (b.stop || 99)).map(s => `<li><span class="lap">Lap ${esc(s.lap)}</span>${dtag(s.n, true)}
      <span class="tyres">${tyresAt(s.n, s.lap)}</span><span class="dur">${s.stop ? (s.stop === quick ? `<span class="pill purple">≈${s.stop.toFixed(1)}s</span>` : `≈${s.stop.toFixed(1)}s`) : "–"}<small>${s.dur ? `lane ${s.dur.toFixed(1)}s` : ""}</small></span></li>`).join("")
    : `<li class="empty">No pit stops yet</li>`;
  if ($("pits")._html !== html) { $("pits").innerHTML = html; $("pits")._html = html; }
}

// ---------- next session (live, between sessions) ----------
let sched = null, nextKey = "";
async function loadSchedule() {
  try { const s = await currentSeason(); sched = allSessions(s.rounds).sort((a, b) => a.start - b.start); nextKey = ""; } catch (e) {}
}
function renderNext() {
  const t = Date.now(), on = mode === "live" && sched && ((S.SessionStatus || {}).Status || "") !== "Started" && !sched.some(s => t >= s.start - 15 * 60000 && t <= s.end + 30 * 60000);
  const next = on && sched.find(s => s.start > t);
  show("next", !!next);
  if (!next) return;
  const last = [...sched].reverse().find(s => s.end < t && s.key), key = next.start + "|" + (last && last.key);
  if (key !== nextKey) {
    nextKey = key;
    $("nextName").textContent = `${next.round.name} · ${next.name}`;
    $("nextWhen").textContent = fmtWhen(next.start);
    $("nextReplay").hidden = !last;
    if (last) { $("nextReplay").innerHTML = `${ICONS.replay}Replay ${esc(last.short)} · ${esc(last.round.name.replace(/ Grand Prix$/, " GP"))}`; $("nextReplay").href = `#/replay/${last.key}`; }
  }
  const html = countdownHtml(next.start - t);
  if ($("nextCount")._html !== html) { $("nextCount").innerHTML = html; $("nextCount")._html = html; }
}

// ---------- tyre strategy ----------
function renderStrategy() {
  const lines = (S.TimingData || {}).Lines || {}, app = (S.TimingAppData || {}).Lines || {};
  const order = Object.entries(lines).sort((a, b) => (+a[1].Line || 99) - (+b[1].Line || 99)).map(([n]) => n);
  const rows = order.map(n => [n, list((app[n] || {}).Stints).map(st => ({ c: st.Compound, laps: Math.max(0, (+st.TotalLaps || 0) - (+st.StartLaps || 0)), used: st.New === "false" || +st.StartLaps > 0 }))])
    .filter(([, st]) => st.length);
  show("p-strat", rows.length > 0);
  if (!rows.length) return;
  const total = Math.max(((S.LapCount || {}).TotalLaps) || 0, ...rows.map(([, st]) => st.reduce((a, b) => a + b.laps, 0)), 1);
  const dim = n => follow && follow !== n ? " dim" : "";
  const html = rows.map(([n, st]) => `<span class="${dim(n)}">${dtag(n, true)}</span><div class="bar${dim(n)}">${st.map(x => {
    const [ltr, col] = TYRES[x.c] || ["?", "#777"], w = 100 * x.laps / total;
    return `<span class="${x.used ? "used" : ""}" style="width:${w.toFixed(2)}%;background-color:${col};${x.c === "WET" ? "color:#fff" : ""}" title="${esc(x.c || "")}${x.used ? " (used)" : ""}, ${x.laps} laps">${w > 6 ? ltr + " " + x.laps : ""}</span>`;
  }).join("")}</div>`).join("") + `<div class="axis"><span>Lap 0</span><span>${Math.round(total / 2)}</span><span>${total}</span></div>`;
  if ($("strat")._html !== html) { $("strat").innerHTML = html; $("strat")._html = html; }
}

// ---------- team radio ----------
const audio = new Audio();
let playingSrc = null, userPlayed = false, radioSeen = null, radioWho = "";
const mmss = s => isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "";
const radioUrl = c => /^https?:/.test(c.Path || "") ? c.Path : STATIC + ((S.SessionInfo || {}).Path || "") + c.Path;
const BARS = 34;
const waveOf = src => { let h = 0; for (const ch of src) h = (h * 31 + ch.charCodeAt(0)) >>> 0;   // a steady shape per clip (the audio itself can't be read)
  return Array.from({ length: BARS }, (_, i) => { h = (h * 1103515245 + 12345) >>> 0; return 25 + (h % 70) * (0.55 + 0.45 * Math.sin(i / 3)); }); };
function lapOf(t) {   // the race's lap at a moment: exact in a replay; live, the lap counter seen so far, else race control's lap numbers
  if (mode === "replay") return R.data && R.data.sess.session_type === "Race" ? Math.max(1, lapAt(t)) : null;
  if ((S.SessionInfo || {}).Type !== "Race") return null;
  let lap = null;
  for (const x of lapLog) if (x.at <= t) lap = x.lap;
  if (lap) return lap;
  for (const m of list((S.RaceControlMessages || {}).Messages)) if (m.Lap && utc(m.Utc) <= t) lap = m.Lap;
  return lap;
}
let radioKey = "";
function renderRadio() {
  const all = list((S.TeamRadio || {}).Captures);
  const have = [...new Set(all.map(c => c.RacingNumber))].sort((a, b) => (driver(a).Tla || a).localeCompare(driver(b).Tla || b));
  if (radioWho && !have.includes(radioWho)) radioWho = "";
  const chips = `<button type="button" data-n="" aria-pressed="${!radioWho}">All · ${all.length}</button>` +
    have.map(n => `<button type="button" data-n="${esc(n)}" style="${tagVars(colour(driver(n)))}" aria-pressed="${radioWho === n}">${esc(driver(n).Tla || n)}</button>`).join("");
  if ($("radioWho")._html !== chips) { $("radioWho").innerHTML = chips; $("radioWho")._html = chips; }
  const caps = all.filter(c => !radioWho || c.RacingNumber === radioWho).reverse();   // newest first; every message F1 has published
  const key = caps.length + ":" + (caps[0] && caps[0].Utc) + ":" + radioWho + ":" + Math.floor(now() / 30000);
  if (key === radioKey) return;          // otherwise don't rebuild while something is playing
  radioKey = key;
  // newest first, grouped under the lap they came on (practice and qualifying: by time of day, in 10-minute steps)
  let html = "", group = null;
  for (const c of caps) {
    const d = driver(c.RacingNumber), tc = colour(d), at = utc(c.Utc), fresh = now() - at < 5 * 60000, src = radioUrl(c);
    const lap = lapOf(at), g = lap ? `Lap ${lap}` : hhmm(Math.floor(at / 600000) * 600000);
    if (g !== group) { group = g; html += `<li class="tl-lap">${esc(g)}</li>`; }
    html += `<li class="tl-item" data-src="${esc(src)}" style="${tagVars(tc)}">
      <span class="tl-time">${hhmm(at)}</span>
      <span class="tl-who"><img class="tl-face" src="${photo(d, 96)}" alt="">${dtag(c.RacingNumber, true)}<span class="nm">${esc(d.FirstName ? d.FirstName + " " + d.LastName : "")}${fresh ? ` <span class="new">NEW</span>` : ""}</span></span>
      <span class="tl-play"><span class="wave">${waveOf(src).map(h => `<b style="height:${h.toFixed(0)}%"></b>`).join("")}</span><span class="dur"></span>
        <button class="play" type="button" aria-label="Play radio from ${esc(d.LastName || "")}">${ICONS.play}</button></span></li>`;
  }
  $("radio").innerHTML = html || `<li class="empty">${radioWho ? "No radio from this driver yet" : "No team radio yet"}</li>`;
  syncRadio();
}
function radioArrived() {   // auto-play: a message that wasn't there before, once you've played one yourself
  const caps = list((S.TeamRadio || {}).Captures), newest = caps[caps.length - 1];
  const key = newest ? radioUrl(newest) : "";
  if (radioSeen === null) { radioSeen = key; return; }
  if (key && key !== radioSeen) {
    radioSeen = key;
    if ($("radioAuto") && $("radioAuto").checked && userPlayed && audio.paused && (!radioWho || newest.RacingNumber === radioWho)) playSrc(key);
  }
}
function syncRadio() {
  for (const li of document.querySelectorAll("#radio li[data-src]")) {
    const on = li.dataset.src === playingSrc, part = on && audio.duration ? audio.currentTime / audio.duration : 0;
    li.classList.toggle("playing", on && !audio.paused);
    li.querySelector(".play").innerHTML = on && !audio.paused ? ICONS.pause : ICONS.play;
    li.querySelectorAll(".wave b").forEach((b, i) => b.classList.toggle("on", on && i / BARS < part));
    li.querySelector(".dur").textContent = on && audio.duration ? mmss(audio.duration - audio.currentTime) : "";
  }
}
function playSrc(src) { playingSrc = src; audio.src = src; audio.play().catch(() => {}); }
for (const ev of ["play", "pause", "timeupdate", "loadedmetadata"]) audio.addEventListener(ev, () => mode !== "off" && syncRadio());
audio.addEventListener("ended", () => {
  if (mode === "off") return;
  syncRadio();
  if (!$("radioNext") || !$("radioNext").checked) return;
  const items = [...document.querySelectorAll("#radio li[data-src]")], i = items.findIndex(li => li.dataset.src === playingSrc);
  if (i >= 0 && items[i + 1]) playSrc(items[i + 1].dataset.src);   // the next one down the list
});

// ---------- track map ----------
// Drawn two ways: on a real map of the circuit's surroundings (geomap.js: 3D or from the top), or as the classic flat outline.
// Car positions are worked out on the outline either way; the real map gets them turned into longitude and latitude.
let circuit = null, circuitKey = null, trackLen = [], mapBox = null, sectorIdx = [];
let mapView = "3d", geo = null, geoMaking = null, geoRef = null, geoKey = "", geoToken = 0, inv = null, secCut = null, cornerLabels = [];
const isDark = () => document.documentElement.dataset.mode === "dark";
// a point of the flat outline (screen units) back to F1's coordinates, then to [lng, lat]
const toGeo = (sx, sy) => { const { minX, minY, ox, oy, k, h, rot } = inv, [x, y] = rotate(minX + (sx - ox) / k, minY + (h - sy - oy) / k, -rot); return geoRef.toLngLat(x, y); };
let geoRefP = null;
async function setupGeo() {   // can run several times at once: they share the work, and each finishes the job
  const box = $("gmap"); if (!box || !circuit) return;
  if (mapView === "classic" || !G.supported()) { $("mapwrap").classList.remove("geo"); return; }
  const screen = geoToken, key = circuitKey + "|" + year();   // geoToken changes when this screen closes
  try {
    if (geoKey !== key) { geoKey = key; geoRef = null; geoRefP = G.georef(circuit.x, circuit.y).catch(() => null); }
    const ref = await geoRefP;
    if (screen !== geoToken || geoKey !== key) return;
    geoRef = ref;
    if (!geoRef) { $("mapwrap").classList.remove("geo"); return; }   // a circuit the shapes dataset doesn't have: the classic map
    if (!geo) {   // one map per screen
      const p = geoMaking = geoMaking || G.createMap(box, { dark: isDark(), onCar: n => setFollow(n) });
      const made = await p;
      if (p !== geoMaking) return;   // the screen was closed meanwhile (stop() destroys it)
      geo = made;
    }
    if (screen !== geoToken || geoKey !== key || mapView === "classic") return;
    $("mapwrap").classList.add("geo");   // shown first, so the map knows its size when it frames the circuit
    pushTrack();
    geo.view(mapView);
  } catch (e) { if (screen === geoToken) $("mapwrap").classList.remove("geo"); }
}
function pushTrack() {   // the circuit, its sectors, corners, pit lane and flags onto the real map
  if (!geo || !geoRef || !circuit) return;
  circuit.geo = circuit.x.map((x, i) => geoRef.toLngLat(x, circuit.y[i]));
  geo.setTrack(circuit.geo, secCut, circuit.rotation, cornerLabels.map(c => ({ n: c.n, at: toGeo(c.x, c.y) })));
  geo.setPit(pitLane && pitLane.screen ? pitLane.screen.map(p => toGeo(p[0], p[1])) : []);
  flagKey = ""; dirty = true;
}
export const mapState = () => ({ circuit, trackLen, mapBox, pitLane });
async function loadCircuit() {
  const key = (((S.SessionInfo || {}).Meeting || {}).Circuit || {}).Key;
  if (!key || key === circuitKey) return;
  circuitKey = key; circuit = null; pitLane = null; $("map").innerHTML = ""; resetCars();
  for (const y of [year(), year() - 1, year() - 2]) {
    try { const r = await fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${y}`); if (r.ok) { circuit = await r.json(); break; } } catch (e) {}
  }
  let sk = null;   // an OpenF1 session at this circuit, for what MultiViewer doesn't have
  try { sk = await trackSession(key); } catch (e) {}
  if (!circuit && sk) try { circuit = await outlineFromLap(sk); } catch (e) {}   // a circuit MultiViewer doesn't have (2026: Madrid, Kuala Lumpur)
  if (key !== circuitKey || mode === "off") return;
  if (circuit) drawCircuit();
  if (circuit && sk) try { pitLane = await pitLaneFrom(sk); if (key === circuitKey && mode !== "off") drawPit(); } catch (e) {}
}
let pitLane = null;   // the pit lane as a car drove it: raw x/y and how far through (in time) each point is
const isoAt = t => new Date(t).toISOString();
async function trackSession(key) {   // replay: this session; live: the latest finished session at this circuit (this weekend's, else last year's)
  if (mode === "replay" && R.data) return R.data.sess.session_key;
  for (const y of [year(), year() - 1]) {
    const ss = (await of1(`sessions?circuit_key=${key}&year=${y}`, { ttl: 6 * 3600000 })).filter(s => Date.parse(s.date_end) < Date.now() - 3600000);
    if (ss.length) return ss.sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start))[0].session_key;
  }
  return null;
}
async function outlineFromLap(sk) {   // the track from one ordinary lap's car positions (same units as MultiViewer's outlines)
  const laps = (await of1(`laps?session_key=${sk}`, { ttl: 0 })).filter(l => l.lap_duration && !l.is_pit_out_lap && l.date_start);
  if (!laps.length) return null;
  const mid = laps.map(l => l.lap_duration).sort((a, b) => a - b)[laps.length >> 1];
  const lap = laps.find(l => Math.abs(l.lap_duration - mid) < mid * 0.02) || laps[0], a = Date.parse(lap.date_start), b = a + lap.lap_duration * 1000;
  const pts = (await of1(`location?session_key=${sk}&driver_number=${lap.driver_number}&date>=${isoAt(a)}&date<=${isoAt(b)}`, { ttl: 7 * 86400000 })).filter(p => p.x || p.y);
  if (pts.length < 50) return null;
  return { x: pts.map(p => p.x), y: pts.map(p => p.y), trackPositionTime: pts.map(p => Date.parse(p.date)), rotation: 0, corners: [], marshalSectors: [], fromLap: true };
}
async function pitLaneFrom(sk) {   // one ordinary pit stop's path: the stretch where the car is off the racing line
  const stops = (await of1(`pit?session_key=${sk}`, { ttl: 7 * 86400000 })).filter(p => p.lane_duration > 12 && p.lane_duration < 45);
  if (!stops.length) return null;
  const p = stops[0], a = Date.parse(p.date) - (p.lane_duration + 15) * 1000, b = Date.parse(p.date) + 15000;   // the whole lane: it ends ~5 s after the pit time
  const pts = (await of1(`location?session_key=${sk}&driver_number=${p.driver_number}&date>=${isoAt(a)}&date<=${isoAt(b)}`, { ttl: 7 * 86400000 })).filter(q => q.x || q.y);
  if (!circuit) return null;
  const off = pts.map(q => { let m = Infinity; for (let i = 0; i < circuit.x.length; i += 2) m = Math.min(m, (circuit.x[i] - q.x) ** 2 + (circuit.y[i] - q.y) ** 2); return Math.sqrt(m) > 45; });
  let best = [0, -1], run = null;   // the longest stretch off the track
  off.forEach((o, i) => { if (o) { run = run || [i, i]; run[1] = i; if (run[1] - run[0] > best[1] - best[0]) best = run.slice(); } else run = null; });
  if (best[1] - best[0] < 20) return null;
  const seg = pts.slice(Math.max(0, best[0] - 3), best[1] + 4), t0 = Date.parse(seg[0].date), t1 = Date.parse(seg[seg.length - 1].date);
  return { raw: seg.map(q => [q.x, q.y]), tf: seg.map(q => (Date.parse(q.date) - t0) / (t1 - t0 || 1)) };
}
function drawPit() {   // the pit lane: drawn alongside the stretch of track it runs beside, merging in at the entry and exit
  const g = $("pit"); if (!g || !circuit || !pitLane) return;
  const rot = circuit.rotation || 0, T = circuit.screen, n = T.length;
  const real = pitLane.raw.map(([x, y]) => mapBox(rotate(x, y, rot)));
  const nearest = ([x, y]) => { let bi = 0, bd = Infinity; T.forEach((q, i) => { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
  const ie = nearest(real[0]), ix = nearest(real[real.length - 1]), span = (ix - ie + n) % n;   // entry -> exit, the way the cars go
  if (span < 3 || span > n / 2) { pitLane.even = pitLane.screen = null; g.innerHTML = ""; return; }   // the trace doesn't fit: no pit lane
  // which side: where the recorded car was, relative to the track's direction, halfway down the lane
  const mid = real[real.length >> 1], im = nearest(mid), tA = T[(im - 2 + n) % n], tB = T[(im + 2) % n];
  const side = Math.sign((tB[0] - tA[0]) * (mid[1] - T[im][1]) - (tB[1] - tA[1]) * (mid[0] - T[im][0])) || 1;
  const pts = [];
  for (let k = 0; k <= span; k++) {
    const i = (ie + k) % n, a = T[(i - 3 + n) % n], b = T[(i + 3) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const u = k / span, ease = Math.min(1, Math.min(u, 1 - u) / 0.18), off = 9.5 * ease * ease * (3 - 2 * ease);   // smooth in and out
    pts.push([T[i][0] - (b[1] - a[1]) / L * side * off, T[i][1] + (b[0] - a[0]) / L * side * off]);
  }
  for (let pass = 0; pass < 3; pass++) for (let k = 1; k < pts.length - 1; k++)   // smooth out the outline's little kinks
    pts[k] = [(pts[k - 1][0] + 2 * pts[k][0] + pts[k + 1][0]) / 4, (pts[k - 1][1] + 2 * pts[k][1] + pts[k + 1][1]) / 4];
  // evenly spaced points, so the dashes are even
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1, along = dist => {
    let i = 1; while (i < cum.length - 1 && cum[i] < dist) i++;
    const v = cum[i] > cum[i - 1] ? (dist - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * v, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * v];
  };
  const P = []; for (let dist = 0; dist < total; dist += 1.5) P.push(along(dist)); P.push(along(total));
  // how far along the lane the recorded car was at each moment (so pitting cars slow down and stop where it did)
  const rc = [0]; for (let i = 1; i < real.length; i++) rc.push(rc[i - 1] + Math.hypot(real[i][0] - real[i - 1][0], real[i][1] - real[i - 1][1]));
  pitLane.df = rc.map(c => c / (rc[rc.length - 1] || 1)); pitLane.along = along; pitLane.total = total; pitLane.even = P; pitLane.screen = P;
  pitLane.fe = trackLen[ie]; pitLane.fx = trackLen[ix];
  g.innerHTML = `<path class="road" d="${pathOf(P)}" fill="none" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;   // a thin solid line beside the track
  if (geo && geoRef) geo.setPit(P.map(p => toGeo(p[0], p[1])));
}
function pitPointAt(f) {   // a fraction of the time through the pit lane -> how far along it the recorded car was -> a point on the drawn line
  const L = pitLane.tf, D = pitLane.df; f = Math.max(0, Math.min(1, f));
  let i = 1; while (i < L.length - 1 && L[i] < f) i++;
  const u = L[i] > L[i - 1] ? (f - L[i - 1]) / (L[i] - L[i - 1]) : 0;
  return pitLane.along((D[i - 1] + (D[i] - D[i - 1]) * u) * pitLane.total);
}
export function rotate(x, y, deg) { const a = deg * Math.PI / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; }
export const pathOf = pts => "M" + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L");
function drawCircuit() {
  const rot = circuit.rotation || 0;
  const pts = circuit.x.map((x, i) => rotate(x, circuit.y[i], rot));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // the box takes the circuit's own shape, so the track fills the width
  const phone = matchMedia("(max-width: 900px)").matches, pad = phone ? 22 : 28, w = 400;
  const h = Math.round(Math.min(phone ? 600 : 440, Math.max(250, (w - 2 * pad) * (maxY - minY) / (maxX - minX) + 2 * pad)));
  const k = Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxY - minY));
  $("map").setAttribute("viewBox", `0 0 ${w} ${h}`);
  const ox = (w - (maxX - minX) * k) / 2, oy = (h - (maxY - minY) * k) / 2;
  mapBox = ([x, y]) => [ox + (x - minX) * k, h - (oy + (y - minY) * k)];
  inv = { minX, minY, ox, oy, k, h, rot };   // to undo mapBox for the real map
  circuit.screen = pts.map(mapBox); circuit.w = w; circuit.h = h;
  const times = circuit.trackPositionTime || [];   // when a real car reached each point: place cars by time through the lap
  const t0 = times[0] || 0, t1 = times[times.length - 1] || 1;
  trackLen = times.length === pts.length ? times.map(t => (t - t0) / (t1 - t0 || 1)) : pts.map((_, i) => i / (pts.length - 1));
  const nearest = (x, y) => { let bi = 0, bd = Infinity; circuit.screen.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
  // marshal sectors: where each starts on the outline, so a yellow flag can light up its stretch of track
  sectorIdx = (circuit.marshalSectors || []).map(s => { const [x, y] = mapBox(rotate(s.trackPosition.x, s.trackPosition.y, rot)); return { n: s.number, i: nearest(x, y) }; }).sort((a, b) => a.i - b.i);
  const d = pathOf(circuit.screen) + "Z";
  cornerLabels = [];
  const corners = (circuit.corners || []).map(c => {
    const [x, y] = mapBox(rotate(c.trackPosition.x, c.trackPosition.y, rot));
    const a = (c.angle || 0) * Math.PI / 180, ox2 = Math.cos(a) * 15, oy2 = -Math.sin(a) * 15;   // set off to the side of the track
    cornerLabels.push({ n: c.number, x: x + ox2, y: y + oy2 });
    return `<g transform="translate(${(x + ox2).toFixed(1)},${(y + oy2).toFixed(1)})"><circle r="6" fill="var(--corner)"/><text y="2.4" font-size="6.8" font-weight="800" text-anchor="middle" fill="var(--corner-text)">${c.number}</text></g>`;
  }).join("");
  circuit.cornerPts = (circuit.corners || []).map(c => ({ n: c.number, i: nearest(...mapBox(rotate(c.trackPosition.x, c.trackPosition.y, rot))) }));
  const [sx, sy] = circuit.screen[0], [nx, ny] = circuit.screen[3], ang = Math.atan2(ny - sy, nx - sx) * 180 / Math.PI;
  $("map").innerHTML = `<g id="pit"></g><path d="${d}" fill="none" stroke="var(--track-edge)" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/>
    <g id="secs"></g><g id="flags"></g>${corners}
    <g transform="translate(${sx.toFixed(1)},${sy.toFixed(1)}) rotate(${(ang + 90).toFixed(1)})"><rect x="-7" y="-2" width="14" height="4" fill="#fff"/>
      ${[0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="${-7 + i * 2}" y="${i % 2 ? 0 : -2}" width="2" height="2" fill="#000"/>`).join("")}</g>
    <g id="bats"></g><g id="cars"></g>`;
  flagKey = ""; secKey = ""; resetCars(); drawPit(); A.mapReady();
  if (geo && geoRef && geoKey === circuitKey + "|" + year() && $("mapwrap").classList.contains("geo")) pushTrack(); else setupGeo();
}
const SECTOR_COLOURS = ["#ff3b5c", "#3b9eff", "#ffd60a"];
let secKey = "";
function renderSectors() {   // where sectors 1 and 2 end, by the fastest sector times: how far through a lap (in time) each one ends
  const g = $("secs"); if (!g || !circuit) return;
  const best = [0, 1, 2].map(k => { let v = Infinity; for (const l of Object.values((S.TimingStats || {}).Lines || {})) { const b = list(l.BestSectors)[k]; if (b && +b.Value) v = Math.min(v, +b.Value); } return v; });
  const tot = best[0] + best[1] + best[2];
  const f = isFinite(tot) ? [best[0] / tot, (best[0] + best[1]) / tot] : [1 / 3, 2 / 3];
  const key = f.map(v => v.toFixed(3)).join();
  if (key === secKey) return; secKey = key;
  const at = v => { const i = trackLen.findIndex(t => t >= v); return i < 0 ? trackLen.length - 1 : i; };
  const cut = secCut = [0, at(f[0]), at(f[1]), circuit.screen.length - 1];
  if (geo && geoRef && circuit.geo) geo.setTrack(circuit.geo, cut, circuit.rotation, cornerLabels.map(c => ({ n: c.n, at: toGeo(c.x, c.y) })));
  g.innerHTML = SECTOR_COLOURS.map((c, k) => `<path d="${pathOf(circuit.screen.slice(cut[k], cut[k + 1] + 1).concat(k === 2 ? [circuit.screen[0]] : []))}" fill="none" stroke="${c}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/>`).join("");
}
let flagKey = "";
function renderFlags() {   // yellow and double-yellow sectors, lit up on the track; the whole track under a red flag or safety car
  const g = $("flags"); if (!g || !circuit) return;
  const { yellow } = flagState(list((S.RaceControlMessages || {}).Messages));
  const st = (S.TrackStatus || {}).Status;
  const key = JSON.stringify(yellow) + st;
  if (key === flagKey) return; flagKey = key;
  $("mapLegend").hidden = !Object.keys(yellow).length;
  const parts = [];
  if (st === "5" || st === "4" || st === "6" || st === "7")
    parts.push(`<path d="${pathOf(circuit.screen)}Z" fill="none" stroke="${st === "5" ? "#e10600" : "#f59e0b"}" stroke-width="5" stroke-linejoin="round" opacity=".85"/>`);
  for (const [n, kind] of Object.entries(yellow)) {
    const j = sectorIdx.findIndex(s => String(s.n) === String(n)); if (j < 0) continue;
    const a = sectorIdx[j].i, b = (sectorIdx[j + 1] || { i: circuit.screen.length - 1 }).i;
    const seg = circuit.screen.slice(a, Math.max(a + 2, b + 1));
    parts.push(`<path class="yf" d="${pathOf(seg)}" fill="none" stroke="#facc15" stroke-width="${kind === 2 ? 9 : 7}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  g.innerHTML = parts.join("");
  if (geo && geoRef && circuit.geo) {   // the same on the real map
    const G2 = circuit.geo, out = [];
    if (st === "5" || st === "4" || st === "6" || st === "7") out.push({ k: st === "5" ? "red" : "sc", pts: [...G2, G2[0]] });
    for (const [n, kind] of Object.entries(yellow)) {
      const j = sectorIdx.findIndex(s => String(s.n) === String(n)); if (j < 0) continue;
      const a = sectorIdx[j].i, b = (sectorIdx[j + 1] || { i: G2.length - 1 }).i;
      out.push({ k: kind === 2 ? "double" : "yellow", pts: G2.slice(a, Math.max(a + 2, b + 1)) });
    }
    geo.setFlags(out);
  }
}
export function pointAt(f) {   // a fraction of the lap -> a point on the outline (binary search), and that point's index
  f = ((f % 1) + 1) % 1;
  let lo = 1, hi = trackLen.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (trackLen[m] < f) lo = m + 1; else hi = m; }
  const i = lo, a = trackLen[i - 1], b = trackLen[i], u = b > a ? (f - a) / (b - a) : 0, p = circuit.screen[i - 1], q = circuit.screen[i];
  return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, i];
}
export function lapFraction(num, l, t = now()) {
  if (mode === "replay") {   // where in its lap the car is, from the lap's start and length; between laps, the next lap
    const D = R.data, first = (l._laps || [])[0];
    if (D && D.form && first && t < first.start) {   // before the start: on the grid, and round the formation lap together
      const slot = ((D.lapPos[0] || {})[num] || 20) * 0.0035, go = Math.min(1, Math.max(0, (t - D.form.from) / (D.form.to - D.form.from - 45000)));
      return go - slot;
    }
    const L = (l._laps || []).find(x => x.start <= t && t < x.end) || l._lap;
    if (!L || !L.dur) return null;
    let f = (t - L.start) / (L.dur * 1000);
    // around a pit stop, bend the in-lap so the car reaches the pit entry as it goes in, and the out-lap so it leaves from the exit
    const stop = pitLane && pitLane.fe != null && D.pits.find(p => p.n === num && L.start <= p.out && p.in <= L.end);
    if (stop) {
      const at = x => (x - L.start) / (L.dur * 1000), near = (target, v) => target + Math.round(v - target);
      if (t < stop.in && stop.in < L.end) { const v = at(stop.in), fe = near(pitLane.fe, v); f += (fe - v) * (t - L.start) / (stop.in - L.start); }
      else if (t > stop.out && stop.out > L.start) { const v = at(stop.out), fx = near(pitLane.fx, v); f += (fx - v) * (L.end - t) / (L.end - stop.out); }
    }
    return f;
  }
  const p = prog[num]; if (!p || !p.total) return null;
  const lap = (seconds((l.LastLapTime || {}).Value) || seconds((l.BestLapTime || {}).Value) || 100) * 1000;
  const end = k => segFrac[k] != null ? segFrac[k] : (k + 1) / p.total;   // learned, or evenly spaced until a lap is seen
  const a = p.n ? end(p.n - 1) : 0, b = p.n < p.total ? end(p.n) : 1 + end(0);
  return a + (b - a) * Math.min(1.3, Math.max(0, (now() - p.at) / ((b - a) * lap)));   // keep moving if the next mark is a little late
}
const cars = {};   // one drawn tag per car, moved smoothly every frame
function resetCars() { for (const k in cars) delete cars[k]; const g = $("cars"); if (g) g.innerHTML = ""; }
let lastFrame = 0, rafId = 0;
const SVGNS = "http://www.w3.org/2000/svg";
const pitSince = {};   // live: when each car was first seen in the pit lane
function pitProgress(num, at) {   // how far through the pit lane a pitting car is (0..1)
  if (mode === "replay") { const p = R.data.pits.find(x => x.n === num && x.in <= at && at <= x.out); return p ? (at - p.in) / (p.out - p.in) : 0.5; }
  const since = pitSince[num] = pitSince[num] || at, lanes = Object.values(pitLog).map(s => s.dur * 1000).sort((a, b) => a - b);
  return Math.min(0.97, (at - since) / (lanes.length ? lanes[lanes.length >> 1] : 22000));   // waits near the exit if it takes longer
}
function animateCars(ts) {   // each car: a dot on the racing line, with its tag just above it
  if (mode === "off") return;
  rafId = requestAnimationFrame(animateCars);
  const g = $("cars"), dt = Math.min(0.1, lastFrame ? (ts - lastFrame) / 1000 : 0); lastFrame = ts;
  if (!g || !circuit || !trackLen.length) return;
  const at = mode === "replay" && R.playing && R.last ? Math.min(R.end, R.t + (performance.now() - R.last) * R.speed) : now();   // replay: the moment this frame shows
  const lines = (S.TimingData || {}).Lines || {};
  const over = mode === "live" && ["Finished", "Finalised", "Ends", "Inactive"].includes((S.SessionStatus || {}).Status);
  const seen = new Set(), red = (S.TrackStatus || {}).Status === "5";
  const running = Object.entries(lines).filter(([, l]) => !l.Retired && !l.Stopped).sort((a, b) => (+a[1].Line || 99) - (+b[1].Line || 99)).map(([n]) => n);
  for (const [num, l] of over ? [] : Object.entries(lines)) {
    if (l.Retired || l.Stopped) continue;
    // in the pit lane: pitting, or everyone under a red flag (parked in running order, the leader nearest the exit)
    let pf = null;
    // in the pit lane? A replay decides it at this very frame (the timing table's flag only updates 4 times a second)
    const inPit = mode === "replay" ? R.data.pits.some(p => p.n === num && p.in <= at && at <= p.out) : l.InPit;
    if (pitLane && pitLane.screen) {
      if (red) pf = 0.9 - 0.8 * running.indexOf(num) / Math.max(1, running.length - 1);
      else if (inPit) pf = pitProgress(num, at);
    }
    if (inPit && pf == null) { delete pitSince[num]; continue; }
    if (!inPit) delete pitSince[num];
    const target = pf != null ? null : lapFraction(num, l, at); if (pf == null && target == null) continue;
    let c = cars[num];
    if (!c) {
      const d = driver(num), tc = colour(d), no = String(d.RacingNumber || num), nw = no.length > 1 ? 15 : 11, tw = 23;
      const el = document.createElementNS(SVGNS, "g"); el.setAttribute("class", "car"); el.dataset.n = num;
      el.innerHTML = `<line class="lead" stroke="${tc}"/><circle class="dot" r="4.4" fill="${tc}"/>
        <g class="tag"><rect class="tbg" width="${nw + tw}" height="12" rx="3"/><rect width="${nw}" height="12" rx="3" fill="${tc}"/><rect x="${nw - 3}" width="3" height="12" fill="${tc}"/>
        <text class="tn" x="${nw / 2}" y="8.7" fill="${ink(tc)}">${esc(no)}</text><text class="tt" x="${nw + tw / 2}" y="8.8">${esc(d.Tla || num)}</text></g>`;
      g.appendChild(el); c = cars[num] = { el, f: target || 0, w: nw + tw, lead: el.firstChild, dot: el.children[1], tag: el.children[2] };
    }
    if (pf != null) {   // in the pit lane: glide there, then follow the lane
      const [px, py] = pitPointAt(pf);
      if (c.x == null || !c.inPit) { c.x = c.x == null ? px : c.x; c.y = c.y == null ? py : c.y; }
      const far = Math.hypot(px - c.x, py - c.y), k = c.inPit || far < 6 ? 1 : Math.min(1, dt * 3);   // glide only if it was somewhere else (a red flag)
      c.x += (px - c.x) * k; c.y += (py - c.y) * k;
      if (Math.hypot(px - c.x, py - c.y) < 0.5) c.inPit = true;
    } else {
      if (c.inPit && mode !== "replay" && pitLane && pitLane.fx != null) c.f = pitLane.fx;   // live: just out of the pits, carry on from the exit
      c.inPit = false;
      // replay: exactly where its lap timing puts it. Live: ease toward the estimate, so a timing mark that comes early or late isn't a jump
      let diff = target - c.f; diff -= Math.round(diff);
      c.f += mode === "replay" || Math.abs(diff) > 0.25 ? diff : diff * Math.min(1, dt * 4);
      if (red && !(pitLane && pitLane.screen)) c.f -= diff * (mode === "replay" ? 1 : 0);   // red flag, no pit lane known: hold still
      const [x, y] = pointAt(c.f);
      c.x = x; c.y = y;
    }
    c.line = +l.Line || 99; seen.add(num);
  }
  for (const [num, c] of Object.entries(cars)) if (!seen.has(num)) { c.el.remove(); delete cars[num]; }
  const order = Object.entries(cars).sort((a, b) => a[1].line - b[1].line);
  const H = 12, W0 = circuit.w;
  for (const [, c] of order) {
    const sc = c.inPit ? 0.7 : 1, w = c.w * sc, h = H * sc, gap = c.inPit ? 5 : 8;   // in the pit lane: smaller
    // the tag sits straight above its car, always the same: it never moves on its own (below, at the top edge of the map)
    c.lx = Math.max(1, Math.min(W0 - w - 1, c.x - w / 2));
    c.ly = c.y - h - gap >= 1 ? c.y - h - gap : c.y + gap;
    c.dot.setAttribute("cx", c.x.toFixed(2)); c.dot.setAttribute("cy", c.y.toFixed(2));
    c.lead.setAttribute("x1", c.x.toFixed(2)); c.lead.setAttribute("y1", c.y.toFixed(2));
    c.lead.setAttribute("x2", c.x.toFixed(2)); c.lead.setAttribute("y2", (c.ly < c.y ? c.ly + h : c.ly).toFixed(2));
    c.tag.setAttribute("transform", `translate(${c.lx.toFixed(2)},${c.ly.toFixed(2)})${sc < 1 ? ` scale(${sc})` : ""}`);
  }
  for (const [n, c] of order) {   // following: the others fade, the followed car's dot grows; battling cars ringed in amber
    const look = (follow && follow !== n ? "f" : "") + (follow === n ? "F" : "") + (battleSet.has(n) ? "b" : "") + (c.inPit ? "p" : "");
    if (look !== c.look) { c.look = look; c.el.style.opacity = look.includes("f") ? 0.3 : 1; c.dot.setAttribute("r", look.includes("F") ? 6.5 : look.includes("p") ? 3 : 4.4); c.el.classList.toggle("bat", look.includes("b")); c.el.classList.toggle("inpit", look.includes("p")); }
  }
  const bats = battlePairs.filter(([a, b]) => cars[a] && cars[b]).map(([a, b]) =>
    `<line x1="${cars[a].x.toFixed(1)}" y1="${cars[a].y.toFixed(1)}" x2="${cars[b].x.toFixed(1)}" y2="${cars[b].y.toFixed(1)}"/>`).join("");
  const bg = $("bats"); if (bg && bg._html !== bats) { bg.innerHTML = bats; bg._html = bats; }
  const key = order.map(o => o[0]).join() + follow;   // the leader drawn on top, and whoever you follow above all
  if (key !== g.dataset.order) { g.dataset.order = key; [...order].reverse().forEach(([, c]) => g.appendChild(c.el)); if (follow && cars[follow]) g.appendChild(cars[follow].el); }
  if (geo && geoRef && $("mapwrap").classList.contains("geo")) {   // the real map: the same cars, in longitude and latitude
    for (const [n, c] of order) {
      const d = driver(n);
      geo.moveCar(n, toGeo(c.x, c.y), { colour: colour(d), num: d.RacingNumber || n, tla: d.Tla || n, z: n === follow ? 300 : 200 - c.line });
      geo.setLook(n, c.look || "");
    }
    for (const n of geo.cars()) if (!cars[n]) geo.dropCar(n);
    geo.setBattles(battlePairs.filter(([a, b]) => cars[a] && cars[b]).map(([a, b]) => [toGeo(cars[a].x, cars[a].y), toGeo(cars[b].x, cars[b].y)]));
  }
}

// ---------- the screen ----------
// on a phone the panels are grouped under sub-tabs; on a wide screen they all show in two columns
const GROUPS = [["timing", "Timing"], ["track", "Track"], ["rc", "Race control"], ["radio", "Radio"], ["more", "More"]];
const TAB_REPLAY = ["analysis", "Analysis"];
const panel = (id, groups, head, body, extra = "") => `<section class="card panel" id="${id}" data-g="${groups}" ${extra}><h2 class="card-h">${head}</h2>${body}</section>`;
function markup(replay) {
  const groups = replay ? [...GROUPS, TAB_REPLAY] : GROUPS;
  return `<style id="colcss"></style>
  <section class="card sbar">
    <div class="sb-top"><img class="flag" id="flag" alt="" hidden><div class="sb-ev"><b id="event">${replay ? "Loading the replay…" : "Connecting to live timing…"}</b><span id="sub"></span></div><span class="badge" id="live">${replay ? "LOADING" : "CONNECTING"}</span></div>
    <div class="facts">
      <div class="status off" id="track">–</div>
      <div class="fact" id="lapBox" hidden><small>Lap</small><b id="lap"></b></div>
      <div class="fact" id="clockBox" hidden><small id="clockLabel">Time left</small><b id="clock"></b></div>
      <div class="fact" id="airBox" hidden><small>Air</small><b id="air"></b></div>
      <div class="fact" id="trackTBox" hidden><small>Track</small><b id="trackT"></b></div>
      <div class="fact" id="windBox" hidden><small>Wind</small><b id="wind"></b></div>
      <div class="fact" id="rainBox" hidden><small>Rain</small><b class="rainy">Yes</b></div>
      <div class="fact" id="chanceBox" hidden><small>Rain chance</small><b id="chance"></b></div>
    </div>
  </section>
  <section class="card next" id="next" hidden>
    <div class="what"><small>NEXT SESSION</small><b id="nextName"></b><span id="nextWhen"></span></div>
    <div class="count" id="nextCount"></div>
    <a class="btn" id="nextReplay" hidden></a>
  </section>
  <div class="seg wide tsubs" id="tsubs" role="tablist">${groups.map(([k, l]) => `<button type="button" data-k="${k}">${l}</button>`).join("")}</div>
  <div class="tgrid" id="tgrid">
    <div class="tcol">
      ${panel("p-tower", "timing", `<span>Timing <small id="part"></small> <small id="batN"></small> <small id="followHint">· tap a driver to follow</small></span><span class="hd-tools"><button class="btn small ghost" id="colsBtn" type="button">Columns</button></span>`,
        `<div class="scroll"><table id="tower"></table></div>`)}
      ${panel("p-pos", "more", `<span>Race positions</span><small>tap a driver to highlight</small>`, `<div class="chart" id="posChart"></div>`, "hidden")}
      ${panel("p-strat", "more", `<span>Tyre strategy</span><span class="legend2"><span><i style="background:#e10600"></i>Soft</span><span><i style="background:#eab308"></i>Medium</span><span><i style="background:#d1d5db"></i>Hard</span><span><i style="background:#16a34a"></i>Inter</span><span><i style="background:#2563eb"></i>Wet</span></span>`,
        `<div class="strat" id="strat"></div>`)}
      ${panel("p-radio", "radio", `<span>Team radio</span><span class="radio-opts">
          <label class="switch" title="Play each new message as it arrives (after you have played one yourself)"><input type="checkbox" id="radioAuto">Auto-play</label>
          <label class="switch" title="When a message ends, play the next one"><input type="checkbox" id="radioNext">Play next</label></span>`,
        `<div class="chips" id="radioWho"></div><ol class="rlist" id="radio"></ol>`)}
      ${replay ? A.panelsLeft(panel) : ""}
    </div>
    <div class="tcol">
      ${panel("p-follow", "timing track", `<span>Following</span><button class="x" id="fClose" type="button" aria-label="Stop following">✕</button>`, `<div class="fhead" id="fHead"></div><div class="fstats" id="fStats"></div>${replay ? A.followExtra() : ""}`, "hidden")}
      ${panel("p-map", "track", `<span>Track map</span><span class="hd-tools"><span class="legend2"><span><i style="background:#ff3b5c"></i>S1</span><span><i style="background:#3b9eff"></i>S2</span><span><i style="background:#ffd60a"></i>S3</span></span>
          <span class="seg" id="mapView" role="group" aria-label="Map view"><button type="button" data-v="3d">3D</button><button type="button" data-v="top">Top</button><button type="button" data-v="classic">Classic</button></span></span>`,
        `<div class="mapwrap" id="mapwrap"><svg id="map" viewBox="0 0 400 300" role="img" aria-label="Circuit map with each car's position"></svg>
          <div class="gmap" id="gmap" role="img" aria-label="The circuit on a map of its surroundings, with each car's position"></div>
          <div class="legend" id="mapLegend" hidden><span><i style="background:#facc15"></i>Yellow flag (flashing)</span></div></div>`)}
      ${panel("p-bests", "track", `Fastest sectors`, `<div class="bests" id="bests"></div>`)}
      ${panel("p-champ", "more", `<span>Live championship</span><span class="seg" id="champTabs"><button type="button" data-k="d" aria-pressed="true">Drivers</button><button type="button" data-k="t" aria-pressed="false">Teams</button></span>`,
        `<ol class="champ" id="champ"></ol>`)}
      ${panel("p-pits", "more", `<span>Pit stops</span><small id="pitBest"></small>`, `<ol class="pits" id="pits"></ol>`, "hidden")}
      ${panel("p-pen", "rc", `Penalties`, `<div id="pens"></div>`)}
      ${panel("p-rc", "rc", `<span>Race control</span>`, `<div class="chips" id="rcKinds"></div><ol class="feed" id="rc"></ol>`)}
      ${replay ? A.panelsRight(panel) : ""}
    </div>
  </div>
  ${replay ? `<div class="rbar" id="rbar" hidden>
    <div class="timeline" id="rLine">
      <div id="rEvents"></div>
      <div class="rail"><div class="done" id="rDone"></div><div id="rSegs"></div><div id="rBands"></div></div>
      <div id="rLaps"></div>
      <input type="range" id="rSeek" min="0" max="1000" value="0" aria-label="Replay position">
      <div class="tip" id="rTip" hidden></div>
    </div>
    <div class="rctl">
      <button class="ico" id="rBack" type="button" aria-label="Back 30 seconds"><svg viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.97 7.97 0 0 1 20.5 16l2.37-.78A10.48 10.48 0 0 0 12.5 8z"/></svg></button>
      <button class="ico big" id="rPlay" type="button" aria-label="Play or pause"></button>
      <button class="ico" id="rFwd" type="button" aria-label="Forward 30 seconds"><svg viewBox="0 0 24 24"><path d="M18.4 10.6A10.4 10.4 0 0 0 11.5 8 10.48 10.48 0 0 0 1.13 15.22l2.37.78a7.97 7.97 0 0 1 13.12-3.62L13 16h9V7z"/></svg></button>
      <span class="rclock"><b id="rTime"></b><small id="rLap"></small></span>
      <span class="rtitle" id="rTitle"></span>
      <span class="speeds" id="rSpeed">${[1, 2, 4, 8, 16, 32].map(s => `<button type="button" data-s="${s}" aria-pressed="${s === 1}">${s}×</button>`).join("")}</span>
    </div>
  </div>` : ""}
  <div class="sheet" id="colSheet" hidden><div>
    <h3>Timing columns <button class="x" type="button" data-close aria-label="Close">✕</button></h3>
    <section><div class="sheet-acts"><button class="btn small" type="button" id="colAll">Show all</button><button class="btn small" type="button" id="colFew">Hide extras</button></div>
      <div class="toggles" id="colPicks"></div></section>
  </div></div>`;
}
function fillColumns() {
  $("colPicks").innerHTML = COLS.map(([k, label]) => `<label><span>${label}${COL_NOTES[k] ? `<small>${COL_NOTES[k]}</small>` : ""}</span>
    <span class="switch"><input type="checkbox" data-k="${k}" ${hiddenCols.has(k) ? "" : "checked"}></span></label>`).join("");
}
const pressView = () => { for (const b of $("mapView").children) b.setAttribute("aria-pressed", String(b.dataset.v === mapView)); };
function setSub(k) {   // phone: which group of panels shows
  const tabs = [...$("tsubs").children];
  if (!tabs.some(b => b.dataset.k === k)) k = "timing";
  for (const b of tabs) b.setAttribute("aria-pressed", String(b.dataset.k === k));
  $("tgrid").dataset.show = k;
  store.set("f1.sub", k);
  if (k === "track" && circuit) drawCircuit();   // the map's box depends on its width
  if (k === "track" && geo) requestAnimationFrame(() => geo && geo.resize());
  A.shown(k);
}
function wire(root) {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on("rcKinds", "click", e => { const b = e.target.closest("button"); if (b) { rcFilter = b.dataset.g; $("rcKinds")._html = ""; $("rc")._html = ""; renderRaceControl(); } });
  on("posChart", "click", e => { const g = e.target.closest(".who"); setFollow(g ? g.dataset.n : null); });
  on("fClose", "click", () => setFollow(null));
  on("tower", "click", e => { const tr = e.target.closest("tr[data-n]"); if (tr) setFollow(tr.dataset.n); });
  on("map", "click", e => { const g = e.target.closest("g.car"); if (g) setFollow(g.dataset.n); });
  on("mapView", "click", e => {
    const b = e.target.closest("button"); if (!b) return;
    mapView = b.dataset.v; store.set("f1.mapview", mapView); pressView();
    if (mapView === "classic") { $("mapwrap").classList.remove("geo"); if (circuit) { drawCircuit(); dirty = true; } }
    else if (geo && geoRef) { $("mapwrap").classList.add("geo"); geo.view(mapView); }
    else setupGeo();
  });
  on("radio", "click", e => {
    const li = e.target.closest("li[data-src]"); if (!li) return;
    const wave = e.target.closest(".wave");
    if (wave && li.dataset.src === playingSrc && audio.duration) {   // tap the wave to jump
      const r = wave.getBoundingClientRect();
      audio.currentTime = audio.duration * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); return;
    }
    if (!e.target.closest(".play") && !wave) return;
    userPlayed = true;
    if (li.dataset.src === playingSrc && !audio.paused) { audio.pause(); return; }
    if (li.dataset.src !== playingSrc) playSrc(li.dataset.src); else audio.play().catch(() => {});
  });
  on("radioWho", "click", e => { const b = e.target.closest("button"); if (!b) return; radioWho = b.dataset.n; radioKey = ""; $("radioWho")._html = ""; dirty = true; });
  for (const id of ["radioAuto", "radioNext"]) { $(id).checked = store.get("f1." + id, false); on(id, "change", e => store.set("f1." + id, e.target.checked)); }
  on("champTabs", "click", e => {
    const b = e.target.closest("button"); if (!b) return;
    champTab = b.dataset.k; champKey = "";
    for (const x of $("champTabs").children) x.setAttribute("aria-pressed", String(x === b));
    dirty = true;
  });
  on("tsubs", "click", e => { const b = e.target.closest("button"); if (b) setSub(b.dataset.k); });
  on("colsBtn", "click", () => { fillColumns(); $("colSheet").hidden = false; });
  on("colSheet", "click", e => { if (e.target === $("colSheet") || e.target.closest("[data-close]")) $("colSheet").hidden = true; });
  on("colAll", "click", () => { hiddenCols.clear(); store.set("f1.hide", []); applyColumns(); fillColumns(); });
  on("colFew", "click", () => { for (const k of ["s1", "s2", "s3", "mini", "speed", "pit"]) hiddenCols.add(k); store.set("f1.hide", [...hiddenCols]); applyColumns(); fillColumns(); });
  on("colPicks", "change", e => {
    const k = e.target.dataset.k; if (!k) return;
    if (e.target.checked) hiddenCols.delete(k); else hiddenCols.add(k);
    store.set("f1.hide", [...hiddenCols]); applyColumns();
  });
  if (!$("rbar")) return;
  on("rPlay", "click", () => { if (!R.data) return; if (R.t >= R.end) R.t = R.start; R.playing = !R.playing; R.last = 0; syncReplayBar(); });
  on("rBack", "click", () => { R.t = Math.max(R.start, R.t - 30000); R.dirty = true; resetCars(); });
  on("rFwd", "click", () => { R.t = Math.min(R.end, R.t + 30000); R.dirty = true; resetCars(); });
  on("rSeek", "input", e => {
    if (!R.data) return;
    seeking = true; R.t = R.start + (R.end - R.start) * e.target.value / 1000; R.dirty = true; resetCars(); syncReplayBar();
    const tip = $("rTip"), race = R.data.sess.session_type === "Race";   // a bubble over the thumb: the time and lap you're dragging to
    tip.hidden = false; tip.style.left = (e.target.value / 10) + "%";
    tip.textContent = `${clock(R.t - R.start)}${race ? " · Lap " + Math.max(1, lapAt(R.t)) : ""}`;
  });
  for (const ev of ["change", "pointerup", "touchend", "blur"]) on("rSeek", ev, () => { seeking = false; $("rTip").hidden = true; });
  on("rSpeed", "click", e => {
    const b = e.target.closest("button"); if (!b) return;
    R.speed = +b.dataset.s; store.set("f1.speed", R.speed);
    for (const x of $("rSpeed").children) x.setAttribute("aria-pressed", String(x === b));
  });
}
// jump the replay to a moment (from the analysis panels)
export function seekTo(t) { if (!R.data) return; R.t = Math.max(R.start, Math.min(R.end, t)); R.dirty = true; resetCars(); syncReplayBar(); }

let tick = 0;
function frame() {
  if (mode === "off") return;
  replayTick();
  renderNext();
  if (dirty) {
    dirty = false;
    renderHeader(); renderTower(); renderBests(); renderRaceControl(); renderPenalties(); renderPositions(); renderStrategy(); renderPits(); renderFollow();
    notifyRaceControl(); renderRadio(); renderChampionship(); renderSectors(); renderFlags();
    if (mode === "replay") A.render();
  }
  else if (++tick % 8 === 0) renderRadio();   // "x min ago"
  renderClock();
}

const timers = [];
const offs = [];
// put the timing screen in `el`: live, or a replay of session `replay` (an OpenF1 session key). Returns the clean-up function.
export function mountTiming(el, { replay = null, app = null } = {}) {
  stop();
  APP = app;
  S = {}; for (const k in prog) delete prog[k]; segFrac.length = 0; lapLog.length = 0; for (const k in pitLog) delete pitLog[k];
  Object.assign(R, { t: 0, start: 0, end: 0, playing: false, data: null, last: 0, dirty: false });
  towerRows = {}; towerHead = ""; radioSeen = null; rcSeen = null; radioKey = ""; radioWho = ""; playingSrc = null;
  circuit = null; circuitKey = null; pitLane = null; trackLen = []; placeFor = ""; place = null; rainChance = null;
  geo = null; geoMaking = null; geoRef = null; geoRefP = null; geoKey = ""; inv = null; secCut = null; cornerLabels = [];
  mapView = store.get("f1.mapview", "3d");
  if (mapView !== "classic") G.preload();
  champKey = ""; posKey = ""; fKey = ""; penCache = { key: null, v: null }; secKey = ""; flagKey = ""; nextKey = "";
  for (const k in cars) delete cars[k]; for (const k in pitSince) delete pitSince[k];
  follow = store.get("f1.follow", null); posPick = follow; hiddenCols = new Set(store.get("f1.hide", []));
  el.insertAdjacentHTML("beforeend", markup(!!replay));
  el.classList.add("timing");
  wire(el);
  applyColumns();
  pressView();
  mode = replay ? "replay" : "live";
  setSub(store.get("f1.sub", "timing"));
  timers.push(setInterval(frame, 250));
  rafId = requestAnimationFrame(animateCars);
  loadSchedule(); timers.push(setInterval(loadSchedule, 3 * 3600000));
  loadStandings(); timers.push(setInterval(loadStandings, 15 * 60000));
  if (!replay) timers.push(setInterval(updateRain, 15 * 60000));
  const mq = matchMedia("(max-width: 900px)"), refit = () => { if (circuit) { drawCircuit(); dirty = true; } };
  mq.addEventListener("change", refit); offs.push(() => mq.removeEventListener("change", refit));
  const retheme = () => { champKey = ""; dirty = true; if (geo) geo.theme(isDark()); }; addEventListener("themechange", retheme); offs.push(() => removeEventListener("themechange", retheme));
  if (replay) startReplay(+replay); else connect();
  return stop;
}
function stop() {
  if (mode === "off" && !timers.length) return;
  mode = "off"; replayToken++;
  while (timers.length) clearInterval(timers.pop());
  while (offs.length) offs.pop()();
  cancelAnimationFrame(rafId);
  clearTimeout(retryTimer); clearInterval(pingTimer);
  if (ws) { const old = ws; ws = null; try { old.close(); } catch (e) {} }
  audio.pause();
  A.stop();
  geoToken++;
  const making = geoMaking; geoMaking = null;
  if (making) making.then(m => m.destroy()).catch(() => {});   // also one still being made
  geo = null;
  APP = null;
}
