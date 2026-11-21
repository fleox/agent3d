// Aspect ratios "W:H" (target.aspect).

export interface Aspect {
  width: number;
  height: number;
  ratio: number; // width / height
}

const ASPECT_RE = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/;

export function parseAspect(value: unknown): Aspect | null {
  if (typeof value !== "string") return null;
  const m = ASPECT_RE.exec(value);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height, ratio: width / height };
}

export function isValidAspect(value: unknown): value is string {
  return parseAspect(value) !== null;
}

// Pixel size for a render of the given width keeping the aspect ("4:1", 1200 → 1200x300).
export function sizeForAspect(aspect: string, width: number): { width: number; height: number } {
  const a = parseAspect(aspect) ?? { ratio: 16 / 9 };
  return { width: Math.round(width), height: Math.max(1, Math.round(width / a.ratio)) };
}
