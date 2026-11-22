// Drag & drop from the Add panel to the viewport: the payload travels in
// dataTransfer under a private MIME type; the viewport places it where dropped.

import type { LightDef } from "../../core/types";
import type { NewObjectSpec } from "./patches";

export const DND_TYPE = "application/x-agent3d-add";

export type DropPayload = { object: NewObjectSpec } | { light: Omit<LightDef, "id"> };

export function setDragPayload(e: { dataTransfer: DataTransfer | null }, payload: DropPayload): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copy";
}

export function hasDragPayload(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DND_TYPE);
}

export function readDragPayload(e: { dataTransfer: DataTransfer | null }): DropPayload | null {
  try {
    const raw = e.dataTransfer?.getData(DND_TYPE);
    if (!raw) return null;
    const p = JSON.parse(raw) as DropPayload;
    return p && typeof p === "object" && ("object" in p || "light" in p) ? p : null;
  } catch {
    return null;
  }
}

// Where a dropped light goes: above / in front of the drop point, aimed at it.
export function placeLight(def: Omit<LightDef, "id">, point: [number, number, number]): Omit<LightDef, "id"> {
  const r = (v: number) => Math.round(v * 100) / 100 || 0;
  const [x, y, z] = point;
  if (def.type === "ambient" || def.type === "hemisphere") return def;
  if (def.type === "point") return { ...def, position: [r(x), r(y + 1.5), r(z)] };
  return { ...def, position: [r(x + 2), r(y + 4), r(z + 3)], target: [r(x), r(y), r(z)] };
}
