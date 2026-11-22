import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { gltfInfo } from "./gltf";
import { optimizeGlbFile } from "./optimize";
import { EXT_MESHOPT, KHR_QUANT, readGlbChunks, unpackGlb, writeGlbChunks, type GltfDoc } from "./optimizeGlb";

// A flat n×n grid (indexed or not) with POSITION / NORMAL / TEXCOORD_0.
function gridGlb(n: number, { indexed = true, draco = false } = {}): Uint8Array {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) {
      pos.push(x / n - 0.5, 0, y / n - 0.5);
      nor.push(0, 1, 0);
      uv.push(x / n, y / n);
    }
  const idx: number[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  let P = pos, N = nor, U = uv;
  if (!indexed) {
    P = idx.flatMap((i) => pos.slice(i * 3, i * 3 + 3));
    N = idx.flatMap((i) => nor.slice(i * 3, i * 3 + 3));
    U = idx.flatMap((i) => uv.slice(i * 2, i * 2 + 2));
  }
  const parts = [new Float32Array(P), new Float32Array(N), new Float32Array(U), ...(indexed ? [new Uint16Array(idx)] : [])].map((a) => new Uint8Array(a.buffer));
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let off = 0;
  for (const p of parts) {
    off = (off + 3) & ~3;
    views.push({ buffer: 0, byteOffset: off, byteLength: p.byteLength });
    off += p.byteLength;
  }
  const bin = new Uint8Array((off + 3) & ~3);
  parts.forEach((p, i) => bin.set(p, views[i].byteOffset));
  const count = P.length / 3;
  const json: GltfDoc = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, ...(indexed ? { indices: 3 } : {}), ...(draco ? { extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: {} } } } : {}) }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min: [-0.5, 0, -0.5], max: [0.5, 0, 0.5] },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count, type: "VEC2" },
      ...(indexed ? [{ bufferView: 3, componentType: 5123, count: idx.length, type: "SCALAR" }] : []),
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.byteLength }],
    ...(draco ? { extensionsUsed: ["KHR_draco_mesh_compression"] } : {}),
  };
  return writeGlbChunks(json, bin);
}

async function loadWithThree(bytes: Uint8Array): Promise<THREE.Mesh> {
  const loader = new GLTFLoader();
  await MeshoptDecoder.ready;
  loader.setMeshoptDecoder(MeshoptDecoder);
  const buf = bytes.slice().buffer;
  const gltf = await loader.parseAsync(buf, "");
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  return mesh!;
}

describe("glb geometry optimisation", () => {
  it("meshopt-compresses geometry the runtime decoder (three's GLTFLoader + MeshoptDecoder) reads back", async () => {
    const src = gridGlb(16);
    const r = await optimizeGlbFile(src, "grid.glb", { quality: 80, format: "keep", compress: true }, undefined);
    expect(r.bytes!.byteLength).toBeLessThan(src.byteLength);
    expect(r.geometry).toMatchObject({ compressed: true, trianglesBefore: 512, trianglesAfter: 512 });
    const { json } = readGlbChunks(r.bytes!);
    expect(json.extensionsRequired).toEqual(expect.arrayContaining([EXT_MESHOPT, KHR_QUANT]));
    expect(json.buffers).toHaveLength(2);
    expect(json.buffers![1].extensions?.[EXT_MESHOPT]).toEqual({ fallback: true });
    expect(json.bufferViews!.every((v) => v.extensions?.[EXT_MESHOPT])).toBe(true);

    const mesh = await loadWithThree(r.bytes!);
    const g = mesh.geometry;
    expect(g.index!.count).toBe(512 * 3);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(-0.5, 4);
    expect(g.boundingBox!.max.z).toBeCloseTo(0.5, 4);
    const n = g.getAttribute("normal");
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeCloseTo(1, 3);
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-4);
    // Every position is a grid point (quantisation error < 1e-4).
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) expect(Math.abs(p.getX(i) * 16 - Math.round(p.getX(i) * 16))).toBeLessThan(1e-3);
  });

  it("re-optimises an already meshopt-compressed file (decode → re-encode)", async () => {
    const once = (await optimizeGlbFile(gridGlb(8), "g.glb", { quality: 80, format: "keep", compress: true }, undefined)).bytes!;
    const model = await unpackGlb(once);
    expect(model.wasCompressed).toBe(true);
    const twice = await optimizeGlbFile(once, "g.glb", { quality: 80, format: "keep", compress: true }, undefined);
    const mesh = await loadWithThree(twice.bytes ?? once);
    expect(mesh.geometry.index!.count).toBe(128 * 3);
  });

  it("welds duplicated vertices of non-indexed meshes", async () => {
    const src = gridGlb(8, { indexed: false });
    const r = await optimizeGlbFile(src, "g.glb", { quality: 80, format: "keep", compress: false }, undefined);
    expect(r.geometry).toMatchObject({ verticesBefore: 384, verticesAfter: 81, welded: 303, compressed: false });
    const mesh = await loadWithThree(r.bytes!);
    expect(mesh.geometry.index!.count).toBe(384);
    expect(mesh.geometry.getAttribute("position").count).toBe(81);
  });

  it("simplifies within the error bound", async () => {
    const r = await optimizeGlbFile(gridGlb(16), "g.glb", { quality: 80, format: "keep", compress: true, simplify: 0.25 }, undefined);
    expect(r.geometry!.simplified).toBe(true);
    expect(r.geometry!.trianglesAfter).toBeLessThanOrEqual(128);
    const info = gltfInfo(readGlbChunks(r.bytes!).json)!;
    expect(info.triangles).toBe(r.geometry!.trianglesAfter);
    const mesh = await loadWithThree(r.bytes!);
    mesh.geometry.computeBoundingBox();
    // Borders are locked: the outline stays.
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(-0.5, 3);
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(0.5, 3);
  });

  it("keeps Draco geometry and says why", async () => {
    const r = await optimizeGlbFile(gridGlb(4, { draco: true }), "d.glb", { quality: 80, format: "keep", compress: true }, undefined);
    expect(r.bytes).toBeUndefined();
    expect(r.notes.join(" ")).toContain("Draco");
  });
});
