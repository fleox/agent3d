import { describe, expect, it } from "vitest";
import { applyPatchOps } from "../../ops/scene";
import { defaultScene, validateScene } from "../../core/validate";
import type { SceneDoc } from "../../core/types";
import { addMarkerOps, addSegmentOps, removeMarkerOps, removeSegmentOps, renameMarkerOps, renameSegmentOps, setMarkerOps } from "./timelineEdit";

function base(): SceneDoc {
  const s = defaultScene();
  s.objects = [{ id: "card", kind: "mesh", geometry: { type: "box" } }];
  s.timeline = { duration: 4, tracks: [], markers: { open: 1 }, segments: { intro: { from: 0, to: "open" }, out: ["open", 3] }, autoplay: "intro" };
  s.interactions = [
    { on: "click", target: "card", do: [{ play: "intro" }, { seek: "open" }] },
    { on: "event", event: "open", do: [{ toggle: "out" }] },
  ];
  return s;
}
const errors = (s: SceneDoc) => validateScene(s).filter((i) => i.severity === "error");

describe("markers & segments edits", () => {
  it("renames a marker everywhere it is referenced", () => {
    const s = applyPatchOps(base(), renameMarkerOps(base(), "open", "opened"));
    expect(s.timeline!.markers).toEqual({ opened: 1 });
    expect(s.timeline!.segments).toEqual({ intro: { from: 0, to: "opened" }, out: ["opened", 3] });
    expect(s.interactions![0].do[1]).toEqual({ seek: "opened" });
    expect(s.interactions![1].event).toBe("opened");
    expect(errors(s)).toEqual([]);
    expect(renameMarkerOps(base(), "open", "bad name")).toEqual([]);
  });
  it("removes a marker keeping its time in references", () => {
    const s = applyPatchOps(base(), removeMarkerOps(base(), "open"));
    expect(s.timeline!.markers).toBeUndefined();
    expect(s.timeline!.segments).toEqual({ intro: { from: 0, to: 1 }, out: [1, 3] });
    expect(s.interactions![0].do[1]).toEqual({ seek: 1 });
  });
  it("adds / moves markers and segments, renames / removes segments", () => {
    let s = base();
    const m = addMarkerOps(s, 2.5);
    s = applyPatchOps(s, m.ops);
    expect(s.timeline!.markers![m.name]).toBe(2.5);
    s = applyPatchOps(s, setMarkerOps(s, m.name, 99));
    expect(s.timeline!.markers![m.name]).toBe(4);
    const g = addSegmentOps(s, 3.8);
    s = applyPatchOps(s, g.ops);
    expect(s.timeline!.segments![g.name]).toEqual({ from: 3.5, to: 4 });
    s = applyPatchOps(s, renameSegmentOps(s, "intro", "hello"));
    expect(s.timeline!.autoplay).toBe("hello");
    expect(s.interactions![0].do[0]).toEqual({ play: "hello" });
    expect(errors(s)).toEqual([]);
    s = applyPatchOps(s, removeSegmentOps(s, "hello"));
    expect(s.timeline!.autoplay).toBeUndefined();
  });
});
