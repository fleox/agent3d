import { describe, expect, it } from "vitest";
import { autoDrift, buildMeshGeometry, layerBands, meshRange, meshSegments, motionSettings, parallaxParams, parallaxSteps, photoSize, smoothToward, tiltToOffset, triangleCut, viewOffset, type MotionFrame } from "./photo";

const frame = (over: Partial<MotionFrame> = {}): MotionFrame => ({ t: 0, pointer: { x: 0, y: 0, weight: 0 }, gyro: null, scroll: 0, reduced: false, ...over });

describe("photo sizing", () => {
  it("defaults to width 4 and the image aspect", () => {
    expect(photoSize({}, 1600, 900)).toEqual({ width: 4, height: 2.25 });
    expect(photoSize({ width: 2 }, 1000, 2000)).toEqual({ width: 2, height: 4 });
  });
  it("height alone follows the aspect, both win over it", () => {
    expect(photoSize({ height: 1 }, 400, 200)).toEqual({ width: 2, height: 1 });
    expect(photoSize({ width: 3, height: 3 }, 400, 200)).toEqual({ width: 3, height: 3 });
  });
  it("survives a missing image size", () => {
    expect(photoSize({}, 0, 0)).toEqual({ width: 4, height: 4 });
  });
});

describe("photo motion", () => {
  it("auto drift is a pure function of t, neutral at t = 0, looping every 10 / speed s", () => {
    for (const auto of ["sway", "zoom", "none"] as const) {
      expect(autoDrift(auto, 1, 0)).toEqual({ x: 0, y: 0, zoom: 0 });
      const a = autoDrift(auto, 2, 1.234);
      expect(autoDrift(auto, 2, 1.234)).toEqual(a);
      const b = autoDrift(auto, 2, 1.234 + 5);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
      expect(b.zoom).toBeCloseTo(a.zoom, 9);
    }
    const o0 = autoDrift("orbit", 1, 0);
    expect(Math.hypot(o0.x, o0.y)).toBe(0);
    const o1 = autoDrift("orbit", 1, 7), o2 = autoDrift("orbit", 1, 17);
    expect(o2.x).toBeCloseTo(o1.x, 9);
    expect(Math.hypot(o1.x, o1.y)).toBeCloseTo(0.8, 9);
    expect(autoDrift("zoom", 1, 5).zoom).toBeCloseTo(1, 9);
    expect(autoDrift("sway", 0, 3)).toEqual({ x: 0, y: 0, zoom: 0 });
  });

  it("settings defaults (gyro follows pointer)", () => {
    expect(motionSettings(undefined)).toEqual({ pointer: 1, scroll: 0, gyro: true, auto: "sway", speed: 1, smoothing: 0.9, loop: true, duration: 0, progress: null });
    expect(motionSettings({ pointer: 0 }).gyro).toBe(false);
    expect(motionSettings({ pointer: 3, smoothing: 2 })).toMatchObject({ pointer: 1, smoothing: 0.99 });
  });

  it("pointer takes over from the auto drift, reduced motion drops drift and halves the pointer", () => {
    const s = motionSettings({});
    const drift = viewOffset(s, frame({ t: 2.5 }));
    expect(drift.x).toBeCloseTo(0.9, 9);
    const p = viewOffset(s, frame({ t: 2.5, pointer: { x: 0.6, y: -0.4, weight: 1 } }));
    expect(p).toEqual({ x: 0.6, y: -0.4, zoom: 0 });
    const r = viewOffset(s, frame({ t: 2.5, pointer: { x: 0.6, y: -0.4, weight: 1 }, reduced: true }));
    expect(r.x).toBeCloseTo(0.3, 9);
    expect(r.y).toBeCloseTo(-0.2, 9);
    expect(viewOffset(s, frame({ t: 2.5, reduced: true }))).toEqual({ x: 0, y: 0, zoom: 0 });
  });

  it("gyro drives the view when the pointer is away; scroll adds a vertical offset", () => {
    const s = motionSettings({ auto: "none", scroll: 0.5 });
    expect(viewOffset(s, frame({ gyro: { x: 0.5, y: 0.2 }, scroll: 0.5 }))).toEqual({ x: 0.5, y: 0.2, zoom: 0 });
    expect(viewOffset(s, frame({ scroll: 1 })).y).toBeCloseTo(0.5, 9);
    expect(viewOffset(motionSettings({ auto: "none", gyro: false }), frame({ gyro: { x: 1, y: 1 } }))).toEqual({ x: 0, y: 0, zoom: 0 });
    expect(viewOffset(s, frame({ pointer: { x: 9, y: 0, weight: 1 } })).x).toBe(1);
  });

  it("smoothing is frame-rate independent", () => {
    let a = 0;
    for (let i = 0; i < 4; i++) a = smoothToward(a, 1, 1 / 60, 0.9);
    const b = smoothToward(smoothToward(0, 1, 2 / 60, 0.9), 1, 2 / 60, 0.9);
    expect(a).toBeCloseTo(b, 9);
    expect(smoothToward(0.2, 1, 0.1, 0)).toBe(1);
    expect(smoothToward(0.2, 1, 0, 0.9)).toBe(0.2);
  });

  it("tilt → offset, relative to the first reading and the screen angle", () => {
    const base = { beta: 40, gamma: 0 };
    expect(tiltToOffset(40, 10, base, 0)).toEqual({ x: 0.5, y: -0 });
    expect(tiltToOffset(30, 0, base, 0)).toEqual({ x: 0, y: 0.5 });
    expect(tiltToOffset(40, 90, base, 0).x).toBe(1);
    expect(tiltToOffset(50, 0, base, 90).x).toBeCloseTo(0.5, 9);
  });
});

