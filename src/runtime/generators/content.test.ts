// Tests of the character overhaul, the new generators (floatingIsland, globe,
// crystals, galaxy, bars3d, abstractShapes) and the shared water shading.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GENERATORS } from "../../core/catalog";
import { validateScene } from "../../core/validate";
import type { BuildContext, BuiltObject } from "../registry";
import { createRng } from "../random";
import { GENERATOR_IMPLS } from "./index";
import { isLand, latLonToVec } from "./globe";
import { readBarData } from "./bars3d";
import { keys } from "./character/animate";
import { EXPRESSIONS } from "./character/face";

function ctx(seed = 1, siblings = new Map<string, BuiltObject>()): BuildContext {
  return { scene: { version: 1, objects: [] } as unknown as BuildContext["scene"], rng: createRng(seed), siblings, color: (c) => new THREE.Color(c), resolveAsset: (p) => p };
}

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += ((g.index ? g.index.count : g.getAttribute("position").count) / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
  });
  return n;
}

// World-space bounds of the skinned character (skinning applied).
function bounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
}

const STYLES = (GENERATORS.find((g) => g.id === "character")!.params.find((p) => p.name === "style")!.options ?? []) as string[];
const ANIMS = (GENERATORS.find((g) => g.id === "character")!.params.find((p) => p.name === "animation")!.options ?? []) as string[];

describe("character", () => {
  it("every style builds at the requested height, feet on the ground", async () => {
    for (const style of STYLES) {
      const c = await GENERATOR_IMPLS.character!({ style, animation: "none", height: 2 }, ctx());
      c.update!(0, 0);
      const b = bounds(c.object);
      expect(b.min.y, style).toBeGreaterThan(-0.02);
      expect(b.max.y, style).toBeGreaterThan(1.8);
      expect(b.max.y, style).toBeLessThan(2.25);
    }
  });

  it("no animation pushes the feet (or the pelvis) below the ground", async () => {
    for (const style of ["humanoid", "robot", "cat", "bird"]) {
      for (const animation of ANIMS) {
        const c = await GENERATOR_IMPLS.character!({ style, animation }, ctx());
        for (const t of [0, 0.25, 0.5, 0.9, 1.3]) {
          c.update!(t, 1 / 60);
          expect(bounds(c.object).min.y, `${style} ${animation} t=${t}`).toBeGreaterThan(-0.03);
        }
      }
    }
  });

  it("is deterministic (pure function of t)", async () => {
    const a = await GENERATOR_IMPLS.character!({ style: "fox", animation: "dance" }, ctx(3));
    const b = await GENERATOR_IMPLS.character!({ style: "fox", animation: "dance" }, ctx(9));
    a.update!(5, 1 / 60);
    a.update!(1.7, 1 / 60);
    b.update!(1.7, 1 / 60);
    expect(bounds(a.object).max.toArray()).toEqual(bounds(b.object).max.toArray());
  });

  it("expressions switch mouth shapes and eyes through bone scales", async () => {
    const mouths = (o: THREE.Object3D) => {
      const out: Record<string, number> = {};
      o.traverse((x) => {
        if (x.name.startsWith("mouth-")) out[x.name.slice(6)] = x.scale.x;
      });
      return out;
    };
    for (const expression of EXPRESSIONS) {
      const c = await GENERATOR_IMPLS.character!({ expression, animation: "none" }, ctx());
      c.update!(0, 0);
      const m = mouths(c.object);
      expect(Object.values(m).filter((s) => s > 0).length, expression).toBe(1);
    }
    const wink = await GENERATOR_IMPLS.character!({ expression: "wink", animation: "none" }, ctx());
    wink.update!(0, 0);
    const bones = wink.object.userData.bones as Record<string, THREE.Object3D>;
    let closedR = 0;
    wink.object.traverse((x) => {
      if (x.name === "eyeClosedR") closedR = x.scale.x;
    });
    expect(closedR).toBe(1);
    expect(bones.head).toBeInstanceOf(THREE.Object3D);
  });

  it("accessories, hair and outfits add geometry; lowpoly is lighter", async () => {
    const base = await GENERATOR_IMPLS.character!({ hairStyle: "none" }, ctx());
    const dressed = await GENERATOR_IMPLS.character!({ hairStyle: "curly", outfit: "hoodie", accessories: ["glasses", "backpack", "headphones"] }, ctx());
    expect(triangles(dressed.object)).toBeGreaterThan(triangles(base.object));
    const low = await GENERATOR_IMPLS.character!({ shading: "lowpoly" }, ctx());
    const smooth = await GENERATOR_IMPLS.character!({}, ctx());
    expect(triangles(low.object)).toBeLessThan(triangles(smooth.object) / 3);
    expect(triangles(smooth.object)).toBeLessThan(25000);
  });

  it("validation rejects unknown accessories", () => {
    const scene = { version: 1, objects: [{ id: "c", kind: "generator", generator: "character", params: { accessories: ["glasses", "jetpack"] } }] };
    const issues = validateScene(scene);
    expect(issues.some((i) => i.severity === "error" && i.path.includes("accessories[1]"))).toBe(true);
  });

  it("keys() interpolates looping eased keyframes", () => {
    const f = [[0, 0], [0.5, 1]] as const;
    expect(keys(0, f)).toBe(0);
    expect(keys(0.5, f)).toBe(1);
    expect(keys(0.25, f)).toBeCloseTo(0.5, 5);
    expect(keys(0.75, f)).toBeCloseTo(0.5, 5); // wraps back to the first key
  });
});

