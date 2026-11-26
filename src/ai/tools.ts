// The AI tool catalog — declared ONCE here (CLAUDE.md rule 4). The MCP
// server (agent/mcp/), `agent3d tools list|call` and the Studio assistant
// expose exactly this list. Handlers call src/ops/ only.
//
// Results are JSON-able and compact (issues capped, summaries instead of
// whole documents where possible) so they fit a model's context.

import { OpsError } from "../ops/context";
import { closest } from "../core/suggest";
import { ASSET_TOOLS, RENDER_TOOL } from "./assetTools";
import { SCENE_TOOLS } from "./sceneTools";
import { checkInput } from "./shared";
import type { AiTool, ToolContext, ToolHost } from "./types";

export type { AiTool, JsonSchema, RenderOptions, RenderResult, ToolContext, ToolHost } from "./types";

const ORDER = [
  "project_info",
  "scene_get",
  "scene_summary",
  "scene_apply",
  "scene_patch",
  "scene_validate",
  "object_add",
  "object_update",
  "object_remove",
  "object_list",
  "timeline_set",
  "interactions_set",
  "catalog_get",
  "templates_list",
  "project_create",
  "check",
  "assets_list",
  "assets_search",
  "assets_add",
  "assets_optimize",
  "image_depth",
  "library_list",
  "export",
];

const BY_NAME = new Map([...SCENE_TOOLS, ...ASSET_TOOLS].map((t) => [t.name, t]));

// Every tool except render_preview (host-dependent).
export const AI_TOOLS: AiTool[] = ORDER.map((n) => {
  const t = BY_NAME.get(n);
  if (!t) throw new Error(`AI tool ${n} is not implemented`);
  return t;
});

export { RENDER_TOOL };

// The tools a host exposes: render_preview only when it can render.
export function listAiTools(host?: ToolHost, opts: { readOnly?: boolean } = {}): AiTool[] {
  const list = host?.render ? [...AI_TOOLS, RENDER_TOOL] : [...AI_TOOLS];
  return opts.readOnly ? list.filter((t) => !t.mutating) : list;
}

export function findAiTool(name: string, host?: ToolHost): AiTool {
  const tools = listAiTools(host);
  const t = tools.find((x) => x.name === name);
  if (!t) {
    const s = closest(name, tools.map((x) => x.name));
    throw new OpsError("notFound", `Unknown tool "${name}".`, `${s ? `Did you mean "${s}"? ` : ""}Tools: ${tools.map((x) => x.name).join(", ")}.`);
  }
  return t;
}

// Validates the input against the tool schema (required + top-level types), then runs it.
export async function callAiTool(ctx: ToolContext, name: string, input: unknown): Promise<unknown> {
  const tool = findAiTool(name, ctx.host);
  return tool.handler(ctx, checkInput(tool.inputSchema, input, name));
}
