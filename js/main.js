// The app: navigation between pages (by the address's #/…), the top bar, and the bottom tabs.
import { $, $$, ICONS, store } from "./util.js";
import { busy } from "./api.js";
import { watch as cutOut2023 } from "./cutout.js";

cutOut2023();   // 2023's driver photos and team logos, cut out from their backgrounds as they appear

// each page is a module: export default { title, tab, mount(el, params, app) → optional clean-up function }
const ROUTES = [
  [/^\/?$/, "home"],
  [/^\/live$/, "live"],
  [/^\/calendar$/, "calendar"],
  [/^\/calendar\/(\d{4})\/(\d+)(?:\/(\d+))?$/, "weekend"],   // …/KEY: that session's full result, scrolled to
  [/^\/standings(?:\/(drivers|teams))?$/, "standings"],
  [/^\/driver\/([\w-]+)$/, "driver"],
  [/^\/team\/([\w-]+)$/, "team"],
  [/^\/replay$/, "replay"],
  [/^\/replay\/(\d+)$/, "replay"],
  [/^\/result\/(\d+)$/, "result"],
  [/^\/battle(?:\/(\d+)(?:\/(\d+)\/(\d+))?)?$/, "battle"],
  [/^\/news$/, "news"],
  [/^\/settings$/, "settings"]
];
// bottom tabs on a phone; the side menu on a computer has these plus the rest
const TABS = [["home", "#/", "Home"], ["live", "#/live", "Live"], ["calendar", "#/calendar", "Calendar"], ["standings", "#/standings", "Standings"], ["battle", "#/battle", "Lap battle"]];
const MORE = [["news", "#/news", "News"], ["settings", "#/settings", "Settings"]];

const link = ([id, href, label]) => `<a href="${href}" data-tab="${id}">${ICONS[id]}<span>${label}</span></a>`;
$("#tabbar").innerHTML = TABS.map(([id, href, label]) => link([id, href, id === "battle" ? "Battle" : label])).join("");   // short label for the phone's tab
$("#railLinks").innerHTML = TABS.map(link).join("") + `<hr>` + MORE.map(link).join("");
$("#back").innerHTML = ICONS.back;
// setBack("back"): the arrow goes back to wherever you came from (the home page if you opened the link directly)
let cameFrom = false;
$("#back").addEventListener("click", e => { if ($("#back").dataset.history && cameFrom) { e.preventDefault(); history.back(); } });

// what a page can change in the frame around it
const app = {
  setTitle(text) { $("#title").textContent = text; document.title = text && text !== "F1 Live" ? `${text} · F1 Live` : "F1 Live"; },
  setBack(href) {
    $("#back").hidden = !href;
    if (href === "back") { $("#back").href = "#/"; $("#back").dataset.history = "1"; }
    else { delete $("#back").dataset.history; if (href) $("#back").href = href; }
  },
  setTools(html) { $("#tools").innerHTML = html || ""; return $("#tools"); },
  go(hash) { location.hash = hash; },
  toast
};

// a page's own stylesheet (index.html: <link data-pages="…">), switched on once it has arrived; a file that fails to load
// doesn't stop the page. Home and Settings need none: app.css has everything they use.
const pageStyles = name => Promise.all($$("link[data-pages]").filter(l => l.dataset.pages.split(" ").includes(name)).map(l => new Promise(done => {
  const on = () => { l.media = "all"; done(); };
  if (l.dataset.ready) on();
  else { l.addEventListener("load", on, { once: true }); l.addEventListener("error", on, { once: true }); }
})));

let current = null, token = 0, routed = 0;
async function route() {
  // links from the LINE cards: ?replay=KEY opens that replay, ?result=KEY that session's weekend with its results, ?live the Live tab
  const q = new URLSearchParams(location.search), keep = q.get("feed") ? `?feed=${encodeURIComponent(q.get("feed"))}` : "";
  if (q.get("replay") && !location.hash) history.replaceState(null, "", location.pathname + keep + `#/replay/${q.get("replay")}`);
  else if (q.get("result") && !location.hash) history.replaceState(null, "", location.pathname + keep + `#/result/${q.get("result")}`);
  else if (q.has("live") && !location.hash) history.replaceState(null, "", location.pathname + keep + "#/live");
  cameFrom = routed++ > 0;   // an earlier page of this site is behind us in the history
  const path = location.hash.replace(/^#/, "") || "/";
  let name = "home", params = [];
  for (const [re, n] of ROUTES) { const m = re.exec(path); if (m) { name = n; params = m.slice(1); break; } }
  const mine = ++token;
  if (current && current.cleanup) try { current.cleanup(); } catch (e) { console.error(e); }
  current = null;
  const view = document.createElement("div");
  view.className = "view view-" + name;
  $("#view").replaceChildren(view);
  app.setBack(null); app.setTools(""); window.scrollTo(0, 0);
  let mod;
  try { mod = (await Promise.all([import(`./views/${name}.js`), pageStyles(name)]))[0].default; }
  catch (e) { console.error(e); view.innerHTML = `<div class="card"><p class="note-line">This page couldn't load. Reload to try again.</p></div>`; return; }
  if (mine !== token) return;
  app.setTitle(mod.title || "F1 Live");
  const tab = mod.tab || name;
  for (const a of $$("[data-tab]")) a.classList.toggle("on", a.dataset.tab === tab);
  try { current = { cleanup: await mod.mount(view, params, app) }; }
  catch (e) { console.error(e); if (mine === token) view.innerHTML = `<div class="card"><p class="note-line">Something went wrong loading this page. Try again in a minute.</p></div>`; }
  if (mine !== token && current && current.cleanup) { current.cleanup(); current = null; }
}
addEventListener("hashchange", route);
route();

// a small note when a data source makes us wait
const waiting = new Set();
busy.addEventListener("busy", e => {
  const { source, waiting: w } = e.detail;
  w ? waiting.add(source) : waiting.delete(source);
  $("#busy").hidden = !waiting.size;
  $("#busy").textContent = waiting.size ? `${[...waiting].join(" and ")} ${waiting.size > 1 ? "are" : "is"} busy, waiting a moment…` : "";
});

// pop-up notes at the top (race control messages, "link copied", …)
export function toast(html, { ms = 8000, cls = "" } = {}) {
  const box = $("#toasts"), el = document.createElement("div");
  el.className = "toast " + cls;
  el.innerHTML = `${html}<button class="x" type="button" aria-label="Dismiss">✕</button>`;
  el.querySelector(".x").addEventListener("click", () => el.remove());
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => el.classList.add("out"), ms); setTimeout(() => el.remove(), ms + 400);
  return el;
}

// appearance follows the device when asked to
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (store.get("f1.theme", "dark") === "device") setTheme("device");
});
export function setTheme(pick) {
  store.set("f1.theme", pick);
  const dark = pick === "dark" || (pick === "device" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
  $('meta[name="theme-color"]').content = dark ? "#0b0b10" : "#eef0f4";
  dispatchEvent(new Event("themechange"));
}
setTheme(store.get("f1.theme", "dark"));

// install as an app (and work offline for pages already seen)
if ("serviceWorker" in navigator && location.protocol === "https:") {
  // a new release took over: load it now instead of running the old code until the next visit (not in the middle of a session or a film)
  const updating = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (updating && !/^#\/(live|replay|battle)/.test(location.hash)) location.reload(); });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
