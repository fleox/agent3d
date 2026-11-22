import { describe, expect, it } from "vitest";
import { defaultScene, validateScene } from "../../core/validate";
import { SHOT_PARAMS, SHOT_TYPES, newShot, shotsEnd } from "./shots";

describe("camera shots", () => {
  it("has fields for every shot type and a valid default", () => {
    for (const type of SHOT_TYPES) {
      expect(SHOT_PARAMS[type], type).toBeDefined();
      const scene = defaultScene();
      const shot = newShot(scene, type);
      const withDof = { ...scene, camera: { ...scene.camera, shots: [shot] }, ...(type === "focus" ? { postfx: [{ type: "dof" }] } : {}) };
      expect(validateScene(withDof).filter((i) => i.severity === "error" && i.path.startsWith("camera")), type).toEqual([]);
    }
  });
  it("appends after the last shot", () => {
    const scene = defaultScene();
    scene.camera.shots = [{ type: "pushIn", at: 0.5, duration: 2 }];
    expect(newShot(scene, "orbit").at).toBe(2.5);
    expect(shotsEnd(scene.camera.shots)).toBe(2.5);
  });
});
