import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { refineInView } from "./inspectView";

const frustumOf = () => {
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
};

describe("refineInView (inspect framing)", () => {
  it("ignores hidden helpers that inflate the bounding box", () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5)));
    const twin = new THREE.Mesh(new THREE.BoxGeometry(50, 50, 1));
    twin.visible = false;
    g.add(twin);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const f = frustumOf();
    expect(f.intersectsBox(box) && !f.containsPoint(box.max)).toBe(true); // the AABB says "partial"
    expect(refineInView(g, f)).toBe("full");
  });
  it("reports partial when vertices leave the frame, null without geometry; counts instances", () => {
    const f = frustumOf();
    const wide = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 0.2));
    wide.updateMatrixWorld(true);
    expect(refineInView(wide, f)).toBe("partial");
    expect(refineInView(new THREE.Group(), f)).toBeNull();
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), undefined, 2);
    inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
    inst.setMatrixAt(1, new THREE.Matrix4().makeTranslation(40, 0, 0));
    inst.updateMatrixWorld(true);
    expect(refineInView(inst, f)).toBe("partial");
  });
});
