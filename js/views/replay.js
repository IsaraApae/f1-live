// Replay tab: pick any finished session since 2023, then watch it on the timing screen with the analysis panels.
import { esc, ICONS, fmtRange, skeleton } from "../util.js";
import { season, allSessions } from "../season.js";
import { mountTiming } from "../timing.js";

let pickYear = new Date().getFullYear();

export default {
  title: "Replay",
  tab: "replay",
  async mount(el, [key], app) {
    if (key) {
      app.setBack("back");
      app.setTools(`<a class="btn small" href="#/battle/${esc(key)}" title="Compare two drivers' laps">${ICONS.battle}<span class="hide-phone">Lap battle</span></a>`);
      return mountTiming(el, { replay: key, app });
    }
    const thisYear = new Date().getFullYear();
    el.innerHTML = `
      <section class="hero replay-hero"><div class="kicker">${ICONS.replay} Full replays</div>
        <h2>Watch any session again</h2>
        <p class="sub">Every race, sprint, qualifying and practice since 2023, rebuilt lap by lap: timing, the track map, race control, team radio, tyres, overtakes, track dominance and car telemetry.</p>
        <div class="acts" id="latest"></div></section>
      <div class="seg" id="years">${Array.from({ length: thisYear - 2022 }, (_, i) => thisYear - i).map(y => `<button type="button" data-y="${y}" aria-pressed="${y === pickYear}">${y}</button>`).join("")}</div>
      <div class="meets" id="meets">${skeleton(6)}</div>`;
    const fill = async () => {
      const box = el.querySelector("#meets"); box.innerHTML = skeleton(6);
      try {
        const s = await season(pickYear);
        if (!el.isConnected) return;
        const t = Date.now();
        const rounds = s.rounds.map(r => ({ ...r, done: r.sessions.filter(x => x.key && x.end < t) })).filter(r => r.done.length).reverse();
        box.innerHTML = rounds.length ? rounds.map(r => `<div class="card meet">
            ${r.flag ? `<img class="flag" src="${esc(r.flag)}" alt="" loading="lazy">` : `<span></span>`}
            <div><b>${esc(r.name)}</b><small>Round ${r.round} · ${esc(r.locality || r.circuit)} · ${fmtRange(r.start, r.end)}</small></div>
            <div class="sess">${r.done.map(x => `<a class="btn small ${x.kind === "race" ? "primary" : ""}" href="#/replay/${x.key}">${esc(x.short)}</a>`).join("")}</div></div>`).join("")
          : `<div class="card"><p class="note-line">No finished sessions in ${pickYear} yet.</p></div>`;
        if (pickYear === thisYear) {
          const last = allSessions(s.rounds).filter(x => x.key && x.end < t).sort((a, b) => b.end - a.end)[0];
          el.querySelector("#latest").innerHTML = last ? `<a class="btn primary" href="#/replay/${last.key}">${ICONS.play}Latest: ${esc(last.round.name.replace(/ Grand Prix$/, " GP"))} · ${esc(last.short)}</a>
            <a class="btn" href="#/battle/${last.key}">${ICONS.battle}Lap battle</a>` : "";
        }
      } catch (e) { if (el.isConnected) box.innerHTML = `<div class="card"><p class="note-line">Couldn't load the season. Try again in a minute.</p></div>`; }
    };
    el.querySelector("#years").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      pickYear = +b.dataset.y; for (const x of el.querySelectorAll("#years button")) x.setAttribute("aria-pressed", String(x === b));
      fill();
    });
    fill();
  }
};
