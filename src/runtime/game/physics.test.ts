import { describe, expect, it } from "vitest";
import { PhysicsWorld, type BodyInit, type V3 } from "./physics";

const run = (w: PhysicsWorld, seconds: number, dt = 1 / 60) => {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) w.step(dt);
};
const box = (id: string, type: BodyInit["type"], position: V3, size: V3 = [1, 1, 1], extra: Partial<BodyInit> = {}): BodyInit => ({
  id,
  type,
  position,
  shapes: [{ type: "box", half: [size[0] / 2, size[1] / 2, size[2] / 2] }],
  ...extra,
});
const ball = (id: string, type: BodyInit["type"], position: V3, radius = 0.5, extra: Partial<BodyInit> = {}): BodyInit => ({ id, type, position, shapes: [{ type: "sphere", radius }], ...extra });
const floor = (w: PhysicsWorld, extra: Partial<BodyInit> = {}) => w.add(box("floor", "static", [0, -0.5, 0], [40, 1, 40], extra));

describe("physics (rigid bodies)", () => {
  it("a dynamic box falls and rests on a static floor", () => {
    const w = new PhysicsWorld();
    floor(w);
    const b = w.add(box("box", "dynamic", [0, 3, 0]));
    run(w, 3);
    expect(b.position[1]).toBeCloseTo(0.5, 1);
    expect(Math.abs(b.velocity[1])).toBeLessThan(0.3);
    expect(b.grounded).toBe(true);
    expect(w.contactsOf("box").map((x) => x.id)).toEqual(["floor"]);
  });

  it("restitution bounces a sphere", () => {
    const w = new PhysicsWorld();
    floor(w, { restitution: 0.8 });
    const s = w.add(ball("ball", "dynamic", [0, 2, 0], 0.5, { restitution: 0.8 }));
    let maxUp = 0;
    for (let i = 0; i < 120; i++) {
      w.step(1 / 60);
      maxUp = Math.max(maxUp, s.velocity[1]);
    }
    expect(maxUp).toBeGreaterThan(2);
  });

  it("a box tips over an edge and rotates (real angular dynamics)", () => {
    const w = new PhysicsWorld();
    w.add(box("ledge", "static", [-1, -0.5, 0], [2, 1, 4]));
    // Centre of mass past the edge → it must tumble.
    const b = w.add(box("b", "dynamic", [0.3, 0.5, 0], [1, 1, 1]));
    run(w, 1.5);
    const q = b.quaternion;
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q[3])));
    expect(angle).toBeGreaterThan(0.3);
  });

  it("spheres roll down a slope (friction turns sliding into rotation)", () => {
    const w = new PhysicsWorld();
    const a = (-15 * Math.PI) / 180;
    w.add({ id: "ramp", type: "static", position: [0, 0, 0], quaternion: [0, 0, Math.sin(a / 2), Math.cos(a / 2)], shapes: [{ type: "box", half: [10, 0.25, 3] }] });
    const s = w.add(ball("s", "dynamic", [-4, 2, 0], 0.4, { friction: 0.8 }));
    run(w, 2);
    expect(s.position[0]).toBeGreaterThan(-2);
    expect(Math.abs(s.angularVelocity[2])).toBeGreaterThan(1);
  });

  it("triggers report begin / end once and never push", () => {
    const w = new PhysicsWorld([0, 0, 0]);
    const p = w.add(ball("p", "dynamic", [-1, 0, 0], 0.25, { velocity: [3, 0, 0] }));
    w.add(box("coin", "trigger", [0, 0, 0], [0.5, 0.5, 0.5]));
    const begin: string[] = [], end: string[] = [];
    w.onCollision((a, b) => begin.push(a.id + ":" + b.id));
    w.onCollisionEnd((a, b) => end.push(a.id + ":" + b.id));
    run(w, 1);
    expect(begin).toEqual(["p:coin"]);
    expect(end).toEqual(["p:coin"]);
    expect(p.velocity[0]).toBeGreaterThan(2.9); // only linear damping
  });

  it("overlaps works between kinematic, trigger and static bodies without a step", () => {
    const w = new PhysicsWorld();
    w.add(box("player", "kinematic", [0, 0.5, 0], [0.8, 0.8, 0.8]));
    w.add({ id: "coin", type: "trigger", position: [3, 0.5, 0], shapes: [{ type: "cylinder", radius: 0.3, height: 0.1 }] });
    expect(w.overlaps("player", "coin")).toBe(false);
    w.setPose("player", [2.8, 0.5, 0]);
    expect(w.overlaps("player", "coin")).toBe(true);
    expect(w.overlaps("coin", "player")).toBe(true);
  });

  it("collision events carry point, normal and impulse", () => {
    const w = new PhysicsWorld();
    floor(w);
    w.add(ball("ball", "dynamic", [0, 3, 0], 0.5));
    const events: { a: string; b: string; n: V3; p: V3; impulse: number; speed: number }[] = [];
    w.onCollision((a, b, info) => events.push({ a: a.id, b: b.id, n: info.normal, p: info.point, impulse: info.impulse, speed: info.speed }));
    run(w, 1.5);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const e = events[0]!;
    expect([e.a, e.b]).toEqual(["floor", "ball"]);
    expect(e.n[1]).toBeCloseTo(1, 2); // floor → ball
    expect(e.p[1]).toBeCloseTo(0, 1);
    expect(e.impulse).toBeGreaterThan(1);
    expect(e.speed).toBeGreaterThan(5);
  });

  it("kinematic bodies move with their velocity, ignore gravity and push dynamic bodies", () => {
    const w = new PhysicsWorld();
    const k = w.add(box("k", "kinematic", [0, 0, 0], [1, 1, 1], { velocity: [1, 0, 0] }));
    run(w, 1);
    expect(k.position[0]).toBeCloseTo(1, 2);
    expect(k.position[1]).toBe(0);
    // A scripted platform carries a box resting on it.
    const w2 = new PhysicsWorld();
    w2.add(box("plat", "kinematic", [0, 0, 0], [4, 0.5, 4]));
    const b = w2.add(box("b", "dynamic", [0, 0.75, 0], [1, 1, 1], { friction: 0.8 }));
    run(w2, 0.5);
    for (let i = 0; i < 60; i++) {
      w2.setPose("plat", [(i + 1) * 0.02, 0, 0]);
      w2.step(1 / 60);
    }
    expect(b.position[0]).toBeGreaterThan(0.8);
  });

  it("raycasts real shapes (nearest hit, normal, ignore, triggers)", () => {
    const w = new PhysicsWorld();
    w.add(box("box", "static", [5, 0, 0], [2, 2, 2]));
    w.add(ball("ball", "static", [10, 0, 0], 1));
    w.add(box("zone", "trigger", [2, 0, 0], [0.5, 4, 4]));
    expect(w.raycast([0, 0, 0], [1, 0, 0])?.body.id).toBe("zone");
    const hit = w.raycast([0, 0, 0], [1, 0, 0], Infinity, { triggers: false });
    expect(hit?.body.id).toBe("box");
    expect(hit?.distance).toBeCloseTo(4);
    expect(hit?.normal[0]).toBeCloseTo(-1);
    expect(w.raycast([0, 0, 0], [1, 0, 0], 1.5)).toBeNull();
    expect(w.raycast([10, 5, 0], [0, -1, 0])?.distance).toBeCloseTo(4);
    expect(w.raycast([0, 0, 0], [1, 0, 0], Infinity, { triggers: false, ignore: (b) => b.id === "box" })?.body.id).toBe("ball");
  });

  it("collision layers filter contacts", () => {
    const w = new PhysicsWorld({ layers: ["ghost"] });
    floor(w);
    const g = w.add(box("g", "dynamic", [0, 2, 0], [1, 1, 1], { layer: "ghost", collidesWith: ["ghost"] }));
    const s = w.add(box("s", "dynamic", [3, 2, 0], [1, 1, 1]));
    run(w, 1.5);
    expect(g.position[1]).toBeLessThan(-2); // fell through the floor
    expect(s.position[1]).toBeCloseTo(0.5, 1);
  });

  it("friction materials and contact overrides", () => {
    const w = new PhysicsWorld({ materials: { ice: { friction: 0.01 }, rubber: { friction: 1 } }, contacts: [{ a: "ice", b: "rubber", friction: 0 }] });
    w.add(box("rink", "static", [0, -0.5, 0], [200, 1, 10], { material: "ice" }));
    const slide = w.add(box("puck", "dynamic", [0, 0.5, 0], [1, 1, 1], { material: "rubber", velocity: [5, 0, 0], fixedRotation: true }));
    w.add(box("ground", "static", [0, -0.5, 30], [200, 1, 10], { friction: 0.8 }));
    const stop = w.add(box("crate", "dynamic", [0, 0.5, 30], [1, 1, 1], { friction: 0.8, velocity: [5, 0, 0], fixedRotation: true }));
    run(w, 2);
    expect(slide.velocity[0]).toBeGreaterThan(4.5);
    expect(Math.abs(stop.velocity[0])).toBeLessThan(0.1);
  });

  it("a hinge joint to the world makes a door swing around its edge", () => {
    const w = new PhysicsWorld([0, 0, 0]);
    const door = w.add(box("door", "dynamic", [0.5, 1, 0], [1, 2, 0.1]));
    w.addJoint({ type: "hinge", a: "door", pivot: [0, 1, 0], axis: [0, 1, 0] });
    w.applyImpulse("door", [0, 0, 0.2], [1, 1, 0]);
    run(w, 1);
    // The hinge edge stays put: the door centre stays 0.5 from the axis.
    const p = door.position;
    expect(Math.hypot(p[0], p[2])).toBeCloseTo(0.5, 1);
    expect(p[2]).toBeGreaterThan(0.2);
    expect(p[1]).toBeCloseTo(1, 2);
  });

  it("a point joint pendulum keeps its length and swings", () => {
    const w = new PhysicsWorld();
    const bob = w.add(ball("bob", "dynamic", [2, 3, 0], 0.25));
    w.addJoint({ type: "point", a: "bob", pivot: [0, 3, 0] });
    let minX = Infinity;
    for (let i = 0; i < 120; i++) {
      w.step(1 / 60);
      minX = Math.min(minX, bob.position[0]);
      expect(Math.abs(Math.hypot(bob.position[0], bob.position[1] - 3) - 2)).toBeLessThan(0.1);
    }
    expect(minX).toBeLessThan(-1);
  });

  it("distance, lock and spring joints", () => {
    const w = new PhysicsWorld([0, 0, 0]);
    w.add(ball("a", "dynamic", [0, 0, 0], 0.2));
    const b = w.add(ball("b", "dynamic", [2, 0, 0], 0.2, { velocity: [0, 3, 0] }));
    w.addJoint({ type: "distance", a: "a", b: "b" });
    run(w, 1);
    const pa = w.get("a")!.position;
    expect(Math.hypot(b.position[0] - pa[0], b.position[1] - pa[1])).toBeCloseTo(2, 1);

    const w2 = new PhysicsWorld([0, 0, 0]);
    w2.add(box("x", "dynamic", [0, 0, 0]));
    const y = w2.add(box("y", "dynamic", [1, 0, 0]));
    w2.addJoint({ type: "lock", a: "x", b: "y" });
    w2.applyImpulse("x", [0, 2, 0]);
    run(w2, 0.5);
    expect(y.velocity[1]).toBeGreaterThan(0.3);

    const w3 = new PhysicsWorld();
    const s = w3.add(ball("s", "dynamic", [0, 2, 0], 0.2));
    w3.addJoint({ type: "spring", a: "s", pivot: [0, 3, 0], restLength: 1, stiffness: 80, damping: 4 });
    run(w3, 4);
    // Hangs below the anchor: rest length + m g / k.
    expect(s.position[1]).toBeCloseTo(3 - 1 - 9.81 / 80, 1);
  });

  it("hinge motors spin", () => {
    const w = new PhysicsWorld([0, 0, 0]);
    const wheel = w.add({ id: "wheel", type: "dynamic", position: [0, 1, 0], shapes: [{ type: "cylinder", radius: 0.5, height: 0.2 }] });
    w.addJoint({ type: "hinge", a: "wheel", pivot: [0, 1, 0], axis: [0, 1, 0], motor: { speed: 3, maxForce: 50 } });
    run(w, 1);
    expect(Math.abs(wheel.angularVelocity[1])).toBeCloseTo(3, 0);
  });

  it("character controller: move, ground check, jump with coyote time", () => {
    const w = new PhysicsWorld();
    floor(w);
    const hero = w.add({ id: "hero", type: "dynamic", position: [0, 1, 0], shapes: [{ type: "capsule", radius: 0.3, height: 1.2 }], character: true });
    run(w, 1);
    expect(w.grounded("hero")).toBe(true);
    for (let i = 0; i < 60; i++) {
      w.moveCharacter("hero", [1, 0], { speed: 4 });
      w.step(1 / 60);
    }
    expect(hero.velocity[0]).toBeCloseTo(4, 1);
    expect(hero.position[0]).toBeGreaterThan(3);
    expect(Math.abs(hero.quaternion[3])).toBeCloseTo(1, 5); // never tips over
    expect(w.jump("hero", 6)).toBe(true);
    w.step(1 / 60);
    expect(w.jump("hero", 6)).toBe(false); // no double jump
    expect(hero.velocity[1]).toBeGreaterThan(4);
    for (let i = 0; i < 30; i++) {
      w.moveCharacter("hero", [0, 0]);
      w.step(1 / 60);
    }
    expect(w.grounded("hero")).toBe(false);
  });

  it("convex, trimesh and heightfield shapes collide with boxes", () => {
    // Trimesh: a flat 2-triangle quad, static.
    const w = new PhysicsWorld();
    w.add({ id: "ground", type: "static", position: [0, 0, 0], shapes: [{ type: "trimesh", vertices: [-5, 0, -5, -5, 0, 5, 5, 0, 5, 5, 0, -5], indices: [0, 1, 2, 0, 2, 3] }] });
    const b = w.add(box("b", "dynamic", [0, 2, 0]));
    // Convex tetrahedron-ish wedge.
    const c = w.add({
      id: "c",
      type: "dynamic",
      position: [2, 2, 0],
      shapes: [{ type: "convex", vertices: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [0, 0.5, 0]], faces: [[0, 1, 2, 3].reverse(), [0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0]] }],
    });
    run(w, 2);
    expect(b.position[1]).toBeCloseTo(0.5, 1);
    expect(c.position[1]).toBeGreaterThan(0.2);
    expect(c.position[1]).toBeLessThan(0.8);

    const h = new PhysicsWorld();
    const data = Array.from({ length: 11 }, () => Array.from({ length: 11 }, () => 1));
    h.add({ id: "terrain", type: "static", position: [-5, 0, 5], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], shapes: [{ type: "heightfield", data, elementSize: 1 }] });
    const s = h.add(ball("s", "dynamic", [0, 3, 0], 0.5));
    const bx = h.add(box("bx", "dynamic", [2, 3, 1]));
    run(h, 2);
    expect(s.position[1]).toBeCloseTo(1.5, 1);
    expect(bx.position[1]).toBeCloseTo(1.5, 1);
  });

  it("sleeping: a resting stack falls asleep and wakes on impulse", () => {
    const w = new PhysicsWorld();
    floor(w);
    const boxes = [0, 1, 2].map((i) => w.add(box(`b${i}`, "dynamic", [0, 0.5 + i * 1.01, 0])));
    run(w, 4);
    expect(boxes.every((b) => b.sleeping)).toBe(true);
    expect(boxes[2]!.position[1]).toBeCloseTo(2.5, 1);
    w.applyImpulse("b0", [3, 0, 0]);
    expect(boxes[0]!.sleeping).toBe(false);
  });

  it("ccd sub-steps stop a fast ball tunnelling through a thin wall", () => {
    const make = (ccd: boolean) => {
      const w = new PhysicsWorld([0, 0, 0]);
      w.add(box("wall", "static", [0, 0, 0], [0.1, 4, 4]));
      return { w, b: w.add(ball("b", "dynamic", [-3, 0, 0], 0.1, { velocity: [60, 0, 0], ccd })) };
    };
    const fast = make(true);
    run(fast.w, 0.5);
    expect(fast.b.position[0]).toBeLessThan(0);
  });

  it("gravity scale and forces", () => {
    const w = new PhysicsWorld();
    const light = w.add(ball("l", "dynamic", [0, 10, 0], 0.5, { gravityScale: 0.5 }));
    const normal = w.add(ball("n", "dynamic", [3, 10, 0], 0.5));
    run(w, 1);
    expect(10 - light.position[1]).toBeCloseTo((10 - normal.position[1]) / 2, 1);
    const w2 = new PhysicsWorld([0, 0, 0]);
    const p = w2.add(ball("p", "dynamic", [0, 0, 0], 0.5, { mass: 2 }));
    for (let i = 0; i < 60; i++) {
      w2.applyForce("p", [4, 0, 0]);
      w2.step(1 / 60);
    }
    expect(p.velocity[0]).toBeCloseTo(2, 1); // a = F / m = 2, 1 s
    w2.applyTorque("p", [0, 5, 0]);
    w2.step(1 / 60);
    expect(p.angularVelocity[1]).toBeGreaterThan(0);
  });

  it("is deterministic: two identical worlds give identical transforms", () => {
    const build = () => {
      const w = new PhysicsWorld();
      floor(w);
      for (let i = 0; i < 10; i++) w.add(box(`b${i}`, "dynamic", [(i % 3) * 0.4, 0.5 + i * 1.05, (i % 2) * 0.3]));
      w.add(ball("s", "dynamic", [-4, 0.5, 0], 0.5, { velocity: [8, 0, 0] }));
      return w;
    };
    const a = build(), b = build();
    run(a, 3);
    run(b, 3);
    for (const body of a.bodies) {
      const o = b.get(body.id)!;
      expect(o.position).toEqual(body.position);
      expect(o.quaternion).toEqual(body.quaternion);
    }
  });

  it("removing a body drops its joints and contacts", () => {
    const w = new PhysicsWorld();
    floor(w);
    w.add(box("a", "dynamic", [0, 0.5, 0]));
    w.addJoint({ id: "j", type: "point", a: "a", pivot: [0, 2, 0] });
    run(w, 0.2);
    w.remove("a");
    expect(w.jointIds()).toEqual([]);
    expect(w.contactsOf("floor")).toEqual([]);
    run(w, 0.2);
  });
});
