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

for (const w of warnings) console.warn(`warning: ${w}`);
if (problems.length) { console.error(problems.map(p => `✗ ${p}`).join("\n\n")); process.exit(1); }
console.log(`OK: ${modules.length} modules and ${classic.length} classic scripts parse, ${views.length} route pages exist, manifest fine.`);
