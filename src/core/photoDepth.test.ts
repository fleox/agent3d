import { describe, expect, it } from "vitest";
import { photoDepthRange, photoDepthToZ, photoZRange, photoZToDepth } from "./photoDepth";

describe("photo depth mapping", () => {
  it("range = strength * width * 0.25 (mesh mode: linear around focus)", () => {
    expect(photoDepthRange(0.8, 10)).toBeCloseTo(2);
    const p = { mode: "mesh", strength: 0.8, width: 10, focus: 0.4, cameraDistance: 10 };
    expect(photoDepthToZ(0.4, p)).toBeCloseTo(0);
    expect(photoDepthToZ(1, p)).toBeCloseTo(1.2);
    expect(photoDepthToZ(0, p)).toBeCloseTo(-0.8);
  });

  it("parallax: z / (D - z) is linear in (d - focus), the shift a camera move gives matches the shader's", () => {
    const D = 10;
    const p = { strength: 0.8, width: 10, focus: 0.5, cameraDistance: D };
    const ratio = (d: number) => {
      const z = photoDepthToZ(d, p);
      return z / (D - z);
    };
    expect(photoDepthToZ(0.5, p)).toBeCloseTo(0);
    expect(ratio(1) - ratio(0.75)).toBeCloseTo(ratio(0.75) - ratio(0.5));
    expect(ratio(0.25) - ratio(0)).toBeCloseTo(ratio(0.5) - ratio(0.25));
    expect(ratio(1)).toBeCloseTo((0.5 * 2) / D);
    // ≈ linear, the near side slightly compressed, the far side stretched
    expect(photoDepthToZ(1, p)).toBeLessThan(1);
    expect(photoDepthToZ(0, p)).toBeLessThan(-1);
  });

  it("inverts", () => {
    for (const mode of ["parallax", "mesh"]) {
      const p = { mode, strength: 0.6, width: 8, focus: 0.3, cameraDistance: 12 };
      for (const d of [0, 0.2, 0.5, 0.9, 1]) expect(photoZToDepth(photoDepthToZ(d, p), p)).toBeCloseTo(d);
    }
  });

  it("defaults; no camera distance = linear", () => {
    expect(photoZRange({})).toEqual([-0.25, 0.25]);
    expect(photoDepthToZ(1, { strength: 1, width: 4, focus: 0 })).toBeCloseTo(1);
  });
});
