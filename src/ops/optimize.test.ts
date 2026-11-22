import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import { addAsset, listAssets, parseResolution, readAssetManifest } from "./assets";
import { checkProject } from "./check";
import { gltfBounds, modelBounds } from "./gltf";
import { optimizeAssets, planOptimize, readGlb, writeGlb, type ImageCodec } from "./optimize";
import { imageHeader, planTextureSizes, sceneViewport } from "./optimizeSizing";
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
const fakeCodec: ImageCodec = async ({ bytes, mimeType, maxSize, allowJpeg, format = "keep" }) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sw = v.getUint16(0, true);
  const sh = v.getUint16(2, true);
  const s = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.round(sw * s);
  const h = Math.round(sh * s);
  const out = format === "auto" || format === "webp" ? "image/webp" : format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : mimeType === "image/png" && allowJpeg ? "image/jpeg" : mimeType;
  return { bytes: fakeImage(w, h), mimeType: out, width: w, height: h, srcWidth: sw, srcHeight: sh };
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
    const r = await optimizeAssets(fs, { all: true, maxSize: 512, format: "keep" }, fakeCodec);
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
    const r = await optimizeAssets(fs, { paths: ["assets/models/m.glb"], maxSize: 256, format: "keep", compress: false }, fakeCodec);
    expect(r.files[0].changed).toBe(true);
    const out = await fs.readBytes("assets/models/m.glb");
    expect(out.byteLength).toBeLessThan(glb.byteLength);
    const { json, bin } = readGlb(out);
    const doc = json as unknown as { images: { mimeType: string; bufferView: number }[]; accessors: { bufferView: number }[]; bufferViews: { byteOffset: number; byteLength: number }[]; buffers: { byteLength: number }[] };
    expect(doc.images[0].mimeType).toBe("image/jpeg");
    expect(doc.buffers[0].byteLength).toBe(bin!.byteLength);
    // Geometry bytes survive the re-pack.
    const v0 = doc.bufferViews[doc.accessors[0].bufferView];
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

describe("smart texture sizing", () => {
  const scene = (kind: string, objects: unknown[], extra: Record<string, unknown> = {}) =>
    ({ version: 1, id: "s", target: { kind, aspect: kind === "banner" ? "4:1" : "16:9" }, camera: { type: "perspective", fov: 40, position: [0, 0, 6] }, environment: { background: "#000" }, lights: [], objects, ...extra }) as never;
  const box = (id: string, size: number, z: number, material: Record<string, unknown>) => ({ id, kind: "mesh", geometry: { type: "box", width: size, height: size, depth: size }, position: [0, 0, z], material });

  it("sizes per use: close hero objects keep detail, far / small ones shrink, roles and repeat count", async () => {
    const fs = new MemoryFs();
    const plan = await planTextureSizes(fs, scene("hero", [box("near", 3, 0, { map: "a.jpg", normalMap: "n.jpg", roughnessMap: "r.jpg" }), box("far", 0.5, -20, { map: "b.jpg" }), box("floor", 4, 0, { map: "c.jpg", repeat: [8, 8] })]));
    expect(plan.files.get("a.jpg")!.maxSize).toBe(2048);
    expect(plan.files.get("a.jpg")!.reason).toContain('map of "near"');
    expect(plan.files.get("n.jpg")!.maxSize).toBeLessThanOrEqual(2048);
    expect(plan.files.get("r.jpg")!.maxSize).toBeLessThan(2048);
    expect(plan.files.get("r.jpg")!.maxSize).toBeLessThanOrEqual(plan.files.get("n.jpg")!.maxSize);
    expect(plan.files.get("b.jpg")!.maxSize).toBe(512); // hero floor for colour maps
    expect(plan.files.get("c.jpg")!.reason).toContain("repeat 8");
    expect(plan.files.get("c.jpg")!.maxSize).toBeLessThanOrEqual(512);
  });

  it("cuts more on games and cards, and the largest use wins", async () => {
    const fs = new MemoryFs();
    const game = await planTextureSizes(fs, scene("game", [box("coin", 0.5, -10, { map: "coin.png" })]));
    expect(game.files.get("coin.png")!.maxSize).toBe(256);
    const card = await planTextureSizes(fs, scene("card", [box("p", 3, 0, { map: "p.jpg" })]));
    expect(card.files.get("p.jpg")!.maxSize).toBeLessThanOrEqual(1024);
    const both = await planTextureSizes(fs, scene("hero", [box("a", 0.3, -15, { map: "t.jpg" }), box("b", 3, 0, { map: "t.jpg" })]));
    expect(both.files.get("t.jpg")!.maxSize).toBe(2048);
    expect(both.files.get("t.jpg")!.uses).toHaveLength(2);
    expect(both.files.get("t.jpg")!.reason).toContain("largest of 2 uses");
  });

  it("orbit zoom and timeline camera moves bring objects closer", async () => {
    const fs = new MemoryFs();
    const fixed = await planTextureSizes(fs, scene("hero", [box("x", 0.5, -6, { map: "x.jpg" })]));
    const orbit = await planTextureSizes(fs, scene("hero", [box("x", 0.5, -6, { map: "x.jpg" })], { camera: { type: "perspective", fov: 40, position: [0, 0, 6], controls: "orbit", orbitLimits: { minDistance: 1 } } }));
    expect(orbit.files.get("x.jpg")!.maxSize).toBeGreaterThan(fixed.files.get("x.jpg")!.maxSize);
    expect(orbit.files.get("x.jpg")!.reason).toContain("orbit zoom");
    const dolly = await planTextureSizes(fs, scene("hero", [box("x", 0.5, -6, { map: "x.jpg" })], { timeline: { duration: 4, tracks: [{ target: "camera.position", keys: [[0, [0, 0, 6]], [4, [0, 0, -5]]] }] } }));
    expect(dolly.files.get("x.jpg")!.maxSize).toBeGreaterThan(fixed.files.get("x.jpg")!.maxSize);
  });

  it("equirect backgrounds use the horizontal field of view (up to 4096), models get per-role sizes", async () => {
    const fs = new MemoryFs();
    const plan = await planTextureSizes(fs, scene("banner", [{ id: "m", kind: "model", src: "assets/models/m.glb", fit: 1, position: [0, 0, 0] }], { environment: { background: { hdri: "assets/hdri/sky.jpg" } } }));
    expect(plan.files.get("assets/hdri/sky.jpg")!.maxSize).toBe(4096);
    expect(plan.files.get("assets/hdri/sky.jpg")!.uses[0].role).toBe("background");
    const roles = plan.modelRoles.get("assets/models/m.glb")!;
    expect(roles.color!.maxSize).toBeGreaterThanOrEqual(roles.data!.maxSize);
    expect(sceneViewport(scene("banner", []))).toMatchObject({ width: 2880, height: 720, kind: "banner" });
  });

  it("reads image sizes from headers", () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 2048);
    new DataView(png.buffer).setUint32(20, 1024);
    png[25] = 6;
    expect(imageHeader(png)).toEqual({ width: 2048, height: 1024, mimeType: "image/png", alpha: "maybe" });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 8, 0x01, 0x00, 0x02, 0x00, 3, 0, 0, 0, 0]);
    expect(imageHeader(jpg)).toMatchObject({ width: 512, height: 256, mimeType: "image/jpeg" });
    expect(imageHeader(new Uint8Array(10))).toBeNull();
  });
});

