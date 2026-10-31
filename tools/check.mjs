// Catches mistakes before publishing: a syntax error in any script, a page missing for a route,
// or a broken app manifest. Run: node tools/check.mjs   (exit 1 when something is wrong)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = f => readFileSync(join(ROOT, f), "utf8");
const problems = [], warnings = [];
const brief = s => String(s).split("\n").filter(l => !/^\s+at |^Node\.js v/.test(l)).join("\n").trim();   // the error and where, not node's internals
const walk = dir => !existsSync(join(ROOT, dir)) ? [] : readdirSync(join(ROOT, dir), { withFileTypes: true })
  .flatMap(d => d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.m?js$/.test(d.name) ? [`${dir}/${d.name}`] : []);

// 1. modules: node --check on a .mjs copy, so .js files parse as ES modules too (imports aren't followed)
const tmp = mkdtempSync(join(tmpdir(), "f1check-"));
const modules = ["js", "scripts", "tools"].flatMap(walk);
modules.forEach((f, i) => {
  const copy = join(tmp, `m${i}.mjs`);
  writeFileSync(copy, read(f));
  try { execFileSync(process.execPath, ["--check", copy], { stdio: "pipe" }); }
  catch (e) { problems.push(brief(String(e.stderr).split(copy).join(f))); }
});
rmSync(tmp, { recursive: true, force: true });

// 2. classic scripts: the service worker and index.html's inline scripts (compiled, not run)
const classic = existsSync(join(ROOT, "sw.js")) ? [["sw.js", read("sw.js")]] : [];
[...read("index.html").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => classic.push([`index.html inline script ${i + 1}`, m[1]]));
for (const [name, code] of classic) { try { new vm.Script(code, { filename: name }); } catch (e) { problems.push(brief(e.stack)); } }

// 3. every page named in main.js's ROUTES has its module
const routes = /const ROUTES = \[([\s\S]*?)\n\];/.exec(read("js/main.js"));
const views = routes ? [...new Set([...routes[1].matchAll(/,\s*"([\w-]+)"\s*\]/g)].map(m => m[1]))] : [];
if (!views.length) problems.push("js/main.js: couldn't find the ROUTES list");
for (const v of views) if (!existsSync(join(ROOT, "js/views", `${v}.js`))) problems.push(`js/main.js: route page "${v}" has no js/views/${v}.js`);

// 4. the app manifest parses and its icons exist; files the service worker pre-caches exist (a warning: it skips missing ones)
try {
  const man = JSON.parse(read("manifest.webmanifest"));
  for (const ic of man.icons || []) if (!existsSync(join(ROOT, ic.src))) problems.push(`manifest.webmanifest: missing icon ${ic.src}`);
} catch (e) { problems.push(`manifest.webmanifest: ${e.message}`); }
const shell = existsSync(join(ROOT, "sw.js")) && /const SHELL = \[([\s\S]*?)\];/.exec(read("sw.js"));
if (shell) for (const [, f] of shell[1].matchAll(/"([^"]+)"/g)) if (f !== "./" && !existsSync(join(ROOT, f))) warnings.push(`sw.js pre-caches ${f}, which doesn't exist`);

// 5. the live map's tracker (js/livepos.js): a car with known mini-sector times (10, 30, 10, 30, 20 s) and on-time marks
{
  const { liveTracker } = await import(new URL("../js/livepos.js", import.meta.url));
  const DUR = [10, 30, 10, 30, 20].map(s => s * 1000), END = [0.1, 0.4, 0.5, 0.8, 1], tr = liveTracker();
  const truth = t => { const r = t % 100000; let acc = 0; for (let k = 0; ; k++) { if (r < acc + DUR[k]) return (k ? END[k - 1] : 0) + (END[k] - (k ? END[k - 1] : 0)) * (r - acc) / DUR[k]; acc += DUR[k]; } };
  const marks = []; for (let lap = 0, at = 0; lap < 4; lap++) DUR.forEach((d, k) => marks.push({ t: at += d, n: k + 1, lap }));
  let worst = 0, back = 0, prev = null, mi = 0; tr.mark("1", 0, 5, 0, 0);
  for (let t = 0; t < 390000; t += 1000 / 60) {
    while (mi < marks.length && marks[mi].t <= t) { const m = marks[mi++]; tr.mark("1", m.n, 5, m.t, m.lap ? 100000 : 0); if (m.n === 5) tr.mark("1", 0, 5, m.t, 100000); }
    const f = tr.place("1", t, 1000 / 60);
    if (t > 210000) { worst = Math.max(worst, Math.abs(((f - truth(t)) % 1 + 1.5) % 1 - 0.5)); if (prev != null && ((f - prev + 1.5) % 1 - 0.5) < -1e-9) back++; }
    prev = f;
  }
  if (tr.ends.map(v => v.toFixed(3)).join() !== "0.100,0.400,0.500,0.800") problems.push(`js/livepos.js: learned mini-sector ends ${tr.ends.join()} (want 0.1,0.4,0.5,0.8)`);
  if (worst > 0.001 || back) problems.push(`js/livepos.js: ${(worst * 100).toFixed(2)}% of a lap off, ${back} frames backwards (want under 0.1%, none)`);
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (problems.length) { console.error(problems.map(p => `✗ ${p}`).join("\n\n")); process.exit(1); }
// 6. a source that can't be reached (OpenF1 during a session looks like this to a browser) must not keep pages waiting: one
// more try, then the last saved answer however old, and no more asking for a minute
{
  const kept = new Map([["f1c:https://api.openf1.org/v1/sessions?year=1", JSON.stringify({ t: 1, v: ["old"] })], ["f1c:https://api.jolpi.ca/ergast/f1/1.json?limit=100", JSON.stringify({ t: 1, v: ["old"] })]]);
  let asked = 0;
  globalThis.localStorage = { getItem: k => kept.has(k) ? kept.get(k) : null, setItem: (k, v) => kept.set(k, v), removeItem: k => kept.delete(k) };
  globalThis.fetch = async () => { asked++; throw new TypeError("Failed to fetch"); };
  const { of1, jolpica, openF1Closed } = await import(new URL("../js/api.js", import.meta.url));
  const t0 = Date.now(), failed = p => p.then(() => false, () => true);
  const a = await of1("sessions?year=1", { ttl: 1000 }), j = await jolpica("1.json", { ttl: 1000 });
  if (a[0] !== "old" || j[0] !== "old") problems.push("js/api.js: the last saved answer isn't used when a source can't be reached");
  if (!openF1Closed()) problems.push("js/api.js: OpenF1 isn't treated as closed when it can't be reached");
  const before = asked;
  if (!(await failed(of1("meetings?year=1"))) || !(await failed(jolpica("2.json")))) problems.push("js/api.js: nothing saved and no source, but no failure");
  if (asked !== before) problems.push("js/api.js: still asking a source that can't be reached");
  if (Date.now() - t0 > 5000) problems.push(`js/api.js: pages waited ${Date.now() - t0} ms for a source that can't be reached`);
  delete globalThis.localStorage; delete globalThis.fetch;
}
console.log(`OK: ${modules.length} modules and ${classic.length} classic scripts parse, ${views.length} route pages exist, manifest fine, live tracker right, unreachable sources don't hold pages up.`);
process.exit(0);   // (js/api.js's cache timers would otherwise keep this running for minutes)
