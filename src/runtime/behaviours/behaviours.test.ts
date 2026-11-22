import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BehaviourDef } from "../../core/types";
import { createRng } from "../random";
import type { BehaviourContext } from "../registry";
import { BEHAVIOUR_IMPLS } from "./index";
import { createRunner } from "./runner";

function ctxFor(obj = new THREE.Object3D(), over: Partial<BehaviourContext> = {}): BehaviourContext {
  return {
    object: obj,
    base: { position: obj.position.clone(), rotation: obj.rotation.clone(), scale: obj.scale.clone() },
    pointer: { x: 0, y: 0, inside: false },
    hovered: () => false,
    clicked: () => false,
    scroll: () => 0,
    camera: new THREE.PerspectiveCamera(),
    rng: createRng(1),
    ...over,
  };
}

const step = (type: string, params: Record<string, unknown>, t: number, ctx = ctxFor()) => {
  BEHAVIOUR_IMPLS[type]({ type, ...params } as BehaviourDef, ctx).update(t, 1 / 60);
  return ctx.object;
};

describe("behaviours", () => {
  it("rotate spins at speed deg/s around the axis", () => {
    const o = step("rotate", { axis: [0, 1, 0], speed: 90 }, 1);
    expect(o.rotation.y).toBeCloseTo(Math.PI / 2);
  });
  it("float offsets y with a sine", () => {
    expect(step("float", { amplitude: 0.5, speed: 0.25 }, 1).position.y).toBeCloseTo(0.5);
  });
  it("pulse scales uniformly", () => {
    expect(step("pulse", { amount: 0.1, speed: 0.25 }, 1).scale.x).toBeCloseTo(1.1);
  });
  it("orbit circles the centre keeping the height", () => {
    const o = new THREE.Object3D();
    o.position.set(0, 2, 0);
    step("orbit", { radius: 3, speed: 90, center: [1, 0, 0] }, 1, ctxFor(o));
    expect(o.position.y).toBeCloseTo(2);
    expect(Math.hypot(o.position.x - 1, o.position.z)).toBeCloseTo(3);
  });
  it("scrollMove follows the scroll progress", () => {
    const o = step("scrollMove", { offset: [0, 4, 0] }, 0, ctxFor(new THREE.Object3D(), { scroll: () => 0.5 }));
    expect(o.position.y).toBeCloseTo(2);
  });
  it("appear scales from 0 to 1", () => {
    expect(step("appear", { effect: "scale", duration: 1, ease: "outCubic" }, 0).scale.x).toBeLessThan(0.01);
    expect(step("appear", { effect: "scale", duration: 1 }, 2).scale.x).toBeCloseTo(1);
  });
  it("drift stays within the area", () => {
    for (let t = 0; t < 30; t += 0.7) {
      const o = step("drift", { area: [2, 2, 2], speed: 1 }, t);
      expect(Math.abs(o.position.x)).toBeLessThanOrEqual(1.0001);
    }
  });
  it("every behaviour runs without throwing", () => {
    for (const type of Object.keys(BEHAVIOUR_IMPLS)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      expect(() => step(type, { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] }, 0.5, ctxFor(mesh))).not.toThrow();
    }
  });
});

