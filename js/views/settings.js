// Settings: appearance, clock, your driver and team, alerts, and saved data.
import { esc, store, ICONS, tzName } from "../util.js";
import { clearCache } from "../api.js";
import { drivers } from "../season.js";
import * as main from "../main.js";

const THEMES = [["light", "Light", `<svg viewBox="0 0 24 24"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5 1.4 3h-2.8L12 2zm0 20-1.4-3h2.8L12 22zM2 12l3-1.4v2.8L2 12zm20 0-3 1.4v-2.8l3 1.4zM4.9 4.9l3.1 1.2-2 2-1.1-3.2zm14.2 14.2-3.1-1.2 2-2 1.1 3.2zM4.9 19.1l1.2-3.1 2 2-3.2 1.1zM19.1 4.9l-1.2 3.1-2-2 3.2-1.1z"/></svg>`],
                ["dark", "Dark", `<svg viewBox="0 0 24 24"><path d="M21 14.5A9 9 0 0 1 9.5 3a9 9 0 1 0 11.5 11.5z"/></svg>`],
                ["device", "Device", `<svg viewBox="0 0 24 24"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v14h10V5H7zm5 15.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>`]];

export default {
  title: "Settings",
  tab: "settings",
  async mount(el, params, app) {
    el.innerHTML = `<div class="settings">
      <section class="card"><h2 class="card-h">Appearance</h2><div class="card-b">
        <div class="tiles" id="themes">${THEMES.map(([k, l, svg]) => `<button type="button" data-t="${k}">${svg}${l}</button>`).join("")}</div></div></section>
      <section class="card"><h2 class="card-h">Times</h2><div class="card-b">
        <div class="toggles"><div class="trow"><span>Clock<small>Every time is shown in your own time zone (${esc(tzName())})</small></span>
          <span class="seg" id="clock"><button type="button" data-c="24">24-hour</button><button type="button" data-c="12">12-hour</button></span></div></div></div></section>
      <section class="card"><h2 class="card-h">Your driver and team <small>shown on Home</small></h2><div class="card-b">
        <div class="toggles">
          <label><span>Driver</span><select class="pick" id="favD"><option value="">None</option></select></label>
          <label><span>Team</span><select class="pick" id="favT"><option value="">None</option></select></label></div></div></section>
      <section class="card"><h2 class="card-h">Alerts</h2><div class="card-b">
        <div class="toggles">
          <label><span>Race control pop-ups<small>Safety car, red flag, penalties and investigations pop up while you watch (live and replays)</small></span>
            <span class="switch"><input type="checkbox" id="alerts"></span></label>
          <label><span>Notifications in the background<small>While the Live tab is open in another tab or window, race control messages also come as system notifications</small></span>
            <span class="switch"><input type="checkbox" id="notify"></span></label></div>
        <p class="note-line small">For reminders before each session even with the site closed, add the season to your phone's calendar from the Calendar tab: every session comes with a 15-minute alert.</p>
        <a class="btn" href="#/calendar">${ICONS.calendar}Open the calendar</a></div></section>
      <section class="card"><h2 class="card-h">Saved data</h2><div class="card-b">
        <p class="note-line small">The site keeps recent schedules, results and replays in this browser so pages open quickly. Nothing is sent anywhere: there's no account and no tracking.</p>
        <button class="btn" id="clear" type="button">Clear saved data</button></div></section>
    </div>`;
    const $ = id => el.querySelector("#" + id);
    const press = (box, attr, v) => { for (const b of box.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset[attr] === v)); };

    press($("themes"), "t", store.get("f1.theme", "dark"));
    $("themes").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; main.setTheme(b.dataset.t); press($("themes"), "t", b.dataset.t); });
    press($("clock"), "c", store.get("f1.clock", "24"));
    $("clock").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; store.set("f1.clock", b.dataset.c); press($("clock"), "c", b.dataset.c); });

    drivers().then(list => {
      if (!el.isConnected) return;
      // A to Z by the name as it reads in the list (first name first)
      const sorted = list.slice().sort((a, b) => `${a.first} ${a.last}`.localeCompare(`${b.first} ${b.last}`)), teams = [...new Set(list.map(d => d.team))].sort((a, b) => a.localeCompare(b));
      $("favD").innerHTML += sorted.map(d => `<option value="${esc(d.tla)}">${esc(d.first)} ${esc(d.last)} · ${esc(d.team)}</option>`).join("");
      $("favT").innerHTML += teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
      $("favD").value = store.get("f1.favDriver", "") || ""; $("favT").value = store.get("f1.favTeam", "") || "";
    }).catch(() => {});
    $("favD").addEventListener("change", e => { store.set("f1.favDriver", e.target.value || null); app.toast(`<div>${e.target.value ? "Your driver is on the Home page." : "Driver removed from Home."}</div>`, { ms: 2500 }); });
    $("favT").addEventListener("change", e => { store.set("f1.favTeam", e.target.value || null); app.toast(`<div>${e.target.value ? "Your team is on the Home page." : "Team removed from Home."}</div>`, { ms: 2500 }); });

    $("alerts").checked = store.get("f1.alerts", true);
    $("alerts").addEventListener("change", e => store.set("f1.alerts", e.target.checked));
    const canNotify = "Notification" in window;
    $("notify").checked = canNotify && store.get("f1.notify", false) && Notification.permission === "granted";
    $("notify").disabled = !canNotify;
    $("notify").addEventListener("change", async e => {
      if (e.target.checked && Notification.permission !== "granted") {
        const p = await Notification.requestPermission().catch(() => "denied");
        if (p !== "granted") { e.target.checked = false; app.toast(`<div>Notifications are blocked for this site in your browser's settings.</div>`, { ms: 4000 }); return; }
      }
      store.set("f1.notify", e.target.checked);
    });

    $("clear").addEventListener("click", () => { clearCache(); app.toast(`<div>Saved data cleared.</div>`, { ms: 2500 }); });
  }
};
