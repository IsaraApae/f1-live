// The season: every Grand Prix weekend and its sessions, merged from Jolpica (rounds, circuit locations)
// and OpenF1 (session keys for replays, flags, circuit keys for the track map). Plus the current drivers.
import { of1, jolpica } from "./api.js";
import { fixText, hex, SHORT } from "./util.js";

const KIND = { "Practice 1": "fp1", "Practice 2": "fp2", "Practice 3": "fp3", "Sprint Qualifying": "sq", "Sprint Shootout": "sq", "Sprint": "sprint", "Qualifying": "q", "Race": "race" };
const LENGTH = { fp1: 60, fp2: 60, fp3: 60, sq: 45, sprint: 60, q: 60, race: 120 };   // minutes, when only the start is known
const JOLPICA_SESSIONS = [["FirstPractice", "Practice 1"], ["SecondPractice", "Practice 2"], ["ThirdPractice", "Practice 3"],
                          ["SprintQualifying", "Sprint Qualifying"], ["SprintShootout", "Sprint Qualifying"], ["Sprint", "Sprint"], ["Qualifying", "Qualifying"]];

const seasons = {};
// { year, rounds: [{ round, name, circuit, circuitId, locality, country, lat, lon, flag, circuitKey, meetingKey, circuitImage, start, end, sprint,
//                    sessions: [{ kind, name, short, start, end, key }] }] }
export function season(year = new Date().getFullYear()) {
  return seasons[year] = seasons[year] || load(year).catch(e => { delete seasons[year]; throw e; });
}
async function load(year) {
  const ttl = year < new Date().getFullYear() ? 7 * 86400000 : 3 * 3600000;
  const [jo, meetings, sessions] = await Promise.all([
    jolpica(`${year}.json`, { ttl }).catch(() => null),
    of1(`meetings?year=${year}`, { ttl }).catch(() => []),
    of1(`sessions?year=${year}`, { ttl }).catch(() => [])
  ]);
  const races = (jo && jo.MRData.RaceTable.Races) || [];
  const meets = meetings.filter(m => !m.is_cancelled && !/testing/i.test(m.meeting_name));
  const rounds = races.map(r => {
    const raceAt = Date.parse(`${r.date}T${r.time || "12:00:00Z"}`);
    // the OpenF1 weekend whose last day is race day (a day either side for time zones)
    const m = meets.find(x => Math.abs(Date.parse(x.date_end) - raceAt) < 2 * 86400000) || {};
    const own = sessions.filter(s => s.meeting_key === m.meeting_key && !s.is_cancelled && KIND[s.session_name]);
    let list = own.map(s => ({ kind: KIND[s.session_name], name: s.session_name === "Sprint Shootout" ? "Sprint Qualifying" : s.session_name,
                               start: Date.parse(s.date_start), end: Date.parse(s.date_end), key: s.session_key }));
    if (!list.length) {   // OpenF1 doesn't have this weekend yet: Jolpica's start times
      list = JOLPICA_SESSIONS.filter(([k]) => r[k]).map(([k, name]) => ({ kind: KIND[name], name, start: Date.parse(`${r[k].date}T${r[k].time || "12:00:00Z"}`) }));
      list.push({ kind: "race", name: "Race", start: raceAt });
      for (const s of list) s.end = s.start + LENGTH[s.kind] * 60000;
    }
    list.sort((a, b) => a.start - b.start);
    for (const s of list) s.short = SHORT[s.name] || s.name;
    const loc = r.Circuit.Location || {};
    return {
      round: +r.round, name: fixText(r.raceName), circuit: fixText(r.Circuit.circuitName), circuitId: r.Circuit.circuitId,
      locality: fixText(loc.locality), country: fixText(loc.country), lat: +loc.lat, lon: +loc.long,
      flag: m.country_flag || "", circuitKey: m.circuit_key || null, meetingKey: m.meeting_key || null, circuitImage: m.circuit_image || "",
      start: list[0].start, end: list[list.length - 1].end, sprint: list.some(s => s.kind === "sprint"), sessions: list
    };
  });
  return { year, rounds };
}

export const allSessions = rounds => rounds.flatMap(r => r.sessions.map(s => ({ ...s, round: r })));
// on track now (from 15 minutes before the start to 30 after the end)
export const liveSession = (rounds, t = Date.now()) => allSessions(rounds).find(s => t >= s.start - 15 * 60000 && t <= s.end + 30 * 60000) || null;
export const nextSession = (rounds, t = Date.now()) => allSessions(rounds).filter(s => s.start > t).sort((a, b) => a.start - b.start)[0] || null;
export const lastSession = (rounds, t = Date.now()) => allSessions(rounds).filter(s => s.end < t && s.key).sort((a, b) => b.end - a.end)[0] || null;
export const nextRound = (rounds, t = Date.now()) => rounds.find(r => r.end > t) || null;
export const lastRace = (rounds, t = Date.now()) => [...rounds].reverse().find(r => r.sessions.some(s => s.kind === "race" && s.end < t)) || null;

// the season that's on: this year's, or next year's once this one is over and the new calendar is out
export async function currentSeason() {
  const y = new Date().getFullYear(), s = await season(y);
  if (s.rounds.length && s.rounds.some(r => r.end > Date.now())) return s;
  try { const n = await season(y + 1); if (n.rounds.length) return n; } catch (e) {}
  return s;
}

// the drivers of the latest race or qualifying: number, three-letter name, names, team, team colour, photo link
let roster = null;
export function drivers() {
  return roster = roster || (async () => {
    const s = await season(new Date().getFullYear());
    const done = allSessions(s.rounds).filter(x => x.key && x.end < Date.now() && (x.kind === "race" || x.kind === "q")).sort((a, b) => b.end - a.end)[0];
    let list = done ? await of1(`drivers?session_key=${done.key}`, { ttl: 6 * 3600000 }) : [];
    if (!list.length) list = await of1(`drivers?session_key=latest`, { ttl: 3600000 });
    return list.map(d => ({
      num: String(d.driver_number), tla: d.name_acronym, first: d.first_name, last: d.last_name, full: d.full_name,
      team: d.team_name, colour: hex(d.team_colour), headshot: d.headshot_url, year: s.year,
      // the shape photo() expects
      HeadshotUrl: d.headshot_url, FirstName: d.first_name, LastName: d.last_name, TeamName: d.team_name
    }));
  })().catch(e => { roster = null; throw e; });
}
// Jolpica's team names differ from F1's own ("RB F1 Team" vs "Racing Bulls"): match a Jolpica team by its drivers' codes
export const teamOfCode = (list, code) => (list.find(d => d.tla === code) || {}).team || null;
