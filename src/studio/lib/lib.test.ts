import { describe, expect, it } from "vitest";
import { BEHAVIOURS, GENERATORS, GEOMETRIES, type ParamSpec } from "../../core/catalog";
import type { SceneDoc } from "../../core/types";
import { defaultScene, validateScene } from "../../core/validate";
import { applyPatchOps } from "../../ops/scene";
import { coerceParam, formatNumber, paramDefault, paramUpdate } from "./params";
import { duplicateObject, fieldOps, moveOps, newObject } from "./patches";
import { currentValue, moveKey, rulerStep, snapTime, upsertKey } from "./tracks";

const spec = (p: Partial<ParamSpec>): ParamSpec => ({ name: "x", description: "", type: "number", ...p });

describe("ParamSpec coercion", () => {
  it("numbers: parse, clamp, round integers", () => {
    expect(coerceParam(spec({ min: 0, max: 1 }), "1.7")).toEqual({ ok: true, value: 1 });
    expect(coerceParam(spec({}), "0,5")).toEqual({ ok: true, value: 0.5 });
    expect(coerceParam(spec({ type: "integer" }), 2.6)).toEqual({ ok: true, value: 3 });
    expect(coerceParam(spec({}), "abc").ok).toBe(false);
  });
  it("vectors, colours, enums, json", () => {
    expect(coerceParam(spec({ type: "vec3" }), "1, 2 3")).toEqual({ ok: true, value: [1, 2, 3] });
    expect(coerceParam(spec({ type: "vec3" }), [1, 2]).ok).toBe(false);
    expect(coerceParam(spec({ type: "color" }), "#ff0000")).toEqual({ ok: true, value: "#ff0000" });
    expect(coerceParam(spec({ type: "color" }), "nope").ok).toBe(false);
    expect(coerceParam(spec({ type: "colors" }), "#fff, red")).toEqual({ ok: true, value: ["#fff", "red"] });
    expect(coerceParam(spec({ type: "enum", options: ["a", "b"] }), "b")).toEqual({ ok: true, value: "b" });
    expect(coerceParam(spec({ type: "enum", options: ["a"] }), "z").ok).toBe(false);
    expect(coerceParam(spec({ type: "array" }), "[[0,1]]")).toEqual({ ok: true, value: [[0, 1]] });
    expect(coerceParam(spec({ type: "boolean" }), "true")).toEqual({ ok: true, value: true });
  });
  it("drops values equal to the catalog default", () => {
    expect(paramUpdate(spec({ default: 1 }), "1")).toMatchObject({ ok: true, drop: true });
    expect(paramUpdate(spec({ default: 1 }), "2")).toEqual({ ok: true, value: 2 });
  });
  it("has a default for every catalog param", () => {
    for (const e of [...GEOMETRIES, ...BEHAVIOURS, ...GENERATORS]) for (const p of e.params) expect(paramDefault(p)).not.toBeUndefined();
  });
  it("formats numbers without float noise", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(-0)).toBe("0");
  });
});

function scene(): SceneDoc {
  return { ...defaultScene(), objects: [{ id: "a", kind: "group", children: [{ id: "b", kind: "mesh", geometry: { type: "box" } }] }, { id: "c", kind: "mesh", geometry: { type: "sphere" } }] };
}

