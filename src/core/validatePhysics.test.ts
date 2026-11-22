import { describe, expect, it } from "vitest";
import type { ObjectDef, SceneDoc } from "./types";
import { defaultScene, validateScene } from "./validate";

const box = (id: string, body?: Record<string, unknown>): ObjectDef => ({ id, kind: "mesh", geometry: { type: "box" }, ...(body ? { body } : {}) }) as ObjectDef;
const scene = (objects: ObjectDef[], physics?: Record<string, unknown>): SceneDoc => ({
  ...defaultScene({ id: "t", title: "Physics", kind: "game" }),
  lights: [{ id: "sun", type: "directional", intensity: 2, position: [5, 8, 5] }],
  objects,
  ...(physics ? { physics } : {}),
});
const codes = (s: SceneDoc) => validateScene(s).map((i) => `${i.severity}:${i.code}:${i.path}`);

describe("physics validation", () => {
  it("accepts the full rigid-body vocabulary", () => {
    const s = scene(
      [
        box("ground", { type: "static", shape: "box", material: "ice" }),
        box("crate", { type: "dynamic", shape: "convex", mass: 2, angularVelocity: [0, 90, 0], linearDamping: 0.1, angularDamping: 0.2, gravityScale: 0.5, ccd: true, layer: "debris", collidesWith: ["default", "debris"], sleep: false }),
        box("hero", { type: "dynamic", shape: "capsule", radius: 0.3, height: 1.2, character: true, material: "rubber" }),
        box("table", { type: "dynamic", shape: "compound", shapes: [{ shape: "box", size: [2, 0.1, 1], offset: [0, 0.75, 0] }, { shape: "cylinder", radius: 0.05, height: 0.7, offset: [0.9, 0.35, 0.4], rotation: [0, 0, 0] }] }),
        box("door", { type: "dynamic" }),
        box("bob", { type: "dynamic", shape: "sphere" }),
        box("level", { type: "static", shape: "trimesh" }),
      ],
      {
        gravity: [0, -9.81, 0],
        substeps: 2,
        iterations: 12,
        sleep: true,
        debug: true,
        materials: { ice: { friction: 0.02 }, rubber: { friction: 0.9, restitution: 0.8 } },
        contacts: [{ a: "ice", b: "rubber", friction: 0.1 }],
        layers: ["debris"],
        joints: [
          { id: "hinge", type: "hinge", a: "door", pivot: [0, 1, 0], axis: [0, 1, 0], motor: { speed: 90, maxForce: 20 }, limits: [0, 110] },
          { type: "point", a: "bob", pivot: [0, 5, 0] },
          { type: "distance", a: "bob", b: "crate", distance: 2 },
          { type: "lock", a: "crate", b: "table" },
          { type: "spring", a: "crate", pivot: [0, 3, 0], restLength: 1, stiffness: 40, damping: 2 },
        ],
      },
    );
    expect(validateScene(s).filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("reports bad joints, materials, shapes and layers with actionable paths", () => {
    const s = scene(
      [box("a", { type: "dynamic", material: "lava", shape: "compound" }), box("wall", { type: "static", shape: "trimesh" }), box("deco"), box("ghost", { type: "dynamic", shape: "heightfield", collidesWith: ["nope"] })],
      {
        contacts: [{ a: "ice", b: "rubber" }],
        joints: [{ type: "hinge", a: "a", b: "deco", axis: [0, 0, 0] }, { type: "weld", a: "missing" }, { type: "point", a: "wall" }, { type: "distance", a: "a", b: "a", stiffness: 3 }],
      },
    );
    const c = codes(s);
    expect(c).toContain("error:unknown-ref:objects#a.body.material");
    expect(c).toContain("error:required:objects#a.body.shapes");
    expect(c).toContain("error:invalid:objects#ghost.body.shape");
    expect(c).toContain("warning:unknown-ref:objects#ghost.body.collidesWith[0]");
    expect(c).toContain("error:unknown-ref:physics.contacts[0].a");
    expect(c).toContain("error:invalid:physics.joints[0].b"); // deco has no body
    expect(c).toContain("error:range:physics.joints[0].axis");
    expect(c).toContain("error:enum:physics.joints[1].type");
    expect(c).toContain("error:unknown-ref:physics.joints[1].a");
    expect(c).toContain("warning:no-dynamic:physics.joints[2]");
    expect(c).toContain("error:invalid:physics.joints[3].b");
    expect(c).toContain("warning:ignored:physics.joints[3].stiffness");
  });

  it("checks hinge angle limits", () => {
    const s = scene([box("a", { type: "dynamic" })], {
      joints: [
        { type: "hinge", a: "a", limits: [90, 10] },
        { type: "hinge", a: "a", limits: [0] },
        { type: "hinge", a: "a", limits: [-400, 0] },
        { type: "point", a: "a", limits: [0, 45] },
      ],
    });
    const c = codes(s);
    expect(c).toContain("error:range:physics.joints[0].limits");
    expect(c).toContain("error:type:physics.joints[1].limits");
    expect(c).toContain("error:range:physics.joints[2].limits");
    expect(c).toContain("warning:ignored:physics.joints[3].limits");
  });

  it("warns when a body size is written in world axes on a rotated plane (it becomes a wall)", () => {
    const floor = { id: "floor", kind: "mesh", geometry: { type: "plane", width: 10, height: 10 }, rotation: [-90, 0, 0], body: { type: "static", size: [10, 0.2, 10] } } as unknown as ObjectDef;
    const ok = { id: "ok", kind: "mesh", geometry: { type: "plane", width: 10, height: 10 }, rotation: [-90, 0, 0], body: { type: "static", size: [10, 10, 0.2] } } as unknown as ObjectDef;
    const crate = { id: "crate", kind: "mesh", geometry: { type: "box", width: 4, height: 0.2, depth: 4 }, body: { type: "static", size: [0.2, 4, 4] } } as unknown as ObjectDef;
    const issues = validateScene(scene([floor, ok, crate])).filter((i) => i.code === "body-frame");
    expect(issues.map((i) => i.path)).toEqual(["objects#floor.body.size", "objects#crate.body.size"]);
    expect(issues[0].message).toContain("wall");
    expect(issues[0].hint).toContain("[10,10,0.2]");
  });

  it("keeps v0.1 bodies valid", () => {
    const s = scene([box("floor", { type: "static" }), box("p", { type: "dynamic", shape: "sphere", radius: 0.5, restitution: 0.2, friction: 0.1, velocity: [1, 0, 0], fixedRotation: true }), box("c", { type: "trigger", size: [1, 1, 1] })], { gravity: [0, -20, 0], step: 1 / 60 });
    expect(validateScene(s)).toEqual([]);
  });
});

describe("HUD visible expressions", () => {
  it("suggests quoting a bare word compared with a state value", () => {
    const s = { ...scene([]), ui: { elements: [
      { id: "a", type: "text", text: "Press start", visible: "phase == attract" },
      { id: "b", type: "text", text: "ok", visible: "phase == 'attract' && lives > 0" },
      { id: "c", type: "text", text: "ok", visible: "best == state.score" },
    ] } } as unknown as SceneDoc;
    const issues = validateScene(s).filter((i) => i.code === "expr-bare-word");
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("ui.elements#a.visible");
    expect(issues[0].hint).toContain(`"phase == 'attract'"`);
  });
});
