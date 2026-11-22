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
