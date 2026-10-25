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
// the camera views that ride with a car (the one you follow, else the leader): where the camera is and what it looks at,
// in metres along the car's way (fwd) and to its left, and its height
const RIDES = {
  heli: { from: [-42, -14, 36], to: [22, 0, 0] },               // a helicopter high above and behind
  road: { from: [-7, 0, 3.2], to: [6, 0, 0], fov: 42 },         // above and behind, looking down on the car (a chase camera)
  driver: { from: [-.75, 0, 1.2], to: [9, 0, 0], fov: 62 }      // just behind the driver's head: your cockpit, halo and steering wheel
};
const FOV = 36.87;   // MapLibre's own (vertical, in degrees)

const ROAD = 14, PIT_ROAD = 12, GRASS = 70;   // track, pit lane and the grass along them, wide in metres, for the views up close
const GARAGE = 11, BOX = 12;   // the garages: how deep and how wide each is (metres)
// up close it's always a clean, bright day// up close it's always a clean, bright day (whatever the theme): pale ground, mint grass along the track, white buildings, blue sky
const DAY = { ground: "#e7e8eb", water: "#a9d4f1", grass: "#c4e8b4", asphalt: "#474a51", buildings: "#f3f4f6" };
const SKY = { "sky-color": "#79b6ea", "horizon-color": "#e4f0fa", "fog-color": "#eef2f6", "sky-horizon-blend": .55, "horizon-fog-blend": .5, "fog-ground-blend": .85 };

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
                           maxPitch: 85, maxZoom: 24, fadeDuration: 0, cooperativeGestures: false });
  map.touchZoomRotate.enableRotation();
  el._map = map;   // handy from the browser console
  // up close: a mini-map of the circuit in the corner, every car on it and the one the camera rides with ringed (ride())
  const mini = document.createElement("div");
  mini.className = "minimap"; mini.hidden = true; mini.setAttribute("aria-hidden", "true");
  el.appendChild(mini);
  const data = { trk: fc([]), pit: fc([]), flags: fc([]), bats: fc([]), corners: fc([]), kerbs: fc([]), pitlane: fc([]), pitbuild: fc([]) };
  let base = [];   // the base map's own layers (decorate)
  let mode = dark, bounds = null, bearing = 0, viewNow = "3d", blink = 0, trackPts = [], lat = 0;
  const riding = () => !!RIDES[viewNow];
  // a width in metres as a line width at any zoom (MapLibre's 512-pixel tiles: 78271.5 m a pixel at zoom 0, at the equator)
  const metres = (m, k = 1) => ["interpolate", ["exponential", 2], ["zoom"], 12, k * m / (78271.517 * Math.cos(lat * Math.PI / 180) / 2 ** 12), 24, k * m / (78271.517 * Math.cos(lat * Math.PI / 180) / 2 ** 24)];

  // which buildings count as near the track: until there is a track, all of them are "far"
  const NEAR = 120, TALL = 2.5;   // buildings drawn 2.5 times their real height, so the city stands out
  let trackLine = null;
  let laneLine = null;   // the pit lane up close: the base map's buildings on it give way to ours (pitLane)
  function nearFilters() {
    if (!map.getLayer("b3d")) return;
    try {
      const off = riding() && laneLine ? [[">=", ["distance", laneLine], PIT_ROAD / 2 + GARAGE + 6]] : [];
      map.setFilter("b3d", trackLine ? ["all", [">=", ["distance", trackLine], NEAR], ...off] : null);
      map.setFilter("b3d-near", trackLine ? ["all", ["<", ["distance", trackLine], NEAR], ...off] : ["boolean", false]);
    } catch (e) { map.setFilter("b3d", null); }   // a MapLibre without "distance": every building as before
  }
  function decorate() {   // our layers on top of the base map (again after every change of style)
    const layers = map.getStyle().layers;
    for (const l of layers) if (/^poi|^airport|housenumber/.test(l.id)) map.removeLayer(l.id);   // fewer labels over the track
    base = map.getStyle().layers.map(l => ({ id: l.id, type: l.type, shown: (l.layout || {}).visibility !== "none", water: /water/.test(l.id) || l["source-layer"] === "water",
                                             colour: (l.paint || {})[l.type === "background" ? "background-color" : "fill-color"] }));
    // one layer that fails (an old browser) mustn't stop the rest
    const add = (l, before) => { try { if (!map.getLayer(l.id)) map.addLayer(l, before); } catch (e) { console.warn(e); } };
    const firstLabel = (map.getStyle().layers.find(l => l.type === "symbol") || {}).id;
    // 3D buildings, easy to see; those within NEAR metres of the track (the ones that could stand in front of it) see-through
    const b3d = (id, opacity) => ({ id, type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13, filter: ["boolean", false],
      paint: { "fill-extrusion-color": mode ? "#414a63" : "#bfc5d1", "fill-extrusion-height": ["*", TALL, ["coalesce", ["get", "render_height"], 8]],
               "fill-extrusion-base": ["*", TALL, ["coalesce", ["get", "render_min_height"], 0]], "fill-extrusion-opacity": opacity, "fill-extrusion-vertical-gradient": true } });
    add(b3d("b3d", 0.95), firstLabel);
    add(b3d("b3d-near", 0.16), firstLabel);
    nearFilters();
    for (const [k, v] of Object.entries(data)) if (!map.getSource(k)) map.addSource(k, { type: "geojson", data: v });
    const w = (a, b, c) => ["interpolate", ["exponential", 1.6], ["zoom"], 12, a, 15, b, 18, c];
    // up close (the views that ride with a car): grass along the track, the track and pit lane as roads at their real width
    // with white edges and red and white kerbs in the corners, and 3D cars (widths: roadWidths)
    const ride = { visibility: riding() ? "visible" : "none" }, round = { ...ride, "line-cap": "round", "line-join": "round" }, edge = ["==", ["get", "k"], "edge"];
    add({ id: "grass", type: "line", source: "trk", filter: edge, layout: round, paint: { "line-color": DAY.grass, "line-blur": 3 } });
    add({ id: "road-pit", type: "line", source: "pitlane", filter: ["==", ["get", "k"], "lane"], layout: round, paint: { "line-color": "#53565d" } });
    add({ id: "pit-lines", type: "line", source: "pitlane", filter: ["==", ["get", "k"], "edge"], layout: { ...ride, "line-join": "round" }, paint: { "line-color": "#f4f4f6" } });
    add({ id: "pit-div", type: "line", source: "pitlane", filter: ["==", ["get", "k"], "div"], layout: ride, paint: { "line-color": "#f4f4f6", "line-dasharray": [6, 6] } });
    add({ id: "road", type: "line", source: "trk", filter: edge, layout: round, paint: { "line-color": DAY.asphalt } });
    for (const side of [1, -1]) {
      add({ id: "kerb-w" + side, type: "line", source: "kerbs", layout: ride, paint: { "line-color": "#f2f2f4" } });
      add({ id: "kerb-r" + side, type: "line", source: "kerbs", layout: ride, paint: { "line-color": "#d3202a", "line-dasharray": [1, 1] } });
      add({ id: "road-edge" + side, type: "line", source: "trk", filter: edge, layout: { ...ride, "line-join": "round" }, paint: { "line-color": "#f4f4f6" } });
    }
    // pit wall and garages (solid), the debris fence and the garage roofs (see-through, so cars inside still show)
    for (const [id, ks, op] of [["pit-build", ["wall", "garage"], 1], ["pit-fence", ["fence"], .3], ["pit-roof", ["roof"], .45]])
      add({ id, type: "fill-extrusion", source: "pitbuild", filter: ["in", ["get", "k"], ["literal", ks]], layout: ride,
            paint: { "fill-extrusion-color": ["get", "c"], "fill-extrusion-base": ["get", "b"], "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": op } });
    roadWidths();
    try { map.setSky(SKY); } catch (e) {}
    addCars();
    add({ id: "pit", type: "line", source: "pit", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": mode ? "#8d93a8" : "#7a8194", "line-width": w(1, 2.5, 8), "line-dasharray": [2, 1.5] } });
    add({ id: "trk-edge", type: "line", source: "trk", filter: ["==", ["get", "k"], "edge"], layout: { "line-cap": "round", "line-join": "round" },
                   paint: { "line-color": mode ? "#e8e8ee" : "#22232b", "line-width": w(3, 8, 26) } });
    add({ id: "trk-sec", type: "line", source: "trk", filter: ["in", ["get", "k"], ["literal", ["s1", "s2", "s3"]]], layout: { "line-cap": "round", "line-join": "round" },
                   paint: { "line-color": ["match", ["get", "k"], "s1", SECTOR_COLOURS[0], "s2", SECTOR_COLOURS[1], SECTOR_COLOURS[2]], "line-width": w(1.2, 3.5, 12) } });
    add({ id: "start", type: "line", source: "trk", filter: ["==", ["get", "k"], "start"], paint: { "line-color": "#ffffff", "line-width": w(2, 4, 10) } });
    add({ id: "flags", type: "line", source: "flags", layout: { "line-cap": "round", "line-join": "round" },
                   paint: { "line-color": ["match", ["get", "k"], "red", "#e10600", "sc", "#f59e0b", "#facc15"],
                            "line-width": w(["match", ["get", "k"], "yellow", 4, 5], ["match", ["get", "k"], "yellow", 10, 12], ["match", ["get", "k"], "yellow", 30, 34]), "line-opacity": 0.9, "line-opacity-transition": { duration: 0 } } }, "trk-sec");
    add({ id: "bats", type: "line", source: "bats", layout: { "line-cap": "round" }, paint: { "line-color": "#f59e0b", "line-width": w(2, 4, 10), "line-opacity": 0.8 } });
    add({ id: "corners", type: "circle", source: "corners", minzoom: 13.5, paint: { "circle-color": mode ? "#2a2a38" : "#ffffff", "circle-radius": 8, "circle-stroke-color": mode ? "#3a3a4a" : "#c9ccd6", "circle-stroke-width": 1 } });
    add({ id: "corners-n", type: "symbol", source: "corners", minzoom: 13.5, layout: { "text-field": ["to-string", ["get", "n"]], "text-font": ["Noto Sans Bold"], "text-size": 9.5, "text-allow-overlap": true, "text-ignore-placement": true },
                   paint: { "text-color": mode ? "#a0a0ae" : "#555a66" } });
  }
  map.on("style.load", decorate);
  function roadWidths() {   // widths in metres (again for a new circuit: they depend on its latitude)
    const p = (id, k, v) => { try { if (map.getLayer(id)) map.setPaintProperty(id, k, v); } catch (e) {} };
    p("grass", "line-width", metres(GRASS)); p("road", "line-width", metres(ROAD)); p("road-pit", "line-width", metres(PIT_ROAD));
    p("pit-lines", "line-width", metres(.25)); p("pit-div", "line-width", metres(.2));
    for (const side of [1, -1]) {
      p("road-edge" + side, "line-width", metres(.35)); p("road-edge" + side, "line-offset", metres(ROAD / 2 - .4, side));
      for (const k of ["kerb-w", "kerb-r"]) { p(k + side, "line-width", metres(1.2)); p(k + side, "line-offset", metres(ROAD / 2 + .6, side)); }
    }
  }
  function showRide() {   // up close: the road and 3D cars; from afar: the coloured track and dots
    const on = riding(), vis = (id, show) => { try { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", show ? "visible" : "none"); } catch (e) {} };   // (before the style loads: its style.load does it)
    for (const id of ["grass", "road", "road-pit", "pit-lines", "pit-div", "pit-build", "pit-fence", "pit-roof", "road-edge1", "road-edge-1", "kerb-w1", "kerb-w-1", "kerb-r1", "kerb-r-1", "cars3d"]) vis(id, on);
    if (on) loadCars();
    // the clean look: of the base map only the ground and water, in daytime colours (from afar: the base map as it was)
    const paintOf = l => l.type === "background" ? "background-color" : "fill-color";
    for (const l of base) {
      if (l.type === "background" || (l.water && l.type === "fill")) { vis(l.id, l.shown); try { map.setPaintProperty(l.id, paintOf(l), on ? (l.water ? DAY.water : DAY.ground) : l.colour); } catch (e) {} }
      else vis(l.id, l.shown && (!on || l.water));
    }
    mini.hidden = !on;
    nearFilters();
    // buildings at their real height up close, and solid (from afar: taller, and the ones by the track see-through)
    const tall = on ? 1 : TALL, pp = (id, k, v) => { try { if (map.getLayer(id)) map.setPaintProperty(id, k, v); } catch (e) {} };
    for (const id of ["b3d", "b3d-near"]) { pp(id, "fill-extrusion-height", ["*", tall, ["coalesce", ["get", "render_height"], 8]]); pp(id, "fill-extrusion-base", ["*", tall, ["coalesce", ["get", "render_min_height"], 0]]); }
    pp("b3d-near", "fill-extrusion-opacity", on ? .9 : .16);
    for (const id of ["b3d", "b3d-near"]) pp(id, "fill-extrusion-color", on ? DAY.buildings : mode ? "#414a63" : "#bfc5d1");
    try {   // up close the buildings go over the ground layers (the ground never hides a building); from afar the track goes over them
      const under = on ? "cars3d" : (map.getStyle().layers.find(l => l.type === "symbol") || {}).id;
      for (const id of ["b3d", "b3d-near"]) if (map.getLayer(id) && (!under || map.getLayer(under))) map.moveLayer(id, under);
    } catch (e) {}
    if (!on) { for (const c of cars.values()) c.e.classList.remove("away"); try { map.transform.fov = FOV; } catch (e) {} }
    for (const id of ["trk-edge", "trk-sec", "pit", "corners", "corners-n", "bats"]) vis(id, !on);
    el.classList.toggle("riding", on);
    for (const v of Object.keys(RIDES)) el.classList.toggle(v, v === viewNow);
    if (on) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  }
  map.on("style.load", () => showRide());
  const ready = new Promise(ok => map.once("load", ok));
  // the map data's licence asks for the credit on the map: shown at first, then folded into the small ⓘ button
  // the map data's licence (OpenStreetMap) asks for its credit on the map: kept as the small ⓘ button, folded from the start
  // (MapLibre opens it again as the credits load; it stays folded unless you tap the ⓘ yourself)
  let tapped = false;
  el.addEventListener("click", e => { if (e.target.closest(".maplibregl-ctrl-attrib-button")) tapped = true; }, true);
  const fold = () => { const a = el.querySelector(".maplibregl-ctrl-attrib"); if (a && !tapped) { a.classList.add("maplibregl-compact"); a.classList.remove("maplibregl-compact-show"); a.removeAttribute("open"); } };
  ready.then(fold);
  for (const ev of ["styledata", "sourcedata", "resize"]) map.on(ev, () => requestAnimationFrame(fold));

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
    // which way it's moving: from where it was a metre or more back (so a car standing still keeps its heading)
    const m = metresBetween(c.back || at, at);
    if (!c.back || m > 1) {
      if (c.back && m < 60) { c.mx = (at[0] - c.back[0]) * Math.cos(lat * Math.PI / 180) * M / m; c.my = (at[1] - c.back[1]) * M / m; }
      c.back = at;
    }
    c.at = at; c.colour = d.colour; c.num = d.num; c.tyre = d.tyre;
    if (d.cam !== c.cam) { c.cam = d.cam; c.e.classList.toggle("camcar", !!d.cam); }
    if (d.cam) camCar = n;
    if (riding() && !frame) { frame = 1; queueMicrotask(ride); }   // once all the cars have moved this frame
  }
  const M = 111320, metresBetween = (a, b) => Math.hypot((b[0] - a[0]) * M * Math.cos(lat * Math.PI / 180), (b[1] - a[1]) * M);
  const along = (c, fwd, left) => {   // a point fwd metres ahead of a car and left metres to its left
    const L = Math.hypot(c.hx || 0, c.hy || 0) || 1, ux = (c.hx || 1) / L, uy = (c.hy || 0) / L, k = Math.cos(lat * Math.PI / 180);
    return [c.at[0] + (ux * fwd - uy * left) / (M * k), c.at[1] + (uy * fwd + ux * left) / M];
  };
  // the circuit in metres east (x) and north (y) of its first point, and which way it runs at each point
  let tm = null;
  const toM = p => [(p[0] - tm.x0) * M * tm.k, (p[1] - tm.y0) * M];
  function trackMetres(pts) {
    const x0 = pts[0][0], y0 = pts[0][1], k = Math.cos(y0 * Math.PI / 180), n = pts.length;
    const P = pts.map(p => [(p[0] - x0) * M * k, (p[1] - y0) * M]);
    const T = P.map((p, i) => { const a = P[(i - 2 + n) % n], b = P[(i + 2) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; });
    tm = { x0, y0, k, P, T };
    if (car3) car3.origin([x0, y0]);
    pitLane();
    // kerbs where the track turns tighter than a 125 m radius, a little past each end
    const bend = P.map((p, i) => {
      const a = T[(i - 4 + n) % n], b = T[(i + 4) % n], q = P[(i - 4 + n) % n], r = P[(i + 4) % n];
      return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) / (Math.hypot(r[0] - q[0], r[1] - q[1]) || 1) > 1 / 125;
    });
    const kerbs = [];
    for (let i = 0; i < n; i++) {
      if (!bend[i] || bend[(i - 1 + n) % n] && i) continue;
      let e = i; while (e + 1 < n && bend[e + 1]) e++;
      const run = pts.slice(Math.max(0, i - 3), Math.min(n, e + 4));
      if (run.length > 4) kerbs.push(line(run));
      i = e;
    }
    set("kerbs", fc(kerbs));
  }
  // the pit lane up close, from the path a car drove through it: smoothed into the lane's middle, only the part away from the
  // track; white edges and the line between the fast and working lanes; the pit wall and its fence on the track's side, and a row
  // of garages (back wall, a divider every BOX metres, a roof) on the other
  let pitPts = [];
  const fromM = ([x, y]) => [tm.x0 + x / (M * tm.k), tm.y0 + y / M];
  function pitLane() {
    laneLine = null; set("pitlane", fc([])); set("pitbuild", fc([]));
    if (!tm || pitPts.length < 5) return;
    let P = pitPts.map(toM);
    const R = []; let d = 0;   // every 2 m along it (d: how far into the next piece the next point is)
    for (let i = 1; i < P.length; i++) {
      const [a, b] = [P[i - 1], P[i]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (; d < L; d += 2) R.push([a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L]);
      d -= L;
    }
    if (R.length < 20) return;
    for (let pass = 0; pass < 2; pass++)   // smooth over about 40 m: the drive into and out of a box straightens into the lane
      P = R.map((_, i) => { let x = 0, y = 0, n = 0; for (let j = Math.max(0, i - 10); j <= Math.min(R.length - 1, i + 10); j++) { x += R[j][0]; y += R[j][1]; n++; } return [x / n, y / n]; }), R.splice(0, R.length, ...P);
    // which way the track is, and how far: the lane proper is where it's at least 12 m off the track
    const near = P.map(p => { let best = Infinity, at = null; for (const q of tm.P) { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < best) { best = d; at = q; } } return [Math.sqrt(best), at]; });
    let run = [0, -1];
    for (let i = 0, start = -1; i <= P.length; i++) {
      const ok = i < P.length && near[i][0] > 12;
      if (ok && start < 0) start = i;
      if (!ok && start >= 0) { if (i - start > run[1] - run[0]) run = [start, i]; start = -1; }
    }
    if (run[1] - run[0] < 15) return;
    const lane = P.slice(run[0], run[1]), nl = near.slice(run[0], run[1]);
    const tan = lane.map((p, i) => { const a = lane[Math.max(0, i - 2)], b = lane[Math.min(lane.length - 1, i + 2)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; });
    const left = tan.map(([x, y]) => [-y, x]);
    let side = 0; lane.forEach((p, i) => { const q = nl[i][1]; side += Math.sign((q[0] - p[0]) * left[i][0] + (q[1] - p[1]) * left[i][1]); });
    const wall = side >= 0 ? 1 : -1, W = PIT_ROAD / 2;   // wall: the track's side (1: to the left of the way cars go)
    const at = (i, off, fwd = 0) => fromM([lane[i][0] + left[i][0] * off + tan[i][0] * fwd, lane[i][1] + left[i][1] * off + tan[i][1] * fwd]);
    const offLine = off => lane.map((_, i) => at(i, off));
    set("pitlane", fc([line(lane.map(fromM), { k: "lane" }), line(offLine(W - .3), { k: "edge" }), line(offLine(-W + .3), { k: "edge" }), line(offLine(-wall), { k: "div" })]));
    laneLine = { type: "LineString", coordinates: lane.filter((_, i) => i % 3 === 0).map(fromM) };
    const quad = (i, j, o1, o2, props, f1 = 0, f2 = 0) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[at(i, o1, f1), at(j, o1, f2), at(j, o2, f2), at(i, o2, f1), at(i, o1, f1)]] } });
    const feats = [];
    for (let i = 0; i + 2 < lane.length; i += 2) {
      const j = i + 2;
      feats.push(quad(i, j, wall * (W + .8), wall * (W + 1.4), { k: "wall", b: 0, h: 1.1, c: "#d6d7dc" }));
      feats.push(quad(i, j, wall * (W + 1.05), wall * (W + 1.15), { k: "fence", b: 1.1, h: 3.8, c: "#3a3d44" }));
      feats.push(quad(i, j, -wall * (W + 2 + GARAGE), -wall * (W + 2.4 + GARAGE), { k: "garage", b: 0, h: 7, c: "#f1f2f4" }));
      feats.push(quad(i, j, -wall * (W + 1.6), -wall * (W + 2.4 + GARAGE), { k: "roof", b: 6.4, h: 7, c: "#e9eaee" }));
    }
    for (let i = 0; i < lane.length; i += BOX / 2)   // a divider between garages every BOX metres (samples are 2 m apart)
      feats.push(quad(i, i, -wall * (W + 2), -wall * (W + 2 + GARAGE), { k: "garage", b: 0, h: 6.4, c: "#e2e3e8" }, -.15, .15));
    set("pitbuild", fc(feats));
    nearFilters();
  }
  function heading(c) {   // which way a car points: the way the track runs where it is (or, off the track, the way it's moving), smoothed
    let hx = c.mx, hy = c.my;
    if (tm) {
      const q = toM(c.at), { P, T } = tm, n = P.length; let best = -1, bd = Infinity;
      const look = i => { const d = (P[i][0] - q[0]) ** 2 + (P[i][1] - q[1]) ** 2; if (d < bd) { bd = d; best = i; } };
      if (c.ti != null) for (let j = -25; j <= 25; j++) look((c.ti + j + n) % n);   // near where it was first
      if (bd > 900) for (let i = 0; i < n; i++) look(i);
      c.ti = best;
      if (bd < 15 * 15) { const [tx, ty] = T[best], sgn = hx == null || tx * hx + ty * hy >= 0 ? 1 : -1; hx = tx * sgn; hy = ty * sgn; }
    }
    if (hx == null) return;
    const L = Math.hypot(hx, hy) || 1; hx /= L; hy /= L;
    if (c.hx == null) { c.hx = hx; c.hy = hy; } else { c.hx = c.hx * .8 + hx * .2; c.hy = c.hy * .8 + hy * .2; }
  }
  // the 3D cars (js/car3d.js, with three.js), loaded the first time you ride with a car (if it can't load: just the tags)
  let car3 = null, carsP = null;
  function loadCars() {
    carsP = carsP || import("./car3d.js").then(m => m.carLayer(ml)).then(c => { car3 = c; if (tm) c.origin([tm.x0, tm.y0]); addCars(); showRide(); }).catch(e => console.warn(e));
  }
  function addCars() { try { if (car3 && !map.getLayer("cars3d")) map.addLayer(car3.layer); } catch (e) {} }
  let camCar = null, frame = 0, miniKey = "";
  function drawMini(c) {   // the circuit turned like the map from afar, in a 120 px box
    if (!tm) return;
    const r = -bearing * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), turn = ([x, y]) => [x * cs - y * sn, x * sn + y * cs];
    if (miniKey !== tm.x0 + "," + bearing) {
      miniKey = tm.x0 + "," + bearing;
      const P = tm.P.map(turn), xs = P.map(p => p[0]), ys = P.map(p => p[1]);
      const x0 = Math.min(...xs), y1 = Math.max(...ys), k = 110 / Math.max(Math.max(...xs) - x0, y1 - Math.min(...ys));
      mini.fit = ([x, y]) => [5 + (x - x0) * k, 5 + (y1 - y) * k];
      const path = P.map(p => mini.fit(p).map(v => v.toFixed(1)).join(",")).join(" ");
      const H = 10 + (y1 - Math.min(...ys)) * k, W = 10 + (Math.max(...xs) - x0) * k;
      mini.innerHTML = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}"><polygon points="${path}" class="mm-edge"/><polygon points="${path}" class="mm-trk"/><g class="mm-cars"></g></svg>`;
      mini.dots = new Map(); mini.g = mini.querySelector(".mm-cars");
    }
    for (const [n, o] of cars) {
      if (!o.at) continue;
      let d = mini.dots.get(n);
      if (!d) { d = document.createElementNS("http://www.w3.org/2000/svg", "circle"); mini.g.appendChild(d); mini.dots.set(n, d); }
      const [x, y] = mini.fit(turn(toM(o.at)));
      d.setAttribute("cx", x.toFixed(1)); d.setAttribute("cy", y.toFixed(1)); d.setAttribute("r", o === c ? 4.5 : 3);
      d.setAttribute("fill", o.colour); d.classList.toggle("mm-me", o === c);
      if (o === c) mini.g.appendChild(d);   // on top
    }
    for (const [n, d] of mini.dots) if (!cars.has(n)) { d.remove(); mini.dots.delete(n); }
  }
  function ride() {   // once a frame while riding: the 3D cars near the camera's car, the tags worth showing, and the camera itself
    frame = 0;
    const c = cars.get(camCar); if (!riding() || !c || !c.at) return;
    for (const o of cars.values()) if (o.at && metresBetween(o.at, c.at) < 400) heading(o);
    const list = [], ux = c.hx || 1, uy = c.hy || 0, k = Math.cos(lat * Math.PI / 180);
    for (const o of cars.values()) {
      if (!o.at) continue;
      const dx = (o.at[0] - c.at[0]) * M * k, dy = (o.at[1] - c.at[1]) * M, dist = Math.hypot(dx, dy), ahead = dx * ux + dy * uy;
      // tags only for cars in sight: not far off, and from the road or the driver's seat not behind
      o.e.classList.toggle("away", dist > 400 || (viewNow !== "heli" && o !== c && ahead < -2));
      if (dist > 400 || (viewNow !== "heli" && o !== c && ahead < 0 && ahead > -16)) continue;   // nor a car right behind, between it and the camera
      list.push({ n: o.e, at: o.at, angle: Math.atan2(o.hy || 0, o.hx || 1), colour: o.colour, ink: ink(o.colour), num: o.num, tyre: o.tyre,
                  own: o === c && viewNow === "driver" });   // (riding behind its driver's head: the driver isn't drawn)
    }
    if (car3) car3.show(list);
    drawMini(c);
    const r = RIDES[viewNow], from = along(c, r.from[0], r.from[1]), to = along(c, r.to[0], r.to[1]);
    try { if (Math.abs(map.transform.fov - (r.fov || FOV)) > .01) map.transform.fov = r.fov || FOV; } catch (e) {}   // (MapLibre 4's transform)
    try { map.jumpTo(map.calculateCameraOptionsFromTo(ml.LngLat.convert(from), r.from[2], ml.LngLat.convert(to), r.to[2])); } catch (e) {}
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
  const ro = new ResizeObserver(() => { map.resize(); if (!moved && !riding()) camera(false); });
  ro.observe(el);
  // yellow sectors flash
  const flash = setInterval(() => { if (map.getLayer("flags") && data.flags.features.some(f => f.properties.k === "yellow" || f.properties.k === "double")) map.setPaintProperty("flags", "line-opacity", (blink ^= 1) ? 0.95 : 0.15); }, 500);

  await ready;
  return {
    // the track as [lng, lat] points (closed loop), where sectors 1 and 2 end (indexes), the start line, and the corner numbers
    setTrack(pts, cut, rotation, corners) {
      trackPts = pts;
      const nl = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      if (Math.abs(nl - lat) > 0.01) { lat = nl; roadWidths(); }   // widths in metres depend on it
      trackMetres(pts);
      trackLine = { type: "LineString", coordinates: pts.filter((p, i) => i % 3 === 0).concat([pts[0]]) };   // every third point is plenty for distances
      nearFilters();
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
    setPit(pts) { pitPts = pts || []; set("pit", fc(pitPts.length > 1 ? [line(pitPts)] : [])); pitLane(); },
    setFlags(list) { set("flags", fc(list.map(f => line(f.pts, { k: f.k })))); if (!list.length && map.getLayer("flags")) map.setPaintProperty("flags", "line-opacity", 0.9); },
    setBattles(pairs) { set("bats", fc(pairs.map(p => line(p)))); },
    moveCar, dropCar, setLook,
    cars: () => [...cars.keys()],
    view(v) { viewNow = v; moved = false; showRide(); if (!riding()) camera(true); },   // picking a view frames the circuit again (riding: the camera follows a car)
    theme(d) { if (d === mode) return; mode = d; map.setStyle(STYLE(d), { diff: false }); },
    resize() { map.resize(); },
    destroy() { clearInterval(flash); ro.disconnect(); for (const n of [...cars.keys()]) dropCar(n); map.remove(); }
  };
}
