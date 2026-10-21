// A driver's season: championship place, stats, points over the year, every race, and the teammate battle.
import { esc, note, skeleton, tagVars, fmtShortDate } from "../util.js";
import { season } from "../season.js";
import { standings, results, latestYear, parseId, yearPick, driverHref, teamHref, faceHtml, logoHtml, pts, ptsWord, infoLine, short, outcome, isDnf, scale, liveChart, fillFlags, roundsOf, teammates, h2hHtml, NOW } from "../stats.js";

export default {
  title: "Driver",
  tab: "standings",
  async mount(el, [param], app) {
    app.setBack("#/standings/drivers");
    let [id, year] = parseId(param);
    el.innerHTML = loading();
    year = year || await latestYear().catch(() => NOW);
    if (!el.isConnected) return;
    app.setTools(yearPick(year)).querySelector("select").addEventListener("change", e => app.go(driverHref(id, +e.target.value)));

    const resP = results(year), calP = season(year).catch(() => null);
    resP.catch(() => {});   // handled where it's awaited; this page may leave before then
    let st, res;
    try { st = await standings(year); }
    catch (e) { if (el.isConnected) el.innerHTML = failed(); return; }
    if (!el.isConnected) return;
    const d = st.drivers.find(x => x.id === id);
    if (!d) {
      el.innerHTML = `<div class="card st-nf"><b>Driver not found</b><p>There's no “${esc(id)}” in the ${year} standings.</p><a class="btn" href="#/standings/drivers">Driver standings</a></div>`;
      return;
    }
    app.setTitle(d.name);
    const team = st.teams.find(t => t.id === d.cid) || { name: d.team, f1: null, colour: d.colour };
    el.querySelector(".st-hero").outerHTML = hero(d, team);

    try { res = await resP; }
    catch (e) { if (el.isConnected) el.querySelector(".st-cols").innerHTML = failed(); return; }
    if (!el.isConnected) return;

    const mine = roundsOf(res, id);
    const teamOf = cid => st.teams.find(t => t.id === cid) || { name: cid, colour: d.colour };
    const rival = st.drivers[0].id === id ? st.drivers[1] : st.drivers[0];
    const mates = teammates(mine, id);
    el.querySelector(".st-cols").innerHTML = `
      <div class="stack">
        <section class="card"><h2 class="card-h">${year} season</h2>${tiles(d, mine)}</section>
        <section class="card"><h2 class="card-h">Points through the season</h2>
          <div class="st-chart" style="${tagVars(d.colour)}"></div>
          <div class="st-legend"><span><i class="st-sw" style="--c:${d.colour}"></i>${esc(d.last)}</span>${rival ? `<span><i class="dash"></i>${esc(rival.last)} (${rival.pos === 1 ? "leader" : `P${esc(rival.posText)}`})</span>` : ""}</div>
        </section>
        ${mates.length ? `<section class="card st-h2h-card" style="${tagVars(d.colour)}"><h2 class="card-h">Teammate head-to-head</h2><div class="st-h2h"></div></section>` : ""}
      </div>
      <section class="card"><h2 class="card-h">Race by race <small>${mine.length} round${mine.length === 1 ? "" : "s"}</small></h2>
        <ul class="rows">${mine.slice().reverse().map(x => raceRow(x, d, teamOf)).join("") || `<li>${note("No races yet.")}</li>`}</ul>
        ${st.left ? `<p class="st-upcoming">${st.left} round${st.left > 1 ? "s" : ""} still to run.</p>` : ""}
      </section>`;

    // points over the season, against the leader (or the runner-up, for the leader)
    const lines = [{ code: d.code, colour: d.colour, vals: cumulative(res, id), main: true }];
    if (rival) lines.unshift({ code: rival.code, colour: "var(--dim)", vals: cumulative(res, rival.id) });
    const box = el.querySelector(".st-chart");
    let stop = null;
    if (res.length > 1) stop = liveChart(box, w => progression(w, res, lines));
    else box.innerHTML = note("The chart starts after round 2.");

    // teammate battle, with a pick when there was more than one
    const h2hBox = el.querySelector(".st-h2h");
    const showMate = mid => { h2hBox.innerHTML = h2h(d, mates, mid, st); };
    if (h2hBox) {
      showMate(mates[0].id);
      h2hBox.addEventListener("click", e => { const b = e.target.closest("[data-mate]"); if (b) showMate(b.dataset.mate); });
    }

    calP.then(cal => fillFlags(el, cal));
    return stop;
  }
};

