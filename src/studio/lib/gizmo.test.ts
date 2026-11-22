import { describe, expect, it } from "vitest";
import { defaultScene } from "../../core/validate";
import type { SceneDoc } from "../../core/types";
import { applyPatchOps } from "../../ops/scene";
import { cameraFromViewOps, lightMoveOps, lightPath, objectTransformOps, pickInChain } from "./gizmo";

function scene(): SceneDoc {
  const s = defaultScene({ id: "t" });
  s.lights = [{ type: "directional", position: [5, 10, 7] }, { id: "key", type: "spot", position: [1, 2, 3], target: [0, 0, 0] }];
  s.objects = [
    {
      id: "rig",
      kind: "group",
      position: [2, 0, 0],
      children: [{ id: "cube", kind: "mesh", geometry: { type: "box" }, scale: 2 }],
    },
  ];
  return s;
}

describe("gizmo patches", () => {
  it("writes a nested object's local transform as one undoable patch", () => {
    const s = scene();
    const ops = objectTransformOps(s, "cube", { position: [0.5, 1, 0], rotation: [0, 45, 0], scale: [2, 2, 2] });
    expect(ops).toEqual([
      { op: "set", path: "objects#cube.position", value: [0.5, 1, 0] },
      { op: "set", path: "objects#cube.rotation", value: [0, 45, 0] },
    ]);
    const next = applyPatchOps(s, ops);
    expect(next.objects[0].children![0].position).toEqual([0.5, 1, 0]);
    expect(next.objects[0].children![0].scale).toBe(2);
  });
  it("emits nothing when the drag ended where it started", () => {
    expect(objectTransformOps(scene(), "rig", { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })).toEqual([]);
  });
  it("addresses lights with or without id", () => {
    const s = scene();
    expect(lightPath(s, "light0")).toBe("lights[0]");
    expect(lightPath(s, "key")).toBe("lights#key");
    expect(lightPath(s, "nope")).toBeNull();
    expect(lightMoveOps(s, "key", "target", [1, 0, 1])).toEqual([{ op: "set", path: "lights#key.target", value: [1, 0, 1] }]);
    const next = applyPatchOps(s, lightMoveOps(s, "light0", "position", [0, 8, 4]));
    expect(next.lights![0].position).toEqual([0, 8, 4]);
  });
  it("sets the scene camera from the editor view (rounded)", () => {
    const s = scene();
    const ops = cameraFromViewOps(s, [1.23456, 2, 3.00001], [0, 0.5, 0]);
    const next = applyPatchOps(s, ops);
    expect(next.camera.position).toEqual([1.235, 2, 3]);
    expect(next.camera.target).toEqual([0, 0.5, 0]);
  });
  it("cycles click selection from the top-level group inwards", () => {
    const chain = ["cube", "rig"];
    expect(pickInChain(chain, null)).toBe("rig");
    expect(pickInChain(chain, "other")).toBe("rig");
    expect(pickInChain(chain, "rig")).toBe("cube");
    expect(pickInChain(chain, "cube")).toBe("cube");
    expect(pickInChain([], "cube")).toBeNull();
  });
});
