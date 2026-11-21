import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { CATALOG } from "../../src/core/catalog";
import { callTool, listTools } from "../aiHost";
import { readLibraryIndex, readTemplatesIndex } from "../host";
import { NodeFs } from "../nodeFs";
import { CliError, printResult, toCliError } from "../output";
import { libraryDir, readVersionInfo, runtimeBuilt, runtimeDir, studioDir } from "../paths";
import { livePageHtml } from "../render/livePage";
import { mimeOf, readBody, sendJson, sendText, startLocalServer, type LocalServer, type Route } from "../render/server";
import { watchProject } from "../watch";
import type { Command } from "./types";
import { boolOpt, PROJECT_OPTION, projectDir, projectFs, strOpt, usage } from "./util";

// `serve`: live preview of a project. `studio`: the Studio SPA + the small
// REST API it uses (docs/studio-api.md). Both bind 127.0.0.1 only and
// refuse requests whose Host / Origin is not this local server (DNS
// rebinding, cross-site writes from other pages).

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    /* no browser: the URL is printed */
  }
}

// Only same-machine pages may talk to the server.
export function localGuard(getPort: () => number): Route {
  return (req, res) => {
    const port = getPort();
    const host = (req.headers.host ?? "").toLowerCase();
    const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (!okHosts.has(host)) {
      sendText(res, 403, "Forbidden host");
      return true;
    }
    const origin = req.headers.origin;
    if (origin && origin !== "null") {
      let o: URL | null = null;
      try {
        o = new URL(origin);
      } catch {
        o = null;
      }
      if (!o || !okHosts.has(o.host.toLowerCase())) {
        sendText(res, 403, "Forbidden origin");
        return true;
      }
    }
    return false;
  };
}

// Server-Sent Events hub.
export function sseHub() {
  const clients = new Set<ServerResponse>();
  const ping = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 20_000);
  ping.unref();
  return {
    attach(req: IncomingMessage, res: ServerResponse) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write("retry: 1000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    },
    send(event: string, data: unknown) {
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const c of clients) c.write(frame);
    },
    close() {
      clearInterval(ping);
      for (const c of clients) c.end();
      clients.clear();
    },
    get size() {
      return clients.size;
    },
  };
}

async function listen(start: (port: number) => Promise<LocalServer>, first: number): Promise<LocalServer> {
  if (first === 0) return start(0);
  for (let port = first; port < first + 20 && port <= 65535; port++) {
    try {
      return await start(port);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    }
  }
  throw new CliError("port-busy", `Ports ${first}-${first + 19} are all in use.`, "Pass --port <n> (0 = any free port).");
}

function portOpt(options: Record<string, unknown>, def: number): number {
  const raw = strOpt(options as never, "port");
  const port = raw === undefined ? def : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) usage(`Invalid --port: ${raw}`);
  return port;
}

function waitForSignal(): Promise<void> {
  return new Promise((r) => {
    process.once("SIGINT", () => r());
    process.once("SIGTERM", () => r());
  });
}

function requireRuntime(): void {
  if (!runtimeBuilt()) throw new CliError("runtime-missing", `The runtime build is missing (${runtimeDir()}).`, "Use the npm package, or run `npm run build:runtime` in a clone.");
}

// ─── serve ──────────────────────────────────────────────────────────────

export interface PreviewServer extends LocalServer {
  stop(): Promise<void>;
}

export async function startPreviewServer(dir: string, port = 0): Promise<PreviewServer> {
  const hub = sseHub();
  let actualPort = 0;
  const html = () => {
    let title = "Agent3D";
    try {
      title = (JSON.parse(readFileSync(join(dir, "scene.json"), "utf8")) as { title?: string }).title ?? title;
    } catch {
      /* default title */
    }
    return livePageHtml({ title, runtimeUrl: "/__runtime/agent3d-runtime.js" });
  };
  const fs = new NodeFs(dir);
  const server = await listen(
    (p) =>
      startLocalServer({
        port: p,
        mounts: { "/__runtime/": runtimeDir(), "/__library/": libraryDir(), "/project/": dir },
        routes: [
          localGuard(() => actualPort),
          async (req, res, url) => {
            if (url.pathname === "/" || url.pathname === "/index.html") return sendText(res, 200, html(), "text/html; charset=utf-8"), true;
            if (url.pathname === "/__scene.json") {
              try {
                sendText(res, 200, await fs.readText("scene.json"), "application/json; charset=utf-8");
              } catch {
                sendJson(res, 404, { error: "scene.json not found" });
              }
              return true;
            }
            if (url.pathname === "/__events") return hub.attach(req, res), true;
            return false;
          },
        ],
      }),
    port,
  );
  actualPort = server.port;
  const watcher = watchProject(dir, (paths) => {
    if (paths.includes("scene.json")) hub.send("scene", { paths });
    if (paths.some((p) => p.startsWith("assets/") || p.startsWith("scripts/"))) hub.send("reload", { paths });
  });
  return {
    ...server,
    url: `http://127.0.0.1:${server.port}`,
    async stop() {
      watcher.close();
      hub.close();
      await server.close();
    },
  };
}

