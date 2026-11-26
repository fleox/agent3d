import { deflateSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import { buildPlate, checkPlateRequest, generatePlate, plateHoleWidth, type PixelCodec, type RgbaImage } from "./plate";
import { decodePng } from "./pngDecode";
import { encodePng } from "./pngEncode";

const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(d));
const inflate = (d: Uint8Array) => new Uint8Array(inflateRawSync(d));

// A near red square (depth 0.9) over a far horizontal blue→green gradient
// (depth 0.2); the depth map has the usual alpha-0 band on the edge.
function scene(w = 96, h = 64, sq = { x0: 36, y0: 20, x1: 60, y1: 44 }, cut = true): { photo: RgbaImage; depth: RgbaImage } {
  const photo = new Uint8Array(w * h * 4);
  const depth = new Uint8Array(w * h * 4);
  const inSq = (x: number, y: number) => x >= sq.x0 && x < sq.x1 && y >= sq.y0 && y < sq.y1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const near = inSq(x, y);
      photo.set(near ? [230, 20, 20, 255] : [10, Math.round((x / (w - 1)) * 200), Math.round(220 - (x / (w - 1)) * 200), 255], o);
      const g = near ? 230 : 51;
      let edge = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inSq(x + dx, y + dy) !== near) edge = true;
      depth.set([g, g, g, cut && edge ? 0 : 255], o);
    }
  return { photo: { data: photo, width: w, height: h }, depth: { data: depth, width: w, height: h } };
}

const isRed = (d: Uint8Array, o: number) => d[o] > 100 && d[o + 1] < 60 && d[o + 2] < 60;

describe("buildPlate", () => {
  it("fills the near side of the edge with background colours only, never the foreground", () => {
    const { photo, depth } = scene();
    const plate = buildPlate(photo, depth, { width: 12 });
    expect(plate.holePixels).toBeGreaterThan(0);
    expect(plate.unfilled).toBe(0);
    const w = photo.width;
    let red = 0, filled = 0;
    for (let y = 0; y < photo.height; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        // the square's border band (≈ hole width) must now look like background
        const inBand = x >= 36 && x < 60 && y >= 20 && y < 44 && (x < 42 || x >= 54 || y < 26 || y >= 38);
        if (!inBand) continue;
        filled++;
        if (isRed(plate.color.data, o)) red++;
        // background: blue + green ≈ 220, no red
        expect(plate.color.data[o]).toBeLessThan(40);
        expect(plate.color.data[o + 1] + plate.color.data[o + 2]).toBeGreaterThan(180);
        // plate depth: the far depth continues (0.2 = 51)
        expect(Math.abs(plate.depth.data[o] - 51)).toBeLessThan(10);
      }
    expect(filled).toBeGreaterThan(100);
    expect(red).toBe(0);
  });

  it("keeps the gradient: filled texels take the colour of the background on their side", () => {
    const { photo, depth } = scene();
    const plate = buildPlate(photo, depth, { width: 12 });
    const w = photo.width;
    // left border of the square (x 37) vs right border (x 58), mid height: green grows with x
    const g = (x: number) => plate.color.data[(32 * w + x) * 4 + 1];
    expect(g(37)).toBeLessThan(g(58));
    expect(Math.abs(g(37) - Math.round((36 / 95) * 200))).toBeLessThan(25);
  });

  it("leaves the foreground interior and the far background untouched", () => {
    const { photo, depth } = scene();
    const plate = buildPlate(photo, depth, { width: 6 });
    const w = photo.width;
    const at = (x: number, y: number) => (y * w + x) * 4;
    expect(Array.from(plate.color.data.subarray(at(48, 32), at(48, 32) + 3))).toEqual([230, 20, 20]); // centre of the square
    expect(plate.depth.data[at(48, 32)]).toBe(230);
    expect(Array.from(plate.color.data.subarray(at(5, 5), at(5, 5) + 3))).toEqual(Array.from(photo.data.subarray(at(5, 5), at(5, 5) + 3)));
    expect(plate.depth.data[at(5, 5)]).toBe(51);
  });

  it("works without an alpha mask and when the depth map is smaller than the photo", () => {
    const big = scene(96, 64, undefined, false);
    const small = scene(48, 32, { x0: 18, y0: 10, x1: 30, y1: 22 }, false);
    const plate = buildPlate(big.photo, small.depth, { width: 6 });
    expect(plate.holePixels).toBeGreaterThan(100);
    const w = 96;
    expect(isRed(plate.color.data, (21 * w + 37) * 4)).toBe(false);
    expect(isRed(plate.color.data, (32 * w + 48) * 4)).toBe(true);
  });

  it("does nothing on a smooth depth ramp (no occluding edge)", () => {
    const w = 64, h = 32;
    const photo = new Uint8Array(w * h * 4).fill(128);
    const depth = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(((i % w) / (w - 1)) * 255);
      depth.set([v, v, v, 255], i * 4);
    }
    const plate = buildPlate({ data: photo, width: w, height: h }, { data: depth, width: w, height: h });
    expect(plate.holePixels).toBe(0);
  });

  it("is fast enough for a 1600 px photo", () => {
    const { photo, depth } = scene(1600, 900, { x0: 500, y0: 200, x1: 1100, y1: 800 });
    const t0 = Date.now();
    const plate = buildPlate(photo, depth);
    const ms = Date.now() - t0;
    expect(plate.holePixels).toBeGreaterThan(10_000);
    expect(ms).toBeLessThan(4000);
  });

  it("hole width follows the parallax amount", () => {
    expect(plateHoleWidth(1024, 576, 1)).toBe(Math.ceil(576 * 0.06 * Math.SQRT2 * 1.15));
    expect(plateHoleWidth(1024, 576, 0.5)).toBeLessThan(plateHoleWidth(1024, 576, 1));
  });
});

