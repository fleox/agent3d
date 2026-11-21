// Timeline ops (keyframes). Tracks target "<id>.<property>" (see TrackDef).

import type { ProjectFs } from "../core/fs";
import type { TimelineDef, TrackDef } from "../core/types";
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

// Several track edits + timeline settings in one atomic patch.
export function editTimeline(
  fs: ProjectFs,
  edit: { settings?: Partial<Omit<TimelineDef, "tracks">>; addTracks?: TrackDef[]; removeTargets?: string[] },
  opts: Opts = {},
): Promise<PatchResult> {
  const ops: PatchOp[] = [];
  for (const t of edit.addTracks ?? []) ops.push({ op: "addTrack", track: t });
  for (const t of edit.removeTargets ?? []) ops.push({ op: "removeTrack", target: t });
  if (edit.settings && Object.keys(edit.settings).length) ops.push({ op: "merge", path: "timeline", value: edit.settings });
  return patchScene(fs, ops, opts);
}

export function normalizeTimeline(t: TimelineDef): TimelineDef {
  return { ...t, tracks: (t.tracks ?? []).map((tr) => ({ ...tr, keys: Array.isArray(tr.keys) ? [...tr.keys].sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0)) : tr.keys })) };
}