describe("behaviour runner", () => {
  it("settles entrance behaviours (reduced motion static)", () => {
    const o = new THREE.Object3D();
    const r = createRunner({ type: "appear", effect: "rise", duration: 1, delay: 0.5 }, BEHAVIOUR_IMPLS.appear, ctxFor(o), { settled: () => true });
    r.step(0, 0);
    expect(o.scale.x).toBeCloseTo(1);
    expect(o.position.y).toBeCloseTo(0);
    const o2 = new THREE.Object3D();
    createRunner({ type: "appear", effect: "rise", duration: 1 }, BEHAVIOUR_IMPLS.appear, ctxFor(o2), { settled: () => false }).step(0, 0);
    expect(o2.scale.x).toBeLessThan(0.01);
  });
  it("respects delay", () => {
    const o = new THREE.Object3D();
    const r = createRunner({ type: "rotate", speed: 90, delay: 1 }, BEHAVIOUR_IMPLS.rotate, ctxFor(o));
    r.step(0.5, 0.5);
    expect(o.rotation.y).toBeCloseTo(0);
    r.step(2, 1.5);
    expect(o.rotation.y).toBeCloseTo(Math.PI / 2);
  });
  it("hover only advances while hovered", () => {
    let hovered = false;
    const o = new THREE.Object3D();
    const r = createRunner({ type: "rotate", speed: 90, when: "hover" }, BEHAVIOUR_IMPLS.rotate, ctxFor(o, { hovered: () => hovered }));
    r.step(1, 1);
    expect(o.rotation.y).toBeCloseTo(0);
    hovered = true;
    o.rotation.set(0, 0, 0);
    r.step(2, 1);
    expect(o.rotation.y).toBeCloseTo(Math.PI / 2);
  });
  it("click starts on the first click", () => {
    let clicked = false;
    const o = new THREE.Object3D();
    const r = createRunner({ type: "rotate", speed: 90, when: "click" }, BEHAVIOUR_IMPLS.rotate, ctxFor(o, { clicked: () => clicked }));
    r.step(1, 1);
    expect(o.rotation.y).toBe(0);
    clicked = true;
    r.step(2, 1);
    clicked = false;
    o.rotation.set(0, 0, 0);
    r.step(3, 1);
    expect(o.rotation.y).toBeCloseTo(Math.PI / 2);
  });
});

describe("motion behaviours", () => {
  it("spring follows the pointer, overshoots and settles", async () => {
    const { springStep } = await import("./spring");
    let x = 0, v = 0, max = 0;
    for (let i = 0; i < 120; i++) {
      [x, v] = springStep(x, v, 1, 1 / 60, 120, 8);
      max = Math.max(max, x);
    }
    expect(max).toBeGreaterThan(1.05);
    expect(x).toBeCloseTo(1, 2);
    const ctx = ctxFor(new THREE.Object3D(), { pointer: { x: 1, y: 0, inside: true } });
    const inst = BEHAVIOUR_IMPLS.spring({ type: "spring", strength: 1 } as BehaviourDef, ctx);
    inst.update(0, 3);
    expect(ctx.object.position.x).toBeCloseTo(1, 2);
  });
  it("parallax moves by depth, tilt leans when hovered", () => {
    const p = step("parallax", { depth: 1, pointer: 0.5, smoothing: 0 }, 0, ctxFor(new THREE.Object3D(), { pointer: { x: 1, y: 0, inside: true } }));
    expect(p.position.x).toBeCloseTo(0.5);
    const t = step("tilt", { maxAngle: 10, smoothing: 0 }, 0, ctxFor(new THREE.Object3D(), { pointer: { x: 1, y: 0, inside: true }, hovered: () => true }));
    expect(t.rotation.y).toBeCloseTo((10 * Math.PI) / 180);
    expect(t.scale.x).toBeCloseTo(1.04);
  });
  it("breathe expands Y most at the top of the inhale", () => {
    const o = step("breathe", { amount: 0.1, period: 1, rise: 0 }, 0.6);
    expect(o.scale.y).toBeCloseTo(1.1);
    expect(o.scale.x).toBeCloseTo(1.05);
  });
  it("noise is deterministic and bounded", () => {
    const a = step("noise", { amplitude: [1, 1, 1], seed: 2 }, 3, ctxFor(new THREE.Object3D(), { rng: createRng(5) }));
    const b = step("noise", { amplitude: [1, 1, 1], seed: 2 }, 3, ctxFor(new THREE.Object3D(), { rng: createRng(5) }));
    expect(a.position.toArray()).toEqual(b.position.toArray());
    expect(Math.abs(a.position.x)).toBeLessThanOrEqual(1.01);
  });
  it("lookAt turns +Z toward the target", () => {
    const target = new THREE.Object3D();
    target.position.set(5, 0, 0);
    const o = step("lookAt", { target: "t", smoothing: 0 }, 0, ctxFor(new THREE.Object3D(), { find: () => target }));
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
    expect(fwd.x).toBeCloseTo(1);
  });
});