describe("generatePlate", () => {
  async function project() {
    const fs = new MemoryFs();
    const { photo, depth } = scene();
    await fs.writeBytes("assets/textures/photo.png", await encodePng(photo.data, photo.width, photo.height, { deflate }));
    await fs.writeBytes("assets/depth/photo-depth.png", await encodePng(depth.data, depth.width, depth.height, { deflate }));
    await fs.writeText("assets/manifest.json", JSON.stringify({ assets: [{ path: "assets/textures/photo.png", kind: "texture", source: "local", license: "CC0-1.0", bytes: 1 }] }));
    return { fs, photo };
  }
  const noCodec: PixelCodec = { decode: async () => Promise.reject(new Error("no decoder")) };

  it("writes the plate PNG + its depth, registered with the photo's licence", async () => {
    const { fs } = await project();
    const r = await generatePlate(fs, { image: "assets/textures/photo.png", deflate, inflate, width: 12 }, noCodec);
    expect(r.path).toBe("assets/depth/photo-plate.png");
    expect(r.depthPath).toBe("assets/depth/photo-plate-depth.png");
    expect(r.depth).toBe("assets/depth/photo-depth.png");
    expect(r.suggestion).toEqual({ plate: r.path, plateDepth: r.depthPath });
    const png = await decodePng(await fs.readBytes(r.path), { inflate });
    expect([png.width, png.height]).toEqual([96, 64]);
    expect(isRed(png.data, (32 * 96 + 38) * 4)).toBe(false);
    const manifest = JSON.parse(await fs.readText("assets/manifest.json")) as { assets: { path: string; license: string; source: string }[] };
    expect(manifest.assets.find((a) => a.path === r.path)).toMatchObject({ license: "CC0-1.0", source: "agent3d-plate" });
    expect(manifest.assets.find((a) => a.path === r.depthPath)).toBeTruthy();
  });

  it("re-encodes as WebP through the host codec", async () => {
    const { fs } = await project();
    const codec: PixelCodec = { decode: noCodec.decode, codec: async (i) => ({ bytes: new Uint8Array([82, 73, 70, 70, 1, 2]), mimeType: "image/webp", width: 1, height: 1, srcWidth: 1, srcHeight: 1, ...(i.format === "webp" ? {} : { mimeType: "x" }) }) };
    const r = await generatePlate(fs, { image: "assets/textures/photo.png", deflate, inflate }, codec);
    expect(r.path).toBe("assets/depth/photo-plate.webp");
    expect(Array.from(await fs.readBytes(r.path))).toEqual([82, 73, 70, 70, 1, 2]);
  });

  it("finds the depth map from the scene, and explains a missing one", async () => {
    const { fs } = await project();
    await fs.writeText("scene.json", JSON.stringify({ version: 1, objects: [{ id: "p", kind: "photo", src: "assets/textures/photo.png", depth: "assets/depth/custom.png" }] }));
    await expect(checkPlateRequest(fs, { image: "assets/textures/photo.png" })).rejects.toMatchObject({ code: "notFound", hint: expect.stringContaining("--plate") });
    await fs.writeBytes("assets/depth/custom.png", await fs.readBytes("assets/depth/photo-depth.png"));
    expect((await checkPlateRequest(fs, { image: "assets/textures/photo.png" })).depth).toBe("assets/depth/custom.png");
    await expect(checkPlateRequest(fs, { image: "assets/textures/nope.png" })).rejects.toMatchObject({ code: "notFound" });
    await expect(checkPlateRequest(fs, { image: "assets/textures/photo.png", out: "plate.png" })).rejects.toMatchObject({ code: "invalid" });
    await expect(checkPlateRequest(fs, { image: "assets/textures/photo.png", width: 1 })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("decodePng", () => {
  it("round-trips every layout encodePng writes, keeping grey under alpha 0", async () => {
    const w = 5, h = 3;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([i * 7, i * 7, i * 7, i % 3 ? 255 : 0], i * 4);
    for (const channels of [2, 4] as const) {
      const out = await decodePng(await encodePng(rgba, w, h, { channels, deflate }), { inflate });
      expect(Array.from(out.data)).toEqual(Array.from(rgba));
    }
    const rgb = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgb.set([i * 3, 255 - i * 5, i * 11, 255], i * 4);
    for (const channels of [3, 4] as const) expect(Array.from((await decodePng(await encodePng(rgb, w, h, { channels, deflate }), { inflate })).data)).toEqual(Array.from(rgb));
  });
});
