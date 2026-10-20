// The season calendar: every Grand Prix weekend in the viewer's own time zone, the next one up top with a live
// countdown and the forecast, and the winners of finished races.
import { esc, fmtTime, fmtDay, fmtWhen, fmtRange, tzName, countdownHtml, dtagHtml, ICONS, skeleton } from "../util.js";
import { jolpica, forecast, forecastFor } from "../api.js";
import { season, currentSeason, liveSession, nextSession, pickedYear, pickYear } from "../season.js";
import { shortName, wxHtml, flagImg } from "../calendar-ui.js";
import { standings as seasonStandings, faceHtml } from "../stats.js";

const DAY = 86400000, FORECAST_DAYS = 16 * DAY;   // Open-Meteo forecasts 16 days ahead
const FIRST_YEAR = 2023;                          // OpenF1's first season (session times, flags, replays)
// Jolpica has no team colours: this year's liveries, older team names kept for past seasons
const TEAM_COLOUR = { mercedes: "#00D7B6", ferrari: "#ED1131", mclaren: "#F47600", red_bull: "#4781D7", aston_martin: "#229971", alpine: "#00A1E8",
  williams: "#1868DB", rb: "#6C98FF", haas: "#9C9FA2", audi: "#F50537", cadillac: "#909090", sauber: "#52E252", alphatauri: "#5E8FAA", alfa: "#C92D4B" };
const FILTERS = [["all", "All"], ["next", "Upcoming"], ["done", "Results"]];

// the filter stays while moving between pages; the season is shared with the Standings page (season.js pickYear)
let picked = { filter: "all" };

const failCard = what => `<div class="card"><p class="note-line">Couldn't load ${esc(what)}. <button class="btn small" type="button" data-retry>Try again</button></p></div>`;
const loading = () => `<section class="hero">${skeleton(4)}</section><div class="card">${skeleton(8)}</div>`;

