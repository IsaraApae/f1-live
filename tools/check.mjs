// Syntax-checks every inline <script> in index.html, so a typo can't break the page.
// Run: node tools/check.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) { console.error("no <script> found in index.html"); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), "f1check-"));
let failed = false;
scripts.forEach((code, i) => {
  const file = join(dir, `script${i + 1}.js`);
  writeFileSync(file, code);
  try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); }
  catch (e) { failed = true; console.error(`script ${i + 1}:\n${e.stderr}`); }
});
rmSync(dir, { recursive: true, force: true });
if (failed) process.exit(1);
console.log(`OK: ${scripts.length} scripts parse`);
