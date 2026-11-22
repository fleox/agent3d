// Easing functions (src/core/ease.ts lists the names and the parametric
// syntax). Pure: t in [0,1] → value (back / elastic / spring / bezier may
// overshoot outside [0,1]). Every easing maps 0 → 0 and 1 → 1.

import { parseEase, type ParsedEase } from "../../core/ease";

type Fn = (t: number) => number;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

function outBounce(t: number): number {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

// in / out / inOut from an "in" curve.
function family(f: Fn): [Fn, Fn, Fn] {
  return [f, (t) => 1 - f(1 - t), (t) => (t < 0.5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2)];
}

const [inQuad, outQuad, inOutQuad] = family((t) => t * t);
const [inCubic, outCubic, inOutCubic] = family((t) => t * t * t);
const [inQuart, outQuart, inOutQuart] = family((t) => t * t * t * t);
const [inQuint, outQuint, inOutQuint] = family((t) => t * t * t * t * t);
const [inCirc, outCirc, inOutCirc] = family((t) => 1 - Math.sqrt(1 - Math.min(t * t, 1)));
const inBounce: Fn = (t) => 1 - outBounce(1 - t);

export const EASINGS: Record<string, Fn> = {
  linear: (t) => t,
  inQuad, outQuad, inOutQuad,
  inCubic, outCubic, inOutCubic,
  inQuart, outQuart, inOutQuart,
  inQuint, outQuint, inOutQuint,
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  inCirc, outCirc, inOutCirc,
  inBack: (t) => c3 * t * t * t - c1 * t * t,
  outBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  inOutBack: (t) => (t < 0.5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2),
  inElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4)),
  outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  inOutElastic: (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2 : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1,
  inBounce,
  outBounce,
  inOutBounce: (t) => (t < 0.5 ? (1 - outBounce(1 - 2 * t)) / 2 : (1 + outBounce(2 * t - 1)) / 2),
  step: (t) => (t >= 1 ? 1 : 0),
};

// CSS cubic-bezier: solve x(u) = t (Newton, then bisection), return y(u).
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Fn {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - t;
      if (Math.abs(err) < 1e-6) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0, hi = 1;
    u = t;
    for (let i = 0; i < 40; i++) {
      const x = sx(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

// Damped spring from 0 to 1. The physical duration is the settle time (the
// envelope falls under 0.1 %), so the curve fits the segment it eases.
export function spring(stiffness: number, damping: number, mass = 1): Fn {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const settle = zeta < 1 ? 6.9 / (zeta * w0) : 6.9 / (w0 * (zeta - Math.sqrt(Math.max(zeta * zeta - 1, 0)) || 1e-3));
  const T = Math.min(Math.max(settle, 1e-3), 60);
  let x: (tau: number) => number;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = (tau) => 1 - Math.exp(-zeta * w0 * tau) * (Math.cos(wd * tau) + ((zeta * w0) / wd) * Math.sin(wd * tau));
  } else if (zeta === 1) {
    x = (tau) => 1 - Math.exp(-w0 * tau) * (1 + w0 * tau);
  } else {
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
    x = (tau) => 1 - (r2 * Math.exp(r1 * tau) - r1 * Math.exp(r2 * tau)) / (r2 - r1);
  }
  // Blend the last 0.1 % so f(1) is exactly 1.
  const end = x(T);
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : x(t * T) + (1 - end) * t);
}

export function steps(count: number, jumpStart = false): Fn {
  const n = Math.max(1, Math.floor(count));
  return (t) => (t >= 1 ? 1 : t <= 0 ? 0 : Math.min(1, (jumpStart ? Math.ceil(t * n) : Math.floor(t * n)) / n));
}

function build(p: ParsedEase): Fn {
  switch (p.kind) {
    case "named":
      return EASINGS[p.name] ?? EASINGS.linear;
    case "cubicBezier":
      return cubicBezier(p.x1, p.y1, p.x2, p.y2);
    case "spring":
      return spring(p.stiffness, p.damping, p.mass);
    case "steps":
      return steps(p.count, p.jumpStart);
  }
}

const fnCache = new Map<string, Fn>();

// The easing function for a spec (named or parametric); unknown → linear.
export function easeFn(spec: string | undefined): Fn {
  const key = spec ?? "linear";
  let f = fnCache.get(key);
  if (!f) {
    const p = parseEase(key);
    f = "error" in p ? EASINGS.linear : build(p);
    if (fnCache.size < 500) fnCache.set(key, f);
  }
  return f;
}

export function ease(name: string | undefined, t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return easeFn(name)(x);
}
