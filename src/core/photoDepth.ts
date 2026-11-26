// Where the pixels of a 3D photo (kind "photo") sit in depth: the mapping from
// a depth-map value (0 far .. 1 near) to a z in the photo's local space, used
// by the runtime (`occlude: true` writes it to the depth buffer, and the view
// offset becomes a real camera move that keeps 3D objects at that z sliding
// exactly like the photo pixels of that depth) and by the ops (scene_summary
// `depthRange`, check hints) so an agent knows where to put a title "behind
// the foreground". Pure, no three.js (shared by the runtime, the lite runtime
// and src/ops).
//
//   range = strength * width * 0.25          (world units, same as mode "mesh")
//   mesh:            z = (d - focus) * range
//   parallax/layers: z = D * u / (1 + u),  u = (d - focus) * range / D
//
// D = the distance from the camera to the photo plane (local units). The
// parallax shader shifts a texel by an amount linear in (d - focus); a camera
// move c shifts a point at height z by c * z / (D - z) on the photo plane.
// Choosing z so that z / (D - z) = u makes both identical for every depth, so
// the second formula is exact (≈ (d - focus) * range while |z| << D).

export type PhotoDepthMode = "parallax" | "mesh" | "layers";

export interface PhotoDepthParams {
  mode?: PhotoDepthMode | string;
  strength?: number; // 0..1 (default 0.5)
  width?: number; // local world width (default 4)
  focus?: number; // 0..1 (default 0.5)
  // Camera → photo plane distance (local units). Infinite / missing → linear mapping.
  cameraDistance?: number;
}

const clamp01 = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

// World depth range of a photo (units between depth 0 and depth 1, mesh mode).
export function photoDepthRange(strength: number, width: number): number {
  return Math.min(1, Math.max(0, strength)) * width * 0.25;
}

function resolved(p: PhotoDepthParams) {
  const strength = clamp01(p.strength, 0.5);
  const width = typeof p.width === "number" && p.width > 0 ? p.width : 4;
  const focus = clamp01(p.focus, 0.5);
  const D = p.mode !== "mesh" && typeof p.cameraDistance === "number" && p.cameraDistance > 0 && Number.isFinite(p.cameraDistance) ? p.cameraDistance : Infinity;
  return { range: photoDepthRange(strength, width), focus, D };
}

// Depth-map value (0 far .. 1 near) → photo local z (0 at the focus depth, + towards the camera).
export function photoDepthToZ(d: number, p: PhotoDepthParams): number {
  const { range, focus, D } = resolved(p);
  const lin = (d - focus) * range;
  if (!Number.isFinite(D)) return lin;
  const u = lin / D;
  return (D * u) / (1 + u);
}

// Inverse: photo local z → depth-map value (may fall outside 0..1).
export function photoZToDepth(z: number, p: PhotoDepthParams): number {
  const { range, focus, D } = resolved(p);
  if (range <= 0) return focus;
  const lin = Number.isFinite(D) ? (D * z) / (D - z) : z;
  return focus + lin / range;
}

// Local z of the farthest (depth 0) and nearest (depth 1) photo pixels.
export function photoZRange(p: PhotoDepthParams): [number, number] {
  return [photoDepthToZ(0, p), photoDepthToZ(1, p)];
}