export const serveCommand: Command = {
  name: "serve",
  usage: "serve [--port <n>] [--open] [--project <dir>]",
  summary: "Live preview of the project on 127.0.0.1 (scene at its aspect ratio, play / pause, time scrubber): scene.json edits update the open page instantly, asset / script edits reload it. Runs until stopped (Ctrl+C).",
  options: [PROJECT_OPTION, { name: "port", type: "string", description: "First port to try (default 4321; 0 = any free port)." }, { name: "open", type: "boolean", description: "Open the preview in the default browser." }],
  async run({ io, options }) {
    const fs = projectFs(options);
    requireRuntime();
    const server = await startPreviewServer(fs.root, portOpt(options, 4321));
    const url = `http://localhost:${server.port}/`;
    printResult(io, { url, project: fs.root }, () => `Agent3D preview of ${fs.root}\n${url}\nEdits to scene.json show up live. Press Ctrl+C to stop.`);
    if (boolOpt(options, "open")) openBrowser(url);
    await waitForSignal();
    await server.stop();
  },
};

// ─── studio ─────────────────────────────────────────────────────────────

export interface StudioServer extends LocalServer {
  stop(): Promise<void>;
}

// The REST API of docs/studio-api.md.
export async function startStudioServer(opts: { project: string | null; port?: number; studioRoot?: string }): Promise<StudioServer> {
  const hub = sseHub();
  let actualPort = 0;
  const fs = opts.project ? new NodeFs(opts.project) : null;
  const watcher = opts.project ? watchProject(opts.project, (paths) => hub.send("change", { paths })) : null;
  const noProject = (res: ServerResponse) => sendJson(res, 404, { ok: false, error: { code: "no-project", message: "The Studio was started without a project.", hint: "Restart with `agent3d studio --project <dir>`." } });
  const fail = (res: ServerResponse, err: unknown, status?: number) => {
    const e = toCliError(err);
    const code = status ?? (e.code === "notFound" ? 404 : e.code === "invalid-path" ? 400 : e.exitCode === 2 ? 400 : 500);
    sendJson(res, code, { ok: false, error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}), ...(e.details !== undefined ? { details: e.details } : {}) } });
  };
  const api: Route = async (req, res, url) => {
    if (!url.pathname.startsWith("/api/")) return false;
    const method = req.method ?? "GET";
    try {
      if (url.pathname === "/api/info" && method === "GET") {
        let manifest: unknown = null;
        if (fs && (await fs.exists("agent3d.json"))) manifest = JSON.parse(await fs.readText("agent3d.json"));
        sendJson(res, 200, {
          ok: true,
          data: { version: readVersionInfo().version, project: fs ? { dir: fs.root, manifest, exists: await fs.exists("scene.json") } : null, runtimeUrl: "/__runtime/agent3d-runtime.js", assetBase: "/project/", libraryBase: "/__library/" },
        });
        return true;
      }
      if (url.pathname === "/api/catalog" && method === "GET") return sendJson(res, 200, { ok: true, data: CATALOG }), true;
      if (url.pathname === "/api/library" && method === "GET") return sendJson(res, 200, { ok: true, data: readLibraryIndex() }), true;
      if (url.pathname === "/api/templates" && method === "GET") return sendJson(res, 200, { ok: true, data: { templates: readTemplatesIndex() } }), true;
      if (url.pathname === "/api/tools" && method === "GET") return sendJson(res, 200, { ok: true, data: { tools: await listTools() } }), true;
      if (url.pathname === "/api/events" && method === "GET") return hub.attach(req, res), true;
      if (url.pathname === "/api/tools/call" && method === "POST") {
        if (!fs) return noProject(res), true;
        let body: { name?: unknown; input?: unknown };
        try {
          body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
        } catch {
          return fail(res, new CliError("usage", "The body must be JSON: { name, input }.", undefined, 2), 400), true;
        }
        if (typeof body.name !== "string") return fail(res, new CliError("usage", '"name" (a tool name) is required.', "GET /api/tools lists them.", 2), 400), true;
        const input = body.input && typeof body.input === "object" ? (body.input as Record<string, unknown>) : {};
        // The tool may write scene.json etc.: don't echo those as external changes.
        for (const p of ["scene.json", "agent3d.json", "assets/manifest.json"]) watcher?.ignoreNext(p);
        const result = await callTool(fs, body.name, input);
        sendJson(res, 200, { ok: true, data: result });
        return true;
      }
      if (url.pathname === "/api/project" || url.pathname === "/api/project/") {
        if (!fs) return noProject(res), true;
        if (method !== "GET") return sendText(res, 405, "Method not allowed"), true;
        const files = await fs.list(url.searchParams.get("prefix") ?? "");
        const withSize = await Promise.all(files.map(async (path) => ({ path, size: await fs.size(path) })));
        sendJson(res, 200, { ok: true, data: { files: withSize } });
        return true;
      }
      if (url.pathname.startsWith("/api/project/")) {
        if (!fs) return noProject(res), true;
        const raw = (req.url ?? "").split("?")[0].slice("/api/project/".length);
        let path: string;
        try {
          path = decodeURIComponent(raw);
        } catch {
          return fail(res, new CliError("invalid-path", "Bad path encoding.", undefined, 2), 400), true;
        }
        if (method === "GET" || method === "HEAD") {
          const bytes = await fs.readBytes(path);
          res.writeHead(200, { "content-type": mimeOf(path), "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": String(bytes.byteLength) });
          res.end(method === "HEAD" ? undefined : Buffer.from(bytes));
          return true;
        }
        if (method === "PUT") {
          const body = await readBody(req);
          watcher?.ignoreNext(path);
          await fs.writeBytes(path, new Uint8Array(body));
          sendJson(res, 200, { ok: true, data: { path, bytes: body.byteLength } });
          return true;
        }
        if (method === "DELETE") {
          if (!(await fs.exists(path))) return fail(res, new CliError("notFound", `No file ${path}.`), 404), true;
          watcher?.ignoreNext(path);
          await fs.remove(path);
          sendJson(res, 200, { ok: true, data: { removed: path } });
          return true;
        }
        sendText(res, 405, "Method not allowed");
        return true;
      }
      sendJson(res, 404, { ok: false, error: { code: "notFound", message: `No API route ${method} ${url.pathname}.`, hint: "See docs/studio-api.md." } });
      return true;
    } catch (err) {
      fail(res, err);
      return true;
    }
  };
  const studioRoot = opts.studioRoot ?? studioDir();
  const server = await listen(
    (p) =>
      startLocalServer({
        port: p,
        mounts: { "/__runtime/": runtimeDir(), "/__library/": libraryDir(), ...(opts.project ? { "/project/": opts.project } : {}) },
        routes: [localGuard(() => actualPort), api],
        fallbackRoot: studioRoot,
      }),
    opts.port ?? 0,
  );
  actualPort = server.port;
  return {
    ...server,
    async stop() {
      watcher?.close();
      hub.close();
      await server.close();
    },
  };
}

