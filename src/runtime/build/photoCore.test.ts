import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARALLAX_GLSL, PHOTO_COMMON_GLSL, VERTIGO_ZOOM, autoDrift, createPhotoMotion, motionPeriod, motionSettings, movePose, parallaxParams, parallaxView, viewOffset, type PhotoAuto, type ViewOffset } from "./photoCore";

describe("photoCore (shared by the full and the lite runtime)", () => {
  it("has no three.js import (the lite runtime bundles it)", () => {
    const src = readFileSync(join(__dirname, "photoCore.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']three/);
    expect(src).not.toMatch(/import\(\s*["']three/);
  });

  it("GLSL is plain GLSL ES 3.00 (no three.js chunks or GLSL 1 names)", () => {
    for (const g of [PHOTO_COMMON_GLSL, PARALLAX_GLSL]) {
      expect(g).not.toMatch(/#include|gl_FragColor|texture2D\(|varying/);
    }
    expect(PARALLAX_GLSL).toContain("__STEPS__");
    expect(PARALLAX_GLSL).toContain("vec4 parallaxTexel(vec2 vUv)");
  });

  it("deterministic motion uses the pointer as is; live motion smooths it (first frame instant)", () => {
    const s = motionSettings({ auto: "sway", smoothing: 0.9 });
    const det = createPhotoMotion(s, { live: false, flat: false });
    const inside = { pointer: { x: 0.5, y: -0.5, inside: true }, scroll: 0, reduced: false };
    expect(det.offset(1, 0, inside)).toEqual(viewOffset(s, { t: 1, pointer: { x: 0.5, y: -0.5, weight: 1 }, gyro: null, scroll: 0, reduced: false }));
    const live = createPhotoMotion(s, { live: true, flat: false });
    const out = { pointer: { x: 0, y: 0, inside: false }, scroll: 0, reduced: false };
    const first = live.offset(1, 0.016, out);
    expect(first).toEqual(viewOffset(s, { t: 1, pointer: { x: 0, y: 0, weight: 0 }, gyro: null, scroll: 0, reduced: false }));
    // one frame later: on the way to the pointer, not there yet
    const step = live.offset(1.016, 0.016, inside);
    const target = det.offset(1.016, 0, inside);
    expect(Math.abs(step.x - target.x)).toBeGreaterThan(0.01);
    const settled = live.offset(4, 3, inside); // a long dt converges (seek in a live player)
    expect(settled.x).toBeCloseTo(0.5, 6);
    expect(settled.y).toBeCloseTo(-0.5, 6);
    live.dispose();
    det.dispose();
  });
});

describe("cinematic auto moves (dolly / pan / rise / vertigo)", () => {
  const MOVES: PhotoAuto[] = ["dolly", "pan", "rise", "vertigo", "zoom", "sway"];
  const vec = (o: ViewOffset) => [o.x, o.y, o.zoom, o.push ?? 0, o.vertigo ?? 0];
  const close = (a: ViewOffset, b: ViewOffset, digits = 9) => vec(a).forEach((v, i) => expect(v).toBeCloseTo(vec(b)[i], digits));

  it("loops seamlessly: the pose at t = 0 equals the pose at t = period (10 / speed)", () => {
    for (const auto of MOVES) {
      for (const speed of [0.5, 1, 1.7]) {
        const period = 10 / speed;
        close(autoDrift(auto, speed, 0), autoDrift(auto, speed, period));
        close(autoDrift(auto, speed, 1.3), autoDrift(auto, speed, 1.3 + 2 * period));
        expect(motionPeriod(motionSettings({ auto, speed }))).toEqual({ duration: period, start: 0 });
      }
    }
    // orbit eases its radius in over its first cycle: the seamless loop starts one period in
    expect(motionPeriod(motionSettings({ auto: "orbit", speed: 2 }))).toEqual({ duration: 5, start: 5 });
    close(autoDrift("orbit", 2, 5), autoDrift("orbit", 2, 10));
    expect(motionPeriod(motionSettings({ auto: "none" })).duration).toBe(0);
  });

  it("is continuous (no jumps between close frames) and bounded", () => {
    for (const auto of MOVES) {
      for (const loop of [true, false]) {
        let prev = autoDrift(auto, 1, 0, { loop });
        for (let i = 1; i <= 1200; i++) {
          const cur = autoDrift(auto, 1, i / 100, { loop });
          vec(cur).forEach((v, k) => expect(Math.abs(v - vec(prev)[k])).toBeLessThan(0.02));
          expect(Math.abs(cur.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(cur.y)).toBeLessThanOrEqual(1);
          expect(cur.zoom).toBeGreaterThanOrEqual(0);
          expect(cur.zoom).toBeLessThanOrEqual(1.2);
          expect(cur.push ?? 0).toBeGreaterThanOrEqual(0);
          expect(cur.push ?? 0).toBeLessThanOrEqual(0.15);
          expect(cur.vertigo ?? 0).toBeLessThanOrEqual(1);
          prev = cur;
        }
      }
    }
  });

  it("starts from the photo as is (dolly / vertigo / zoom neutral at t = 0; pan / rise mid-path)", () => {
    for (const auto of ["dolly", "vertigo", "zoom"] as const) expect(vec(autoDrift(auto, 1, 0))).toEqual([0, 0, 0, 0, 0]);
    for (const auto of ["pan", "rise"] as const) {
      const o = autoDrift(auto, 1, 0);
      expect(o.x).toBeCloseTo(0, 9);
      expect(o.y).toBeCloseTo(0, 9);
    }
  });

  it("each move does what its name says", () => {
    // dolly: pushes in (zoom + magnification) at half a loop
    const d = autoDrift("dolly", 1, 5);
    expect(d.zoom).toBeGreaterThan(1);
    expect(d.push).toBeCloseTo(0.12, 9);
    // pan: left → right; rise: low → high
    expect(movePose("pan", 0).x).toBeLessThan(-0.8);
    expect(movePose("pan", 1).x).toBeGreaterThan(0.8);
    expect(movePose("rise", 0).y).toBeLessThan(-0.7);
    expect(movePose("rise", 1).y).toBeGreaterThan(0.7);
    // vertigo: full dolly zoom at half a loop
    expect(autoDrift("vertigo", 1, 5).vertigo).toBeCloseTo(1, 9);
  });

  it("one-way moves (loop false) run once over `duration`, eased, then hold", () => {
    const s = motionSettings({ auto: "pan", loop: false, duration: 6 });
    expect(motionPeriod(s)).toEqual({ duration: 6, start: 0 });
    close(autoDrift("pan", 1, 0, s), movePose("pan", 0));
    close(autoDrift("pan", 1, 3, s), movePose("pan", 0.5));
    close(autoDrift("pan", 1, 6, s), movePose("pan", 1));
    close(autoDrift("pan", 1, 60, s), movePose("pan", 1));
    // default duration: 10 / speed
    expect(motionPeriod(motionSettings({ auto: "dolly", loop: false, speed: 2 }))).toEqual({ duration: 5, start: 0 });
  });

  it("progress (timeline-driven) overrides time and keeps the push under the pointer; reduced motion stays still", () => {
    const s = motionSettings({ auto: "dolly" });
    const frame = { t: 3, pointer: { x: 0, y: 0, weight: 0 }, gyro: null, scroll: 0, reduced: false };
    close(viewOffset(s, { ...frame, progress: 0.5 }), movePose("dolly", 0.5));
    close(viewOffset(motionSettings({ auto: "dolly", progress: 0.25 }), frame), movePose("dolly", 0.25));
    const hovered = viewOffset(s, { ...frame, progress: 1, pointer: { x: 0.5, y: 0, weight: 1 } });
    expect(hovered.x).toBeCloseTo(0.5, 9);
    expect(hovered.zoom).toBeCloseTo(movePose("dolly", 1).zoom, 9);
    expect(vec(viewOffset(s, { ...frame, progress: 1, reduced: true }))).toEqual([0, 0, 0, 0, 0]);
    expect(vec(viewOffset(motionSettings({ auto: "vertigo" }), { ...frame, t: 5, reduced: true }))).toEqual([0, 0, 0, 0, 0]);
  });

  it("parallaxView: push magnifies, vertigo keeps the focus plane's size (base UV scale unchanged)", () => {
    const inset = parallaxParams(0.8, 12, 6.75).inset;
    expect(parallaxView({ x: 0, y: 0, zoom: 0 }, inset)).toEqual({ zoom: 0, inset });
    const z = parallaxView({ x: 0, y: 0, zoom: 1 }, inset);
    expect(z.zoom).toBe(1);
    expect(z.inset[0]).toBeCloseTo(inset[0], 9); // the shader applies its own 6 % push
    const p = parallaxView({ x: 0, y: 0, zoom: 0, push: 0.1 }, inset);
    expect(p.inset[0]).toBeCloseTo(inset[0] / 1.1, 9);
    const v = parallaxView({ x: 0, y: 0, zoom: 0, vertigo: 1 }, inset);
    expect(v.zoom).toBeCloseTo(-VERTIGO_ZOOM, 9);
    // the shader's base scale = inset * (1 - 0.06 * zoom): back to the rest inset
    expect(v.inset[0] * (1 - 0.06 * v.zoom)).toBeCloseTo(inset[0], 9);
    expect(v.inset[1] * (1 - 0.06 * v.zoom)).toBeCloseTo(inset[1], 9);
  });
});
