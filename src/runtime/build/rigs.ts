// Light rigs (catalog `lightRigs`): named setups expanded into LightDefs.
// Pure (no THREE): environment.ts builds the expanded lights.

import { LIGHT_RIGS } from "../../core/catalog";
import type { Color, LightDef, LightRigDef, Vec3 } from "../../core/types";
import { readParams } from "../generators/params";

type RigLight = Omit<LightDef, "id"> & { id: string; shadow?: LightDef["shadow"] };

const RIGS: Record<string, RigLight[]> = {
  "studio-3point": [
    { id: "key", type: "directional", position: [4, 6, 5], color: "#fff1e0", intensity: 2.6, castShadow: true, shadow: { softness: 6 } },
    { id: "fill", type: "directional", position: [-5, 2.5, 3], color: "#dbe6ff", intensity: 0.8 },
    { id: "rim", type: "directional", position: [-1.5, 4, -6], color: "#ffffff", intensity: 2.2 },
    { id: "sky", type: "hemisphere", skyColor: "#ffffff", groundColor: "#3a3f4a", intensity: 0.35 },
  ],
  softbox: [
    { id: "top", type: "rect", position: [0, 5, 1.5], width: 5, height: 5, color: "#ffffff", intensity: 3.2 },
    { id: "left", type: "rect", position: [-4.5, 2, 2.5], width: 2, height: 4.5, color: "#fff6ee", intensity: 4 },
    { id: "right", type: "rect", position: [4.5, 2, 2.5], width: 2, height: 4.5, color: "#eef4ff", intensity: 2.6 },
    { id: "shadow", type: "directional", position: [1, 8, 2.5], color: "#ffffff", intensity: 0.9, castShadow: true, shadow: { softness: 10, intensity: 0.75 } },
    { id: "sky", type: "hemisphere", skyColor: "#ffffff", groundColor: "#50555f", intensity: 0.3 },
  ],
  "product-top": [
    { id: "top", type: "rect", position: [0, 4.5, 0.5], width: 3, height: 3, color: "#ffffff", intensity: 6 },
    { id: "stripL", type: "rect", position: [-3.2, 1.6, 1.2], width: 0.6, height: 4.5, color: "#ffffff", intensity: 10 },
    { id: "stripR", type: "rect", position: [3.2, 1.6, 1.2], width: 0.6, height: 4.5, color: "#ffffff", intensity: 10 },
    { id: "shadow", type: "directional", position: [0.5, 8, 1.5], color: "#ffffff", intensity: 0.9, castShadow: true, shadow: { softness: 8, intensity: 0.8 } },
    { id: "sky", type: "hemisphere", skyColor: "#ffffff", groundColor: "#30333a", intensity: 0.15 },
  ],
  rim: [
    { id: "rimCool", type: "directional", position: [-5, 3, -5], color: "#9fc4ff", intensity: 3.2, castShadow: true, shadow: { softness: 5 } },
    { id: "rimWarm", type: "directional", position: [5, 3, -5], color: "#ffb27a", intensity: 3 },
    { id: "front", type: "directional", position: [0, 2, 6], color: "#ffffff", intensity: 0.35 },
    { id: "ambient", type: "ambient", color: "#ffffff", intensity: 0.1 },
  ],
  dramatic: [
    { id: "key", type: "spot", position: [5, 5, 3], color: "#ffe2c0", intensity: 90, angle: 26, penumbra: 0.45, castShadow: true, shadow: { softness: 3 } },
    { id: "rim", type: "directional", position: [-3, 4, -5], color: "#a9c2ff", intensity: 1.3 },
    { id: "sky", type: "hemisphere", skyColor: "#8090b0", groundColor: "#101012", intensity: 0.08 },
  ],
  "golden-hour": [
    { id: "sun", type: "directional", position: [6.5, 2, 3], color: "#ffb46b", intensity: 3.2, castShadow: true, shadow: { softness: 5 } },
    { id: "sky", type: "hemisphere", skyColor: "#8fb4ff", groundColor: "#4a3020", intensity: 0.65 },
    { id: "bounce", type: "directional", position: [-4, 3, 4], color: "#ffd9b0", intensity: 0.3 },
  ],
  noon: [
    { id: "sun", type: "directional", position: [2, 10, 3], color: "#fffaf0", intensity: 3.2, castShadow: true, shadow: { softness: 3 } },
    { id: "sky", type: "hemisphere", skyColor: "#bcd8ff", groundColor: "#6b5a45", intensity: 0.75 },
  ],
  overcast: [
    { id: "sky", type: "hemisphere", skyColor: "#e8eef5", groundColor: "#6f6a60", intensity: 1.4 },
    { id: "top", type: "directional", position: [1, 8, 2], color: "#f2f5ff", intensity: 0.6, castShadow: true, shadow: { softness: 14, intensity: 0.6 } },
  ],
  neon: [
    { id: "magenta", type: "rect", position: [-3.5, 1.5, 1.5], width: 1, height: 4, color: "#ff2bd6", intensity: 12 },
    { id: "cyan", type: "rect", position: [3.5, 1.5, 1.5], width: 1, height: 4, color: "#22e4ff", intensity: 12 },
    { id: "back", type: "point", position: [0, 3, -3], color: "#7a5cff", intensity: 20 },
    { id: "shadow", type: "directional", position: [0, 6, 3], color: "#b9a6ff", intensity: 0.35, castShadow: true, shadow: { softness: 6 } },
    { id: "ambient", type: "ambient", color: "#1a1030", intensity: 0.25 },
  ],
  moonlight: [
    { id: "moon", type: "directional", position: [-4, 7, -3], color: "#9db8ff", intensity: 1.6, castShadow: true, shadow: { softness: 6 } },
    { id: "sky", type: "hemisphere", skyColor: "#2a3b66", groundColor: "#0a0c14", intensity: 0.5 },
  ],
};

