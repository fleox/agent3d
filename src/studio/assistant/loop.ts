// Assistant tool-use loop over the Claude Messages API, called from the
// browser with the user's own key (header
// anthropic-dangerous-direct-browser-access). The tools are the Agent3D AI
// tool catalog (GET /api/tools); calls run through the Studio backend so
// validation applies exactly as for the CLI / MCP. Pure apart from the
// injected fetch / callTool, so it is unit-tested.

import type { ToolInfo } from "../backend/types";

export const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;
export type ModelId = (typeof MODELS)[number];
export const DEFAULT_MODEL: ModelId = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: ({ type: "text"; text: string } | ImageBlock)[]; is_error?: boolean }
  | ImageBlock
  | { type: string; [k: string]: unknown };
export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/webp"; data: string } };
export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type LoopEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; result?: unknown; error?: string; image?: string }
  | { type: "refusal"; explanation?: string };

export interface LoopOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: Message[];
  tools: ToolInfo[];
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
  // Returns the PNG of a project file as base64 (render_preview images).
  readImage?(path: string): Promise<string | null>;
  onEvent(ev: LoopEvent): void;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxIterations?: number;
  maxTokens?: number;
  // Server-side refusal fallback ("default" routing); retried without it if the API rejects it.
  fallbacks?: boolean;
}

export interface LoopResult {
  messages: Message[];
  status: "done" | "aborted" | "error" | "max_iterations" | "refusal";
  error?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Image path a tool result points at (render_preview: sheet or first frame).
export function resultImagePath(name: string, result: unknown): string | null {
  if (name !== "render_preview" || !result || typeof result !== "object") return null;
  const r = result as { sheet?: string; frames?: { path: string }[] };
  return r.sheet ?? r.frames?.[0]?.path ?? null;
}

function truncate(text: string, max = 24000): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated, ${text.length - max} more characters)` : text;
}

async function post(opts: LoopOptions, body: Record<string, unknown>, useFallbacks: boolean): Promise<Record<string, unknown>> {
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": opts.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (useFallbacks) headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
  const res = await f(API_URL, { method: "POST", headers, body: JSON.stringify(useFallbacks ? { ...body, fallbacks: "default" } : body), signal: opts.signal });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, err);
  }
  return json;
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const messages = [...opts.messages];
  const tools = opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  let fallbacks = opts.fallbacks ?? opts.model !== "claude-haiku-5-5";
  const max = opts.maxIterations ?? 25;
  for (let i = 0; i < max; i++) {
    if (opts.signal?.aborted) return { messages, status: "aborted" };
    const body = { model: opts.model, max_tokens: opts.maxTokens ?? 16000, system: opts.system, tools, messages };
    let res: Record<string, unknown>;
    try {
      try {
        res = await post(opts, body, fallbacks);
      } catch (e) {
        // Older API / account without the fallback beta: retry plainly once.
        if (fallbacks && e instanceof ApiError && e.status === 400 && /fallback|beta/i.test(e.message)) {
          fallbacks = false;
          res = await post(opts, body, false);
        } else throw e;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return { messages, status: "aborted" };
      return { messages, status: "error", error: (e as Error).message };
    }
    const content = (res.content as ContentBlock[]) ?? [];
    // Append the full content (thinking blocks included) unchanged.
    messages.push({ role: "assistant", content });
    for (const b of content) if (b.type === "text" && typeof (b as { text?: string }).text === "string" && (b as { text: string }).text.trim()) opts.onEvent({ type: "text", text: (b as { text: string }).text });
    if (res.stop_reason === "refusal") {
      opts.onEvent({ type: "refusal", explanation: (res.stop_details as { explanation?: string } | null)?.explanation });
      return { messages, status: "refusal" };
    }
    const uses = content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) return { messages, status: "done" };

    const results: ContentBlock[] = [];
    for (const u of uses) {
      if (opts.signal?.aborted) return { messages, status: "aborted" };
      opts.onEvent({ type: "tool_start", id: u.id, name: u.name, input: u.input ?? {} });
      try {
        const result = await opts.callTool(u.name, u.input ?? {});
        const blocks: ({ type: "text"; text: string } | ImageBlock)[] = [{ type: "text", text: truncate(JSON.stringify(result)) }];
        const imgPath = resultImagePath(u.name, result);
        let image: string | undefined;
        if (imgPath && opts.readImage) {
          const data = await opts.readImage(imgPath).catch(() => null);
          if (data) {
            blocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data } });
            image = imgPath;
          }
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content: blocks });
        opts.onEvent({ type: "tool_end", id: u.id, name: u.name, result, image });
      } catch (e) {
        const err = e as Error & { hint?: string; details?: unknown };
        const text = JSON.stringify({ error: err.message, ...(err.hint ? { hint: err.hint } : {}), ...(err.details ? { details: err.details } : {}) });
        results.push({ type: "tool_result", tool_use_id: u.id, content: [{ type: "text", text: truncate(text) }], is_error: true });
        opts.onEvent({ type: "tool_end", id: u.id, name: u.name, error: err.message });
      }
    }
    // Every tool_result of the turn in one user message.
    messages.push({ role: "user", content: results });
  }
  return { messages, status: "max_iterations" };
}

export const SYSTEM_PROMPT = `You are the assistant inside Agent3D Studio, a visual editor for 3D web elements (banners, heroes, product cards, landscapes, mini games). The user sees the scene live in the Studio viewport while you work; every change you make through the tools is saved to the project's scene.json and shown immediately.

The scene format (SceneDoc, scene.json): { version: 1, id, title, target: { kind: banner|hero|card|square|fullscreen|inline|game, aspect: "W:H" }, camera: { type, fov, position, target, controls }, environment: { background (CSS colour | {gradient:[…], angle} | {radial:[…]} | {sky:{…}} | {hdri}), lighting preset, fog, ground }, lights: [{ id, type, color, intensity, position }], objects: [{ id, kind: mesh|text|model|group|generator|particles|instances|svg, position, rotation (degrees), scale, material: { preset, color, … }, behaviours: [{ type, …params }], children }], timeline?: { duration, loop, tracks: [{ target: "<id>.<property>", keys: [[t, value], …], ease }] }, postfx?, physics?, ui?, audio? }. Units ≈ metres, Y up, angles in degrees, colours are CSS strings. Geometry types, material presets, behaviours, generators, particle presets, post effects and fonts come from the catalog.

Rules:
- Start with scene_summary to see what exists. Call catalog_get before using any catalog id or parameter you are not sure about.
- Prefer small scene_patch edits (object ids are stable) over replacing the whole scene.
- Mutating tools are applied directly; the user can undo each one from the Studio.
- After visual changes, call render_preview (when available) and look at the image you get back: check framing (nothing cut at the edges of wide banners), legibility of text, colours and lighting, then fix and render again.
- Run check before suggesting an export.
- Be concise: say what you changed in one or two sentences.`;
