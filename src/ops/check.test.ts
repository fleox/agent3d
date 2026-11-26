import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { InspectResult } from "../runtime/api";
import { evalCost, estimateTriangles, frameTriangles, geometryTriangles, photoTriangles, textCurveSegments, textTriangles } from "./budget";
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
import { checkProject, drawCallCauses, framingIssues } from "./check";
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
    expect(evalCost("min(size*3, 160)^2*2", { size: 40 })).toBe(28800);
    expect(evalCost("min(size*3, 160)^2*2", { size: 200 })).toBe(51200);
    expect(evalCost("max(count, 10)+~5", { count: 2 })).toBe(15);
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
    expect(est.byObject.find((o) => o.id === "t")!.triangles).toBe(6574); // 5 glyphs × 9.9 × 8 curve segments × 16.6 (bevelled)
    expect(est.byObject.find((o) => o.id === "i")!.triangles).toBe(1200);
    expect(est.byObject.find((o) => o.id === "g")!.triangles).toBe(23200); // 100² × 2 + the low-poly skirt
    expect(est.byObject.find((o) => o.id === "h")).toBeUndefined();
    expect(est.total).toBe(6574 + 1200 + 23200 + 100);
  });
  it("estimates text per glyph like the runtime (font, size, flat, extruded, bevel, outline)", () => {
    // Measured with the runtime (geometry triangles of "Hamburgefonstiv ABCDEFGHIJ", 25 glyphs).
    const t = "Hamburgefonstiv ABCDEFGHIJ";
    const near = (est: number, measured: number) => expect(Math.abs(est - measured) / measured).toBeLessThan(0.1);
    near(textTriangles({ text: t, font: "sans-bold", size: 1, depth: 0 }), 2900);
    near(textTriangles({ text: t, font: "sans-bold", size: 0.1, depth: 0 }), 2020);
    near(textTriangles({ text: t, font: "serif", size: 3, depth: 0 }), 8480);
    near(textTriangles({ text: t, font: "sans-bold", size: 1, depth: 0.2, bevel: 0 }), 8145);
    near(textTriangles({ text: t, font: "serif", size: 1, depth: 0.2 }), 60027);
    near(textTriangles({ text: t, font: "sans-bold", size: 0.3, depth: 0.05 }), 26093);
    near(textTriangles({ text: t, font: "sans-bold", size: 1, depth: 0, outline: true }), 16865);
    expect(textCurveSegments({ size: 1, depth: 0 })).toBe(12);
    expect(textCurveSegments({ size: 1, depth: 0.2, curveSegments: 40 })).toBe(32);
  });
  it("estimates every pass of a frame (shadow maps, ao pre-pass, contact shadows)", () => {
    const scene = {
      objects: [
        { id: "a", kind: "mesh", geometry: { type: "box" } },
        { id: "b", kind: "mesh", geometry: { type: "box" }, castShadow: false },
      ],
      lights: [{ id: "key", type: "directional", castShadow: true }],
      environment: { contactShadows: true },
      postfx: [{ type: "ao" }],
    } as never;
    const f = frameTriangles(scene, estimateTriangles(scene));
    expect(f.passes).toEqual({ main: 24, shadowMaps: 12, prepass: 24, contactShadows: 12 });
    expect(f.perFrame).toBe(72);
    expect(frameTriangles({ objects: [] } as never, { total: 0, byObject: [] }).perFrame).toBe(0);
  });
  it("names the objects that cost the most draw calls (per-letter text × outline, copies)", () => {
    const scene = {
      objects: [
        { id: "title", kind: "text", text: "Hello world", splitLetters: true, outline: true },
        { id: "sub", kind: "text", text: "Tagline here" },
        ...[1, 2, 3].map((n) => ({ id: `fox${n}`, kind: "model", src: "assets/fox.glb" })),
      ],
      timeline: { duration: 2, tracks: [{ target: "sub/0.position.y", keys: [[0, 0]] }] },
    } as never;
    const causes = drawCallCauses(scene);
    expect(causes[0]).toMatchObject({ id: "title", drawCalls: 20, why: expect.stringContaining("× outline") });
    expect(causes.find((c) => c.id === "sub")).toMatchObject({ drawCalls: 11, why: expect.stringContaining("per-letter") });
    expect(causes.some((c) => /3 copies of model/.test(c.why))).toBe(true);
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

// Minimal PNG header (IHDR size) padded to `bytes`.
function pngOf(w: number, h: number, bytes = 64): Uint8Array {
  const b = new Uint8Array(Math.max(33, bytes));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b[25] = 6;
  return b;
}
// Minimal JPEG (SOF0 frame size) padded to `bytes`.
function jpgOf(w: number, h: number, bytes = 64): Uint8Array {
  const b = new Uint8Array(Math.max(24, bytes));
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3]);
  return b;
}

