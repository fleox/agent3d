// Tighter framing for Player.inspect(): the world AABB of an object is loose
// (rotated boxes, invisible helpers / twins, empty corners of text blocks), so
// an object fully on screen can have AABB corners outside the frustum and be
// reported "partial" (→ a false "clipped" in check). This samples the object's
// visible vertices (world space, instances and skinning included) and tests
// them against the frustum.

import * as THREE from "three";

const MAX_POINTS = 8000;

// "full" when every sampled visible vertex is inside the frustum, "partial"
// when some are, null when the object has no sampleable geometry (keep the
// AABB answer). Never returns "none": a big triangle can cross the view with
// all its vertices outside.
export function refineInView(object: THREE.Object3D, frustum: THREE.Frustum, maxPoints = MAX_POINTS): "full" | "partial" | null {
  const meshes: (THREE.Mesh | THREE.Line)[] = [];
  let total = 0;
  object.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!(m.isMesh || (o as THREE.Line).isLine) || (o as THREE.Points).isPoints) return;
    const pos = m.geometry?.getAttribute("position");
    if (!pos) return;
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    if (!inst) return;
    meshes.push(m);
    total += pos.count * inst;
  });
  if (!meshes.length || !total) return null;
  const stride = Math.max(1, Math.ceil(total / maxPoints));
  const p = new THREE.Vector3();
  const im = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  let inside = 0;
  let outside = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    const inst = m as THREE.InstancedMesh;
    const skinned = (m as THREE.SkinnedMesh).isSkinnedMesh ? (m as THREE.SkinnedMesh) : null;
    const copies = inst.isInstancedMesh ? inst.count : 1;
    for (let c = 0; c < copies; c++) {
      if (inst.isInstancedMesh) world.multiplyMatrices(m.matrixWorld, (inst.getMatrixAt(c, im), im));
      else world.copy(m.matrixWorld);
      // Sample with a per-copy offset so instances do not all test the same vertices.
      for (let i = c % stride; i < pos.count; i += stride) {
        p.fromBufferAttribute(pos, i);
        if (skinned) skinned.applyBoneTransform(i, p);
        p.applyMatrix4(world);
        if (frustum.containsPoint(p)) inside++;
        else outside++;
        if (inside && outside) return "partial";
      }
    }
  }
  if (!inside && !outside) return null;
  return outside ? "partial" : "full";
}
