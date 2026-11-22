// three.js typeface JSON (library/fonts/<id>.typeface.json) → SVG path data,
// so the font picker previews each font with its own glyphs (no web fonts).

export interface TypefaceGlyph {
  ha: number; // advance
  o?: string; // outline commands: m x y | l x y | q cx cy x y | b c1x c1y c2x c2y x y (font units, y up)
}
export interface Typeface {
  glyphs: Record<string, TypefaceGlyph>;
  ascender?: number;
  descender?: number;
  resolution?: number;
  kerning?: Record<string, number> | Record<string, Record<string, number>>;
}

const r = (n: number) => Math.round(n * 10) / 10;

// One glyph outline at pen position x (y flipped: SVG y grows down, baseline at 0).
// typeface "q" / "b" put the end point FIRST, then the control points.
export function glyphPath(o: string, x: number, scale = 1): string {
  const t = o.trim().split(/\s+/);
  const out: string[] = [];
  const X = (v: string) => r(x + Number(v) * scale);
  const Y = (v: string) => r(-Number(v) * scale);
  for (let i = 0; i < t.length; ) {
    const c = t[i++];
    if (c === "m" || c === "l") {
      out.push(`${c === "m" ? "M" : "L"}${X(t[i])} ${Y(t[i + 1])}`);
      i += 2;
    } else if (c === "q") {
      out.push(`Q${X(t[i + 2])} ${Y(t[i + 3])} ${X(t[i])} ${Y(t[i + 1])}`);
      i += 4;
    } else if (c === "b") {
      out.push(`C${X(t[i + 2])} ${Y(t[i + 3])} ${X(t[i + 4])} ${Y(t[i + 5])} ${X(t[i])} ${Y(t[i + 1])}`);
      i += 6;
    } else if (c === "z") out.push("Z");
    else break; // malformed
  }
  return out.join("");
}

// A text line as one SVG path; returns the path and its bounds (font units × scale).
export function textPath(font: Typeface, text: string, scale = 1): { d: string; width: number; ascent: number; descent: number } {
  let x = 0;
  const parts: string[] = [];
  for (const ch of text) {
    const g = font.glyphs[ch] ?? font.glyphs["?"];
    if (!g) {
      x += (font.resolution ?? 1000) * 0.3 * scale;
      continue;
    }
    if (g.o) parts.push(glyphPath(g.o, x, scale));
    x += g.ha * scale;
  }
  const res = font.resolution ?? 1000;
  return { d: parts.join(""), width: x, ascent: (font.ascender ?? res * 0.8) * scale, descent: Math.abs(font.descender ?? -res * 0.2) * scale };
}