describe("assets optimize: formats, plan, dry run", () => {
  async function project() {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "hero" } });
    await addAsset(fs, { path: "assets/textures/wood.jpg", bytes: fakeImage(2048, 2048), source: "local", license: "CC0-1.0" });
    await patchScene(fs, [{ op: "addObject", object: { id: "crate", kind: "mesh", geometry: { type: "box" }, position: [0, 0, -30], material: { map: "assets/textures/wood.jpg" } } as never }]);
    return fs;
  }

  it("plans smart sizes without a codec and writes nothing on dry runs", async () => {
    const fs = await project();
    const plan = await planOptimize(fs, { all: true });
    const e = plan.entries.find((x) => x.path === "assets/textures/wood.jpg")!;
    expect(e).toMatchObject({ maxSize: 512, resize: true, format: "webp" }); // fake image: no readable header
    expect(e.reason).toContain('map of "crate"');
    const r = await optimizeAssets(fs, { all: true, dryRun: true }, fakeCodec);
    expect(r).toMatchObject({ dryRun: true, maxSize: "auto", format: "auto" });
    expect(r.files[0]).toMatchObject({ changed: true, newPath: "assets/textures/wood.webp", maxSize: 512 });
    expect(await fs.exists("assets/textures/wood.jpg")).toBe(true);
    expect(await fs.exists("assets/textures/wood.webp")).toBe(false);
  });

  it("WebP renames standalone files, rewrites scene references and the manifest", async () => {
    const fs = await project();
    const r = await optimizeAssets(fs, { all: true }, fakeCodec);
    expect(r.renamed).toEqual([{ from: "assets/textures/wood.jpg", to: "assets/textures/wood.webp" }]);
    expect(await fs.exists("assets/textures/wood.jpg")).toBe(false);
    expect(await fs.exists("assets/textures/wood.webp")).toBe(true);
    const scene = JSON.parse(await fs.readText("scene.json"));
    expect(scene.objects.find((o: { id: string }) => o.id === "crate").material.map).toBe("assets/textures/wood.webp");
    const manifest = await readAssetManifest(fs);
    expect(manifest.assets.map((a) => a.path)).toEqual(["assets/textures/wood.webp"]);
    expect(manifest.assets[0].bytes).toBe(fakeImage(512, 512).byteLength);
  });

  it("keeps the format when a script names the file", async () => {
    const fs = await project();
    await fs.writeText("scripts/game.js", 'export default (api) => { api.data.tex = "assets/textures/wood.jpg"; };');
    const r = await optimizeAssets(fs, { all: true }, fakeCodec);
    expect(r.files[0].newPath).toBeUndefined();
    expect(r.files[0].note).toContain("scripts/game.js");
    expect(r.files[0].images[0].to).toContain("image/jpeg");
  });

  it("converts images inside a .glb to WebP (EXT_texture_webp, required) and sizes them by role", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "game" } });
    const glb = readGlb(glbWith([fakeImage(2048, 2048), fakeImage(2048, 2048)]));
    const json = glb.json as Record<string, unknown>;
    json.textures = [{ source: 0 }, { source: 1 }];
    json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } } }];
    (json.meshes as { primitives: { material?: number }[] }[])[0].primitives[0].material = 0;
    await addAsset(fs, { path: "assets/models/m.glb", bytes: writeGlb(json, glb.bin), source: "local", license: "CC0-1.0" });
    await patchScene(fs, [{ op: "addObject", object: { id: "m", kind: "model", src: "assets/models/m.glb", fit: 1, position: [0, 0, -8] } as never }]);
    const r = await optimizeAssets(fs, { all: true }, fakeCodec);
    const f = r.files[0];
    expect(f.changed).toBe(true);
    const [color, data] = f.images;
    expect(color).toMatchObject({ role: "color", replaced: true });
    expect(data.role).toBe("data");
    expect(data.maxSize!).toBeLessThanOrEqual(color.maxSize!);
    const out = readGlb(await fs.readBytes("assets/models/m.glb")).json as { extensionsRequired: string[]; textures: { source?: number; extensions?: Record<string, { source: number }> }[]; images: { mimeType: string }[] };
    expect(out.extensionsRequired).toContain("EXT_texture_webp");
    expect(out.textures[0]).toEqual({ extensions: { EXT_texture_webp: { source: 0 } } });
    expect(out.images.every((i) => i.mimeType === "image/webp")).toBe(true);
  });

  it("does geometry without a codec (textures need Chrome) and validates options", async () => {
    const fs = await project();
    const r = await optimizeAssets(fs, { all: true });
    expect(r.skipped[0].reason).toContain("headless Chrome");
    await expect(optimizeAssets(fs, { all: true, format: "gif" as never })).rejects.toMatchObject({ code: "invalid" });
    await expect(optimizeAssets(fs, { all: true, simplify: 2 })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("check suggests assets optimize", () => {
  it("reports textures much larger than needed and uncompressed models", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "card" } });
    const png = new Uint8Array(4000);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 2048);
    new DataView(png.buffer).setUint32(20, 2048);
    await addAsset(fs, { path: "assets/textures/big.png", bytes: png, source: "local", license: "CC0-1.0" });
    const big = glbWith([new Uint8Array(60_000)]);
    await addAsset(fs, { path: "assets/models/m.glb", bytes: big, source: "local", license: "CC0-1.0" });
    await patchScene(fs, [{ op: "addObject", object: { id: "p", kind: "mesh", geometry: { type: "plane" }, position: [0, 0, -10], material: { map: "assets/textures/big.png" } } as never }]);
    const report = await checkProject(fs);
    const info = report.issues.find((i) => i.code === "optimizable")!;
    expect(info.severity).toBe("info");
    expect(info.message).toContain("assets/textures/big.png (2048 px");
    expect(info.message).toContain("assets/models/m.glb");
    expect(info.hint).toContain("agent3d assets optimize --all");
  });
});

