import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import { createProject } from "../ops/project";
import { writeZipStored } from "../ops/zip";
import type { JsonSchema } from "./types";
import { AI_TOOLS, callAiTool, findAiTool, listAiTools } from "./tools";
import type { RenderResult, ToolContext, ToolHost } from "./types";

const EXPECTED = [
  "project_info", "scene_get", "scene_summary", "scene_apply", "scene_patch", "scene_validate", "object_add", "object_update", "object_remove", "object_list",
  "timeline_set", "catalog_get", "templates_list", "project_create", "check", "assets_list", "assets_search", "assets_add", "assets_optimize", "library_list", "export",
];

// Structural JSON-schema sanity: known keywords, valid types, required ⊆ properties.
function checkSchema(s: JsonSchema, path: string): void {
  const types = ["object", "array", "string", "number", "integer", "boolean", "null"];
  if (s.type) for (const t of Array.isArray(s.type) ? s.type : [s.type]) expect(types, `${path}.type`).toContain(t);
  for (const k of Object.keys(s)) expect(["type", "description", "properties", "required", "items", "enum", "additionalProperties", "default", "minimum", "maximum", "minItems"], `${path}: ${k}`).toContain(k);
  for (const r of s.required ?? []) expect(Object.keys(s.properties ?? {}), `${path}.required`).toContain(r);
  for (const [k, p] of Object.entries(s.properties ?? {})) checkSchema(p, `${path}.${k}`);
  if (s.items) checkSchema(s.items, `${path}[]`);
}

async function ctx(host: ToolHost = {}): Promise<ToolContext> {
  const fs = new MemoryFs();
  await createProject(fs, { name: "Tool Test" });
  return { fs, host };
}