describe("patch generation", () => {
  it("fieldOps: set, no-op and remove", () => {
    const s = scene();
    expect(fieldOps(s, "objects#c.geometry.radius", 2)).toEqual([{ op: "set", path: "objects#c.geometry.radius", value: 2 }]);
    expect(fieldOps(s, "objects#c.geometry.type", "sphere")).toEqual([]);
    expect(fieldOps(s, "objects#c.geometry.radius", undefined)).toEqual([]);
    expect(fieldOps(s, "objects#c.geometry.type", undefined)).toEqual([{ op: "remove", path: "objects#c.geometry.type" }]);
  });
  it("new objects from every catalog entry validate", () => {
    let s = scene();
    for (const g of GEOMETRIES) s = applyPatchOps(s, [{ op: "addObject", object: newObject(s, { kind: "mesh", geometry: g.id }) }]);
    for (const g of GENERATORS) s = applyPatchOps(s, [{ op: "addObject", object: newObject(s, { kind: "generator", generator: g.id }) }]);
    s = applyPatchOps(s, [{ op: "addObject", object: newObject(s, { kind: "text" }) }, { op: "addObject", object: newObject(s, { kind: "particles", preset: "snow" }) }]);
    expect(validateScene(s).filter((i) => i.severity === "error")).toEqual([]);
  });
  it("duplicates a subtree with fresh ids", () => {
    const s = scene();
    const d = duplicateObject(s, "a")!;
    const next = applyPatchOps(s, d.ops);
    expect(next.objects.map((o) => o.id)).toEqual(["a", d.newId, "c"]);
    expect(next.objects[1].children![0].id).not.toBe("b");
    expect(validateScene(next).filter((i) => i.severity === "error")).toEqual([]);
  });
  it("moveOps: reorder, reparent, refuse cycles", () => {
    const s = scene();
    expect(applyPatchOps(s, moveOps(s, "c", "a", "before")).objects.map((o) => o.id)).toEqual(["c", "a"]);
    expect(applyPatchOps(s, moveOps(s, "a", "c", "after")).objects.map((o) => o.id)).toEqual(["c", "a"]);
    expect(applyPatchOps(s, moveOps(s, "c", "a", "inside")).objects[0].children!.map((o) => o.id)).toEqual(["b", "c"]);
    expect(applyPatchOps(s, moveOps(s, "b", "c", "after")).objects.map((o) => o.id)).toEqual(["a", "c", "b"]);
    expect(moveOps(s, "a", "b", "inside")).toEqual([]);
    expect(moveOps(s, "a", "c", "before")).toEqual([]);
  });
});

describe("timeline helpers", () => {
  it("reads current values", () => {
    const s = scene();
    s.objects[1].position = [1, 2, 3];
    expect(currentValue(s, "c.position")).toEqual([1, 2, 3]);
    expect(currentValue(s, "c.position.y")).toBe(2);
    expect(currentValue(s, "c.scale")).toBe(1);
    expect(currentValue(s, "camera.position")).toEqual(s.camera.position);
    expect(currentValue(s, "key.intensity")).toBe(2);
    expect(currentValue(s, "zz.position")).toBeUndefined();
  });
  it("upserts and moves keys keeping them sorted", () => {
    let tr = { target: "c.scale", keys: [[0, 1], [2, 1.5]] as [number, number][] };
    tr = upsertKey(tr, 1, 2) as typeof tr;
    expect(tr.keys.map((k) => k[0])).toEqual([0, 1, 2]);
    tr = upsertKey(tr, 1.0004, 3) as typeof tr;
    expect(tr.keys).toHaveLength(3);
    const m = moveKey(tr, 0, 2.5);
    expect(m.track.keys.map((k) => k[0])).toEqual([1, 2, 2.5]);
    expect(m.index).toBe(2);
    const eased = { target: "c.scale", keys: [[0, 1], [1, 2, "outBack"]] as [number, number, string?][] } as never as Parameters<typeof moveKey>[0];
    expect(moveKey(eased, 1, 1.5).track.keys[1]).toEqual([1.5, 2, "outBack"]);
    expect(upsertKey(eased, 1, 3).keys[1]).toEqual([1, 3, "outBack"]);
    expect(snapTime(1.234)).toBe(1.25);
    expect(rulerStep(4)).toBe(0.25);
  });
});

import { pretty } from "./labels";
describe("labels", () => {
  it("prettifies catalog / field names", () => {
    expect(pretty("reducedMotion")).toBe("Reduced motion");
    expect(pretty("budgetKb")).toBe("Budget KB");
    expect(pretty("torusKnot")).toBe("Torus knot");
    expect(pretty("sans-bold")).toBe("Sans bold");
  });
});

import { projectBox } from "./project";
describe("projectBox", () => {
  it("centres a box in front of the camera", () => {
    const r = projectBox([-1, -1, -1], [1, 1, 1], { type: "perspective", position: [0, 0, 10], target: [0, 0, 0], fov: 45 }, 1)!;
    expect(r.x + r.w / 2).toBeCloseTo(0.5);
    expect(r.y + r.h / 2).toBeCloseTo(0.5);
    expect(projectBox([-1, -1, 20], [1, 1, 22], { type: "perspective", position: [0, 0, 10], target: [0, 0, 0] }, 1)).toBeNull();
  });
});
