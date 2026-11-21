import { toCliError } from "../output";

// MCP server over stdio, implemented by hand (no SDK): JSON-RPC 2.0, one
// message per line (mirror of agentcrm agent/mcp/server.ts). Tools = the
// shared AI catalog (src/ai/tools.ts — what `agent3d tools` and the Studio
// assistant expose) + render_preview registered by the host; resources =
// the scene, its summary and the catalog. render_preview results carry the
// contact sheet as an `image` content block so multimodal clients see it.

export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0];

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

// The tool shape the server needs (a subset of src/ai/tools AiTool).
export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
  mutating: boolean;
}

// Tools that destroy or overwrite data (MCP destructiveHint).
const DESTRUCTIVE = new Set(["scene_apply", "object_remove", "timeline_set", "export", "assets_remove"]);
// Calling twice with the same input leaves the same state.
const IDEMPOTENT = new Set(["scene_apply", "object_update", "timeline_set", "render_preview", "export"]);
// Tools that reach the network (free CC0 sources).
const OPEN_WORLD = new Set(["assets_search", "assets_add"]);

export interface McpResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  read(): Promise<unknown>;
}

export interface McpServerOptions {
  readOnly?: boolean;
  tools: McpTool[] | (() => McpTool[]);
  // Runs a tool; the result is JSON-able. Images (data from render_preview)
  // are returned by `images` as base64 PNGs.
  call(name: string, input: Record<string, unknown>): Promise<unknown>;
  images?(name: string, result: unknown): Promise<{ data: string; mimeType: string }[]>;
  resources?: McpResource[];
  serverName: string;
  version: string;
  instructions: string;
}

function toolAnnotations(tool: McpTool) {
  return {
    title: tool.name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    readOnlyHint: !tool.mutating,
    destructiveHint: tool.mutating && DESTRUCTIVE.has(tool.name),
    idempotentHint: !tool.mutating || IDEMPOTENT.has(tool.name),
    openWorldHint: OPEN_WORLD.has(tool.name),
  };
}

export function createMcpServer(opts: McpServerOptions) {
  const all = (): McpTool[] => (typeof opts.tools === "function" ? opts.tools() : opts.tools);
  const visible = (): McpTool[] => all().filter((t) => !(opts.readOnly && t.mutating));
  const resources = opts.resources ?? [];
  let initialized = false;
  let protocol: string = LATEST_PROTOCOL;

  const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

  async function callTool(id: JsonRpcId, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const name = typeof params.name === "string" ? params.name : "";
    const tool = all().find((t) => t.name === name);
    if (!tool) return fail(id, RPC.invalidParams, `Unknown tool: ${name}`);
    if (opts.readOnly && tool.mutating) return fail(id, RPC.invalidParams, `Tool ${name} changes the project and this server is read-only.`);
    const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
    try {
      const result = await opts.call(name, args);
      const structured = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : { result: result ?? null };
      const images = opts.images ? await opts.images(name, result).catch(() => []) : [];
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }, ...images.map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType }))],
        structuredContent: structured,
        isError: false,
      });
    } catch (err) {
      // Tool failures are results (the model reads them), not protocol errors.
      const e = toCliError(err);
      const error = { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}), ...(e.details !== undefined ? { details: e.details } : {}) };
      return ok(id, { content: [{ type: "text", text: JSON.stringify({ error }) }], structuredContent: { error }, isError: true });
    }
  }

  async function readResource(id: JsonRpcId, uri: string): Promise<JsonRpcResponse> {
    const r = resources.find((x) => x.uri === uri);
    if (!r) return fail(id, -32002, `Resource not found: ${uri}`, { uri });
    const value = await r.read();
    return ok(id, { contents: [{ uri, mimeType: r.mimeType, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
  }

  async function handle(msg: unknown): Promise<JsonRpcResponse | null> {
    if (!msg || typeof msg !== "object" || (msg as JsonRpcRequest).jsonrpc !== "2.0" || typeof (msg as JsonRpcRequest).method !== "string") {
      const id = msg && typeof msg === "object" && "id" in msg ? ((msg as { id: JsonRpcId }).id ?? null) : null;
      return fail(id, RPC.invalidRequest, "Invalid JSON-RPC 2.0 request.");
    }
    const req = msg as JsonRpcRequest;
    const isNotification = !("id" in req) || req.id === undefined;
    const id = req.id ?? null;
    const params = req.params ?? {};
    if (isNotification) {
      if (req.method === "notifications/initialized") initialized = true;
      return null;
    }
    try {
      switch (req.method) {
        case "initialize": {
          const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : LATEST_PROTOCOL;
          protocol = (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL;
          return ok(id, {
            protocolVersion: protocol,
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false }, logging: {} },
            serverInfo: { name: opts.serverName, title: "Agent3D", version: opts.version },
            instructions: `${opts.instructions}${opts.readOnly ? " READ-ONLY: tools that change the project are hidden." : ""}`,
          });
        }
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, { tools: visible().map((t) => ({ name: t.name, title: toolAnnotations(t).title, description: t.description, inputSchema: t.inputSchema, annotations: toolAnnotations(t) })) });
        case "tools/call":
          return callTool(id, params);
        case "resources/list":
          return ok(id, { resources: resources.map(({ read: _read, ...r }) => r) });
        case "resources/templates/list":
          return ok(id, { resourceTemplates: [] });
        case "resources/read":
          return readResource(id, typeof params.uri === "string" ? params.uri : "");
        case "prompts/list":
          return ok(id, { prompts: [] });
        case "logging/setLevel":
          return ok(id, {});
        default:
          return fail(id, RPC.methodNotFound, `Method not found: ${req.method}`);
      }
    } catch (err) {
      return fail(id, RPC.internal, (err as Error).message);
    }
  }

  return {
    handle,
    get initialized() {
      return initialized;
    },
    get protocol() {
      return protocol;
    },
    toolNames: () => visible().map((t) => t.name),
  };
}

export type McpServer = ReturnType<typeof createMcpServer>;

// Line-delimited JSON-RPC over a pair of streams (stdin / stdout). Batches
// (arrays) are answered with an array. Resolves when the input ends.
export function serveStdio(server: McpServer, input: NodeJS.ReadableStream, write: (line: string) => void, log: (msg: string) => void = () => undefined): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    let chain = Promise.resolve();
    const processLine = async (line: string) => {
      if (!line.trim()) return;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "Parse error" } }));
        return;
      }
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map((m) => server.handle(m)))).filter((r): r is JsonRpcResponse => r !== null);
        if (out.length) write(JSON.stringify(out));
        return;
      }
      const res = await server.handle(msg);
      if (res) write(JSON.stringify(res));
    };
    input.setEncoding?.("utf8");
    input.on("data", (chunk: string | Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        // Requests are handled in order (writes never interleave).
        chain = chain.then(() => processLine(line)).catch((err) => log(`[mcp] ${(err as Error).message}`));
      }
    });
    input.on("end", () => {
      const rest = buffer;
      buffer = "";
      chain = chain.then(() => processLine(rest)).finally(() => resolve());
    });
  });
}
