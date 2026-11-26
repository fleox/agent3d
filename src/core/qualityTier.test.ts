import { describe, expect, it } from "vitest";
import { qualitySettings } from "./postfx";
import { QUALITY_TIERS, TIER_DPR_CAP, resolveQualityTier } from "./qualityTier";

describe("quality tiers (shared by the full and the lite runtime)", () => {
  it("DPR caps match qualitySettings", () => {
    for (const t of QUALITY_TIERS) expect(TIER_DPR_CAP[t]).toBe(qualitySettings(t).dprCap);
  });
  it("picks the tier from the device", () => {
    expect(resolveQualityTier("ultra", { gpu: "SwiftShader" })).toBe("ultra");
    expect(resolveQualityTier("auto", { deterministic: true })).toBe("high");
    expect(resolveQualityTier(undefined, { gpu: "Google SwiftShader" })).toBe("low");
    expect(resolveQualityTier(undefined, { mobile: true, cores: 8, memoryGb: 8 })).toBe("medium");
    expect(resolveQualityTier(undefined, { cores: 4 })).toBe("medium");
    expect(resolveQualityTier(undefined, { cores: 16, gpu: "NVIDIA" })).toBe("high");
  });
});
