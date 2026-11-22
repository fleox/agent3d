// Projects a world-space box to a normalised screen rectangle (0..1, y down)
// for the viewport selection outline. Camera from Player.inspect().

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export interface CameraLike {
  position: V3;
  target: V3;
  type: "perspective" | "orthographic";
  fov?: number;
  zoom?: number;
}

export function projectBox(min: V3, max: V3, cam: CameraLike, aspect: number): { x: number; y: number; w: number; h: number } | null {
  const f = norm(sub(cam.target, cam.position));
  let r = cross(f, [0, 1, 0]);
  if (Math.hypot(...r) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  const u = cross(r, f);
  const tan = Math.tan(((cam.fov ?? 45) * Math.PI) / 360);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p: V3 = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
    const d = sub(p, cam.position);
    const z = dot(d, f);
    let nx: number, ny: number;
    if (cam.type === "orthographic") {
      const half = (cam.zoom ?? 10) / 2;
      nx = dot(d, r) / (half * aspect);
      ny = dot(d, u) / half;
    } else {
      if (z <= 0.05) return null;
      nx = dot(d, r) / (z * tan * aspect);
      ny = dot(d, u) / (z * tan);
    }
    const sx = (nx + 1) / 2, sy = (1 - ny) / 2;
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy);
    y1 = Math.max(y1, sy);
  }
  const cx0 = Math.max(-0.02, x0), cy0 = Math.max(-0.02, y0), cx1 = Math.min(1.02, x1), cy1 = Math.min(1.02, y1);
  if (cx1 <= cx0 || cy1 <= cy0) return null;
  return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };
}
