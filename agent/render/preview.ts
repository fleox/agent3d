// The page `agent3d render` / `export` (poster, video) load in headless
// Chrome. It mounts /__scene.json with the runtime in deterministic mode and
// exposes:
//   window.__agent3d          { player, issues, ready, error, webgl }  (HeadlessHandle + diagnostics)
//   window.__agent3dFrame(t, type?, quality?)   seek(t) + snapshot() → data URL
//   window.__agent3dSheet(urls, labels, cols, bg?)   contact sheet (grid + time labels) → PNG data URL
//   window.__agent3dComposite(url, bg)   a frame over a background ("checker" or a CSS colour) → PNG data URL
//   window.__agent3dRender(times, sheet?, cols?) all of the above in one call
//   window.__agent3dUi(id)    click a HUD button by id (false when missing / hidden)
//   window.__agent3dInfo()    { stats, inspect, issues, state }
//   window.__agent3dGrab(t, { ss, type, quality, bg, raw })   seek(t) + supersampled capture
//        (the canvas was rendered at ss× the pixel ratio and is downscaled): data URL, or raw RGBA (base64)
//   window.__agent3dSocial(url, w, h)   a frame fitted into w×h (blurred cover background) → PNG data URL
//   window.__agent3dVideoStart(cfg) / __agent3dVideoFrame(t, i) / __agent3dVideoDrain() / __agent3dVideoEnd()
//        frame-exact WebCodecs encoding (H.264 / VP9 / VP8) of seeked frames

export const RUNTIME_URL = "/__runtime/agent3d-runtime.js";

export function previewHtml(opts: { pixelRatio?: number; transparent?: boolean; reducedMotion?: boolean } = {}): string {
  const pr = opts.pixelRatio ?? 1;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent3D render</title>
<style>html,body{margin:0;padding:0;overflow:hidden;background:${opts.transparent ? "transparent" : "#000"}}#stage{position:fixed;inset:0;width:100vw;height:100vh}</style>
</head>
<body>
<div id="stage"></div>
<script type="module">
const handle = { player: null, issues: [], ready: false, error: null, webgl: false };
window.__agent3d = handle;
try {
  const c = document.createElement("canvas");
  handle.webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
} catch (e) { handle.webgl = false; }

const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("image decode failed")); img.src = src; });

window.__agent3dFrame = async (t, type, quality) => {
  const p = handle.player;
  if (!p) throw new Error("player not mounted");
  await p.seek(t);
  return p.snapshot(type || "image/png", quality);
};

// Background under transparent frames: "checker" (grey / white squares) or a CSS colour.
const paintBg = (g, x, y, w, h, bg) => {
  if (!bg) return;
  if (bg !== "checker") { g.fillStyle = bg; g.fillRect(x, y, w, h); return; }
  const s = Math.max(8, Math.round(Math.min(w, h) / 32));
  g.fillStyle = "#ffffff"; g.fillRect(x, y, w, h);
  g.fillStyle = "#d9d9de";
  for (let j = 0; j * s < h; j++) for (let i = j % 2; i * s < w; i += 2) g.fillRect(x + i * s, y + j * s, Math.min(s, w - i * s), Math.min(s, h - j * s));
};

window.__agent3dComposite = async (url, bg) => {
  const img = await loadImage(url);
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const g = cv.getContext("2d");
  paintBg(g, 0, 0, cv.width, cv.height, bg);
  g.drawImage(img, 0, 0);
  return cv.toDataURL("image/png");
};

