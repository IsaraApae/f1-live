// A team's season: championship place, both drivers, stats, points round by round and every race's pair of results.
import { esc, note, skeleton, tagVars, dtagHtml, fmtShortDate, teamCar } from "../util.js";
import { season } from "../season.js";
import { standings, results, latestYear, parseId, yearPick, driverHref, teamHref, faceHtml, logoHtml, pts, ptsWord, infoLine, short, outcome, isDnf, scale, liveChart, fillFlags, NOW } from "../stats.js";

// the second (and third) driver's share of a bar: the team colour, shifted toward the page's text colour
const shade = (c, k) => k ? `color-mix(in srgb, ${c} ${k === 1 ? 58 : 32}%, var(--text))` : c;

export default {
  title: "Team",
  tab: "standings",
  async mount(el, [param], app) {
    app.setBack("#/standings/teams");
    let [id, year] = parseId(param);
    el.innerHTML = loading();
    year = year || await latestYear().catch(() => NOW);
    if (!el.isConnected) return;
    app.setTools(yearPick(year)).querySelector("select").addEventListener("change", e => app.go(teamHref(id, +e.target.value)));

    const resP = results(year), calP = season(year).catch(() => null);
    resP.catch(() => {});   // handled where it's awaited; this page may leave before then
    let st, res;
    try { st = await standings(year); }
    catch (e) { if (el.isConnected) el.innerHTML = failed(); return; }
    if (!el.isConnected) return;
    const t = st.teams.find(x => x.id === id);
    if (!t) {
      el.innerHTML = `<div class="card st-nf"><b>Team not found</b><p>There's no “${esc(id)}” in the ${year} standings.</p><a class="btn" href="#/standings/teams">Team standings</a></div>`;
      return;
    }
    app.setTitle(t.name);
    el.querySelector(".st-hero").outerHTML = hero(t, st);

    try { res = await resP; }
    catch (e) { if (el.isConnected) el.querySelector(".st-cols").innerHTML = failed(); return; }
    if (!el.isConnected) return;

    const rounds = res.map(R => ({ R, race: R.race.filter(x => x.cid === id), sprint: R.sprint.filter(x => x.cid === id), q: R.quali.filter(x => x.cid === id) }))
                      .filter(x => x.race.length || x.sprint.length);
    const crew = lineup(t, rounds, st);
    el.querySelector(".st-cols").innerHTML = `
      <div class="stack">
        <section class="card" style="${tagVars(t.colour)}"><h2 class="card-h">Drivers</h2>
          <div class="st-drivers">${crew.slice(0, 2).map(driverTile).join("")}</div>
          ${crew.length > 2 ? `<p class="st-also">Also drove: ${crew.slice(2).map(x => `<a href="${driverHref(x.d.id, x.d.year)}">${esc(x.d.name)}</a> (${x.races} race${x.races === 1 ? "" : "s"}, ${ptsWord(x.points)})`).join(", ")}</p>` : ""}
        </section>
        <section class="card"><h2 class="card-h">${year} season</h2>${tiles(t, rounds)}</section>
        <section class="card"><h2 class="card-h">Points by round</h2>
          <div class="st-chart"></div>
          <div class="st-legend">${crew.map((x, k) => `<span><i class="st-sw" style="--c:${shade(t.colour, k)}"></i>${esc(x.d.last)}</span>`).join("")}</div>
        </section>
      </div>
      <section class="card"><h2 class="card-h">Race by race <small>${rounds.length} round${rounds.length === 1 ? "" : "s"}</small></h2>
        <ul class="rows">${rounds.slice().reverse().map(x => raceRow(x, t, crew)).join("") || `<li>${note("No races yet.")}</li>`}</ul>
        ${st.left ? `<p class="st-upcoming">${st.left} round${st.left > 1 ? "s" : ""} still to run.</p>` : ""}
      </section>`;

    const box = el.querySelector(".st-chart");
    let stop = null;
    if (res.length) stop = liveChart(box, w => bars(w, res, t, crew));
    else box.innerHTML = note("No rounds yet.");
    calP.then(cal => fillFlags(el, cal));
    return stop;
  }
};

