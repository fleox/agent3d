// Property overrides set by interactions ({ set: { path, value }, duration,
// ease }): tweened from the value shown when the action fired to the new
// value, then held. Applied every frame after the timeline (before
// behaviours), keyed by scene time so they stay deterministic. reset()
// restores the original values (deterministic rewind).

import type { KeyValue, TrackKey } from "../../core/types";
import { bindProperty, selectIds, type Accessor, type TimelineHost } from "./index";
import { ease } from "./easing";
import { interpolate, resolveKeys, splitTarget, type AbsKey, type Sampled } from "./sample";

interface Override {
  acc: Accessor;
  from: AbsKey[1];
  to: AbsKey[1];
  start: number;
  duration: number;
  ease?: string;
  orig: Sampled | undefined;
  last: Sampled | undefined;
}

function toAbs(v: Sampled | undefined): AbsKey[1] | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "object" && !Array.isArray(v)) return `#${v.getHexString()}`;
  return v;
}

export class PropertyOverrides {
  private list = new Map<string, Override>();

  constructor(private host: TimelineHost) {}

  get size(): number {
    return this.list.size;
  }

  // Ids an override path touches (so the world resets them each frame).
  idsOf(path: string): string[] {
    return selectIds(splitTarget(path).id, this.host);
  }

  set(path: string, value: KeyValue, t: number, duration = 0, easeName?: string): void {
    const { id: selector, path: prop } = splitTarget(path);
    for (const id of selectIds(selector, this.host)) {
      const key = `${id}.${prop}`;
      const prev = this.list.get(key);
      const acc = prev?.acc ?? bindProperty(id, prop, this.host, `interactions:${path}`);
      if (!acc) continue;
      const current = prev?.last ?? acc.get();
      const [[, to]] = resolveKeys([[0, value]] as TrackKey[], current);
      const from = toAbs(current) ?? to;
      this.list.set(key, { acc, from, to, start: t, duration: Math.max(0, duration), ease: easeName, orig: prev ? prev.orig : acc.get(), last: current });
    }
  }

  apply(t: number): void {
    for (const o of this.list.values()) {
      const k = o.duration > 0 ? ease(o.ease ?? "outCubic", (t - o.start) / o.duration) : 1;
      const v = typeof o.to === "boolean" || typeof o.from === "boolean" ? (k >= 1 ? o.to : o.from) : interpolate(o.from, o.to, t < o.start ? 0 : k);
      const s: Sampled = typeof v === "string" ? interpolate(v, v, 1) : (v as Sampled);
      o.acc.set(s);
      o.last = s;
    }
  }

  reset(): void {
    for (const o of this.list.values()) if (o.orig !== undefined) o.acc.set(o.orig);
    this.list.clear();
  }
}
