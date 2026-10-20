// Season numbers for the Standings tab and the driver and team pages: Jolpica's standings and every result of a
// season, matched to the current drivers (photos, team colours) by three-letter code, since Jolpica's team names
// aren't Formula 1's own ("RB F1 Team" vs "Racing Bulls").
import { jolpica } from "./api.js";
import { drivers as roster } from "./season.js";
import { esc, fixText, photo, tagVars, logoPair, clamp } from "./util.js";

export const FIRST = 2023;   // the oldest season the pages offer
export const NOW = new Date().getFullYear();
const NEUTRAL = "#8a8f9c";
// rough team colours for past seasons (the live driver list only knows this season's)
const PAST = { red_bull: "#3671c6", ferrari: "#e8002d", mercedes: "#27f4d2", mclaren: "#ff8000", aston_martin: "#229971", alpine: "#0093cc",
               williams: "#64c4ff", haas: "#b6babd", rb: "#6692ff", alphatauri: "#5e8faa", sauber: "#52e252", alfa: "#c92d4b", audi: "#f50537", cadillac: "#909090" };

// a past season's page carries its year in the link ("hamilton--2024"); this season's is plain
export const parseId = p => { const m = /^(.+?)--(\d{4})$/.exec(p || ""); return m ? [m[1], +m[2]] : [p, null]; };
export const driverHref = (id, y) => `#/driver/${id}${y && y !== NOW ? `--${y}` : ""}`;
export const teamHref = (id, y) => `#/team/${id}${y && y !== NOW ? `--${y}` : ""}`;
export const yearPick = y => `<select class="pick st-year" aria-label="Season">${Array.from({ length: NOW - FIRST + 1 }, (_, i) => NOW - i)
  .map(v => `<option value="${v}"${v === y ? " selected" : ""}>${v}</option>`).join("")}</select>`;

export const pts = v => Number.isInteger(v) ? String(v) : v.toFixed(1);
export const ptsWord = v => `${pts(v)} pt${v === 1 ? "" : "s"}`;
// "Round 4 · 3 May · +1 Lap": each part kept on one line when the text wraps
export const infoLine = parts => parts.filter(Boolean).map(p => esc(p).replace(/ /g, "&nbsp;")).join(" · ");
export const short = name => (name || "").replace(/Grand Prix/, "GP");
const tidy = name => fixText(name || "").replace(/ F1 Team$/, "");
const initials = s => s.split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase();

// a photo on the team colour, or initials when there's no photo (past seasons)
export const faceHtml = (d, px, cls = "face", lazy = true) => d.shape
  ? `<img class="${cls}" style="--tc:${d.colour}" src="${esc(photo(d.shape, px, d.year))}" alt=""${lazy ? ` loading="lazy"` : ""}>`
  : `<span class="${cls} st-ini" style="${tagVars(d.colour)}">${esc(initials(`${d.first} ${d.last}`))}</span>`;
export const logoHtml = (t, cls = "") => t.f1
  ? `<span class="st-logo ${cls}" style="--tc:${t.colour}">${logoPair(t.f1, "tl", t.year)}</span>`
  : `<span class="st-logo st-ini ${cls}" style="${tagVars(t.colour)}">${esc(initials(t.name))}</span>`;

// Jolpica allows about 4 requests a second: a page's burst goes out 3 at a time
let running = 0;
const queue = [];
async function jo(path, ttl) {
  while (running >= 3) await new Promise(r => queue.push(r));
  running++;
  try { return await jolpica(path, { ttl }); }
  finally { running--; const next = queue.shift(); if (next) next(); }
}
const ttlFor = y => y < NOW ? 7 * 86400000 : 10 * 60000;

