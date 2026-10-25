// The track map on a real map: the circuit where it really is (streets, water, 3D buildings), tilted or seen from above,
// with every car on it. MapLibre draws it with OpenFreeMap's free tiles (OpenStreetMap data).
// F1's track coordinates are in 10 cm units and already face north (checked on 2026 Singapore, Austin and Silverstone:
// within 1.3° and 11 m), so placing a circuit only takes matching its outline to the real one, from an open dataset of
// circuit shapes (github.com/bacinger/f1-circuits, MIT licence).
import { esc, ink } from "./util.js";
import { ESRI_KEY } from "./keys.js";

const LIB = "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/";
const SHAPES = "https://cdn.jsdelivr.net/gh/bacinger/f1-circuits@8094e957b8d6aa8b9f4510c93968556cccd30e02/f1-circuits.geojson";
const STYLE = dark => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
const SECTOR_COLOURS = ["#ff3b5c", "#3b9eff", "#ffd60a"];
// the camera views that ride with a car (the one you follow, else the leader): where the camera is and what it looks at,
// in metres along the car's way (fwd) and to its left, and its height
const RIDES = {
  heli: { from: [-38, -16, 26], to: [18, 0, 0] },                // a helicopter above, behind and to one side
  road: { from: [-8, 0, 2.2], to: [14, 0, 0], fov: 50 },            // just behind the car, as on TV
  driver: { from: [0.05, 0, 0.72], to: [7.9, 0, 0], fov: 72 }    // the driver's eyes, inside the halo, with a wide lens like the onboard camera's
};                                                                // (MapLibre tilts at most 85°)
const FOV = 36.87;   // MapLibre's own (vertical, in degrees)

const ROAD = 14, PIT_ROAD = 9, GRASS = 70;   // track, pit lane and the grass along them, wide in metres, for the views up close
// an F1 car from boxes (MapLibre can only stand flat shapes up), in metres from its middle, x forward and y to the left:
// [footprint, from height, to height, colour (T: the team's, K: carbon, W: tyre, R: rim, H: helmet), o: seen from the driver's seat]
const box = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const taper = (x0, x1, w0, w1) => [[x0, -w0], [x1, -w1], [x1, w1], [x0, w0]];   // half as wide as w0 at x0, w1 at x1
const pair = (x0, x1, y0, y1, ...rest) => [[box(x0, x1, y0, y1), ...rest], [box(x0, x1, -y1, -y0), ...rest]];   // both sides
const wheel = (x, y0, y1, o) => [   // a tyre, rounded off top and bottom, with its rim on the outside
  ...pair(x - .22, x + .22, y0, y1, 0, .1, "W", o), ...pair(x - .36, x + .36, y0, y1, .1, .62, "W", o), ...pair(x - .22, x + .22, y0, y1, .62, .72, "W", o),
  ...pair(x - .2, x + .2, y1, y1 + .015, .17, .55, "R", o)];
