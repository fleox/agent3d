// Quality tiers: which tier a player starts with (from target.quality and the
// device) and the pixel-ratio cap of each tier. No catalog, no Three.js, no
// DOM: shared by src/core/postfx.ts (qualitySettings), the full player and the
// photo-only lite runtime (src/runtime/lite/), which must pick the same tier.

import type { TargetDef } from "./types";

export type QualityTier = "low" | "medium" | "high" | "ultra";
export const QUALITY_TIERS: readonly QualityTier[] = ["low", "medium", "high", "ultra"];

/** Upper bound of the device pixel ratio per tier (combined with target.maxDpr). */
export const TIER_DPR_CAP: Record<QualityTier, number> = { low: 1, medium: 1.5, high: 2, ultra: 3 };

export interface DeviceHints {
  deterministic?: boolean;
  mobile?: boolean;
  cores?: number;
  memoryGb?: number;
  gpu?: string; // unmasked renderer string when available
}

/** The tier a player starts with. "auto" never picks "ultra"; deterministic renders use "high". */
export function resolveQualityTier(requested: TargetDef["quality"], hints: DeviceHints = {}): QualityTier {
  if (requested && requested !== "auto") return requested;
  if (hints.deterministic) return "high";
  if (hints.gpu && /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(hints.gpu)) return "low";
  if (hints.mobile) return (hints.memoryGb ?? 4) <= 2 || (hints.cores ?? 8) <= 4 ? "low" : "medium";
  if ((hints.cores !== undefined && hints.cores <= 2) || (hints.memoryGb !== undefined && hints.memoryGb <= 2)) return "low";
  if ((hints.cores !== undefined && hints.cores <= 4) || (hints.memoryGb !== undefined && hints.memoryGb <= 4) || (hints.gpu && /intel|mali|adreno|powervr/i.test(hints.gpu))) return "medium";
  return "high";
}
