import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPreviewServer, startStudioServer, type PreviewServer, type StudioServer } from "./serve";

function http(port: number, method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: String(res.headers["content-type"] ?? "") }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

// Collects SSE frames until `until` matches (or times out).
function sse(port: number, path: string, until: (text: string) => boolean, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const req = request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      res.on("data", (c) => {
        text += c;
        if (until(text)) {
          req.destroy();
          resolve(text);
        }
      });
    });
    req.on("error", (e) => (until(text) ? resolve(text) : reject(e)));
    setTimeout(() => {
      req.destroy();
      resolve(text);
    }, timeoutMs);
    req.end();
  });
}

let root = "";
let project = "";
let studio: StudioServer;
let preview: PreviewServer;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "agent3d-studio-"));
  project = join(root, "project");
  mkdirSync(join(root, "studio"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(root, "studio", "index.html"), "<!doctype html><title>Studio</title>");
  writeFileSync(join(root, "secret.txt"), "secret");
  writeFileSync(join(project, "scene.json"), JSON.stringify({ version: 1, title: "Hello" }));
  writeFileSync(join(project, "agent3d.json"), JSON.stringify({ name: "p", title: "Hello" }));
  studio = await startStudioServer({ project, studioRoot: join(root, "studio") });
  preview = await startPreviewServer(project);
});
afterAll(async () => {
  await studio.stop();
  await preview.stop();
});

describe("studio API", () => {
  it("serves the SPA and the project info", async () => {
    expect((await http(studio.port, "GET", "/")).body).toContain("<title>Studio</title>");
    expect((await http(studio.port, "GET", "/some/route")).body).toContain("<title>Studio</title>");
    const info = JSON.parse((await http(studio.port, "GET", "/api/info")).body);
    expect(info).toMatchObject({ ok: true, data: { project: { dir: project, exists: true, manifest: { name: "p" } }, runtimeUrl: "/__runtime/agent3d-runtime.js" } });
    const cat = JSON.parse((await http(studio.port, "GET", "/api/catalog")).body);
    expect(cat.data.geometries.length).toBeGreaterThan(5);
  });

  it("reads, writes, lists and deletes project files", async () => {
    expect((await http(studio.port, "PUT", "/api/project/scripts/game.js", { body: "export default () => ({})" })).status).toBe(200);
    const got = await http(studio.port, "GET", "/api/project/scripts/game.js");
    expect([got.status, got.body, got.type]).toEqual([200, "export default () => ({})", "text/javascript; charset=utf-8"]);
    const list = JSON.parse((await http(studio.port, "GET", "/api/project")).body);
    expect(list.data.files.map((f: { path: string }) => f.path)).toEqual(["agent3d.json", "scene.json", "scripts/game.js"]);
    expect(JSON.parse((await http(studio.port, "DELETE", "/api/project/scripts/game.js")).body)).toMatchObject({ ok: true });
    expect((await http(studio.port, "GET", "/api/project/scripts/game.js")).status).toBe(404);
    expect((await http(studio.port, "DELETE", "/api/project/nope.txt")).status).toBe(404);
  });

  it("refuses paths outside the project and foreign hosts / origins", async () => {
    for (const p of ["/api/project/..%2fsecret.txt", "/api/project/%2e%2e/secret.txt", "/api/project/../secret.txt"]) {
      const r = await http(studio.port, "GET", p);
      expect(r.body).not.toContain("secret\"");
      expect(r.body).not.toBe("secret");
      expect([400, 404]).toContain(r.status);
    }
    expect((await http(studio.port, "PUT", "/api/project/..%2fevil.txt", { body: "x" })).status).toBe(400);
    expect((await http(studio.port, "GET", "/api/info", { headers: { host: "evil.example:80" } })).status).toBe(403);
    expect((await http(studio.port, "PUT", "/api/project/x.txt", { headers: { origin: "https://evil.example" }, body: "x" })).status).toBe(403);
    expect((await http(studio.port, "GET", "/api/info", { headers: { origin: `http://localhost:${studio.port}` } })).status).toBe(200);
  });

  it("runs AI tools through POST /api/tools/call", async () => {
    const tools = JSON.parse((await http(studio.port, "GET", "/api/tools")).body);
    expect(tools.data.tools.map((t: { name: string }) => t.name)).toContain("scene_validate");
    const r = JSON.parse((await http(studio.port, "POST", "/api/tools/call", { headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "catalog_get", input: {} }) })).body);
    expect(r.ok).toBe(true);
    const bad = await http(studio.port, "POST", "/api/tools/call", { body: JSON.stringify({ name: "nope" }) });
    expect(bad.status).toBe(404);
    expect(JSON.parse(bad.body).error.code).toBe("notFound");
  });

  it("streams external changes on /api/events", async () => {
    const done = sse(studio.port, "/api/events", (t) => t.includes("scene.json"));
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(project, "scene.json"), JSON.stringify({ version: 1, title: "Changed" }));
    const text = await done;
    expect(text).toContain("event: change");
    expect(text).toContain("scene.json");
  });
});

describe("serve (live preview)", () => {
  it("serves the preview page and the current scene", async () => {
    const page = await http(preview.port, "GET", "/");
    expect(page.body).toContain("mountScene");
    expect(page.body).toContain("EventSource");
    expect(JSON.parse((await http(preview.port, "GET", "/__scene.json")).body)).toMatchObject({ version: 1 });
    expect((await http(preview.port, "GET", "/project/../secret.txt")).status).toBe(404);
  });

  it("sends a scene event when scene.json changes", async () => {
    const done = sse(preview.port, "/__events", (t) => t.includes("event: scene"));
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(project, "scene.json"), JSON.stringify({ version: 1, title: "Live" }));
    expect(await done).toContain("event: scene");
  });
});
