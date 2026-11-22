// Timeline playback: turns the player's clock + input into a timeline-local
// time. Auto mode follows `trigger` (load / visible / hover / click / scroll /
// manual) and `autoplay` (a segment name plays only that range); interactions
// and player.playSegment() switch to a segment. Segment playback is stamped
// with scene time, so it is a pure function of (scene, inputs, t) in
// deterministic mode. Markers crossed between two samples are reported.

import type { SegmentDef, TimelineDef } from "../../core/types";
import { timelineTime } from "./sample";

export interface ControllerFrame {
  t: number; // scene time
  dt: number;
  deterministic: boolean;
  staticMotion: boolean;
  posterTime?: number;
  hovered: boolean; // pointer over the embed
  clicked: boolean; // a click on the embed this frame
  scroll: number; // timeline scroll progress 0..1 (already smoothed)
}

interface Range {
  from: number;
  to: number;
  loop: TimelineDef["loop"];
  speed: number;
}

interface Active extends Range {
  name: string;
  start: number; // scene time it started
  startLocal?: number; // resume point (toggle mid-way)
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function resolveTime(v: number | string | undefined, markers: Record<string, number> | undefined, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && markers && typeof markers[v] === "number") return markers[v];
  return fallback;
}

export function resolveSegment(def: TimelineDef, name: string): Range | null {
  const dur = Math.max(def.duration || 0, 1e-3);
  if (name === "timeline") return { from: 0, to: dur, loop: def.loop, speed: 1 };
  const raw = def.segments?.[name];
  if (!raw) return null;
  const s: SegmentDef = Array.isArray(raw) ? { from: raw[0], to: raw[1] } : raw;
  return {
    from: clamp(resolveTime(s.from, def.markers, 0), 0, dur),
    to: clamp(resolveTime(s.to, def.markers, dur), 0, dur),
    loop: s.loop ?? false,
    speed: typeof s.speed === "number" && s.speed > 0 ? s.speed : 1,
  };
}

// Local time inside a range after `elapsed` seconds of playback.
export function rangeTime(r: Range, elapsed: number, startLocal?: number): number {
  const len = Math.abs(r.to - r.from);
  const dir = r.to >= r.from ? 1 : -1;
  const offset = startLocal !== undefined ? Math.abs(startLocal - r.from) : 0;
  const p = len <= 0 ? 0 : timelineTime(Math.max(0, elapsed * r.speed + offset), len, r.loop);
  return r.from + dir * p;
}

// Timeline state read by HUD expressions (`timeline.segment == 'intro'`).
export interface TimelineInfo {
  time: number;
  duration: number;
  progress: number;
  segment: string;
  marker: string;
}

// segment: the explicitly played segment, else the first declared segment
// whose range contains the time ([from, to), the timeline end included),
// else "". marker: the last marker at or before the time ("" before the first).
export function timelineInfo(def: TimelineDef, local: number, playing?: string | null): TimelineInfo {
  const duration = Math.max(def.duration || 0, 1e-3);
  let segment = playing && playing !== "seek" && playing !== "timeline" && def.segments?.[playing] ? playing : "";
  if (!segment)
    for (const name of Object.keys(def.segments ?? {})) {
      const r = resolveSegment(def, name);
      if (!r) continue;
      const a = Math.min(r.from, r.to), b = Math.max(r.from, r.to);
      if (local >= a && (local < b || (b >= duration - 1e-6 && local <= b))) {
        segment = name;
        break;
      }
    }
  let marker = "";
  let best = -Infinity;
  for (const [name, time] of Object.entries(def.markers ?? {}))
    if (typeof time === "number" && time <= local + 1e-6 && time >= best) {
      best = time;
      marker = name;
    }
  return { time: local, duration, progress: clamp(local / duration, 0, 1), segment, marker };
}

export class TimelineController {
  private hoverClock = 0;
  private clickAt = -1;
  private active: Active | null = null;
  private toggled = new Map<string, boolean>();
  private prevLocal: number | null = null;
  private lastLocal = 0;
  private lastT = 0;
  private pending: { name: string; time: number }[] = [];

  constructor(readonly def: TimelineDef) {}

  get duration(): number {
    return Math.max(this.def.duration || 0, 1e-3);
  }

  reset(): void {
    this.hoverClock = 0;
    this.clickAt = -1;
    this.active = null;
    this.toggled.clear();
    this.prevLocal = null;
    this.lastLocal = 0;
    this.lastT = 0;
    this.pending = [];
  }

  // Current local time (last computed).
  get local(): number {
    return this.lastLocal;
  }

