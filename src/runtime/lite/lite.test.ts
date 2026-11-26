// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SceneDoc } from "../../core/types";
import { createCamera, setCameraAspect } from "../build/camera";
import { designAspectOf } from "../build/cameraFit";
import { cameraBasis, hexColor, photoFragment } from "./player";

const scene = (over: Partial<SceneDoc["camera"]> = {}, aspect = "16:9"): SceneDoc =>
  ({
    version: 1,
    id: "s",
    title: "S",
    target: { kind: "hero", aspect },
    camera: { type: "perspective", fov: 35, position: [0.6, -0.3, 16], target: [0.2, 0, 0], ...over },
    environment: { background: "#000" },
    lights: [],
    objects: [{ id: "p", kind: "photo", src: "a.jpg" }],
  }) as SceneDoc;

// Project a world point with the lite camera basis (ray model) → NDC.
function liteProject(s: SceneDoc, aspect: number, p: [number, number, number]): [number, number] {
  const c = cameraBasis(s, aspect);
  const d = [p[0] - c.pos[0], p[1] - c.pos[1], p[2] - c.pos[2]];
  const z = d[0] * c.fwd[0] + d[1] * c.fwd[1] + d[2] * c.fwd[2];
  const x = (d[0] * c.right[0] + d[1] * c.right[1] + d[2] * c.right[2]) / z;
  const y = (d[0] * c.up[0] + d[1] * c.up[1] + d[2] * c.up[2]) / z;
  return [x / (c.tanY * aspect), y / c.tanY];
}

describe("lite runtime camera", () => {
  it("projects like the full runtime's three.js camera (incl. responsive fov fit)", () => {
    for (const [s, aspect] of [
      [scene(), 16 / 9],
      [scene({ position: [0, 0, 10], target: [0, 0, 0], fov: 50 }), 1.2], // narrower than 16:9 → widened fov
      [scene({ position: [3, 2, 5], target: [-1, 0.5, 0] }, "4:1"), 2],
      [scene({ position: [0, 5, 0.0001], target: [0, 0, 0] }), 16 / 9], // near-vertical view
    ] as [SceneDoc, number][]) {
      const cam = createCamera(s.camera, aspect) as THREE.PerspectiveCamera;
      setCameraAspect(cam, s.camera, aspect, designAspectOf(s.target.aspect));
      cam.updateMatrixWorld(true);
      for (const p of [[0, 0, 0], [1.5, -0.7, 0], [-2, 1, 0.4]] as [number, number, number][]) {
        const v = new THREE.Vector3(...p).project(cam);
        const [x, y] = liteProject(s, aspect, p);
        expect(x).toBeCloseTo(v.x, 5);
        expect(y).toBeCloseTo(v.y, 5);
      }
    }
  });

  it("parses hex colours and builds the fragment shader with the march steps", () => {
    expect(hexColor("#ff8000", [0, 0, 0])).toEqual([1, 128 / 255, 0]);
    expect(hexColor("#fff", [0, 0, 0])).toEqual([1, 1, 1]);
    expect(hexColor("red", [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]);
    const f = photoFragment(false, 23);
    expect(f.startsWith("#version 300 es")).toBe(true);
    expect(f).toContain("const int STEPS = 23;");
    expect(photoFragment(true, 23)).not.toContain("parallaxTexel");
  });

  it("never imports three.js (static import graph of src/runtime/lite/index.ts)", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
        const spec = m[1];
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^three/);
        if (spec.startsWith(".")) visit(resolve(dirname(file), spec.endsWith(".json") ? spec : `${spec}.ts`));
      }
      expect(src, file).not.toMatch(/import\(\s*["']three/);
    };
    visit(join(__dirname, "index.ts"));
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe("lite <agent3d-scene>", () => {
  it("keeps the poster and reports webgl-unavailable without WebGL2", async () => {
    await import("./index");
    const el = document.createElement("agent3d-scene") as HTMLElement & { ready: Promise<unknown> };
    const errors: string[] = [];
    el.addEventListener("agent3d:error", (e) => errors.push((e as CustomEvent<{ code: string }>).detail.code));
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = JSON.stringify({ ...scene(), target: { kind: "hero", aspect: "16:9", lazy: false } });
    el.appendChild(script);
    document.body.appendChild(el);
    for (let i = 0; i < 50 && el.getAttribute("status") !== "unsupported"; i++) await new Promise((r) => setTimeout(r, 10));
    expect(el.getAttribute("status")).toBe("unsupported");
    expect(errors).toContain("webgl-unavailable");
    expect(el.getAttribute("role")).toBe("img");
    expect(el.getAttribute("aria-label")).toBe("S");
    el.remove();
  });
});
