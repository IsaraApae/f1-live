// Small pieces both calendar pages draw: short Grand Prix names, weather chips and flags.
import { esc, ICONS } from "./util.js";

export const shortName = name => String(name || "").replace(/Grand Prix/, "GP");

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
