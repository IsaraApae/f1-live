import { esc, hex, TYRES, tyreIcon } from "./util.js";

const HISTORY = 5;
const ROW = 20;
const FLAG_NAMES = { sc: "Safety car", vsc: "Virtual safety car", red: "Red flag" };

// Sample the running order when the leader completes each lap. Lapped drivers
// keep their track position and use their own lap number for tyre changes.
export function raceFlowData({ byDriver, positions, drivers, stints, result, start, totalLaps }, bands) {
  const ranks = new Map(), crossings = new Map(), field = new Map();
  for (const n of new Set(positions.filter(p => p.p > 0 && Number.isFinite(p.at)).map(p => p.n))) {
    const d = drivers.find(driver => String(driver.driver_number) === n);
    const laps = byDriver[n] || [], r = result[n];
    const tyres = stints.filter(s => String(s.driver_number) === n && s.lap_start > 0)
      .sort((a, b) => b.lap_start - a.lap_start || b.stint_number - a.stint_number);
    const lastLap = r?.dnf ? laps.findLast(l => l.n <= r.number_of_laps) : null;
    const retire = r?.dns || (r?.dnf && !r.number_of_laps) ? start : lastLap?.end || Infinity;
    field.set(n, { n, name: d?.full_name || n, code: d?.name_acronym || n,
      colour: hex(d?.team_colour), laps, tyres, retire });
  }
  const lapLimit = Object.values(result).find(r => r.position === 1)?.number_of_laps || totalLaps;
  let lights = Infinity;
  for (const laps of Object.values(byDriver)) {
    for (const [i, l] of laps.entries()) {
      if (l.n === 1) lights = Math.min(lights, l.start);
      const next = laps[i + 1];
      const at = next?.n === l.n + 1 ? next.start : l.recordedDuration > 0 ? l.end : null;
      if (at > l.start && l.n <= lapLimit) crossings.set(l.n, Math.min(at, crossings.get(l.n) ?? Infinity));
    }
  }
  const stops = [];
  let index = 0, previous = Number.isFinite(lights) ? lights : start, order = new Map();
  for (const [lap, at] of [[0, start], ...[...crossings].sort(([a], [b]) => a - b)]) {
    if (lap && at <= previous) continue;
    const cutoff = lap ? at : Math.max(start, previous - 1);
    while (index < positions.length && positions[index].at <= cutoff) {
      const p = positions[index++];
      if (p.p > 0) ranks.set(p.n, +p.p);
    }
    const entries = [...field.values()].filter(d => ranks.has(d.n) && (!lap || d.retire > previous))
      .sort((a, b) => ranks.get(a.n) - ranks.get(b.n) || (order.get(a.n) ?? Infinity) - (order.get(b.n) ?? Infinity))
      .map((d, i) => {
        const ownLap = d.laps.findLast(l => l.start <= at)?.n || 1;
        const compound = d.tyres.find(s => s.lap_start <= ownLap && (!s.lap_end || ownLap <= s.lap_end))?.compound;
        return { n: d.n, p: i + 1, compound };
      });
    order = new Map(entries.map(d => [d.n, d.p]));
    const flags = lap ? [...new Set(bands.filter(b => FLAG_NAMES[b.kind] && b.from < at && b.to > previous).map(b => b.kind))] : [];
    stops.push({ lap, at, order: entries, flags });
    if (lap) previous = at;
  }
  return { field, stops, lapLimit };
}

export const raceFlowMarkup = `
  <div class="race-flow-tools">
    <select class="pick" id="flowDriver" aria-label="Highlight driver" disabled><option value="">All drivers</option></select>
    <div class="race-flow-steps" role="group" aria-label="Step through laps">
      <button class="btn ghost" type="button" id="flowPrev" aria-label="Previous lap" disabled>‹</button>
      <button class="btn ghost" type="button" id="flowNext" aria-label="Next lap" disabled>›</button>
    </div>
  </div>
  <div id="flowChart"></div>`;

