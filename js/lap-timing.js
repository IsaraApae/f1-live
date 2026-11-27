// The live feed sends sector updates and the driver's completed-lap counter separately.
// Keep those deltas apart from the timing tower's merged view, which can hold old sector values.
const LATE_SPLIT_MS = 5000;

function duration(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(String(value))) return null;
  const time = String(value).split(":").reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(time) && time > 0 ? time : null;
}

function lapNumber(value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function liveLapHistory() {
  let session = null;
  const drivers = new Map();
  const newDriver = () => ({ completed: 0, end: -Infinity, pending: null, laps: new Map() });

  function setSession(key) {
    if (key === null || key === session) return;
    session = key;
    drivers.clear();
  }

  function snapshot(key, lines) {
    setSession(key);
    for (const [driver, line] of Object.entries(lines || {})) {
      const count = lapNumber(line?.NumberOfLaps);
      if (count === null) continue;
      const state = drivers.get(driver) || newDriver();
      drivers.set(driver, state);
      if (count < state.completed) continue;
      const pending = count === state.completed + 1 ? state.pending : null;
      if (count > state.completed) {
        state.completed = count;
        state.pending = null;
        state.end = -Infinity;
      }
      // The snapshot's last lap time is usable, but its sectors may be from the lap in progress.
      const time = duration(line.LastLapTime?.Value);
      if (count && (time || pending)) {
        const row = state.laps.get(count) || pending || { number: count, time: null, sectors: [null, null, null] };
        state.laps.set(count, { ...row, time: time ?? row.time });
      }
    }
  }

  function record(lines, at) {
    for (const [driver, line] of Object.entries(lines || {})) {
      const count = lapNumber(line?.NumberOfLaps);
      const time = duration(line?.LastLapTime?.Value);
      const sectors = [0, 1, 2].map(k => duration(line?.Sectors?.[k]?.Value));
      if (count === null && time === null && !sectors.some(Boolean)) continue;
      const state = drivers.get(driver) || newDriver();
      drivers.set(driver, state);
      if (count !== null && count < state.completed) continue;

      if (count !== null && count > state.completed) {
        const pending = count === state.completed + 1 ? state.pending : null;
        state.laps.set(count, { number: count, time: pending?.time ?? null, sectors: pending?.sectors ?? [null, null, null] });
        state.completed = count;
        state.end = at;
        state.pending = null;
      }
      if (time === null && !sectors.some(Boolean)) continue;
      // The finish-line update can arrive before the final sector or lap time.
      const finished = state.completed > 0 && Math.abs(at - state.end) <= LATE_SPLIT_MS;
      const number = state.completed + (finished ? 0 : 1);
      const previous = finished ? state.laps.get(number) : state.pending;
      const row = { number, time: time ?? previous?.time ?? null,
        sectors: sectors.map((sector, k) => sector ?? previous?.sectors[k] ?? null) };
      if (finished) state.laps.set(number, row);
      else state.pending = row;
    }
  }

  return {
    setSession, snapshot, record,
    laps(driver) { return [...(drivers.get(driver)?.laps.values() || [])]; }
  };
}