describe("new generators", () => {
  it("floatingIsland plants trees on its top and bobs", async () => {
    const isl = await GENERATOR_IMPLS.floatingIsland!({ trees: 5, grass: 50, flowers: 10 }, ctx(4));
    expect(triangles(isl.object)).toBeGreaterThan(3000);
    const h0 = isl.heightAt!(0, 0);
    expect(h0).toBeGreaterThan(0);
    isl.update!(1.2, 1 / 60);
    expect(isl.heightAt!(0, 0)).not.toBeCloseTo(h0, 6);
    // Nothing below the tip.
    const b = new THREE.Box3().setFromObject(isl.object);
    expect(b.min.y).toBeGreaterThan(-3.6 * 1.2 - 0.5);
  });

  it("globe land mask knows the continents", () => {
    expect(isLand(48.85, 2.35)).toBe(true); // Paris
    expect(isLand(40.7, -100)).toBe(true); // USA
    expect(isLand(-25, 134)).toBe(true); // Australia
    expect(isLand(0, -30)).toBe(false); // Atlantic
    expect(isLand(-10, 80)).toBe(false); // Indian Ocean
    const v = latLonToVec(0, 0, 2);
    expect(v.z).toBeCloseTo(2);
    expect(latLonToVec(90, 0).y).toBeCloseTo(1);
  });

  it("globe builds arcs and markers from lat/lon data", async () => {
    const g = await GENERATOR_IMPLS.globe!({ dots: 2000, points: [[48.85, 2.35]], arcs: [[[40.7, -74], [51.5, -0.1]], { from: [35.7, 139.7], to: [-33.9, 151.2] }] }, ctx());
    const names: string[] = [];
    g.object.traverse((o) => names.push(o.name));
    expect(names).toContain("globe-arcs");
    expect(names).toContain("globe-markers");
    let markers = 0;
    g.object.traverse((o) => {
      if (o.name === "globe-markers") markers = (o as THREE.InstancedMesh).count;
    });
    expect(markers).toBe(5);
  });

  it("bars3d reads rows / grids and grows from zero", async () => {
    expect(readBarData([1, 2, 3])).toEqual([[1, 2, 3]]);
    expect(readBarData([[1], [2, { value: 4 }]])).toEqual([[1], [2, 4]]);
    const b = await GENERATOR_IMPLS.bars3d!({ data: [1, 2, 4], maxHeight: 2 }, ctx());
    const bars = b.object.children[0] as THREE.InstancedMesh;
    const h = (t: number) => {
      b.update!(t, 1 / 60);
      const m = new THREE.Matrix4();
      bars.getMatrixAt(2, m);
      return new THREE.Vector3().setFromMatrixScale(m).y;
    };
    expect(h(0)).toBeLessThan(0.01);
    expect(h(10)).toBeCloseTo(2, 5);
  });

  it("crystals / galaxy / abstractShapes build deterministically", async () => {
    for (const id of ["crystals", "galaxy", "abstractShapes"]) {
      const a = await GENERATOR_IMPLS[id]!({ count: 30 }, ctx(2));
      const b = await GENERATOR_IMPLS[id]!({ count: 30 }, ctx(2));
      a.update!(1.5, 1 / 60);
      b.update!(1.5, 1 / 60);
      expect(new THREE.Box3().setFromObject(a.object).max.toArray()).toEqual(new THREE.Box3().setFromObject(b.object).max.toArray());
    }
  });

  it("abstractShapes honours the shapes subset", async () => {
    const s = await GENERATOR_IMPLS.abstractShapes!({ count: 10, shapes: ["torus", "sphere"] }, ctx());
    const kinds = s.object.children.map((c) => c.name).sort();
    expect(kinds).toEqual(["shapes-sphere", "shapes-torus"]);
  });
});

describe("water", () => {
  it("bakes the depth below from a sibling terrain (shore foam)", async () => {
    const terrain = await GENERATOR_IMPLS.terrain!({ resolution: 24, shape: "island", waterLevel: null }, ctx(9));
    const w = await GENERATOR_IMPLS.water!({ size: 30 }, ctx(9, new Map([["t", terrain]])));
    w.object.position.y = 0.8;
    w.update!(0, 0);
    const d = ((w.object.children[0] as THREE.Mesh).geometry.getAttribute("aDepth") as THREE.BufferAttribute).array as Float32Array;
    expect(Math.min(...d)).toBeLessThan(0); // terrain above the water somewhere (island)
    expect(Math.max(...d)).toBeGreaterThan(0);
  });

  it("terrain water carries depth too", async () => {
    const t = await GENERATOR_IMPLS.terrain!({ resolution: 24, shape: "island", waterLevel: 0.6 }, ctx(9));
    const water = t.object.children[1] as THREE.Mesh;
    expect(water.geometry.getAttribute("aDepth")).toBeTruthy();
  });
});
