// Jolpica can keep a race's result from before the stewards' post-race penalties for days (Mexico 2026: Hirakawa 13th
// with no points, while the official result has him 10th with 1 and Piastri out of the points). OpenF1's result has the
// penalties. So for this season's latest race, what Jolpica says about it is put right from OpenF1's result: each
// driver's position and points in the race, and the drivers' and teams' points, wins and order in the standings.
// Once Jolpica has caught up there's nothing left to change. If OpenF1 can't be reached, Jolpica's answer is used as it is.
// Jolpica can also be hours behind with the race itself (Las Vegas 2026: still Brazil's result, and standings marked round 21
// with Brazil's points, 3½ hours after the race). While OpenF1 has a finished race Jolpica hasn't, that race is built from
// OpenF1 (its result, drivers and championship): the last race, that round's results, its winner, and both standings.
const NOW = new Date().getFullYear();
// the Jolpica answers that say something about the latest race (results/1.json, each round's winner, only gets a race Jolpica lacks)
const FIXABLE = /^(current|\d{4})\/(driverStandings|constructorStandings|last\/results|\d+\/results|results\/1|results)\.json/;
const pts = n => String(Math.round(n * 10) / 10);

let pending = null, at = 0;

// path: as given to jolpica(); v: its answer; raw/of1: the plain fetchers (api.js), so nothing here is corrected twice
export async function fixFinal(path, v, { raw, of1 }) {
  const m = FIXABLE.exec(path);
  if (!v || !v.MRData || !m || (m[1] !== "current" && +m[1] !== NOW)) return v;
  try {
    if (!pending || Date.now() - at > 10 * 60000) { at = Date.now(); pending = changes(raw, of1).catch(() => null); }
    const fix = await pending;
    if (!fix) return v;
    const out = JSON.parse(JSON.stringify(v)), d = out.MRData;   // a copy: the kept answer stays as Jolpica gave it
    if (fix.race) return ahead(out, m[2], fix);
    if (m[2] === "results/1") return v;
    if (d.StandingsTable) for (const list of d.StandingsTable.StandingsLists || []) standings(list, fix);
    if (d.RaceTable) for (const r of d.RaceTable.Races || []) if (+r.round === fix.round && +r.season === fix.season && r.Results) results(r, fix);
    return out;
  } catch (e) { return v; }
}

// { season, round, byCode: { HIR: { pos, points, delta, win, cid, gap } } } for every driver whose race OpenF1 has
// differently, or null when Jolpica agrees (or OpenF1 can't say)
async function changes(raw, of1) {
  const last = await raw("current/last/results.json");
  const race = last && last.MRData.RaceTable.Races[0];
  if (!race || +race.season !== NOW) return null;
  const day = Date.parse(race.date);
  const sessions = await of1(`sessions?year=${NOW}`, { ttl: 3 * 3600000 });   // the same ask as the calendar's, so usually already here
  const newer = sessions.filter(x => x.session_name === "Race" && Date.parse(x.date_start) - day > 2 * 86400000 && Date.parse(x.date_end) < Date.now());
  if (newer.length) {   // a race Jolpica hasn't got yet
    const got = await fresh(newer[newer.length - 1], race, raw, of1).catch(() => null);
    if (got) return got;
  }
  const s = sessions.find(x => x.session_name === "Race" && Math.abs(Date.parse(x.date_start) - day) < 2 * 86400000);
  if (!s) return null;
  const byNum = new Map((await of1(`session_result?session_key=${s.session_key}`, { ttl: 10 * 60000 })).map(x => [x.driver_number, x]));
  const byCode = {};
  for (const r of race.Results) {
    const o = byNum.get(+r.number);
    if (!o || typeof o.points !== "number") continue;
    const pos = typeof o.position === "number" ? o.position : null;   // not classified: Jolpica's place stays, only the points count
    if ((pos == null || pos === +r.position) && o.points === +r.points) continue;
    byCode[r.Driver.code] = { pos, points: o.points, delta: o.points - (+r.points || 0), win: (pos === 1) - (r.position === "1"),
                              cid: r.Constructor.constructorId, gap: o.gap_to_leader };
  }
  return Object.keys(byCode).length ? { season: NOW, round: +race.round, byCode } : null;
}

function results(race, fix) {
  for (const x of race.Results) {
    const f = fix.byCode[x.Driver.code];
    if (!f) continue;
    x.points = pts(f.points);
    if (f.pos != null) {
      x.position = x.positionText = String(f.pos);
      if (f.pos > 1 && typeof f.gap === "number") x.Time = { time: `+${f.gap.toFixed(3)}` };
    }
  }
  race.Results.sort((a, b) => +a.position - +b.position);
}

function standings(list, fix) {
  if (+list.round !== fix.round || +list.season !== fix.season) return;   // standings after another round: not this race's
  const rerank = rows => {   // by points; level on points, the order Jolpica had (it knows the countback)
    rows.sort((a, b) => +b.points - +a.points || +a.position - +b.position);
    rows.forEach((x, i) => { x.position = x.positionText = String(i + 1); });
  };
  if (list.DriverStandings) {
    for (const x of list.DriverStandings) {
      const f = fix.byCode[x.Driver.code];
      if (f) { x.points = pts(+x.points + f.delta); x.wins = String(+x.wins + f.win); }
    }
    rerank(list.DriverStandings);
  }
  if (list.ConstructorStandings) {
    const delta = {}, wins = {};
    for (const f of Object.values(fix.byCode)) { delta[f.cid] = (delta[f.cid] || 0) + f.delta; wins[f.cid] = (wins[f.cid] || 0) + f.win; }
    for (const x of list.ConstructorStandings) {
      const c = x.Constructor.constructorId;
      if (delta[c]) x.points = pts(+x.points + delta[c]);
      if (wins[c]) x.wins = String(+x.wins + wins[c]);
    }
    rerank(list.ConstructorStandings);
  }
}