export default {
  title: "Calendar",
  tab: "calendar",
  async mount(el, params, app) {
    let timer = 0, gen = 0, cur, data = null, year;
    const tools = app.setTools(`<select class="pick" aria-label="Season" hidden></select>`);
    const sel = tools.querySelector("select");
    const years = [];
    const fillYears = () => {
      sel.innerHTML = [...years].reverse().map(y => `<option value="${y}"${y === year ? " selected" : ""}>${y}</option>`).join("");
      sel.hidden = false;
    };

    el.innerHTML = loading();
    try { cur = await currentSeason(); }
    catch (e) { if (el.isConnected) { el.innerHTML = failCard("the calendar"); el.querySelector("[data-retry]").onclick = () => location.reload(); } return; }
    if (!el.isConnected) return;
    for (let y = FIRST_YEAR; y <= cur.year; y++) years.push(y);
    year = years.includes(pickedYear()) ? pickedYear() : cur.year;
    fillYears();
    // next year's calendar, once it's out
    jolpica(`${cur.year + 1}.json`, { ttl: DAY }).then(j => {
      if (el.isConnected && j && j.MRData.RaceTable.Races.length) { years.push(cur.year + 1); fillYears(); }
    }).catch(() => {});
    sel.addEventListener("change", () => { year = +sel.value; pickYear(year); load(); });

    async function load() {
      const mine = ++gen;
      clearInterval(timer); data = null;
      el.innerHTML = loading();
      let s, res, st;
      try {
        [s, res, st] = await Promise.all([season(year),
          jolpica(`${year}/results/1.json`, { ttl: year < cur.year ? 7 * DAY : 30 * 60000 }).catch(() => null),
          seasonStandings(year).catch(() => null)]);   // the winners' photos (initials for past seasons), as on the Standings pages
      } catch (e) {
        if (mine === gen && el.isConnected) { el.innerHTML = failCard(`the ${year} calendar`); el.querySelector("[data-retry]").onclick = load; }
        return;
      }
      if (mine !== gen || !el.isConnected) return;
      const wins = {};
      for (const r of (res && res.MRData.RaceTable.Races) || []) if (r.Results && r.Results[0]) wins[+r.round] = r.Results[0];
      data = { rounds: s.rounds, wins, people: new Map(((st && st.drivers) || []).map(d => [d.id, d])) };
      draw();
      if (!s.rounds.length) return;
      // tick: countdowns every second; draw again when a session starts or ends
      let was = stateKey(s.rounds, Date.now());
      timer = setInterval(() => {
        if (!el.isConnected) return clearInterval(timer);
        const t = Date.now();
        for (const c of el.querySelectorAll("[data-cd]")) c.innerHTML = countdownHtml(+c.dataset.cd - t);
        const now = stateKey(s.rounds, t);
        if (now !== was) { was = now; draw(); }
      }, 1000);
    }

    function draw() {
      const { rounds, wins } = data, now = Date.now();
      if (!rounds.length) { el.innerHTML = `<div class="card"><p class="note-line">The ${year} calendar isn't out yet.</p></div>`; return; }
      const live = liveSession(rounds, now);
      const next = year === cur.year ? rounds.find(r => r.end > now || (live && live.round === r)) : null;
      const done = rounds.filter(r => r.end < now).length;
      el.innerHTML =
        (next ? heroHtml(next, live, now) : "") +
        `<section class="card cal-season">
          <div class="cal-season-top">
            <div class="cal-season-t"><b>${year} season</b>
              <small>${done === rounds.length ? `All ${rounds.length} rounds finished` : done ? `${done} of ${rounds.length} rounds finished · ${rounds.length - done} to go` : `${rounds.length} rounds`}</small></div>
          </div>
          <div class="cal-bar" role="progressbar" aria-label="Season progress" aria-valuemin="0" aria-valuemax="${rounds.length}" aria-valuenow="${done}"><i style="width:${(done / rounds.length * 100).toFixed(1)}%"></i></div>
          <div class="cal-season-bot">
            <div class="seg" role="group" aria-label="Show">${FILTERS.map(([k, label]) => `<button type="button" data-filter="${k}" aria-pressed="${picked.filter === k}">${label}</button>`).join("")}</div>
            <small class="dim">Times in your time zone · ${esc(tzName())}</small>
          </div>
        </section>
        <div class="cal-list">${listHtml(rounds, wins, live, next, now)}</div>`;

      // the next weekend's forecast, once it's within reach
      if (next && next.start - now < FORECAST_DAYS && isFinite(next.lat)) {
        const mine = gen;
        forecast(next.lat, next.lon).then(f => {
          if (mine !== gen || !el.isConnected || !f) return;
          next.sessions.forEach((x, i) => {
            const slot = el.querySelector(`[data-wx="${i}"]`);
            if (slot && x.end > Date.now()) slot.innerHTML = wxHtml(forecastFor(f, x.start, x.end));
          });
        }).catch(() => {});
      }
    }

    function heroHtml(r, live, now) {
      const on = live && live.round === r ? live : null;
      const target = r.sessions.find(x => x.start > now);
      const state = x => on && on.start === x.start ? "now" : x.end < now ? "done" : "";
      return `<section class="hero cal-next${on ? " is-live" : ""}">
        ${r.circuitImage ? `<img class="cal-trk" src="${esc(r.circuitImage)}" alt="" onerror="this.remove()">` : ""}
        <div class="kicker">${on ? `<span class="badge red live">Live</span>` : ""}<span class="wkd-nw">${on ? "" : "Up next · "}Round ${r.round}</span>${r.sprint ? `<span class="badge amber">Sprint</span>` : ""}</div>
        <div class="cal-next-top">
          <a class="cal-next-id" href="#/calendar/${year}/${r.round}">
            <span class="cal-where">${flagImg(r)}<h2>${esc(r.name)}</h2></span>
            <span class="sub">${esc(r.circuit)} · ${esc(r.locality)}${r.country ? `, ${esc(r.country)}` : ""}</span>
            <span class="cal-dates">${ICONS.calendar}${fmtRange(r.start, r.end)}</span>
          </a>
          <div class="cal-next-cd">
            ${on ? `<p class="cal-cd-l"><b>${esc(on.name)}</b> ${now < on.start ? "is about to start" : now > on.end ? "has just finished" : "is on now"}</p>
                    <a class="btn primary" href="#/live">${ICONS.live}Watch live</a>`
                 : target ? `<p class="cal-cd-l">${esc(target.name)} starts in</p><div class="count" data-cd="${target.start}">${countdownHtml(target.start - now)}</div>` : ""}
          </div>
        </div>
        <ul class="rows cal-sched">${r.sessions.map((x, i) => `
          <li class="row ${state(x)}">
            <span class="k">${esc(x.short)}</span>
            <span class="main"><b>${esc(x.name)}${state(x) === "now" ? ` <span class="badge red live">Live</span>` : ""}</b><small>${fmtDay(x.start)}</small><span class="cal-wx" data-wx="${i}"></span></span>
            <span class="end">${fmtTime(x.start)}<small>to ${fmtTime(x.end)}</small></span>
          </li>`).join("")}
        </ul>
        <div class="cal-acts">
          <a class="btn${on ? "" : " primary"}" href="#/calendar/${year}/${r.round}">Weekend details${ICONS.chevron}</a>
        </div>
      </section>`;
    }

    function listHtml(rounds, wins, live, next, now) {
      const f = picked.filter;
      const keep = rounds.filter(r => f === "all" || (f === "done" ? r.end < now : r.end >= now));
      if (!keep.length) return `<div class="card"><p class="note-line">${f === "done" ? "No results yet this season." : "No more races this season."}</p></div>`;
      // grouped by the month of race day
      const months = [];
      for (const r of keep) {
        const m = new Date(r.end).toLocaleDateString([], { month: "long" });
        if (!months.length || months[months.length - 1][0] !== m) months.push([m, []]);
        months[months.length - 1][1].push(r);
      }
      return months.map(([m, list]) => `<h3 class="cal-month">${esc(m)}<small>${list.length} ${list.length > 1 ? "rounds" : "round"}</small></h3>
        <div class="cal-grid">${list.map(r => tile(r, wins[r.round], live, next, now)).join("")}</div>`).join("");
    }

    function tile(r, win, live, next, now) {
      const on = live && live.round === r, done = r.end < now && !on, isNext = r === next && !on;
      const nx = r.sessions.find(x => x.start > now);
      const race = r.sessions.find(x => x.kind === "race") || r.sessions[r.sessions.length - 1];
      let foot;
      if (on) foot = `<span class="cal-on">${ICONS.live}<b>${esc(live.name)}</b>${now < live.start ? "starts soon" : now > live.end ? "just finished" : "on now"}</span>`;
      else if (win) {
        const p = data.people.get(win.Driver.driverId), c = TEAM_COLOUR[win.Constructor.constructorId] || (p && p.colour) || "#777777";
        foot = `<span class="cal-win" style="--tc:${c}">${p ? faceHtml(p, 64, "face cal-face") : ICONS.trophy}${dtagHtml(win.number, win.Driver.code, c, true)}<b>${esc(win.Driver.givenName)} ${esc(win.Driver.familyName)}</b><small>${esc(win.Constructor.name)}</small></span>`;
      } else if (done) foot = `<span class="dim">Results to follow</span>`;
      else if (isNext && nx) foot = `<span class="cal-when"><b>${esc(nx.short)}</b>${fmtWhen(nx.start)}</span>`;
      else foot = `<span class="cal-when"><b>Race</b>${fmtWhen(race.start)}</span>`;
      const cls = ["cal-wk", done && "done", on && "live", isNext && "next"].filter(Boolean).join(" ");
      return `<a class="${cls}" href="#/calendar/${year}/${r.round}">
        <span class="cal-rnd"><small>Rnd</small><b>${r.round}</b></span>
        <span class="cal-name" title="${esc(r.name)}">${flagImg(r)}<b>${esc(shortName(r.name))}</b></span>
        <span class="cal-date">${fmtRange(r.start, r.end)}</span>
        <span class="cal-loc">${esc(r.circuit)} · ${esc(r.locality)}</span>
        <span class="cal-tags">${r.sprint ? `<span class="badge amber">Sprint</span>` : ""}${on ? `<span class="badge red live">Live</span>` : isNext ? `<span class="badge red">Next</span>` : ""}</span>
        <span class="cal-foot">${foot}</span>
      </a>`;
    }

    el.addEventListener("click", e => {
      const fb = e.target.closest("[data-filter]");
      if (fb && data) {
        picked.filter = fb.dataset.filter;
        for (const b of el.querySelectorAll("[data-filter]")) b.setAttribute("aria-pressed", b === fb);
        const now = Date.now(), live = liveSession(data.rounds, now);
        const next = year === cur.year ? data.rounds.find(r => r.end > now || (live && live.round === r)) : null;
        el.querySelector(".cal-list").innerHTML = listHtml(data.rounds, data.wins, live, next, now);
        return;
      }
    });

    await load();
    return () => { clearInterval(timer); gen++; };
  }
};

// changes when a session starts, ends or a weekend finishes: time to draw again
const stateKey = (rounds, t) => {
  const l = liveSession(rounds, t), n = nextSession(rounds, t);
  return `${l ? l.start : ""}|${l && t >= l.start && t <= l.end ? 1 : 0}|${n ? n.start : ""}|${rounds.filter(r => r.end < t).length}`;
};