window.__agent3dSheet = async (urls, labels, cols, bg) => {
  const imgs = await Promise.all(urls.map(loadImage));
  const n = imgs.length;
  const w0 = imgs[0].naturalWidth, h0 = imgs[0].naturalHeight;
  const aspect = w0 / h0;
  cols = Math.max(1, Math.min(n, cols || Math.round(Math.sqrt(n / aspect)) || 1));
  const rows = Math.ceil(n / cols);
  const cellW = Math.min(w0, Math.floor(2400 / cols));
  const cellH = Math.round(cellW / aspect);
  const gap = 8;
  const cv = document.createElement("canvas");
  cv.width = cols * cellW + (cols + 1) * gap;
  cv.height = rows * cellH + (rows + 1) * gap;
  const g = cv.getContext("2d");
  g.fillStyle = "#1b1b1f"; g.fillRect(0, 0, cv.width, cv.height);
  // Small, semi-transparent time label in the bottom-left corner: the top
  // corners are where HUDs (score, lives) usually sit.
  const fs = Math.max(10, Math.round(Math.min(cellH, cellW * 0.6) / 24));
  g.font = "600 " + fs + "px system-ui, -apple-system, Segoe UI, sans-serif";
  g.textBaseline = "middle";
  imgs.forEach((img, i) => {
    const x = gap + (i % cols) * (cellW + gap), y = gap + Math.floor(i / cols) * (cellH + gap);
    paintBg(g, x, y, cellW, cellH, bg);
    g.drawImage(img, x, y, cellW, cellH);
    const label = labels[i] || "";
    if (label) {
      const tw = g.measureText(label).width;
      const pad = Math.round(fs * 0.45), bh = Math.round(fs * 1.5), m = Math.round(fs * 0.4);
      const bx = x + m, by = y + cellH - m - bh;
      g.fillStyle = "rgba(0,0,0,0.42)"; g.fillRect(bx, by, tw + pad * 2, bh);
      g.fillStyle = "rgba(255,255,255,0.85)"; g.fillText(label, bx + pad, by + bh / 2);
    }
  });
  return cv.toDataURL("image/png");
};

// ─── Supersampled capture ───
let grabCanvas = null;
const sourceFor = (ss, bg) => {
  const p = handle.player;
  const src = p.canvas;
  if ((!ss || ss <= 1) && !bg) return src;
  const w = Math.max(1, Math.round(src.width / (ss || 1))), h = Math.max(1, Math.round(src.height / (ss || 1)));
  if (!grabCanvas) grabCanvas = document.createElement("canvas");
  let from = src, fw = src.width, fh = src.height;
  // Halve in steps (box filter) down to the target size: clean supersampling.
  while (fw / 2 >= w * 1.5) {
    const tmp = document.createElement("canvas");
    tmp.width = Math.round(fw / 2); tmp.height = Math.round(fh / 2);
    const tg = tmp.getContext("2d"); tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
    tg.drawImage(from, 0, 0, tmp.width, tmp.height);
    from = tmp; fw = tmp.width; fh = tmp.height;
  }
  grabCanvas.width = w; grabCanvas.height = h;
  const g = grabCanvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (bg) paintBg(g, 0, 0, w, h, bg);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(from, 0, 0, w, h);
  return grabCanvas;
};

const toB64 = (buf) => {
  let out = "";
  for (let i = 0; i < buf.length; i += 0x8000) out += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(out);
};

window.__agent3dGrab = async (t, o) => {
  o = o || {};
  const p = handle.player;
  if (!p) throw new Error("player not mounted");
  await p.seek(t);
  // seek() rendered the frame (deterministic players preserve the drawing buffer).
  if (typeof p.renderHighQuality === "function" && o.hq) { try { await p.renderHighQuality(); } catch (e) {} }
  const c = sourceFor(o.ss, o.bg);
  if (o.raw) {
    let g2 = c.getContext && c === grabCanvas ? grabCanvas.getContext("2d") : null;
    if (!g2) { const tmp = document.createElement("canvas"); tmp.width = c.width; tmp.height = c.height; g2 = tmp.getContext("2d"); g2.drawImage(c, 0, 0); }
    const d = g2.getImageData(0, 0, c.width, c.height);
    return { width: c.width, height: c.height, rgba: toB64(new Uint8Array(d.data.buffer)) };
  }
  return c.toDataURL(o.type || "image/png", o.quality);
};

window.__agent3dSocial = async (url, w, h) => {
  const img = await loadImage(url);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const cover = Math.max(w / iw, h / ih), contain = Math.min(w / iw, h / ih);
  g.filter = "blur(" + Math.round(Math.min(w, h) / 18) + "px) brightness(0.8) saturate(1.1)";
  g.drawImage(img, (w - iw * cover) / 2 - 20, (h - ih * cover) / 2 - 20, iw * cover + 40, ih * cover + 40);
  g.filter = "none";
  g.imageSmoothingQuality = "high";
  g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = Math.round(h / 30);
  g.drawImage(img, (w - iw * contain) / 2, (h - ih * contain) / 2, iw * contain, ih * contain);
  return cv.toDataURL("image/png");
};

