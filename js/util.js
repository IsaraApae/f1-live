// Small helpers shared by every page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const slug = name => (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// settings saved in the browser (keys start with "f1.")
export const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

// ---------- time, always in the viewer's own time zone ----------
const hour12 = () => store.get("f1.clock", "24") === "12";
export const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: hour12() });
export const fmtDay = t => new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
export const fmtDate = t => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
export const fmtShortDate = t => new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
export const fmtWhen = t => `${fmtDay(t)} · ${fmtTime(t)}`;
export const fmtRange = (a, b) => {   // "6 – 8 Mar" or "30 Oct – 1 Nov"
  const A = new Date(a), B = new Date(b);
  return A.getMonth() === B.getMonth() ? `${A.getDate()} – ${B.getDate()} ${B.toLocaleDateString([], { month: "short" })}` : `${fmtShortDate(a)} – ${fmtShortDate(b)}`;
};
export const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " "); } catch (e) { return "your time"; } };
export function countdown(ms) {   // [[days, "days"], [hours, "hrs"], ...]
  const s = Math.max(0, ms) / 1000;
  return [[Math.floor(s / 86400), "days"], [Math.floor(s / 3600) % 24, "hrs"], [Math.floor(s / 60) % 60, "min"], [Math.floor(s) % 60, "sec"]];
}
export const countdownHtml = ms => countdown(ms).map(([v, u]) => `<div><b>${String(v).padStart(2, "0")}</b><small>${u}</small></div>`).join("");
export const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};
export const lapText = t => { if (!t) return ""; const m = Math.floor(t / 60), s = (t - m * 60).toFixed(3); return m ? `${m}:${s.padStart(6, "0")}` : s; };

// ---------- teams and drivers ----------
export const ink = hex => {   // black or white text on a colour
  const h = (hex || "#777").replace("#", ""), r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 165 ? "#000" : "#fff";
};
export const tagVars = c => `--tc:${c};--tcf:${ink(c)}`;
export const hex = c => c ? (String(c).startsWith("#") ? c : "#" + c) : "#777777";

