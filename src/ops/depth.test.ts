import { describe, expect, it } from "vitest";
import { decodePng } from "../../agent/render/png";
import { MemoryFs } from "../core/fs";
import { addAsset, readAssetManifest } from "./assets";
import { DEPTH_MODEL, ensureDepthModel, estimateDepth, planDepthInput, postprocessDepth, type DepthEstimator, type ModelCache } from "./depth";
import { encodePng } from "./pngEncode";
import { createProject } from "./project";
import type { FetchLike } from "./sources";

// A tiny valid PNG of w×h (for image headers): the op only reads the header,
// the fake estimator never decodes it.
async function pngOf(w: number, h: number): Promise<Uint8Array> {
  return encodePng(new Uint8Array(w * h * 4).fill(200), w, h);
}

// Fake model output: a near square (value 10) on a far background (1), plus a ramp.
function fakeDepth(w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inSquare = x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
      d[y * w + x] = inSquare ? 10 : 1 + (y / h) * 0.5;
    }
  return d;
}

const fakeEstimator = (calls: { width: number; height: number; mimeType: string }[] = []): DepthEstimator => async (input) => {
  calls.push({ width: input.width, height: input.height, mimeType: input.mimeType });
  return { depth: fakeDepth(input.width, input.height), width: input.width, height: input.height, srcWidth: 0, srcHeight: 0, backend: "fake" };
};

describe("planDepthInput", () => {
  it("keeps the aspect with the long side at 518, multiples of 14", () => {
    expect(planDepthInput(1600, 900)).toEqual({ width: 518, height: 294, size: 518 });
    expect(planDepthInput(900, 1600)).toEqual({ width: 294, height: 518, size: 518 });
    expect(planDepthInput(500, 500)).toEqual({ width: 518, height: 518, size: 518 });
    const r = planDepthInput(4000, 100, { size: 700 });
    expect(r.width % 14).toBe(0);
    expect(r.height).toBe(14); // never below one patch
    expect(planDepthInput(1000, 750, { size: 520 }).width).toBe(518); // rounded to a multiple of 14
  });
  it("rejects out-of-range sizes with a hint", () => {
    expect(() => planDepthInput(100, 100, { size: 20 })).toThrow(/between/);
    expect(() => planDepthInput(0, 100)).toThrow(/Invalid image size/);
  });
});

describe("postprocessDepth", () => {
  it("normalises near = 1 with robust percentiles and upsamples to the requested size", () => {
    const w = 40, h = 20;
    const raw = fakeDepth(w, h);
    raw[0] = 1e6; // outlier: ignored by the 99th percentile
    raw[1] = NaN;
    const m = postprocessDepth(raw, w, h, { width: 80, height: 40, smooth: 0, dilate: 0, edgeThreshold: 0 });
    expect(m.width).toBe(80);
    expect(m.height).toBe(40);
    expect(m.data.length).toBe(80 * 40 * 4);
    const at = (x: number, y: number) => m.data[(y * 80 + x) * 4];
    expect(at(40, 20)).toBe(255); // the near square is white
    expect(at(10, 4)).toBeLessThan(30); // far background is dark
    expect(at(10, 36)).toBeGreaterThan(at(10, 4) + 8); // the ramp survives
    for (let i = 3; i < m.data.length; i += 4) expect(m.data[i]).toBe(255); // mask off: opaque
    const px = m.data[(20 * 80 + 40) * 4];
    expect(m.data[(20 * 80 + 40) * 4 + 1]).toBe(px); // grey: R = G = B
  });

  it("masks depth discontinuities and keeps smooth regions opaque", () => {
    const w = 40, h = 40;
    const m = postprocessDepth(fakeDepth(w, h), w, h, { smooth: 1, dilate: 0, edgeThreshold: 0.08 });
    const alpha = (x: number, y: number) => m.data[(y * w + x) * 4 + 3];
    expect(alpha(10, 20)).toBe(0); // the square's left edge
    expect(alpha(20, 20)).toBe(255); // inside
    expect(alpha(2, 2)).toBe(255); // background ramp
    expect(m.edgePixels).toBeGreaterThan(0);
  });

  it("dilates the foreground by the given radius", () => {
    const w = 40, h = 40;
    const base = postprocessDepth(fakeDepth(w, h), w, h, { smooth: 0, dilate: 0, edgeThreshold: 0 });
    const grown = postprocessDepth(fakeDepth(w, h), w, h, { smooth: 0, dilate: 2, edgeThreshold: 0 });
    const v = (m: typeof base, x: number) => m.data[(20 * w + x) * 4];
    expect(v(base, 9)).toBeLessThan(50); // left of the square (starts at x = 10)
    expect(v(grown, 8)).toBe(255); // now covered by the foreground
    expect(v(grown, 7)).toBeLessThan(50);
  });

  it("maps a flat output to mid grey and refuses a size mismatch", () => {
    const m = postprocessDepth(new Float32Array(16).fill(3), 4, 4);
    expect(m.data[0]).toBe(128);
    expect(() => postprocessDepth(new Float32Array(10), 4, 4)).toThrow(/expected 4x4/);
  });
});

