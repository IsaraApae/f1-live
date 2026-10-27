// Every free data source, with caching and OpenF1's rate limit handled in one place.
//   OpenF1  (api.openf1.org): sessions, laps, positions, telemetry, race control...  3 requests a second, 30 a minute
//   Jolpica (api.jolpi.ca):   the calendar, standings and results (Ergast's successor)
//   Open-Meteo:               weather forecasts at the circuit
import { sleep } from "./util.js";

export const OPENF1 = "https://api.openf1.org/v1";
export const JOLPICA = "https://api.jolpi.ca/ergast/f1";

// tell the page when a source makes us wait ("OpenF1 is busy…")
export const busy = new EventTarget();
const say = (source, waiting) => busy.dispatchEvent(new CustomEvent("busy", { detail: { source, waiting } }));

const memory = new Map();   // url -> promise of the parsed answer
function saved(url, ttl) {   // a recent answer kept in the browser, so reopening the site is quick
  if (!ttl) return null;
  try { const x = JSON.parse(localStorage.getItem("f1c:" + url)); if (x && Date.now() - x.t < ttl) return x.v; } catch (e) {}
  return null;
}
function save(url, v) {
  try { const s = JSON.stringify({ t: Date.now(), v }); if (s.length < 400000) localStorage.setItem("f1c:" + url, s); } catch (e) { clearSaved(); }
}
function clearSaved() { try { for (const k of Object.keys(localStorage)) if (k.startsWith("f1c:")) localStorage.removeItem(k); } catch (e) {} }
export function clearCache() { clearSaved(); try { caches.delete(DATA); } catch (e) {} }   // (Settings: the finished sessions too)

// OpenF1: one request at a time, at most 3 a second and 28 a minute; "too many" means wait and try again
const starts = [];
let queue = Promise.resolve();
function slot() {
  const run = queue.then(async () => {
    for (;;) {
      const t = Date.now();
      while (starts.length && t - starts[0] > 60000) starts.shift();
      const gap = starts.length ? 360 - (t - starts[starts.length - 1]) : 0;
      const full = starts.length >= 28 ? 60000 - (t - starts[0]) + 50 : 0;
      const wait = Math.max(gap, full);
      if (wait <= 0) break;
      if (full > 0) say("OpenF1", true);
      await sleep(wait);
    }
    starts.push(Date.now());
  });
  queue = run.catch(() => {});
  return run;
}
// OpenF1's free data is between sessions: while one is live it refuses free requests (401/403). That isn't "busy": stop
// asking for a few minutes, without the banner (the live timing itself comes from F1's feed, not OpenF1)
let closedUntil = 0;
async function getOpenF1(url) {
  for (let i = 0, waited = 0; waited < 120000; i++) {
    if (Date.now() < closedUntil) throw new Error("OpenF1 is closed during a live session");
    await slot();
    let r; try { r = await fetch(url); } catch (e) { r = null; }
    if (r && r.ok) { say("OpenF1", false); return r.json(); }
    if (r && (r.status === 404 || r.status === 422)) return [];
    const why = r && !r.ok && r.status !== 429 ? await r.text().catch(() => "") : "";
    if (r && (r.status === 401 || r.status === 403 || /live|sponsor|subscri|authenticat|token/i.test(why))) {
      closedUntil = Date.now() + 5 * 60000; say("OpenF1", false); throw new Error("OpenF1 is closed during a live session");
    }
    const pause = r && r.status === 429 ? Math.min(20000, 1000 * (+r.headers.get("Retry-After") || 8)) : 2000 * (i + 1);
    say("OpenF1", true);
    await sleep(pause); waited += pause;
  }
  say("OpenF1", false);
  throw new Error("OpenF1 didn't answer");
}
// a finished session's data never changes: kept for good in the browser's cache storage (room for a replay's laps and
// positions, which are too big for localStorage), so a replay opened again loads at once. The last 250 answers are kept.
const DATA = "f1data";
async function stored(url) { try { const r = await (await caches.open(DATA)).match(url); return r ? r.json() : null; } catch (e) { return null; } }
async function keepForGood(url, v) {
  try {
    const c = await caches.open(DATA); await c.put(url, new Response(JSON.stringify(v)));
    const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - 250))) await c.delete(k);   // oldest first
  } catch (e) {}
}
// path like "laps?session_key=9999"; ttl (ms) keeps the answer in the browser that long; forever: a finished session's
export function of1(path, { ttl = 0, forever = false } = {}) {
  const url = `${OPENF1}/${path}`;
  if (memory.has(url)) return memory.get(url);
  const kept = saved(url, ttl);
  const p = kept ? Promise.resolve(kept)
    : forever ? stored(url).then(v => v || getOpenF1(url).then(v => { keepForGood(url, v); return v; }))
    : getOpenF1(url).then(v => { if (ttl) save(url, v); return v; });
  memory.set(url, p);
  p.catch(() => memory.delete(url));
  if (!ttl) setTimeout(() => memory.delete(url), 5 * 60000);   // live-ish data: ask again later
  return p;
}

