// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { describe, expect, it } from "vitest";
import type { RuntimeContext } from "./context";
import { extrudeTriangles } from "./extrude";
import { buildSvg, partsBounds, svgParts } from "./svg";

const fixture = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "svg-fixtures", name), "utf8");
const parse = (markup: string, opts = {}) => svgParts(new SVGLoader().parse(markup), SVGLoader, opts);
const ctx = { resolveAsset: (p: string) => p, renderer: null, deterministic: true, track: <T,>(p: Promise<T>) => p, onUpdate: () => {}, issue: () => {}, shaders: async () => ({}), generators: async () => ({}) } as unknown as RuntimeContext;

const meshes = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
  return out;
};

describe("svgParts", () => {
  it("turns stroke-only line icons (circle, rect, polyline, line, ellipse, polygon) into stroke parts", () => {
    const parts = parse(fixture("icons-stroke.svg"), { currentColor: "#334455" });
    expect(parts.length).toBeGreaterThanOrEqual(10);
    expect(parts.every((p) => p.kind === "stroke")).toBe(true);
    expect(parts.every((p) => p.color === "#334455")).toBe(true);
    // Five 24-unit icons side by side, strokes included (2 px wide).
    const b = partsBounds(parts);
    expect(b.max.x - b.min.x).toBeGreaterThan(110);
    expect(b.max.x - b.min.x).toBeLessThan(122);
  });

  it("strokes: false drops them", () => {
    expect(parse(fixture("icons-stroke.svg"), { strokes: false })).toEqual([]);
  });

  it("keeps per-path colours, CSS classes, opacity and holes (evenodd + nonzero)", () => {
    const parts = parse(fixture("logo-multicolor.svg"));
    const fills = parts.filter((p) => p.kind === "fill");
    expect(fills.map((p) => p.color)).toEqual(["#023047", "#219ebc", "#ffffff", "#ffb703", "#ffffff"]);
    // evenodd ring = one shape with a hole; the "A" has its counter as a hole.
    expect(fills[0].shapes!.length).toBe(1);
    expect(fills[0].shapes![0].holes.length).toBe(1);
    expect(fills[2].shapes![0].holes.length).toBe(1);
    expect(fills[4].opacity).toBeCloseTo(0.35, 5);
    const strokes = parts.filter((p) => p.kind === "stroke");
    expect(strokes.map((p) => p.color)).toEqual(["#fb8500"]);
  });

  it("nonzero with same-direction contours fills solid; evenodd punches a hole", () => {
    const sq = (rule: string) => `<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="${rule}" d="M0 0H10V10H0Z M3 3H7V7H3Z"/></svg>`;
    expect(parse(sq("nonzero"))[0].shapes![0].holes.length).toBe(0);
    expect(parse(sq("evenodd"))[0].shapes![0].holes.length).toBe(1);
  });

  it("text converted to paths keeps every letter counter", () => {
    const parts = parse(fixture("wordmark-paths.svg"));
    const shapes = parts.flatMap((p) => p.shapes ?? []);
    expect(shapes.length).toBe(9); // N O R T H W I N D
    expect(shapes.reduce((n, s) => n + s.holes.length, 0)).toBe(3); // O R D
  });
});

describe("extrudeTriangles", () => {
  it("builds caps and outward walls from a flat soup", () => {
    // Two triangles = a unit square, one of them clockwise.
    const flat = new THREE.BufferGeometry();
    flat.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0], 3));
    const g = extrudeTriangles(flat, 0.5);
    // 2 front + 2 back + 4 walls × 2 = 12 triangles.
    expect(g.getAttribute("position").count).toBe(36);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBe(0.5);
    // Every wall normal points away from the square's centre.
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    for (let i = 12; i < p.count; i++) {
      const dx = p.getX(i) - 0.5, dy = p.getY(i) - 0.5;
      expect(dx * n.getX(i) + dy * n.getY(i)).toBeGreaterThan(0);
    }
  });
});

describe("buildSvg", () => {
  it("fits the width to size, centres the logo and merges same-colour runs", async () => {
    const g = await buildSvg({ id: "logo", kind: "svg", src: fixture("logo-multicolor.svg"), size: 3, depth: 0.2, bevel: 0.02 }, ctx);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.max.x - box.min.x).toBeCloseTo(3, 1);
    expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(0.02);
    expect(Math.abs(box.max.y + box.min.y)).toBeLessThan(0.02);
    expect(Math.abs(box.max.z + box.min.z)).toBeLessThan(0.02);
    const colours = meshes(g).map((m) => `#${((m.material as THREE.MeshStandardMaterial).color).getHexString(THREE.SRGBColorSpace)}`);
    expect(colours).toContain("#ffb703");
    expect(colours).toContain("#fb8500");
  });

  it("a material overrides the colours unless keepColors is true; fit height", async () => {
    const one = await buildSvg({ id: "i", kind: "svg", src: fixture("icons-stroke.svg"), size: 1, fit: "height", material: { color: "#ff0000" } }, ctx);
    const mats = new Set(meshes(one).map((m) => m.material));
    expect(mats.size).toBe(1);
    one.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(one);
    expect(box.max.y - box.min.y).toBeCloseTo(1, 2);
    const keep = await buildSvg({ id: "l", kind: "svg", src: fixture("logo-multicolor.svg"), material: { preset: "gold" }, keepColors: true }, ctx);
    expect(new Set(meshes(keep).map((m) => m.material)).size).toBeGreaterThan(3);
  });
});
