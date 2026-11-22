import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { cameraInside, refineInView } from "./inspectView";

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

describe("cameraInside (inspect camera-inside)", () => {
  it("terrain: inside only below the heightfield, not anywhere in its box", () => {
    const g = new THREE.Group();
    g.position.set(0, 2, 0);
    g.updateMatrixWorld(true);
    const heightAt = (x: number) => 10 - Math.abs(x); // a ridge, local space
    expect(cameraInside(g, new THREE.Vector3(0, 13, 0), { heightAt })).toBe(false); // 1 above the crest
    expect(cameraInside(g, new THREE.Vector3(0, 11, 0), { heightAt })).toBe(true);
    expect(cameraInside(g, new THREE.Vector3(8, 6, 0), { heightAt })).toBe(false); // over the slope
  });

  it("scatterers: inside one part, not in the gaps of the overall box", () => {
    const g = new THREE.Group();
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
    im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-10, 0, 0));
    im.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10, 0, 0));
    g.add(im);
    g.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(g).containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(cameraInside(g, new THREE.Vector3(0, 0, 0), "parts")).toBe(false);
    expect(cameraInside(g, new THREE.Vector3(10.2, 0.1, 0), "parts")).toBe(true);
  });

  it("parts: the empty corner of a cone's box is not inside the cone", () => {
    const im = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1, 12), new THREE.MeshBasicMaterial(), 1);
    im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(3, 0, 0));
    im.updateMatrixWorld(true);
    expect(cameraInside(im, new THREE.Vector3(3, -0.2, 0), "parts")).toBe(true);
    expect(cameraInside(im, new THREE.Vector3(3.45, 0.4, 0.45), "parts")).toBe(false);
    expect((im.material as THREE.Material).side).toBe(THREE.FrontSide);
  });
});