const loading = () => `<div class="st-hero" style="--tc:var(--chip)">${skeleton(3)}</div>
  <div class="st-cols"><div class="stack"><div class="card">${skeleton(4)}</div><div class="card">${skeleton(5)}</div></div><div class="card">${skeleton(10)}</div></div>`;
const failed = () => `<div class="card">${note("This season couldn't load. Try again in a minute.", "err")}</div>`;

function hero(t, st) {
  const lead = st.teams[0], gap = t.pos === 1 ? (st.teams[1] ? `+${pts(t.points - st.teams[1].points)}` : "") : `−${pts(lead.points - t.points)}`;
  return `<section class="st-hero" style="${tagVars(t.colour)}">
    ${logoHtml(t, "st-hero-logo")}
    <div class="st-hero-txt">
      <span class="badge">${t.year} season</span>
      <h2>${esc(t.name)}</h2>
      <div class="st-hero-meta">${t.drivers.map(d => esc(d.name)).join(" · ")}</div>
      <div class="st-hero-stats">
        <div><b>P${esc(t.posText)}</b><small>Constructors</small></div>
        <div><b>${pts(t.points)}</b><small>Points${gap ? ` · ${gap}` : ""}</small></div>
        ${t.wins ? `<div><b>${t.wins}</b><small>Win${t.wins > 1 ? "s" : ""}</small></div>` : ""}
      </div>
    </div>
    ${t.f1 ? `<img class="st-hero-car" src="${esc(teamCar(t.f1, t.year, 960))}" alt="${esc(t.name)} car" onerror="this.remove()">` : ""}
  </section>`;
}

// everyone who drove for the team this season: today's pair first, then stand-ins by races
function lineup(t, rounds, st) {
  const by = new Map();
  for (const { race, sprint } of rounds) for (const x of race.concat(sprint)) {
    const e = by.get(x.id) || { id: x.id, races: 0, points: 0 };
    by.set(x.id, e);
    e.points += x.points;
  }
  for (const { race } of rounds) for (const x of race) by.get(x.id).races++;
  const now = t.drivers.map(d => d.id);
  return [...by.values()].map(e => ({ ...e, d: st.drivers.find(d => d.id === e.id) })).filter(e => e.d)
    .sort((a, b) => (now.includes(b.id) - now.includes(a.id)) || (now.indexOf(a.id) - now.indexOf(b.id)) || (b.races - a.races));
}

function driverTile(x) {
  const d = x.d;
  return `<a class="st-drv" href="${driverHref(d.id, d.year)}" style="${tagVars(d.colour)}">
    ${faceHtml(d, 120)}
    <span><b>${esc(d.name)}</b><small><span class="st-big">${pts(x.points)}</span> pts for the team</small><small>P${esc(d.posText)} in the championship · ${x.races} race${x.races === 1 ? "" : "s"}</small></span>
  </a>`;
}

function tiles(t, rounds) {
  const rows = rounds.flatMap(x => x.race), cls = rows.filter(x => x.classified).map(x => x.pos);
  const best = cls.length ? Math.min(...cls) : null;
  const has = (list, p) => list.some(x => x.classified && x.pos === p);
  const poles = rounds.filter(x => x.R.quali.length ? x.q.some(q => q.pos === 1) : x.race.some(r => r.grid === 1)).length;
  const t2 = [
    ["Points", pts(t.points)], ["Position", `P${esc(t.posText)}`],
    ["Wins", rounds.filter(x => has(x.race, 1)).length], ["Podiums", cls.filter(p => p <= 3).length],
    ["Poles", poles], ["1–2 finishes", rounds.filter(x => has(x.race, 1) && has(x.race, 2)).length],
    ["Fastest laps", rows.filter(x => x.fl).length], ["DNFs", rows.filter(isDnf).length],
    ["Best finish", best ? `P${best}` : "–"], ["Pts / race", rounds.length ? (t.points / rounds.length).toFixed(1) : "–"],
    ["Sprint pts", pts(rounds.reduce((a, x) => a + x.sprint.reduce((b, s) => b + s.points, 0), 0))],
    ["Both scored", rounds.filter(x => x.race.filter(r => r.points > 0).length >= 2).length]
  ];
  return `<div class="kv st-kv">${t2.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join("")}</div>`;
}