async function getJSON(url, source) {
  for (let i = 0; i < 4; i++) {
    let r; try { r = await fetch(url); } catch (e) { r = null; }
    if (r && r.ok) { say(source, false); return r.json(); }
    if (r && r.status === 404) return null;
    say(source, true);
    await sleep(r && r.status === 429 ? 5000 : 1500 * (i + 1));
  }
  say(source, false);
  throw new Error(`${source} didn't answer`);
}
// path like "2026/driverStandings.json"
export function jolpica(path, { ttl = 10 * 60000 } = {}) {
  const url = `${JOLPICA}/${path}${path.includes("?") ? "&" : "?"}limit=100`;
  if (memory.has(url)) return memory.get(url);
  const kept = saved(url, ttl);
  const p = kept ? Promise.resolve(kept) : getJSON(url, "Jolpica").then(v => { save(url, v); return v; });
  memory.set(url, p);
  p.catch(() => memory.delete(url));
  setTimeout(() => memory.delete(url), ttl);
  return p;
}

// hourly forecast for the next 16 days at a place: { time: [ms], rain: [%], temp: [°C], wind: [km/h], code: [WMO weather code] }
export async function forecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,temperature_2m,wind_speed_10m,weather_code&timezone=UTC&forecast_days=16`;
  if (!memory.has(url)) {
    const p = getJSON(url, "Open-Meteo").then(v => v && v.hourly ? {
      time: v.hourly.time.map(t => Date.parse(t + "Z")), rain: v.hourly.precipitation_probability, temp: v.hourly.temperature_2m,
      wind: v.hourly.wind_speed_10m, code: v.hourly.weather_code } : null);
    memory.set(url, p); p.catch(() => memory.delete(url));
    setTimeout(() => memory.delete(url), 30 * 60000);
  }
  return memory.get(url);
}
// the forecast for a stretch of time: highest chance of rain, average temperature, strongest wind, the most common sky
export function forecastFor(f, from, to) {
  if (!f) return null;
  const idx = f.time.map((t, i) => [t, i]).filter(([t]) => t >= from - 1800000 && t <= to + 1800000).map(([, i]) => i);
  if (!idx.length) return null;
  const pick = a => idx.map(i => a[i]).filter(v => v != null);
  const rain = pick(f.rain), temp = pick(f.temp), wind = pick(f.wind), codes = pick(f.code);
  const most = codes.sort((a, b) => codes.filter(x => x === b).length - codes.filter(x => x === a).length)[0];
  return { rain: rain.length ? Math.max(...rain) : null, temp: temp.length ? temp.reduce((a, b) => a + b, 0) / temp.length : null,
           wind: wind.length ? Math.max(...wind) : null, sky: sky(most) };
}
// WMO weather codes in a word, with a matching emoji-free icon name
export function sky(code) {
  if (code == null) return { label: "", kind: "" };
  if (code === 0) return { label: "Clear", kind: "sun" };
  if (code <= 2) return { label: "Partly cloudy", kind: "cloud-sun" };
  if (code === 3) return { label: "Cloudy", kind: "cloud" };
  if (code <= 48) return { label: "Fog", kind: "cloud" };
  if (code <= 57) return { label: "Drizzle", kind: "rain" };
  if (code <= 67) return { label: "Rain", kind: "rain" };
  if (code <= 77) return { label: "Snow", kind: "cloud" };
  if (code <= 82) return { label: "Showers", kind: "rain" };
  return { label: "Thunderstorm", kind: "storm" };
}