// formula1.com's pictures for a season: each year's driver portraits, team logos and cars.
// From 2024 they're under common/f1/<year>/<team>/ (the team as that year's OpenF1 names it, a few spelled differently);
// 2023's are on the older site, by surname and by team name with dashes.
const plain = s => (s || "").normalize("NFKD").replace(/[^A-Za-z]/g, "");
const TEAM_SLUG = { 2024: { haasf1team: "haas" } };
const teamSlug = (team, y) => { const s = slug(team); return (TEAM_SLUG[y] || {})[s] || s; };
const oldTeam = team => (team || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const OLD = "https://media.formula1.com/content/dam/fom-website";
// d: { HeadshotUrl, FirstName, LastName, TeamName }
export function photo(d, px, year = new Date().getFullYear()) {
  const y = +year;
  // a half-body photo, cut out in cutout.js; "#face" asks it for head and shoulders, like later years' small photos
  if (y < 2024) return `https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/${y}Drivers/${plain(d.LastName).toLowerCase()}.png.transform/2col-retina/image.png${px <= 200 ? "#face" : ""}`;
  const m = /\/([A-Z]{6}\d{2})_/.exec(d.HeadshotUrl || "");
  const code = m ? m[1].toLowerCase() : (plain(d.FirstName).slice(0, 3) + plain(d.LastName).slice(0, 3) + "01").toLowerCase();
  const team = teamSlug(d.TeamName, y);
  return `https://media.formula1.com/image/upload/c_thumb,g_face,z_0.6,w_${px},h_${px}/d_common:f1:${y}:fallback:driver:${y}fallbackdriverright.webp/common/f1/${y}/${team}/${code}/${y}${team}${code}right.webp`;
}
// 2023's logos on formula1.com are 96 px badges on a tile. Instead: the teams that carried on with the same logo get
// their transparent 2024 one (with its white version); Alfa Romeo the team's wordmark (Wikimedia Commons, public domain);
// AlphaTauri its "AT" mark from formula1.com's full-size logo (flat navy on white, separated in cutout.js).
// "#invert" (and cutout's "-invert") shows a one-colour logo in white, for the dark theme.
const LOGO_2023 = {
  alfaromeo: "https://upload.wikimedia.org/wikipedia/commons/d/d4/Alfa_Romeo_F1_Team_Stake_Logo.svg",
  alphatauri: "https://media.formula1.com/content/dam/fom-website/2018-redesign-assets/team%20logos/alphatauri.png#mark"
};
// the SVG logo, sharp at any size (formula1.com's PNG versions are only 96 px)
export const teamLogo = (team, white, year = new Date().getFullYear()) => {
  if (+year < 2024) {
    const own = LOGO_2023[slug(team)];
    if (own) return own + (white ? (own.includes("#") ? "-invert" : "#invert") : "");
    year = 2024;   // the same team's same logo, a year on
  }
  const t = teamSlug(team, +year); return `https://media.formula1.com/image/upload/common/f1/${year}/${t}/${year}${t}logo${white ? "white" : ""}.svg`;
};
// the team's car, side on, facing right
export const teamCar = (team, year = new Date().getFullYear(), w = 640) => {
  if (+year < 2024) return `${OLD}/teams/${year}/${oldTeam(team)}.png`;
  const t = teamSlug(team, +year); return `https://media.formula1.com/image/upload/c_fit,w_${w}/common/f1/${year}/${t}/${year}${t}carright.webp`;
};
// both versions of a team logo: the dark-mode one shows in dark mode
export const logoPair = (team, cls = "tl", year = new Date().getFullYear()) =>
  `<img class="${cls} lg-light" src="${esc(teamLogo(team, false, year))}" alt="" onerror="this.remove()"><img class="${cls} lg-dark" src="${esc(teamLogo(team, true, year))}" alt="" onerror="this.remove()">`;

// a driver tag: car number on the team colour, then the three-letter name
export const dtagHtml = (num, tla, colour, small) =>
  `<span class="dtag${small ? " small" : ""}" style="${tagVars(colour)}">${num ? `<span class="n">${esc(num)}</span>` : ""}<span class="t">${esc(tla || num)}</span></span>`;

export const TYRES = { SOFT: ["S", "#e10600"], MEDIUM: ["M", "#eab308"], HARD: ["H", "#d1d5db"], INTERMEDIATE: ["I", "#16a34a"], WET: ["W", "#2563eb"] };
export const tyreIcon = c => { const [ltr, ring] = TYRES[c] || ["?", "#777"]; return `<span class="tyre" style="--ty:${ring}" title="${esc(c || "")}">${ltr}</span>`; };

export const SHORT = { "Practice 1": "FP1", "Practice 2": "FP2", "Practice 3": "FP3", "Sprint Qualifying": "Sprint Quali", "Sprint Shootout": "Sprint Quali", "Qualifying": "Quali", "Sprint": "Sprint", "Race": "Race" };

// Jolpica sometimes sends names whose UTF-8 was read twice ("AutÃ³dromo"): put them right
export const fixText = s => { if (!/Ã|Â/.test(s || "")) return s; try { return decodeURIComponent(escape(s)); } catch (e) { return s; } };

// ---------- icons (24×24, drawn with currentColor) ----------
export const ICONS = {
  home: `<svg viewBox="0 0 24 24"><path d="M12 3 2 11h3v9h6v-6h2v6h6v-9h3z"/></svg>`,
  live: `<svg viewBox="0 0 24 24"><path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6.3 6.3l1.4 1.4a6 6 0 0 0 0 8.6l-1.4 1.4a8 8 0 0 1 0-11.4zm11.4 0a8 8 0 0 1 0 11.4l-1.4-1.4a6 6 0 0 0 0-8.6zM3.5 3.5l1.4 1.4a10 10 0 0 0 0 14.2l-1.4 1.4a12 12 0 0 1 0-17zm17 0a12 12 0 0 1 0 17l-1.4-1.4a10 10 0 0 0 0-14.2z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24"><path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm12 7H5v10h14zM7 11h4v4H7z"/></svg>`,
  standings: `<svg viewBox="0 0 24 24"><path d="M9 4h6v16H9zm-7 6h6v10H2zm14 3h6v7h-6z"/></svg>`,
  replay: `<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8zm-1.5 5v6l5-3z"/></svg>`,
  battle: `<svg viewBox="0 0 24 24"><path d="M3 17h7v2H3zm0-4h11v2H3zm11 4h7v2h-7zm-4-8h11v2H10zM3 5h7v2H3zm11 0h7v2h-7z"/></svg>`,
  news: `<svg viewBox="0 0 24 24"><path d="M4 4h13v14a2 2 0 0 0 2 2H5a1 1 0 0 1-1-1zm15 4h2v10a1 1 0 0 1-2 0zM7 7v4h7V7zm0 6v1.5h7V13zm0 3v1.5h7V16z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.3 7.3 0 0 0-1.7-1L14.9 3h-4l-.4 2.9a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.4L6.4 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.3 7.3 0 0 0 1.7 1l.4 2.9h4l.4-2.9a7.3 7.3 0 0 0 1.7-1l2.5 1 2-3.4zM12.9 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path d="M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12l8.8-8.8z"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7-1.4-1.4 5.6-5.6-5.6-5.6z"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>`,
  rain: `<svg viewBox="0 0 24 24"><path d="M12 2s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/></svg>`,
  temp: `<svg viewBox="0 0 24 24"><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0zM12 20a2 2 0 0 1-1-3.7V9h2v7.3A2 2 0 0 1 12 20z"/></svg>`,
  wind: `<svg viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3h2a1 1 0 1 1 1 1H3zm0 4h16a3 3 0 1 1-3 3h2a1 1 0 1 0 1-1H3zm0 4h8v2H3z"/></svg>`,
  star: `<svg viewBox="0 0 24 24"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`,
  share: `<svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg>`,
  download: `<svg viewBox="0 0 24 24"><path d="M11 3h2v9.6l3.3-3.3 1.4 1.4L12 16.4l-5.7-5.7 1.4-1.4 3.3 3.3zM4 18h16v2H4z"/></svg>`,
  external: `<svg viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24"><path d="M7 3h10v2h4v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.3 12H7a4 4 0 0 1-4-4V5h4zm0 4H5v1a2 2 0 0 0 2 2zm10 0v3a2 2 0 0 0 2-2V7z"/></svg>`
};

// the app's own mark (not Formula 1's logo): a chequered flag tile with a red speed line
export const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#e10600"/><path d="M8 9h4v4H8zm8 0h4v4h-4zm-4 4h4v4h-4zm8 0h4v4h-4zM8 17h4v4H8zm8 0h4v4h-4z" fill="#fff"/><path d="M6 24h20" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;

// an empty state or an error, inside a card
export const note = (text, cls = "") => `<p class="note-line ${cls}">${esc(text)}</p>`;
export const skeleton = (rows = 4) => `<div class="skel">${Array.from({ length: rows }, () => "<i></i>").join("")}</div>`;