describe("check budget hint for HDRIs", () => {
  it("does not send heavy HDRIs to assets optimize (it never shrinks .hdr)", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "banner", budgetKb: 10 } as never });
    await addAsset(fs, { path: "assets/hdri/big.hdr", bytes: new Uint8Array(80_000), source: "local", license: "CC0-1.0" });
    await patchScene(fs, [{ op: "set", path: "environment.lighting", value: { hdri: "assets/hdri/big.hdr" } }]);
    const budget = (await checkProject(fs)).issues.find((i) => i.code === "budget")!;
    expect(budget.hint).toContain("assets/hdri/big.hdr");
    expect(budget.hint).toContain("never shrinks .hdr");
    expect(budget.hint).toContain('"studio"');
    expect(budget.hint).not.toContain("assets optimize --all");
  });
  it("counts library HDRIs among the heaviest files", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "t", target: { kind: "banner", budgetKb: 10 } as never });
    await patchScene(fs, [{ op: "set", path: "environment.lighting", value: { hdri: "library:hdri/studio.hdr" } }]);
    const library = { version: 1, assets: [{ id: "hdri/studio.hdr", path: "hdri/studio.hdr", kind: "hdri", license: "CC0-1.0", bytes: 900_000, tags: [], description: "" }] };
    const budget = (await checkProject(fs, { library: library as never })).issues.find((i) => i.code === "budget")!;
    expect(budget.hint).toContain("library:hdri/studio.hdr");
    expect(budget.hint).toContain("never shrinks .hdr");
  });
});
