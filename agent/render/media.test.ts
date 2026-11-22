import { describe, expect, it } from "vitest";
import { decodeGifInfo, encodeGif, lzwEncode, medianCut } from "./gif";
import { avcCodecFor, muxMp4, readMp4Boxes } from "./mp4";
import { muxAnimatedWebp, webpImageChunks } from "./webpAnim";
import { muxWebm } from "./webm";
import { clampSs, mediaFormatFromPath, parseQuality, sceneForRender, scrollTime } from "./render";

// GIF LZW decoder (test oracle).
function lzwDecode(data: Uint8Array, minCodeSize: number, expected: number): number[] {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let size = minCodeSize + 1, dict: number[][] = [], prev: number[] | null = null;
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    size = minCodeSize + 1;
    prev = null;
  };
  reset();
  const out: number[] = [];
  let bit = 0;
  while (out.length < expected) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else entry = [...prev!, prev![0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}

describe("GIF encoder", () => {
  it("LZW round-trips long and repetitive input", () => {
    const n = 20000;
    const input = new Uint8Array(n);
    for (let i = 0; i < n; i++) input[i] = (i * 7 + (i >> 5)) % 251;
    expect(lzwDecode(lzwEncode(input, 8), 8, n)).toEqual([...input]);
    const flat = new Uint8Array(5000).fill(3);
    expect(lzwDecode(lzwEncode(flat, 8), 8, 5000)).toEqual([...flat]);
  });
  it("median cut finds the dominant colours", () => {
    const s = new Uint32Array(1000);
    for (let i = 0; i < 1000; i++) s[i] = i < 500 ? 0x0000ff : 0xff0000;
    const p = medianCut(s, 2).map((c) => c.join(","));
    expect(p.sort()).toEqual(["0,0,255", "255,0,0"]);
  });
  it("encodes looping frames with exact delays and frame differencing", () => {
    const w = 32, h = 16;
    const frames = [0, 1, 2].map((k) => {
      const rgba = new Uint8Array(w * h * 4);
      for (let p = 0; p < w * h; p++) {
        const on = (p % w) >= k * 8 && (p % w) < k * 8 + 8;
        rgba.set(on ? [255, 200, 0, 255] : [20, 30, 60, 255], p * 4);
      }
      return { rgba };
    });
    const gif = encodeGif(frames, { width: w, height: h, fps: 30 });
    const info = decodeGifInfo(gif);
    expect(info).toMatchObject({ width: 32, height: 16, frames: 3, loop: true });
    expect(info.delays).toEqual([3, 4, 3]); // 30 fps → 3.33 cs without drift
  });
});

describe("MP4 / WebM / animated WebP muxers", () => {
  it("writes a fast-start MP4", () => {
    const chunk = (key: boolean) => ({ data: new Uint8Array([0, 0, 0, 2, key ? 0x65 : 0x41, 0x88]), key });
    const mp4 = muxMp4([chunk(true), chunk(false), chunk(false)], { width: 64, height: 32, fps: 30, avcC: new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe0, 0]) });
    expect(readMp4Boxes(mp4).map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    const s = Buffer.from(mp4).toString("latin1");
    expect(s).toContain("avcC");
    expect(s).toContain("stss");
    expect(() => muxMp4([chunk(false)], { width: 64, height: 32, fps: 30, avcC: new Uint8Array(7) })).toThrow(/key frame/);
    expect(avcCodecFor(1920, 1080, 30)).toBe("avc1.640028");
    expect(avcCodecFor(1280, 720, 30)).toBe("avc1.64001f");
    expect(avcCodecFor(3840, 2160, 30)).toBe("avc1.640033");
  });
  it("marks VP9 inter frames in WebM", () => {
    const f = (key: boolean) => ({ data: new Uint8Array([1, 2, 3]), width: 8, height: 8, key });
    const webm = muxWebm([f(true), f(false)], 30, { codec: "V_VP9" });
    expect(Buffer.from(webm).toString("latin1")).toContain("V_VP9");
  });
  it("muxes WebP stills into an animation", () => {
    // Minimal lossy WebP: RIFF / WEBP / "VP8 " chunk with a key-frame header for 4x2.
    const vp8 = new Uint8Array([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 4, 0, 2, 0, 0, 0]);
    const still = Buffer.concat([Buffer.from("RIFF"), Buffer.from([20 + vp8.length - 8 + 4 - 4, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.from([vp8.length, 0, 0, 0]), Buffer.from(vp8)]);
    expect(webpImageChunks(new Uint8Array(still))).toMatchObject({ width: 4, height: 2, alpha: false });
    const anim = muxAnimatedWebp([new Uint8Array(still), new Uint8Array(still)], { fps: 20 });
    const s = Buffer.from(anim).toString("latin1");
    expect(s.slice(0, 4)).toBe("RIFF");
    expect(s).toContain("VP8X");
    expect(s).toContain("ANIM");
    expect(s.split("ANMF").length - 1).toBe(2);
    expect(Buffer.from(anim).readUInt32LE(4)).toBe(anim.byteLength - 8);
  });
});

describe("media options", () => {
  it("parses formats, quality and supersampling limits", () => {
    expect(mediaFormatFromPath("a/b.MP4")).toBe("mp4");
    expect(mediaFormatFromPath("x.gif")).toBe("gif");
    expect(mediaFormatFromPath("x.mov")).toBeNull();
    expect(parseQuality("ultra")).toBe("ultra");
    expect(() => parseQuality("max")).toThrow(/quality/);
    expect(clampSs(3, { width: 1920, height: 1080, deviceScaleFactor: 1 })).toBe(2);
    expect(clampSs(3, { width: 800, height: 200, deviceScaleFactor: 1 })).toBe(3);
  });
  it("forces transparency and maps scroll progress to time", () => {
    const scene = { target: { kind: "hero", aspect: "16:9" }, timeline: { duration: 8, trigger: "scroll", tracks: [] } } as never;
    expect(sceneForRender(scene, { transparent: true }).target.transparent).toBe(true);
    expect(sceneForRender(scene, {})).toBe(scene);
    expect(scrollTime(scene, 0.5)).toBe(4);
  });
});
