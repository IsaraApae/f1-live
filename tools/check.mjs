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
// …and each page stylesheet in index.html exists and names real pages (a typo would leave that page unstyled)
for (const [, href, pages] of read("index.html").matchAll(/<link[^>]*href="([^"]+)"[^>]*data-pages="([^"]*)"/g)) {
  if (!existsSync(join(ROOT, href))) problems.push(`index.html: page stylesheet ${href} doesn't exist`);
  for (const p of pages.split(" ")) if (!views.includes(p)) problems.push(`index.html: ${href} is for "${p}", which isn't a page in main.js's ROUTES`);
}

// 4. the app manifest parses and its icons exist; files the service worker pre-caches exist (a warning: it skips missing ones)
try {
  const man = JSON.parse(read("manifest.webmanifest"));
  for (const ic of man.icons || []) if (!existsSync(join(ROOT, ic.src))) problems.push(`manifest.webmanifest: missing icon ${ic.src}`);
} catch (e) { problems.push(`manifest.webmanifest: ${e.message}`); }
const shell = existsSync(join(ROOT, "sw.js")) && /const SHELL = \[([\s\S]*?)\];/.exec(read("sw.js"));
if (shell) for (const [, f] of shell[1].matchAll(/"([^"]+)"/g)) if (f !== "./" && !existsSync(join(ROOT, f))) warnings.push(`sw.js pre-caches ${f}, which doesn't exist`);
// …and it pre-caches every script and stylesheet the site has: one left out isn't there offline after the next release (a
// replay's timing screen imports js/livepos.js, so without it no saved replay opens offline)
if (shell) { const cached = new Set([...shell[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
  for (const f of [...walk("js"), ...readdirSync(join(ROOT, "css")).filter(n => n.endsWith(".css")).map(n => `css/${n}`)]) if (!cached.has(f)) problems.push(`sw.js: SHELL leaves out ${f}, so it isn't there offline`); }

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

// 5b. a yellow race control never cleared by name (Brazil 2026, sector 15) ends at the chequered flag
// (timing.js needs a browser to load: its flagState is one self-contained function, so it's tried on its own)
{
  const src = (/export function flagState[\s\S]*?\n}\r?\n/.exec(read("js/timing.js")) || [""])[0].replace(/^export function flagState/, "function");
  const flagState = src && vm.runInNewContext(`(${src})`);
  if (!flagState) problems.push("tools/check.mjs: couldn't find flagState in js/timing.js");
  else {
    const msg = (Message, Flag, Sector) => ({ Message, Flag, Sector, Scope: Sector ? "Sector" : "Track", Category: "Flag" });
    const run = [msg("DOUBLE YELLOW IN TRACK SECTOR 14", "DOUBLE YELLOW", 14), msg("DOUBLE YELLOW IN TRACK SECTOR 15", "DOUBLE YELLOW", 15),
                 msg("CLEAR IN TRACK SECTOR 14", "CLEAR", 14)];
    if (JSON.stringify(flagState(run).yellow) !== '{"15":2}') problems.push("js/timing.js flagState: sector 15 should still be double yellow before the flag");
    const after = flagState([...run, msg("CHEQUERED FLAG", "CHEQUERED")]);
    if (Object.keys(after.yellow).length || after.status !== "1") problems.push(`js/timing.js flagState: yellows left after the chequered flag: ${JSON.stringify(after.yellow)}`);
  }
}

// 5c. what comes from elsewhere (F1's feed; OpenF1 in a replay) can't bring markup onto the page or reach every object on it:
// a team colour is hex digits or it's grey (js/util.js: hex), and a change filed under "__proto__" or "constructor" is left
// out (js/timing.js: merge, tried on its own like flagState)
{
  const { hex, tagVars } = await import(new URL("../js/util.js", import.meta.url));
  for (const c of ['fff" onmouseover="x', 'fff"><img src=x onerror=alert(1)>', "red;background:url(//x)", "27F4D2 ", "27F4D", 123456, null, undefined, { toString: () => "ffffff" }])
    if (hex(c) !== "#777777") problems.push(`js/util.js hex: ${JSON.stringify(c)} came through as ${hex(c)}`);
  if (hex("27F4D2") !== "#27F4D2" || hex("#27f4d2") !== "#27f4d2") problems.push("js/util.js hex: an ordinary team colour didn't come through as it is");
  if (/["<>]/.test(tagVars('fff"><i>'))) problems.push("js/util.js tagVars: a colour can close its attribute");
  const src = (/\nfunction merge[\s\S]*?\n}\r?\n/.exec(read("js/timing.js")) || [""])[0];
  if (!src) problems.push("tools/check.mjs: couldn't find merge in js/timing.js");
  else {
    const got = vm.runInNewContext(`${src}
      const t = merge({ a: { b: 1 } }, JSON.parse('{"__proto__":{"p1":1},"constructor":{"prototype":{"p2":1}},"a":{"__proto__":{"p3":1},"c":2},"_kf":true}'));
      JSON.stringify([({}).p1, ({}).p2, ({}).p3, t.a.b, t.a.c, "_kf" in t])`);
    if (got !== "[null,null,null,1,2,false]") problems.push(`js/timing.js merge: a change under "__proto__" or "constructor" reached every object, or an ordinary change was lost: ${got}`);
  }
}

// 6. the publish's release stamp (tools/stamp.mjs) fits index.html: an import map naming every module, before any module
// loads, and every script and preload tag at the release's address (else a publish would go out with plain addresses)
try {
  const { stampHtml, modules: mods } = await import(new URL("./stamp.mjs", import.meta.url));
  const out = stampHtml(read("index.html"), mods(ROOT), "0123456789ab"), files = mods(ROOT);
  const map = JSON.parse((/<script type="importmap">([^<]*)<\/script>/.exec(out) || [])[1] || "{}").imports || {};
  const missing = files.filter(f => map[`./${f}`] !== `./${f}?v=0123456789ab`);
  if (missing.length) problems.push(`tools/stamp.mjs: the import map leaves out ${missing.join(", ")}`);
  if (out.indexOf('type="importmap"') > out.search(/modulepreload|type="module"/)) problems.push("tools/stamp.mjs: the import map comes after a module is asked for");
  for (const m of out.matchAll(/<(?:link rel="modulepreload" href|script type="module" src)="(js\/[^"]+)"/g)) if (!m[1].endsWith("?v=0123456789ab")) problems.push(`tools/stamp.mjs: ${m[1]} has no release address`);
  // …and every stylesheet, with the inline script's preload of a page's stylesheet at the same address (else it's fetched twice)
  const sheets = [...out.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  if (!sheets.length) problems.push("tools/stamp.mjs: found no stylesheets in index.html");
  for (const s of sheets) if (!s.endsWith("?v=0123456789ab")) problems.push(`tools/stamp.mjs: ${s} has no release address`);
  if (!/"css\/" \+ css \+ "\.css" \+ \(v \? "\?v=" \+ v : ""\)/.test(out)) problems.push("index.html: the inline script's stylesheet preload doesn't carry the release (v)");
  [...out.matchAll(/<script(?![^>]*\b(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => { try { new vm.Script(m[1]); } catch (e) { problems.push(`stamped index.html inline script ${i + 1}: ${e.message}`); } });
} catch (e) { problems.push(`tools/stamp.mjs: ${e.message}`); }

// 7. a source that can't be reached (OpenF1 during a session looks like this to a browser) must not keep pages waiting: one
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

// (after the last check: 7's problems used to be found after this had already said OK)
for (const w of warnings) console.warn(`warning: ${w}`);
if (problems.length) { console.error(problems.map(p => `✗ ${p}`).join("\n\n")); process.exit(1); }
console.log(`OK: ${modules.length} modules and ${classic.length} classic scripts parse, ${views.length} route pages exist, manifest fine, live tracker right, colours and feed changes can't carry markup, unreachable sources don't hold pages up.`);
process.exit(0);   // (js/api.js's cache timers would otherwise keep this running for minutes)
