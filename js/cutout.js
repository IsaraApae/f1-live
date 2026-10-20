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

async function driver(url) {
  const [s, img] = await Promise.all([segmenter(), load(url)]);
  const r = s.segment(img), m = r.confidenceMasks[0].getAsFloat32Array();
  const [c, x] = canvasOf(img), d = x.getImageData(0, 0, c.width, c.height);
  let person = 0;
  for (let i = 0; i < m.length; i++) { d.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (m[i] - 0.3) / 0.4))); if (m[i] > 0.5) person++; }   // a soft edge
  r.confidenceMasks.forEach(k => k.close());
  if (person < m.length * 0.03) return null;   // nobody there: formula1.com's "no photo" stand-in, shown as it is
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

async function logo(url) {
  const img = await load(url), [c, x] = canvasOf(img), W = c.width, H = c.height, d = x.getImageData(0, 0, W, H), p = d.data;
  // from the edges inwards, through everything transparent or near-white: that's the tile, not the logo
  const tile = i => p[i * 4 + 3] < 30 || (p[i * 4] > 225 && p[i * 4 + 1] > 225 && p[i * 4 + 2] > 225);
  const seen = new Uint8Array(W * H), stack = [];
  for (let k = 0; k < W; k++) stack.push(k, (H - 1) * W + k);
  for (let k = 0; k < H; k++) stack.push(k * W, k * W + W - 1);
  while (stack.length) {
    const i = stack.pop(); if (seen[i] || !tile(i)) continue;
    seen[i] = 1; p[i * 4 + 3] = 0;
    const xx = i % W, yy = (i / W) | 0;
    if (xx > 0) stack.push(i - 1); if (xx < W - 1) stack.push(i + 1); if (yy > 0) stack.push(i - W); if (yy < H - 1) stack.push(i + W);
  }
  x.putImageData(d, 0, 0);
  // a dark logo (McLaren's, Alpine's) would vanish on the dark theme: measure it, so the page can outline it there
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
