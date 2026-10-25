// Saves one ordinary pit stop's path for every circuit on this season's and last season's calendars into pitlanes.json, so
// the Live tab can draw the pit lane without asking OpenF1 during a session (OpenF1 only answers free requests between sessions).
// Each circuit's path comes from its latest race: a race stop is an ordinary drive through the lane (practice "stops" are
// garage visits). The track map works out the lane itself from the path (js/timing.js).
// Run: node scripts/pitlanes.mjs [pitlanes.json]   (Node 22+, no packages). Circuits already saved from their latest race
// are kept as they are, so a publish only asks OpenF1 about a circuit after a new race there. If OpenF1 doesn't answer,
// the file stays as it was.
import { readFileSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] || new URL("../pitlanes.json", import.meta.url);
const API = "https://api.openf1.org/v1";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function of1(path) {   // OpenF1's free limit is 30 requests a minute: one every 2.1 s
  for (let i = 0; i < 4; i++) {
    await sleep(2100);
    const r = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (r && r.ok) return r.json();
    if (r && (r.status === 401 || r.status === 403)) throw new Error(`OpenF1 refused (HTTP ${r.status}): a session is probably live`);
    if (r && r.status === 404) return [];   // nothing there
    await sleep(5000 * (i + 1));
  }
  throw new Error(`OpenF1 didn't answer: ${path}`);
}

let saved = {};
try { saved = JSON.parse(readFileSync(OUT, "utf8")); } catch (e) {}
const year = new Date().getUTCFullYear(), now = Date.now();
const races = [];
for (const y of [year, year - 1])
  races.push(...(await of1(`sessions?year=${y}&session_name=Race`)).filter(s => !s.is_cancelled && Date.parse(s.date_end) < now - 3600000));
const byCircuit = {};   // circuit key -> its finished races, latest first (a cancelled race has no data: 2026 Sakhir and Jeddah)
for (const s of races.sort((a, b) => b.date_start.localeCompare(a.date_start))) (byCircuit[s.circuit_key] = byCircuit[s.circuit_key] || []).push(s);

let changed = 0;
circuits: for (const [key, list] of Object.entries(byCircuit)) {
  if (saved[key] && saved[key].session_key === list[0].session_key) continue;
  for (const s of list) {   // the latest race with a usable stop
    try {
      const stops = (await of1(`pit?session_key=${s.session_key}`)).filter(p => p.lane_duration > 12 && p.lane_duration < 45);
      if (!stops.length) continue;
      const p = stops[0], at = Date.parse(p.date);   // the pit time is near the END of the lane: take the whole lane and a little around it
      const from = new Date(at - (p.lane_duration + 15) * 1000).toISOString(), to = new Date(at + 15000).toISOString();
      const pts = (await of1(`location?session_key=${s.session_key}&driver_number=${p.driver_number}&date>=${from}&date<=${to}`)).filter(q => q.x || q.y);
      if (pts.length < 30) continue;
      const t0 = Date.parse(pts[0].date);
      saved[key] = { session_key: s.session_key, circuit: s.circuit_short_name, year: s.year,
                     path: pts.map(q => [q.x, q.y, Date.parse(q.date) - t0]) };   // x, y and ms since the first point
      changed++;
      console.log(`${s.circuit_short_name} (${key}): ${s.year} race, car ${p.driver_number}, ${pts.length} points`);
      continue circuits;
    } catch (e) {
      console.log(`${s.circuit_short_name} (${key}): ${e.message}`);
      if (/refused/.test(e.message)) break circuits;   // OpenF1 is closed for a live session: try again next publish
    }
  }
}
if (changed) writeFileSync(OUT, JSON.stringify(saved));
console.log(`pit lanes: ${Object.keys(saved).length} circuits, ${changed} new`);
