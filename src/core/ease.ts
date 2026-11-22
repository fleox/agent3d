// Easing names and the parametric easing syntax, shared by validation
// (src/core/validate*.ts) and the runtime (src/runtime/timeline/easing.ts).
//
//   named:       "linear", "step", in|out|inOut × Quad Cubic Quart Quint Sine Expo Circ Back Elastic Bounce
//   cubicBezier: "cubicBezier(x1, y1, x2, y2)"  (CSS cubic-bezier; x1, x2 in 0..1)
//   spring:      "spring" | "spring(stiffness, damping)" | "spring(stiffness, damping, mass)"
//                damped spring from 0 to 1 (low damping overshoots), normalised so it settles at t = 1
//   steps:       "steps(n)" | "steps(n, start)"  (n discrete jumps; "start" jumps at the beginning)

const FAMILIES = ["Quad", "Cubic", "Quart", "Quint", "Sine", "Expo", "Circ", "Back", "Elastic", "Bounce"] as const;

export const EASE_NAMES: readonly string[] = ["linear", ...FAMILIES.flatMap((f) => [`in${f}`, `out${f}`, `inOut${f}`]), "step"];

export const EASE_EXAMPLES = ["outCubic", "inOutSine", "outBack", "cubicBezier(0.22, 1, 0.36, 1)", "spring(170, 18)", "steps(4)"];

export type ParsedEase =
  | { kind: "named"; name: string }
  | { kind: "cubicBezier"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "spring"; stiffness: number; damping: number; mass: number }
  | { kind: "steps"; count: number; jumpStart: boolean };

const cache = new Map<string, ParsedEase | { error: string }>();

function args(s: string, name: string): string[] | null {
  const m = new RegExp(`^${name}\\s*\\(([^)]*)\\)$`).exec(s);
  return m ? m[1].split(",").map((x) => x.trim()) : null;
}

const numeric = (x: string) => x !== "" && Number.isFinite(Number(x));

// Parses an easing spec. Returns { error } with an actionable message when invalid.
export function parseEase(spec: string): ParsedEase | { error: string } {
  const hit = cache.get(spec);
  if (hit) return hit;
  const out = parseUncached(spec.trim());
  if (cache.size < 500) cache.set(spec, out);
  return out;
}

function parseUncached(s: string): ParsedEase | { error: string } {
  if (EASE_NAMES.includes(s)) return { kind: "named", name: s };
  if (s.startsWith("cubicBezier")) {
    const a = args(s, "cubicBezier");
    if (!a || a.length !== 4 || !a.every(numeric)) return { error: 'cubicBezier needs 4 numbers: "cubicBezier(x1, y1, x2, y2)", e.g. "cubicBezier(0.22, 1, 0.36, 1)".' };
    const [x1, y1, x2, y2] = a.map(Number);
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return { error: "cubicBezier x1 and x2 must be between 0 and 1 (y1, y2 may overshoot)." };
    return { kind: "cubicBezier", x1, y1, x2, y2 };
  }
  if (s === "spring") return { kind: "spring", stiffness: 170, damping: 18, mass: 1 };
  if (s.startsWith("spring")) {
    const a = args(s, "spring");
    if (!a || a.length < 2 || a.length > 3 || !a.every(numeric)) return { error: 'spring takes stiffness, damping (and optional mass): "spring(170, 18)" (lower damping = more bounce).' };
    const [stiffness, damping, mass = 1] = a.map(Number);
    if (!(stiffness > 0) || !(damping > 0) || !(mass > 0)) return { error: "spring stiffness, damping and mass must be > 0." };
    return { kind: "spring", stiffness, damping, mass };
  }
  if (s.startsWith("steps")) {
    const a = args(s, "steps");
    if (!a || a.length < 1 || a.length > 2 || !numeric(a[0]) || !Number.isInteger(Number(a[0])) || Number(a[0]) < 1 || (a[1] !== undefined && a[1] !== "start" && a[1] !== "end")) {
      return { error: 'steps takes a whole number ≥ 1 and optionally "start" or "end": "steps(4)", "steps(4, start)".' };
    }
    return { kind: "steps", count: Number(a[0]), jumpStart: a[1] === "start" };
  }
  return { error: `Unknown easing "${s}".` };
}

export function isEaseSpec(v: unknown): v is string {
  return typeof v === "string" && !("error" in parseEase(v));
}
