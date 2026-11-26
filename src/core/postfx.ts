// Pure post-processing helpers shared by the runtime (src/runtime/postfx),
// `check` (src/ops/check.ts) and the docs: look-preset expansion, quality
// tiers and the GPU cost estimate. Data lives in the catalog (POSTFX,
// POSTFX_LOOKS, GRADING_LOOKS); no DOM, no Three.js here.

import { catalogEntry, GRADING_LOOKS, POSTFX_LOOKS } from "./catalog";
import { QUALITY_TIERS, TIER_DPR_CAP, type QualityTier } from "./qualityTier";
import type { PostFxDef } from "./types";

export { QUALITY_TIERS, resolveQualityTier, type DeviceHints, type QualityTier } from "./qualityTier";
export type GpuCost = "low" | "medium" | "high";

// ─── Look presets ──────────────────────────────────────────────────────

// Params scaled by `look.intensity` (amount-like params; 0 = effect off).
const SCALED = new Set(["strength", "intensity", "darkness", "amount", "toning", "streaks", "ghosts", "halo", "bleach", "scanlines"]);

/**
 * Expands `{ "type": "look", "preset": … }` entries into their effect stack.
 * An explicit entry of the same type (anywhere in the list) overrides the
 * expanded one param by param and keeps its own position; other expanded
 * effects take the look's position. Duplicates: the first entry wins.
 */
export function expandPostFx(defs: readonly PostFxDef[] | undefined): PostFxDef[] {
  if (!defs?.length) return [];
  const explicit = new Map<string, PostFxDef>();
  const fromLook = new Map<string, PostFxDef>();
  for (const d of defs) {
    if (!d || typeof d.type !== "string") continue;
    if (d.type !== "look") {
      if (!explicit.has(d.type)) explicit.set(d.type, d);
      continue;
    }
    const look = POSTFX_LOOKS[String(d.preset ?? "cinematic") as keyof typeof POSTFX_LOOKS];
    if (!look) continue;
    const k = typeof d.intensity === "number" ? Math.max(0, Math.min(1, d.intensity)) : 1;
    for (const fx of look.effects) {
      if (fromLook.has(fx.type)) continue;
      const scaled: PostFxDef = { ...fx };
      if (k !== 1) {
        for (const [p, v] of Object.entries(fx)) if (SCALED.has(p) && typeof v === "number") scaled[p] = v * k;
        if (fx.type === "grading" && fx.look) scaled.intensity = k;
      }
      fromLook.set(fx.type, scaled);
    }
  }
  const out: PostFxDef[] = [];
  const placed = new Set<string>();
  const emit = (type: string) => {
    if (placed.has(type)) return;
    placed.add(type);
    const own = explicit.get(type), base = fromLook.get(type);
    out.push(own && base ? { ...base, ...own } : (own ?? base)!);
  };
  for (const d of defs) {
    if (!d || typeof d.type !== "string") continue;
    if (d.type !== "look") emit(d.type);
    else for (const fx of POSTFX_LOOKS[String(d.preset ?? "cinematic") as keyof typeof POSTFX_LOOKS]?.effects ?? []) if (!explicit.has(fx.type)) emit(fx.type);
  }
  return out;
}

/** Grading params after blending its procedural `look` by `intensity`, explicit params on top. */
export function resolveGrading(def: PostFxDef): Record<string, number | string | undefined> {
  const neutral: Record<string, number> = { exposure: 0, contrast: 1, saturation: 1, vibrance: 0, temperature: 0, tint: 0, lift: 0, gamma: 1, gain: 1, toning: 0, bleach: 0 };
  const look = def.look && def.look !== "none" ? GRADING_LOOKS[def.look as keyof typeof GRADING_LOOKS] : undefined;
  const k = typeof def.intensity === "number" ? Math.max(0, Math.min(1, def.intensity)) : 1;
  const out: Record<string, number | string | undefined> = { ...neutral };
  if (look) {
    for (const [p, v] of Object.entries(look.values)) {
      if (typeof v === "number") out[p] = neutral[p] + (v - neutral[p]) * k;
      else out[p] = v;
    }
  }
  for (const [p, v] of Object.entries(def)) {
    if (p === "type" || p === "look" || p === "intensity") continue;
    if (typeof v === "number" || typeof v === "string") out[p] = v;
  }
  return out;
}

// ─── Quality tiers ─────────────────────────────────────────────────────

export interface QualitySettings {
  tier: QualityTier;
  /** Upper bound of the device pixel ratio (combined with target.maxDpr). */
  dprCap: number;
  /** MSAA samples of the scene target in the post-processing pipeline (0 = off). */
  msaa: number;
  /** Resolution scale of heavy effects (ao, dof, godrays, lensflare). */
  effectScale: number;
  /** Effects with a GPU cost above this are dropped. */
  maxCost: GpuCost;
  aoSamples: number;
  dofSamples: number;
  rays: number;
  /** Max jittered frames of `taa` stills. */
  maxStillSamples: number;
}

