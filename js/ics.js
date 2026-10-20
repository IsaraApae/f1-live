// Calendar files (.ics, RFC 5545) built in the browser: one event per session with a reminder 15 minutes before.
// Plus the small pieces both calendar pages draw (the add-to-calendar icon, weather chips).
import { esc, ICONS } from "./util.js";

const CRLF = "\r\n";
const stamp = t => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");   // 20261025T200000Z
// TEXT values: backslash, semicolon, comma and line breaks are escaped
const text = s => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// lines longer than 75 bytes go on as a continuation line (a space first), never splitting a character
const enc = new TextEncoder();
function fold(line) {
  let out = "", n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > 75) { out += CRLF + " "; n = 1; }
    out += ch; n += b;
  }
  return out;
}

export const shortName = name => String(name || "").replace(/Grand Prix/, "GP");

// sessions: [{ kind, name, start, end, round: { round, name, circuit, locality, country } }]
// link(round) → the weekend page's address, for the event's description
export function buildIcs(sessions, { year, calName, link }) {
  const now = stamp(Date.now());
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//F1 Live fan site//Season calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             `X-WR-CALNAME:${text(calName)}`];
  for (const s of sessions) {
    const r = s.round, title = `${shortName(r.name)} · ${s.name}`, url = link ? link(r) : "";
    L.push("BEGIN:VEVENT",
      `UID:${year}-r${r.round}-${s.kind}@f1-live`,   // the same every time, so importing again updates instead of doubling
      `DTSTAMP:${now}`, `DTSTART:${stamp(s.start)}`, `DTEND:${stamp(s.end)}`,
      `SUMMARY:${text(title)}`,
      `LOCATION:${text([r.circuit, r.locality, r.country].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${text(`Round ${r.round} of the ${year} season.${url ? `\nTimes and results: ${url}` : ""}`)}`,
      ...(url ? [`URL:${url}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(`${title} starts in 15 minutes`)}`, "TRIGGER:-PT15M", "END:VALARM",
      "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join(CRLF) + CRLF;
}

export function downloadIcs(filename, body) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// the weekend page's address on this site, wherever it's hosted
export const weekendUrl = (year, r) => `${location.origin}${location.pathname}#/calendar/${year}/${r.round}`;

// a calendar with a plus: "add to my calendar"
export const ADD_ICON = `<svg viewBox="0 0 24 24"><path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v8h-2V9H5v10h8v2H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm11 13h2v3h3v2h-3v3h-2v-3h-3v-2h3z"/></svg>`;

// sky icons for the forecast (Open-Meteo's weather codes, see api.js sky())
const CLOUD = "M6.5 19a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 17.65 9 5 5 0 0 1 17.5 19z";
const CLOUD_HI = "M6.5 15a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 17.65 5 5 5 0 0 1 17.5 15z";
const SKY = {
  sun: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M11 1h2v4h-2zm0 18h2v4h-2zM1 11h4v2H1zm18 0h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zm11.4 11.4 1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4L17 8.4z"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24"><path d="${CLOUD}"/></svg>`,
  rain: `<svg viewBox="0 0 24 24"><path d="${CLOUD_HI}M8 17h2l-1.5 4h-2zm5 0h2l-1.5 4h-2z"/></svg>`,
  storm: `<svg viewBox="0 0 24 24"><path d="${CLOUD_HI}M12 16h3l-2 3h2l-4.5 4.5L12 20h-2z"/></svg>`
};
SKY["cloud-sun"] = SKY.cloud;

// forecastFor()'s answer as chips: sky, chance of rain, temperature, wind
export const wxHtml = w => !w ? "" : `<span class="wx">` +
  (w.sky && w.sky.label ? `<span>${SKY[w.sky.kind] || SKY.cloud}${esc(w.sky.label)}</span>` : "") +
  (w.rain != null ? `<span class="rain" title="Chance of rain">${ICONS.rain}${Math.round(w.rain)}%</span>` : "") +
  (w.temp != null ? `<span title="Temperature">${ICONS.temp}${Math.round(w.temp)}°C</span>` : "") +
  (w.wind != null ? `<span title="Wind">${ICONS.wind}${Math.round(w.wind)} km/h</span>` : "") + `</span>`;

export const flagImg = (r, cls = "flag") => r.flag ? `<img class="${cls}" src="${esc(r.flag)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls}"></span>`;
