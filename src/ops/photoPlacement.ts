// Where the depth planes of a 3D photo (kind "photo" with a depth map) sit in
// the world, so an agent can place 3D objects "inside" it (`occlude: true`):
// scene_summary `depthRange`, check hints. Mapping: src/core/photoDepth.ts.
// Approximations: parent groups add their positions (their rotation / scale
// are ignored) and the photo is assumed to face the camera (+z, no rotation).

import { photoDepthToZ, type PhotoDepthMode } from "../core/photoDepth";
import type { Issue, ObjectDef, PhotoObjectDef, SceneDoc, Vec3 } from "../core/types";

export interface PhotoPlacement {
  id: string;
  occlude: boolean;
  // World z of the farthest (depth 0), focus (still) and nearest (depth 1) photo pixels.
  zFar: number;
  zFocus: number;
  zNear: number;
  // World position of the photo centre.
  position: Vec3;
}

export interface PlacedObject {
  def: ObjectDef;
  world: Vec3; // position + parents' positions
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// Every object with its approximate world position.
export function placedObjects(objects: ObjectDef[] | undefined, base: Vec3 = [0, 0, 0], out: PlacedObject[] = []): PlacedObject[] {
  for (const o of objects ?? []) {
    if (!o || typeof o !== "object") continue;
    const p = Array.isArray(o.position) ? o.position : [0, 0, 0];
    const world: Vec3 = [base[0] + (Number(p[0]) || 0), base[1] + (Number(p[1]) || 0), base[2] + (Number(p[2]) || 0)];
    out.push({ def: o, world });
    if (Array.isArray(o.children)) placedObjects(o.children, world, out);
  }
  return out;
}

function scaleZ(o: ObjectDef): number {
  const s = o.scale;
  if (typeof s === "number" && s > 0) return s;
  if (Array.isArray(s) && typeof s[2] === "number" && s[2] > 0) return s[2];
  return 1;
}

// Depth range of a photo with a depth map (null for a flat photo).
export function photoPlacement(scene: Pick<SceneDoc, "camera">, photo: PhotoObjectDef, world: Vec3): PhotoPlacement | null {
  if (!photo.depth) return null;
  const sz = scaleZ(photo);
  const cam = scene.camera;
  let distance: number | undefined;
  if (cam?.type !== "orthographic" && Array.isArray(cam?.position)) {
    const t = Array.isArray(cam.target) ? cam.target : [0, 0, 0];
    const f = [t[0] - cam.position[0], t[1] - cam.position[1], t[2] - cam.position[2]];
    const len = Math.hypot(f[0], f[1], f[2]) || 1;
    const d = ((world[0] - cam.position[0]) * f[0] + (world[1] - cam.position[1]) * f[1] + (world[2] - cam.position[2]) * f[2]) / len;
    if (d > 0) distance = d / sz;
  }
  const params = { mode: (photo.mode ?? "parallax") as PhotoDepthMode, strength: photo.strength, width: photo.width, focus: photo.focus, cameraDistance: distance };
  return {
    id: photo.id,
    occlude: photo.occlude === true,
    zFar: r2(world[2] + photoDepthToZ(0, params) * sz),
    zFocus: r2(world[2]),
    zNear: r2(world[2] + photoDepthToZ(1, params) * sz),
    position: world,
  };
}

// check: 3D content inside a depth photo. Without `occlude`, objects placed
// between its far and near pixels float over it (suggest occlude); with it,
// tell where its depth planes are (or that it does nothing alone).
export function photoDepthIssues(scene: SceneDoc): Issue[] {
  const out: Issue[] = [];
  const placed = placedObjects(scene.objects);
  const content = placed.filter(({ def }) => def.kind !== "photo" && def.kind !== "group" && def.visible !== false && !def.attach);
  for (const pl of photoPlacements(scene)) {
    const at = `objects#${pl.id}.occlude`;
    const range = `world z ${pl.zFar} (depth 0, far) … ${pl.zFocus} (focus, still) … ${pl.zNear} (depth 1, near)`;
    const inside = content.filter(({ world }) => world[2] > pl.zFar && world[2] < pl.zNear).map(({ def }) => def.id);
    if (!pl.occlude && inside.length) {
      out.push({ severity: "info", code: "photo-occlude", path: at, message: `${inside.slice(0, 4).map((id) => `"${id}"`).join(", ")}${inside.length > 4 ? "…" : ""} sit${inside.length === 1 ? "s" : ""} within the depth of photo "${pl.id}" (${range}) but always draw${inside.length === 1 ? "s" : ""} over it.`, hint: `To put them inside the photo (hidden by its nearer parts, moving with its planes), set ${at}: true. Keep it off for a title meant to float over the picture.` });
    } else if (pl.occlude) {
      out.push(
        content.length
          ? { severity: "info", code: "photo-depth-range", path: at, message: `Photo "${pl.id}" occludes: its pixels span ${range}.`, hint: "An object at world z is hidden where the photo is nearer: put a title between the far and the near z (e.g. just behind the nearest building's depth); objects in front of the near z are never hidden." }
          : { severity: "info", code: "ignored", path: at, message: `occlude does nothing on photo "${pl.id}": the scene has no other objects to hide.`, hint: "Add 3D objects between its depth planes, or remove occlude." },
      );
    }
  }
  return out;
}

// All depth photos of a scene with their placement.
export function photoPlacements(scene: SceneDoc): PhotoPlacement[] {
  const out: PhotoPlacement[] = [];
  for (const { def, world } of placedObjects(scene.objects)) {
    if (def.kind !== "photo") continue;
    const p = photoPlacement(scene, def, world);
    if (p) out.push(p);
  }
  return out;
}
