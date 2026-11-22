// The page `agent3d render` / `export` (poster, video) load in headless
// Chrome. It mounts /__scene.json with the runtime in deterministic mode and
// exposes:
//   window.__agent3d          { player, issues, ready, error, webgl }  (HeadlessHandle + diagnostics)
//   window.__agent3dFrame(t, type?, quality?)   seek(t) + snapshot() → data URL
//   window.__agent3dSheet(urls, labels, cols)   contact sheet (grid + time labels) → PNG data URL
//   window.__agent3dRender(times, sheet?, cols?) all of the above in one call
//   window.__agent3dInfo()    { stats, inspect, issues, state }

export const RUNTIME_URL = "/__runtime/agent3d-runtime.js";

export function previewHtml(opts: { pixelRatio?: number; transparent?: boolean } = {}): string {
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

window.__agent3dSheet = async (urls, labels, cols) => {
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
    reducedMotion: false,
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
