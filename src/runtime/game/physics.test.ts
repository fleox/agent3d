import { describe, expect, it } from "vitest";
import { PhysicsWorld, collide } from "./physics";

const run = (w: PhysicsWorld, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) w.step(dt);
};

describe("physics", () => {
  it("a dynamic box falls and rests on a static floor", () => {
    const w = new PhysicsWorld();
    w.add({ id: "floor", type: "static", shape: "box", position: [0, -0.5, 0], size: [10, 1, 10] });
    const b = w.add({ id: "box", type: "dynamic", shape: "box", position: [0, 3, 0], size: [1, 1, 1] });
    run(w, 3);
    expect(b.position[1]).toBeCloseTo(0.5, 1);
    expect(Math.abs(b.velocity[1])).toBeLessThan(0.3);
    expect(b.grounded).toBe(true);
    expect(w.contactsOf("box").map((x) => x.id)).toEqual(["floor"]);
  });

  it("restitution bounces a sphere", () => {
    const w = new PhysicsWorld();
    w.add({ id: "floor", type: "static", shape: "box", position: [0, -0.5, 0], size: [10, 1, 10] });
    const s = w.add({ id: "ball", type: "dynamic", shape: "sphere", position: [0, 2, 0], radius: 0.5, restitution: 0.8 });
    let maxUp = 0;
    for (let i = 0; i < 120; i++) {
      w.step(1 / 60);
      maxUp = Math.max(maxUp, s.velocity[1]);
    }
    expect(maxUp).toBeGreaterThan(2);
  });

  it("triggers report contacts without pushing", () => {
    const w = new PhysicsWorld([0, 0, 0]);
    const p = w.add({ id: "p", type: "dynamic", shape: "sphere", position: [0, 0, 0], radius: 0.5, velocity: [1, 0, 0] });
    w.add({ id: "coin", type: "trigger", shape: "box", position: [0.5, 0, 0], size: [0.5, 0.5, 0.5] });
    const events: string[] = [];
    w.onCollision((a, b) => events.push(a.id + ":" + b.id));
    w.step(1 / 60);
    w.step(1 / 60);
    expect(events).toEqual(["p:coin"]); // begin only once
    expect(p.velocity[0]).toBeCloseTo(1);
    expect(w.overlaps("p", "coin")).toBe(true);
  });

  it("dynamic bodies push each other by mass", () => {
    const w = new PhysicsWorld([0, 0, 0]);
    const a = w.add({ id: "a", type: "dynamic", shape: "box", position: [0, 0, 0], size: [1, 1, 1], velocity: [2, 0, 0], restitution: 0 });
    const b = w.add({ id: "b", type: "dynamic", shape: "box", position: [1.05, 0, 0], size: [1, 1, 1], restitution: 0 });
    run(w, 0.2);
    expect(a.velocity[0]).toBeCloseTo(b.velocity[0], 1);
    expect(b.velocity[0]).toBeGreaterThan(0.5);
  });

  it("friction slows sliding boxes", () => {
    const w = new PhysicsWorld();
    w.add({ id: "floor", type: "static", shape: "box", position: [0, -0.5, 0], size: [100, 1, 10], friction: 0.8 });
    const b = w.add({ id: "box", type: "dynamic", shape: "box", position: [0, 0.5, 0], size: [1, 1, 1], velocity: [5, 0, 0], friction: 0.8 });
    run(w, 2);
    expect(Math.abs(b.velocity[0])).toBeLessThan(0.1);
  });

  it("kinematic bodies move with their velocity and ignore gravity", () => {
    const w = new PhysicsWorld();
    const k = w.add({ id: "k", type: "kinematic", shape: "box", position: [0, 0, 0], velocity: [1, 0, 0] });
    run(w, 1);
    expect(k.position[0]).toBeCloseTo(1, 1);
    expect(k.position[1]).toBe(0);
  });

  it("raycasts boxes and spheres (nearest hit)", () => {
    const w = new PhysicsWorld();
    w.add({ id: "box", type: "static", shape: "box", position: [5, 0, 0], size: [2, 2, 2] });
    w.add({ id: "ball", type: "static", shape: "sphere", position: [10, 0, 0], radius: 1 });
    const hit = w.raycast([0, 0, 0], [1, 0, 0]);
    expect(hit?.body.id).toBe("box");
    expect(hit?.distance).toBeCloseTo(4);
    expect(w.raycast([0, 0, 0], [1, 0, 0], 3)).toBeNull();
    expect(w.raycast([10, 5, 0], [0, -1, 0])?.distance).toBeCloseTo(4);
  });

  it("applies impulses by inverse mass", () => {
    const w = new PhysicsWorld([0, 0, 0]);
    const b = w.add({ id: "b", type: "dynamic", shape: "box", position: [0, 0, 0], mass: 2 });
    w.applyImpulse("b", [0, 4, 0]);
    expect(b.velocity[1]).toBe(2);
    w.add({ id: "s", type: "static", shape: "box", position: [9, 9, 9] });
    w.applyImpulse("s", [1, 1, 1]);
    expect(w.get("s")!.velocity).toEqual([0, 0, 0]);
  });

  it("box/sphere narrow phase normal points from a to b", () => {
    const w = new PhysicsWorld();
    const box = w.add({ id: "box", type: "static", shape: "box", position: [0, 0, 0], size: [2, 2, 2] });
    const s = w.add({ id: "s", type: "dynamic", shape: "sphere", position: [0, 1.4, 0], radius: 0.5 });
    expect(collide(box, s)?.normal).toEqual([0, 1, 0]);
    expect(collide(s, box)?.normal).toEqual([-0, -1, -0]);
    expect(collide(box, s)?.depth).toBeCloseTo(0.1);
  });

  it("is deterministic", () => {
    const sim = () => {
      const w = new PhysicsWorld();
      w.add({ id: "floor", type: "static", shape: "box", position: [0, -0.5, 0], size: [10, 1, 10] });
      for (let i = 0; i < 5; i++) w.add({ id: "b" + i, type: "dynamic", shape: i % 2 ? "sphere" : "box", position: [i * 0.3, 1 + i * 1.1, 0], size: [1, 1, 1], radius: 0.5 });
      run(w, 2);
      return w.bodies.map((b) => b.position.map((v) => v.toFixed(6)).join(",")).join("|");
    };
    expect(sim()).toBe(sim());
  });
});
