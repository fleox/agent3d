import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SceneDoc } from "../../core/types";
import { defaultScene } from "../../core/validate";
import { createRng } from "../random";
import { toColor } from "../util";
import type { RuntimeContext } from "./context";
import { motionGrid } from "../behaviours/runner";
import { World, type FrameInput } from "./index";

function ctxFor(scene: SceneDoc): RuntimeContext {
  return {
    scene,
    rng: createRng(1),
    siblings: new Map(),
    color: (c) => toColor(c),
    resolveAsset: (p) => p,
    renderer: null,
    deterministic: true,
    track: (p) => p,
    onUpdate: () => undefined,
    issue: () => undefined,
    shaders: async () => ({}),
    generators: async () => ({}),
  };
}

const input = (t: number | null): FrameInput => ({ pointer: { x: 0, y: 0, inside: false }, scroll: 0, hovered: new Set(), clicked: new Set(), timelineT: t });

// A camera that moves along a timeline track and a label facing it.
function sceneWith(behaviour: Record<string, unknown>): SceneDoc {
  const s = defaultScene({ id: "w", kind: "banner" });
  s.environment = { background: "#ffffff" };
  s.camera = { type: "perspective", fov: 40, position: [0, 1, 8], target: [0, 1, 0] };
  s.objects = [{ id: "label", kind: "mesh", geometry: { type: "plane" }, position: [0, 1, 0], behaviours: [behaviour as never] }];
  s.timeline = { duration: 10, tracks: [{ target: "camera.position", keys: [[0, [0, 1, 8]], [10, [8, 1, 0]]] }] } as never;
  return s;
}

async function yawAfter(scene: SceneDoc, frames: number[]): Promise<number> {
  const w = await World.create(scene, ctxFor(scene), 16 / 9, null);
  let prev = 0;
  w.frame(0, 0, input(0));
  for (const t of frames) {
    w.frame(t, t - prev, input(t));
    prev = t;
  }
  const label = w.entries.get("label")!.object;
  return new THREE.Euler().setFromQuaternion(label.quaternion, "YXZ").y;
}

describe("World frame order", () => {
  it("billboard faces the camera pose of the same frame (seek-independent)", async () => {
    const s = sceneWith({ type: "billboard" });
    const alone = await yawAfter(s, [9]);
    const seq = await yawAfter(s, [1, 5, 9]);
    expect(alone).toBeCloseTo(seq, 6);
    // Camera at t = 9 is at (7.2, 1, 0.8): the label yaw points at it.
    expect(alone).toBeCloseTo(Math.atan2(7.2, 0.8), 3);
  });

  it("flags history-dependent motion for grid seeks", async () => {
    const a = sceneWith({ type: "billboard" });
    const b = sceneWith({ type: "lookAt", target: "camera" });
    const wa = await World.create(a, ctxFor(a), 1, null);
    const wb = await World.create(b, ctxFor(b), 1, null);
    expect(wa.hasStatefulMotion()).toBe(false);
    expect(wb.hasStatefulMotion()).toBe(true);
  });
});

describe("deterministic seek grid", () => {
  it("motionGrid walks the same points whatever the intermediate seeks", () => {
    const solo = motionGrid(0, 9);
    const seq = [...motionGrid(0, 1), 1, ...motionGrid(1, 5), 5, ...motionGrid(5, 9)];
    expect(solo.length).toBe(269);
    expect(seq.length).toBe(solo.length);
    seq.forEach((t, i) => expect(t).toBeCloseTo(solo[i], 9));
  });

  it("smoothed lookAt gives the same pose at t = 9 rendered alone or after other frames", async () => {
    const s = sceneWith({ type: "lookAt", target: "camera", smoothing: 0.9 });
    const run = async (frames: number[]) => {
      const w = await World.create(s, ctxFor(s), 16 / 9, null);
      let prev = 0;
      w.frame(0, 0, input(0));
      for (const target of frames) {
        for (const g of motionGrid(prev, target)) (w.frame(g, g - prev, input(g)), (prev = g));
        w.frame(target, target - prev, input(target));
        prev = target;
      }
      return w.entries.get("label")!.object.quaternion.clone();
    };
    const a = await run([9]);
    const b = await run([1, 5, 9]);
    expect(a.angleTo(b)).toBeLessThan(1e-4);
  });
});
