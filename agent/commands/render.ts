import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { libraryProvider, readRuntimeFiles } from "../host";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { boolOpt, confirmOrPlan, numOpt, PROJECT_OPTION, projectFs, strOpt, usage, writeOutFile, YES_OPTION } from "./util";

const SIZE_OPTION = { name: "size", type: "string" as const, description: "Viewport WIDTHxHEIGHT in CSS pixels (default: width 1200 at the target aspect)." };
const TIMEOUT_OPTION = { name: "timeout", type: "string" as const, description: "Seconds to wait for the scene to load (default 60)." };

function timeoutMs(options: Record<string, unknown>): number | undefined {
  const t = numOpt(options as never, "timeout");
  return t === undefined ? undefined : Math.max(1, t) * 1000;
}

const log = (m: string) => void process.stderr.write(`${m}\n`);

export const renderCommand: Command = {
  name: "render",
  usage: "render [--frames 0,1.5,3 | --count 4] [--size 1200x300] [--scale 2] [--sheet] [--out renders/] [--project <dir>]",
  summary: "Render the scene headless (installed Chrome, deterministic time) to PNGs — LOOK at them to check framing, colours, motion. Returns { frames: [{ t, path }], sheet?, stats, inspect, issues, consoleErrors }.",
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
    { name: "out", type: "string", description: "Output folder (default <project>/renders)." },
    TIMEOUT_OPTION,
  ],
  async run({ io, options }) {
    const fs = projectFs(options);
    const capture = strOpt(options, "capture");
    if (capture && !["auto", "canvas", "page"].includes(capture)) usage(`--capture must be auto, canvas or page, got "${capture}".`);
    const { renderProject } = await import("../render/render");
    const r = await renderProject({
      projectDir: fs.root,
      frames: strOpt(options, "frames"),
      count: numOpt(options, "count"),
      size: strOpt(options, "size"),
      width: numOpt(options, "width"),
      scale: numOpt(options, "scale"),
      sheet: boolOpt(options, "sheet"),
      cols: numOpt(options, "cols"),
      capture: capture as "auto" | "canvas" | "page" | undefined,
      outDir: strOpt(options, "out") ? resolve(strOpt(options, "out")!) : undefined,
      timeoutMs: timeoutMs(options),
      log,
    });
    const offscreen = (r.inspect?.objects ?? []).filter((o) => o.inView === "none").map((o) => o.id);
    const hints = [
      ...(offscreen.length ? [`Not in view: ${offscreen.join(", ")} — move them or the camera (scene patch camera.position / camera.target).`] : []),
      ...(r.inspect?.camera.insideObject ? [`The camera is inside "${r.inspect.camera.insideObject}".`] : []),
      ...(r.issues.length ? [`${r.issues.length} runtime issue(s): see issues.`] : []),
      ...(r.consoleErrors.length ? [`${r.consoleErrors.length} console error(s): see consoleErrors.`] : []),
    ];
    printResult(io, { ...r, ...(hints.length ? { hints } : {}) }, () =>
      [
        ...r.frames.map((f) => `t=${f.t}s  ${f.path}`),
        ...(r.sheet ? [`sheet   ${r.sheet}`] : []),
        `${r.size.width}x${r.size.height}@${r.size.deviceScaleFactor}x · ${r.stats?.triangles ?? "?"} triangles · ${r.stats?.drawCalls ?? "?"} draw calls · ${r.timings.totalMs} ms`,
        ...hints,
      ].join("\n"),
    );
  },
};

function dirNonEmpty(dir: string): string[] {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir);
}

