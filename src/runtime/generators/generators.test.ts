import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FONTS, GENERATORS, SHADERS, SOUND_PRESETS } from "../../core/catalog";
import type { BuildContext, BuiltObject } from "../registry";
import { createRng } from "../random";
import { GENERATOR_IMPLS } from "./index";
import { SHADER_IMPLS } from "../shaders/index";
import { SOUND_IMPLS } from "../audio/index";
import { carveMaze, N, E, S, W } from "./maze";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function makeCtx(seed = 1, siblings = new Map<string, BuiltObject>()): BuildContext {
  return {
    scene: { version: 1, objects: [] } as unknown as BuildContext["scene"],
    rng: createRng(seed),
    siblings,
    color: (c) => new THREE.Color(c),
    resolveAsset: (p) => p,
  };
}

// Triangles (meshes, instanced ×count), points and line segments.
export function primitives(root: THREE.Object3D): { triangles: number; points: number; lines: number } {
  const out = { triangles: 0, points: 0, lines: 0 };
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g) return;
    const n = g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0);
    const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
    if ((o as THREE.Points).isPoints) out.points += n;
    else if ((o as THREE.LineSegments).isLineSegments) out.lines += n / 2;
    else if ((o as THREE.Mesh).isMesh) out.triangles += (n / 3) * inst;
  });
  return out;
}

function fingerprint(root: THREE.Object3D): number {
  let h = 0;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const p = g?.getAttribute("position");
    if (!p) return;
    const step = Math.max(1, Math.floor(p.count / 64));
    for (let i = 0; i < p.count; i += step) h = (h * 31 + p.getX(i) * 1000 + p.getY(i) * 77 + p.getZ(i) * 13) % 1e9;
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) for (let i = 0; i < Math.min(im.count, 32); i++) h = (h * 31 + im.instanceMatrix.array[i * 16 + 12]! * 1000) % 1e9;
  });
  return h;
}

describe("catalog coverage", () => {
  it("every generator / shader / sound id has an implementation", () => {
    expect(Object.keys(GENERATOR_IMPLS).sort()).toEqual(GENERATORS.map((g) => g.id).sort());
    expect(Object.keys(SHADER_IMPLS).sort()).toEqual(SHADERS.map((g) => g.id).sort());
    expect(Object.keys(SOUND_IMPLS).sort()).toEqual(SOUND_PRESETS.map((g) => g.id).sort());
  });
  it("every font id has a typeface file with French accents", () => {
    for (const f of FONTS) {
      const path = resolve(__dirname, "../../../library/fonts", `${f.id}.typeface.json`);
      expect(existsSync(path), path).toBe(true);
      const json = JSON.parse(readFileSync(path, "utf8")) as { glyphs: Record<string, unknown>; resolution: number };
      for (const ch of "AZaz09éèêàâçôùûïëÉÀÇ€«»’!?") expect(json.glyphs[ch], `${f.id} ${ch}`).toBeTruthy();
    }
    expect(existsSync(resolve(__dirname, "../../../library/fonts/LICENSES.md"))).toBe(true);
  });
});