export function mountRaceFlow(el, { step, highlight }) {
  const chart = el.querySelector("#flowChart"), pick = el.querySelector("#flowDriver");
  const prev = el.querySelector("#flowPrev"), next = el.querySelector("#flowNext");
  let model, index = 0, key = "";
  prev.addEventListener("click", () => step(model.stops[index - 1].at));
  next.addEventListener("click", () => step(model.stops[index + 1].at));
  pick.addEventListener("change", () => highlight(pick.value || null));
  chart.addEventListener("click", e => {
    const driver = e.target.closest("button[data-driver]");
    if (driver) highlight(driver.dataset.driver);
  });
  return (data, at, selected) => {
    if (model !== data) {
      model = data;
      key = "";
      pick.disabled = model.stops.length < 2 || !model.field.size;
      pick.innerHTML = '<option value="">All drivers</option>' + [...model.field.values()].sort((a, b) => a.code.localeCompare(b.code))
        .map(d => `<option value="${esc(d.n)}">${esc(d.code)} · ${esc(d.name)}</option>`).join("");
    }
    index = Math.max(0, model.stops.findLastIndex(s => s.at <= at));
    const { lap } = model.stops[index];
    el.querySelector("#flowLap").textContent = lap ? `Lap ${lap}/${model.lapLimit}` : "Grid";
    prev.disabled = index === 0 || pick.disabled;
    next.disabled = index === model.stops.length - 1 || pick.disabled;
    pick.value = model.field.has(selected) ? selected : "";
    const frame = lap + ":" + pick.value;
    if (key === frame) return;
    key = frame;
    const focused = chart.contains(document.activeElement) ? document.activeElement.dataset.driver : null;
    chart.innerHTML = pick.disabled ? '<p class="note-line">Lap-by-lap positions are unavailable for this session.</p>' : draw(model, index, pick.value);
    if (focused) [...chart.querySelectorAll("button")].find(b => b.dataset.driver === focused)?.focus({ preventScroll: true });
  };
}

function draw({ field, stops }, index, selected) {
  const stop = stops[index], span = Math.min(HISTORY, stops.at(-1).lap);
  const first = Math.max(0, stop.lap - span);
  const visible = stops.slice(Math.max(0, index - span), index + 1).filter(s => s.lap >= first);
  const width = 1000, height = field.size * ROW, rowLines = Array.from({ length: field.size }, (_, i) => i + 1);
  const x = lap => width * (1 - (stop.lap - lap) / span), y = p => (p - .5) * ROW;
  const order = new Map(stop.order.map(d => [d.p, d]));
  const flags = new Set();
  const bands = visible.flatMap(s => s.flags.map(kind => {
    flags.add(kind);
    return `<rect class="flow-${kind}" x="${Math.max(0, x(s.lap - 1))}" y="0" width="${Math.min(width / span, x(s.lap))}" height="${height}"/>`;
  })).join("");
  const grid = rowLines.map(p => `<path d="M0 ${y(p)}H${width}"/>`).join("") +
    visible.map(s => `<path d="M${x(s.lap)} 0V${height}"/>`).join("");
  const traces = [...field.values()].sort((a, b) => Number(a.n === selected) - Number(b.n === selected)).map(d => {
    let last = -2;
    const path = visible.map(s => {
      const p = s.order.find(entry => entry.n === d.n)?.p;
      if (!p) return "";
      const op = s.lap === last + 1 ? "L" : "M";
      last = s.lap;
      return `${op}${x(s.lap)} ${y(p)}`;
    }).join("");
    return `<path class="flow-trace${selected && d.n !== selected ? " dimmed" : ""}" d="${path}" stroke="${d.colour}"/>`;
  }).join("");
  const labels = rowLines.map(p => {
    const entry = order.get(p);
    if (!entry) return "<span></span>";
    const d = field.get(entry.n), compound = entry.compound;
    return `<button type="button" data-driver="${esc(d.n)}" aria-pressed="${selected === d.n}" ${selected && selected !== d.n ? 'class="dimmed"' : ""}
      aria-label="${esc(`P${p} ${d.name}${TYRES[compound] ? ", " + compound.toLowerCase() + " tyres" : ""}`)}" style="--driver-colour:${d.colour}">
      <b>${esc(d.code)}</b>${TYRES[compound] ? tyreIcon(compound) : ""}</button>`;
  }).join("");
  return `<div class="race-flow-chart" style="--flow-row:${ROW}px">
    <div class="race-flow-axis" aria-hidden="true">${rowLines.map(p => `<span>${p}</span>`).join("")}</div>
    <svg class="race-flow-lines" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      ${bands}<g class="flow-grid">${grid}</g>${traces}</svg>
    <div class="race-flow-labels" role="group" aria-label="Running order">${labels}</div>
    <div class="race-flow-laps" aria-hidden="true">${visible.map(s => `<span style="left:${x(s.lap) * 100 / width}%">${s.lap ? "L" + s.lap : "Grid"}</span>`).join("")}</div>
  </div>
  ${flags.size ? `<div class="race-flow-key">${[...flags].map(k => `<span><i class="flow-${k}"></i>${FLAG_NAMES[k]}</span>`).join("")}</div>` : ""}`;
}
