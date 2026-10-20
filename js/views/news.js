// News: the latest F1 headlines from publishers' feeds, newest first and grouped by day. Each opens on the publisher's site.
import { esc, ago, store, skeleton, ICONS } from "../util.js";
import { loadNews } from "../news.js";

// each source gets a colour from the app's palette (by name order, so it doesn't change with the filter)
const HUES = [["var(--blue)", "#fff"], ["var(--purple)", "#fff"], ["var(--red)", "#fff"], ["var(--amber)", "#000"], ["var(--green)", "#000"]];
const initials = s => (/^[A-Z0-9]{2,4}\b/.exec(s) || [])[0] || (s.match(/[A-Z0-9]/g) || [s[0] || "?"]).slice(0, 2).join("");
const when = t => `<time data-at="${t}">${esc(ago(t))}</time>`;

function dayLabel(t) {
  const d = new Date(t), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

export default {
  title: "News",
  tab: "news",
  async mount(el) {
    el.innerHTML = `<div class="card">${skeleton(6)}</div>`;
    let data = await loadNews();
    if (!el.isConnected) return;
    let pick = store.get("f1.newsSource", "");

    function render() {
      if (!data || !data.items.length) {
        el.innerHTML = `<div class="card news-empty">${ICONS.news}<h2>Headlines appear once the site is published</h2>
          <p>Every 30 minutes the site gathers the latest F1 headlines from Motorsport.com, Autosport, Formula 1, RaceFans and BBC Sport. Check back soon.</p></div>`;
        return;
      }
      const sources = [...new Set(data.items.map(i => i.source))].sort();
      const hue = s => HUES[sources.indexOf(s) % HUES.length];
      if (pick && !sources.includes(pick)) pick = "";
      const chip = (s, n) => {
        const [c, f] = s ? hue(s) : [];
        return `<button type="button" data-src="${esc(s)}" aria-pressed="${pick === s}"${s ? ` style="--tc:${c};--tcf:${f}"` : ""}>${esc(s || "All")} <small>${n}</small></button>`;
      };

      // one card per day, in the viewer's own time zone
      const days = [];
      for (const i of data.items) {
        if (pick && i.source !== pick) continue;
        const label = dayLabel(i.at);
        if (!days.length || days[days.length - 1].label !== label) days.push({ label, items: [] });
        days[days.length - 1].items.push(i);
      }
      const row = i => {
        const [c, f] = hue(i.source);
        return `<li><a class="row news-row" href="${esc(i.link)}" target="_blank" rel="noopener">
          <span class="news-src" style="--sc:${c};--sf:${f}" aria-hidden="true">${esc(initials(i.source))}</span>
          <span class="main"><b>${esc(i.title)}</b><small>${esc(i.source)} · ${when(i.at)}</small></span>
          <span class="news-out" aria-hidden="true">${ICONS.external}</span></a></li>`;
      };

      const x = (el.querySelector(".news-chips") || {}).scrollLeft || 0;   // a tapped chip stays where it was
      el.innerHTML = `
        <div class="news-top">
          <div class="chips news-chips" role="group" aria-label="Source">${chip("", data.items.length)}${sources.map(s => chip(s, data.items.filter(i => i.source === s).length)).join("")}</div>
          <small class="news-upd">Updated ${when(data.updated)}</small>
        </div>
        ${days.map(d => `<section class="card"><h2 class="card-h">${esc(d.label)} <small>${d.items.length} ${d.items.length === 1 ? "headline" : "headlines"}</small></h2>
          <ul class="rows">${d.items.map(row).join("")}</ul></section>`).join("")}
        <p class="news-credit">Headlines belong to their publishers; each story opens on their site.</p>`;
      el.querySelector(".news-chips").scrollLeft = x;
    }

    el.addEventListener("click", e => {
      const b = e.target.closest(".news-chips button");
      if (!b) return;
      pick = b.dataset.src; store.set("f1.newsSource", pick);
      render();
    });
    render();

    // every minute: keep "x min ago" honest, and show a newer list when there is one (loadNews asks at most every 10 minutes)
    const timer = setInterval(async () => {
      const fresh = await loadNews();
      if (!el.isConnected) return;
      if (fresh && (!data || fresh.updated !== data.updated)) { data = fresh; render(); }
      else for (const t of el.querySelectorAll("time[data-at]")) t.textContent = ago(+t.dataset.at);
    }, 60000);
    return () => clearInterval(timer);
  }
};
