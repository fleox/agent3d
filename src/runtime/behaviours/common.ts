// Helpers shared by behaviours. Convention: before behaviours run, the object
// is reset to its rest transform (scene definition + timeline); each behaviour
// then ADDS its offset (position +=, scale *=, local rotation), so several
// behaviours compose. A few (billboard, path, orbit) set absolute values.

import * as THREE from "three";
import { meshMaterials, vec3 } from "../util";
import type { Vec3 } from "../../core/types";

export function axisOf(v: unknown, def: Vec3 = [0, 1, 0]): THREE.Vector3 {
  const a = new THREE.Vector3(...vec3(v, def));
  if (a.lengthSq() < 1e-9) a.set(0, 1, 0);
  return a.normalize();
}

export function materialsOf(obj: THREE.Object3D): THREE.Material[] {
  return meshMaterials(obj);
}

export const TAU = Math.PI * 2;
