// Grid maze from a seed (recursive backtracker → perfect maze, always
// solvable). Walls are merged into long boxes (one mesh, few physics bodies),
// entrance on the west side of cell (0, 0), exit on the east side of the last cell.
//
// userData: bodies [{ min, max }] (local AABBs, when `bodies`), maze { columns,
// rows, cellSize, walls (bitmask per cell: 1 N, 2 E, 4 S, 8 W), start, exit,
// cellCenter(i, j) }.

import * as THREE from "three";
import type { GeneratorImpl, Rng } from "../registry";
import { generatorParams } from "./params";
import { MeshBuilder, built, shade } from "./geom";

export const N = 1, E = 2, S = 4, W = 8;

export function carveMaze(cols: number, rows: number, rng: Rng): Uint8Array {
  const walls = new Uint8Array(cols * rows).fill(N | E | S | W);
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [0];
  seen[0] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1]!;
    const i = cur % cols, j = Math.floor(cur / cols);
    const opts: [number, number, number][] = [];
    if (j > 0 && !seen[cur - cols]) opts.push([cur - cols, N, S]);
    if (i < cols - 1 && !seen[cur + 1]) opts.push([cur + 1, E, W]);
    if (j < rows - 1 && !seen[cur + cols]) opts.push([cur + cols, S, N]);
    if (i > 0 && !seen[cur - 1]) opts.push([cur - 1, W, E]);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [next, a, b] = rng.pick(opts);
    walls[cur] &= ~a;
    walls[next] &= ~b;
    seen[next] = 1;
    stack.push(next);
  }
  return walls;
}

export const maze: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("maze", raw, ctx);
  const cols = p.int("columns");
  const rows = p.int("rows");
  const cs = p.num("cellSize");
  const wh = p.num("wallHeight");
  const wallColor = p.color("wallColor");
  const floorColor = p.color("floorColor");
  const walls = carveMaze(cols, rows, ctx.rng);
  // openings
  walls[0] &= ~W;
  walls[cols * rows - 1] &= ~E;

  const t = Math.min(0.35, cs * 0.14); // wall thickness
  const w = cols * cs, d = rows * cs;
  const x0 = -w / 2, z0 = -d / 2;
  const has = (i: number, j: number, side: number) => (walls[j * cols + i]! & side) !== 0;

  // Horizontal runs (north edges of row j; j = rows → south border)
  const boxes: { min: [number, number, number]; max: [number, number, number] }[] = [];
  for (let j = 0; j <= rows; j++) {
    let start = -1;
    for (let i = 0; i <= cols; i++) {
      const on = i < cols && (j < rows ? has(i, j, N) : has(i, rows - 1, S));
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        boxes.push({ min: [x0 + start * cs - t / 2, 0, z0 + j * cs - t / 2], max: [x0 + i * cs + t / 2, wh, z0 + j * cs + t / 2] });
        start = -1;
      }
    }
  }
  // Vertical runs (west edges of column i; i = cols → east border)
  for (let i = 0; i <= cols; i++) {
    let start = -1;
    for (let j = 0; j <= rows; j++) {
      const on = j < rows && (i < cols ? has(i, j, W) : has(cols - 1, j, E));
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        boxes.push({ min: [x0 + i * cs - t / 2, 0, z0 + start * cs + t / 2], max: [x0 + i * cs + t / 2, wh, z0 + j * cs - t / 2] });
        start = -1;
      }
    }
  }
  // corner posts fill the gaps between vertical runs and horizontal runs
  const b = new MeshBuilder();
  const top = shade(wallColor, 1.35);
  for (const bx of boxes) b.box(bx.min, bx.max, wallColor, top);
  const floor = new MeshBuilder();
  const alt = shade(floorColor, 0.93);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const xa = x0 + i * cs, za = z0 + j * cs;
      floor.quad([xa, 0, za + cs], [xa + cs, 0, za + cs], [xa + cs, 0, za], [xa, 0, za], (i + j) % 2 ? floorColor : alt);
    }
  // base slab
  floor.box([x0 - t, -0.3, z0 - t], [x0 + w + t, -0.001, z0 + d + t], shade(wallColor, 0.8), shade(floorColor, 0.9));

  const group = new THREE.Group();
  group.name = "maze";
  const fm = new THREE.Mesh(floor.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  fm.name = "maze-floor";
  fm.receiveShadow = true;
  const wm = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }));
  wm.name = "maze-walls";
  wm.castShadow = true;
  wm.receiveShadow = true;
  group.add(fm, wm);
  const cellCenter = (i: number, j: number): [number, number, number] => [x0 + (i + 0.5) * cs, 0, z0 + (j + 0.5) * cs];
  group.userData.maze = { columns: cols, rows, cellSize: cs, walls: Array.from(walls), start: cellCenter(0, 0), exit: cellCenter(cols - 1, rows - 1), cellCenter };
  if (p.bool("bodies")) group.userData.bodies = boxes;
  return built(group);
};