describe("3D photos", () => {
  it("costs photos by mode", () => {
    expect(photoTriangles({ depth: "d.png" })).toBe(2);
    expect(photoTriangles({ depth: "d.png", mode: "layers" })).toBe(12);
    expect(photoTriangles({ depth: "d.png", mode: "layers", layers: 10 })).toBe(20);
    expect(photoTriangles({ depth: "d.png", mode: "mesh" })).toBe(256 * 256 * 2 * 1.25); // grid + half-resolution backing
    expect(photoTriangles({ depth: "d.png", mode: "mesh", segments: 100, width: 4, height: 2 })).toBe(100 * 50 * 2 * 1.25);
    expect(photoTriangles({ mode: "mesh", segments: 512 })).toBe(2); // no depth: a flat quad
    const est = estimateTriangles({ objects: [{ id: "p", kind: "photo", src: "a.jpg", depth: "d.png", mode: "mesh", segments: 64 }] });
    expect(est.byObject).toEqual([{ id: "p", triangles: 64 * 64 * 2 * 1.25 }]);
  });

  it("reports a missing depth map, an aspect mismatch, a lossy depth map and a heavy photo", async () => {
    const fs = await project();
    await addAsset(fs, { path: "assets/textures/street.jpg", bytes: jpgOf(1600, 900, 1.6 * 1024 * 1024), source: "local", license: "CC0-1.0" });
    await addAsset(fs, { path: "assets/depth/street-depth.png", bytes: pngOf(1024, 1024), source: "local", license: "CC0-1.0" });
    await addAsset(fs, { path: "assets/textures/ok.jpg", bytes: jpgOf(1600, 900), source: "local", license: "CC0-1.0" });
    await addAsset(fs, { path: "assets/textures/ok.depth.png", bytes: pngOf(800, 450), source: "local", license: "CC0-1.0" });
    await addAsset(fs, { path: "assets/textures/ok.depth.jpg", bytes: jpgOf(800, 450), source: "local", license: "CC0-1.0" });
    const scene = await getScene(fs);
    scene.objects.push(
      { id: "street", kind: "photo", src: "assets/textures/street.jpg", depth: "assets/depth/street-depth.png" },
      { id: "ok", kind: "photo", src: "assets/textures/ok.jpg", depth: "assets/textures/ok.depth.png", position: [0, 0, -1] },
      { id: "lossy", kind: "photo", src: "assets/textures/ok.jpg", depth: "assets/textures/ok.depth.jpg", position: [0, 0, -2] },
      { id: "ghost", kind: "photo", src: "assets/textures/ok.jpg", depth: "assets/textures/ghost.depth.png", position: [0, 0, -3] },
      { id: "plated", kind: "photo", src: "assets/textures/ok.jpg", depth: "assets/textures/ok.depth.png", plate: "assets/depth/ok-plate.webp", plateDepth: "assets/depth/street-depth.png", position: [0, 0, -4] },
    );
    await fs.writeText("scene.json", JSON.stringify(scene));
    const r = await checkProject(fs);
    const at = (code: string) => r.issues.filter((i) => i.code === code).map((i) => i.path);
    expect(at("missing-asset")).toEqual(["objects#ghost.depth", "objects#plated.plate"]);
    expect(at("photo-plate-aspect")).toEqual(["objects#plated.plateDepth"]);
    expect(at("photo-depth-aspect")).toEqual(["objects#street.depth"]);
    expect(at("photo-heavy")).toEqual(["objects#street.src"]);
    expect(r.issues.find((i) => i.code === "photo-heavy")!.hint).toContain("agent3d assets optimize assets/textures/street.jpg");
    expect(at("photo-depth-lossy")).toEqual(["objects#lossy.depth"]);
    expect(r.issues.find((i) => i.code === "photo-depth-aspect")!.severity).toBe("warning");
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
    expect(r.budget).toMatchObject({ trianglesSource: "estimate", triangles: r.budget.estimatedFrameTriangles });
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

describe("framing consistency", () => {
  it("reports objects the timeline reveals later the same way, whether in view (transparent) or out of view", () => {
    const scene = {
      version: 1, id: "s", title: "S", target: { kind: "hero" }, camera: {}, lights: [],
      objects: [
        { id: "ch2", kind: "group", children: [{ id: "ch2-t", kind: "text", text: "Two" }] },
        { id: "ch3", kind: "group", children: [{ id: "ch3-t", kind: "text", text: "Three" }] },
        { id: "logo", kind: "mesh", geometry: { type: "box" } },
      ],
      timeline: { duration: 10, trigger: "scroll", tracks: [
        { target: "camera.position", keys: [[0, [0, 0, 5]], [10, [5, 0, 5]]] },
        { target: "children:ch2.material.opacity", keys: [[0, 0], [4, 1]] },
        { target: "children:ch3.material.opacity", keys: [[0, 0], [8, 1]] },
      ] },
    } as never;
    const inspect: InspectResult = {
      camera: { position: [0, 0, 5], target: [0, 0, 0] },
      objects: [
        { id: "ch2", min: [0, 0, 0], max: [1, 1, 0], inView: "full", screenCoverage: 0.05 },
        { id: "ch3", min: [-40, 0, 0], max: [-39, 1, 0], inView: "none", screenCoverage: 0 },
        { id: "logo", min: [-1, -1, 0], max: [1, 1, 1], inView: "full", screenCoverage: 0.3 },
      ],
    };
    const issues = framingIssues(scene, inspect);
    expect(issues.filter((i) => i.code === "out-of-view-at-start").map((i) => i.path).sort()).toEqual(["objects#ch2", "objects#ch3"]);
    expect(issues.find((i) => i.path === "objects#ch2")!.message).toMatch(/hidden at the checked frame/);
  });
  it("non-scroll timelines: an object off-screen at t = 0 stays a warning, with a hint about later frames", () => {
    const scene = { version: 1, id: "s", title: "S", target: { kind: "banner" }, camera: {}, lights: [], objects: [{ id: "car", kind: "mesh", geometry: { type: "box" } }], timeline: { duration: 4, tracks: [{ target: "car.position.x", keys: [[0, -30], [2, 0]] }] } } as never;
    const issues = framingIssues(scene, { camera: { position: [0, 0, 5], target: [0, 0, 0] }, objects: [{ id: "car", min: [-31, 0, 0], max: [-29, 1, 1], inView: "none", screenCoverage: 0 }] });
    expect(issues[0]).toMatchObject({ code: "out-of-view", severity: "warning", hint: expect.stringContaining("check later frames") });
  });
});

describe("framing of camera-attached objects", () => {
  it("never reports attach: camera objects as out of view or clipped", () => {
    const scene = { version: 1, id: "s", title: "S", target: { kind: "banner" }, camera: {}, lights: [], objects: [{ id: "caption", kind: "text", text: "Hi", attach: "camera", position: [0, -1, -6] }, { id: "box", kind: "mesh", geometry: { type: "box" } }] } as never;
    const issues = framingIssues(scene, { camera: { position: [0, 0, 5], target: [0, 0, 0] }, objects: [{ id: "caption", min: [-40, 0, 0], max: [-39, 1, 0], inView: "none", screenCoverage: 0 }, { id: "box", min: [-1, -1, -1], max: [1, 1, 1], inView: "full", screenCoverage: 0.3 }] });
    expect(issues.filter((i) => i.path === "objects#caption")).toEqual([]);
  });
});