// A race OpenF1 has finished and Jolpica hasn't got: { season, round, race (Jolpica's shape), drivers: { code: { points,
// pos } }, teams: { cid: { points, pos } }, win: { code, cid } }. Drivers' ids and teams come from Jolpica's last race;
// null if OpenF1 has no result yet or the round isn't in Jolpica's calendar.
async function fresh(s, prev, raw, of1) {
  const k = s.session_key, ttl = { ttl: 10 * 60000 };
  const [res, people, cd, ct, cal] = await Promise.all([of1(`session_result?session_key=${k}`, ttl), of1(`drivers?session_key=${k}`, ttl),
    of1(`championship_drivers?session_key=${k}`, ttl), of1(`championship_teams?session_key=${k}`, ttl), raw(`${NOW}.json`)]);
  const day = Date.parse(s.date_start), meta = cal && cal.MRData.RaceTable.Races.find(r => Math.abs(Date.parse(r.date) - day) < 2 * 86400000);
  if (!res.length || !meta) return null;
  const was = new Map(prev.Results.map(r => [r.Driver.code, r])), byNum = new Map(people.map(p => [p.driver_number, p]));
  const cidOf = new Map();   // OpenF1's team name -> Jolpica's constructor, through the drivers in both
  for (const p of people) { const w = was.get(p.name_acronym); if (w && !cidOf.has(p.team_name)) cidOf.set(p.team_name, w.Constructor); }
  const clock = t => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = (t % 60).toFixed(3).padStart(6, "0");
    return `${h}:${String(m).padStart(2, "0")}:${sec}`; };
  const rows = [...res].sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || b.number_of_laps - a.number_of_laps);
  const Results = rows.map((o, i) => {
    const p = byNum.get(o.driver_number) || {}, w = was.get(p.name_acronym);
    const Driver = w ? w.Driver : { driverId: (p.last_name || String(o.driver_number)).toLowerCase(), code: p.name_acronym, givenName: p.first_name, familyName: p.last_name };
    const Constructor = cidOf.get(p.team_name) || (w && w.Constructor) || { constructorId: (p.team_name || "").toLowerCase().replace(/\W+/g, "_"), name: p.team_name };
    const gap = o.gap_to_leader, out = { number: String(o.driver_number), position: String(i + 1), points: pts(o.points || 0), Driver, Constructor,
      laps: String(o.number_of_laps || 0), positionText: o.position != null ? String(o.position) : o.dsq ? "D" : o.dns ? "W" : "R",
      status: o.dsq ? "Disqualified" : o.dns ? "Did not start" : o.dnf ? "Retired" : typeof gap === "string" ? gap.replace("LAP", "Lap") : "Finished" };
    if (o.position === 1 && o.duration) out.Time = { time: clock(o.duration) };
    else if (o.position != null && typeof gap === "number") out.Time = { time: `+${gap.toFixed(3)}` };
    return out;
  });
  const code = n => (byNum.get(n) || {}).name_acronym, w1 = Results[0];
  const drivers = Object.fromEntries(cd.map(x => [code(x.driver_number), { points: x.points_current, pos: x.position_current }]));
  const teams = Object.fromEntries(ct.filter(x => cidOf.has(x.team_name)).map(x => [cidOf.get(x.team_name).constructorId, { points: x.points_current, pos: x.position_current }]));
  return { season: NOW, round: +meta.round, race: { ...meta, Results }, drivers, teams, win: { code: w1.Driver.code, cid: w1.Constructor.constructorId } };
}

// a Jolpica answer brought up to the race it hasn't got (fix from fresh())
function ahead(out, kind, fix) {
  const d = out.MRData;
  if (kind === "last/results") d.RaceTable.Races = [fix.race];
  else if (kind === "results/1") { if (!d.RaceTable.Races.some(r => +r.round === fix.round)) d.RaceTable.Races.push({ ...fix.race, Results: fix.race.Results.slice(0, 1) }); }
  else if (/^\d+\/results$/.test(kind)) { if (+kind.split("/")[0] === fix.round) d.RaceTable.Races = [fix.race]; }
  else if (d.StandingsTable) for (const list of d.StandingsTable.StandingsLists || []) {
    if (+list.round > fix.round) continue;   // (Jolpica's already past it)
    list.round = String(fix.round);   // (Las Vegas 2026: Jolpica marked them round 21, still with Brazil's points)
    const set = (rows, key, of, win) => {
      for (const x of rows || []) {
        const f = of[key(x)];
        if (!f) continue;
        if (key(x) === win && +x.points !== f.points) x.wins = String(+x.wins + 1);   // its points not in yet: nor is the win
        x.points = pts(f.points);
        if (f.pos) x.position = x.positionText = String(f.pos);
      }
      if (rows) rows.sort((a, b) => +a.position - +b.position);
    };
    set(list.DriverStandings, x => x.Driver.code, fix.drivers, fix.win.code);
    set(list.ConstructorStandings, x => x.Constructor.constructorId, fix.teams, fix.win.cid);
  }
  return out;
}