  // Play a segment (or "timeline") from its start; reverse swaps from / to.
  play(name: string, t: number, opts: { reverse?: boolean } = {}): boolean {
    const r = resolveSegment(this.def, name);
    if (!r) return false;
    const range = opts.reverse ? { ...r, from: r.to, to: r.from } : r;
    this.active = { ...range, name, start: t };
    this.toggled.set(name, !opts.reverse);
    return true;
  }

  // Forward on the first call, backward (from where it is) on the next one.
  toggle(name: string, t: number): boolean {
    const r = resolveSegment(this.def, name);
    if (!r) return false;
    const forward = !this.toggled.get(name);
    const range = forward ? r : { ...r, from: r.to, to: r.from };
    // Resume from the current position when the segment is mid-way.
    const cur = this.active?.name === name ? this.lastLocal : undefined;
    const inRange = cur !== undefined && cur >= Math.min(r.from, r.to) && cur <= Math.max(r.from, r.to);
    this.active = { ...range, loop: false, name, start: t, startLocal: inRange ? cur : undefined };
    this.toggled.set(name, forward);
    return true;
  }

  // Jump to a time / marker and hold there.
  seek(to: number | string, t: number): void {
    const x = clamp(resolveTime(to, this.def.markers, 0), 0, this.duration);
    this.active = { name: "seek", from: x, to: x, loop: false, speed: 1, start: t };
  }

  private autoRange(): Range {
    const name = typeof this.def.autoplay === "string" ? this.def.autoplay : null;
    const seg = name ? resolveSegment(this.def, name) : null;
    const speed = typeof this.def.speed === "number" && this.def.speed > 0 ? this.def.speed : 1;
    if (seg) return { ...seg, speed: seg.speed * speed };
    return { from: 0, to: this.duration, loop: this.def.loop, speed };
  }

  private autoLocal(f: ControllerFrame): number {
    const r = this.autoRange();
    const trigger = this.def.trigger ?? "visible";
    if (f.staticMotion) {
      // Reduced motion: the poster time, or the end of an autoplay segment.
      return typeof this.def.autoplay === "string" ? r.to : rangeTime({ ...r, speed: 1 }, f.posterTime ?? 0);
    }
    if (trigger === "manual" || this.def.autoplay === false) return r.from;
    if (trigger === "scroll") return r.from + (r.to - r.from) * clamp(f.scroll, 0, 1);
    if (f.deterministic) return rangeTime(r, f.t);
    switch (trigger) {
      case "hover": {
        this.hoverClock += f.hovered ? f.dt : r.loop ? 0 : -f.dt;
        const len = Math.abs(r.to - r.from) / r.speed;
        if (!r.loop) this.hoverClock = clamp(this.hoverClock, 0, len);
        return rangeTime(r, this.hoverClock);
      }
      case "click":
        if (f.clicked) this.clickAt = f.t;
        return this.clickAt < 0 ? r.from : rangeTime(r, f.t - this.clickAt);
      default:
        return rangeTime(r, f.t);
    }
  }

  update(f: ControllerFrame): number {
    let local: number;
    if (this.active && !f.staticMotion) local = rangeTime(this.active, Math.max(0, f.t - this.active.start), this.active.startLocal);
    else local = this.autoLocal(f);
    local = clamp(local, 0, this.duration);
    this.collectMarkers(this.prevLocal, local, f.t < this.lastT);
    this.prevLocal = local;
    this.lastLocal = local;
    this.lastT = f.t;
    return local;
  }

  private collectMarkers(prev: number | null, cur: number, rewound: boolean): void {
    const markers = this.def.markers;
    if (!markers || rewound) return;
    for (const [name, time] of Object.entries(markers)) {
      if (typeof time !== "number") continue;
      let hit: boolean;
      if (prev === null) hit = time <= cur; // first sample: markers already reached fire
      else if (cur > prev) hit = time > prev && time <= cur;
      else if (cur < prev) {
        // Backwards (reverse segment / hover leave) — or a loop wrap.
        const wrapped = this.isLoopingForward();
        hit = wrapped ? time > prev || time <= cur : time < prev && time >= cur;
      } else hit = false;
      if (hit) this.pending.push({ name, time });
    }
  }

  private isLoopingForward(): boolean {
    const r = this.active ?? this.autoRange();
    return !!r.loop && r.loop !== "pingpong" && r.to >= r.from;
  }

  // Timeline state at the last computed time (HUD `timeline.*`).
  info(): TimelineInfo {
    return timelineInfo(this.def, this.lastLocal, this.active?.name);
  }

  // Markers crossed since the last call.
  drainMarkers(): { name: string; time: number }[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }
}
