// Material preset previews: an instant CSS "sphere" per preset (colour,
// metalness, roughness, emissive, transmission, gradient), and the layout of
// a one-shot rendered sheet (every preset on a sphere, one runtime render)
// the Studio crops into thumbnails.

import { MATERIAL_PRESETS, type MaterialPreset } from "../../core/catalog";
import { parseColor, toHex } from "../../core/color";
import type { SceneDoc } from "../../core/types";

const hex = (c: unknown, fallback: string) => {
  const p = typeof c === "string" ? parseColor(c) : null;
  return p ? toHex(p) : fallback;
};

function mix(a: string, b: string, k: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return a;
  return toHex({ r: pa.r + (pb.r - pa.r) * k, g: pa.g + (pb.g - pa.g) * k, b: pa.b + (pb.b - pa.b) * k, a: 1 });
}

// CSS background imitating a lit sphere for a set of material props.
export function swatchBackground(props: Record<string, unknown>): string {
  const num = (k: string, d: number) => (typeof props[k] === "number" ? (props[k] as number) : d);
  const metal = num("metalness", 0);
  const rough = num("roughness", 0.5);
  const transmission = num("transmission", 0);
  const grad = Array.isArray(props.gradient) ? (props.gradient as unknown[]).map((c) => hex(c, "#888888")) : null;
  if (props.type === "normal") return "radial-gradient(circle at 35% 30%, #ffffff 0 4%, transparent 30%), conic-gradient(from 200deg, #8080ff, #ff8080, #80ff80, #8080ff)";
  const base = grad ? grad[Math.floor(grad.length / 2)] : hex(props.color, "#d0d0d0");
  const emissive = typeof props.emissive === "string" && num("emissiveIntensity", 1) > 0 ? hex(props.emissive, "#000000") : null;
  const lit = emissive && emissive !== "#000000" ? mix(base, emissive, 0.6) : base;
  const shadow = mix(lit, "#000000", metal > 0.5 ? 0.82 : 0.6);
  const mid = mix(lit, metal > 0.5 ? "#000000" : "#ffffff", metal > 0.5 ? 0.25 : 0.05);
  const spot = Math.round(4 + rough * 22); // highlight size grows with roughness
  const spotAlpha = (1 - rough * 0.7) * (metal > 0.5 ? 1 : 0.85);
  const highlight = `radial-gradient(circle at 34% 28%, rgba(255,255,255,${spotAlpha.toFixed(2)}) 0 ${spot * 0.35}%, rgba(255,255,255,0) ${spot + 6}%)`;
  const body = grad ? `linear-gradient(180deg, ${grad.join(", ")})` : `radial-gradient(circle at 38% 32%, ${mid} 0%, ${lit} 35%, ${shadow} 100%)`;
  const layers = [highlight];
  if (metal > 0.5) layers.push(`radial-gradient(circle at 60% 80%, ${mix(lit, "#ffffff", 0.35)} 0 6%, transparent 30%)`);
  if (emissive) layers.push(`radial-gradient(circle at 50% 50%, ${emissive}66 0 40%, transparent 72%)`);
  if (transmission > 0) layers.push(`radial-gradient(circle at 55% 60%, rgba(255,255,255,0.08) 0 45%, rgba(255,255,255,0.35) 62%, rgba(255,255,255,0) 72%)`);
  layers.push(transmission > 0 ? `radial-gradient(circle at 40% 35%, ${mix(lit, "#9fb7d0", 0.3)}55 0%, #1b2030 100%)` : body);
  if (props.wireframe) return `repeating-linear-gradient(45deg, ${base} 0 1px, transparent 1px 6px), repeating-linear-gradient(-45deg, ${base} 0 1px, #0e1015 1px 6px)`;
  return layers.join(", ");
}

export function presetSwatch(p: MaterialPreset | undefined): string {
  return swatchBackground(p?.props ?? { color: "#cfd3da", roughness: 0.5 });
}

// One scene with a sphere per preset on a grid (orthographic, studio light).
export const SHEET = { cols: 8, cell: 72, spacing: 2.5 };
export function presetSheetScene(presets: readonly MaterialPreset[] = MATERIAL_PRESETS): { scene: SceneDoc; width: number; height: number; cells: Record<string, { x: number; y: number }> } {
  const { cols, cell, spacing } = SHEET;
  const rows = Math.ceil(presets.length / cols);
  const cells: Record<string, { x: number; y: number }> = {};
  const objects = presets.map((p, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    cells[p.id] = { x: c * cell, y: r * cell };
    return { id: `s${i}`, kind: "mesh" as const, position: [(c - (cols - 1) / 2) * spacing, ((rows - 1) / 2 - r) * spacing, 0] as [number, number, number], geometry: { type: "sphere" as const, radius: 1, segments: 48 }, material: { preset: p.id } };
  });
  const scene = {
    version: 1,
    id: "preset-sheet",
    title: "Material presets",
    target: { kind: "card", aspect: `${cols}:${rows}`, toneMapping: "aces", lazy: false, quality: "high" },
    camera: { type: "orthographic", zoom: rows * spacing, position: [0, 0, 20], target: [0, 0, 0] },
    environment: { background: "#1c2029", lighting: "studio" },
    lights: [
      { id: "key", type: "directional", position: [4, 6, 8], intensity: 2.2 },
      { id: "fill", type: "ambient", intensity: 0.35 },
    ],
    objects,
  } as unknown as SceneDoc;
  return { scene, width: cols * cell, height: rows * cell, cells };
}
