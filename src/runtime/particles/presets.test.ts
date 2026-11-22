import { describe, expect, it } from "vitest";
import { PARTICLE_PRESETS } from "../../core/catalog";
import { createRng } from "../random";
import { createParticles, particleParams } from "./index";
import { PARTICLE_PRESET_PARAMS, PARTICLE_SHAPES } from "./presets";

describe("particle presets", () => {
  it("every catalog preset has parameters and builds", () => {
    for (const p of PARTICLE_PRESETS) {
      expect(PARTICLE_PRESET_PARAMS[p.id], p.id).toBeTruthy();
      const sys = createParticles({ id: "p", kind: "particles", preset: p.id, count: 20 }, createRng(1));
      expect(sys.points.geometry.getAttribute("position").count).toBe(20);
      sys.update(2.5);
    }
    expect(Object.keys(PARTICLE_PRESET_PARAMS).sort()).toEqual(PARTICLE_PRESETS.map((p) => p.id).sort());
  });

  it("preset shapes are valid shapes", () => {
    for (const [id, p] of Object.entries(PARTICLE_PRESET_PARAMS)) if (p.shape) expect(PARTICLE_SHAPES, id).toContain(p.shape);
  });

  it("emitter presets carry gravity / colour over life / stretching", () => {
    const sparks = particleParams({ id: "s", kind: "particles", preset: "sparks" });
    expect(sparks.gravity[1]).toBeLessThan(0);
    expect(sparks.stretch).toBeGreaterThan(1);
    expect(sparks.endColor).toBeTruthy();
    const smoke = particleParams({ id: "s", kind: "particles", preset: "smoke" });
    expect(smoke.endSize).toBeGreaterThan(1);
    const sys = createParticles({ id: "s", kind: "particles", preset: "fire" }, createRng(2));
    const u = (sys.points.material as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    expect(u.uUseEnd!.value).toBe(1);
  });
});
