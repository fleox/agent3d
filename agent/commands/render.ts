import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { libraryProvider, readRuntimeFiles } from "../host";
import { CliError, printResult } from "../output";
import { parseSocialPreset, type SocialPresetId } from "../../src/ops/social";
import type { Command } from "./types";
import { boolOpt, confirmOrPlan, jsonOpt, numOpt, PROJECT_OPTION, projectFs, strOpt, usage, writeOutFile, YES_OPTION } from "./util";

const SIZE_OPTION = { name: "size", type: "string" as const, description: "Viewport WIDTHxHEIGHT in CSS pixels (default: width 1200 at the target aspect)." };
const TIMEOUT_OPTION = { name: "timeout", type: "string" as const, description: "Seconds to wait for the scene to load (default 60)." };

function timeoutMs(options: Record<string, unknown>): number | undefined {
  const t = numOpt(options as never, "timeout");
  return t === undefined ? undefined : Math.max(1, t) * 1000;
}

const log = (m: string) => void process.stderr.write(`${m}\n`);

export const renderCommand: Command = {
  name: "render",
  usage: "render [--frames 0,1.5,3 | --count 4] [--size 1200x300] [--scale 2] [--quality draft|standard|high|ultra] [--transparent] [--scroll 0.5] [--reduced-motion] [--segment <name>] [--sheet] [--input <json|@file>] [--isolate <objectId>] [--bg checker|<colour>|none] [--out renders/] | --video out.mp4|out.webm [--preset vertical|square|landscape|story] [--fit cover|contain] [--fps 30] [--duration 6] | --gif out.gif | --webp out.webp [--project <dir>]",
  summary: "Render the scene headless (installed Chrome, deterministic time) to PNGs — LOOK at them to check framing, colours, motion. Returns { dir, frames: [{ t, path }], sheet?, state, stats, inspect, issues, consoleErrors } (paths relative to the project folder `dir`). Games: --input plays a script of simulated keys / clicks / drags / swipes / HUD button clicks / emitted events and `state` shows the result (e.g. the score). Media: --video (MP4 H.264 / WebM VP9), --gif or --webp (animated) render every frame exactly at any --fps / --duration / --size (with --input, --segment, --scroll and --reduced-motion applied too) and return { path, format, codec, frames, fps, duration, size, bytes }. Social video: --video out.mp4 --preset vertical (1080x1920) | square (1080x1080) | landscape (1920x1080) | story (1080x1920, max 15 s) — 30 fps, one seamless loop of the photo motion, a bitrate social networks keep sharp and a cover fit (3D photos fill the frame, no edges; `notes` say what was cropped / tightened). Scenes whose timeline waits for a click / interaction: --segment <name> plays that segment from the start.",
  writes: true,
  options: [
    PROJECT_OPTION,
    { name: "frames", type: "string", description: "Comma-separated times in seconds." },
    { name: "count", type: "string", description: "Number of frames spread over the timeline (default 4)." },
    SIZE_OPTION,
    { name: "width", type: "string", description: "Viewport width when --size is not given (default 1200)." },
    { name: "scale", type: "string", description: "Device pixel ratio (default 1; 2 = retina-sharp)." },
    { name: "sheet", type: "boolean", description: "Also compose a contact sheet (grid with time labels) — the one image to look at." },
    { name: "cols", type: "string", description: "Contact sheet columns (default: from the aspect)." },
    { name: "capture", type: "string", description: "canvas (WebGL canvas only), page (includes the HUD / DOM overlays) or auto (page when the scene has a ui; default)." },
    { name: "input", type: "string", description: 'Games: simulated input applied while seeking, JSON array / @file / - : [{"t": 0.5, "key": "ArrowRight", "hold": 1}, {"t": 2, "key": "Space", "down": true}, {"t": 3, "click": [0, 0]}, {"t": 3, "pointer": [0.5, -0.2], "down": true}, {"t": 4, "pointerUp": true}, {"t": 1, "pointerDown": [0, 0]}, {"t": 1, "drag": {"from": [-0.5, 0], "to": [0.5, 0], "duration": 0.4}}, {"t": 2, "swipe": "left"}, {"t": 1, "scroll": 0.5}, {"t": 3, "emit": "retry"}, {"t": 3, "ui": "retryBtn"} (click a HUD button by id), {"t": 0, "segment": "intro"}] (key = KeyboardEvent.code, coordinates -1..1, y up; unknown fields are rejected). Frames render in time order; --video / --gif / --webp apply each event at its time.' },
    { name: "isolate", type: "string", description: "Render only this object (behaviours, scripts, UI dropped), at the origin, auto-framed from the front (+Z) three-quarter view on a neutral background (default 800x800, 1 frame) — to check a model's orientation and size. Returns isolated { size, center }." },
    { name: "bg", type: "string", description: 'Background drawn under the frames: "checker", a CSS colour ("#fff", "rgb(…)", "white") or "none". Default: a checkerboard under the contact sheet of transparent scenes (frames keep their alpha).' },
    { name: "out", type: "string", description: "Output folder, relative to the project folder (default <project>/renders)." },
    { name: "quality", type: "string", description: "Supersampling: draft / standard (1×, default), high (2×), ultra (3×) — rendered larger and downscaled for smoother edges and detail (clamped to 4096 px)." },
    { name: "transparent", type: "boolean", description: "Render with a transparent canvas (alpha PNG / GIF / WebP) even if the scene has a background." },
    { name: "scroll", type: "string", description: "Scroll progress 0..1 for scroll-driven scenes (e.g. 0.5 = half-way through the page). Renders one frame unless --frames / --count are given; frames are named by progress (<stamp>-s0_5.png) and carry `scroll`." },
    { name: "reduced-motion", type: "boolean", description: "Mount the scene as visitors with prefers-reduced-motion see it (reducedMotion: true — static pose / poster time)." },
    { name: "segment", type: "string", description: 'Play this timeline segment (timeline.segments, or "timeline") from t = 0 (media: from --start) — to film or check scenes whose timeline waits for a click / interaction (autoplay false, trigger manual / click).' },
    { name: "video", type: "string", description: "Render a video file instead of PNGs (default 1280 px wide): .mp4 (H.264, needs Google Chrome) or .webm (VP9), path relative to the project folder. Frame-exact; see --fps, --duration, --start, --size, --quality." },
    { name: "gif", type: "string", description: "Render an animated GIF, path relative to the project folder (looping, global palette, frame differencing; default 640 px wide, 15 fps)." },
    { name: "webp", type: "string", description: "Render an animated WebP, path relative to the project folder (smaller than GIF, alpha; default 800 px wide, 20 fps)." },
    { name: "fps", type: "string", description: "Video / GIF / WebP frames per second (default 30 / 15 / 20, max 60)." },
    { name: "duration", type: "string", description: "Video / GIF / WebP length in seconds (default the timeline duration, else 5)." },
    { name: "start", type: "string", description: "Video / GIF / WebP start time in seconds (default 0)." },
    { name: "bitrate", type: "string", description: "Video bitrate in Mbit/s (default from size, fps and --quality; 10 with a 1080p --preset)." },
    { name: "preset", type: "string", description: "Social video preset: vertical (1080x1920, 9:16), square (1080x1080), landscape (1920x1080) or story (1080x1920, at most 15 s). Sets --size, fps 30, the duration (one seamless loop of the 3D photo motion, else the timeline, unless --duration), the bitrate and a cover fit. Without --video / --gif / --webp: PNG frames of that framing spread over the loop." },
    { name: "fit", type: "string", description: "cover (default with --preset when the scene has a 3D photo: render at the frame's aspect and tighten the camera until the photos fill it, no edges) or contain (the runtime's own fit: a narrower frame widens the view and may show the background around a photo)." },
    TIMEOUT_OPTION,
    { ...YES_OPTION, description: "--video / --gif / --webp: overwrite an existing file." },
  ],
  async run({ io, options }) {
    const fs = projectFs(options);
    const { parseQuality } = await import("../render/render");
    const quality = parseQuality(strOpt(options, "quality"));
    const scroll = numOpt(options, "scroll");
    const { parseInputScript } = await import("../render/render");
    const rawInput = strOpt(options, "input") !== undefined ? jsonOpt(options, "input", `--input '[{"t": 0.5, "key": "ArrowRight", "hold": 1}]' or --input @inputs.json`) : undefined;
    const input = rawInput === undefined ? undefined : parseInputScript(rawInput);
    const segment = strOpt(options, "segment");
    const reducedMotion = boolOpt(options, "reduced-motion");
    const preset = presetOpt(strOpt(options, "preset"));
    const fit = parseFit(strOpt(options, "fit"));
    const mediaOpts = (["video", "gif", "webp"] as const).filter((k) => strOpt(options, k) !== undefined);
    if (mediaOpts.length > 1) usage("Use only one of --video, --gif, --webp per render.");
    if (mediaOpts.length) {
      const kind = mediaOpts[0];
      const out = projectPath(fs.root, strOpt(options, kind)!);
      const { renderMedia, mediaFormatFromPath } = await import("../render/render");
      const format = kind === "video" ? mediaFormatFromPath(out) : kind;
      if (kind === "video" && format !== "mp4" && format !== "webm") usage(`--video needs a .mp4 or .webm file name, got "${strOpt(options, kind)}".`, "e.g. --video renders/banner.mp4");
      if (existsSync(out) && !confirmOrPlan(io, options, { overwrite: [out] }, () => `Overwrite ${out}`)) return;
      const mbps = numOpt(options, "bitrate");
      const r = await renderMedia({
        projectDir: fs.root,
        out,
        format: format as "mp4" | "webm" | "gif" | "webp",
        fps: numOpt(options, "fps"),
        duration: numOpt(options, "duration"),
        start: numOpt(options, "start"),
        size: strOpt(options, "size"),
        width: numOpt(options, "width"),
        scale: numOpt(options, "scale"),
        quality,
        bg: strOpt(options, "bg"),
        transparent: boolOpt(options, "transparent"),
        bitrate: mbps === undefined ? undefined : mbps * 1e6,
        input,
        segment,
        reducedMotion,
        scroll,
        preset,
        fit,
        timeoutMs: timeoutMs(options),
        log,
      });
      const { data: _data, ...result } = r;
      return printResult(io, { ...result, path: out }, () => [`${r.format.toUpperCase()} ${r.duration}s @ ${r.fps} fps (${r.frames} frames, ${r.size.width}x${r.size.height}, ${r.codec}${r.supersampling > 1 ? `, ${r.supersampling}× supersampled` : ""}, ${Math.round(r.bytes / 1024)} KB, ${Math.round(r.ms / 1000)} s) → ${out}`, ...(r.notes ?? []).map((n) => `  ${n}`)].join("\n"));
    }
    const capture = strOpt(options, "capture");
    if (capture && !["auto", "canvas", "page"].includes(capture)) usage(`--capture must be auto, canvas or page, got "${capture}".`);
    const { renderProject, socialPlan } = await import("../render/render");
    // A scroll position is one state: one frame unless --frames / --count ask for more.
    let frames = renderFrames(strOpt(options, "frames"), numOpt(options, "count"), scroll);
    // --preset / --fit without media: PNG frames of that framing (spread over one loop).
    const social = preset || fit ? socialPlan({ preset, fit, size: strOpt(options, "size"), width: numOpt(options, "width"), projectDir: fs.root, duration: numOpt(options, "duration") }) : undefined;
    if (social?.duration && !frames) frames = loopFrames(social.start, social.duration, numOpt(options, "count"));
    const r = await renderProject({
      projectDir: fs.root,
      ...(social ? { scene: social.scene } : {}),
      frames,
      count: numOpt(options, "count"),
      size: social?.size ?? strOpt(options, "size"),
      width: numOpt(options, "width"),
      scale: numOpt(options, "scale"),
      sheet: boolOpt(options, "sheet"),
      cols: numOpt(options, "cols"),
      capture: capture as "auto" | "canvas" | "page" | undefined,
      input,
      isolate: strOpt(options, "isolate"),
      bg: strOpt(options, "bg"),
      quality,
      transparent: boolOpt(options, "transparent"),
      scroll,
      reducedMotion,
      segment,
      outDir: strOpt(options, "out") ? projectPath(fs.root, strOpt(options, "out")!) : undefined,
      timeoutMs: timeoutMs(options),
      log,
    });
    const offscreen = (r.inspect?.objects ?? []).filter((o) => o.inView === "none").map((o) => o.id);
    const hints = [
      ...(offscreen.length ? [`Not in view: ${offscreen.join(", ")} — move them or the camera (scene patch camera.position / camera.target).`] : []),
      ...(r.inspect?.camera.insideObject ? [`The camera is inside "${r.inspect.camera.insideObject}".`] : []),
      ...(r.issues.length ? [`${r.issues.length} runtime issue(s): see issues.`] : []),
      ...(r.consoleErrors.length ? [`${r.consoleErrors.length} console error(s): see consoleErrors.`] : []),
      ...(r.inputWarnings ?? []),
    ];
    if (social?.notes.length) hints.push(...social.notes);
    printResult(io, { ...r, ...(social?.preset ? { preset: social.preset } : {}), ...(hints.length ? { hints } : {}) }, () =>
      [
        ...r.frames.map((f) => `${f.scroll !== undefined ? `scroll=${f.scroll} ` : ""}t=${f.t}s  ${resolve(r.dir, f.path)}`),
        ...(r.sheet ? [`sheet   ${resolve(r.dir, r.sheet)}`] : []),
        ...(r.isolated ? [`isolated "${r.isolated.id}": size ${r.isolated.size.join(" × ")} (w × h × d) — ${r.isolated.note}`] : []),
        ...(r.state && Object.keys(r.state).length ? [`state   ${JSON.stringify(r.state)}`] : []),
        `${r.size.width}x${r.size.height}@${r.size.deviceScaleFactor}x · ${r.stats?.triangles ?? "?"} triangles · ${r.stats?.drawCalls ?? "?"} draw calls · ${r.timings.totalMs} ms`,
        ...hints,
      ].join("\n"),
    );
  },
};