export const studioCommand: Command = {
  name: "studio",
  usage: "studio [--port <n>] [--no-open] [--project <dir>]",
  summary: "Open the Studio (visual editor: viewport, outliner, inspector, timeline, catalog, templates, assistant) on this computer, editing the project folder through a local API. Runs until stopped (Ctrl+C).",
  options: [PROJECT_OPTION, { name: "port", type: "string", description: "First port to try (default 4320; 0 = any free port)." }, { name: "no-open", type: "boolean", description: "Don't open a browser." }],
  async run({ io, options }) {
    const studio = studioDir();
    if (!existsSync(join(studio, "index.html"))) throw new CliError("studio-missing", `The Studio build is missing (${studio}).`, "Use the npm package, or run `npm run build:studio` in a clone.");
    const dir = projectDir(options);
    const project = existsSync(join(dir, "scene.json")) ? dir : null;
    if (strOpt(options, "project") && !project) projectFs(options);
    const server = await startStudioServer({ project, port: portOpt(options, 4320) });
    const url = `http://localhost:${server.port}/`;
    printResult(io, { url, project }, () => `Agent3D Studio${project ? ` — ${project}` : ""}\n${url}\nPress Ctrl+C to stop.`);
    if (!boolOpt(options, "no-open")) openBrowser(url);
    await waitForSignal();
    await server.stop();
  },
};
