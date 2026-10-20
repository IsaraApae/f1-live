// One Grand Prix weekend: where and when, every session in the viewer's time zone with a live countdown, the forecast
// at the circuit, and for finished sessions the results, the track conditions and a link to the replay.
import { esc, fmtTime, fmtDay, fmtRange, tzName, countdown, countdownHtml, dtagHtml, hex, lapText, ICONS, skeleton, photo } from "../util.js";
import { of1, forecast, forecastFor } from "../api.js";
import { season } from "../season.js";
import { buildIcs, downloadIcs, weekendUrl, shortName, ADD_ICON, wxHtml, flagImg } from "../ics.js";

const MIN = 60000, DAY = 86400000, FORECAST_DAYS = 16 * DAY;
// like season.js liveSession(): "on" from 15 minutes before the start to 30 after the end
const phase = (x, t) => t < x.start - 15 * MIN ? "soon" : t <= x.end + 30 * MIN ? "live" : "done";
// a session that finished over a day ago won't change: keep its answers a week (fresher ones are asked again after a few minutes)
const ttlFor = end => Date.now() - end > DAY ? 7 * DAY : 0;
const LABEL = { fp1: "FP1", fp2: "FP2", fp3: "FP3", sq: "SQ", sprint: "Sprint", q: "Quali", race: "Race" };

const p2 = v => String(v).padStart(2, "0");
const cdText = ms => { const [[d], [h], [m], [s]] = countdown(ms); return `${d ? `${d}d ` : ""}${p2(h)}:${p2(m)}:${p2(s)}`; };
const raceTime = s => { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = (s % 60).toFixed(3).padStart(6, "0"); return h ? `${h}:${p2(m)}:${sec}` : `${m}:${sec}`; };
const gapText = g => g == null ? "" : typeof g === "number" ? (g > 0 ? `+${g.toFixed(3)}` : "") : String(g);
const num = v => typeof v === "number";
const byPos = (a, b) => (num(a.position) ? a.position : 999) - (num(b.position) ? b.position : 999);

// what a result row says on the right: [main, small line underneath]
function resultText(x, e) {
  if (e.dsq) return ["DSQ", ""];
  if (e.dns) return ["DNS", ""];
  if (e.dnf) return ["DNF", e.number_of_laps ? `${e.number_of_laps} laps` : ""];
  if (x.kind === "race" || x.kind === "sprint") {
    const pts = e.points ? `${e.points} pts` : "";
    if (e.position === 1) return [raceTime(Array.isArray(e.duration) ? null : e.duration) || "Winner", [e.number_of_laps && `${e.number_of_laps} laps`, pts].filter(Boolean).join(" · ")];
    return [gapText(e.gap_to_leader) || "–", pts];
  }
  if (Array.isArray(e.duration)) {   // qualifying: the time from the last part reached
    const part = e.duration.reduce((p, v, i) => v != null ? i : p, -1);
    if (part < 0) return ["No time", ""];
    const g = Array.isArray(e.gap_to_leader) ? e.gap_to_leader[part] : null;
    return [lapText(e.duration[part]), [`${x.kind === "sq" ? "SQ" : "Q"}${part + 1}`, gapText(g)].filter(Boolean).join(" · ")];
  }
  // practice: the best lap
  return [e.duration ? lapText(e.duration) : "No time", [gapText(e.gap_to_leader), e.number_of_laps ? `${e.number_of_laps} laps` : ""].filter(Boolean).join(" · ")];
}

// the weather OpenF1 measured at the track during a session
function summarise(w) {
  if (!w || !w.length) return null;
  const vals = f => w.map(f).filter(num), avg = a => a.length ? a.reduce((p, q) => p + q, 0) / a.length : null;
  const temps = f => vals(f).filter(v => v !== 0);   // a reading of exactly 0 is a dropped sensor, not a cold track
  const trk = temps(o => o.track_temperature), wind = vals(o => o.wind_speed);
  return { air: avg(temps(o => o.air_temperature)), trkLo: trk.length ? Math.min(...trk) : null, trkHi: trk.length ? Math.max(...trk) : null,
           wind: wind.length ? avg(wind) * 3.6 : null, hum: avg(vals(o => o.humidity)), wet: w.some(o => o.rainfall > 0) };
}