/** --preset: a social video preset id (usage error with did-you-mean otherwise). */
export function presetOpt(v: string | undefined): SocialPresetId | undefined {
  if (v === undefined) return undefined;
  const p = parseSocialPreset(v);
  if ("error" in p) usage(p.error, p.hint);
  return (p as { id: SocialPresetId }).id;
}

/** --fit: cover | contain. */
export function parseFit(v: string | undefined): "cover" | "contain" | undefined {
  if (v === undefined) return undefined;
  if (v !== "cover" && v !== "contain") usage(`--fit must be cover or contain, got "${v}".`, "cover fills the frame with the 3D photo (cropping the scene); contain keeps the scene's design width visible.");
  return v;
}

/** `count` frame times (default 4) spread over one loop [start, start + duration). */
export function loopFrames(start: number, duration: number, count: number | undefined): string {
  const n = Math.max(1, Math.min(64, Math.round(count ?? 4)));
  return Array.from({ length: n }, (_, i) => Math.round((start + (i * duration) / n) * 1000) / 1000).join(",");
}

/** --frames to render: a --scroll position alone is one frame (t = 0). */
export function renderFrames(frames: string | undefined, count: number | undefined, scroll: number | undefined): string | undefined {
  return frames ?? (scroll !== undefined && count === undefined ? "0" : undefined);
}