export const LIGHT_RIG_IDS = Object.keys(RIGS);

// Simple sRGB hex mix (rig tints), no THREE needed.
function mixHex(a: Color, b: Color, t: number): Color {
  const p = (c: Color) => {
    const h = c.replace("#", "");
    const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
  };
  if (!/^#?[0-9a-f]{3,8}$/i.test(a) || !/^#?[0-9a-f]{3,8}$/i.test(b)) return a;
  const x = p(a), y = p(b);
  return "#" + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("");
}

function rotateY(v: Vec3, deg: number, s: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), sn = Math.sin(a);
  return [(v[0] * c + v[2] * sn) * s, v[1] * s, (-v[0] * sn + v[2] * c) * s];
}

// Expands environment.rig into LightDefs (ids "rig:<light>"). Unknown rig → [].
export function expandRig(rig: string | LightRigDef | undefined): LightDef[] {
  if (!rig) return [];
  const def: LightRigDef = typeof rig === "string" ? { preset: rig } : rig;
  const lights = RIGS[def.preset];
  const entry = LIGHT_RIGS.find((r) => r.id === def.preset);
  if (!lights || !entry) return [];
  const p = readParams(entry, def as unknown as Record<string, unknown>);
  const k = p.num("intensity"), rot = p.num("rotation"), scale = p.num("scale"), shadow = p.bool("castShadow");
  const tint = typeof def.color === "string" ? def.color : undefined;
  return lights.map((l) => {
    const out: LightDef = { ...l, id: `rig:${l.id}` };
    if (l.position) out.position = rotateY(l.position, rot, scale);
    if (l.target) out.target = rotateY(l.target, rot, scale);
    if (l.width) out.width = l.width * scale;
    if (l.height) out.height = l.height * scale;
    if (l.intensity !== undefined) out.intensity = l.intensity * k * (l.type === "point" || l.type === "spot" ? scale * scale : 1);
    if (tint) {
      if (out.color) out.color = mixHex(out.color, tint, 0.45);
      if (out.skyColor) out.skyColor = mixHex(out.skyColor, tint, 0.45);
    }
    if (!shadow) delete out.castShadow;
    return out;
  });
}
