// F1 headlines for any page. news.json is built by scripts/news.mjs each time the site is published (every 30 minutes).
// loadNews() → { updated: ms, items: [{ title, link, source, at: ms }] } newest first, or null when there's none (yet).
let kept = null, keptAt = 0;
const TTL = 10 * 60000;
const good = i => i && typeof i.title === "string" && typeof i.source === "string" && /^https?:\/\//.test(i.link) && Number.isFinite(i.at);

export async function loadNews() {
  if (kept && Date.now() - keptAt < TTL) return kept;
  keptAt = Date.now();
  // relative to the page, so it works under any folder; "no-cache" asks the server whether there's a newer list
  const p = kept = fetch("news.json", { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null)
    .then(d => d && Array.isArray(d.items) ? { updated: +d.updated || 0, items: d.items.filter(good).sort((a, b) => b.at - a.at) } : null)
    .catch(() => null);
  p.then(d => { if (!d && kept === p) kept = null; });   // nothing to keep: ask again next time
  return p;
}
