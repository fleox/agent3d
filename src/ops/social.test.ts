import { describe, expect, it } from "vitest";
import type { SceneDoc } from "../core/types";
import { defaultScene } from "../core/validate";
import { SOCIAL_PRESETS, coverScene, imageHeaderSize, parseSocialPreset, socialDuration } from "./social";

const photoScene = (photo: Record<string, unknown> = {}, over: Partial<SceneDoc> = {}): SceneDoc =>
  ({
    ...defaultScene({ id: "s", kind: "hero" }),
    target: { kind: "hero", aspect: "16:9" },
    camera: { type: "perspective", fov: 35, position: [0, 0, 10], target: [0, 0, 0] },
    objects: [{ id: "photo", kind: "photo", src: "assets/p.jpg", depth: "assets/d.png", width: 11.9, ...photo }],
    ...over,
  }) as SceneDoc;

const img = (w: number, h: number) => () => ({ width: w, height: h });

// Half extents of the view at the photo plane (z = 0) for a camera at z = 10.
const view = (fov: number, aspect: number) => {
  const hh = Math.tan((fov * Math.PI) / 360) * 10;
  return { hw: hh * aspect, hh };
};

describe("social presets", () => {
  it("lists the four presets with social-network sizes", () => {
    expect(SOCIAL_PRESETS.vertical).toMatchObject({ width: 1080, height: 1920 });
    expect(SOCIAL_PRESETS.square).toMatchObject({ width: 1080, height: 1080 });
    expect(SOCIAL_PRESETS.landscape).toMatchObject({ width: 1920, height: 1080 });
    expect(SOCIAL_PRESETS.story).toMatchObject({ width: 1080, height: 1920, maxDuration: 15 });
    expect(parseSocialPreset("LANDSCAPE")).toMatchObject({ id: "landscape" });
    const bad = parseSocialPreset("sqare");
    expect("error" in bad && bad.hint).toContain('"square"');
  });

  it("lasts one seamless loop of the photo motion", () => {
    expect(socialDuration(photoScene({ motion: { auto: "dolly", speed: 1 } }))).toMatchObject({ duration: 10, start: 0 });
    expect(socialDuration(photoScene({ motion: { auto: "pan", speed: 2 } }))).toMatchObject({ duration: 5, start: 0 });
    expect(socialDuration(photoScene({ motion: { auto: "rise", loop: false, duration: 7 } }))).toMatchObject({ duration: 7 });
    expect(socialDuration(photoScene({ motion: { auto: "orbit", speed: 1 } }))).toMatchObject({ duration: 10, start: 10 });
    // default motion: sway at speed 1
    expect(socialDuration(photoScene()).duration).toBe(10);
    // no motion: the timeline, else 5 s; story caps at 15 s
    expect(socialDuration(photoScene({ motion: { auto: "none" } }, { timeline: { duration: 6, tracks: [] } } as Partial<SceneDoc>)).duration).toBe(6);
    expect(socialDuration(photoScene({ motion: { auto: "none" } })).duration).toBe(5);
    expect(socialDuration(photoScene({ motion: { auto: "dolly", speed: 0.25 } }), SOCIAL_PRESETS.story).duration).toBe(15);
    // timeline-driven moves (progress) do not set the length
    expect(socialDuration(photoScene({ motion: { auto: "dolly", progress: 0 } })).duration).toBe(5);
  });
});

describe("coverScene", () => {
  it("crops a 16:9 photo hero to 9:16 without touching the camera when the photo already covers", () => {
    const c = coverScene(photoScene(), 9 / 16, img(1920, 1280));
    expect(c.scene.target.aspect).toBe("9:16");
    expect(c.zoom).toBe(1);
    expect(c.scene.camera.fov).toBe(35);
    expect(c.notes.join(" ")).toContain("cropped to 9:16");
  });

  it("tightens the camera until the photo fills a wider frame (no edges)", () => {
    // A 4:3 photo 8 units wide does not cover a 16:9 frame at fov 35 (11.2 units wide).
    const s = photoScene({ width: 8 });
    const c = coverScene(s, 16 / 9, img(1600, 1200));
    expect(c.zoom).toBeGreaterThan(1);
    const v = view(c.scene.camera.fov!, 16 / 9);
    expect(v.hw).toBeLessThanOrEqual(4 + 1e-9);
    expect(v.hh).toBeLessThanOrEqual(3 + 1e-9);
    expect(v.hw).toBeGreaterThan(3.85); // tight: 1 % margin
    expect(c.notes.join(" ")).toContain("Camera tightened");
    // the authored scene is untouched
    expect(s.camera.fov).toBe(35);
  });

  it("covers a square frame from a portrait photo and keeps a bigger margin for mesh tilts", () => {
    const portrait = coverScene(photoScene({ width: 4 }), 1, img(1000, 1500));
    const v = view(portrait.scene.camera.fov!, 1);
    expect(v.hw).toBeLessThanOrEqual(2);
    const mesh = coverScene(photoScene({ width: 4, mode: "mesh" }), 1, img(1000, 1500));
    expect(mesh.scene.camera.fov!).toBeLessThan(portrait.scene.camera.fov!);
  });

  it("handles an off-centre photo, an orthographic camera, unknown sizes and rotated photos", () => {
    const off = coverScene(photoScene({ width: 12, position: [1, 0, 0] }), 16 / 9, img(1920, 1080));
    const v = view(off.scene.camera.fov!, 16 / 9);
    expect(v.hw).toBeLessThanOrEqual(6 - 1 + 1e-9);
    const ortho = coverScene(photoScene({ width: 6 }, { camera: { type: "orthographic", zoom: 6, position: [0, 0, 10], target: [0, 0, 0] } } as Partial<SceneDoc>), 16 / 9, img(1600, 1200));
    expect(ortho.scene.camera.zoom! * (16 / 9)).toBeLessThanOrEqual(6 + 1e-9);
    expect(coverScene(photoScene(), 1, () => null).notes.join(" ")).toContain("unknown image size");
    expect(coverScene(photoScene({ rotation: [0, 20, 0] }), 1, img(100, 100)).notes.join(" ")).toContain("not facing the camera");
  });
});

describe("imageHeaderSize", () => {
  it("reads PNG, JPEG and WebP sizes", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 7, 128, 0, 0, 4, 56], 16); // 1920 × 1080
    expect(imageHeaderSize(png)).toEqual({ width: 1920, height: 1080 });
    // JPEG: SOI, APP0 (len 4), SOF0 (h 1280, w 1920)
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 5, 0, 7, 128, 3, 1, 0x22, 0, 0, 0, 0]);
    expect(imageHeaderSize(jpg)).toEqual({ width: 1920, height: 1280 });
    // WebP VP8X: canvas 1600 × 1064 (stored minus one, 24-bit LE)
    const webp = new Uint8Array(30);
    webp.set([..."RIFF"].map((c) => c.charCodeAt(0)));
    webp.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
    webp.set([0x3f, 0x06, 0x00, 0x27, 0x04, 0x00], 24);
    expect(imageHeaderSize(webp)).toEqual({ width: 1600, height: 1064 });
    expect(imageHeaderSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
