// Standings: the drivers' and the teams' championships, the top three up front, every row opening its page.
import { esc, store, ICONS, note, skeleton, dtagHtml, tagVars, teamCar } from "../util.js";
import { standings, latestYear, yearPick, driverHref, teamHref, faceHtml, logoHtml, pts, FIRST } from "../stats.js";

import { pickedYear, pickYear } from "../season.js";

export default {
  title: "Standings",
  tab: "standings",
  async mount(el, [which], app) {
    // the season picked here or on the Calendar (shared while the app is open)
    let kind = which === "teams" ? "teams" : "drivers", gapTo = store.get("f1.gapTo", "leader"), data = null, year = null;
    el.innerHTML = `
      <div class="st-head">
        <div class="seg wide st-kind" role="group" aria-label="Championship">
          <button type="button" data-k="drivers">Drivers</button><button type="button" data-k="teams">Teams</button>
        </div>
        <p class="st-meta"></p>
      </div>
      <div class="st-body"><div class="card">${skeleton(8)}</div></div>`;
    const meta = el.querySelector(".st-meta"), body = el.querySelector(".st-body");

    const paint = () => {
      for (const b of el.querySelectorAll(".st-kind button")) b.setAttribute("aria-pressed", b.dataset.k === kind);
      if (!data) return;
      meta.innerHTML = metaHtml(data);
      if (!data.round) { body.innerHTML = `<div class="card">${note(`The ${data.year} season hasn't started yet.`)}</div>`; return; }
      body.innerHTML = kind === "drivers" ? board(data.drivers, "Drivers' championship", "driver", driverTile, driverRow, gapTo)
                                          : board(data.teams, "Constructors' championship", "team", teamTile, teamRow, gapTo);
    };
    async function load() {
      data = null; meta.textContent = ""; paint();
      body.innerHTML = `<div class="card">${skeleton(8)}</div>`;
      const want = year;
      try { data = await standings(want); }
      catch (e) { if (el.isConnected && want === year) body.innerHTML = `<div class="card">${note("The standings couldn't load. Try again in a minute.", "err")}</div>`; return; }
      if (el.isConnected && want === year) paint();
    }

    el.addEventListener("click", e => {
      const k = e.target.closest("[data-k]"), g = e.target.closest("[data-gap]");
      if (k && k.dataset.k !== kind) {   // switch without going through the router, so nothing reloads
        kind = k.dataset.k;
        history.replaceState(null, "", `#/standings/${kind}`);
        paint();
      }
      if (g) { gapTo = g.dataset.gap; store.set("f1.gapTo", gapTo); paint(); }
    });

    paint();
    const latest = await latestYear().catch(() => new Date().getFullYear());
    if (!el.isConnected) return;
    // a season the standings have (the Calendar can pick next year, which has none yet)
    year = pickedYear() && pickedYear() >= FIRST && pickedYear() <= latest ? pickedYear() : latest;
    app.setTools(yearPick(year)).querySelector("select").addEventListener("change", e => { year = +e.target.value; pickYear(year); load(); });
    await load();
  }
};

function metaHtml(s) {
  if (!s.round) return "";
  const done = s.total && s.round >= s.total;
  return `<span><b>${done ? "Final standings" : `After round ${s.round}${s.total ? ` of ${s.total}` : ""}`}</b>${s.raceName ? ` · ${esc(s.raceName)}` : ""}</span>` +
    (done ? "" : `<span>Points update after each race${s.left ? ` · ${s.left} round${s.left > 1 ? "s" : ""} left, up to ${s.maxLeft} points still to win` : ""}</span>`);
}

// the top three as a podium (second, first, third), then everyone else in a list
function board(list, title, noun, tile, line, gapTo) {
  if (!list.length) return `<div class="card">${note("No standings yet.")}</div>`;
  const lead = list[0].points;
  const gap = (x, i) => {
    if (!i) return "Leader";
    const d = (gapTo === "ahead" ? list[i - 1].points : lead) - x.points;
    return d ? `−${pts(d)}` : "Level";
  };
  return `
    <div class="st-podium">${[1, 0, 2].map(i => list[i] ? tile(list[i], i, gap(list[i], i)) : "<span></span>").join("")}</div>
    <section class="card st-list">
      <h2 class="card-h">${title}
        <span class="seg st-gap" role="group" aria-label="Gap to">
          <button type="button" data-gap="leader" aria-pressed="${gapTo !== "ahead"}">To leader</button><button type="button" data-gap="ahead" aria-pressed="${gapTo === "ahead"}">To next place</button>
        </span></h2>
      <div class="rows">${list.slice(3).map((x, k) => line(x, gap(x, k + 3), lead)).join("")}</div>
    </section>
    <p class="st-foot">Tap a ${noun} for their season: results race by race, points over the year and more.</p>`;
}

const bar = (v, lead) => `<span class="st-bar"><i style="width:${lead > 0 ? Math.max(0, Math.min(100, v / lead * 100)).toFixed(1) : 0}%"></i></span>`;
const wins = n => `<span class="st-wins${n ? "" : " none"}" title="${n} win${n === 1 ? "" : "s"}">${ICONS.trophy}${n}</span>`;

function driverTile(d, i, gap) {
  return `<a class="st-pod p${i + 1}" href="${driverHref(d.id, d.year)}" style="${tagVars(d.colour)}">
    <span class="st-pod-pos">${esc(d.posText)}</span>
    ${faceHtml(d, 200, "st-pod-face")}
    <b><span class="st-pod-fn">${esc(d.first)} </span>${esc(d.last)}</b><small>${esc(d.team)}</small>
    <span class="st-pod-pts">${pts(d.points)}<small> pts</small></span>
    <span class="st-pod-gap">${gap}${d.wins ? ` · ${d.wins} win${d.wins > 1 ? "s" : ""}` : ""}</span>
  </a>`;
}
function driverRow(d, gap, lead) {
  return `<a class="row st-row" href="${driverHref(d.id, d.year)}" style="${tagVars(d.colour)}">
    <span class="st-pos">${esc(d.posText)}</span>
    ${faceHtml(d, 80)}
    <span class="main"><b><span class="st-fn">${esc(d.first)} </span>${esc(d.last)}</b><small>${esc(d.team)}</small>${bar(d.points, lead)}</span>
    ${wins(d.wins)}
    <span class="end">${pts(d.points)}<small>${gap}</small></span>
  </a>`;
}
// the team's car, side on (formula1.com has them for teams it knows by F1's own name)
const carHtml = (t, cls, w) => t.f1 ? `<img class="${cls}" src="${esc(teamCar(t.f1, t.year, w))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`;
function teamTile(t, i, gap) {
  return `<a class="st-pod p${i + 1}" href="${teamHref(t.id, t.year)}" style="${tagVars(t.colour)}">
    <span class="st-pod-pos">${esc(t.posText)}</span>
    ${logoHtml(t, "st-pod-logo")}
    ${carHtml(t, "st-pod-car", 480)}
    <b>${esc(t.name)}</b><small>${t.drivers.map(d => esc(d.code)).join(" · ") || "&nbsp;"}</small>
    <span class="st-pod-pts">${pts(t.points)}<small> pts</small></span>
    <span class="st-pod-gap">${gap}${t.wins ? ` · ${t.wins} win${t.wins > 1 ? "s" : ""}` : ""}</span>
  </a>`;
}
function teamRow(t, gap, lead) {
  return `<a class="row st-row st-trow" href="${teamHref(t.id, t.year)}" style="${tagVars(t.colour)}">
    <span class="st-pos">${esc(t.posText)}</span>
    ${logoHtml(t)}
    <span class="main"><b>${esc(t.name)}</b><span class="st-tags">${t.drivers.map(d => dtagHtml(d.num, d.code, d.colour, true)).join("")}</span>${bar(t.points, lead)}</span>
    ${carHtml(t, "st-car", 360)}
    ${wins(t.wins)}
    <span class="end">${pts(t.points)}<small>${gap}</small></span>
  </a>`;
}
