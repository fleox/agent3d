// Easing editor helpers (pure): parsed ease ↔ spec string, SVG curve paths.

import { parseEase, type ParsedEase } from "../../core/ease";
import { easeFn } from "../../runtime/timeline/easing";

export type EaseKind = ParsedEase["kind"];

const num = (n: number, d = 3) => String(Number(n.toFixed(d)));

export function formatEase(p: ParsedEase): string {
  switch (p.kind) {
    case "named":
      return p.name;
    case "cubicBezier":
      return `cubicBezier(${num(p.x1)}, ${num(p.y1)}, ${num(p.x2)}, ${num(p.y2)})`;
    case "spring":
      return p.mass === 1 ? `spring(${num(p.stiffness, 1)}, ${num(p.damping, 1)})` : `spring(${num(p.stiffness, 1)}, ${num(p.damping, 1)}, ${num(p.mass, 2)})`;
    case "steps":
      return p.jumpStart ? `steps(${p.count}, start)` : `steps(${p.count})`;
  }
}

// Parsed form of a spec (invalid / missing → the fallback name).
export function parsedOf(spec: string | undefined, fallback = "linear"): ParsedEase {
  const p = parseEase(spec ?? fallback);
  return "error" in p ? { kind: "named", name: fallback } : p;
}

export const DEFAULTS: Record<EaseKind, ParsedEase> = {
  named: { kind: "named", name: "inOutCubic" },
  cubicBezier: { kind: "cubicBezier", x1: 0.22, y1: 1, x2: 0.36, y2: 1 },
  spring: { kind: "spring", stiffness: 170, damping: 18, mass: 1 },
  steps: { kind: "steps", count: 4, jumpStart: false },
};

export const BEZIER_PRESETS: { name: string; v: [number, number, number, number] }[] = [
  { name: "ease", v: [0.25, 0.1, 0.25, 1] },
  { name: "easeOut", v: [0, 0, 0.58, 1] },
  { name: "expo", v: [0.16, 1, 0.3, 1] },
  { name: "snappy", v: [0.22, 1, 0.36, 1] },
  { name: "anticipate", v: [0.68, -0.6, 0.32, 1.6] },
];

// The curve of an easing as SVG path data in a w × h box (y up, 0 → bottom - pad).
// Values may overshoot: `range` is the [min, max] mapped to the box.
export function curvePath(spec: string, w: number, h: number, opts: { pad?: number; range?: [number, number]; samples?: number } = {}): string {
  const f = easeFn(spec);
  const pad = opts.pad ?? 2;
  const [lo, hi] = opts.range ?? [0, 1];
  const n = opts.samples ?? 48;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = f(t);
    const x = pad + t * (w - 2 * pad);
    const y = h - pad - ((v - lo) / (hi - lo || 1)) * (h - 2 * pad);
    pts.push(`${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join("");
}

// Range of values an easing reaches (for overshooting curves), padded, always ⊇ [0, 1].
export function curveRange(spec: string): [number, number] {
  const f = easeFn(spec);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i <= 64; i++) {
    const v = f(i / 64);
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
}
