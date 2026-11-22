// 3D bar chart from data: a row of bars (number[]) or a grid (number[][]),
// rounded / box / cylinder bars on a soft base plate, coloured by value along
// a ramp or per series, with an eased staggered "grow" entrance or a looping
// "wave". Pure function of t (deterministic screenshots). Add text objects for
// labels.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built, ramp } from "./geom";

const easeOutBack = (x: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

export function readBarData(v: unknown): number[][] {
  if (!Array.isArray(v) || v.length === 0) return [[3, 5, 4, 7, 6, 9, 8]];
  const val = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : x && typeof x === "object" && typeof (x as { value?: unknown }).value === "number" ? (x as { value: number }).value : 0);
  if (v.every((r) => Array.isArray(r))) return (v as unknown[][]).map((r) => r.map(val));
  return [v.map(val)];
}

export const bars3d: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("bars3d", raw, ctx);
  const data = readBarData(p.raw("data"));
  const rows = data.length;
  const cols = Math.max(...data.map((r) => r.length), 1);
  const width = p.num("barWidth");
  const gap = p.num("gap");
  const maxH = p.num("maxHeight");
  const colors = p.colors("colors");
  const colorBy = p.str<"value" | "row" | "column">("colorBy");
  const shape = p.str<"rounded" | "box" | "cylinder">("shape");
  const anim = p.str<"grow" | "wave" | "none">("animation");
  const duration = p.num("duration");
  const max = Math.max(1e-6, ...data.flat().map((x) => Math.abs(x)));
  const pitch = width + gap;

  // Unit bar (height 1, base at y = 0) scaled per instance.
  let geo: THREE.BufferGeometry;
  if (shape === "cylinder") geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
  else if (shape === "box") geo = new THREE.BoxGeometry(1, 1, 1);
  else geo = new RoundedBoxGeometry(1, 1, 1, 4, 0.12);
  geo.translate(0, 0.5, 0);
  const n = rows * cols;
  const material = new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.name = "bars";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.materialTarget = true;
  const cells: { x: number; z: number; h: number; i: number; delay: number }[] = [];
  const c = new THREE.Color();
  let i = 0;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const v = data[r]![k] ?? 0;
      const h = Math.max(0.0001, (Math.abs(v) / max) * maxH);
      const x = (k - (cols - 1) / 2) * pitch;
      const z = (r - (rows - 1) / 2) * pitch;
      const t = colorBy === "row" ? (rows > 1 ? r / (rows - 1) : 0) : colorBy === "column" ? (cols > 1 ? k / (cols - 1) : 0) : Math.abs(v) / max;
      if (colorBy === "value") ramp(colors, t, c);
      else c.copy(colors[(colorBy === "row" ? r : k) % colors.length]!);
      mesh.setColorAt(i, c);
      cells.push({ x, z, h, i, delay: (k + r * 0.6) / Math.max(1, cols + rows * 0.6) });
      i++;
    }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const place = (t: number) => {
    for (const cell of cells) {
      let f = 1;
      if (anim === "grow") {
        const local = (t - cell.delay * duration * 0.6) / (duration * 0.5);
        f = local <= 0 ? 0.0001 : local >= 1 ? 1 : easeOutBack(Math.min(1, local));
        if (local > 0 && local < 1) f = Math.max(0.0001, f);
      } else if (anim === "wave") f = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.6 - cell.x * 0.9 - cell.z * 0.7));
      v.set(cell.x, 0, cell.z);
      s.set(width, cell.h * f, width);
      mesh.setMatrixAt(cell.i, m.compose(v, q, s));
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0);
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.name = "bars3d";
  group.add(mesh);
  if (p.bool("base")) {
    const w = cols * pitch + gap;
    const d = rows * pitch + gap;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(w, 0.12, d, 3, 0.05), new THREE.MeshStandardMaterial({ color: p.color("baseColor"), roughness: 0.6 }));
    plate.position.y = -0.06;
    plate.receiveShadow = true;
    plate.castShadow = true;
    plate.name = "bars-base";
    group.add(plate);
  }
  return built(group, { update: (t) => place(t) });
};
