// The page `agent3d serve` shows: the scene full width at its aspect ratio,
// a small toolbar (play / pause, time scrubber, reload) and live updates
// over Server-Sent Events — scene.json changes call player.update(scene)
// without reloading; asset / script changes reload the page.

export function livePageHtml(opts: { title: string; runtimeUrl: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — Agent3D preview</title>
<style>
  :root { color-scheme: dark; --bg: #111216; --panel: #1b1c22; --fg: #e8e8ee; --muted: #8a8c99; --accent: #7c9cff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
  #frame { width: 100%; position: relative; background: #000; }
  #stage { position: absolute; inset: 0; }
  #bar { display: flex; gap: 10px; align-items: center; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid #2a2c35; position: sticky; top: 0; z-index: 2; }
  button { background: #2a2c35; color: var(--fg); border: 0; border-radius: 6px; padding: 5px 10px; font: inherit; cursor: pointer; }
  button:hover { background: #343744; }
  input[type=range] { flex: 1; accent-color: var(--accent); }
  #time { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 92px; text-align: right; }
  #status { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
  #issues { margin: 0; padding: 8px 12px; color: #ffb4a8; white-space: pre-wrap; font: 12px/1.4 ui-monospace, Menlo, monospace; }
  #issues:empty { display: none; }
</style>
</head>
<body>
<div id="bar">
  <button id="play" title="Play / pause">Pause</button>
  <input id="scrub" type="range" min="0" max="4" step="0.01" value="0" aria-label="Time">
  <span id="time">0.00 s</span>
  <button id="reload" title="Reload the page">Reload</button>
  <span id="status">Loading…</span>
</div>
<div id="frame"><div id="stage"></div></div>
<pre id="issues"></pre>
<script type="module">
const $ = (id) => document.getElementById(id);
const issuesEl = $("issues"), statusEl = $("status"), scrub = $("scrub"), timeEl = $("time"), playBtn = $("play");
let player = null, scene = null, playing = true, issues = [];
const showIssues = () => { issuesEl.textContent = issues.map((i) => "• " + (i.path ? i.path + ": " : "") + i.message).join("\\n"); };
const size = () => {
  const t = (scene && scene.target) || {};
  const m = /^(\\d+(?:\\.\\d+)?):(\\d+(?:\\.\\d+)?)$/.exec(t.aspect || "16:9");
  const ratio = m ? Number(m[1]) / Number(m[2]) : 16 / 9;
  const frame = $("frame");
  if (t.height) { frame.style.height = t.height; frame.style.aspectRatio = ""; }
  else { frame.style.height = ""; frame.style.aspectRatio = String(ratio); frame.style.maxHeight = t.kind === "fullscreen" ? "calc(100vh - 44px)" : ""; }
  scrub.max = String((scene && scene.timeline && scene.timeline.duration) || 4);
  player && player.resize && player.resize();
};
const fetchScene = async () => (await fetch("/__scene.json", { cache: "no-store" })).json();
let mod;
try {
  mod = await import(${JSON.stringify(opts.runtimeUrl)});
  scene = await fetchScene();
  size();
  player = mod.mountScene($("stage"), scene, { assetBase: "/project/", libraryBase: "/__library/", onError: (i) => { issues.push(i); showIssues(); } });
  window.__agent3d = { get player() { return player; }, issues, ready: false };
  await player.ready;
  window.__agent3d.ready = true;
  statusEl.textContent = scene.title || "Ready";
} catch (e) {
  statusEl.textContent = "Failed";
  issues.push({ message: String((e && e.message) || e) });
  showIssues();
}
const tick = () => {
  if (player && playing) { const t = player.time(); scrub.value = String(t % Number(scrub.max || 1)); timeEl.textContent = t.toFixed(2) + " s"; }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
playBtn.onclick = () => { if (!player) return; playing = !playing; playing ? player.play() : player.pause(); playBtn.textContent = playing ? "Pause" : "Play"; };
scrub.oninput = async () => { if (!player) return; if (playing) { playing = false; player.pause(); playBtn.textContent = "Play"; } const t = Number(scrub.value); await player.seek(t); timeEl.textContent = t.toFixed(2) + " s"; };
$("reload").onclick = () => location.reload();
const es = new EventSource("/__events");
es.addEventListener("scene", async () => {
  try {
    const next = await fetchScene();
    scene = next; size();
    issues.length = 0; showIssues();
    if (player) { await player.update(next); statusEl.textContent = "Updated " + new Date().toLocaleTimeString(); }
  } catch (e) { statusEl.textContent = "scene.json: " + ((e && e.message) || e); }
});
es.addEventListener("reload", () => location.reload());
</script>
</body>
</html>
`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
