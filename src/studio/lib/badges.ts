// Viewport badges (selected object, camera mode) sit in a canvas corner the
// scene's HUD (scene.ui) leaves free, so in-scene pills never cover them.

import type { UiDef } from "../../core/types";

export type Corner = "tl" | "tr" | "bl" | "br";

export const CORNER_CLASS: Record<Corner, string> = { tl: "left-2 top-2", tr: "right-2 top-2", bl: "left-2 bottom-2", br: "right-2 bottom-2" };

export function hudCorners(ui: UiDef | undefined): Set<Corner> {
  const used = new Set<Corner>();
  for (const el of ui?.elements ?? []) {
    if (el.visible === false) continue;
    const a = el.anchor ?? "top-left";
    if (a === "top-left") used.add("tl");
    else if (a === "top-right") used.add("tr");
    else if (a === "bottom-left") used.add("bl");
    else if (a === "bottom-right") used.add("br");
    // A centre anchor can span its whole row (no side anchor): both corners.
    else if (a === "top") used.add("tl").add("tr");
    else if (a === "bottom") used.add("bl").add("br");
  }
  return used;
}

// Corners for the camera badge (prefers top-right) and the selection badge (prefers top-left).
export function badgeCorners(ui: UiDef | undefined): { camera: Corner; selection: Corner } {
  const used = hudCorners(ui);
  const pick = (order: Corner[], taken?: Corner): Corner => order.find((c) => !used.has(c) && c !== taken) ?? order.find((c) => c !== taken) ?? order[0];
  const camera = pick(["tr", "br", "tl", "bl"]);
  const selection = pick(["tl", "bl", "tr", "br"], camera);
  return { camera, selection };
}