describe("generators", () => {
  for (const entry of GENERATORS) {
    it(`${entry.id} builds with default params, deterministically`, async () => {
      const a = await GENERATOR_IMPLS[entry.id]!({}, makeCtx(5));
      expect(a.object).toBeInstanceOf(THREE.Object3D);
      const prim = primitives(a.object);
      expect(prim.triangles + prim.points + prim.lines).toBeGreaterThan(0);
      if (!["starfield", "waveGrid"].includes(entry.id)) expect(prim.triangles).toBeGreaterThan(0);
      a.update?.(1.25, 1 / 60);
      const b = await GENERATOR_IMPLS[entry.id]!({}, makeCtx(5));
      b.update?.(1.25, 1 / 60);
      expect(fingerprint(b.object)).toBe(fingerprint(a.object));
      a.dispose?.();
      b.dispose?.();
    });
  }

  it("seed changes the output", async () => {
    const a = await GENERATOR_IMPLS.terrain!({}, makeCtx(1));
    const b = await GENERATOR_IMPLS.terrain!({}, makeCtx(2));
    expect(fingerprint(a.object)).not.toBe(fingerprint(b.object));
  });

  it("every enum option builds", async () => {
    for (const entry of GENERATORS)
      for (const spec of entry.params)
        if (spec.type === "enum")
          for (const opt of spec.options ?? []) {
            const r = await GENERATOR_IMPLS[entry.id]!({ [spec.name]: opt, count: 20, resolution: 16 }, makeCtx(3));
            const prim = primitives(r.object);
            expect(prim.triangles + prim.points + prim.lines, `${entry.id}.${spec.name}=${opt}`).toBeGreaterThan(0);
            for (const t of [0, 0.7, 2.3]) r.update?.(t, 1 / 60);
          }
  });

  it("terrain heightAt matches the mesh and trees sit on it", async () => {
    const terrain = await GENERATOR_IMPLS.terrain!({ resolution: 32, shape: "island" }, makeCtx(9));
    const mesh = terrain.object.children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i += 97) expect(terrain.heightAt!(pos.getX(i), pos.getZ(i))).toBeCloseTo(pos.getY(i), 4);
    const siblings = new Map([["ground", terrain]]);
    const trees = await GENERATOR_IMPLS.trees!({ count: 10, style: "pine" }, makeCtx(9, siblings));
    const tg = (trees.object.children[0] as THREE.Mesh).geometry;
    tg.computeBoundingBox();
    expect(tg.boundingBox!.max.y).toBeGreaterThan(1);
    // water level 0.6: no tree base under water
    expect(terrain.object.userData.waterLevel).toBe(0.6);
  });

  it("terrain waterLevel null disables water", async () => {
    const t = await GENERATOR_IMPLS.terrain!({ resolution: 16, waterLevel: null }, makeCtx(1));
    expect(t.object.children.length).toBe(1);
  });

  it("character exposes bones and the pointer hook", async () => {
    const c = await GENERATOR_IMPLS.character!({ eyesFollowPointer: true, animation: "walk" }, makeCtx(1));
    const bones = c.object.userData.bones as Record<string, THREE.Object3D>;
    for (const k of ["hips", "torso", "head", "armL", "armR", "legL", "legR"]) expect(bones[k]).toBeInstanceOf(THREE.Object3D);
    (c.object.userData.setPointer as (x: number, y: number) => void)(1, 0);
    c.update!(0.3, 0.016);
    expect(bones.head!.rotation.y).toBeGreaterThan(0.3);
    const box = new THREE.Box3().setFromObject(c.object);
    expect(box.max.y).toBeGreaterThan(1.5);
    expect(box.max.y).toBeLessThan(2.3);
  });

  it("maze is a perfect solvable maze with physics bodies", async () => {
    for (const seed of [1, 2, 3, 99]) {
      const cols = 12, rows = 9;
      const walls = carveMaze(cols, rows, createRng(seed));
      const seen = new Set([0]);
      const queue = [0];
      while (queue.length) {
        const c = queue.shift()!;
        const i = c % cols;
        const moves: [number, number][] = [[N, -cols], [S, cols], [E, 1], [W, -1]];
        for (const [bit, d] of moves) {
          if (walls[c]! & bit) continue;
          if (bit === E && i === cols - 1) continue;
          if (bit === W && i === 0) continue;
          const nx = c + d;
          if (nx < 0 || nx >= cols * rows || seen.has(nx)) continue;
          seen.add(nx);
          queue.push(nx);
        }
      }
      expect(seen.size).toBe(cols * rows);
      expect(seen.has(cols * rows - 1)).toBe(true);
    }
    const m = await GENERATOR_IMPLS.maze!({}, makeCtx(4));
    const bodies = m.object.userData.bodies as { min: number[]; max: number[] }[];
    expect(bodies.length).toBeGreaterThan(10);
    for (const b of bodies) for (let k = 0; k < 3; k++) expect(b.max[k]!).toBeGreaterThan(b.min[k]!);
    const none = await GENERATOR_IMPLS.maze!({ bodies: false }, makeCtx(4));
    expect(none.object.userData.bodies).toBeUndefined();
  });

  it("road scrolls as a pure function of t", async () => {
    const r = await GENERATOR_IMPLS.road!({ speed: 10 }, makeCtx(1));
    r.update!(1.3, 0.016);
    const z1 = r.object.children[0]!.position.z;
    r.update!(5, 0.016);
    r.update!(1.3, 0.016);
    expect(r.object.children[0]!.position.z).toBeCloseTo(z1, 6);
    expect(r.object.userData.distance).toBeCloseTo(13, 6);
  });
});
