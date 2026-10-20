// 2023's pictures come from formula1.com's old site, and they aren't cut out like later years':
//   drivers: the photos stand on a dark studio backdrop. MediaPipe's selfie segmenter (Google, Apache 2.0; a 250 KB
//            model) finds the person, the rest goes transparent
//   AlphaTauri's logo: a flat navy mark on white (util.js picks it; the other 2023 logos are ready-made transparent
//            ones). One colour on white separates exactly: each pixel's whiteness is its transparency
// Each picture is done once per visit; until it's ready it stays hidden, and if it fails it shows as it is.
const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";
export const DRIVER = /\/content\/dam\/fom-website\/drivers\/\d{4}Drivers\//;
export const LOGO = /\/team%20logos\/[^/#]+\.png#mark/;

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

// the mark of a one-colour logo on white (formula1.com's full-size AlphaTauri logo: the "AT" between its two lines of
// lettering), squared up, with the white taken away
const MARK = { x0: 0.19, x1: 0.83, y0: 0.18, y1: 0.76 };
async function logo(url) {
  const img = await load(url), W0 = img.naturalWidth, H0 = img.naturalHeight;
  const sx = Math.round(W0 * MARK.x0), sy = Math.round(H0 * MARK.y0), sw = Math.round(W0 * (MARK.x1 - MARK.x0)), sh = Math.round(H0 * (MARK.y1 - MARK.y0));
  const side = Math.max(sw, sh), c = document.createElement("canvas"); c.width = c.height = 400;
  const x = c.getContext("2d", { willReadFrequently: true }), k = 400 / side;
  x.fillStyle = "#fff"; x.fillRect(0, 0, 400, 400);
  x.drawImage(img, sx, sy, sw, sh, (400 - sw * k) / 2, (400 - sh * k) / 2, sw * k, sh * k);
  const d = x.getImageData(0, 0, 400, 400), p = d.data;
  let ink = null;   // the logo's colour: its darkest pixel
  for (let i = 0; i < p.length; i += 4) { const l = p[i] + p[i + 1] + p[i + 2]; if (!ink || l < ink[3]) ink = [p[i], p[i + 1], p[i + 2], l]; }
  for (let i = 0; i < p.length; i += 4) {
    const a = Math.min(1, Math.max(0, (765 - (p[i] + p[i + 1] + p[i + 2])) / (765 - ink[3])));   // white: 0, the logo's colour: 1
    p[i] = ink[0]; p[i + 1] = ink[1]; p[i + 2] = ink[2]; p[i + 3] = Math.round(255 * a);
  }
  x.putImageData(d, 0, 0);
  return { src: c.toDataURL("image/png") };
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
      if (/invert$/.test(u)) img.classList.add("inv");   // its white version, for the dark theme
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