const COST_RANK: Record<GpuCost, number> = { low: 0, medium: 1, high: 2 };

export function qualitySettings(tier: QualityTier): QualitySettings {
  switch (tier) {
    case "low":
      return { tier, dprCap: TIER_DPR_CAP.low, msaa: 0, effectScale: 0.5, maxCost: "medium", aoSamples: 8, dofSamples: 16, rays: 24, maxStillSamples: 4 };
    case "medium":
      return { tier, dprCap: TIER_DPR_CAP.medium, msaa: 4, effectScale: 0.5, maxCost: "high", aoSamples: 12, dofSamples: 24, rays: 32, maxStillSamples: 8 };
    case "ultra":
      return { tier, dprCap: TIER_DPR_CAP.ultra, msaa: 8, effectScale: 1, maxCost: "high", aoSamples: 24, dofSamples: 64, rays: 64, maxStillSamples: 64 };
    default:
      return { tier: "high", dprCap: TIER_DPR_CAP.high, msaa: 4, effectScale: 0.5, maxCost: "high", aoSamples: 16, dofSamples: 40, rays: 48, maxStillSamples: 32 };
  }
}

export function lowerTier(tier: QualityTier): QualityTier | null {
  const i = QUALITY_TIERS.indexOf(tier);
  return i > 0 ? QUALITY_TIERS[i - 1] : null;
}

export function gpuCost(type: string): GpuCost {
  return catalogEntry("postfx", type)?.gpu ?? "low";
}

/** Effects kept for a tier (look presets expanded) + the dropped ones. */
export function activePostFx(defs: readonly PostFxDef[] | undefined, tier: QualityTier): { active: PostFxDef[]; dropped: string[] } {
  const max = COST_RANK[qualitySettings(tier).maxCost];
  const active: PostFxDef[] = [];
  const dropped: string[] = [];
  for (const d of expandPostFx(defs)) {
    if (COST_RANK[gpuCost(d.type)] > max) dropped.push(d.type);
    else active.push(d);
  }
  return { active, dropped };
}

// ─── GPU cost estimate (check) ─────────────────────────────────────────

// Relative per-frame cost of each effect, in "fullscreen pass equivalents" at
// full resolution (a plain textured fullscreen pass = 1). Rough but ordered.
const EFFECT_PASSES: Record<string, number> = {
  ao: 5, // GTAO + denoise at reduced resolution + depth-aware blend
  dof: 4,
  bloom: 3,
  smaa: 3,
  godrays: 2,
  lensflare: 2,
  outline: 1,
  tiltshift: 2,
  fxaa: 1,
  pixelate: 1,
  halftone: 1,
  ascii: 1,
  glitch: 1,
  taa: 0, // stills only
  // merged into the single finish pass
  grading: 0,
  vignette: 0,
  film: 0,
  chromatic: 0,
  sharpen: 0,
};
// The shared normal / depth pre-pass re-draws the scene once.
const PREPASS = 3;
const FINISH = new Set(["grading", "vignette", "film", "chromatic", "sharpen"]);
const GBUFFER = new Set(["ao", "dof", "godrays", "outline"]);

export interface PostFxCostReport {
  effects: { type: string; gpu: GpuCost; passes: number }[];
  /** Fullscreen-pass equivalents per frame (pipeline base: scene + tone mapping + finish = 2). */
  passes: number;
  /** Whether the scene is re-drawn once more for a normal / depth pre-pass. */
  scenePrepass: boolean;
  level: "none" | "light" | "moderate" | "heavy";
  dropped: { low: string[] };
}

export function postfxCost(defs: readonly PostFxDef[] | undefined): PostFxCostReport {
  const list = expandPostFx(defs);
  const effects = list.map((d) => ({ type: d.type, gpu: gpuCost(d.type), passes: EFFECT_PASSES[d.type] ?? 1 }));
  const scenePrepass = list.some((d) => GBUFFER.has(d.type));
  let passes = list.length ? 2 : 0;
  for (const e of effects) passes += e.passes;
  if (scenePrepass) passes += PREPASS;
  if (list.some((d) => FINISH.has(d.type))) passes += 0.5;
  const level = !list.length ? "none" : passes <= 6 ? "light" : passes <= 14 ? "moderate" : "heavy";
  return { effects, passes: Math.round(passes * 10) / 10, scenePrepass, level, dropped: { low: activePostFx(defs, "low").dropped } };
}