// ─── Frame-exact video (WebCodecs) ───
let video = null;
window.__agent3dVideoSupport = async (codecs, w, h, fps) => {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of codecs) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, framerate: fps, bitrate: 4e6, ...(codec.startsWith("avc1") ? { avc: { format: "avc" } } : {}) });
      if (r.supported) return codec;
    } catch (e) {}
  }
  return null;
};
window.__agent3dVideoStart = async (cfg) => {
  const chunks = [];
  let description = null, error = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
      chunks.push({ b64: toB64(b), key: chunk.type === "key" });
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !description) description = toB64(new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer));
    },
    error: (e) => { error = String(e); },
  });
  encoder.configure({ codec: cfg.codec, width: cfg.width, height: cfg.height, framerate: cfg.fps, bitrate: cfg.bitrate, bitrateMode: "variable", latencyMode: "quality", ...(cfg.codec.startsWith("avc1") ? { avc: { format: "avc" } } : {}) });
  video = { encoder, chunks, cfg, get description() { return description; }, get error() { return error; } };
  return true;
};
window.__agent3dVideoFrame = async (t, i) => {
  const v = video;
  if (v.error) throw new Error(v.error);
  await handle.player.seek(t);
  const src = sourceFor(v.cfg.ss, v.cfg.bg);
  const frame = new VideoFrame(src, { timestamp: Math.round((i * 1e6) / v.cfg.fps), duration: Math.round(1e6 / v.cfg.fps) });
  v.encoder.encode(frame, { keyFrame: i % v.cfg.keyInterval === 0 });
  frame.close();
  while (v.encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
  return true;
};
window.__agent3dVideoDrain = () => { const out = video.chunks.splice(0); return out; };
window.__agent3dVideoEnd = async () => {
  await video.encoder.flush();
  const out = { chunks: video.chunks.splice(0), description: video.description, error: video.error };
  video.encoder.close();
  video = null;
  return out;
};

// Click a HUD button (scene.ui element of type "button") by id: false when it is missing or hidden.
window.__agent3dUi = (id) => {
  const b = Array.from(document.querySelectorAll(".a3d-hud [data-id]")).find((el) => el.dataset.id === id);
  if (!b || !b.getClientRects().length) return false;
  b.click();
  return true;
};

window.__agent3dInfo = () => {
  const p = handle.player;
  const safe = (f) => { try { return f(); } catch (e) { return null; } };
  return { stats: p ? safe(() => p.stats()) : null, inspect: p ? safe(() => p.inspect()) : null, issues: handle.issues, state: p ? safe(() => p.state()) : null };
};

window.__agent3dRender = async (times, sheet, cols) => {
  const frames = [];
  for (const t of times) frames.push(await window.__agent3dFrame(t));
  const out = { frames, ...window.__agent3dInfo() };
  if (sheet && frames.length) out.sheet = await window.__agent3dSheet(frames, times.map((t) => "t = " + (+t).toFixed(2) + " s"), cols);
  return out;
};

try {
  const mod = await import(${JSON.stringify(RUNTIME_URL)});
  const res = await fetch("/__scene.json", { cache: "no-store" });
  if (!res.ok) throw new Error("scene.json: HTTP " + res.status);
  const scene = await res.json();
  const player = mod.mountScene(document.getElementById("stage"), scene, {
    deterministic: true,
    assetBase: "/project/",
    libraryBase: "/__library/",
    pixelRatio: ${JSON.stringify(pr)},
    reducedMotion: ${opts.reducedMotion ? "true" : "false"},
    onError: (issue) => handle.issues.push(issue),
  });
  handle.player = player;
  await player.ready;
  handle.ready = true;
} catch (e) {
  handle.error = String((e && e.stack) || e);
}
</script>
</body>
</html>
`;
}
