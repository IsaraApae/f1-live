// The track map on a real map: the circuit where it really is (streets, water, 3D buildings), tilted or seen from above,
// with every car on it. MapLibre draws it with OpenFreeMap's free tiles (OpenStreetMap data).
// F1's track coordinates are in 10 cm units and already face north (checked on 2026 Singapore, Austin and Silverstone:
// within 1.3° and 11 m), so placing a circuit only takes matching its outline to the real one, from an open dataset of
// circuit shapes (github.com/bacinger/f1-circuits, MIT licence).
import { esc, ink } from "./util.js";

const LIB = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/";
const SHAPES = "https://cdn.jsdelivr.net/gh/bacinger/f1-circuits@8094e957b8d6aa8b9f4510c93968556cccd30e02/f1-circuits.geojson";
const STYLE = dark => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
const SECTOR_COLOURS = ["#ff3b5c", "#3b9eff", "#ffd60a"];

export const supported = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } };

let lib = null;
function loadLib() {
  return lib = lib || new Promise((ok, fail) => {
    if (window.maplibregl) return ok(window.maplibregl);
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = LIB + "maplibre-gl.min.css"; document.head.appendChild(css);
    const s = document.createElement("script"); s.src = LIB + "maplibre-gl.min.js"; s.async = true;
    s.onload = () => window.maplibregl ? ok(window.maplibregl) : fail(new Error("no maplibre"));
    s.onerror = () => { lib = null; fail(new Error("maplibre didn't load")); };
    document.head.appendChild(s);
  });
}
// start fetching the map library and the circuit shapes early, while the session itself loads
export function preload() { if (supported()) { loadLib().catch(() => {}); loadShapes().catch(() => {}); } }
let shapes = null;
const loadShapes = () => shapes = shapes || fetch(SHAPES).then(r => r.json()).then(d => d.features.map(f => f.geometry.coordinates)).catch(e => { shapes = null; throw e; });

// ---------- placing F1's outline on the real circuit ----------
function resample(pts, n) {   // n points evenly spaced along a closed line
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = d[d.length - 1], out = [];
  for (let k = 0, j = 1; k < n; k++) {
    const t = L * k / n; while (j < d.length - 1 && d[j] < t) j++;
    const u = (t - d[j - 1]) / ((d[j] - d[j - 1]) || 1), a = pts[j - 1], b = pts[j];
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}
const centre = P => { const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length; return [cx, cy, P.map(([x, y]) => [x - cx, y - cy])]; };
// { toLngLat(x, y) } for F1 coordinates, or null when no known circuit fits
export async function georef(xs, ys) {
  const all = await loadShapes(), N = 128;
  const [ax, ay, A] = centre(resample(xs.map((x, i) => [x * 0.1, ys[i] * 0.1]), N));   // metres
  const na = A.reduce((s, p) => s + p[0] ** 2 + p[1] ** 2, 0);
  let best = null;
  for (const g of all) {
    const lat0 = g.reduce((s, p) => s + p[1], 0) / g.length, lon0 = g.reduce((s, p) => s + p[0], 0) / g.length;
    const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540;
    const [bx, by, B] = centre(resample(g.map(([lon, lat]) => [(lon - lon0) * mx, (lat - lat0) * my]), N));
    const nb = B.reduce((s, p) => s + p[0] ** 2 + p[1] ** 2, 0);
    if (Math.abs(nb / na - 1) > 0.25) continue;   // a different size: another circuit
    for (const dir of [1, -1]) for (let s = 0; s < N; s++) {   // every starting point, both ways round
      let sxx = 0, sxy = 0;
      for (let i = 0; i < N; i++) { const a = A[i], b = B[((s + dir * i) % N + N) % N]; sxx += a[0] * b[0] + a[1] * b[1]; sxy += a[0] * b[1] - a[1] * b[0]; }
      const th = Math.atan2(sxy, sxx), proj = sxx * Math.cos(th) + sxy * Math.sin(th), sc = proj / na;
      if (Math.abs(th) > 0.17 || sc < 0.9 || sc > 1.1) continue;   // F1's frame faces north, at true scale
      const rms = Math.sqrt(Math.max(0, nb - proj * proj / na) / N);
      if (!best || rms < best.rms) best = { rms, th, sc, ax, ay, bx, by, lat0, lon0, mx, my };
    }
  }
  if (!best || best.rms > 40) return null;
  const { th, sc, bx, by, lat0, lon0, mx, my } = best, c = Math.cos(th), s = Math.sin(th);
  return { rms: best.rms, toLngLat: (x, y) => { const px = x * 0.1 - ax, py = y * 0.1 - ay; return [lon0 + (sc * (c * px - s * py) + bx) / mx, lat0 + (sc * (s * px + c * py) + by) / my]; } };
}

// ---------- the map ----------
const line = (coords, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
const point = (c, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: c } });
const fc = features => ({ type: "FeatureCollection", features });

