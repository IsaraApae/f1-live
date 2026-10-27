// Home: what's on now or next (with a countdown and the forecast), the weekend's sessions, your driver and team,
// the last race's podium, the championship's top five and the latest headlines.
import { esc, store, ICONS, fmtWhen, fmtTime, fmtDay, fmtRange, countdownHtml, photo, logoPair, tagVars, skeleton, tzName, ago, fixText } from "../util.js";
import { jolpica, forecast, forecastFor } from "../api.js";
import { currentSeason, drivers, liveSession, nextSession, allSessions } from "../season.js";
import { loadNews } from "../news.js";

const wx = f => f ? `<span class="wx">${f.rain != null ? `<span class="rain">${ICONS.rain}${Math.round(f.rain)}% rain</span>` : ""}${f.temp != null ? `<span>${ICONS.temp}${Math.round(f.temp)}°C</span>` : ""}${f.wind != null ? `<span>${ICONS.wind}${Math.round(f.wind)} km/h</span>` : ""}${f.sky && f.sky.label ? `<span>${esc(f.sky.label)}</span>` : ""}</span>` : "";

export default {
  title: "F1 Live",
  tab: "home",
  async mount(el, params, app) {
    app.setTools(`<a class="iconbtn" href="#/news" aria-label="News">${ICONS.news}</a><a class="iconbtn" href="#/settings" aria-label="Settings">${ICONS.settings}</a>`);
    el.innerHTML = `<div class="grid2 home">
      <div class="stack"><div id="hLive"></div><div id="hHero">${skeleton(5)}</div><div id="hFav"></div><div id="hWeekend"></div><div id="hPodium"></div></div>
      <div class="stack"><div id="hStand"></div><div id="hNews"></div></div></div>`;
    const $ = id => el.querySelector("#" + id);
    let s, roster = [], timer = 0, next = null;
    // the standings, last result and headlines don't need the season: start reading them now, alongside it
    const standings = Promise.all([jolpica("current/driverStandings.json"), jolpica("current/constructorStandings.json"), jolpica("current/last/results.json")]);
    const news = loadNews();
    standings.catch(() => {});   // (if the season fails, nobody waits for these)
    try { [s, roster] = await Promise.all([currentSeason(), drivers().catch(() => [])]); }
    catch (e) { $("hHero").innerHTML = `<div class="card"><p class="note-line">Couldn't load the season. Check your connection and try again.</p></div>`; return; }
    if (!el.isConnected) return;
    const byCode = Object.fromEntries(roster.map(d => [d.tla, d]));

    // ---------- on track now, and up next ----------
    function drawNow() {
      const t = Date.now(), live = liveSession(s.rounds, t);
      $("hLive").innerHTML = live ? `<a class="card live-card" href="#/live">
          <span class="badge red live">${t < live.start ? "Starting soon" : t > live.end ? "Just finished" : "Live now"}</span>
          <div><b>${esc(live.round.name)} · ${esc(live.name)}</b><small>${t < live.start ? `Starts at ${fmtTime(live.start)}` : `Started ${fmtTime(live.start)}`} · timing, track map, race control and team radio</small></div>
          <span class="btn primary">${ICONS.live}Watch live</span></a>` : "";
      const n = nextSession(s.rounds, t);
      if (!n) { $("hHero").innerHTML = `<section class="hero"><div class="kicker">Season over</div><h2>See you next season</h2><p class="sub">Every session of the season can be watched again.</p><div class="acts"><a class="btn primary" href="#/replay">${ICONS.replay}Replays</a></div></section>`; next = null; return; }
      if (next && next.start === n.start) return;
      next = n;
      const r = n.round;
      $("hHero").innerHTML = `<section class="hero home-hero">
        ${r.circuitImage ? `<img class="trackimg" src="${esc(r.circuitImage)}" alt="" onerror="this.remove()">` : ""}
        <div>
          <div class="kicker">Up next · Round ${r.round}${r.sprint ? ` · <span class="badge amber">Sprint weekend</span>` : ""}</div>
          <h2>${esc(r.name)}</h2>
          <div class="sub">${esc(n.name)} · ${fmtWhen(n.start)}</div>
          <div class="where">${r.flag ? `<img class="flag" src="${esc(r.flag)}" alt="">` : ""}<span class="dim">${esc(r.circuit)}${r.locality ? ` · ${esc(r.locality)}` : ""}</span></div>
          <div class="hero-wx" id="hWx"></div>
          <div class="acts"><a class="btn primary" href="#/calendar/${s.year}/${r.round}">Weekend schedule ${ICONS.chevron}</a><a class="btn" href="#/live">${ICONS.live}Live timing</a></div>
        </div>
        <div><div class="count" id="hCount">${countdownHtml(n.start - t)}</div><p class="tz">Times in ${esc(tzName())}</p></div>
      </section>`;
      forecast(r.lat, r.lon).then(f => { const x = forecastFor(f, n.start, n.end); if (el.isConnected && x && $("hWx")) $("hWx").innerHTML = wx(x); }).catch(() => {});
      drawWeekend(r);
    }
    function drawWeekend(r) {   // the next weekend's sessions, in local time
      const t = Date.now();
      $("hWeekend").innerHTML = `<section class="card"><h2 class="card-h"><span>${esc(r.name.replace(/ Grand Prix$/, " GP"))} weekend</span><a class="more" href="#/calendar/${s.year}/${r.round}">Details ${ICONS.chevron}</a></h2>
        <div class="sched">${r.sessions.map(x => { const done = x.end < t, now = x.start - 15 * 60000 <= t && t <= x.end + 30 * 60000;
          return `<a class="row ${done ? "done" : ""} ${now ? "now" : ""}" href="${now ? "#/live" : done && x.key ? `#/replay/${x.key}` : `#/calendar/${s.year}/${r.round}`}">
            <span class="k">${esc(x.short)}</span><span class="main"><b>${esc(x.name)}</b><small>${fmtDay(x.start)}</small></span>
            <span class="end">${now ? `<span class="badge red live">Live</span>` : done ? `<small>Replay</small>` : fmtTime(x.start)}</span></a>`; }).join("")}</div></section>`;
    }
    drawNow();
    timer = setInterval(() => {
      if (next && $("hCount")) { const html = countdownHtml(next.start - Date.now()); if ($("hCount")._html !== html) { $("hCount").innerHTML = html; $("hCount")._html = html; } }
      if (next && Date.now() >= next.start - 15 * 60000) { next = null; drawNow(); }   // it's starting: show it as live
    }, 1000);
    const slow = setInterval(drawNow, 60000);

    // ---------- your driver and team (picked in Settings), the podium, the standings ----------
    standings.then(([ds, cs, last]) => {
      if (!el.isConnected) return;
      const dl = ds.MRData.StandingsTable.StandingsLists[0] || {}, cl = cs.MRData.StandingsTable.StandingsLists[0] || {};
      const dStand = dl.DriverStandings || [], cStand = cl.ConstructorStandings || [];
      const race = last.MRData.RaceTable.Races[0];
      const me = d => byCode[d.Driver.code] || { FirstName: d.Driver.givenName, LastName: d.Driver.familyName, TeamName: "", colour: "#777777" };
      // a team's F1 name and colour: through its drivers
      const teamInfo = cid => { const d = dStand.find(x => (x.Constructors.slice(-1)[0] || {}).constructorId === cid && byCode[x.Driver.code]); return d ? byCode[d.Driver.code] : null; };

      const favD = store.get("f1.favDriver", null), favT = store.get("f1.favTeam", null);
      const fd = favD && dStand.find(x => x.Driver.code === favD), ft = favT && cStand.find(x => { const i = teamInfo(x.Constructor.constructorId); return i && i.team === favT; });
      const lastOf = code => race && race.Results.find(x => x.Driver.code === code);
      const favHtml = [];
      if (fd) { const d = me(fd), lr = lastOf(favD);
        favHtml.push(`<a class="card fav" href="#/driver/${esc(fd.Driver.driverId)}" style="--tc:${d.colour}"><img class="face" src="${esc(photo(d, 128))}" alt="" style="background:${d.colour}">
          <div><small>Your driver</small><b>${esc(fixText(fd.Driver.givenName))} ${esc(fixText(fd.Driver.familyName))}</b><small>${esc(d.TeamName || (fd.Constructors[0] || {}).name || "")}${lr ? ` · last race P${esc(lr.positionText)}` : ""}</small></div>
          <div class="big"><b>P${esc(fd.position)}</b><small>${esc(fd.points)} pts</small></div></a>`); }
      if (ft) { const i = teamInfo(ft.Constructor.constructorId) || {};
        favHtml.push(`<a class="card fav" href="#/team/${esc(ft.Constructor.constructorId)}" style="--tc:${i.colour || "#777"}"><span>${logoPair(i.team || ft.Constructor.name)}</span>
          <div><small>Your team</small><b>${esc(i.team || ft.Constructor.name)}</b><small>${ft.wins !== "0" ? `${esc(ft.wins)} wins` : "Constructors' championship"}</small></div>
          <div class="big"><b>P${esc(ft.position)}</b><small>${esc(ft.points)} pts</small></div></a>`); }
      $("hFav").innerHTML = favHtml.length ? `<div class="favs">${favHtml.join("")}</div>`
        : `<a class="card pick-fav" href="#/settings"><span class="ico-star">${ICONS.star}</span><div><b>Pick your driver and team</b><small>Their position, points and last result, right here.</small></div>${ICONS.chevron}</a>`;

      if (race) {
        const r = s.rounds.find(x => x.round === +race.round), key = r && (r.sessions.find(x => x.kind === "race") || {}).key;
        $("hPodium").innerHTML = `<section class="card"><h2 class="card-h"><span>Last race · ${esc(fixText(race.raceName).replace(/ Grand Prix$/, " GP"))}</span>${key ? `<a class="more" href="#/replay/${key}">Replay ${ICONS.chevron}</a>` : ""}</h2>
          <div class="podium">${race.Results.slice(0, 3).map(x => { const d = me(x);
            return `<a href="#/driver/${esc(x.Driver.driverId)}" style="--tc:${d.colour}"><span class="p">P${esc(x.position)}</span><img class="face" src="${esc(photo(d, 112))}" alt="" style="background:${d.colour}">
              <b>${esc(fixText(x.Driver.familyName))}</b><small>${x.position === "1" ? esc((x.Time || {}).time || "Winner") : esc((x.Time || {}).time || x.status)}</small></a>`; }).join("")}</div></section>`;
      }
      $("hStand").innerHTML = `<section class="card mini-stand"><h2 class="card-h"><span>Drivers' championship <small>after round ${esc(dl.round || "")}</small></span><a class="more" href="#/standings">All ${ICONS.chevron}</a></h2>
        <div class="rows">${dStand.slice(0, 5).map(x => { const d = me(x);
          return `<a class="row" href="#/driver/${esc(x.Driver.driverId)}" style="--tc:${d.colour}"><span class="p">${esc(x.position)}</span><img class="face" src="${esc(photo(d, 64))}" alt="" style="background:${d.colour}">
            <span class="main"><b>${esc(fixText(x.Driver.givenName))} ${esc(fixText(x.Driver.familyName))}</b><small>${esc(d.TeamName || (x.Constructors.slice(-1)[0] || {}).name || "")}</small></span><span class="end">${esc(x.points)}<small>pts</small></span></a>`; }).join("")}</div></section>
        <section class="card mini-stand"><h2 class="card-h"><span>Teams</span><a class="more" href="#/standings/teams">All ${ICONS.chevron}</a></h2>
        <div class="rows">${cStand.slice(0, 5).map(x => { const i = teamInfo(x.Constructor.constructorId) || {};
          return `<a class="row" href="#/team/${esc(x.Constructor.constructorId)}" style="--tc:${i.colour || "#777"}"><span class="p">${esc(x.position)}</span><span>${logoPair(i.team || x.Constructor.name)}</span>
            <span class="main"><b>${esc(i.team || x.Constructor.name)}</b></span><span class="end">${esc(x.points)}<small>pts</small></span></a>`; }).join("")}</div></section>`;
    }).catch(() => { if (el.isConnected) $("hStand").innerHTML = `<div class="card"><p class="note-line">Standings are unavailable right now.</p></div>`; });

    // ---------- headlines ----------
    news.then(n => {
      if (!el.isConnected) return;
      $("hNews").innerHTML = n && n.items.length ? `<section class="card"><h2 class="card-h"><span>Latest news</span><a class="more" href="#/news">More ${ICONS.chevron}</a></h2>
        <div class="rows">${n.items.slice(0, 6).map(i => `<a class="row hnews-row" href="${esc(i.link)}" target="_blank" rel="noopener"><span class="main"><b>${esc(i.title)}</b><small>${esc(i.source)} · ${ago(i.at)}</small></span>${ICONS.external}</a>`).join("")}</div></section>` : "";
    });

    return () => { clearInterval(timer); clearInterval(slow); };
  }
};
