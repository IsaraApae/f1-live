// Gives each release's scripts their own addresses: js/util.js becomes js/util.js?v=<commit>, through an import map at the
// top of index.html, with the page's own script and preload tags carrying the same ?v=. Safari keeps module files in memory,
// even across a reload, so with one address for every release a new page's script could be joined to the last release's
// util.js (8 Nov 2026: the Calendar's import of f1img failed on iPhones until the app was closed). With an address per
// release, a reload always loads one release whole. Browsers without import maps (Safari before 16.4) load the plain
// addresses, as before.
// The stylesheets get the same ?v= on their own tags, so a page is never drawn by one release's scripts in the last one's
// styles: without it the outgoing service worker answered css/timing.css from its own cache while the scripts came new, and
// the Live tab, a replay or a lap battle (which don't reload for a new release) kept that mix until the next visit.
// Run in the folder that's published: node tools/stamp.mjs <release>   (rewrites index.html; exit 1 if anything didn't fit)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// the modules under dir, as "js/views/home.js"
export const modules = (root, dir = "js") => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap(d => d.isDirectory() ? modules(root, `${dir}/${d.name}`) : d.name.endsWith(".js") ? [`${dir}/${d.name}`] : []);

export function stampHtml(html, files, v) {
  if (!/^[\w.-]{1,40}$/.test(v || "")) throw new Error(`not a release name: ${v}`);
  const map = JSON.stringify({ imports: Object.fromEntries(files.map(f => [`./${f}`, `./${f}?v=${v}`])) });
  const steps = [   // [what, pattern, replacement]; each must be found
    ["the import map, before anything loads a module", /(<meta name="viewport"[^>]*>)/, `$1\n<script type="importmap">${map}</script>`],
    ["the modulepreload tags", /(<link rel="modulepreload" href="js\/[\w/.-]+\.js)"/g, `$1?v=${v}"`],
    ["the main script tag", /(<script type="module" src="js\/[\w/.-]+\.js)"/g, `$1?v=${v}"`],
    ["the stylesheets", /(<link rel="stylesheet" href="css\/[\w.-]+\.css)"/g, `$1?v=${v}"`],
    ["the inline script's preloads", /var v = "";/, `var v = "${v}";`]
  ];
  for (const [what, re, to] of steps) {
    if (!re.test(html)) throw new Error(`index.html: couldn't find ${what}`);
    re.lastIndex = 0; html = html.replace(re, to);
  }
  return html;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const v = process.argv[2], root = process.cwd();
  writeFileSync(join(root, "index.html"), stampHtml(readFileSync(join(root, "index.html"), "utf8"), modules(root), v));
  console.log(`index.html: ${modules(root).length} modules at ?v=${v}`);
}
