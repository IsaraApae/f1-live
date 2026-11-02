// #/result/KEY (the LINE cards' "Full result"): the weekend page of that session, which shows every session's result
// as it stands now, penalties after the race included
import { esc, skeleton } from "../util.js";
import { season } from "../season.js";

export default {
  title: "Result",
  tab: "calendar",
  async mount(el, [key]) {
    el.innerHTML = `<div class="card">${skeleton(4)}</div>`;
    const y = new Date().getFullYear();
    for (const year of [y, y - 1]) {   // a session from late last season, opened in January
      try {
        const r = (await season(year)).rounds.find(r => r.sessions.some(x => String(x.key) === key));
        if (r) { if (el.isConnected) location.replace(`#/calendar/${year}/${r.round}/${key}`); return; }
      } catch (e) {}
    }
    if (el.isConnected) el.innerHTML = `<div class="card"><p class="note-line">That session couldn't be found. <a href="#/replay/${esc(key)}">Open its replay</a> or <a href="#/calendar">the calendar</a>.</p></div>`;
  }
};