describe("estimateDepth", () => {
  it("writes assets/depth/<name>-depth.png at the image size with the image's licence", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    await addAsset(fs, { path: "assets/textures/my photo.png", bytes: await pngOf(300, 200), kind: "texture", source: "local", license: "CC-BY-4.0", author: "Ann" });
    const calls: { width: number; height: number; mimeType: string }[] = [];
    const r = await estimateDepth(fs, { image: "assets/textures/my photo.png" }, fakeEstimator(calls));
    expect(calls).toEqual([{ width: 518, height: 350, mimeType: "image/png" }]);
    expect(r.path).toBe("assets/depth/my-photo-depth.png");
    expect([r.width, r.height]).toEqual([300, 200]);
    expect(r.suggestion).toEqual({ kind: "photo", src: "assets/textures/my photo.png", depth: r.path });
    expect(r.model).toMatchObject({ id: "depth-anything-v2-small", license: "Apache-2.0", backend: "fake" });
    const png = decodePng(await fs.readBytes(r.path));
    expect([png.width, png.height, png.channels]).toEqual([300, 200, 2]); // grey + alpha
    expect(png.pixels[(100 * 300 + 150) * 2]).toBe(255); // centre = near
    const entry = (await readAssetManifest(fs)).assets.find((a) => a.path === r.path)!;
    expect(entry).toMatchObject({ kind: "texture", source: "depth-anything-v2-small", license: "CC-BY-4.0", author: "Ann" });
    expect(entry.attribution).toMatch(/Depth Anything V2 Small \(Apache-2\.0\).*Ann/);
  });

  it("caps the map at maxSize, honours out, reads library images and labels unknown licences", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    await fs.writeBytes("assets/raw.png", await pngOf(4000, 2000));
    const r = await estimateDepth(fs, { image: "assets/raw.png", out: "assets/d/raw.png", maxSize: 512 }, fakeEstimator());
    expect([r.path, r.width, r.height, r.license]).toEqual(["assets/d/raw.png", 512, 256, "derived"]);
    const lib = { index: { assets: [{ id: "textures/sky.png", path: "textures/sky.png", kind: "texture" as const, license: "CC0-1.0", tags: [], bytes: 1, description: "" }] }, read: async () => pngOf(64, 32) };
    const l = await estimateDepth(fs, { image: "library:textures/sky.png", library: lib }, fakeEstimator());
    expect([l.path, l.license, l.width]).toEqual(["assets/depth/sky-depth.png", "CC0-1.0", 64]);
  });

  it("explains missing images and bad outputs", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    await fs.writeBytes("assets/textures/a.jpg", new Uint8Array([1, 2, 3]));
    await expect(estimateDepth(fs, { image: "assets/nope.jpg" }, fakeEstimator())).rejects.toMatchObject({ code: "notFound", hint: expect.stringContaining("assets/textures/a.jpg") });
    await expect(estimateDepth(fs, { image: "assets/textures/a.jpg" }, fakeEstimator())).rejects.toMatchObject({ code: "invalid" });
    await expect(estimateDepth(fs, { image: "assets/textures/a.jpg", out: "renders/x.png" }, fakeEstimator())).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/under assets/) });
    await expect(estimateDepth(fs, { image: "library:x.png" }, fakeEstimator())).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("ensureDepthModel", () => {
  function memCache(): ModelCache & { files: Map<string, Uint8Array | string> } {
    const files = new Map<string, Uint8Array | string>();
    return {
      files,
      location: (rel) => `/cache/${rel}`,
      size: async (rel) => {
        const f = files.get(rel);
        return f instanceof Uint8Array ? f.byteLength : null;
      },
      write: async (rel, b) => void files.set(rel, b),
      writeText: async (rel, t) => void files.set(rel, t),
    };
  }
  const small = { ...DEPTH_MODEL, bytes: 8, sha256: "" };
  const bytesFetch = (bytes: Uint8Array, calls: string[] = []): FetchLike => async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => bytes.slice().buffer };
  };

  it("downloads once with a NOTICE, then uses the cache", async () => {
    const cache = memCache();
    const calls: string[] = [];
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("");
    const model = { ...small, sha256: sha };
    const a = await ensureDepthModel(cache, bytesFetch(data, calls), { model });
    expect(a).toMatchObject({ downloaded: true, bytes: 8, path: `/cache/depth-anything-v2-small/${DEPTH_MODEL.revision}/model_quantized.onnx` });
    expect(calls).toEqual([DEPTH_MODEL.url]);
    expect(String(cache.files.get(`depth-anything-v2-small/${DEPTH_MODEL.revision}/NOTICE.txt`))).toMatch(/Apache-2\.0/);
    const b = await ensureDepthModel(cache, bytesFetch(data, calls), { model });
    expect(b.downloaded).toBe(false);
    expect(calls.length).toBe(1);
  });

  it("refuses a size or checksum mismatch and explains offline use", async () => {
    await expect(ensureDepthModel(memCache(), bytesFetch(new Uint8Array(5)), { model: small })).rejects.toMatchObject({ code: "io", message: expect.stringMatching(/5 bytes, expected 8/) });
    await expect(ensureDepthModel(memCache(), bytesFetch(new Uint8Array(8)), { model: { ...small, sha256: "00" } })).rejects.toMatchObject({ code: "io", message: expect.stringMatching(/checksum/) });
    const offline: FetchLike = async () => Promise.reject(new TypeError("fetch failed"));
    await expect(ensureDepthModel(memCache(), offline, { model: small })).rejects.toMatchObject({ code: "io", hint: expect.stringMatching(/depth map by hand/) });
    await expect(ensureDepthModel(memCache(), undefined, { model: small })).rejects.toMatchObject({ code: "io", hint: expect.stringContaining(DEPTH_MODEL.url) });
    const http404: FetchLike = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(ensureDepthModel(memCache(), http404, { model: small })).rejects.toMatchObject({ message: expect.stringMatching(/HTTP 404/) });
  });
});