const loading = () => `<div class="st-hero" style="--tc:var(--chip)">${skeleton(3)}</div>
  <div class="st-cols"><div class="stack"><div class="card">${skeleton(5)}</div><div class="card">${skeleton(6)}</div></div><div class="card">${skeleton(10)}</div></div>`;
const failed = () => `<div class="card">${note("This season couldn't load. Try again in a minute.", "err")}</div>`;

function age(dob) {
  if (!dob) return "";
  const b = new Date(dob), n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
}

function hero(d, team) {
  const a = age(d.dob);
  return `<section class="st-hero" style="${tagVars(d.colour)}">
    ${d.num ? `<span class="st-hero-num" aria-hidden="true">${esc(d.num)}</span>` : ""}
    ${faceHtml(d, 400, "st-hero-photo", false)}
    <div class="st-hero-txt">
      <a class="st-hero-team" href="${teamHref(d.cid, d.year)}">${logoHtml(team)}<span>${esc(d.team)}</span></a>
      <h2><span>${esc(d.first)}</span>${esc(d.last)}</h2>
      <div class="st-hero-meta">${[d.num ? `#${esc(d.num)}` : "", esc(d.nat), a ? `Age ${a}` : ""].filter(Boolean).join(" · ")}</div>
      <div class="st-hero-stats">
        <div><b>P${esc(d.posText)}</b><small>Standing</small></div>
        <div><b>${pts(d.points)}</b><small>Points</small></div>
        ${d.wins ? `<div><b>${d.wins}</b><small>Win${d.wins > 1 ? "s" : ""}</small></div>` : ""}
      </div>
    </div>
  </section>`;
}

function tiles(d, mine) {
  const raced = mine.filter(x => x.race), cls = raced.filter(x => x.race.classified).map(x => x.race.pos);
  const best = cls.length ? Math.min(...cls) : null, bestN = cls.filter(p => p === best).length;
  // pole from qualifying, or from the grid when a round's qualifying is missing
  const poles = mine.filter(x => x.R.quali.length ? x.q && x.q.pos === 1 : x.race && x.race.grid === 1).length;
  const sprint = mine.reduce((a, x) => a + (x.sprint ? x.sprint.points : 0), 0);
  const t = [
    ["Points", pts(d.points)], ["Position", `P${esc(d.posText)}`],
    ["Wins", raced.filter(x => x.race.classified && x.race.pos === 1).length], ["Podiums", cls.filter(p => p <= 3).length],
    ["Poles", poles], ["Fastest laps", raced.filter(x => x.race.fl).length],
    ["DNFs", raced.filter(x => isDnf(x.race)).length], ["Best finish", best ? `P${best}${bestN > 1 ? `<em>×${bestN}</em>` : ""}` : "–"],
    ["Avg finish", cls.length ? (cls.reduce((a, b) => a + b, 0) / cls.length).toFixed(1) : "–"],
    ["Pts / race", raced.length ? (d.points / raced.length).toFixed(1) : "–"],
    ["Sprint pts", pts(sprint)], ["Races", raced.length]
  ];
  return `<div class="kv st-kv">${t.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join("")}</div>`;
}

const roundPts = (R, who) => R.race.concat(R.sprint).reduce((a, x) => a + (x.id === who ? x.points : 0), 0);
const cumulative = (res, who) => { let s = 0; return res.map(R => s += roundPts(R, who)); };

// cumulative points per round: the driver's line in team colour over a dimmed reference line
function progression(w, rounds, lines) {
  const n = rounds.length, h = w < 520 ? 210 : 250, L = 34, R = 50, T = 12, B = 24;
  const { top, step } = scale(Math.max(...lines.flatMap(l => l.vals)));
  const x = i => L + i * (w - L - R) / (n - 1), y = v => T + (1 - v / top) * (h - T - B);
  const every = Math.max(1, Math.ceil(n / Math.floor((w - L - R) / 26)));
  let svg = "";
  for (let v = 0; v <= top; v += step) svg += `<line class="ax" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
  rounds.forEach((r, i) => { if ((n - 1 - i) % every === 0) svg +=`<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${r.round}</text>`; });
  svg += `<line class="st-guide" x1="0" x2="0" y1="${T}" y2="${h - B}"/>`;
  const main = lines.find(l => l.main), path = l => l.vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  svg += `<defs><linearGradient id="st-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${main.colour}" stop-opacity=".28"/><stop offset="1" stop-color="${main.colour}" stop-opacity="0"/></linearGradient></defs>`;
  svg += `<path d="${path(main)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z" fill="url(#st-fill)"/>`;
  // end labels pushed apart when the lines finish close together
  const ends = lines.map(l => ({ l, y: y(l.vals[n - 1]) }));
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
    const [hi, lo] = ends[0].y < ends[1].y ? ends : [ends[1], ends[0]], mid = (hi.y + lo.y) / 2;
    hi.y = mid - 7; lo.y = mid + 7;
  }
  for (const { l, y: ly } of ends) {
    svg += l.main ? `<path d="${path(l)}" fill="none" stroke="${l.colour}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`
                  : `<path d="${path(l)}" fill="none" style="stroke:${l.colour}" stroke-width="1.6" stroke-dasharray="4 4" opacity=".75"/>`;
    svg += `<circle cx="${x(n - 1)}" cy="${y(l.vals[n - 1])}" r="${l.main ? 4 : 3}" style="fill:${l.colour}"/>`;
    svg += `<text class="lbl" x="${x(n - 1) + 8}" y="${ly + 4}" style="fill:${l.main ? l.colour : "var(--dim)"}">${esc(l.code)}</text>`;
  }
  return {
    svg: `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Points after each round">${svg}</svg>`,
    xs: rounds.map((_, i) => x(i)),
    tip: i => `<b>Round ${rounds[i].round} · ${esc(short(rounds[i].name))}</b>` + lines.slice().reverse().map(l => {
      const gain = l.vals[i] - (i ? l.vals[i - 1] : 0);
      return `<span><i class="st-sw" style="--c:${l.colour}"></i>${esc(l.code)} ${pts(l.vals[i])}<small class="dim">${gain ? ` +${pts(gain)}` : ""}</small></span>`;
    }).join("")
  };
}

