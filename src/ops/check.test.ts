import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { InspectResult } from "../runtime/api";
import { evalCost, estimateTriangles, geometryTriangles, textTriangles } from "./budget";
import { gltfInfo, modelInfo } from "./gltf";

function makeGlb(json: unknown): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, body.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}
import { checkProject, framingIssues } from "./check";
import { addAsset } from "./assets";
import { createProject } from "./project";
import { getScene, patchScene } from "./scene";
import { lintScript, stripCode } from "./scriptLint";

async function project(kind: "banner" | "game" = "banner") {
  const fs = new MemoryFs();
  await createProject(fs, { name: "Check me", target: { kind } });
  return fs;
}
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("script lint", () => {
  it("flags forbidden globals but not strings, comments, properties or keys", () => {
    const src = `// fetch() in a comment
/* window.location */
const msg = "do not use fetch or document";
const tpl = \`text window \${api.state.top} more\`;
export default function (api) {
  const box = { top: 1, parent: 2 };
  api.get("x").parent;
  return { update() { box.top += 1; } };
}`;
    expect(lintScript(src, "scripts/ok.js")).toEqual([]);
  });
  it("catches each forbidden pattern with a line number and hint", () => {
    const src = `import x from "./x.js";
export default function (api) {
  fetch("https://x");
  const w = window.innerWidth;
  localStorage.setItem("a", 1);
  eval("1+1");
  new Function("return 1");
  const m = import("./m.js");
  parent.foo(); postMessage("hi", "*");
  document.cookie = "a=1";
  globalThis.foo = 1;
  const t = \`\${top.location}\`;
  return {};
}`;
    const issues = lintScript(src, "scripts/bad.js");
    const msgs = issues.map((i) => `${i.path} ${i.message}`).join("\n");
    for (const w of ["fetch", "window", "localStorage", "eval", "Function", "postMessage", "document", "globalThis", "top"]) expect(msgs).toContain(`"${w}"`);
    expect(msgs).toContain("Static imports");
    expect(msgs).toContain("Dynamic import()");
    expect(issues.find((i) => i.message.includes('"fetch"'))!.path).toBe("scripts/bad.js:3");
    expect(issues.every((i) => i.hint && i.code === "forbidden-script")).toBe(true);
  });
  it("requires export default", () => {
    expect(codes(lintScript("function f() {}", "scripts/a.js"))).toEqual(["forbidden-script"]);
  });
  it("strips code preserving template expressions", () => {
    expect(stripCode('a("x") + `t${b}u`')).toBe('a(" ") + ` ${b} `');
  });
});

describe("budget", () => {
  it("evaluates cost formulas", () => {
    expect(evalCost("segments*heightSegments*2", { segments: 32, heightSegments: 24 })).toBe(1536);
    expect(evalCost("20*4^detail", { detail: 2 })).toBe(320);
    expect(evalCost("~500", {})).toBe(500);
    expect(evalCost("count*~150", { count: 10 })).toBe(1500);
    expect(evalCost("resolution^2*2", { resolution: 96 })).toBe(18432);
    expect(geometryTriangles({ type: "sphere" })).toBe(32 * 24 * 2);
  });
  it("estimates a scene (text, instances, generators, particles)", () => {
    const est = estimateTriangles({
      objects: [
        { id: "t", kind: "text", text: "Hi you" },
        { id: "i", kind: "instances", geometry: { type: "box" }, layout: { type: "grid", count: [10, 1, 10], spacing: [1, 1, 1] } },
        { id: "g", kind: "generator", generator: "terrain", params: { resolution: 100 } },
        { id: "p", kind: "particles", count: 50 },
        { id: "h", kind: "mesh", geometry: { type: "sphere" }, visible: false },
      ],
    });
    expect(est.byObject.find((o) => o.id === "t")!.triangles).toBe(5 * 33 * 33);
    expect(est.byObject.find((o) => o.id === "i")!.triangles).toBe(1200);
    expect(est.byObject.find((o) => o.id === "g")!.triangles).toBe(20000);
    expect(est.byObject.find((o) => o.id === "h")).toBeUndefined();
    expect(est.total).toBe(5445 + 1200 + 20000 + 100);
  });
  it("estimates text per glyph like the runtime (font, flat, extruded, bevel)", () => {
    expect(textTriangles({ text: "ABCDEFGHIJ", font: "sans-bold", depth: 0 })).toBe(330); // measured 330 (geometry, 10 glyphs)
    expect(textTriangles({ text: "ABCDEFGHIJ", font: "sans-bold", depth: 0.3, bevel: 0 })).toBe(2640); // measured 2780
    expect(textTriangles({ text: "ABCDEFGHIJ", font: "sans-bold", depth: 0.3, bevel: 0.03 })).toBe(10890); // measured 11190
    expect(textTriangles({ text: "ABCDEFGHIJ", font: "display", depth: 0.3 })).toBe(16170); // measured 16710
    expect(textTriangles({ text: "ABCDEFGHIJ", font: "mono", depth: 0 })).toBe(280); // measured 280
    expect(textTriangles({ text: "ABCDEFGHIJ", font: "sans-bold", depth: 0.2, outline: true })).toBe(13530);
  });
  it("counts model triangles from the library index and GLB files", () => {
    const est = estimateTriangles({ objects: [{ id: "m", kind: "model", src: "library:models/x.glb" }, { id: "n", kind: "model", src: "assets/unknown.glb" }] }, { models: (src) => (src === "library:models/x.glb" ? 1234 : undefined) });
    expect(est.byObject).toEqual([{ id: "m", triangles: 1234 }]);
  });
  it("parses GLB / glTF JSON triangle counts and clips", () => {
    const json = { scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, children: [1] }, { mesh: 1 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }, { primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 0 }, mode: 5 }] }], accessors: [{ count: 30 }, { count: 300 }], animations: [{ name: "Idle" }, {}] };
    expect(gltfInfo(json)).toEqual({ triangles: 100 + 10 + 28, animations: ["Idle", "clip1"] });
    expect(modelInfo("a.glb", makeGlb(json))!.triangles).toBe(138);
    expect(modelInfo("a.gltf", new TextEncoder().encode(JSON.stringify(json)))!.triangles).toBe(138);
    expect(modelInfo("a.glb", new Uint8Array(4))).toBeNull();
  });
});

