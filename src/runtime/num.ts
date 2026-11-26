// Number helpers of the runtime with no dependency (no Three.js, no DOM):
// shared by the full runtime (re-exported by ./util) and the photo-only lite
// runtime (./lite/).

export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function num(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}