// every page of a paged list, with a race that runs over two pages joined back together
async function paged(path, key, ttl) {
  const first = await jo(path, ttl);
  if (!first) return [];
  const m = first.MRData, step = +m.limit || 100, offs = [];
  for (let o = step; o < +m.total; o += step) offs.push(o);
  const more = await Promise.all(offs.map(o => jo(`${path}?offset=${o}`, ttl)));
  const byRound = new Map();
  for (const r of [first, ...more].flatMap(p => p ? p.MRData.RaceTable.Races : [])) {
    const had = byRound.get(+r.round);
    if (had) had[key].push(...r[key]); else byRound.set(+r.round, { ...r, [key]: [...r[key]] });
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

// worked-out answers stay for the visit (this season's for 10 minutes, so a finished race shows up)
const memo = new Map();
function once(key, year, fn) {
  const had = memo.get(key);
  if (had && (year < NOW || Date.now() - had.t < 10 * 60000)) return had.p;
  const p = fn().catch(e => { memo.delete(key); throw e; });
  memo.set(key, { t: Date.now(), p });
  return p;
}

// the newest season with standings (early in the year the new one has none yet)
export async function latestYear() {
  const s = await standings(NOW).catch(() => null);
  return s && s.round ? NOW : NOW - 1;
}

// { year, round, total, raceName, left, maxLeft, drivers: [driver], teams: [team] }
//   driver: { id, code, num, first, last, name, nat, dob, cid, team, colour, shape (for photo()), pos, posText, points, wins, year }
//   team:   { id, name, f1 (F1's own name, for the logo), colour, pos, posText, points, wins, drivers: [driver in its cars now], year }
export const standings = year => once("s" + year, year, () => loadStandings(year));
async function loadStandings(year) {
  const ttl = ttlFor(year);
  const [ds, cs, cal, list] = await Promise.all([jo(`${year}/driverStandings.json`, ttl), jo(`${year}/constructorStandings.json`, ttl),
    jo(`${year}.json`, ttl).catch(() => null), roster(year).catch(() => [])]);   // that year's line-up: its photos, team names, logos and cars
  const dl = ds && ds.MRData.StandingsTable.StandingsLists[0], cl = cs && cs.MRData.StandingsTable.StandingsLists[0];
  const races = (cal && cal.MRData.RaceTable.Races) || [], round = dl ? +dl.round : 0;
  // who sat in which car at the latest race (a driver's list of teams isn't in the order they drove for them)
  const last = round ? await jo(`${year}/${round}/results.json`, ttl).catch(() => null) : null;
  const lastRace = last && last.MRData.RaceTable.Races[0], lastRows = lastRace ? lastRace.Results : [];
  const seat = new Map(lastRows.map(r => [r.Driver.driverId, r.Constructor.constructorId]));
  const byCode = new Map(list.map(d => [d.tla, d]));
  const teamInfo = new Map();   // constructorId -> { f1, colour }, through the team's drivers
  const learn = (cid, code) => { const d = byCode.get(code); if (d && !teamInfo.has(cid)) teamInfo.set(cid, { f1: d.team, colour: d.colour }); };
  for (const r of lastRows) learn(r.Constructor.constructorId, r.Driver.code);
  for (const x of dl ? dl.DriverStandings : []) if (x.Constructors.length === 1) learn(x.Constructors[0].constructorId, x.Driver.code);

  const drivers = (dl ? dl.DriverStandings : []).map(x => {
    const cids = x.Constructors.map(c => c.constructorId), cid = seat.get(x.Driver.driverId) || cids[cids.length - 1];
    const C = x.Constructors.find(c => c.constructorId === cid) || {};
    return person(x.Driver, { year, cid, cname: C.name, mine: byCode.get(x.Driver.code), team: teamInfo.get(cid),
      pos: +x.position || 0, posText: x.positionText || x.position || "–", points: +x.points || 0, wins: +x.wins || 0 });
  });
  const teams = (cl ? cl.ConstructorStandings : []).map(x => {
    const C = x.Constructor, t = teamInfo.get(C.constructorId);
    return { id: C.constructorId, name: tidy(t ? t.f1 : C.name), f1: t ? t.f1 : null, colour: t ? t.colour : PAST[C.constructorId] || NEUTRAL,
             pos: +x.position || 0, posText: x.positionText || x.position || "–", points: +x.points || 0, wins: +x.wins || 0,
             drivers: drivers.filter(d => d.cid === C.constructorId && (!seat.size || seat.has(d.id))), year };
  });
  const left = races.filter(r => +r.round > round);
  const raceName = fixText(lastRace ? lastRace.raceName : (races.find(r => +r.round === round) || {}).raceName || "");
  // most a driver can still score: a win each race (plus the fastest-lap point before 2025), and 8 a sprint
  const maxLeft = left.length * (year < 2025 ? 26 : 25) + left.filter(r => r.Sprint).length * 8;
  return { year, round, total: races.length, raceName, left: left.length, maxLeft, drivers, teams };
}

function person(D, o) {
  // the first name F1 uses ("Kimi", where Jolpica has "Andrea Kimi"); Jolpica's surname keeps its accents
  const t = o.team, mine = o.mine, first = mine && mine.first ? mine.first : fixText(D.givenName || ""), last = fixText(D.familyName || "");
  // a photo for this season's drivers; one who's out of the car now still gets one through their team
  const shape = mine || (t ? { FirstName: first, LastName: last, TeamName: t.f1 } : null);
  return { id: D.driverId, code: D.code || last.slice(0, 3).toUpperCase(), num: (mine && mine.num) || D.permanentNumber || "",
           first, last, name: `${first} ${last}`, nat: D.nationality || "", dob: D.dateOfBirth || "",
           cid: o.cid, team: tidy(t ? t.f1 : mine ? mine.team : o.cname), colour: t ? t.colour : mine ? mine.colour : PAST[o.cid] || NEUTRAL,
           shape, pos: o.pos, posText: o.posText, points: o.points, wins: o.wins, year: o.year };
}

// every round of a season: [{ round, name, date, race: [row], sprint: [row], quali: [{ id, cid, pos }] }]
//   row: { id, code, num, cid, pos, text, classified, points, grid, laps, down, status, fl }
export const results = year => once("r" + year, year, () => loadResults(year));
async function loadResults(year) {
  const ttl = ttlFor(year);
  const [race, sprint, quali] = await Promise.all([paged(`${year}/results.json`, "Results", ttl),
    paged(`${year}/sprint.json`, "SprintResults", ttl).catch(() => []), paged(`${year}/qualifying.json`, "QualifyingResults", ttl).catch(() => [])]);
  const rounds = new Map();
  const at = r => {
    if (!rounds.has(+r.round)) rounds.set(+r.round, { round: +r.round, name: fixText(r.raceName), date: r.date, race: [], sprint: [], quali: [] });
    return rounds.get(+r.round);
  };
  for (const r of race) at(r).race = r.Results.map(row);
  for (const r of sprint) at(r).sprint = r.SprintResults.map(row);
  for (const r of quali) at(r).quali = r.QualifyingResults.map(x => ({ id: x.Driver.driverId, cid: x.Constructor.constructorId, pos: +x.position }));
  // the winner's laps tell how many laps down the rest were
  for (const R of rounds.values()) for (const rows of [R.race, R.sprint]) {
    const lead = (rows.find(x => x.pos === 1) || {}).laps || 0;
    for (const x of rows) x.down = x.classified && lead ? Math.max(0, lead - x.laps) : 0;
  }
  return [...rounds.values()].sort((a, b) => a.round - b.round);
}
const row = x => ({ id: x.Driver.driverId, code: x.Driver.code, num: x.number, cid: x.Constructor.constructorId, pos: +x.position, text: x.positionText,
  classified: /^\d+$/.test(x.positionText), points: +x.points || 0, grid: +x.grid || 0, laps: +x.laps || 0, status: x.status || "",
  fl: !!(x.FastestLap && x.FastestLap.rank === "1") });

// each round's flag, once the calendar (season.js) is in: rows carry <span class="flag" data-flag="round">
export function fillFlags(el, cal) {
  if (!cal || !el.isConnected) return;
  for (const f of el.querySelectorAll("[data-flag]")) {
    const r = cal.rounds.find(x => x.round === +f.dataset.flag);
    if (r && r.flag) f.outerHTML = `<img class="flag" src="${esc(r.flag)}" alt="">`;
  }
}

// how a race went:{ label: "P4" / "DNF" / …, note: "Finished" / "+1 Lap" / …, bad }
const ran = x => x.status === "Finished" || x.status === "Lapped" || /^\+\d+ Laps?$/.test(x.status);
export function outcome(x) {
  if (x.text === "W" || /did not start|withdr/i.test(x.status)) return { label: "DNS", note: "Did not start", bad: true };
  if (x.text === "D" || /disqualified/i.test(x.status)) return { label: "DSQ", note: "Disqualified", bad: true };
  if (x.text === "E") return { label: "EX", note: "Excluded", bad: true };
  if (x.text === "F") return { label: "DNQ", note: "Did not qualify", bad: true };
  if (x.text === "N") return { label: "NC", note: "Not classified", bad: true };
  const why = x.status && !/^retired$/i.test(x.status) ? x.status : x.laps ? `Retired after ${x.laps} lap${x.laps === 1 ? "" : "s"}` : "Retired on lap 1";
  if (!x.classified) return { label: "DNF", note: why, bad: true };
  const label = `P${x.pos}`;
  if (x.status === "Finished") return { label, note: "Finished" };
  if (/^\+\d+ Laps?$/.test(x.status)) return { label, note: x.status };
  if (x.status === "Lapped") return { label, note: x.down ? `+${x.down} Lap${x.down > 1 ? "s" : ""}` : "Lapped" };
  return { label, note: `${why} · classified` };   // stopped near the end but still classified
}
// started but didn't see the flag
export const isDnf = x => !/^[WDEF]$/.test(x.text) && !/did not start|withdr|disqualified/i.test(x.status) && !(x.classified && ran(x));

// round values for an axis: { top, step }
export function scale(max, n = 4) {
  if (!(max > 0)) return { top: 10, step: 5 };
  const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw);
  return { top: Math.ceil(max / step) * step, step };
}
// draws a chart at the box's real width (so its text stays readable on a phone), again when that changes,
// with a readout on hover or tap. draw(width) → { svg, xs: [x of each point], tip: i → html }. Returns the clean-up.
export function liveChart(box, draw) {
  let w = 0, cur = null;
  const render = () => {
    const nw = Math.round(box.clientWidth);
    if (!nw || nw === w) return;
    w = nw; cur = draw(w);
    box.innerHTML = cur.svg + `<div class="st-tip" hidden></div>`;
  };
  const show = e => {
    if (!cur || !cur.xs.length) return;
    const x = e.clientX - box.getBoundingClientRect().left;
    let i = 0;
    cur.xs.forEach((v, k) => { if (Math.abs(v - x) < Math.abs(cur.xs[i] - x)) i = k; });
    const tip = box.querySelector(".st-tip"), guide = box.querySelector(".st-guide");
    tip.innerHTML = cur.tip(i); tip.hidden = false;
    tip.style.left = clamp(cur.xs[i] - tip.offsetWidth / 2, 0, w - tip.offsetWidth) + "px";
    if (guide) { guide.setAttribute("x1", cur.xs[i]); guide.setAttribute("x2", cur.xs[i]); guide.classList.add("on"); }
  };
  const hide = () => { const t = box.querySelector(".st-tip"), g = box.querySelector(".st-guide"); if (t) t.hidden = true; if (g) g.classList.remove("on"); };
  box.addEventListener("pointermove", show);
  box.addEventListener("pointerdown", show);
  // a finger lifting also "leaves", so a tapped readout stays until the next tap
  box.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hide(); });
  const ro = new ResizeObserver(() => requestAnimationFrame(render));
  ro.observe(box); render();
  return () => ro.disconnect();
}
