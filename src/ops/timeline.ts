// Timeline ops (keyframes). Tracks target "<id>.<property>" (see TrackDef).

import type { ProjectFs } from "../core/fs";
import type { InteractionDef, SegmentDef, TimelineDef, TrackDef } from "../core/types";
import { readSceneFile } from "./project";
import { patchScene, type PatchOp, type PatchResult } from "./scene";

type Opts = { dryRun?: boolean };

export async function getTimeline(fs: ProjectFs): Promise<TimelineDef | null> {
  return (await readSceneFile(fs)).timeline ?? null;
}

// Replaces the whole timeline (keys of every track are sorted by time first); null removes it.
export async function setTimeline(fs: ProjectFs, timeline: TimelineDef | null, opts: Opts = {}): Promise<PatchResult> {
  if (timeline === null) {
    const has = (await readSceneFile(fs)).timeline !== undefined;
    return patchScene(fs, has ? [{ op: "remove", path: "timeline" }] : [], opts);
  }
  return patchScene(fs, [{ op: "set", path: "timeline", value: normalizeTimeline(timeline) }], opts);
}

// Adds (or replaces, by target) a track; creates the timeline when missing.
export function addTrack(fs: ProjectFs, track: TrackDef, opts: Opts = {}): Promise<PatchResult> {
  return patchScene(fs, [{ op: "addTrack", track }], opts);
}

export function removeTrack(fs: ProjectFs, target: string, opts: Opts = {}): Promise<PatchResult> {
  return patchScene(fs, [{ op: "removeTrack", target }], opts);
}

// Several track edits + timeline settings + markers / segments in one atomic
// patch. markers / segments merge by name (null removes one).
export async function editTimeline(
  fs: ProjectFs,
  edit: {
    settings?: Partial<Omit<TimelineDef, "tracks">>;
    addTracks?: TrackDef[];
    removeTargets?: string[];
    markers?: Record<string, number | null>;
    segments?: Record<string, SegmentDef | [number | string, number | string] | null>;
  },
  opts: Opts = {},
): Promise<PatchResult> {
  const ops: PatchOp[] = [];
  for (const t of edit.addTracks ?? []) ops.push({ op: "addTrack", track: t });
  for (const t of edit.removeTargets ?? []) ops.push({ op: "removeTrack", target: t });
  const settings: Record<string, unknown> = { ...(edit.settings ?? {}) };
  if (edit.markers && Object.keys(edit.markers).length) settings.markers = { ...((settings.markers as object) ?? {}), ...edit.markers };
  if (edit.segments && Object.keys(edit.segments).length) settings.segments = { ...((settings.segments as object) ?? {}), ...edit.segments };
  if (Object.keys(settings).length) {
    // Settings alone on a scene without a timeline create one.
    if (!ops.length && (await readSceneFile(fs)).timeline === undefined) ops.push({ op: "set", path: "timeline", value: { duration: 4, tracks: [] } });
    ops.push({ op: "merge", path: "timeline", value: settings });
  }
  return patchScene(fs, ops, opts);
}

export async function getInteractions(fs: ProjectFs): Promise<InteractionDef[]> {
  return (await readSceneFile(fs)).interactions ?? [];
}

// Replaces scene.interactions (null or [] removes them) or appends with `add`.
export async function setInteractions(fs: ProjectFs, edit: { interactions?: InteractionDef[] | null; add?: InteractionDef[] }, opts: Opts = {}): Promise<PatchResult> {
  const current = (await readSceneFile(fs)).interactions;
  let next: InteractionDef[] | null = edit.interactions === undefined ? (current ?? []) : edit.interactions;
  if (edit.add?.length) next = [...(next ?? []), ...edit.add];
  if (!next || !next.length) return patchScene(fs, current !== undefined ? [{ op: "remove", path: "interactions" }] : [], opts);
  return patchScene(fs, [{ op: "set", path: "interactions", value: next }], opts);
}

export function normalizeTimeline(t: TimelineDef): TimelineDef {
  return { ...t, tracks: (t.tracks ?? []).map((tr) => ({ ...tr, keys: Array.isArray(tr.keys) ? [...tr.keys].sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0)) : tr.keys })) };
}