/** A relative render output path is relative to the project folder (absolute paths are kept). */
export function projectPath(root: string, p: string): string {
  return isAbsolute(p) ? p : resolve(root, p);
}

function dirNonEmpty(dir: string): string[] {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir);
}

export const exportCommand: Command = {
  name: "export",
  usage: "export [--format embed|zip|single-html|poster|video|gif] [--preset vertical|square|landscape|story] [--out <path>] [--name <slug>] [--base-url <url>] [--cache-bust] [--no-integrity] [--no-poster] [--no-og] [--prune-runtime] [--runtime auto|full] [--yes] [--project <dir>]",
  summary:
    "Export for a website: embed (Web Component + static files + EMBED.md + React/Vue/Svelte wrappers, default), zip (the embed folder as one .zip), single-html (one file), poster (still image), video (MP4 H.264 / WebM VP9) or gif. Reports pageKb / pageKbGzip (what a visitor downloads for this scene: runtime entry + the chunks it loads + scene, assets, scripts, poster) and folderKb (every file written). Overwriting a non-empty --out needs --yes.",
  writes: true,
  options: [
    PROJECT_OPTION,
    { name: "format", type: "string", description: "embed (default), zip, single-html, poster, video or gif." },
    { name: "out", type: "string", description: "Output folder, relative to the project folder (embed / zip / single-html: default <project>/dist/<format>) or file (poster / video / gif: default <project>/dist/poster.webp, video.webm, animation.gif; a .mp4 --out renders H.264)." },
    { name: "name", type: "string", description: "Scene folder / file name in the export (default: the project name)." },
    { name: "base-url", type: "string", description: 'embed / zip: URL of the export folder as seen from the pages (default "./"), e.g. /wp-content/uploads/agent3d/ or https://cdn.example.com/3d/ — the snippet then works from any page.' },
    { name: "cache-bust", type: "boolean", description: "embed / zip: versioned runtime folder (agent3d-runtime-<hash>/) and ?v=<hash> on the scene URL, so both can be cached for a year." },
    { name: "no-integrity", type: "boolean", description: "embed / zip: no Subresource Integrity hash on the runtime <script> (default: integrity=\"sha384-…\")." },
    { name: "no-extras", type: "boolean", description: "embed / zip: skip EMBED.md and frameworks/ (React / Vue / Svelte wrappers)." },
    { name: "no-poster", type: "boolean", description: "embed / zip / single-html: don't render a poster nor og-image (no Chrome needed)." },
    { name: "prune-runtime", type: "boolean", description: "embed / zip: copy only the runtime chunks this scene loads (smaller folder). Only for a runtime folder used by this scene alone — other scenes sharing it may need the left-out chunks; kept whole when a chunk's feature is unknown." },
    { name: "runtime", type: "string", description: "embed / zip / single-html: auto (default) ships the photo-only lite runtime (agent3d-photo.js, ~14 KB gzipped, no three.js) when the scene is a single 3D photo with a fixed camera and a plain background; full always ships agent3d-runtime.js. The result's runtime / runtimeReasons say which and why." },
    { name: "no-og", type: "boolean", description: "embed / zip: don't render the 1200×630 og-image.png social preview." },
    { name: "optimize", type: "boolean", description: "embed / zip / single-html: export optimised copies of the assets (project and library) — textures at the size the scene needs (format kept), .glb geometry meshopt-compressed with WebP textures. The project is not modified. Textures need Chrome." },
    { name: "image", type: "string", description: "poster: webp (default), png or jpeg." },
    { name: "time", type: "string", description: "poster: time in seconds (default target.posterTime)." },
    { name: "duration", type: "string", description: "video / gif: seconds (default the timeline duration, else 5; with --preset one seamless loop of the 3D photo motion)." },
    { name: "preset", type: "string", description: "video / gif: social preset — vertical (1080x1920), square (1080x1080), landscape (1920x1080) or story (1080x1920, max 15 s): size, 30 fps, one seamless loop, bitrate and a cover fit (the 3D photo fills the frame). The default --out becomes dist/video-<preset>.mp4." },
    { name: "fps", type: "string", description: "video / gif: frames per second (default 30 / 15)." },
    { name: "quality", type: "string", description: "poster / video / gif: draft, standard (default), high (2× supersampling) or ultra (3×)." },
    { name: "transparent", type: "boolean", description: "poster (png / webp) / gif: transparent background." },
    { ...SIZE_OPTION, description: "poster / video / gif: WIDTHxHEIGHT in CSS pixels (default: at the target aspect, width 1200 for a poster, 960 for a video, 640 for a gif)." },
    { name: "scale", type: "string", description: "poster: device pixel ratio (default 2)." },
    TIMEOUT_OPTION,
    YES_OPTION,
  ],
  async run({ io, options }) {
    const fs = projectFs(options);
    const format = strOpt(options, "format") ?? "embed";
    const FORMATS = ["embed", "zip", "single-html", "poster", "video", "gif"];
    if (!FORMATS.includes(format)) usage(`Unknown --format "${format}".`, `Use ${FORMATS.join(", ")}.`);
    const outOpt = strOpt(options, "out");
    const render = () => import("../render/render");

    if (format === "poster" || format === "video" || format === "gif") {
      const { parseQuality, mediaFormatFromPath } = await render();
      const quality = parseQuality(strOpt(options, "quality"));
      const image = (strOpt(options, "image") ?? (outOpt?.endsWith(".png") ? "png" : /\.jpe?g$/i.test(outOpt ?? "") ? "jpeg" : "webp")) as "webp" | "png" | "jpeg";
      if (!["webp", "png", "jpeg"].includes(image)) usage("--image must be webp, png or jpeg.");
      const preset = format === "poster" ? undefined : presetOpt(strOpt(options, "preset"));
      const out = projectPath(fs.root, outOpt ?? join(fs.root, "dist", format === "poster" ? `poster.${image === "jpeg" ? "jpg" : image}` : format === "gif" ? (preset ? `animation-${preset}.gif` : "animation.gif") : preset ? `video-${preset}.mp4` : "video.webm"));
      if (existsSync(out) && !confirmOrPlan(io, options, { overwrite: [out] }, () => `Overwrite ${out}`)) return;
      const r = await render();
      if (format === "poster") {
        const p = await r.renderPoster({ projectDir: fs.root, format: image, size: strOpt(options, "size"), scale: numOpt(options, "scale") ?? 2, time: numOpt(options, "time"), quality, transparent: boolOpt(options, "transparent"), timeoutMs: timeoutMs(options), log });
        writeOutFile(out, p.bytes);
        return printResult(io, { format, path: out, t: p.t, size: p.size, bytes: p.bytes.byteLength, ...(p.supersampling > 1 ? { supersampling: p.supersampling } : {}) }, () => `Poster (t=${p.t}s) → ${out}`);
      }
      const media = format === "gif" ? "gif" : mediaFormatFromPath(out) === "mp4" ? "mp4" : "webm";
      const m = await r.renderMedia({ projectDir: fs.root, out, format: media, size: strOpt(options, "size"), width: format === "video" && !strOpt(options, "size") ? 960 : undefined, duration: numOpt(options, "duration"), fps: numOpt(options, "fps"), quality, transparent: boolOpt(options, "transparent"), preset, timeoutMs: timeoutMs(options), log });
      return printResult(io, { format, path: out, codec: m.codec, frames: m.frames, fps: m.fps, duration: m.duration, size: m.size, bytes: m.bytes, ms: m.ms, ...(m.preset ? { preset: m.preset } : {}), ...(m.notes ? { notes: m.notes } : {}) }, () => [`${media.toUpperCase()} ${m.duration}s @ ${m.fps} fps (${m.frames} frames, ${m.size.width}x${m.size.height}, ${m.codec}, ${Math.round(m.bytes / 1024)} KB) → ${out}`, ...(m.notes ?? []).map((n) => `  ${n}`)].join("\n"));
    }

    const out = projectPath(fs.root, outOpt ?? join(fs.root, "dist", format));
    const existing = dirNonEmpty(out);
    if (existing.length && !confirmOrPlan(io, options, { out, overwrite: true, existingEntries: existing.slice(0, 50) }, () => `${out} is not empty (${existing.length} entries): files with the same names are overwritten.`)) return;
    const warnings: string[] = [];
    let images: { poster?: Uint8Array; posterSize?: { width: number; height: number }; og?: Uint8Array } = {};
    if (!boolOpt(options, "no-poster")) {
      try {
        const { renderExportImages } = await render();
        images = await renderExportImages({ projectDir: fs.root, og: format !== "single-html" && !boolOpt(options, "no-og"), timeoutMs: timeoutMs(options), log });
      } catch (e) {
        const err = e as CliError;
        warnings.push(`No poster: ${err.message}${err.hint ? ` (${err.hint})` : ""} — the export works without it (no image before load / without WebGL).`);
      }
    }
    const runtimeChoice = strOpt(options, "runtime") ?? "auto";
    if (runtimeChoice !== "auto" && runtimeChoice !== "full") usage(`Unknown --runtime "${runtimeChoice}".`, "Use auto (default: the photo-only lite runtime for single-3D-photo scenes) or full.");
    const runtime = { files: readRuntimeFiles(format as "embed" | "single-html" | "zip") };
    const { buildExport } = await import("../../src/ops/export");
    const { version } = (await import("../../package.json")).default;
    // --optimize: buildExport reads optimised copies (src/ops/optimize.ts); nothing in the project changes.
    let exportFs: typeof fs | import("../../src/core/fs").ProjectFs = fs;
    let exportLibrary = libraryProvider();
    let optimizeReport: (() => import("../../src/ops/optimize").ExportOptimizeReport) | undefined;
    let closeCodec: (() => Promise<void>) | undefined;
    if (boolOpt(options, "optimize")) {
      const { optimizedExportSources } = await import("../../src/ops/optimize");
      let codec: import("../../src/ops/optimize").ImageCodec | undefined;
      if ((await import("../render/browser")).findBrowser()) {
        const c = await (await import("../render/imageCodec")).openImageCodec({ log });
        codec = c.codec;
        closeCodec = c.close;
      } else warnings.push("--optimize: no Chrome found, textures were not resized (geometry was compressed).");
      const o = await optimizedExportSources(fs, exportLibrary, { codec });
      exportFs = o.fs;
      exportLibrary = o.library;
      optimizeReport = o.report;
    }
    const r = await buildExport(exportFs, {
      format: format as "embed" | "single-html" | "zip",
      name: strOpt(options, "name"),
      runtime,
      library: exportLibrary,
      poster: images.poster,
      posterSize: images.posterSize,
      ogImage: images.og,
      baseUrl: strOpt(options, "base-url"),
      cacheBust: boolOpt(options, "cache-bust"),
      integrity: !boolOpt(options, "no-integrity"),
      extras: !boolOpt(options, "no-extras"),
      pruneRuntime: boolOpt(options, "prune-runtime"),
      runtimeChoice: runtimeChoice as "auto" | "full",
      version,
    }).finally(() => closeCodec?.());
    const optimized = optimizeReport?.();
    const written: string[] = [];
    for (const [rel, data] of Object.entries(r.files)) {
      const abs = resolve(out, rel);
      if (abs !== out && !abs.startsWith(out + sep)) throw new CliError("invalid-path", `Export file escapes the output folder: ${rel}`, "Report this (ops/export.ts produced an invalid path).");
      writeOutFile(abs, typeof data === "string" ? data : data);
      written.push(abs);
    }
    const entry = resolve(out, r.entry);
    printResult(
      io,
      { format, out, entry, snippet: r.snippet, ...(r.head ? { head: r.head } : {}), ...(r.integrity ? { integrity: r.integrity } : {}), ...(r.runtimeDir ? { runtimeDir: r.runtimeDir } : {}), pageKb: r.pageKb, ...(r.pageKbGzip !== undefined ? { pageKbGzip: r.pageKbGzip } : {}), folderKb: r.folderKb, totalKb: r.totalKb, sizes: r.sizes, page: r.page, runtime: r.runtime, ...(r.runtimeReasons ? { runtimeReasons: r.runtimeReasons } : {}), ...(optimized ? { optimized } : {}), credits: r.credits, issues: r.issues, files: written.map((f) => relative(out, f)), ...(warnings.length ? { warnings } : {}) },
      () =>
        [
          `Exported ${format} → ${out} (folder ${r.folderKb} KB, ${written.length} files)`,
          r.runtime === "photo-lite"
            ? `Page weight: ${r.pageKb} KB${r.pageKbGzip !== undefined ? ` (${r.pageKbGzip} KB gzipped)` : ""} — photo-only lite runtime ${r.page.runtimeKb} KB (agent3d-photo.js, no three.js) + scene, assets, poster.`
            : `Page weight: ${r.pageKb} KB${r.pageKbGzip !== undefined ? ` (${r.pageKbGzip} KB gzipped)` : ""} — runtime ${r.page.runtimeKb} KB (${r.page.runtimeFiles.length} files; ${r.page.skippedChunks.length} lazy chunks this scene never loads${r.page.pruned ? ", left out" : ""}) + scene, assets, scripts, poster.`,
          `Open: ${entry}`,
          ...(optimized ? [`Optimised asset copies: ${optimized.beforeKb} → ${optimized.afterKb} KB (saved ${optimized.savedKb} KB; the project is unchanged).`] : []),
          ...(format === "zip" ? [] : ["", "Paste in your page:", r.snippet]),
          ...(format === "embed" ? ["", `How to publish it (WordPress, Webflow, Shopify, React, Vue…): ${resolve(out, "EMBED.md")}`] : []),
          ...warnings.map((w) => `! ${w}`),
        ].join("\n"),
    );
  },
};
