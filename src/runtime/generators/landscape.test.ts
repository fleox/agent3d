// Terrain composition (basin / valley shapes, edge falloff, absolute snow),
// snow-aware scatter, the road restyling params and the birds flock.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { BuildContext, BuiltObject } from "../registry";
import { createRng } from "../random";
import { GENERATOR_IMPLS } from "./index";
import { birdGeometry } from "./birds";
import { edgeMask, terrainHeightFn } from "./terrain";
import { findGround, scatterPoint } from "./geom";

function makeCtx(seed = 1, siblings = new Map<string, BuiltObject>()): BuildContext {
  return { scene: { version: 1, objects: [] } as unknown as BuildContext["scene"], rng: createRng(seed), siblings, color: (c) => new THREE.Color(c), resolveAsset: (p) => p };
}

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g || !(o as THREE.Mesh).isMesh) return;
    const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
    n += ((g.index ? g.index.count : g.getAttribute("position").count) / 3) * inst;
  });
  return n;
}

const build = (id: string, params: Record<string, unknown>, seed = 1, siblings?: Map<string, BuiltObject>) =>
  GENERATOR_IMPLS[id]!(params, makeCtx(seed, siblings)) as BuiltObject;

describe("terrain shapes", () => {
  it("basin: low floor in the middle, mountains on the ring", () => {
    const h = terrainHeightFn("basin", 100, 1, 5, 12, -40);
    let centre = 0, ring = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      centre += h(Math.cos(a) * 8, Math.sin(a) * 8) / 16;
      ring += h(Math.cos(a) * 36, Math.sin(a) * 36) / 16;
    }
    expect(centre).toBeLessThan(0.06);
    expect(ring).toBeGreaterThan(centre * 4);
  });

  it("valley: flat floor along z, walls on the sides and at the far end", () => {
    const h = terrainHeightFn("valley", 100, 1, 5, 3, 7);
    let floor = 0;
    for (let z = -10; z <= 30; z += 5) floor = Math.max(floor, Math.min(h(-4, z), h(0, z), h(4, z)));
    expect(floor).toBeLessThan(0.08);
    expect((h(-42, 10) + h(42, 10)) / 2).toBeGreaterThan(0.15);
    expect(h(0, -40)).toBeGreaterThan(0.2);
  });

  it("edgeFalloff sinks the border smoothly (mountains by default)", () => {
    expect(edgeMask(0, 0, 100, 0.3)).toBe(1);
    expect(edgeMask(50, 0, 100, 0.3)).toBe(0);
    expect(edgeMask(40, 0, 100, 0.3)).toBeGreaterThan(0);
    expect(edgeMask(40, 0, 100, 0.3)).toBeLessThan(1);
    const t = build("terrain", { shape: "mountains", size: 40, resolution: 32, height: 10, waterLevel: null });
    const edge = [-20, -10, 0, 10, 20].flatMap((v) => [t.heightAt!(v, -20), t.heightAt!(v, 20), t.heightAt!(-20, v), t.heightAt!(20, v)]);
    expect(Math.max(...edge)).toBeLessThanOrEqual(0);
    const cut = build("terrain", { shape: "mountains", size: 40, resolution: 32, height: 10, waterLevel: null, edgeFalloff: 0 });
    const cutEdge = [-20, -10, 0, 10, 20].map((v) => cut.heightAt!(v, -20));
    expect(Math.max(...cutEdge)).toBeGreaterThan(0.5);
  });

  it("snowHeight is absolute; userData.snowLevel sits below it (treeline)", () => {
    const a = build("terrain", { shape: "mountains", height: 20, snowHeight: 12, waterLevel: null });
    const b = build("terrain", { shape: "mountains", height: 40, snowHeight: 12, waterLevel: null });
    expect(a.object.userData.snowLevel).toBeCloseTo(b.object.userData.snowLevel + 40 * 0.06 + 40 * 0.03 - 20 * 0.06 - 20 * 0.03, 5);
    expect(a.object.userData.snowLevel).toBeLessThan(12);
    expect(build("terrain", { shape: "hills" }).object.userData.snowLevel).toBeNull();
  });

  it("waterPlane: false keeps the water level but draws no plane", () => {
    const t = build("terrain", { shape: "basin", waterLevel: 1, waterPlane: false });
    expect(t.object.getObjectByName("terrain-water")).toBeUndefined();
    expect(t.object.userData.waterLevel).toBe(1);
    expect(build("terrain", { shape: "basin", waterLevel: 1 }).object.getObjectByName("terrain-water")).toBeDefined();
  });
});

