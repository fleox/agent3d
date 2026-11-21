import { readFileSync } from "node:fs";
import { libraryProvider, readRuntimeFiles, readTemplateFiles, readTemplatesIndex } from "./host";
import type { NodeFs } from "./nodeFs";

// Glue between the AI tool catalog (src/ai/tools.ts) and the Node front
// doors (`tools`, `mcp`, the Studio API): the ToolContext host with the
// headless render, the runtime files, the library and the templates.

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  mutating: boolean;
}

export interface RenderPreviewInput {
  frames?: number[] | string;
  count?: number;
  size?: string;
  sheet?: boolean;
  scale?: number;
}

export function nodeHost() {
  return {
    async render(fs: NodeFs, input: RenderPreviewInput = {}) {
      const { renderProject } = await import("./render/render");
      return renderProject({
        projectDir: fs.root,
        frames: Array.isArray(input.frames) ? input.frames.join(",") : input.frames,
        count: input.count,
        size: input.size,
        scale: input.scale,
        sheet: input.sheet ?? true,
        log: (m) => void process.stderr.write(`${m}\n`),
      });
    },
    runtimeFiles: () => readRuntimeFiles(),
    library: () => libraryProvider(),
    templates: { list: () => readTemplatesIndex(), files: (id: string) => readTemplateFiles(id) },
  };
}

export async function listTools(): Promise<ToolInfo[]> {
  const { listAiTools } = await import("../src/ai/tools");
  return listAiTools(nodeHost() as never).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, mutating: !!t.mutating }));
}

export async function callTool(fs: NodeFs, name: string, input: Record<string, unknown>): Promise<unknown> {
  const { callTool: call } = await import("../src/ai/tools");
  return call({ fs, fetch, host: nodeHost() } as never, name, input);
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
