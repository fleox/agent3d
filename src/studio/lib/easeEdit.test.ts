import { describe, expect, it } from "vitest";
import { isEaseSpec } from "../../core/ease";
import { DEFAULTS, curvePath, curveRange, formatEase, parsedOf } from "./easeEdit";

describe("ease editor helpers", () => {
  it("round-trips every kind through a valid spec", () => {
    for (const p of Object.values(DEFAULTS)) {
      const s = formatEase(p);
      expect(isEaseSpec(s), s).toBe(true);
      expect(parsedOf(s)).toEqual(p);
    }
    expect(formatEase({ kind: "spring", stiffness: 100, damping: 10, mass: 2 })).toBe("spring(100, 10, 2)");
    expect(formatEase({ kind: "steps", count: 3, jumpStart: true })).toBe("steps(3, start)");
    expect(formatEase({ kind: "cubicBezier", x1: 0.1234, y1: 1.5, x2: 0.5, y2: -0.25 })).toBe("cubicBezier(0.123, 1.5, 0.5, -0.25)");
  });
  it("falls back on invalid specs and draws curves", () => {
    expect(parsedOf("nope", "outCubic")).toEqual({ kind: "named", name: "outCubic" });
    expect(curvePath("linear", 100, 100, { pad: 0, samples: 2 })).toBe("M0.0 100.0L50.0 50.0L100.0 0.0");
    const [lo, hi] = curveRange("outBack");
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(1);
  });
});