function raceRow({ R, race, sprint, q }, d, teamOf) {
  const cid = (race || sprint).cid, other = cid !== d.cid ? teamOf(cid) : null, c = other ? other.colour : d.colour;
  const o = race ? outcome(race) : null, s = sprint ? outcome(sprint) : null;
  const pole = R.quali.length ? q && q.pos === 1 : race && race.grid === 1;
  const marks = [pole ? `<span class="badge">Pole</span>` : "", race && race.fl ? `<span class="badge st-fl">Fastest lap</span>` : ""].join("");
  const info = infoLine([`Round ${R.round}`, R.date ? fmtShortDate(Date.parse(R.date)) : "", other ? `for ${other.name}` : "", o && o.note !== "Finished" ? o.note : "",
                         s ? `Sprint ${s.label}${sprint.points ? ` (${ptsWord(sprint.points)})` : ""}` : ""]);
  let from = "";
  if (race && !/^(DNS|DNQ)$/.test(o.label)) {
    const delta = race.classified && race.grid ? race.grid - race.pos : null;
    from = `<span>${delta ? `<em class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}</em>` : delta === 0 ? `<em class="same">=</em>` : ""}
      <small>${race.grid ? `from P${race.grid}` : "pit lane"}</small></span>`;
  }
  const chip = o ? `<span class="st-p${o.bad ? " bad" : race.pos <= 3 ? " pod" : race.points ? "" : " out"}">${o.label}</span>` : `<span class="st-p out">–</span>`;
  return `<li class="row st-rr" style="${tagVars(c)}">
    <span class="flag" data-flag="${R.round}"></span>
    <span class="main"><b>${esc(short(R.name))}${marks ? `<span class="st-mk">${marks}</span>` : ""}</b><small>${info}</small></span>
    <span class="st-fin">${from || "<span></span>"}${chip}</span>
    <span class="end">${pts((race ? race.points : 0) + (sprint ? sprint.points : 0))}<small>pts</small></span>
  </li>`;
}

// head-to-head against one teammate, with a pick when there was more than one
function h2h(d, mates, mid, st) {
  const h = mates.find(m => m.id === mid) || mates[0], m = st.drivers.find(x => x.id === h.id);
  if (!m) return note("No teammate data.");
  const chips = mates.length > 1 ? `<div class="chips">${mates.map(x => { const p = st.drivers.find(y => y.id === x.id);
    return `<button type="button" data-mate="${esc(x.id)}" aria-pressed="${x.id === h.id}">vs ${esc(p ? p.last : x.id)} (${x.n})</button>`; }).join("")}</div>` : "";
  return h2hHtml(d, m, h, chips);
}
