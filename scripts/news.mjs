// Collects F1 headlines from publishers' RSS feeds into news.json (headline, link, source, time only: the site links out).
// Run: node scripts/news.mjs [out.json]   (Node 22+, no packages). Exits 1 only when every feed fails.
// If out.json already exists (the publish job downloads the live copy first), its times are reused for
// items whose feed gives no date, so they keep their first-seen time instead of jumping to "just now".
import { readFileSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] || new URL("../news.json", import.meta.url);
const KEEP = 80, PER_SOURCE = 30;   // a cap per source so one busy feed can't fill the whole list
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const FEEDS = [
  { source: "Motorsport.com", url: "https://www.motorsport.com/rss/f1/news/" },
  { source: "Autosport", url: "https://www.autosport.com/rss/f1/news/" },
  { source: "Formula 1", url: "https://www.formula1.com/en/latest/all.xml" },
  // RaceFans covers every series: keep the F1 ones and drop its " | Section" title suffix
  { source: "RaceFans", url: "https://www.racefans.net/feed/", only: /\bF1\b|Formula 1|Grand Prix/i, trim: /\s+\|\s+[^|]+$/ },
  { source: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/formula1/rss.xml" }
];

const get = (url, ms = 15000) => fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" }, signal: AbortSignal.timeout(ms) })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });

// ---------- tiny XML reading ----------
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", pound: "£", euro: "€" };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(parseInt(e[1].toLowerCase() === "x" ? e.slice(2) : e.slice(1), e[1].toLowerCase() === "x" ? 16 : 10)) : NAMED[e.toLowerCase()] ?? m);
const text = s => decode((s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml); return m ? m[1] : ""; };
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map(m => text(m[1]));

function cleanLink(raw) {   // http(s) only, without tracking parameters
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|at_)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch (e) { return null; }
}

function parse(xml, feed) {
  const out = [];
  for (const [, block] of xml.matchAll(/<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi)) {
    let title = text(tag(block, "title"));
    if (feed.trim) title = title.replace(feed.trim, "");
    if (feed.only) { const cats = tags(block, "category"); if (cats.length && !cats.some(c => feed.only.test(c))) continue; }
    const href = /<link[^>]*href="([^"]+)"/i.exec(block), guid = /<guid[^>]*isPermaLink="true"[^>]*>([\s\S]*?)<\/guid>/i.exec(block);
    const link = cleanLink(text(tag(block, "link")) || (href && decode(href[1])) || (guid && text(guid[1])));
    const when = Date.parse(text(tag(block, "pubDate") || tag(block, "dc:date") || tag(block, "published") || tag(block, "updated")));
    if (title && link) out.push({ title: title.slice(0, 300), link, source: feed.source, at: Number.isFinite(when) ? when : null });
  }
  return out;
}

// a feed without dates (formula1.com): the article page says when it was published
async function pageDate(url) {
  try {
    const html = await get(url);
    const m = /"datePublished"\s*:\s*"([^"]+)"/.exec(html) || /article:published_time"\s+content="([^"]+)"/.exec(html);
    const t = m ? Date.parse(m[1]) : NaN;
    return Number.isFinite(t) ? t : null;
  } catch (e) { return null; }
}

// near-identical headlines (the same story on sister sites): compare their words
const words = t => new Set(t.toLowerCase().normalize("NFKD").replace(/[‘’']/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 2));
const same = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n || 1) >= 0.75; };

const now = Date.now();
let prev = new Map();
try { prev = new Map(JSON.parse(readFileSync(OUT, "utf8")).items.map(i => [i.link, i.at])); } catch (e) {}

const results = await Promise.all(FEEDS.map(async f => {
  try { const items = parse(await get(f.url), f); if (!items.length) throw new Error("no items"); return { f, items }; }
  catch (e) { console.log(`✗ ${f.source}: ${e.message}`); return { f, items: null }; }
}));
const ok = results.filter(r => r.items);
if (!ok.length) { console.log("Every feed failed; news.json left as it was."); process.exit(1); }

const all = ok.flatMap(r => r.items);
const undated = all.filter(i => i.at == null);
let lookups = 0;
await Promise.all(undated.map(async i => {
  i.at = prev.get(i.link) ?? (lookups++ < 15 ? await pageDate(i.link) : null) ?? now;
}));

all.sort((a, b) => b.at - a.at);
const kept = [], seen = [], per = {};
for (const i of all) {
  i.at = Math.min(i.at, now);   // a clock ahead of ours shouldn't show "in the future"
  const w = words(i.title);
  if ((per[i.source] || 0) >= PER_SOURCE || seen.some(s => same(w, s))) continue;
  seen.push(w); kept.push(i); per[i.source] = (per[i.source] || 0) + 1;
  if (kept.length >= KEEP) break;
}

writeFileSync(OUT, JSON.stringify({ updated: now, items: kept }));
for (const r of results) if (r.items) console.log(`✓ ${r.f.source}: ${r.items.length} in feed, ${per[r.f.source] || 0} kept`);
console.log(`${kept.length} headlines written${lookups ? ` (${Math.min(lookups, 15)} dates read from article pages)` : ""}.`);
