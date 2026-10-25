// Service worker: lets the site install as an app and open without a connection.
//   the app's own files (js, css, icons, manifest): from the cache, fetched once per release
//   pages and news.json: the network first, the saved copy when offline
//   anything from another site (OpenF1, Jolpica, F1 live timing, photos, fonts): not touched, so live data is always live
const VERSION = "dev";   // the publish job writes the commit here, so every release gets a fresh cache
const CACHE = "f1live-" + VERSION;
const SHELL = [
  "./", "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png",
  "css/app.css", "css/timing.css", "css/calendar.css", "css/standings.css", "css/battle.css", "css/news.css",
  "js/main.js", "js/util.js", "js/api.js", "js/season.js", "js/news.js", "js/timing.js", "js/analysis.js", "js/stats.js", "js/calendar-ui.js", "js/geomap.js", "js/car3d.js", "js/cutout.js",
  "js/views/home.js", "js/views/live.js", "js/views/calendar.js", "js/views/weekend.js", "js/views/standings.js", "js/views/driver.js",
  "js/views/team.js", "js/views/replay.js", "js/views/battle.js", "js/views/news.js", "js/views/settings.js"
];
const STATIC = /\.(?:js|css|svg|png|webmanifest|woff2?)$/;

self.addEventListener("install", e => {
  // "reload" skips the browser's HTTP cache, so a release never stores yesterday's files; a missing file is skipped, not fatal
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  // only our own old caches: other sites on the same github.io origin keep theirs
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("f1live-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate" || url.pathname.endsWith("/news.json")) e.respondWith(networkFirst(req, url));
  else if (STATIC.test(url.pathname)) e.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE), hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE), key = url.origin + url.pathname;   // one copy per page, whatever its ?query
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    return (await cache.match(key)) || (req.mode === "navigate" && await cache.match("./")) || Response.error();
  }
}
