// 2023's pictures come from formula1.com's old site, and they aren't cut out like later years': driver photos stand on
// a dark studio backdrop, team logos sit on a white rounded tile. They're cut out here, in the browser, so they look
// like every other year's:
//   drivers: MediaPipe's selfie segmenter (Google, Apache 2.0; a 250 KB model) finds the person, the rest goes transparent
//   logos:   the white tile around the logo goes transparent (white inside the logo itself stays)
// Each picture is cut once per visit; until it's ready it stays hidden, and if cutting fails it shows as it is.
const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";
export const DRIVER = /\/content\/dam\/fom-website\/drivers\/\d{4}Drivers\//;
export const LOGO = /\/content\/dam\/fom-website\/teams\/\d{4}\/[^/]+-logo\.png$/;

let seg = null;
const segmenter = () => seg = seg || (async () => {
  const V = await import(`${MP}/vision_bundle.mjs`);
  const files = await V.FilesetResolver.forVisionTasks(`${MP}/wasm`);
  return V.ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL }, runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false });
})().catch(e => { seg = null; throw e; });

const load = url => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = no; i.src = url.replace(/#.*$/, ""); });
const canvasOf = img => { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0); return [c, x]; };

async function driver(url, again = false) {
  const [s, img] = await Promise.all([segmenter(), load(url)]);
  const r = s.segment(img), m = r.confidenceMasks[0].getAsFloat32Array();
  const [c, x] = canvasOf(img), d = x.getImageData(0, 0, c.width, c.height);
  let person = 0;
  for (let i = 0; i < m.length; i++) { d.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (m[i] - 0.3) / 0.4))); if (m[i] > 0.5) person++; }   // a soft edge
  r.confidenceMasks.forEach(k => k.close());
  if (person < m.length * 0.03) {
    // nobody there: formula1.com has no photo of this driver that year (2023: Lawson, a mid-season stand-in). The next
    // year's photo from the same library, if there is one; otherwise its "no photo" stand-in, shown as it is
    const next = url.replace(/\/(\d{4})Drivers\//, (_, y) => `/${+y + 1}Drivers/`);
    return next !== url && !again ? driver(next, true) : null;
  }
  x.putImageData(d, 0, 0);
  if (!url.endsWith("#face")) return c.toDataURL("image/png");
  // head and shoulders: a square around the top of the cut-out person, like the face-cropped photos of later years
  let top = 0;
  find: for (let y = 0; y < c.height; y++) for (let k = 0; k < c.width; k++) if (d.data[(y * c.width + k) * 4 + 3] > 128) { top = y; break find; }
  const side = Math.round(c.width * 0.56), sx = Math.round((c.width - side) / 2), sy = Math.max(0, top - Math.round(side * 0.08));
  const f = document.createElement("canvas"); f.width = f.height = side;
  f.getContext("2d").drawImage(c, sx, sy, side, side, 0, 0, side, side);
  return f.toDataURL("image/png");
}

// Most of 2023's logos sit on a white tile; a few need more. Seen at 110 px against every 2023 logo:
//   aston-martin: its tile is dark green, not white
//   mercedes:     the white between the star's arms is background too (the star itself is silver, so only those gaps go)
//   haas-f1-team: its white H touches the white tile; everything inside the red circle is the logo
const TILE = { "aston-martin": [18, 101, 90] };
const GAPS = { mercedes: [[0.72, 0.38], [0.28, 0.38], [0.5, 0.76]] };   // inside the ring, between the arms (fractions of the size)

