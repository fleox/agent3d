import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import { addAsset, listAssets, parseResolution, readAssetManifest } from "./assets";
import { checkProject } from "./check";
import { gltfBounds, modelBounds } from "./gltf";
import { optimizeAssets, readGlb, writeGlb, type ImageCodec } from "./optimize";
import { createProject } from "./project";
import { patchScene } from "./scene";

// Fake codec: an "image" is [w, h, ...payload]; resizing keeps a payload
// proportional to the pixel count, so smaller sizes give smaller bytes.
function fakeImage(w: number, h: number): Uint8Array {
  const b = new Uint8Array(4 + Math.ceil((w * h) / 64));
  new DataView(b.buffer).setUint16(0, w, true);
  new DataView(b.buffer).setUint16(2, h, true);
  return b;
}
const fakeCodec: ImageCodec = async ({ bytes, mimeType, maxSize, allowJpeg }) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sw = v.getUint16(0, true);
  const sh = v.getUint16(2, true);
  const s = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.round(sw * s);
  const h = Math.round(sh * s);
  return { bytes: fakeImage(w, h), mimeType: mimeType === "image/png" && allowJpeg ? "image/jpeg" : mimeType, width: w, height: h, srcWidth: sw, srcHeight: sh };
};

function glbWith(images: Uint8Array[]): Uint8Array {
  // One triangle (positions accessor) + images, in one BIN buffer.
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]);
  const parts: Uint8Array[] = [new Uint8Array(pos.buffer), ...images];
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let off = 0;
  for (const p of parts) {
    off = (off + 3) & ~3;
    views.push({ buffer: 0, byteOffset: off, byteLength: p.byteLength });
    off += p.byteLength;
  }
  const bin = new Uint8Array((off + 3) & ~3);
  parts.forEach((p, i) => bin.set(p, views[i].byteOffset));
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [0, 0, 5], scale: [2, 2, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 2, 0] }],
    bufferViews: views,
    buffers: [{ byteLength: bin.byteLength }],
    images: images.map((_, i) => ({ bufferView: i + 1, mimeType: "image/png", name: `tex${i}` })),
  };
  return writeGlb(json, bin);
}