const CAR = [
  [box(-1.9, 1.25, -.8, .8), .03, .09, "K"],                                               // floor
  [taper(1.2, 1.9, .2, .16), .2, .48, "T", "o"], [taper(1.9, 2.55, .16, .09), .18, .36, "T", "o"],   // nose
  [taper(-.2, 1.2, .4, .24), .1, .62, "T"],                                                // chassis
  [box(-.05, .3, -.13, .13), .58, .84, "H"],                                               // the driver's helmet
  ...pair(-.08, .42, .21, .27, .74, .82, "K"), [box(.36, .44, -.27, .27), .74, .82, "K"],   // halo
  [box(.44, .72, -.035, .035), .55, .8, "K"], ...pair(-.12, 0, .21, .27, .6, .78, "K"),
  [box(-.9, .65, -.8, .8), .1, .5, "T"], [taper(-1.6, -.9, .45, .8), .1, .44, "T"],         // sidepods
  [taper(-2, -.1, .16, .3), .44, .86, "T"], [box(-.32, .02, -.15, .15), .8, 1, "T"],        // engine cover, airbox
  [box(-1.95, -.5, -.02, .02), .84, .96, "T"],                                             // fin
  [box(-2.45, -1.9, -.55, .55), .05, .26, "K"],                                            // diffuser
  [box(-2.78, -2.5, -.5, .5), .78, .86, "K"], [box(-2.62, -2.42, -.5, .5), .87, .95, "T"],   // rear wing
  ...pair(-2.82, -2.35, .48, .53, .38, .98, "T"), [box(-2.62, -2.42, -.42, .42), .3, .36, "K"], [box(-2.58, -2.48, -.03, .03), .36, .8, "K"],
  [box(2.4, 2.78, -.95, .95), .05, .1, "K", "o"], [box(2.22, 2.48, -.9, .9), .1, .17, "T", "o"],   // front wing
  ...pair(2.2, 2.78, .92, .97, .05, .3, "T", "o"),
  ...pair(.42, .58, .38, .55, .6, .68, "K", "o"),                                          // mirrors
  ...pair(1.62, 1.9, .2, .66, .3, .35, "K", "o"), ...pair(-1.78, -1.52, .3, .58, .34, .39, "K"),   // suspension
  ...wheel(1.75, .62, .92, "o"), ...wheel(-1.65, .55, .95)
];
const PARTS = { K: "#17181c", W: "#0b0b0d", R: "#55575e", H: "#ececf0" };
// the sky and the haze far off, up close
const SKY = dark => dark ? { "sky-color": "#101a33", "horizon-color": "#2c3b5a", "fog-color": "#1b2233", "sky-horizon-blend": .6, "horizon-fog-blend": .6, "fog-ground-blend": .8 }
                         : { "sky-color": "#6fa6e0", "horizon-color": "#d7e7f4", "fog-color": "#e3ebf1", "sky-horizon-blend": .6, "horizon-fog-blend": .6, "fog-ground-blend": .8 };

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
  // from the driver's seat: the halo in front of your eyes, out of focus, as on the onboard camera (it moves with your head, so it's
  // drawn over the view; under the cars' tags)
  const halo = document.createElement("div");
  halo.className = "halo";
  halo.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H100V8Q50 21 0 8Z"/><path d="M46.5 13.5Q50 14.6 53.5 13.5L55.5 58Q50 61 44.5 58Z"/>
    <path d="M0 8Q7 34 2.5 100H0Z"/><path d="M100 8Q93 34 97.5 100H100Z"/><path d="M0 92Q50 80 100 92V100H0Z" opacity=".85"/></svg>`;
  map.getCanvasContainer().appendChild(halo);
  const data = { trk: fc([]), pit: fc([]), flags: fc([]), bats: fc([]), corners: fc([]), car3d: fc([]), kerbs: fc([]) };
  let mode = dark, bounds = null, bearing = 0, viewNow = "3d", blink = 0, trackPts = [], lat = 0;
  const riding = () => !!RIDES[viewNow];
  // a width in metres as a line width at any zoom (MapLibre's 512-pixel tiles: 78271.5 m a pixel at zoom 0, at the equator)
  const metres = (m, k = 1) => ["interpolate", ["exponential", 2], ["zoom"], 12, k * m / (78271.517 * Math.cos(lat * Math.PI / 180) / 2 ** 12), 24, k * m / (78271.517 * Math.cos(lat * Math.PI / 180) / 2 ** 24)];

  // which buildings count as near the track: until there is a track, all of them are "far"
  const NEAR = 120, TALL = 2.5;   // buildings drawn 2.5 times their real height, so the city stands out
  let trackLine = null;
  function nearFilters() {
    if (!map.getLayer("b3d")) return;
    try {
      map.setFilter("b3d", trackLine ? [">=", ["distance", trackLine], NEAR] : null);
      map.setFilter("b3d-near", trackLine ? ["<", ["distance", trackLine], NEAR] : ["boolean", false]);
    } catch (e) { map.setFilter("b3d", null); }   // a MapLibre without "distance": every building as before
  }
  function decorate() {   // our layers on top of the base map (again after every change of style)
    const layers = map.getStyle().layers;
    for (const l of layers) if (/^poi|^airport|housenumber/.test(l.id)) map.removeLayer(l.id);   // fewer labels over the track
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
    add({ id: "grass", type: "line", source: "trk", filter: edge, layout: round, paint: { "line-color": mode ? "#1e3320" : "#7fa565", "line-blur": 6 } });
    add({ id: "road-pit", type: "line", source: "pit", layout: round, paint: { "line-color": mode ? "#303238" : "#5c5f66" } });
    add({ id: "road", type: "line", source: "trk", filter: edge, layout: round, paint: { "line-color": mode ? "#303238" : "#5c5f66" } });
    for (const side of [1, -1]) {
      add({ id: "kerb-w" + side, type: "line", source: "kerbs", layout: ride, paint: { "line-color": "#f2f2f4" } });
      add({ id: "kerb-r" + side, type: "line", source: "kerbs", layout: ride, paint: { "line-color": "#d3202a", "line-dasharray": [1, 1] } });
      add({ id: "road-edge" + side, type: "line", source: "trk", filter: edge, layout: { ...ride, "line-join": "round" }, paint: { "line-color": "#f4f4f6" } });
    }
    add({ id: "car3d", type: "fill-extrusion", source: "car3d", layout: ride,
          paint: { "fill-extrusion-color": ["get", "c"], "fill-extrusion-base": ["get", "b"], "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 1 } });
    roadWidths();
    try { map.setSky(SKY(mode)); } catch (e) {}
    if (ESRI_KEY) {   // satellite photos under the track up close (Esri World Imagery; tiles only load in these views)
      if (!map.getSource("sat")) map.addSource("sat", { type: "raster", tileSize: 256, maxzoom: 19,
        tiles: [`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ESRI_KEY)}`],
        attribution: "Powered by Esri · Esri, Maxar, Earthstar Geographics, and the GIS User Community" });
      add({ id: "sat", type: "raster", source: "sat", layout: ride }, firstLabel);
    }
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
    for (const side of [1, -1]) {
      p("road-edge" + side, "line-width", metres(.35)); p("road-edge" + side, "line-offset", metres(ROAD / 2 - .4, side));
      for (const k of ["kerb-w", "kerb-r"]) { p(k + side, "line-width", metres(1.2)); p(k + side, "line-offset", metres(ROAD / 2 + .6, side)); }
    }
  }
  function showRide() {   // up close: the road and 3D cars; from afar: the coloured track and dots
    const on = riding(), vis = (id, show) => { try { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", show ? "visible" : "none"); } catch (e) {} };   // (before the style loads: its style.load does it)
    for (const id of ["sat", "road", "road-pit", "road-edge1", "road-edge-1", "kerb-w1", "kerb-w-1", "kerb-r1", "kerb-r-1", "car3d", "cars3d"]) vis(id, on);
    vis("grass", on && !ESRI_KEY);   // the photos have the real grass
    if (on) loadCars();
    // buildings at their real height up close, and solid (from afar: taller, and the ones by the track see-through)
    const tall = on ? 1 : TALL, pp = (id, k, v) => { try { if (map.getLayer(id)) map.setPaintProperty(id, k, v); } catch (e) {} };
    for (const id of ["b3d", "b3d-near"]) { pp(id, "fill-extrusion-height", ["*", tall, ["coalesce", ["get", "render_height"], 8]]); pp(id, "fill-extrusion-base", ["*", tall, ["coalesce", ["get", "render_min_height"], 0]]); }
    pp("b3d-near", "fill-extrusion-opacity", on ? .9 : .16);
    try {   // up close the buildings go over the ground layers (the ground never hides a building); from afar the track goes over them
      const under = on ? "car3d" : (map.getStyle().layers.find(l => l.type === "symbol") || {}).id;
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
  // the 3D cars (js/car3d.js, with three.js), loaded the first time you ride with a car; until then (or if it can't load) boxes
  let car3 = null, carsP = null;
  function loadCars() {
    carsP = carsP || import("./car3d.js").then(m => m.carLayer(ml)).then(c => { car3 = c; if (tm) c.origin([tm.x0, tm.y0]); addCars(); showRide(); }).catch(e => console.warn(e));
  }
  function addCars() { try { if (car3 && !map.getLayer("cars3d")) map.addLayer(car3.layer); } catch (e) {} }
  let camCar = null, frame = 0;
  function ride() {   // once a frame while riding: the 3D cars near the camera's car, the tags worth showing, and the camera itself
    frame = 0;
    const c = cars.get(camCar); if (!riding() || !c || !c.at) return;
    for (const o of cars.values()) if (o.at && metresBetween(o.at, c.at) < 400) heading(o);
    const feats = [], list = [], three = car3 && tm, ux = c.hx || 1, uy = c.hy || 0, k = Math.cos(lat * Math.PI / 180);
    for (const o of cars.values()) {
      if (!o.at) continue;
      const dx = (o.at[0] - c.at[0]) * M * k, dy = (o.at[1] - c.at[1]) * M, dist = Math.hypot(dx, dy), ahead = dx * ux + dy * uy;
      // tags only for cars in sight: not far off, and from the road or the driver's seat not behind
      o.e.classList.toggle("away", dist > 400 || (viewNow !== "heli" && o !== c && ahead < -2));
      if (dist > 400 || (viewNow !== "heli" && o !== c && ahead < 0 && ahead > -16)) continue;   // nor a car right behind, between it and the camera
      const own = o === c && viewNow === "driver";   // from the driver's seat: just the nose, front wing, front wheels and mirrors
      if (three) { list.push({ n: o.e, at: o.at, angle: Math.atan2(o.hy || 0, o.hx || 1), colour: o.colour, ink: ink(o.colour), num: o.num, tyre: o.tyre, own }); continue; }
      for (const [shape, b, h, col, seen] of CAR) {
        if (own && !seen) continue;
        const ring = shape.map(([x, y]) => along(o, x, y)); ring.push(ring[0]);
        feats.push({ type: "Feature", properties: { c: col === "T" ? o.colour : PARTS[col], b, h }, geometry: { type: "Polygon", coordinates: [ring] } });
      }
    }
    if (three) car3.show(list);
    if (feats.length || data.car3d.features.length) set("car3d", fc(feats));
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
    setPit(pts) { set("pit", fc(pts && pts.length > 1 ? [line(pts)] : [])); },
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
