// The Studio's view of the timeline clock (pure, mirrors
// src/runtime/timeline/controller.ts without importing the runtime):
// player (scene) time ↔ timeline time, honouring timeline.speed, loop and
// a segment played from the segments list.
//
// While editing, the viewport plays the whole timeline from load (whatever
// its trigger / autoplay segment), so scrubbing shows every time; the
// interact mode (I) keeps the real triggers.

import type { SceneDoc, SegmentDef, TimelineDef } from "../../core/types";

export interface ClockRange {
  from: number;
  to: number;
  loop: TimelineDef["loop"];
  speed: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function loopTime(t: number, duration: number, loop: TimelineDef["loop"]): number {
  if (!(duration > 0)) return 0;
  if (!loop) return Math.min(Math.max(t, 0), duration);
  if (loop === "pingpong") {
    const c = t % (2 * duration);
    return c > duration ? 2 * duration - c : c;
  }
  return t % duration;
}

export function resolveTime(v: number | string | undefined, markers: Record<string, number> | undefined, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && markers && typeof markers[v] === "number") return markers[v];
  return fallback;
}

export function segmentRange(tl: TimelineDef, name: string): ClockRange | null {
  const dur = Math.max(tl.duration || 0, 1e-3);
  if (name === "timeline") return { from: 0, to: dur, loop: tl.loop, speed: 1 };
  const raw = tl.segments?.[name];
  if (!raw) return null;
  const s: SegmentDef = Array.isArray(raw) ? { from: raw[0], to: raw[1] } : raw;
  return { from: clamp(resolveTime(s.from, tl.markers, 0), 0, dur), to: clamp(resolveTime(s.to, tl.markers, dur), 0, dur), loop: s.loop ?? false, speed: typeof s.speed === "number" && s.speed > 0 ? s.speed : 1 };
}

export function rangeTime(r: ClockRange, elapsed: number): number {
  const len = Math.abs(r.to - r.from);
  const dir = r.to >= r.from ? 1 : -1;
  return r.from + dir * (len <= 0 ? 0 : loopTime(Math.max(0, elapsed * r.speed), len, r.loop));
}

export const timelineSpeed = (tl: TimelineDef | undefined): number => (tl && typeof tl.speed === "number" && tl.speed > 0 ? tl.speed : 1);

// Timeline time shown for player time t. `segment`: the one playing (started at scene time `start`).
export function timelineTime(t: number, scene: SceneDoc | null, segment?: { range: ClockRange; start: number } | null): number {
  const tl = scene?.timeline;
  if (!tl || !(tl.duration > 0)) return t;
  if (segment) return clamp(rangeTime(segment.range, Math.max(0, t - segment.start)), 0, tl.duration);
  return clamp(rangeTime({ from: 0, to: tl.duration, loop: tl.loop, speed: timelineSpeed(tl) }, t), 0, tl.duration);
}

// Player time that shows timeline time T (the editing clock, no segment).
export function sceneTimeFor(T: number, scene: SceneDoc | null): number {
  const tl = scene?.timeline;
  if (!tl || !(tl.duration > 0)) return Math.max(0, T);
  return clamp(T, 0, tl.duration) / timelineSpeed(tl);
}

// The scene the editing (non-interact) viewport shows: the whole timeline
// from load (any trigger / autoplay segment) so the scrubber maps to scene
// time × speed, and no game scripts — they would move objects away from where
// the user clicks; scripts only run in interact mode (I).
export function editingScene(scene: SceneDoc): SceneDoc {
  const tl = scene.timeline;
  const tlOk = !tl || ((tl.trigger === undefined || tl.trigger === "load" || tl.trigger === "visible") && tl.autoplay === undefined);
  const scripts = !!scene.scripts?.length;
  if (tlOk && !scripts) return scene;
  let out: SceneDoc = scene;
  if (!tlOk && tl) {
    const { autoplay: _a, ...rest } = tl;
    out = { ...out, timeline: { ...rest, trigger: "load" } };
  }
  if (scripts) {
    const { scripts: _s, ...rest } = out;
    out = rest as SceneDoc;
  }
  return out;
}