// points per round, stacked by driver (race and sprint together)
function bars(w, res, t, crew) {
  const n = res.length, h = w < 520 ? 200 : 230, L = 30, R = 6, T = 10, B = 24;
  const ids = crew.map(x => x.id);
  const per = res.map(Rd => ids.map(id => Rd.race.concat(Rd.sprint).reduce((a, x) => a + (x.id === id && x.cid === t.id ? x.points : 0), 0)));
  const { top, step } = scale(Math.max(...per.map(p => p.reduce((a, b) => a + b, 0))));
  const band = (w - L - R) / n, bw = Math.max(4, Math.min(26, band * 0.62));
  const x = i => L + band * (i + 0.5), y = v => T + (1 - v / top) * (h - T - B);
  const every = Math.max(1, Math.ceil(n / Math.floor((w - L - R) / 24)));
  let svg = "";
  for (let v = 0; v <= top; v += step) svg += `<line class="ax" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
  res.forEach((r, i) => { if ((n - 1 - i) % every === 0) svg +=`<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${r.round}</text>`; });
  svg += `<line class="st-guide" x1="0" x2="0" y1="${T}" y2="${h - B}"/>`;
  per.forEach((p, i) => {
    let base = 0;
    p.forEach((v, k) => {
      if (!v) return;
      svg += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(base + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(base) - y(base + v)).toFixed(1)}" rx="2.5" style="fill:${shade(t.colour, k)}"/>`;
      base += v;
    });
  });
  return {
    svg: `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Team points each round">${svg}</svg>`,
    xs: res.map((_, i) => x(i)),
    tip: i => `<b>Round ${res[i].round} · ${esc(short(res[i].name))}</b>` + crew.map((c, k) => per[i][k] || res[i].race.some(r => r.id === c.id && r.cid === t.id)
      ? `<span><i class="st-sw" style="--c:${shade(t.colour, k)}"></i>${esc(c.d.code)} ${pts(per[i][k])}</span>` : "").join("") +
      `<span class="dim">Total ${pts(per[i].reduce((a, b) => a + b, 0))}</span>`
  };
}

function raceRow({ R, race, sprint, q }, t, crew) {
  const order = id => { const k = crew.findIndex(c => c.id === id); return k < 0 ? 99 : k; };
  const has = p => race.some(x => x.classified && x.pos === p);
  const pole = R.quali.length ? q.some(x => x.pos === 1) : race.some(x => x.grid === 1);
  const marks = [has(1) && has(2) ? `<span class="badge green">1–2</span>` : "", pole ? `<span class="badge">Pole</span>` : "",
                 race.some(x => x.fl) ? `<span class="badge st-fl">Fastest lap</span>` : ""].join("");
  const sp = sprint.reduce((a, x) => a + x.points, 0), total = race.reduce((a, x) => a + x.points, 0) + sp;
  const info = infoLine([`Round ${R.round}`, R.date ? fmtShortDate(Date.parse(R.date)) : "",
    sprint.length ? `Sprint ${sprint.slice().sort((a, b) => order(a.id) - order(b.id)).map(x => `${x.code} ${outcome(x).label}`).join(", ")}${sp ? ` (${ptsWord(sp)})` : ""}` : ""]);
  const pair = race.slice().sort((a, b) => order(a.id) - order(b.id)).map(x => {
    const o = outcome(x);
    return `<span class="st-res">${dtagHtml(x.num, x.code, t.colour, true)}<span class="st-p${o.bad ? " bad" : x.pos <= 3 ? " pod" : x.points ? "" : " out"}">${o.label}</span>${o.note !== "Finished" ? `<small>${esc(o.note)}</small>` : ""}</span>`;
  }).join("");
  return `<li class="row st-tr" style="${tagVars(t.colour)}">
    <span class="flag" data-flag="${R.round}"></span>
    <span class="main"><b>${esc(short(R.name))}${marks ? `<span class="st-mk">${marks}</span>` : ""}</b><small>${info}</small><span class="st-pair">${pair}</span></span>
    <span class="end">${pts(total)}<small>pts</small></span>
  </li>`;
}
