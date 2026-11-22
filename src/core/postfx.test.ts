import { describe, expect, it } from "vitest";
import { POSTFX, POSTFX_LOOKS, GRADING_LOOKS, catalogEntry } from "./catalog";
import { activePostFx, expandPostFx, lowerTier, postfxCost, qualitySettings, resolveGrading, resolveQualityTier } from "./postfx";
import { defaultScene, validateScene } from "./validate";
import { postfxReport } from "../ops/postfxCheck";

describe("post effect catalog", () => {
  it("every effect declares a GPU cost tier", () => {
    for (const e of POSTFX) expect(["low", "medium", "high"], e.id).toContain(e.gpu);
  });
  it("look presets and grading looks only reference catalog ids / params", () => {
    for (const [id, look] of Object.entries(POSTFX_LOOKS)) {
      for (const fx of look.effects) {
        const entry = catalogEntry("postfx", fx.type);
        expect(entry, `${id} → ${fx.type}`).toBeTruthy();
        for (const k of Object.keys(fx)) if (k !== "type") expect(entry!.params.map((p) => p.name), `${id}.${fx.type}.${k}`).toContain(k);
      }
      // Each expanded look is a valid scene postfx.
      const s = defaultScene({ kind: "hero" });
      s.postfx = expandPostFx([{ type: "look", preset: id }]);
      expect(validateScene(s).filter((i) => i.severity === "error"), id).toEqual([]);
    }
    const grading = catalogEntry("postfx", "grading")!.params.map((p) => p.name);
    for (const [id, g] of Object.entries(GRADING_LOOKS)) for (const k of Object.keys(g.values)) expect(grading, `${id}.${k}`).toContain(k);
  });
});

describe("expandPostFx", () => {
  it("expands a look into its stack", () => {
    expect(expandPostFx([{ type: "look", preset: "neon" }]).map((d) => d.type)).toEqual(POSTFX_LOOKS.neon.effects.map((d) => d.type));
  });
  it("explicit entries override the look param by param and keep their position", () => {
    const out = expandPostFx([{ type: "vignette", darkness: 0.2 }, { type: "look", preset: "cinematic" }]);
    expect(out[0]).toEqual({ type: "vignette", offset: 1, darkness: 0.2 });
    expect(out.filter((d) => d.type === "vignette")).toHaveLength(1);
    expect(out.map((d) => d.type)).toContain("ao");
  });
  it("scales amounts with look.intensity", () => {
    const out = expandPostFx([{ type: "look", preset: "cinematic", intensity: 0.5 }]);
    expect(out.find((d) => d.type === "vignette")?.darkness).toBeCloseTo(0.375);
    expect(out.find((d) => d.type === "grading")?.intensity).toBe(0.5);
    expect(out.find((d) => d.type === "ao")?.radius).toBe(0.6); // not an amount
  });
  it("keeps plain stacks as they are (first duplicate wins)", () => {
    expect(expandPostFx([{ type: "bloom", strength: 1 }, { type: "bloom", strength: 2 }])).toEqual([{ type: "bloom", strength: 1 }]);
    expect(expandPostFx(undefined)).toEqual([]);
  });
});

describe("resolveGrading", () => {
  it("blends a look by intensity and lets explicit params win", () => {
    const g = resolveGrading({ type: "grading", look: "noir", intensity: 0.5, contrast: 2 });
    expect(g.saturation).toBeCloseTo(0.5);
    expect(g.contrast).toBe(2);
    expect(resolveGrading({ type: "grading" })).toMatchObject({ contrast: 1, saturation: 1, exposure: 0 });
  });
});

describe("quality tiers", () => {
  it("resolves auto from device hints", () => {
    expect(resolveQualityTier(undefined, { deterministic: true, gpu: "SwiftShader" })).toBe("high");
    expect(resolveQualityTier("auto", { gpu: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))" })).toBe("low");
    expect(resolveQualityTier("auto", { mobile: true, cores: 8, memoryGb: 8 })).toBe("medium");
    expect(resolveQualityTier("auto", { mobile: true, cores: 4 })).toBe("low");
    expect(resolveQualityTier("auto", { cores: 16, memoryGb: 16, gpu: "NVIDIA GeForce RTX 4070" })).toBe("high");
    expect(resolveQualityTier("ultra", { mobile: true })).toBe("ultra");
  });
  it("steps down and drops high-cost effects on low", () => {
    expect(lowerTier("ultra")).toBe("high");
    expect(lowerTier("low")).toBeNull();
    const { active, dropped } = activePostFx([{ type: "ao" }, { type: "bloom" }, { type: "dof" }], "low");
    expect(active.map((d) => d.type)).toEqual(["bloom"]);
    expect(dropped).toEqual(["ao", "dof"]);
    expect(activePostFx([{ type: "ao" }], "medium").active).toHaveLength(1);
    expect(qualitySettings("low").dprCap).toBe(1);
  });
});

describe("GPU cost report", () => {
  it("estimates passes and levels", () => {
    expect(postfxCost([]).level).toBe("none");
    expect(postfxCost([{ type: "vignette" }, { type: "grading" }]).level).toBe("light");
    const heavy = postfxCost([{ type: "ao" }, { type: "dof" }, { type: "bloom" }, { type: "smaa" }, { type: "lensflare" }]);
    expect(heavy.level).toBe("heavy");
    expect(heavy.scenePrepass).toBe(true);
    expect(heavy.dropped.low).toEqual(["ao", "dof"]);
  });
  it("check warns about heavy effects on games", () => {
    const s = defaultScene({ kind: "game" });
    s.postfx = [{ type: "look", preset: "cinematic" }];
    const r = postfxReport(s);
    expect(r.issues.map((i) => i.code)).toContain("postfx-cost");
    expect(r.issues[0].message).toContain("ao");
    expect(r.gpu.quality).toBe("auto");
    const banner = defaultScene({ kind: "banner" });
    banner.postfx = [{ type: "bloom" }, { type: "vignette" }];
    expect(postfxReport(banner).issues).toEqual([]);
  });
});

describe("validation", () => {
  it("checks target.quality, dof.focusOn and godrays.source", () => {
    const s = defaultScene({ kind: "hero" });
    (s.target as unknown as Record<string, unknown>).quality = "extreme";
    s.postfx = [{ type: "dof", focusOn: "nope" }, { type: "godrays", source: "sunn" }, { type: "fxaa" }, { type: "smaa" }];
    const issues = validateScene(s);
    expect(issues.find((i) => i.path === "target.quality")?.severity).toBe("error");
    expect(issues.find((i) => i.path === "postfx[0].focusOn")?.severity).toBe("error");
    expect(issues.find((i) => i.path === "postfx[1].source")?.severity).toBe("error");
    expect(issues.find((i) => i.path === "postfx" && i.severity === "warning")).toBeTruthy();
    s.target.quality = "auto";
    s.postfx = [{ type: "look", preset: "product", intensity: 0.8 }, { type: "godrays", source: "sun" }];
    expect(validateScene(s).filter((i) => i.path.startsWith("postfx") || i.path.startsWith("target"))).toEqual([]);
  });
});
