// ScrollTrigger-like scroll progress of an element through the viewport.
// A position is "<element edge> <viewport edge>", edges: top | center |
// bottom | N% | Npx (from the top). The range starts when the element edge
// meets the viewport edge of `start` and ends at `end`. Defaults
// "top bottom" → "bottom top" (0 when the element enters at the bottom, 1
// when it leaves at the top — same as the behaviours' scroll progress).

export const DEFAULT_SCROLL_START = "top bottom";
export const DEFAULT_SCROLL_END = "bottom top";

const EDGE = /^(top|center|bottom|-?\d*\.?\d+%|-?\d*\.?\d+px)$/;

// Fraction (0..1) or pixels of an edge; null when invalid.
function edge(tok: string, size: number): number | null {
  if (tok === "top") return 0;
  if (tok === "center") return size / 2;
  if (tok === "bottom") return size;
  if (tok.endsWith("%")) return (Number(tok.slice(0, -1)) / 100) * size;
  if (tok.endsWith("px")) return Number(tok.slice(0, -2));
  return null;
}

export function isScrollPosition(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const parts = s.trim().split(/\s+/);
  return parts.length === 2 && parts.every((p) => EDGE.test(p));
}

// Scroll offset (px of page scroll, relative to the element's current top)
// at which the position is reached: element edge at viewport edge.
function at(pos: string, height: number, vh: number): number | null {
  const parts = pos.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const e = edge(parts[0], height), v = edge(parts[1], vh);
  return e === null || v === null ? null : e - v;
}

// Progress 0..1 for an element whose top is at `top` px in the viewport.
export function scrollProgressFor(top: number, height: number, vh: number, start = DEFAULT_SCROLL_START, end = DEFAULT_SCROLL_END): number {
  const s0 = at(start, height, vh) ?? -vh;
  const s1 = at(end, height, vh) ?? height;
  const s = 0 - top;
  if (Math.abs(s1 - s0) < 1e-6) return s >= s1 ? 1 : 0;
  const p = (s - s0) / (s1 - s0);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
