// Jolpica can keep a race's result from before the stewards' post-race penalties for days (Mexico 2026: Hirakawa 13th
// with no points, while the official result has him 10th with 1 and Piastri out of the points). OpenF1's result has the
// penalties. So for this season's latest race, what Jolpica says about it is put right from OpenF1's result: each
// driver's position and points in the race, and the drivers' and teams' points, wins and order in the standings.
// Once Jolpica has caught up there's nothing left to change. If OpenF1 can't be reached, Jolpica's answer is used as it is.
const NOW = new Date().getFullYear();
// the Jolpica answers that say something about the latest race (results/1.json, each round's winner, is left alone)
const FIXABLE = /^(current|\d{4})\/(driverStandings|constructorStandings|last\/results|\d+\/results|results)\.json/;
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
  const s = (await of1(`sessions?year=${NOW}`, { ttl: 3 * 3600000 }))   // the same ask as the calendar's, so usually already here
    .find(x => x.session_name === "Race" && Math.abs(Date.parse(x.date_start) - day) < 2 * 86400000);
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
