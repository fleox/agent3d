import { describe, expect, it } from "vitest";
import { createRng, fbm2D, fbm3D, hashSeed, noise2D, noise3D, ridged2D } from "./random";

describe("createRng", () => {
  it("is deterministic per seed and in [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(Array.from({ length: 1000 }, () => b.next())).toEqual(xs);
    expect(c.next()).not.toBe(xs[0]);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
  it("range / int / pick stay in bounds", () => {
    const r = createRng(7);
    for (let i = 0; i < 500; i++) {
      const v = r.range(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
      const n = r.int(1, 6);
      expect(Number.isInteger(n) && n >= 1 && n <= 6).toBe(true);
      expect(["a", "b", "c"]).toContain(r.pick(["a", "b", "c"]));
    }
  });
  it("hashSeed is stable", () => {
    expect(hashSeed(1, "tree")).toBe(hashSeed(1, "tree"));
    expect(hashSeed(1, "tree")).not.toBe(hashSeed(1, "rock"));
  });
});

describe("noise", () => {
  it("stays in [-1, 1], varies and is deterministic", () => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 4000; i++) {
      const x = i * 0.137, y = i * 0.071, z = i * 0.053;
      for (const v of [noise2D(x, y), noise3D(x, y, z), fbm2D(x, y, 5), fbm3D(x, y, z, 4)]) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      const r = ridged2D(x, y, 4);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
    expect(min).toBeLessThan(-0.5);
    expect(max).toBeGreaterThan(0.5);
    expect(noise2D(1.23, 4.56)).toBe(noise2D(1.23, 4.56));
    expect(noise3D(1.23, 4.56, 7.89)).toBe(noise3D(1.23, 4.56, 7.89));
  });
  it("is continuous", () => {
    expect(Math.abs(noise2D(3.3, 1.1) - noise2D(3.3001, 1.1))).toBeLessThan(0.01);
    expect(Math.abs(noise3D(3.3, 1.1, 2) - noise3D(3.3, 1.1001, 2))).toBeLessThan(0.01);
  });
});
