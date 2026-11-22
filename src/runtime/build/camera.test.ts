import { describe, expect, it } from "vitest";
import { fitScale, fittedFov } from "./camera";

describe("responsive camera fit", () => {
  it("keeps the authored framing at or above the design aspect", () => {
    expect(fitScale(4, 4)).toBe(1);
    expect(fitScale(16 / 9, 4 / 3)).toBe(1);
    expect(fitScale(2, undefined)).toBe(1);
    expect(fittedFov(30, 1)).toBe(30);
  });
  it("widens the view on narrower canvases so the sides are not cropped", () => {
    expect(fitScale(2, 4)).toBe(2);
    const fov = fittedFov(30, 2);
    // same horizontal extent: tan(fov'/2) = 2 tan(fov/2)
    expect(Math.tan(((fov / 2) * Math.PI) / 180)).toBeCloseTo(2 * Math.tan((15 * Math.PI) / 180), 6);
  });
  it("is capped", () => {
    expect(fitScale(0.1, 4)).toBe(3);
    expect(fittedFov(80, 3)).toBe(100);
  });
});

describe("camera: clip-plane guard", () => {
  it("never leaves the camera exactly on an authored plane (clip w = 0 garbage)", async () => {
    const THREE = await import("three");
    const { createCamera, nudgeOffPlanes, CAMERA_PLANE_NUDGE } = await import("./camera");
    const cam = createCamera({ type: "perspective", position: [0, 2.3, 10], target: [0, 2.3, 0] }, 16 / 9);
    // A floor box whose front face is at z = 10 must lie strictly in front of the camera.
    expect(cam.position.z).toBeGreaterThan(10);
    expect(cam.position.z - 10).toBeCloseTo(CAMERA_PLANE_NUDGE, 8);
    cam.updateMatrixWorld(true);
    const v = new THREE.Vector4(5, -0.1, 10, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    expect(Math.abs(v.w)).toBeGreaterThan(1e-5);
    const p = new THREE.Vector3(1, 1, 1);
    nudgeOffPlanes(p, new THREE.Vector3(1, 1, 1)); // degenerate: no direction, unchanged
    expect(p.toArray()).toEqual([1, 1, 1]);
  });
});
