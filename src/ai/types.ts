// Types shared by the AI tool catalog (src/ai/tools.ts) and its hosts
// (CLI `agent3d tools`, MCP server, Studio assistant).

import type { ProjectFs } from "../core/fs";
import type { LibraryProvider } from "../core/library";
import type { Issue } from "../core/types";
import type { ExportFormat } from "../ops/export";
import type { FetchLike } from "../ops/sources";
import type { TemplateIndex } from "../ops/templates";
import type { InflateRaw } from "../ops/zip";
import type { ImageCodec } from "../ops/optimize";
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
  // Also write a preview of the sheet at most this many pixels wide (MCP image block; 0 = none).
  previewWidth?: number;
  // Render only this object, auto-framed, neutral background.
  isolate?: string;
  // Background under the frames: "checker", a CSS colour or "none".
  bg?: string;
  // Games: simulated input applied while seeking (frames render in time order):
  // { t, key, down? | hold? } | { t, click: [x, y] } | { t, pointer: [x, y], down? } | { t, pointerDown: [x, y] }
  // | { t, pointerUp: [x, y] | true } | { t, drag: { from, to, duration? } } | { t, swipe: "left"|"right"|"up"|"down" } (coordinates -1..1).
  input?: Record<string, unknown>[];
}

export interface RenderResult {
  // Absolute project folder; frame / sheet paths are relative to it.
  dir?: string;
  frames: { t: number; path: string }[];
  sheet?: string;
  // Down-scaled sheet / first frame (previewWidth) — what MCP shows as the image.
  preview?: string;
  isolated?: { id: string; size: [number, number, number]; center: [number, number, number]; note: string };
  stats?: FrameStats;
  inspect?: InspectResult;
  // Script-visible game state (api.state) after the last frame.
  state?: Record<string, unknown> | null;
  issues: Issue[];
  consoleErrors: string[];
}

export interface MediaOptions {
  // poster: a still; video: MP4 / WebM; gif / webp: animated image; og: the
  // 1200×630 social preview (the poster frame fitted over a blurred copy).
  format: "poster" | "video" | "gif" | "webp" | "og";
  // poster: "webp" (default) or "png"; time in seconds (default target.posterTime).
  image?: "webp" | "png";
  time?: number;
  // video / gif / webp: seconds (default the timeline duration, else 5) and frames per second.
  duration?: number;
  fps?: number;
  size?: string;
  // video container / codec: "webm" (VP9, default) or "mp4" (H.264, needs Google Chrome).
  video?: "webm" | "mp4";
  // Supersampling: draft / standard (1×, default), high (2×), ultra (3×).
  quality?: "draft" | "standard" | "high" | "ultra";
  // poster / gif / webp: transparent background.
  transparent?: boolean;
}

export interface MediaResult {
  bytes: Uint8Array;
  codec?: string;
  t?: number;
  frames?: number;
  fps?: number;
  duration?: number;
  size: { width: number; height: number };
}

export interface ToolHost {
  // Headless render (CLI / MCP only — needs Chrome). Enables `render_preview`.
  render?(opts: RenderOptions): Promise<RenderResult>;
  // Poster still, MP4 / WebM video, animated GIF / WebP, og image (CLI / MCP / Studio API host — needs Chrome).
  // Enables `export` formats poster, video, gif and animated-webp, and `og`.
  media?(opts: MediaOptions): Promise<MediaResult>;
  // dist/runtime files for an export format (see RuntimeFiles in src/ops/export.ts).
  runtimeFiles?(format: ExportFormat): Promise<Record<string, Uint8Array>>;
  // The built-in asset library (library/index.json + bytes).
  library?: LibraryProvider;
  // Starter templates (templates/<id>/).
  templates?: { index: TemplateIndex; files(id: string): Promise<Record<string, Uint8Array | string>> };
  // Raw-deflate decompressor for zips (default: DecompressionStream when available).
  inflate?: InflateRaw;
  // Runs `fn` with an image decoder / resizer / encoder (CLI / MCP: headless
  // Chrome). Enables assets_optimize and assets_add { maxSize }.
  withImageCodec?<T>(fn: (codec: ImageCodec) => Promise<T>): Promise<T>;
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