describe("checkProject", () => {
  it("passes the starter project", async () => {
    const r = await checkProject(await project());
    expect(r.ok).toBe(true);
    expect(r.counts.errors).toBe(0);
    expect(r.counts.warnings).toBe(0);
    expect(r.budget.budgetKb).toBe(600);
    expect(r.budget.estimatedTriangles).toBeGreaterThan(0);
  });

  it("counts library and project model triangles; prefers runtime stats after a render", async () => {
    const fs = await project();
    const glb = makeGlb({ scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], accessors: [{ count: 10 }, { count: 3000 }] });
    await addAsset(fs, { path: "assets/models/box.glb", bytes: glb, source: "local", license: "CC0-1.0" });
    const scene = await getScene(fs);
    scene.objects.push({ id: "box", kind: "model", src: "assets/models/box.glb" }, { id: "pine", kind: "model", src: "library:models/nature/pine-tree.glb" });
    await fs.writeText("scene.json", JSON.stringify(scene));
    const library = { assets: [{ id: "models/nature/pine-tree.glb", path: "models/nature/pine-tree.glb", kind: "model" as const, license: "CC0-1.0", tags: [], bytes: 5000, description: "Pine", triangles: 4321 }] };
    const r = await checkProject(fs, { library });
    expect(r.budget.heaviestObjects).toEqual(expect.arrayContaining([{ id: "pine", triangles: 4321 }, { id: "box", triangles: 1000 }]));
    expect(r.budget).toMatchObject({ trianglesSource: "estimate", triangles: r.budget.estimatedTriangles });
    const measured = await checkProject(fs, { library, runtimeStats: { triangles: 99999, drawCalls: 10, geometries: 5, textures: 1 } });
    expect(measured.budget).toMatchObject({ trianglesSource: "runtime", triangles: 99999, runtimeTriangles: 99999, estimatedTriangles: r.budget.estimatedTriangles });
  });

  it("game starter script passes the lint", async () => {
    const r = await checkProject(await project("game"));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.budget.budgetKb).toBe(4000);
  });

  it("reports missing assets / scripts, bad scripts, unknown library ids and licences", async () => {
    const fs = await project();
    await addAsset(fs, { path: "assets/models/fox.glb", bytes: new Uint8Array(2000), source: "khronos", license: "CC-BY-4.0", author: "PixelMannen" });
    await fs.writeText("scripts/evil.js", 'export default (api) => { fetch("x"); return {}; }');
    await fs.writeText("scripts/orphan.js", "export default () => ({})");
    const scene = await getScene(fs);
    scene.objects.push({ id: "fox", kind: "model", src: "assets/models/fox.glb" }, { id: "ghost", kind: "model", src: "assets/models/ghost.glb" }, { id: "tree", kind: "model", src: "library:nature/pine-tre" });
    scene.scripts = ["scripts/evil.js", "scripts/missing.js"];
    await fs.writeText("scene.json", JSON.stringify(scene));
    const r = await checkProject(fs, { library: { assets: [{ id: "fonts/sans-bold.typeface.json", path: "fonts/sans-bold.typeface.json", kind: "font" as const, license: "Apache-2.0", tags: [], bytes: 100, description: "Font" }, { id: "nature/pine-tree", path: "models/nature/pine-tree.glb", kind: "model", license: "CC0-1.0", tags: [], bytes: 5000, description: "Pine" }] } });
    expect(r.ok).toBe(false);
    const c = codes(r.issues);
    expect(c).toEqual(expect.arrayContaining(["missing-asset", "missing-script", "forbidden-script", "unknown-library-id", "attribution", "unused-script"]));
    expect(r.issues.find((i) => i.code === "unknown-library-id")!.hint).toContain('"library:nature/pine-tree"');
    expect(r.licences.filter((l) => !l.path.startsWith("library:fonts/"))).toEqual([{ path: "assets/models/fox.glb", license: "CC-BY-4.0", author: "PixelMannen", attribution: expect.stringContaining("PixelMannen") }]);
    expect(r.budget.assetsKb).toBeCloseTo(2, 0);
  });

  it("warns on budget, triangles, performance and reduced motion", async () => {
    const fs = await project();
    await addAsset(fs, { path: "assets/textures/huge.jpg", bytes: new Uint8Array(900 * 1024), source: "local", license: "CC0-1.0" });
    await patchScene(fs, [
      { op: "addObject", object: { id: "floor", kind: "mesh", geometry: { type: "plane" }, material: { map: "assets/textures/huge.jpg" } } },
      { op: "addObject", object: { id: "land", kind: "generator", generator: "terrain", params: { resolution: 512 } } },
      { op: "set", path: "target.reducedMotion", value: "ignore" },
    ]);
    const r = await checkProject(fs, { runtimeStats: { triangles: 900_000, drawCalls: 400, geometries: 10, textures: 3 } });
    const c = codes(r.issues);
    expect(c).toEqual(expect.arrayContaining(["budget", "triangles", "draw-calls", "reduced-motion"]));
    expect(r.issues.find((i) => i.code === "triangles")!.hint).toContain("land");
  });

  it("framing analysis from inspect", async () => {
    const fs = await project();
    const scene = await getScene(fs);
    const inspect: InspectResult = {
      camera: { position: [0, 0, 12], target: [0, 0, 0], insideObject: "gem" },
      objects: [
        { id: "title", min: [-3, -0.5, 0], max: [3, 0.5, 0.3], inView: "full", screenCoverage: 0.01 },
        { id: "torus", min: [-30, 0, 0], max: [-29, 1, 1], inView: "none", screenCoverage: 0 },
        { id: "gem", min: [6, -1, -1], max: [8, 1, 1], inView: "partial", screenCoverage: 0.01 },
      ],
    };
    const issues = framingIssues(scene, inspect);
    expect(codes(issues)).toEqual(expect.arrayContaining(["camera-inside", "out-of-view", "clipped", "too-small"]));
    const r = await checkProject(fs, { inspect });
    expect(codes(r.issues)).toContain("out-of-view");
  });

  it("objects the timeline brings in later (scroll stories) are info, not out-of-view warnings", async () => {
    const fs = await project();
    const scene = await getScene(fs);
    scene.timeline = { duration: 4, trigger: "scroll", tracks: [{ target: "torus.position.x", keys: [[0, -30], [4, 0]] }] } as never;
    const inspect: InspectResult = {
      camera: { position: [0, 0, 12], target: [0, 0, 0] },
      objects: [
        { id: "title", min: [-3, -0.5, 0], max: [3, 0.5, 0.3], inView: "full", screenCoverage: 0.3 },
        { id: "torus", min: [-30, 0, 0], max: [-29, 1, 1], inView: "none", screenCoverage: 0 },
        { id: "gem", min: [-60, 0, 0], max: [-59, 1, 1], inView: "none", screenCoverage: 0 },
      ],
    };
    const issues = framingIssues(scene, inspect);
    expect(issues.find((i) => i.path === "objects#torus")).toMatchObject({ severity: "info", code: "out-of-view-at-start" });
    expect(issues.find((i) => i.path === "objects#gem")).toMatchObject({ severity: "warning", code: "out-of-view" });
  });

  it("framing ignores runtime clones and never calls scattered content clipped", async () => {
    const fs = await project();
    const scene = await getScene(fs);
    scene.objects.push({ id: "trees", kind: "generator", generator: "trees", params: { count: 10, area: [40, 0, 40] } } as never, { id: "dust", kind: "particles", preset: "dust" } as never);
    const inspect: InspectResult = {
      camera: { position: [0, 0, 12], target: [0, 0, 0] },
      objects: [
        { id: "title", min: [-3, -0.5, 0], max: [3, 0.5, 0.3], inView: "full", screenCoverage: 0.3 },
        { id: "trees", min: [-20, 0, -20], max: [20, 4, 20], inView: "partial", screenCoverage: 0.5 },
        { id: "dust", min: [-5, -5, -5], max: [5, 5, 5], inView: "partial", screenCoverage: 0.5 },
        { id: "bug-clone-3", min: [9, 0, 0], max: [10, 1, 1], inView: "partial", screenCoverage: 0.01 },
        { id: "bug-clone-4", min: [90, 0, 0], max: [91, 1, 1], inView: "none", screenCoverage: 0 },
      ],
    };
    const issues = framingIssues(scene, inspect);
    expect(issues.filter((i) => i.code === "clipped" || i.code === "out-of-view")).toEqual([]);
  });
});
