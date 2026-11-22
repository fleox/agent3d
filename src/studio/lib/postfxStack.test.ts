import { describe, expect, it } from "vitest";
import { validateScene, defaultScene } from "../../core/validate";
import { addEffect, lookOf, moveEffect, removeEffect, setLook } from "./postfxStack";

describe("post-effect stack edits", () => {
  it("puts the look first, keeps its intensity, clears it", () => {
    const list = [{ type: "bloom", strength: 1 }, { type: "look", preset: "neon", intensity: 0.5 }];
    expect(setLook(list, "cinematic")).toEqual([{ type: "look", preset: "cinematic", intensity: 0.5 }, { type: "bloom", strength: 1 }]);
    expect(setLook(list, null)).toEqual([{ type: "bloom", strength: 1 }]);
    expect(lookOf(list)).toEqual({ index: 1, preset: "neon", intensity: 0.5 });
    expect(lookOf([])).toBeNull();
  });
  it("reorders, adds, removes — and the result validates", () => {
    let list = addEffect(addEffect([], "bloom"), "vignette");
    list = moveEffect(list, 1, 0);
    expect(list.map((d) => d.type)).toEqual(["vignette", "bloom"]);
    expect(moveEffect(list, 0, 9).map((d) => d.type)).toEqual(["bloom", "vignette"]);
    expect(removeEffect(list, 0).map((d) => d.type)).toEqual(["bloom"]);
    const scene = { ...defaultScene(), postfx: setLook(list, "product") };
    expect(validateScene(scene).filter((i) => i.severity === "error")).toEqual([]);
  });
});
