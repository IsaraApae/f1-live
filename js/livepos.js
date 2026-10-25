// Live: where each car is between F1's timing marks.
// F1's free feed only says when a car passes each mini-sector mark (about 20 a lap), and its messages come a little late,
// sometimes two at once. Between marks a car goes at its own pace through each mini-sector on its last lap (slow in the
// corners, fast on the straights), and the drawn car never jumps or goes backwards: it runs a little faster or slower until
// it is back where the marks put it. More than a fifth of a lap out (just out of the pits, the page just opened), it goes
// straight there.
const CLOSE_MS = 1500;   // how long a drawn car takes to make up a gap to where the marks put it
const SLOWEST = 0.5;   // ahead of the marks: the slowest it goes, as a share of its pace (the marks are the ones that are late)
const AHEAD = 3;         // a mark that's late: keep going this many mini-sectors past the last one, then wait for it

export function liveTracker() {
  const cars = {}, ends = [], seen = [];   // ends[k]: where mini-sector k ends, as a fraction of the lap: the middle of the last 5 clean laps'
  // (seen[k]), so a lap whose line crossing came late doesn't shift them
  const end = (k, total) => k < 0 ? 0 : k >= total - 1 ? 1 : ends[k] != null ? ends[k] : (k + 1) / total;

  // n mini-sectors passed so far this lap (out of total), as of ts; lapMs: the car's last lap time
  function mark(num, n, total, ts, lapMs) {
    const c = cars[num] || (cars[num] = { lap: 0, n: -1, marks: [], dur: [], lapMs: 0, total });
    c.total = total; if (lapMs > 0) c.lapMs = lapMs;
    if (n === c.n) return;
    const first = c.n < 0;
    if (n < c.n) {   // the marks reset: a new lap began at the last lap's final mark
      const last = c.marks[c.total - 1];
      if (c.start && last && c.marks.filter(Boolean).length === c.total && Math.abs(last - c.start - c.lapMs) < 2000)
        for (let k = 0; k < c.total - 1; k++) {   // a clean lap seen whole: where each mini-sector ends
          const s = seen[k] = (seen[k] || []).concat((c.marks[k] - c.start) / (last - c.start)).slice(-5);
          ends[k] = s.slice().sort((a, b) => a - b)[s.length >> 1];
        }
      c.start = last || null; c.marks = []; c.n = 0; c.lap++;
    }
    const alone = n - Math.max(0, c.n) === 1;   // one mark on its own: its time is good enough to time the mini-sector by
    for (let k = Math.max(0, c.n); k < n; k++) {
      const from = k ? c.marks[k - 1] : c.start, want = (end(k, total) - end(k - 1, total)) * (c.lapMs || 100000);
      if (alone && !first && from) {
        const d = ts - from;
        if (d > want * 0.3 && d < want * 3) c.dur[k] = c.dur[k] ? c.dur[k] * 0.5 + d * 0.5 : d;
      }
      c.marks[k] = ts;
    }
    if (first) c.lap = 0;
    c.n = n; c.at = ts;
  }

  // where the marks put a car at time t (in laps, counting on from lap to lap), and how fast it's going (laps per ms)
  function predict(c, t) {
    let k = c.n, pos = c.lap + end(k - 1, c.total), left = t - c.at;
    for (let step = 0; step < AHEAD; step++, k++) {
      const i = k % c.total, len = end(i, c.total) - end(i - 1, c.total);
      const d = c.dur[i] || len * (c.lapMs || 100000);
      if (left < d) return [pos + len * Math.max(0, left) / d, len / d];
      pos += len; left -= d;
    }
    return [pos, 0];   // the next mark is very late: wait for it here
  }

  // the drawn car's place (a fraction of the lap) at time t, dt ms after the last frame
  function place(num, t, dt) {
    const c = cars[num]; if (!c || c.n < 0 || !c.total) return null;
    const [p, v] = predict(c, t);
    if (c.shown == null || Math.abs(p - c.shown) > 0.2) c.shown = p;
    else {
      const most = Math.max(v, 1 / 60000) * 2.5;   // at most 2.5 times its pace when catching up
      c.shown += Math.max(v * SLOWEST, Math.min(most, v + (p - c.shown) / CLOSE_MS)) * Math.min(dt, 100);
    }
    return c.shown - Math.floor(c.shown);
  }

  return {
    mark, place,
    jump(num) { if (cars[num]) cars[num].shown = null; },   // the next place goes straight to where the marks say
    clear() { for (const k in cars) delete cars[k]; ends.length = seen.length = 0; },
    ends
  };
}
