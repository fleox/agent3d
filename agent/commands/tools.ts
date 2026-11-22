import { callTool, listTools, previewImages } from "../aiHost";
import { printResult } from "../output";
import { readVersionInfo } from "../paths";
import type { Command } from "./types";
import { boolOpt, jsonObjectOpt, positional, PROJECT_OPTION, projectDir, table, usage } from "./util";
import { NodeFs } from "../nodeFs";
import { CATALOG } from "../../src/core/catalog";

export const toolsCommand: Command = {
  name: "tools",
  usage: "tools <list|call> [<name>] [--input <json|@file|->] [--project <dir>]",
  summary: "The AI tool catalog (src/ai/tools.ts + render_preview) — exactly what the MCP server and the Studio assistant expose: list the tools with their JSON schemas, or call one with a JSON input.",
  subcommands: [
    { name: "list", usage: "tools list", summary: "Tools with description, input schema and whether they write." },
    { name: "call", usage: "tools call <name> --input <json|@file|->", summary: "Run one tool against the project.", writes: true },
  ],
  options: [PROJECT_OPTION, { name: "input", type: "string", description: "call: the tool input as a JSON object, @file or - (stdin)." }],
  async run({ io, options, positionals }) {
    const [action = "list"] = positionals;
    if (action === "list") {
      const tools = await listTools();
      return printResult(io, { tools }, () => table(tools as unknown as Record<string, unknown>[], ["name", "mutating", "description"]));
    }
    if (action === "call") {
      const name = positional(positionals, 1, "tool name", "tools call <name> --input <json>");
      const tools = await listTools();
      if (!tools.some((t) => t.name === name)) usage(`Unknown tool "${name}".`, `\`agent3d tools list\` lists them (${tools.map((t) => t.name).join(", ")}).`);
      const input = jsonObjectOpt(options, "input") ?? {};
      const result = await callTool(new NodeFs(projectDir(options)), name, input);
      return printResult(io, { tool: name, result }, () => JSON.stringify(result ?? null, null, 2), { raw: true });
    }
    usage(`Unknown tools action "${action}".`, "Use list or call.");
  },
};

export const mcpCommand: Command = {
  name: "mcp",
  usage: "mcp [--project <dir>] [--read-only]",
  summary: "Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2025-03-26 / 2024-11-05): tools = the AI catalog + render_preview (returns the contact sheet as an image), resources = scene, summary, catalog. For Claude Desktop / Claude Code / Cursor.",
  options: [PROJECT_OPTION, { name: "read-only", type: "boolean", description: "Expose only the tools that don't write." }],
  async run({ options }) {
    const readOnly = boolOpt(options, "read-only");
    const dir = projectDir(options);
    const fs = new NodeFs(dir);
    const log = (msg: string) => void process.stderr.write(`${msg}\n`);
    const { createMcpServer, serveStdio } = await import("../mcp/server");
    const server = createMcpServer(mcpOptions(fs, readOnly, await listTools()));
    log(`[agent3d mcp] project ${dir}${readOnly ? " (read-only)" : ""} on stdio — ${server.toolNames().length} tools`);
    await serveStdio(server, process.stdin, (line) => process.stdout.write(line + "\n"), log);
    return 0;
  },
};

export function mcpOptions(fs: NodeFs, readOnly: boolean, tools: Awaited<ReturnType<typeof listTools>>) {
  return {
    readOnly,
    tools,
    serverName: "agent3d",
    version: readVersionInfo().version,
    instructions: `Agent3D — the 3D studio for web pages (project: ${fs.root}). A scene is JSON (scene.json): call scene_summary first, catalog_get to learn geometries / materials / behaviours / generators and their parameters, scene_patch for edits (validated; issues come back with JSON paths and hints), then render_preview to LOOK at the result (contact sheet image) and fix framing, colours and motion before export. Confirm destructive changes (scene_apply replacing objects, object_remove, export over a folder) with the user first.`,
    call: (name: string, input: Record<string, unknown>) => callTool(fs, name, input),
    images: async (name: string, result: unknown) => previewImages(name, result),
    resources: [
      { uri: "agent3d://scene", name: "scene", title: "Scene", description: "The project's scene.json (SceneDoc).", mimeType: "application/json", read: async () => JSON.parse(await fs.readText("scene.json")) },
      {
        uri: "agent3d://summary",
        name: "summary",
        title: "Scene summary",
        description: "Compact outline of the scene: objects, lights, camera, timeline, scripts.",
        mimeType: "application/json",
        read: async () => {
          const { getScene, summarizeScene } = await import("../../src/ops/scene");
          return summarizeScene(await getScene(fs));
        },
      },
      { uri: "agent3d://catalog", name: "catalog", title: "Catalog", description: "Geometries, material presets, shaders, behaviours, generators, particle presets, post effects, fonts, sounds — with parameters.", mimeType: "application/json", read: async () => CATALOG },
    ],
  };
}