async function logo(url) {
  const img = await load(url), [c, x] = canvasOf(img), W = c.width, H = c.height, d = x.getImageData(0, 0, W, H), p = d.data;
  const team = (/\/([^/]+)-logo\.png$/.exec(url) || [])[1], tc = TILE[team];
  const near = (i, [r, g, b], tol) => Math.abs(p[i * 4] - r) + Math.abs(p[i * 4 + 1] - g) + Math.abs(p[i * 4 + 2] - b) < tol;
  const white = i => p[i * 4] > 225 && p[i * 4 + 1] > 225 && p[i * 4 + 2] > 225;
  // Haas: the red circle (the bounding box of its red), kept whole
  let keep = null;
  if (team === "haas-f1-team") {
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let i = 0; i < W * H; i++) if (p[i * 4 + 3] > 200 && p[i * 4] > 180 && p[i * 4 + 1] < 90 && p[i * 4 + 2] < 110) { const xx = i % W, yy = (i / W) | 0; x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); }
    if (x1 > x0) keep = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.min(x1 - x0, y1 - y0) / 2 };
  }
  const kept = i => keep && Math.hypot(i % W - keep.cx, ((i / W) | 0) - keep.cy) < keep.r;
  // from the edges inwards, through everything transparent or the tile's colour: that's the tile, not the logo
  const tile = i => !kept(i) && (p[i * 4 + 3] < 30 || (tc ? near(i, tc, 90) : white(i)));
  const seen = new Uint8Array(W * H);
  const clear = (seeds, ok) => {
    const stack = seeds.slice();
    while (stack.length) {
      const i = stack.pop(); if (seen[i] || !ok(i)) continue;
      seen[i] = 1; p[i * 4 + 3] = 0;
      const xx = i % W, yy = (i / W) | 0;
      if (xx > 0) stack.push(i - 1); if (xx < W - 1) stack.push(i + 1); if (yy > 0) stack.push(i - W); if (yy < H - 1) stack.push(i + W);
    }
  };
  const edges = [];
  for (let k = 0; k < W; k++) edges.push(k, (H - 1) * W + k);
  for (let k = 0; k < H; k++) edges.push(k * W, k * W + W - 1);
  clear(edges, tile);
  // the edge where the logo was blended into its tile is a light fringe: clear tile-like pixels beside the cleared ones,
  // then fade what's left of the edge, so no light outline shows on the dark theme
  const by = i => { const xx = i % W, yy = (i / W) | 0; return (xx > 0 && seen[i - 1]) || (xx < W - 1 && seen[i + 1]) || (yy > 0 && seen[i - W]) || (yy < H - 1 && seen[i + W]); };
  const tileish = i => !kept(i) && (tc ? near(i, tc, 170) : p[i * 4] > 160 && p[i * 4 + 1] > 160 && p[i * 4 + 2] > 160);
  for (let pass = 0; pass < 2; pass++) {
    const hit = [];
    for (let i = 0; i < W * H; i++) if (!seen[i] && p[i * 4 + 3] && tileish(i) && by(i)) hit.push(i);
    for (const i of hit) { seen[i] = 1; p[i * 4 + 3] = 0; }
  }
  // only light edge pixels are fringe: a thin dark stroke (Alpine's A) keeps its full strength
  const light = i => tc ? near(i, tc, 220) : 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2] > 120;
  for (let i = 0; i < W * H; i++) if (!seen[i] && p[i * 4 + 3] && by(i) && light(i) && !kept(i)) p[i * 4 + 3] = Math.round(p[i * 4 + 3] * 0.55);
  if (GAPS[team]) clear(GAPS[team].map(([fx, fy]) => Math.round(fy * (H - 1)) * W + Math.round(fx * (W - 1))), i => p[i * 4] > 215 && p[i * 4 + 1] > 215 && p[i * 4 + 2] > 215);
  x.putImageData(d, 0, 0);
  // a dark logo (McLaren's, Alpine's) would vanish on the dark theme: measure it, so the page can give it a lighter tile there
  let sum = 0, n = 0;
  for (let i = 0; i < W * H; i++) if (p[i * 4 + 3] > 128) { sum += 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]; n++; }
  return { src: c.toDataURL("image/png"), dark: n > 0 && sum / n < 110 };
}

// one at a time, so a page full of photos doesn't freeze the screen
const cache = new Map();
let queue = Promise.resolve();
export function cut(url) {
  if (!cache.has(url)) {
    const job = queue.then(() => (DRIVER.test(url) ? driver(url) : logo(url))).catch(() => null);
    queue = job; cache.set(url, job);
  }
  return cache.get(url);
}

// every such picture that appears on a page is swapped for its cut-out
export function watch(root = document.body) {
  const fix = img => {
    const u = img.getAttribute("src") || "";
    if (!(DRIVER.test(u) || LOGO.test(u))) return;
    cut(u).then(r => {
      if (img.getAttribute("src") !== u) return;
      if (!r) { img.classList.add("uncut"); return; }
      if (r.dark) img.classList.add("dark-logo");
      img.src = r.src || r;
    });
  };
  const scan = n => { if (n.tagName === "IMG") fix(n); else if (n.querySelectorAll) n.querySelectorAll("img").forEach(fix); };
  scan(root);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === "attributes") fix(m.target);
      else m.addedNodes.forEach(scan);
    }
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
}
