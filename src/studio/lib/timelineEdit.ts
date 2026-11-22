// Markers and segments edits (pure). Renames keep references working:
// segment from / to, autoplay and interactions (play / toggle / seek / event).

import type { InteractionDef, SceneDoc, SegmentDef, TimelineDef } from "../../core/types";
import type { PatchOp } from "../../ops/scene";

export type SegmentObj = SegmentDef;

export const segmentObj = (raw: SegmentDef | [number | string, number | string]): SegmentDef => (Array.isArray(raw) ? { from: raw[0], to: raw[1] } : raw);

export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export const NAME_RE = /^[A-Za-z][\w-]*$/;

function timelineOps(scene: SceneDoc, tl: TimelineDef, interactions?: InteractionDef[]): PatchOp[] {
  const ops: PatchOp[] = [{ op: "set", path: "timeline", value: tl }];
  if (interactions && JSON.stringify(interactions) !== JSON.stringify(scene.interactions ?? [])) ops.push({ op: "set", path: "interactions", value: interactions });
  return ops;
}

const clean = (tl: TimelineDef): TimelineDef => {
  const out = { ...tl };
  if (out.markers && !Object.keys(out.markers).length) delete out.markers;
  if (out.segments && !Object.keys(out.segments).length) delete out.segments;
  return out;
};

export function setMarkerOps(scene: SceneDoc, name: string, time: number): PatchOp[] {
  const tl = scene.timeline;
  if (!tl) return [];
  return [{ op: "set", path: "timeline.markers", value: { ...(tl.markers ?? {}), [name]: Math.round(Math.max(0, Math.min(tl.duration, time)) * 1000) / 1000 } }];
}

export function addMarkerOps(scene: SceneDoc, time: number): { ops: PatchOp[]; name: string } {
  const name = uniqueName("marker", Object.keys(scene.timeline?.markers ?? {}));
  return { ops: setMarkerOps(scene, name, time), name };
}

export function renameMarkerOps(scene: SceneDoc, from: string, to: string): PatchOp[] {
  const tl = scene.timeline;
  if (!tl?.markers || !(from in tl.markers) || from === to || !NAME_RE.test(to) || to in tl.markers) return [];
  const markers = Object.fromEntries(Object.entries(tl.markers).map(([k, v]) => [k === from ? to : k, v]));
  const ref = (v: number | string) => (v === from ? to : v);
  const segments = tl.segments ? Object.fromEntries(Object.entries(tl.segments).map(([k, raw]) => { const s = segmentObj(raw); return [k, Array.isArray(raw) ? [ref(raw[0]), ref(raw[1])] : { ...s, from: ref(s.from), to: ref(s.to) }]; })) : undefined;
  const interactions = scene.interactions?.map((it) => ({ ...it, ...(it.on === "event" && it.event === from ? { event: to } : {}), do: it.do.map((a) => ("seek" in a && a.seek === from ? { ...a, seek: to } : a)) }));
  return timelineOps(scene, clean({ ...tl, markers, ...(segments ? { segments: segments as TimelineDef["segments"] } : {}) }), interactions);
}

// Removing a marker: segment bounds and seeks that used it keep its time.
export function removeMarkerOps(scene: SceneDoc, name: string): PatchOp[] {
  const tl = scene.timeline;
  if (!tl?.markers || !(name in tl.markers)) return [];
  const at = tl.markers[name];
  const markers = { ...tl.markers };
  delete markers[name];
  const ref = (v: number | string) => (v === name ? at : v);
  const segments = tl.segments ? Object.fromEntries(Object.entries(tl.segments).map(([k, raw]) => [k, Array.isArray(raw) ? [ref(raw[0]), ref(raw[1])] : { ...raw, from: ref(raw.from), to: ref(raw.to) }])) : undefined;
  const interactions = scene.interactions?.map((it) => ({ ...it, do: it.do.map((a) => ("seek" in a && a.seek === name ? { ...a, seek: at } : a)) }));
  return timelineOps(scene, clean({ ...tl, markers, ...(segments ? { segments: segments as TimelineDef["segments"] } : {}) }), interactions);
}

export function addSegmentOps(scene: SceneDoc, from: number): { ops: PatchOp[]; name: string } {
  const tl = scene.timeline;
  if (!tl) return { ops: [], name: "" };
  const name = uniqueName("segment", Object.keys(tl.segments ?? {}));
  const f = Math.round(Math.min(from, Math.max(0, tl.duration - 0.5)) * 100) / 100;
  const to = Math.round(Math.min(tl.duration, f + Math.min(1, tl.duration)) * 100) / 100;
  return { ops: [{ op: "set", path: "timeline.segments", value: { ...(tl.segments ?? {}), [name]: { from: f, to } } }], name };
}

export function renameSegmentOps(scene: SceneDoc, from: string, to: string): PatchOp[] {
  const tl = scene.timeline;
  if (!tl?.segments || !(from in tl.segments) || from === to || !NAME_RE.test(to) || to in tl.segments || to === "timeline") return [];
  const segments = Object.fromEntries(Object.entries(tl.segments).map(([k, v]) => [k === from ? to : k, v]));
  const interactions = scene.interactions?.map((it) => ({ ...it, do: it.do.map((a) => ("play" in a && a.play === from ? { ...a, play: to } : "toggle" in a && a.toggle === from ? { ...a, toggle: to } : a)) }));
  return timelineOps(scene, { ...tl, segments, ...(tl.autoplay === from ? { autoplay: to } : {}) }, interactions);
}

export function removeSegmentOps(scene: SceneDoc, name: string): PatchOp[] {
  const tl = scene.timeline;
  if (!tl?.segments || !(name in tl.segments)) return [];
  const segments = { ...tl.segments };
  delete segments[name];
  const next = clean({ ...tl, segments });
  if (next.autoplay === name) delete next.autoplay;
  return [{ op: "set", path: "timeline", value: next }];
}

// Seconds of a segment bound (number or marker name).
export function boundTime(v: number | string, tl: TimelineDef): number {
  return typeof v === "number" ? v : (tl.markers?.[v] ?? 0);
}
