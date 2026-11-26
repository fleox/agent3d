import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARALLAX_GLSL, PHOTO_COMMON_GLSL, createPhotoMotion, motionSettings, viewOffset } from "./photoCore";

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
