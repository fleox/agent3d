import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync, inflateRawSync } from "node:zlib";
import type { ToolContext, ToolHost } from "../src/ai/tools";
import type { Issue } from "../src/core/types";
import type { RuntimeIssue } from "../src/runtime/api";
import { libraryProvider, readRuntimeFiles, readTemplateFiles, readTemplatesIndex } from "./host";
import type { NodeFs } from "./nodeFs";

// Glue between the AI tool catalog (src/ai/tools.ts) and the Node front
// doors (`tools`, `mcp`, the Studio API): the ToolHost with the headless
// render, the runtime files, the library, the templates, zip inflate and
// local file reads.

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  mutating: boolean;
}

export function runtimeIssueToIssue(i: RuntimeIssue): Issue {
  return { severity: "warning", code: i.code, path: i.path ?? "", message: i.message };
}

export function nodeHost(fs: NodeFs | null): ToolHost {
  return {
    ...(fs
      ? {
          async render(opts) {
            const { renderProject } = await import("./render/render");
            const r = await renderProject({
              projectDir: fs.root,
              frames: opts.frames?.length ? opts.frames.join(",") : undefined,
              count: opts.count,
              size: opts.size,
              sheet: opts.sheet ?? true,
              outDir: opts.out ? fs.resolve(opts.out) : undefined,
              input: opts.input ? (await import("./render/render")).parseInputScript(opts.input) : undefined,
              previewWidth: opts.previewWidth,
              isolate: opts.isolate,
              bg: opts.bg,
              scroll: opts.scroll,
              reducedMotion: opts.reducedMotion,
              segment: opts.segment,
              log: (m) => void process.stderr.write(`${m}\n`),
            });
            return { dir: r.dir, frames: r.frames, ...(r.sheet ? { sheet: r.sheet } : {}), ...(r.preview ? { preview: r.preview } : {}), ...(r.isolated ? { isolated: r.isolated } : {}), ...(r.stats ? { stats: r.stats } : {}), ...(r.inspect ? { inspect: r.inspect } : {}), state: r.state, ...(r.inputWarnings ? { inputWarnings: r.inputWarnings } : {}), issues: r.issues.map(runtimeIssueToIssue), consoleErrors: r.consoleErrors };
          },
        }
      : {}),
    ...(fs
      ? {
          async media(opts) {
            const render = await import("./render/render");
            const log = (m: string) => void process.stderr.write(`${m}\n`);
            if (opts.format === "poster") {
              const r = await render.renderPoster({ projectDir: fs.root, format: opts.image ?? "webp", size: opts.size, scale: opts.size ? 1 : 2, time: opts.time, quality: opts.quality, transparent: opts.transparent, log });
              return { bytes: r.bytes, t: r.t, size: { width: r.size.width, height: r.size.height } };
            }
            if (opts.format === "og") {
              const r = await render.renderExportImages({ projectDir: fs.root, og: true, time: opts.time, log });
              return { bytes: r.og!, t: r.t, size: { width: 1200, height: 630 } };
            }
            if (opts.format === "gif" || opts.format === "webp") {
              const r = await render.renderMedia({ projectDir: fs.root, out: `animation.${opts.format}`, format: opts.format, size: opts.size, duration: opts.duration, fps: opts.fps, quality: opts.quality, transparent: opts.transparent, write: false, log });
              return { bytes: r.data, codec: r.codec, frames: r.frames, fps: r.fps, duration: r.duration, size: { width: r.size.width, height: r.size.height } };
            }
            const r = await render.renderVideo({ projectDir: fs.root, size: opts.size, duration: opts.duration, fps: opts.fps, format: opts.video, quality: opts.quality, log });
            return { bytes: r.bytes, codec: r.codec, frames: r.frames, fps: r.fps, duration: r.duration, size: { width: r.size.width, height: r.size.height } };
          },
        }
      : {}),
    runtimeFiles: async (format) => readRuntimeFiles(format),
    library: libraryProvider(),
    templates: { index: readTemplatesIndex(), files: async (id) => readTemplateFiles(id) },
    inflate: (data) => new Uint8Array(inflateRawSync(data)),
    async withImageCodec(fn) {
      const { withImageCodec } = await import("./render/imageCodec");
      return withImageCodec(fn, { log: (m) => void process.stderr.write(`${m}\n`) });
    },
    async withDepthEstimator(fn) {
      const { withDepthEstimator } = await import("./render/depth");
      return withDepthEstimator(fn, { log: (m) => void process.stderr.write(`${m}\n`) });
    },
    async withPixelCodec(fn) {
      const { withPixelCodec } = await import("./render/imageCodec");
      return withPixelCodec(fn, { log: (m) => void process.stderr.write(`${m}\n`) });
    },
    deflate: (data) => new Uint8Array(deflateSync(data)),
    readLocalFile: async (path) => new Uint8Array(readFileSync(resolve(path))),
  };
}

export function toolContext(fs: NodeFs): ToolContext {
  return { fs, fetch: fetch as unknown as ToolContext["fetch"], host: nodeHost(fs) };
}

export async function listTools(opts: { render?: boolean } = {}): Promise<ToolInfo[]> {
  const { listAiTools } = await import("../src/ai/tools");
  const host = nodeHost(null);
  // render_preview is listed whenever the host can render (needs a project at call time).
  const withRender: ToolHost = opts.render === false ? host : { ...host, render: async () => Promise.reject(new Error("no project")) };
  return listAiTools(withRender).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, mutating: !!t.mutating }));
}

export async function callTool(fs: NodeFs, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { callAiTool } = await import("../src/ai/tools");
  return callAiTool(toolContext(fs), name, input);
}

// render_preview → the preview (the sheet scaled to maxWidth, as JPEG), else
// the contact sheet (or the first frame) as base64 PNG. mimeType follows the file.
// Paths are relative to the result's `dir` (the project folder), else to `root`.
export function previewImages(name: string, result: unknown, root = "."): { data: string; mimeType: string }[] {
  if (name !== "render_preview" || !result || typeof result !== "object") return [];
  const r = result as { dir?: string; sheet?: string; preview?: string; frames?: { path: string }[] };
  const file = r.preview ?? r.sheet ?? r.frames?.[0]?.path;
  if (!file) return [];
  try {
    const mimeType = /\.jpe?g$/i.test(file) ? "image/jpeg" : /\.webp$/i.test(file) ? "image/webp" : "image/png";
    return [{ data: readFileSync(resolve(r.dir ?? root, file)).toString("base64"), mimeType }];
  } catch {
    return [];
  }
}