describe("AI tool catalog", () => {
  it("exposes exactly the CLAUDE.md list (+ render_preview with a renderer)", () => {
    expect(AI_TOOLS.map((t) => t.name)).toEqual(EXPECTED);
    expect(listAiTools().map((t) => t.name)).not.toContain("render_preview");
    expect(listAiTools({ render: async () => ({}) as RenderResult }).map((t) => t.name)).toContain("render_preview");
    expect(listAiTools(undefined, { readOnly: true }).every((t) => !t.mutating)).toBe(true);
  });

  it("has valid schemas and useful descriptions", () => {
    for (const t of listAiTools({ render: async () => ({}) as RenderResult })) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length, t.name).toBeGreaterThan(60);
      checkSchema(t.inputSchema, t.name);
      expect(JSON.parse(JSON.stringify(t.inputSchema))).toEqual(t.inputSchema);
    }
  });

  it("read tools run against a MemoryFs project", async () => {
    const c = await ctx();
    const info = (await callAiTool(c, "project_info", {})) as { summary: { target: unknown }; validation: { errors: number } };
    expect(info.summary.target).toEqual({ kind: "banner", aspect: "4:1" });
    expect(info.validation.errors).toBe(0);
    expect(await callAiTool(c, "scene_get", { path: "objects#title.kind" })).toEqual({ path: "objects#title.kind", value: "text" });
    await expect(callAiTool(c, "scene_get", { path: "objects#nope" })).rejects.toMatchObject({ code: "notFound" });
    expect(((await callAiTool(c, "object_list", {})) as { count: number }).count).toBeGreaterThan(3);
    expect(((await callAiTool(c, "scene_validate", {})) as { ok: boolean }).ok).toBe(true);
    const bad = (await callAiTool(c, "scene_validate", { scene: { version: 1 } })) as { ok: boolean; issues: unknown[] };
    expect(bad.ok).toBe(false);
    expect(((await callAiTool(c, "check", {})) as { ok: boolean }).ok).toBe(true);
    expect(((await callAiTool(c, "assets_list", {})) as { count: number }).count).toBe(0);
    expect(((await callAiTool(c, "library_list", {})) as { total: number }).total).toBe(0);
    expect(((await callAiTool(c, "templates_list", {})) as { count: number }).count).toBe(0);
  });

  it("catalog_get: overview, section, entry, suggestions", async () => {
    const c = await ctx();
    const all = (await callAiTool(c, "catalog_get", {})) as { sections: Record<string, string[]> };
    expect(all.sections.generators.some((x) => x.startsWith("terrain — "))).toBe(true);
    const sec = (await callAiTool(c, "catalog_get", { section: "behaviours" })) as { entries: { id: string; params: string[] }[] };
    expect(sec.entries.find((e) => e.id === "rotate")!.params).toEqual(["axis", "speed"]);
    const entry = (await callAiTool(c, "catalog_get", { section: "generators", id: "terrain" })) as { params: { name: string }[] };
    expect(entry.params.map((p) => p.name)).toContain("waterLevel");
    await expect(callAiTool(c, "catalog_get", { section: "generators", id: "terain" })).rejects.toMatchObject({ hint: expect.stringContaining('"terrain"') });
    await expect(callAiTool(c, "catalog_get", { section: "nope" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("mutating tools: patch, add, update, remove, timeline, apply", async () => {
    const c = await ctx();
    const add = (await callAiTool(c, "object_add", { object: { id: "ball", kind: "mesh", geometry: { type: "sphere", radius: 0.4 }, material: { preset: "chrome" } } })) as { status: string };
    expect(add.status).toBe("applied");
    const refused = (await callAiTool(c, "object_update", { id: "ball", set: { material: { roughness: 7 } } })) as { status: string; issues: { path: string }[] };
    expect(refused.status).toBe("refused");
    expect(refused.issues[0].path).toBe("objects#ball.material.roughness");
    expect(((await callAiTool(c, "object_update", { id: "ball", set: { position: [1, 0, 0] } })) as { status: string }).status).toBe("applied");
    expect(((await callAiTool(c, "scene_patch", { ops: [{ op: "set", path: "camera.fov", value: 32 }], dryRun: true })) as { status: string }).status).toBe("dry-run");
    expect(((await callAiTool(c, "timeline_set", { addTracks: [{ target: "ball.position.y", keys: [[0, 0], [2, 1]] }], settings: { loop: "pingpong" } })) as { status: string }).status).toBe("applied");
    expect(((await callAiTool(c, "object_remove", { id: "ball" })) as { status: string }).status).toBe("applied");
    const scene = await callAiTool(c, "scene_get", {});
    expect(((await callAiTool(c, "scene_apply", { scene })) as { status: string }).status).toBe("unchanged");
  });

  it("validates input against the schema", async () => {
    const c = await ctx();
    await expect(callAiTool(c, "object_update", { id: "x" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining('"set"') });
    await expect(callAiTool(c, "scene_patch", { ops: "nope" })).rejects.toMatchObject({ code: "invalid" });
    expect(() => findAiTool("scene_patc")).toThrow(expect.objectContaining({ hint: expect.stringContaining('Did you mean "scene_patch"') }));
  });

  it("project_create with a template from the host", async () => {
    const tpl = await ctx();
    const sceneJson = await tpl.fs.readText("scene.json");
    const host: ToolHost = { templates: { index: [{ id: "neon", title: "Neon", description: "Neon sign", kind: "banner", tags: ["neon"], aspect: "4:1" }], files: async () => ({ "scene.json": sceneJson }) } };
    const c: ToolContext = { fs: new MemoryFs(), host };
    const r = (await callAiTool(c, "project_create", { name: "My Neon", template: "neon" })) as { manifest: { template: string } };
    expect(r.manifest.template).toBe("neon");
    await expect(callAiTool({ fs: new MemoryFs(), host }, "project_create", { name: "x", template: "neo" })).rejects.toMatchObject({ hint: expect.stringContaining('"neon"') });
    const game = (await callAiTool({ fs: new MemoryFs() }, "project_create", { name: "g", kind: "game" })) as { files: string[] };
    expect(game.files).toContain("scripts/game.js");
  });

  it("assets_search / assets_add need network and accept a local zip", async () => {
    const c = await ctx({ readLocalFile: async () => writeZipStored({ "pack/Models/tree.glb": new Uint8Array([1]) }) });
    await expect(callAiTool(c, "assets_search", { query: "tree" })).rejects.toMatchObject({ code: "io" });
    const r = (await callAiTool(c, "assets_add", { file: "/tmp/pack.zip", source: "kenney", license: "CC0-1.0" })) as { models: string[] };
    expect(r.models).toEqual(["assets/models/pack/tree.glb"]);
  });

  it("export writes into dist/ and render_preview feeds check", async () => {
    const enc = new TextEncoder();
    const inspect = { camera: { position: [0, 0, 12] as [number, number, number], target: [0, 0, 0] as [number, number, number] }, objects: [{ id: "title", min: [-50, 0, 0] as [number, number, number], max: [-49, 1, 1] as [number, number, number], inView: "none" as const, screenCoverage: 0 }] };
    const host: ToolHost = {
      runtimeFiles: async () => ({ "agent3d-runtime.js": enc.encode("export {}") }),
      library: { index: { assets: [{ id: "fonts/sans-bold.typeface.json", path: "fonts/sans-bold.typeface.json", kind: "font", license: "Apache-2.0", tags: [], bytes: 100, description: "Font" }] }, read: async () => enc.encode("{}") },
      render: async () => ({ frames: [{ t: 0, path: "renders/frame-0.png" }], sheet: "renders/sheet.png", stats: { triangles: 1000, drawCalls: 300, geometries: 3, textures: 0 }, inspect, issues: [], consoleErrors: [] }),
    };
    const c = await ctx(host);
    const ex = (await callAiTool(c, "export", {})) as { entry: string; snippet: string };
    expect(ex.entry).toBe("dist/embed/index.html");
    expect(await c.fs.exists("dist/embed/tool-test/scene.json")).toBe(true);
    await expect(callAiTool(c, "export", { outDir: "src" })).rejects.toMatchObject({ code: "invalid" });
    const rp = (await callAiTool(c, "render_preview", { count: 1 })) as { sheet: string };
    expect(rp.sheet).toBe("renders/sheet.png");
    const chk = (await callAiTool(c, "check", {})) as { issues: { code: string }[] };
    expect(chk.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["out-of-view", "draw-calls"]));
  });

  it("export renders a poster / video when the host can (and passes render_preview input through)", async () => {
    const calls: unknown[] = [];
    const host: ToolHost = {
      media: async (o) => (calls.push(o), { bytes: new Uint8Array(2048), size: { width: 1200, height: 300 }, ...(o.format === "poster" ? { t: 1.5 } : { frames: 30, fps: 30, duration: 1 }) }),
      render: async (o) => (calls.push(o), { dir: "/p", frames: [{ t: 0, path: "renders/a.png" }], state: { score: 2 }, issues: [], consoleErrors: [] }),
    };
    const c = await ctx(host);
    const poster = await callAiTool(c, "export", { format: "poster", time: 2 });
    expect(poster).toMatchObject({ format: "poster", path: "dist/poster.webp", t: 1.5, kb: 2 });
    expect(await c.fs.exists("dist/poster.webp")).toBe(true);
    expect(await callAiTool(c, "export", { format: "video", duration: 1, out: "dist/clip.webm" })).toMatchObject({ format: "video", path: "dist/clip.webm", frames: 30 });
    expect(calls.slice(0, 2)).toEqual([expect.objectContaining({ format: "poster", time: 2, image: "webp" }), expect.objectContaining({ format: "video", duration: 1 })]);
    await expect(callAiTool(c, "export", { format: "video", out: "video.webm" })).rejects.toMatchObject({ code: "invalid" });
    await expect(callAiTool(await ctx({}), "export", { format: "poster" })).rejects.toMatchObject({ code: "invalid" });
    const rp = await callAiTool(c, "render_preview", { frames: [0], input: [{ t: 0.1, key: "Space", hold: 0.2 }] });
    expect(rp).toMatchObject({ dir: "/p", state: { score: 2 } });
    expect(calls[2]).toMatchObject({ input: [{ t: 0.1, key: "Space", hold: 0.2 }] });
  });
});