export const exportCommand: Command = {
  name: "export",
  usage: "export [--format embed|single-html|poster|video] [--out <path>] [--name <slug>] [--no-poster] [--yes] [--project <dir>]",
  summary: "Export for a website: embed (Web Component + static files, default), single-html (one file), poster (still image), video (WebM). Overwriting a non-empty --out needs --yes.",
  writes: true,
  options: [
    PROJECT_OPTION,
    { name: "format", type: "string", description: "embed (default), single-html, poster or video." },
    { name: "out", type: "string", description: "Output folder (embed / single-html: default <project>/dist/<format>) or file (poster / video: default <project>/dist/poster.webp, video.webm)." },
    { name: "name", type: "string", description: "Scene folder / file name in the export (default: the project name)." },
    { name: "no-poster", type: "boolean", description: "embed / single-html: don't render a poster (no Chrome needed)." },
    { name: "image", type: "string", description: "poster: webp (default) or png." },
    { name: "time", type: "string", description: "poster: time in seconds (default target.posterTime)." },
    { name: "duration", type: "string", description: "video: seconds (default the timeline duration, else 5)." },
    { name: "fps", type: "string", description: "video: frames per second (default 30)." },
    SIZE_OPTION,
    { name: "scale", type: "string", description: "poster: device pixel ratio (default 2)." },
    TIMEOUT_OPTION,
    YES_OPTION,
  ],
  async run({ io, options }) {
    const fs = projectFs(options);
    const format = strOpt(options, "format") ?? "embed";
    if (!["embed", "single-html", "poster", "video"].includes(format)) usage(`Unknown --format "${format}".`, "Use embed, single-html, poster or video.");
    const outOpt = strOpt(options, "out");

    if (format === "poster" || format === "video") {
      const image = (strOpt(options, "image") ?? (outOpt?.endsWith(".png") ? "png" : "webp")) as "webp" | "png";
      if (!["webp", "png"].includes(image)) usage("--image must be webp or png.");
      const out = resolve(outOpt ?? join(fs.root, "dist", format === "poster" ? `poster.${image}` : "video.webm"));
      if (existsSync(out) && !confirmOrPlan(io, options, { overwrite: [out] }, () => `Overwrite ${out}`)) return;
      const render = await import("../render/render");
      if (format === "poster") {
        const r = await render.renderPoster({ projectDir: fs.root, format: image, size: strOpt(options, "size"), scale: numOpt(options, "scale") ?? 2, time: numOpt(options, "time"), timeoutMs: timeoutMs(options), log });
        writeOutFile(out, r.bytes);
        return printResult(io, { format, path: out, t: r.t, size: r.size, bytes: r.bytes.byteLength }, () => `Poster (t=${r.t}s) → ${out}`);
      }
      const r = await render.renderVideo({ projectDir: fs.root, size: strOpt(options, "size"), duration: numOpt(options, "duration"), fps: numOpt(options, "fps"), timeoutMs: timeoutMs(options), log });
      writeOutFile(out, r.bytes);
      return printResult(io, { format, path: out, frames: r.frames, fps: r.fps, duration: r.duration, size: r.size, bytes: r.bytes.byteLength, ms: r.ms }, () => `Video ${r.duration}s @ ${r.fps} fps (${r.frames} frames, ${Math.round(r.bytes.byteLength / 1024)} KB) → ${out}`);
    }

    const out = resolve(outOpt ?? join(fs.root, "dist", format));
    const existing = dirNonEmpty(out);
    if (existing.length && !confirmOrPlan(io, options, { out, overwrite: true, existingEntries: existing.slice(0, 50) }, () => `${out} is not empty (${existing.length} entries): files with the same names are overwritten.`)) return;
    const warnings: string[] = [];
    let poster: Uint8Array | undefined;
    if (!boolOpt(options, "no-poster")) {
      try {
        const { renderPoster } = await import("../render/render");
        poster = (await renderPoster({ projectDir: fs.root, format: "webp", scale: 1, timeoutMs: timeoutMs(options), log })).bytes;
      } catch (e) {
        const err = e as CliError;
        warnings.push(`No poster: ${err.message}${err.hint ? ` (${err.hint})` : ""} — the export works without it (no WebGL fallback image).`);
      }
    }
    const runtime = { files: readRuntimeFiles(format as "embed" | "single-html") };
    const { buildExport } = await import("../../src/ops/export");
    const r = await buildExport(fs, { format: format as "embed" | "single-html", name: strOpt(options, "name"), runtime, library: libraryProvider(), poster });
    const written: string[] = [];
    for (const [rel, data] of Object.entries(r.files)) {
      const abs = resolve(out, rel);
      if (abs !== out && !abs.startsWith(out + sep)) throw new CliError("invalid-path", `Export file escapes the output folder: ${rel}`, "Report this (ops/export.ts produced an invalid path).");
      writeOutFile(abs, typeof data === "string" ? data : data);
      written.push(abs);
    }
    const entry = resolve(out, r.entry);
    printResult(io, { format, out, entry, snippet: r.snippet, totalKb: r.totalKb, sizes: r.sizes, credits: r.credits, issues: r.issues, files: written.map((f) => relative(out, f)), ...(warnings.length ? { warnings } : {}) }, () =>
      [`Exported ${format} → ${out} (${r.totalKb} KB, ${written.length} files)`, `Open: ${entry}`, "", "Paste in your page:", r.snippet, ...warnings.map((w) => `! ${w}`)].join("\n"),
    );
  },
};
