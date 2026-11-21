import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
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
              log: (m) => void process.stderr.write(`${m}\n`),
            });
            return { frames: r.frames, ...(r.sheet ? { sheet: r.sheet } : {}), ...(r.stats ? { stats: r.stats } : {}), ...(r.inspect ? { inspect: r.inspect } : {}), issues: r.issues.map(runtimeIssueToIssue), consoleErrors: r.consoleErrors };
          },
        }
      : {}),
    runtimeFiles: async (format) => readRuntimeFiles(format),
    library: libraryProvider(),
    templates: { index: readTemplatesIndex(), files: async (id) => readTemplateFiles(id) },
    inflate: (data) => new Uint8Array(inflateRawSync(data)),
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

// render_preview → the contact sheet (or the first frame) as base64 PNG.
export function previewImages(name: string, result: unknown): { data: string; mimeType: string }[] {
  if (name !== "render_preview" || !result || typeof result !== "object") return [];
  const r = result as { sheet?: string; frames?: { path: string }[] };
  const file = r.sheet ?? r.frames?.[0]?.path;
  if (!file) return [];
  try {
    return [{ data: readFileSync(file).toString("base64"), mimeType: "image/png" }];
  } catch {
    return [];
  }
}
