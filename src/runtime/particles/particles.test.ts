import { describe, expect, it } from "vitest";
import { createRng } from "../random";
import { createParticles, particleParams } from "./index";

describe("particles", () => {
  it("object fields override the preset", () => {
    const p = particleParams({ id: "p", kind: "particles", preset: "snow", count: 10, color: "#ff0000", shape: "star" });
    expect(p.count).toBe(10);
    expect(p.colors).toEqual(["#ff0000"]);
    expect(p.shape).toBe("star");
    expect(p.direction).toEqual([0, -1, 0]);
  });
  it("builds a deterministic point cloud", () => {
    const a = createParticles({ id: "p", kind: "particles", preset: "confetti", count: 50 }, createRng(3));
    const b = createParticles({ id: "p", kind: "particles", preset: "confetti", count: 50 }, createRng(3));
    expect(a.points.geometry.getAttribute("position").count).toBe(50);
    expect(Array.from(a.points.geometry.getAttribute("aRand").array)).toEqual(Array.from(b.points.geometry.getAttribute("aRand").array));
  });
});