const notFound = (year, n, count) => `<section class="card wkd-404"><div class="card-b">
  <span class="wkd-404-i">${ICONS.calendar}</span>
  <h2>No round ${esc(n)} in ${esc(year)}</h2>
  <p class="dim">${count ? `The ${esc(year)} calendar has ${count} rounds.` : `There's no calendar for ${esc(year)} yet.`} The link may be old or mistyped.</p>
  <a class="btn primary" href="#/calendar">${ICONS.back}Back to the calendar</a>
</div></section>`;

export default {
  title: "Weekend",
  tab: "calendar",
  async mount(el, [y, n], app) {
    app.setBack("#/calendar");
    const year = +y, roundNo = +n;
    el.innerHTML = `<section class="hero">${skeleton(4)}</section><div class="card">${skeleton(6)}</div>`;
    let s;
    try { s = await season(year); }
    catch (e) { if (el.isConnected) el.innerHTML = `<div class="card"><p class="note-line">Couldn't load this weekend. Try again in a minute.</p></div>`; return; }
    if (!el.isConnected) return;
    const idx = s.rounds.findIndex(r => r.round === roundNo), r = s.rounds[idx];
    if (!r) { app.setTitle("Weekend not found"); el.innerHTML = notFound(year, roundNo, s.rounds.length); return; }
    app.setTitle(shortName(r.name));

    const S = r.sessions;
    const got = {}, cond = {};            // session key → results / track conditions: { busy } | { err } | data
    const open = new Set(), all = new Set();
    // results for the last two finished sessions straight away, the rest when opened (OpenF1 allows 30 requests a minute)
    for (const x of S.filter(x => x.key && phase(x, Date.now()) === "done").slice(-2)) open.add(x.key);
    const podiumKey = (S.find(x => x.kind === "race" && x.key) || {}).key;
    let fc = null, timer = 0;

    // the weekend's drivers (names, three-letter codes, team colours) in one request for every session
    let people = null;
    const names = () => people = people || (r.meetingKey ? of1(`drivers?meeting_key=${r.meetingKey}`, { ttl: ttlFor(r.end) }) : Promise.resolve([])).then(list => {
      const by = new Map();
      for (const d of list) { by.set(`${d.session_key}:${d.driver_number}`, d); by.set(d.driver_number, d); }
      return (key, no) => by.get(`${key}:${no}`) || by.get(no) || null;
    }).catch(() => { people = null; return () => null; });

    async function loadResults(k) {
      if (got[k] && !got[k].err) return;
      const x = S.find(v => v.key === k);
      got[k] = { busy: true };
      try { const [res, nm] = await Promise.all([of1(`session_result?session_key=${k}`, { ttl: ttlFor(x.end) }), names()]); got[k] = { res, names: nm }; }
      catch (e) { got[k] = { err: true }; }
      if (!el.isConnected) return;
      paintRes(k);
      if (k === podiumKey) { const p = el.querySelector("[data-podium]"); if (p) p.innerHTML = podiumHtml(); }
    }
    async function loadCond(k) {
      if (cond[k] && !cond[k].err) return;
      const x = S.find(v => v.key === k);
      cond[k] = { busy: true }; paintRes(k);
      try { cond[k] = { v: summarise(await of1(`weather?session_key=${k}`, { ttl: ttlFor(x.end) })) }; }
      catch (e) { cond[k] = { err: true }; }
      if (el.isConnected) paintRes(k);
    }
    const paintRes = k => { const box = el.querySelector(`[data-res="${k}"]`); if (box) box.innerHTML = resultsHtml(S.find(v => v.key === k)); };
    const redrawCard = i => { const c = el.querySelector(`[data-i="${i}"]`); if (c) { c.outerHTML = cardHtml(S[i], i, Date.now()); paintWx(); } };
    function paintWx() {
      if (!fc) return;
      S.forEach((x, i) => { const slot = el.querySelector(`[data-wx="${i}"]`); if (slot) slot.innerHTML = wxHtml(forecastFor(fc, x.start, x.end)); });
    }

    function heroHtml(t) {
      const on = S.find(x => phase(x, t) === "live");
      const target = S.find(x => phase(x, t) === "soon");
      let foot = "";
      if (on) foot = `<div class="wkd-now"><p class="wkd-cd-l"><span class="badge red live">Live</span><span><b>${esc(on.name)}</b> ${t < on.start ? "is about to start" : t > on.end ? "has just finished" : "is on now"}</span></p>
                       <a class="btn primary" href="#/live">${ICONS.live}Watch live</a></div>`;
      else if (target) foot = `<div class="wkd-next"><p class="wkd-cd-l">${esc(target.name)} starts in</p>
                       <div class="count" data-cd="${target.start}">${countdownHtml(target.start - t)}</div>
                       <small class="dim">${fmtDay(target.start)} · ${fmtTime(target.start)} your time</small></div>`;
      else if (podiumKey) foot = `<div class="wkd-pod" data-podium>${podiumHtml()}</div>`;
      return `<section class="hero wkd-hero${on ? " is-live" : ""}">
        <div class="wkd-hero-grid">
          <div class="wkd-id">
            <div class="kicker"><span class="wkd-nw">Round ${r.round} · ${year}</span>${r.sprint ? `<span class="badge amber">Sprint weekend</span>` : ""}</div>
            <div class="wkd-where">${flagImg(r)}<h2>${esc(r.name)}</h2></div>
            <p class="sub">${esc(r.circuit)}<br>${esc(r.locality)}${r.country ? `, ${esc(r.country)}` : ""}</p>
            <p class="wkd-dates">${ICONS.calendar}${fmtRange(r.start, r.end)} ${new Date(r.end).getFullYear()}</p>
          </div>
          ${r.circuitImage ? `<div class="wkd-trk"><img src="${esc(r.circuitImage)}" alt="${esc(r.circuit)} layout" onerror="this.parentNode.remove()"></div>` : ""}
        </div>
        ${foot}
      </section>`;
    }

    function podiumHtml() {
      const g = got[podiumKey];
      if (!g || g.busy) return `<small class="wkd-lbl">Podium</small>${skeleton(1)}`;
      if (g.err || !g.res.length) return "";
      const top = [...g.res].sort(byPos).filter(e => num(e.position)).slice(0, 3);
      return `<small class="wkd-lbl">Podium</small><div class="wkd-pods">${top.map(e => {
        const d = g.names(podiumKey, e.driver_number) || {}, c = hex(d.team_colour);
        // this season's photos come from formula1.com; older seasons have OpenF1's own headshot (or none)
        const pic = year === new Date().getFullYear() ? photo({ HeadshotUrl: d.headshot_url, FirstName: d.first_name, LastName: d.last_name, TeamName: d.team_name }, 112, year) : d.headshot_url;
        return `<div class="wkd-pd" style="--tc:${esc(c)}"><span class="p">${e.position}</span>${pic ? `<img class="face wkd-face" src="${esc(pic)}" alt="" style="background:${esc(c)}" onerror="this.remove()">` : ""}${dtagHtml(e.driver_number, d.name_acronym, c, true)}
          <b>${esc(d.last_name || `Car ${e.driver_number}`)}</b><small>${esc(d.team_name || "")}</small></div>`;
      }).join("")}</div>`;
    }

    function cardHtml(x, i, t) {
      const ph = phase(x, t), k = x.key, isOpen = open.has(k), soon = x.start - t < FORECAST_DAYS;
      let end = "", body = "";
      if (ph === "soon") {
        end = `<span class="wkd-cd"><small>Starts in</small><b data-cdc="${x.start}">${cdText(x.start - t)}</b></span>`;
        if (soon) body = `<div class="wkd-wx" data-wx="${i}"></div>`;
      } else if (ph === "live") {
        end = `<span class="badge red live">Live</span>`;
        body = `<div class="wkd-liveb"><a class="btn primary" href="#/live">${ICONS.live}Watch live</a>
          <span class="dim">${t < x.start ? `Starts in <b data-cdc="${x.start}">${cdText(x.start - t)}</b>` : t > x.end ? "Just finished, results soon" : `Ends about ${fmtTime(x.end)}`}</span></div>
          <div class="wkd-wx" data-wx="${i}"></div>`;
      } else {
        end = k ? `<a class="btn small" href="#/replay/${k}" title="Replay ${esc(x.name)}">${ICONS.replay}Replay</a>` : `<span class="dim wkd-fin">Finished</span>`;
        if (k) body = (isOpen ? `<div class="wkd-res" data-res="${k}">${resultsHtml(x)}</div>` : "") +
          `<button class="wkd-more" type="button" data-toggle="${k}" aria-expanded="${isOpen}">${isOpen ? "Hide results" : "Results"}${ICONS.chevron}</button>`;
      }
      return `<article class="card wkd-ses is-${ph} k-${esc(x.kind)}" data-i="${i}">
        <div class="wkd-h">
          <span class="wkd-k">${esc(LABEL[x.kind] || x.short)}</span>
          <span class="main"><b>${esc(x.name)}</b><small>${fmtDay(x.start)} · ${fmtTime(x.start)} – ${fmtTime(x.end)}</small></span>
          <span class="end">${end}</span>
        </div>${body ? `<div class="wkd-b">${body}</div>` : ""}
      </article>`;
    }

    function resultsHtml(x) {
      const g = got[x.key];
      if (!g || g.busy) return skeleton(5);
      if (g.err) return `<p class="note-line">Couldn't load the results. <button class="btn small" type="button" data-retry="${x.key}">Try again</button></p>`;
      if (!g.res.length) return `<p class="note-line">No results for this session yet.</p>`;
      const rows = [...g.res].sort(byPos), every = all.has(x.key);
      return `<ol class="rows wkd-rl">${(every ? rows : rows.slice(0, 10)).map(e => {
          const d = g.names(x.key, e.driver_number) || {}, c = hex(d.team_colour), [main, sub] = resultText(x, e);
          return `<li class="row wkd-r${e.position === 1 ? " p1" : ""}${e.dnf || e.dns || e.dsq ? " out" : ""}" style="--tc:${esc(c)}">
            <span class="wkd-p">${num(e.position) ? e.position : "–"}</span>
            ${dtagHtml(e.driver_number, d.name_acronym, c, true)}
            <span class="main"><b>${esc(d.first_name ? `${d.first_name} ${d.last_name}` : `Car ${e.driver_number}`)}</b><small>${esc(d.team_name || "")}</small></span>
            <span class="end">${esc(main)}<small>${esc(sub)}</small></span>
          </li>`;
        }).join("")}</ol>
        ${rows.length > 10 ? `<button class="wkd-all" type="button" data-all="${x.key}">${every ? "Show top 10" : `Show all ${rows.length}`}</button>` : ""}
        ${condHtml(x)}`;
    }

    function condHtml(x) {
      const c = cond[x.key], R = Math.round;
      if (!c) return `<div class="wkd-cond"><button class="btn small ghost" type="button" data-cond="${x.key}">${ICONS.temp}Track conditions</button></div>`;
      if (c.busy) return `<div class="wkd-cond">${skeleton(1)}</div>`;
      if (c.err || !c.v) return `<p class="note-line">${c.err ? "Couldn't load the track conditions." : "No weather readings for this session."}</p>`;
      const v = c.v;
      return `<div class="wkd-cond"><small class="wkd-lbl">Track conditions</small><div class="kv">
        ${v.air != null ? `<div><small>Air</small><b>${R(v.air)}°C</b></div>` : ""}
        ${v.trkLo != null ? `<div><small>Track</small><b>${R(v.trkLo) === R(v.trkHi) ? R(v.trkLo) : `${R(v.trkLo)}–${R(v.trkHi)}`}°C</b></div>` : ""}
        ${v.wind != null ? `<div><small>Wind</small><b>${R(v.wind)} km/h</b></div>` : ""}
        ${v.hum != null ? `<div><small>Humidity</small><b>${R(v.hum)}%</b></div>` : ""}
        <div><small>Rain</small><b${v.wet ? ` class="wkd-wet"` : ""}>${v.wet ? "Wet" : "Dry"}</b></div>
      </div></div>`;
    }

    function asideHtml(t) {
      const left = S.filter(x => x.end > t);
      const nav = [[s.rounds[idx - 1], "Previous"], [s.rounds[idx + 1], "Next"]].filter(([o]) => o);
      return `${left.length ? `<section class="card">
          <h3 class="card-h">Your calendar</h3>
          <div class="card-b wkd-cal">
            <p>${left.length === S.length ? "Every session" : `The ${left.length} sessions still to come`} of this weekend, each with a reminder 15 minutes before.</p>
            <button class="btn primary" type="button" data-ics>${ADD_ICON}Add this weekend to my calendar</button>
          </div>
        </section>` : ""}
        ${nav.length ? `<section class="card">
          <h3 class="card-h">More rounds <a class="more" href="#/calendar">Full calendar${ICONS.chevron}</a></h3>
          <div class="rows">${nav.map(([o, lbl]) => `<a class="row wkd-nav" href="#/calendar/${year}/${o.round}">${flagImg(o)}
            <span class="main"><b>${esc(o.name)}</b><small>${lbl} · Round ${o.round} · ${fmtRange(o.start, o.end)}</small></span>${ICONS.chevron.replace("<svg", `<svg class="chev"`)}</a>`).join("")}</div>
        </section>` : ""}`;
    }

    function draw() {
      const t = Date.now();
      el.innerHTML = heroHtml(t) +
        `<div class="wkd-cols"><div class="stack wkd-list">${S.map((x, i) => cardHtml(x, i, t)).join("")}
          <p class="wkd-tz">${ICONS.calendar}Times are in your time zone · ${esc(tzName())}</p></div>
        <aside class="stack">${asideHtml(t)}</aside></div>`;
      paintWx();
    }

    function saveIcs() {
      const left = S.filter(x => x.end > Date.now()).map(x => ({ ...x, round: r }));
      if (!left.length) return;
      const file = `f1-${year}-${r.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.ics`;
      downloadIcs(file, buildIcs(left, { year, calName: `F1 · ${shortName(r.name)}`, link: o => weekendUrl(year, o) }));
      app.toast(`<div><b>Calendar file saved</b><br><small class="dim">Open ${esc(file)} to add ${left.length} sessions to your calendar app.</small></div>`, { ms: 6000 });
    }

    // the toolbar button: the same calendar file, one tap away on a phone
    if (S.some(x => x.end > Date.now())) {
      const tb = app.setTools(`<button class="iconbtn" type="button" aria-label="Add this weekend to my calendar" title="Add this weekend to my calendar">${ADD_ICON}</button>`);
      tb.querySelector("button").addEventListener("click", saveIcs);
    }

    el.addEventListener("click", e => {
      const b = e.target.closest("[data-toggle],[data-all],[data-cond],[data-retry],[data-ics]");
      if (!b) return;
      if (b.dataset.ics != null) return saveIcs();
      const k = +(b.dataset.toggle || b.dataset.all || b.dataset.cond || b.dataset.retry), i = S.findIndex(x => x.key === k);
      if (b.dataset.toggle) {
        if (open.has(k)) open.delete(k);
        else { open.add(k); loadResults(k); loadCond(k); }   // opened by hand: the conditions too
        redrawCard(i);
      } else if (b.dataset.all) {
        all.has(k) ? all.delete(k) : all.add(k);
        paintRes(k);
      } else if (b.dataset.cond) loadCond(k);
      else if (b.dataset.retry) loadResults(k);
    });

    draw();
    for (const k of open) loadResults(k);
    if (r.end > Date.now() && r.start - Date.now() < FORECAST_DAYS && isFinite(r.lat)) {
      forecast(r.lat, r.lon).then(f => { fc = f; if (el.isConnected) paintWx(); }).catch(() => {});
    }

    // countdowns every second; draw again when a session starts or ends
    const key = t => S.map(x => phase(x, t) + (t >= x.start ? 1 : 0) + (t > x.end ? 1 : 0)).join();
    let was = key(Date.now());
    timer = setInterval(() => {
      if (!el.isConnected) return clearInterval(timer);
      const t = Date.now();
      for (const c of el.querySelectorAll("[data-cd]")) c.innerHTML = countdownHtml(+c.dataset.cd - t);
      for (const c of el.querySelectorAll("[data-cdc]")) c.textContent = cdText(+c.dataset.cdc - t);
      const now = key(t);
      if (now !== was) { was = now; draw(); }
    }, 1000);
    return () => clearInterval(timer);
  }
};
