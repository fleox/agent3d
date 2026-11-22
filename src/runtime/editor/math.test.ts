import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_SNAP, eulerDegreesNear, finishTransform, frameSphere, localFromWorld, matrixFromLocal, nearestAngle, quaternionFromDegrees, readTransform, round, snapChanged, snapTo, transformFields, type LocalTransform } from "./math";

const close = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));

describe("snapping", () => {
  it("rounds without float noise", () => {
    expect(round(0.1 + 0.2)).toBe(0.3);
    expect(round(-0.0001)).toBe(0);
    expect(round(12.34567, 0.01)).toBe(12.35);
    expect(snapTo(0.37, 0.25)).toBe(0.25);
    expect(snapTo(0.38, 0.25)).toBe(0.5);
    expect(snapTo(1.04, 0.1)).toBe(1);
  });
  it("snaps only the components that moved", () => {
    expect(snapChanged([1.13, 0.333, 2.61], [0.5, 0.333, 2.2], 0.25)).toEqual([1.25, 0.333, 2.5]);
  });
  it("wraps angles near a reference", () => {
    expect(nearestAngle(-170, 180)).toBe(190);
    expect(nearestAngle(10, 350)).toBe(370);
  });
});

describe("euler continuity", () => {
  it("round-trips simple rotations", () => {
    close(eulerDegreesNear(quaternionFromDegrees([10, 20, 30]), [10, 20, 30]), [10, 20, 30]);
  });
  it("keeps Y past 90° instead of flipping X and Z", () => {
    const q = quaternionFromDegrees([0, 120, 0]);
    close(eulerDegreesNear(q, [0, 115, 0]), [0, 120, 0]);
  });
  it("continues past 180° on Z", () => {
    close(eulerDegreesNear(quaternionFromDegrees([0, 0, 190]), [0, 0, 185]), [0, 0, 190]);
  });
});

describe("world → local", () => {
  const start: LocalTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  it("is identity without a parent", () => {
    const m = matrixFromLocal({ position: [1, 2, 3], rotation: [0, 45, 0], scale: [2, 2, 2] });
    const l = localFromWorld(m, null, start);
    close(l.position, [1, 2, 3]);
    close(l.rotation, [0, 45, 0]);
    close(l.scale, [2, 2, 2]);
  });
  it("undoes a translated, rotated, scaled parent (nested groups)", () => {
    const parent = matrixFromLocal({ position: [5, 0, 0], rotation: [0, 90, 0], scale: [2, 2, 2] });
    const child: LocalTransform = { position: [1, 0.5, 0], rotation: [0, 30, 0], scale: [0.5, 0.5, 0.5] };
    const world = new THREE.Matrix4().multiplyMatrices(parent, matrixFromLocal(child));
    // World position: parent rotates +X onto -Z, scales by 2, offsets by 5.
    const wp = new THREE.Vector3().setFromMatrixPosition(world);
    close([wp.x, wp.y, wp.z], [5, 1, -2]);
    const l = localFromWorld(world, parent, child);
    close(l.position, child.position);
    close(l.rotation, child.rotation);
    close(l.scale, child.scale);
  });
  it("maps a world drag into the parent's units", () => {
    const parent = matrixFromLocal({ position: [0, 1, 0], rotation: [0, 0, 0], scale: [2, 2, 2] });
    const world = matrixFromLocal({ position: [2, 1, 0], rotation: [0, 0, 0], scale: [2, 2, 2] }); // moved 2 m along world X
    close(localFromWorld(world, parent, start).position, [1, 0, 0]);
  });
});

describe("finishTransform", () => {
  const start: LocalTransform = { position: [0.333, 0, 1], rotation: [0, 10, 0], scale: [1, 1, 1] };
  const next: LocalTransform = { position: [1.13, 0.0004, 1], rotation: [3, 42.123456, 0.0001], scale: [1.234, 1.234, 1.234] };
  it("only changes the gizmo's channel", () => {
    const t = finishTransform(start, next, "translate", null);
    expect(t.position).toEqual([1.13, 0, 1]);
    expect(t.rotation).toEqual(start.rotation);
    expect(t.scale).toEqual(start.scale);
  });
  it("snaps translate and scale, rounds rotation", () => {
    expect(finishTransform(start, next, "translate", DEFAULT_SNAP).position).toEqual([1.25, 0, 1]);
    expect(finishTransform(start, next, "scale", DEFAULT_SNAP).scale).toEqual([1.2, 1.2, 1.2]);
    expect(finishTransform(start, next, "rotate", null).rotation).toEqual([3, 42.12, 0]);
  });
  it("never writes a zero scale", () => {
    expect(finishTransform(start, { ...next, scale: [0, -0.2, 1] }, "scale", null).scale).toEqual([0.001, 0.001, 1]);
  });
});

describe("transformFields", () => {
  it("keeps the scene's shapes (number scale, omitted defaults)", () => {
    expect(transformFields({}, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })).toEqual({ position: undefined, rotation: undefined, scale: undefined });
    expect(transformFields({ scale: 2 }, { position: [1, 0, 0], rotation: [0, 0, 0], scale: [3, 3, 3] })).toEqual({ position: [1, 0, 0], rotation: undefined, scale: 3 });
    expect(transformFields({ scale: [1, 2, 1] }, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2] }).scale).toEqual([2, 2, 2]);
    expect(transformFields({ position: [0, 0, 0] }, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 2, 1] })).toEqual({ position: [0, 0, 0], rotation: undefined, scale: [1, 2, 1] });
  });
  it("reads number and array scales", () => {
    expect(readTransform({ scale: 2 }).scale).toEqual([2, 2, 2]);
    expect(readTransform({ position: [1, 2, 3] })).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
  });
});

describe("frameSphere", () => {
  it("backs off along the current view direction until the sphere fits", () => {
    const f = frameSphere([0, 1, 0], 1, [0, 1, 10], 45, 1);
    expect(f.target).toEqual([0, 1, 0]);
    expect(f.position[0]).toBeCloseTo(0);
    expect(f.position[2]).toBeGreaterThan(2.5);
    expect(f.position[2]).toBeLessThan(4);
  });
});