describe("assets optimize", () => {
  it("downscales standalone textures in place and refreshes the manifest", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "banner" } });
    await addAsset(fs, { path: "assets/textures/big.jpg", bytes: fakeImage(2048, 2048), source: "local", license: "CC0-1.0" });
    await addAsset(fs, { path: "assets/textures/small.png", bytes: fakeImage(256, 256), source: "local", license: "CC0-1.0" });
    const r = await optimizeAssets(fs, { all: true, maxSize: 512 }, fakeCodec);
    const big = r.files.find((f) => f.path === "assets/textures/big.jpg")!;
    expect(big.changed).toBe(true);
    expect(big.images[0]).toMatchObject({ from: expect.stringContaining("2048x2048 image/jpeg"), to: expect.stringContaining("512x512 image/jpeg"), replaced: true });
    expect(r.files.find((f) => f.path === "assets/textures/small.png")!.changed).toBe(false);
    expect(r.savedKb).toBeGreaterThan(0);
    const entry = (await readAssetManifest(fs)).assets.find((a) => a.path === "assets/textures/big.jpg")!;
    expect(entry.bytes).toBe(await fs.size("assets/textures/big.jpg"));
    expect(entry.bytes).toBe(fakeImage(512, 512).byteLength);
  });

  it("rewrites images inside a .glb (re-packed BIN chunk, opaque PNG → JPEG)", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "banner" } });
    const glb = glbWith([fakeImage(1024, 1024), fakeImage(64, 64)]);
    await addAsset(fs, { path: "assets/models/m.glb", bytes: glb, source: "local", license: "CC0-1.0" });
    const r = await optimizeAssets(fs, { paths: ["assets/models/m.glb"], maxSize: 256 }, fakeCodec);
    expect(r.files[0].changed).toBe(true);
    const out = await fs.readBytes("assets/models/m.glb");
    expect(out.byteLength).toBeLessThan(glb.byteLength);
    const { json, bin } = readGlb(out);
    const doc = json as unknown as { images: { mimeType: string; bufferView: number }[]; bufferViews: { byteOffset: number; byteLength: number }[]; buffers: { byteLength: number }[] };
    expect(doc.images[0].mimeType).toBe("image/jpeg");
    expect(doc.buffers[0].byteLength).toBe(bin!.byteLength);
    // Geometry bytes survive the re-pack.
    const v0 = doc.bufferViews[0];
    expect(Array.from(new Float32Array(bin!.slice(v0.byteOffset, v0.byteOffset + v0.byteLength).buffer))).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 0]);
    // The first image is now 256 px.
    const iv = doc.bufferViews[doc.images[0].bufferView];
    expect(new DataView(bin!.buffer, bin!.byteOffset + iv.byteOffset).getUint16(0, true)).toBe(256);
    for (const v of doc.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });

  it("needs paths or all, and rejects bad sizes", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "banner" } });
    await expect(optimizeAssets(fs, {}, fakeCodec)).rejects.toMatchObject({ code: "invalid" });
    await expect(optimizeAssets(fs, { all: true, maxSize: 4 }, fakeCodec)).rejects.toMatchObject({ code: "invalid" });
    await expect(optimizeAssets(fs, { paths: ["assets/nope.jpg"] }, fakeCodec)).rejects.toMatchObject({ code: "notFound" });
  });

  it("assets list reports sizes changed on disk without writing; check points at assets optimize", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "banner", budgetKb: 10 } as never });
    await addAsset(fs, { path: "assets/textures/a.jpg", bytes: new Uint8Array(100), source: "local", license: "CC0-1.0" });
    await fs.writeBytes("assets/textures/a.jpg", new Uint8Array(50_000));
    const l = await listAssets(fs);
    expect(l.stale).toEqual(["assets/textures/a.jpg"]);
    expect(l.assets.find((a) => a.path === "assets/textures/a.jpg")!.bytes).toBe(50_000);
    expect((await readAssetManifest(fs)).assets[0].bytes).toBe(100);
    await patchScene(fs, [{ op: "addObject", object: { id: "p", kind: "mesh", geometry: { type: "plane" }, material: { map: "assets/textures/a.jpg" } } as never }]);
    const report = await checkProject(fs);
    const budget = report.issues.find((i) => i.code === "budget")!;
    expect(budget.hint).toContain("assets optimize");
    expect(budget.hint).toContain("assets/textures/a.jpg");
  });
});

describe("parseResolution", () => {
  it("maps sizes below the 1k minimum to 1k + a downscale", () => {
    expect(parseResolution("512")).toEqual({ resolution: "1k", maxSize: 512 });
    expect(parseResolution("0.5k")).toEqual({ resolution: "1k", maxSize: 512 });
    expect(parseResolution("256px")).toEqual({ resolution: "1k", maxSize: 256 });
    expect(parseResolution("2k")).toEqual({ resolution: "2k" });
    expect(parseResolution("2048")).toEqual({ resolution: "2k" });
    expect(parseResolution("1K-JPG")).toEqual({ resolution: "1k-jpg" });
    expect(parseResolution(undefined)).toEqual({});
  });
});

describe("model bounds", () => {
  it("applies node transforms to the accessor min / max", () => {
    const b = modelBounds("m.glb", glbWith([]))!;
    expect(b.size).toEqual([2, 4, 0]);
    expect(b.min).toEqual([0, 0, 5]);
    expect(b.upAxis).toBe("y");
  });

  it("flags models much deeper than tall as maybe Z-up", () => {
    const json = { scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ min: [-0.3, -0.2, 0], max: [0.3, 0.2, 1.8] }] };
    expect(gltfBounds(json)).toMatchObject({ upAxis: "z?", hint: expect.stringContaining("--isolate") });
  });
});
