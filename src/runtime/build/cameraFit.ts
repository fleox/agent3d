// Camera framing math with no Three.js dependency: shared by build/camera.ts
// (the full runtime) and the photo-only lite runtime (src/runtime/lite/).

import { DEG } from "../num";

// Responsive framing: when the canvas is narrower than the scene's design
// aspect (target.aspect — e.g. a 4:1 banner given a taller box on a phone),
// widen the view so the authored horizontal framing stays visible instead of
// cropping the sides. Capped so a perspective camera never exceeds ~100°.
export function fitScale(aspect: number, designAspect?: number): number {
  if (!designAspect || !(aspect > 0) || aspect >= designAspect) return 1;
  return Math.min(designAspect / aspect, 3);
}

export function fittedFov(fov: number, scale: number): number {
  if (scale <= 1) return fov;
  return Math.min(100, (2 * Math.atan(Math.tan((fov * DEG) / 2) * scale)) / DEG);
}

// "W:H" → W / H (undefined when not a valid ratio). Same parse as World.setViewport.
export function designAspectOf(aspect: string | undefined): number | undefined {
  const m = /^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/.exec(aspect ?? "");
  const design = m ? Number(m[1]) / Number(m[2]) : undefined;
  return design && Number.isFinite(design) && design > 0 ? design : undefined;
}

// A vertex lying exactly in the plane through the camera perpendicular to its
// view axis gets clip w = 0; some rasterizers (SwiftShader — headless renders —
// and a few mobile GPUs) then draw its triangles as screen-filling garbage
// (a box floor whose front face is at the camera's z: wrong material, objects
// cut as if inside a volume). Authored scenes hit it with round numbers (camera
// z = 10, floor edge z = 10), so the camera is moved 1e-4 units back along its
// view axis — invisible, and never an exact authored value.
export const CAMERA_PLANE_NUDGE = 1e-4;
export interface XYZ {
  x: number;
  y: number;
  z: number;
}
export function nudgeOffPlanes(pos: XYZ & { set(x: number, y: number, z: number): unknown }, target: XYZ): void {
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return;
  const k = -CAMERA_PLANE_NUDGE / len;
  pos.set(pos.x + dx * k, pos.y + dy * k, pos.z + dz * k);
}