// el: an empty box. Returns { setTrack, setPit, setFlags, setBattles, setZones, moveCar, dropCar, setLook, view, theme, resize, destroy }
export async function createMap(el, { dark, onCar }) {
  const ml = await loadLib();
  const map = new ml.Map({ container: el, style: STYLE(dark), attributionControl: { compact: true }, dragRotate: true, pitchWithRotate: true,
                           maxPitch: 70, fadeDuration: 0,
                           // on a touch screen the map sits in a long page: one finger scrolls the page, two move the map
                           cooperativeGestures: matchMedia("(pointer: coarse)").matches });
  map.touchZoomRotate.enableRotation();
  el._map = map;   // handy from the browser console
  const data = { trk: fc([]), pit: fc([]), flags: fc([]), bats: fc([]), zones: fc([]), corners: fc([]) };
  let mode = dark, bounds = null, bearing = 0, viewNow = "3d", blink = 0, trackPts = [];

  function decorate() {   // our layers on top of the base map (again after every change of style)
    const layers = map.getStyle().layers;
    for (const l of layers) if (/^poi|^airport|housenumber/.test(l.id)) map.removeLayer(l.id);   // fewer labels over the track
    // one layer that fails (an old browser) mustn't stop the rest
    const add = (l, before) => { try { if (!map.getLayer(l.id)) map.addLayer(l, before); } catch (e) { console.warn(e); } };
    const firstLabel = (map.getStyle().layers.find(l => l.type === "symbol") || {}).id;
    add({ id: "b3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14,
      paint: { "fill-extrusion-color": mode ? "#1d2130" : "#d8dbe2", "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6], "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0], "fill-extrusion-opacity": 0.85 } }, firstLabel);
    for (const [k, v] of Object.entries(data)) if (!map.getSource(k)) map.addSource(k, { type: "geojson", data: v });
    const w = (a, b, c) => ["interpolate", ["exponential", 1.6], ["zoom"], 12, a, 15, b, 18, c];
    add({ id: "pit", type: "line", source: "pit", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": mode ? "#8d93a8" : "#7a8194", "line-width": w(1, 2.5, 8), "line-dasharray": [2, 1.5] } });
    add({ id: "trk-edge", type: "line", source: "trk", filter: ["==", ["get", "k"], "edge"], layout: { "line-cap": "round", "line-join": "round" },
                   paint: { "line-color": mode ? "#e8e8ee" : "#22232b", "line-width": w(3, 8, 26) } });
    add({ id: "trk-sec", type: "line", source: "trk", filter: ["in", ["get", "k"], ["literal", ["s1", "s2", "s3"]]], layout: { "line-cap": "round", "line-join": "round" },
                   paint: { "line-color": ["match", ["get", "k"], "s1", SECTOR_COLOURS[0], "s2", SECTOR_COLOURS[1], SECTOR_COLOURS[2]], "line-width": w(1.2, 3.5, 12) } });
    add({ id: "start", type: "line", source: "trk", filter: ["==", ["get", "k"], "start"], paint: { "line-color": "#ffffff", "line-width": w(2, 4, 10) } });
    add({ id: "flags", type: "line", source: "flags", layout: { "line-cap": "round", "line-join": "round" },
                   paint: { "line-color": ["match", ["get", "k"], "red", "#e10600", "sc", "#f59e0b", "#facc15"],
                            "line-width": w(["match", ["get", "k"], "yellow", 4, 5], ["match", ["get", "k"], "yellow", 10, 12], ["match", ["get", "k"], "yellow", 30, 34]), "line-opacity": 0.9 } }, "trk-sec");
    add({ id: "bats", type: "line", source: "bats", layout: { "line-cap": "round" }, paint: { "line-color": "#f59e0b", "line-width": w(2, 4, 10), "line-opacity": 0.8 } });
    add({ id: "zones", type: "circle", source: "zones", paint: { "circle-color": "rgba(245,158,11,.4)", "circle-stroke-color": "#f59e0b", "circle-stroke-width": 1.5,
                   "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, ["*", ["get", "r"], 0.6], 15, ["*", ["get", "r"], 1.2], 18, ["*", ["get", "r"], 3]] } });
    add({ id: "zones-n", type: "symbol", source: "zones", layout: { "text-field": ["to-string", ["get", "n"]], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-allow-overlap": true },
                   paint: { "text-color": mode ? "#fff" : "#111" } });
    add({ id: "corners", type: "circle", source: "corners", minzoom: 13.5, paint: { "circle-color": mode ? "#2a2a38" : "#ffffff", "circle-radius": 8, "circle-stroke-color": mode ? "#3a3a4a" : "#c9ccd6", "circle-stroke-width": 1 } });
    add({ id: "corners-n", type: "symbol", source: "corners", minzoom: 13.5, layout: { "text-field": ["to-string", ["get", "n"]], "text-font": ["Noto Sans Bold"], "text-size": 9.5, "text-allow-overlap": true, "text-ignore-placement": true },
                   paint: { "text-color": mode ? "#a0a0ae" : "#555a66" } });
  }
  map.on("style.load", decorate);
  const ready = new Promise(ok => map.once("load", ok));
  // the map data's licence asks for the credit on the map: shown at first, then folded into the small ⓘ button
  ready.then(() => setTimeout(() => {
    const a = el.querySelector(".maplibregl-ctrl-attrib");
    if (a) { a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); }
  }, 4000));

  // cars: a tag in the team colour standing up over a dot on the track (DOM markers, so they stay upright when tilted)
  const cars = new Map();
  function moveCar(n, at, d) {
    let c = cars.get(n);
    if (!c) {
      const e = document.createElement("div");
      e.className = "gcar"; e.style.setProperty("--tc", d.colour); e.style.setProperty("--tcf", ink(d.colour));
      e.innerHTML = `<span class="gtag"><b>${esc(d.num)}</b><i>${esc(d.tla)}</i></span><span class="gstem"></span><span class="gdot"></span>`;
      e.addEventListener("click", ev => { ev.stopPropagation(); onCar(n); });
      // anchored by its bottom, moved down half the dot: the dot's centre is the car's place
      c = { e, m: new ml.Marker({ element: e, anchor: "bottom", offset: [0, 6] }).setLngLat(at).addTo(map), look: "" };
      cars.set(n, c);
    }
    c.m.setLngLat(at);
    if (c.z !== d.z) { c.z = d.z; c.e.style.zIndex = String(d.z); }   // the leader's tag on top
  }
  function setLook(n, look) {   // f: someone else followed (fade), F: followed, b: in a battle, p: in the pit lane
    const c = cars.get(n); if (!c || c.look === look) return;
    c.look = look; c.e.classList.toggle("fade", look.includes("f")); c.e.classList.toggle("fol", look.includes("F"));
    c.e.classList.toggle("bat", look.includes("b")); c.e.classList.toggle("pit", look.includes("p"));
  }
  function dropCar(n) { const c = cars.get(n); if (c) { c.m.remove(); cars.delete(n); } }
  const set = (k, v) => { data[k] = v; const s = map.getSource(k); if (s) s.setData(v); };

  function camera(animate) {
    if (!bounds || !el.clientWidth) return;
    map.resize();   // its box may have just been shown
    const pad = { top: 34, bottom: 22, left: 22, right: 22 };
    map.jumpTo({ padding: pad, bearing, pitch: 0 });
    map.fitBounds(bounds, { padding: pad, bearing, pitch: 0, duration: 0 });
    fitShape(pad);
    if (viewNow === "3d") { map.jumpTo({ pitch: 55 }); fitShape(pad); }   // tilted, the circuit squashes: fit it again
    if (animate) { const cam = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }; map.jumpTo({ pitch: viewNow === "3d" ? 0 : 55 }); map.easeTo({ ...cam, duration: 700 }); }
  }
  // fitBounds fits the turned box around the circuit: fit the circuit's own shape instead, so it fills the map
  // (twice: when tilted, moving the camera changes the shape a little)
  function fitShape(pad) {
    if (!trackPts.length) return;
    const W = el.clientWidth - pad.left - pad.right, H = el.clientHeight - pad.top - pad.bottom;
    for (let i = 0; i < 2; i++) {
      const P = trackPts.map(c => map.project(c)), xs = P.map(p => p.x), ys = P.map(p => p.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const k = Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0));
      // with padding set, the centre goes to the middle of the padded area
      map.jumpTo({ center: map.unproject([(x0 + x1) / 2, (y0 + y1) / 2]), zoom: map.getZoom() + Math.log2(k) - 0.02, padding: pad });
    }
  }
  // the box can start hidden (a phone's other sub-tab) or change size: frame the circuit again, unless you've moved the map yourself
  let moved = false;
  for (const ev of ["dragstart", "zoomstart", "rotatestart", "pitchstart"]) map.on(ev, e => { if (e.originalEvent) moved = true; });
  const ro = new ResizeObserver(() => { map.resize(); if (!moved) camera(false); });
  ro.observe(el);
  // yellow sectors flash
  const flash = setInterval(() => { if (map.getLayer("flags") && data.flags.features.some(f => f.properties.k === "yellow" || f.properties.k === "double")) map.setPaintProperty("flags", "line-opacity", (blink ^= 1) ? 0.95 : 0.25); }, 500);

  await ready;
  return {
    // the track as [lng, lat] points (closed loop), where sectors 1 and 2 end (indexes), the start line, and the corner numbers
    setTrack(pts, cut, rotation, corners) {
      trackPts = pts;
      const feats = [line([...pts, pts[0]], { k: "edge" })];
      if (cut) for (let k = 0; k < 3; k++) feats.push(line(pts.slice(cut[k], cut[k + 1] + 1).concat(k === 2 ? [pts[0]] : []), { k: "s" + (k + 1) }));
      // the start line: a short bar across the track at its first point
      const [a, b] = [pts[0], pts[2]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, s = 0.00012;
      feats.push(line([[a[0] - dy / L * s, a[1] + dx / L * s], [a[0] + dy / L * s, a[1] - dx / L * s]], { k: "start" }));
      set("trk", fc(feats));
      set("corners", fc((corners || []).map(c => point(c.at, { n: c.n }))));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const nb = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
      const moved = !bounds || Math.abs(nb[0][0] - bounds[0][0]) + Math.abs(nb[0][1] - bounds[0][1]) > 0.005;   // a different circuit: frame it
      // turned like the classic map (its rotation turns the circuit anticlockwise; so does a map's bearing)
      bounds = nb; bearing = rotation || 0;
      if (moved) camera(false);
    },
    setPit(pts) { set("pit", fc(pts && pts.length > 1 ? [line(pts)] : [])); },
    setFlags(list) { set("flags", fc(list.map(f => line(f.pts, { k: f.k })))); if (!list.length && map.getLayer("flags")) map.setPaintProperty("flags", "line-opacity", 0.9); },
    setBattles(pairs) { set("bats", fc(pairs.map(p => line(p)))); },
    setZones(list) { set("zones", fc(list.map(z => point(z.at, { n: z.n, r: z.r })))); },
    moveCar, dropCar, setLook,
    cars: () => [...cars.keys()],
    view(v) { viewNow = v; moved = false; camera(true); },   // picking a view frames the circuit again
    theme(d) { if (d === mode) return; mode = d; map.setStyle(STYLE(d), { diff: false }); },
    resize() { map.resize(); },
    destroy() { clearInterval(flash); ro.disconnect(); for (const n of [...cars.keys()]) dropCar(n); map.remove(); }
  };
}
