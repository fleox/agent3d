// Post-processing part of `check`: estimated GPU cost of the postfx stack
// (look presets expanded) and warnings about heavy effects where they hurt
// (games, phones), from the catalog `gpu` tiers (src/core/postfx.ts).

import { postfxCost, type PostFxCostReport } from "../core/postfx";
import type { Issue, SceneDoc } from "../core/types";

export interface GpuReport extends PostFxCostReport {
  quality: NonNullable<SceneDoc["target"]["quality"]>;
}

export function postfxReport(scene: SceneDoc): { gpu: GpuReport; issues: Issue[] } {
  const quality = scene.target?.quality ?? "auto";
  const cost = postfxCost(scene.postfx);
  const issues: Issue[] = [];
  const kind = scene.target?.kind;
  const heavy = cost.effects.filter((e) => e.gpu === "high").map((e) => e.type);
  if (kind === "game" && heavy.length) {
    issues.push({
      severity: "warning",
      code: "postfx-cost",
      path: "postfx",
      message: `${heavy.join(", ")} on a game target: ${heavy.length > 1 ? "these effects re-render" : "this effect re-renders"} the scene depth / normals and sample${heavy.length > 1 ? "" : "s"} heavily every frame — frame drops on laptops and phones.`,
      hint: 'Games need a steady 60 fps: remove them, or keep cheap effects only (bloom, grading, vignette, fxaa). target.quality "auto" also drops them on weak devices.',
    });
  }
  if (cost.level === "heavy") {
    issues.push({
      severity: kind === "game" || kind === "fullscreen" ? "warning" : "info",
      code: "postfx-cost",
      path: "postfx",
      message: `Post-processing costs ~${cost.passes} fullscreen passes per frame (${cost.effects.map((e) => e.type).join(", ")}).`,
      hint: "Keep the effects that change the image the most; grading / vignette / film / chromatic / sharpen are merged into one pass and nearly free, ao / dof / smaa / bloom are not.",
    });
  }
  if (quality === "ultra" && kind !== "fullscreen" && kind !== "hero") {
    issues.push({ severity: "info", code: "quality", path: "target.quality", message: `quality "ultra" on a ${kind}: full-resolution effects and MSAA 8 for every visitor.`, hint: 'Use "auto" (adapts to the device and frame rate) or "high".' });
  }
  if (quality === "low" && heavy.length) {
    issues.push({ severity: "info", code: "quality", path: "target.quality", message: `quality "low" disables ${heavy.join(", ")} (cost "high").`, hint: 'Remove them from postfx, or use quality "auto" / "medium".' });
  }
  return { gpu: { ...cost, quality }, issues };
}
