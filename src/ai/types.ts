// Types shared by the AI tool catalog (src/ai/tools.ts) and its hosts
// (CLI `agent3d tools`, MCP server, Studio assistant).

import type { ProjectFs } from "../core/fs";
import type { LibraryProvider } from "../core/library";
import type { Issue } from "../core/types";
import type { ExportFormat } from "../ops/export";
import type { FetchLike } from "../ops/sources";
import type { TemplateIndex } from "../ops/templates";
import type { InflateRaw } from "../ops/zip";
import type { FrameStats, InspectResult } from "../runtime/api";

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly unknown[];
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
};

export interface RenderOptions {
  // Times (s) to capture; default: a spread over the timeline / 0, 1.5, 3.
  frames?: number[];
  // Or a number of evenly spaced frames.
  count?: number;
  // Pixel size, e.g. "1200x300" (default: 1200 wide at the target aspect).
  size?: string;
  // Compose a contact sheet of all frames (default true).
  sheet?: boolean;
  // Output folder inside the project (default "renders/").
  out?: string;
  // Games: simulated input applied while seeking (frames render in time order):
  // { t, key, down? | hold? } | { t, click: [x, y] } | { t, pointer: [x, y] } (coordinates -1..1).
  input?: Record<string, unknown>[];
}

export interface RenderResult {
  // Absolute project folder; frame / sheet paths are relative to it.
  dir?: string;
  frames: { t: number; path: string }[];
  sheet?: string;
  stats?: FrameStats;
  inspect?: InspectResult;
  // Script-visible game state (api.state) after the last frame.
  state?: Record<string, unknown> | null;
  issues: Issue[];
  consoleErrors: string[];
}

export interface ToolHost {
  // Headless render (CLI / MCP only — needs Chrome). Enables `render_preview`.
  render?(opts: RenderOptions): Promise<RenderResult>;
  // dist/runtime files for an export format (see RuntimeFiles in src/ops/export.ts).
  runtimeFiles?(format: ExportFormat): Promise<Record<string, Uint8Array>>;
  // The built-in asset library (library/index.json + bytes).
  library?: LibraryProvider;
  // Starter templates (templates/<id>/).
  templates?: { index: TemplateIndex; files(id: string): Promise<Record<string, Uint8Array | string>> };
  // Raw-deflate decompressor for zips (default: DecompressionStream when available).
  inflate?: InflateRaw;
  // Reads a file from the user's disk (CLI / MCP) — used by assets_add { file }.
  readLocalFile?(path: string): Promise<Uint8Array>;
}

export interface ToolContext {
  fs: ProjectFs; // the project root
  fetch?: FetchLike; // network for assets_search / assets_add (omit = offline)
  host?: ToolHost;
}

export interface AiTool<I = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  // Writes project files (MCP annotates it; read-only mode hides it).
  mutating: boolean;
  handler(ctx: ToolContext, input: I): Promise<unknown> | unknown;
}
