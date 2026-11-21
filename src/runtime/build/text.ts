// 3D text: three.js typeface fonts from the library (library/fonts/<id>.typeface.json)
// laid out per glyph (multiline, alignment, letter spacing), extruded with bevel.

import * as THREE from "three";
import type { Font } from "three/addons/loaders/FontLoader.js";
import type { TextObjectDef } from "../../core/types";
import { fetchJson } from "../assets";
import { num } from "../util";
import type { RuntimeContext } from "./context";

const fontCache = new Map<string, Promise<Font>>();

export function loadFont(url: string): Promise<Font> {
  let p = fontCache.get(url);
  if (!p) {
    p = Promise.all([import("three/addons/loaders/FontLoader.js"), fetchJson<unknown>(url)]).then(([m, json]) =>
      new m.FontLoader().parse(json as Parameters<InstanceType<typeof m.FontLoader>["parse"]>[0]),
    );
    p.catch(() => fontCache.delete(url));
    fontCache.set(url, p);
  }
  return p;
}

interface FontData {
  resolution: number;
  boundingBox: { yMin: number; yMax: number };
  glyphs: Record<string, { ha: number } | undefined>;
}

function capRatio(font: Font): number {
  const shapes = font.generateShapes("H", 1);
  if (!shapes.length) return 0.72;
  const g = new THREE.ShapeGeometry(shapes);
  g.computeBoundingBox();
  const h = g.boundingBox!.max.y - g.boundingBox!.min.y;
  g.dispose();
  return h > 0 ? h : 0.72;
}

export function textGeometry(font: Font, def: Pick<TextObjectDef, "text" | "size" | "depth" | "bevel" | "align" | "letterSpacing" | "lineHeight">, mergeFn: (g: THREE.BufferGeometry[]) => THREE.BufferGeometry | null): THREE.BufferGeometry {
  const data = font.data as unknown as FontData;
  const size = num(def.size, 1);
  const cap = capRatio(font);
  const em = size / cap;
  const scale = em / data.resolution;
  const depth = Math.max(0, num(def.depth, 0.2));
  const bevel = depth > 0 ? Math.max(0, Math.min(num(def.bevel, 0.02), depth * 0.5, size * 0.08)) : 0;
  const spacing = num(def.letterSpacing, 0);
  const lineH = num(def.lineHeight, 1.25) * em;
  const align = def.align ?? "center";
  const lines = String(def.text ?? "").split("\n");
  const parts: THREE.BufferGeometry[] = [];
  const opts: THREE.ExtrudeGeometryOptions = {
    depth: Math.max(depth - bevel * 2, 0.0001),
    curveSegments: 6,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.7,
    bevelSegments: 3,
  };

  lines.forEach((line, li) => {
    const glyphs: { geo: THREE.BufferGeometry | null; x: number }[] = [];
    let x = 0;
    for (const ch of Array.from(line)) {
      const glyph = data.glyphs[ch] ?? data.glyphs["?"];
      const adv = (glyph?.ha ?? data.resolution * 0.5) * scale;
      if (ch.trim()) {
        const shapes = font.generateShapes(ch, em);
        if (shapes.length) {
          const geo = depth > 0 ? new THREE.ExtrudeGeometry(shapes, opts) : new THREE.ShapeGeometry(shapes, 6);
          glyphs.push({ geo, x });
        }
      }
      x += adv + spacing;
    }
    const width = Math.max(0, x - spacing);
    const offsetX = align === "left" ? 0 : align === "right" ? -width : -width / 2;
    for (const gl of glyphs) {
      gl.geo!.translate(gl.x + offsetX, -li * lineH, 0);
      parts.push(gl.geo!);
    }
  });

  let geo: THREE.BufferGeometry;
  if (!parts.length) geo = new THREE.BufferGeometry();
  else {
    // ShapeGeometry has no groups; ExtrudeGeometry has 2 — merge without groups.
    for (const p of parts) p.clearGroups();
    geo = mergeFn(parts) ?? new THREE.BufferGeometry();
    for (const p of parts) p.dispose();
  }
  // Vertical centring on the cap height of the whole block, depth centred on z=0.
  const topY = size;
  const bottomY = -(lines.length - 1) * lineH;
  geo.translate(0, -(topY + bottomY) / 2, depth > 0 ? -(depth - bevel * 2) / 2 : 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export async function buildTextGeometry(def: TextObjectDef, ctx: RuntimeContext): Promise<THREE.BufferGeometry> {
  const fontId = def.font ?? "sans-bold";
  const url = ctx.resolveAsset(fontId.includes("/") || fontId.includes(":") ? fontId : `library:fonts/${fontId}`);
  const [font, utils] = await Promise.all([loadFont(url), import("three/addons/utils/BufferGeometryUtils.js")]);
  return textGeometry(font, def, (g) => utils.mergeGeometries(g, false));
}
