import { describe, expect, it } from "vitest";
import { fitScale, fittedFov } from "./camera";

describe("responsive camera fit", () => {
  it("keeps the authored framing at or above the design aspect", () => {
    expect(fitScale(4, 4)).toBe(1);
    expect(fitScale(16 / 9, 4 / 3)).toBe(1);
    expect(fitScale(2, undefined)).toBe(1);
    expect(fittedFov(30, 1)).toBe(30);
  });
  it("widens the view on narrower canvases so the sides are not cropped", () => {
    expect(fitScale(2, 4)).toBe(2);
    const fov = fittedFov(30, 2);
    // same horizontal extent: tan(fov'/2) = 2 tan(fov/2)
    expect(Math.tan(((fov / 2) * Math.PI) / 180)).toBeCloseTo(2 * Math.tan((15 * Math.PI) / 180), 6);
  });
  it("is capped", () => {
    expect(fitScale(0.1, 4)).toBe(3);
    expect(fittedFov(80, 3)).toBe(100);
  });
});