describe("photo parallax / mesh / layers math", () => {
  it("parallax offsets are isotropic in world units and the inset hides the edges", () => {
    const { maxOffset, inset } = parallaxParams(0.5, 4, 2);
    expect(maxOffset[0] * 4).toBeCloseTo(maxOffset[1] * 2, 9);
    expect(maxOffset[1]).toBeCloseTo(0.03, 9);
    // largest shift (|depth - focus| <= 1 at full offset) stays inside the inset margin
    for (const k of [0, 1]) expect(maxOffset[k] * 0.5).toBeLessThan((1 - inset[k]) / 2);
    expect(parallaxParams(0, 4, 2).inset).toEqual([1, 1]);
  });

  it("mesh segments follow the long side", () => {
    expect(meshSegments(256, 4, 2)).toEqual([256, 128]);
    expect(meshSegments(100, 1, 3)).toEqual([33, 100]);
    expect(meshSegments(1, 1, 1)).toEqual([2, 2]);
    expect(meshRange(0.4, 5)).toBeCloseTo(0.5, 9);
  });

  it("mesh triangles collapse on depth jumps and alpha-0 texels", () => {
    expect(triangleCut([0.5, 0.52, 0.51], [1, 1, 1], 0.08)).toBe(false);
    expect(triangleCut([0.2, 0.52, 0.51], [1, 1, 1], 0.08)).toBe(true);
    expect(triangleCut([0.2, 0.52, 0.51], [1, 1, 1], 0)).toBe(false);
    expect(triangleCut([0.5, 0.5, 0.5], [1, 0, 1], 0)).toBe(true);
  });

  it("mesh geometry: every vertex carries its triangle's two other UVs", () => {
    const g = buildMeshGeometry(2, 1, 4, 2);
    const uv = g.getAttribute("uv"), other = g.getAttribute("uvOther");
    expect(uv.count).toBe(4 * 2 * 2 * 3);
    for (let tri = 0; tri < uv.count / 3; tri++) {
      const pts = [0, 1, 2].map((k) => `${uv.getX(tri * 3 + k)},${uv.getY(tri * 3 + k)}`);
      for (let k = 0; k < 3; k++) {
        const v = tri * 3 + k;
        const o = [`${other.getX(v)},${other.getY(v)}`, `${other.getZ(v)},${other.getW(v)}`];
        expect(new Set([pts[k], ...o])).toEqual(new Set(pts));
      }
    }
    g.dispose();
  });

  it("layer bands cover 0..1, background first, z ordered far → near", () => {
    const bands = layerBands(6, 0.5, 0.3, 4);
    expect(bands).toHaveLength(6);
    expect(bands[0].background).toBe(true);
    expect(bands.slice(1).every((b) => !b.background)).toBe(true);
    expect(bands[0].lo).toBe(0);
    expect(bands[5].hi).toBe(1);
    for (let i = 1; i < 6; i++) {
      expect(bands[i].lo).toBeCloseTo(bands[i - 1].hi, 9);
      expect(bands[i].z).toBeGreaterThan(bands[i - 1].z);
    }
    expect(layerBands(1, 0.5, 0.3, 4)).toHaveLength(2);
    expect(layerBands(99, 0.5, 0.3, 4)).toHaveLength(16);
  });
});

describe("parallaxSteps", () => {
  it("spends fewer march steps on weak devices and gentle depth", () => {
    expect(parallaxSteps(undefined, 1)).toBe(32);
    expect(parallaxSteps("high", 0.6)).toBe(32);
    expect(parallaxSteps("low", 1)).toBe(12);
    expect(parallaxSteps("medium", 1)).toBe(20);
    expect(parallaxSteps("ultra", 1)).toBe(48);
    expect(parallaxSteps("high", 0)).toBe(16);
    expect(parallaxSteps("low", 0)).toBe(8);
  });
});