describe("scatter on a snowy terrain", () => {
  it("trees stay below the snow; rocks may sit on it", () => {
    const terrain = build("terrain", { shape: "mountains", size: 60, height: 30, snowHeight: 10, waterLevel: null }, 3);
    const siblings = new Map([["t", terrain]]);
    const ground = findGround({ ...makeCtx(1, siblings) })!;
    expect(ground.snow).toBeCloseTo(terrain.object.userData.snowLevel as number);
    const rng = makeCtx(9).rng;
    let above = 0;
    for (let k = 0; k < 300; k++) if (scatterPoint(rng, [60, 0, 60], ground).y >= ground.snow!) above++;
    // Rejection sampling: only a few fall back above when 12 tries fail.
    expect(above).toBeLessThan(15);
  });
});

describe("scatter with several terrains", () => {
  it("uses the terrain under the scatterer, whatever the sibling order", () => {
    // landscape-night-galaxy: a far ridge (y −4, z −62) and near hills (y −1.2, z −8); rocks at z −1.
    const ridge = build("terrain", { shape: "mountains", size: 120, height: 20, waterLevel: null }, 2);
    ridge.object.position.set(0, -4, -62);
    const hills = build("terrain", { shape: "hills", size: 60, height: 2.2, waterLevel: null }, 3);
    hills.object.position.set(0, -1.2, -8);
    const placement = { position: [0, -1.2, -1] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
    const expected = hills.heightAt!(0, 7) - 1.2 + 1.2; // hills-local (0, 7) → parent y → rocks-local y
    for (const order of [[["ridge", ridge], ["hills", hills]], [["hills", hills], ["ridge", ridge]]] as [string, BuiltObject][][]) {
      const ground = findGround({ ...makeCtx(1, new Map(order)), placement } as BuildContext)!;
      expect(ground.height(0, 0)).toBeCloseTo(expected, 6);
    }
  });
});

describe("road restyling", () => {
  it("verge: false drops the verges; one curb colour = solid curbs", () => {
    const full = triangles(build("road", {}).object);
    const bare = triangles(build("road", { verge: false, curbColors: ["#e6ff00"] }).object);
    expect(bare).toBeLessThan(full);
    const mesh = build("road", { curbColors: ["#e6ff00"], vergeColor: ["#112233"] }).object.children[0] as THREE.Mesh;
    const col = mesh.geometry.getAttribute("color");
    const colours = new Set<string>();
    for (let k = 0; k < col.count; k++) colours.add(new THREE.Color(col.getX(k), col.getY(k), col.getZ(k)).getHexString());
    expect(colours.has("e6ff00")).toBe(true);
    expect(colours.has("e63946")).toBe(false);
    expect(colours.has("112233")).toBe(true);
  });
});

describe("birds", () => {
  it("one instanced draw call, wings flagged for the flap shader", () => {
    const g = birdGeometry();
    const wing = g.getAttribute("aWing");
    let wings = 0;
    for (let k = 0; k < wing.count; k++) wings += wing.getX(k);
    expect(wings).toBe(6 * 3);
    // Dihedral at rest: a V, not a flat "+" (checked in the shader constants).
    const b = build("birds", { count: 20 });
    const meshes: THREE.InstancedMesh[] = [];
    b.object.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && meshes.push(o as THREE.InstancedMesh));
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.count).toBe(20);
    expect(triangles(b.object)).toBeLessThanOrEqual(20 * 18);
  });

  for (const mode of ["orbit", "path", "drift"]) {
    it(`${mode}: a pure function of t (same seed + t → same matrices) and moving`, () => {
      const params = { count: 6, mode, points: [[0, 0, 0], [10, 2, 0], [10, 0, -10]], formation: mode === "drift" ? "v" : "loose" };
      const a = build("birds", params, 4), b = build("birds", params, 4);
      a.update!(3.2, 0.016);
      b.update!(1, 0.016);
      b.update!(3.2, 0.016);
      const ma = (a.object.children[0] as THREE.InstancedMesh).instanceMatrix.array;
      const mb = (b.object.children[0] as THREE.InstancedMesh).instanceMatrix.array;
      expect(Array.from(ma)).toEqual(Array.from(mb));
      const before = Array.from(ma);
      a.update!(4.2, 0.016);
      expect(Array.from(ma)).not.toEqual(before);
      for (const v of ma) expect(Number.isFinite(v)).toBe(true);
    });
  }
});
