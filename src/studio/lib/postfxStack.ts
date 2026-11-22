// Post-effect stack edits (pure): look preset, reorder, add / remove.
// The Studio writes the whole `postfx` array in one scene_patch op.

import type { PostFxDef } from "../../core/types";

export function lookOf(list: readonly PostFxDef[]): { index: number; preset?: string; intensity?: number } | null {
  const index = list.findIndex((d) => d.type === "look");
  if (index < 0) return null;
  const d = list[index];
  return { index, preset: typeof d.preset === "string" ? d.preset : undefined, intensity: typeof d.intensity === "number" ? d.intensity : undefined };
}

// Sets (or clears with null) the look preset: the look entry stays first so
// explicit effects listed after it override it.
export function setLook(list: readonly PostFxDef[], preset: string | null): PostFxDef[] {
  const cur = lookOf(list);
  const rest = list.filter((d) => d.type !== "look");
  if (!preset) return rest;
  const entry: PostFxDef = { type: "look", preset, ...(cur?.intensity !== undefined ? { intensity: cur.intensity } : {}) };
  return [entry, ...rest];
}

export function moveEffect(list: readonly PostFxDef[], from: number, to: number): PostFxDef[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
  return next;
}

export function removeEffect(list: readonly PostFxDef[], index: number): PostFxDef[] {
  return list.filter((_, i) => i !== index);
}

export function addEffect(list: readonly PostFxDef[], type: string): PostFxDef[] {
  return [...list, { type }];
}
