import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { InspectResult } from "../runtime/api";
import { evalCost, estimateTriangles, geometryTriangles } from "./budget";
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
    expect(est.byObject.find((o) => o.id === "t")!.triangles).toBe(5 * 300);
    expect(est.byObject.find((o) => o.id === "i")!.triangles).toBe(1200);
    expect(est.byObject.find((o) => o.id === "g")!.triangles).toBe(20000);
    expect(est.byObject.find((o) => o.id === "h")).toBeUndefined();
    expect(est.total).toBe(1500 + 1200 + 20000 + 100);
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
    const r = await checkProject(fs, { library: { assets: [{ id: "nature/pine-tree", path: "models/nature/pine-tree.glb", kind: "model", license: "CC0-1.0", tags: [], bytes: 5000, description: "Pine" }] } });
    expect(r.ok).toBe(false);
    const c = codes(r.issues);
    expect(c).toEqual(expect.arrayContaining(["missing-asset", "missing-script", "forbidden-script", "unknown-library-id", "attribution", "unused-script"]));
    expect(r.issues.find((i) => i.code === "unknown-library-id")!.hint).toContain('"library:nature/pine-tree"');
    expect(r.licences).toEqual([{ path: "assets/models/fox.glb", license: "CC-BY-4.0", author: "PixelMannen", attribution: expect.stringContaining("PixelMannen") }]);
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
});
