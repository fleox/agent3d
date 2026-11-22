import { describe, expect, it } from "vitest";
import { defaultScene, validateScene } from "../../core/validate";
import type { SceneDoc } from "../../core/types";
import { INTERACTION_ACTIONS, INTERACTION_ON, actionKind, actionProblem, defaultAction, defaultInteraction, withTrigger } from "./interactions";

function scene(): SceneDoc {
  const s = defaultScene();
  s.objects = [{ id: "card", kind: "mesh", geometry: { type: "box" }, material: { color: "#fff" } }, { id: "fox", kind: "model", src: "library:models/animals/fox.glb" }];
  s.timeline = { duration: 2, tracks: [], markers: { mid: 1 }, segments: { pop: [0, "mid"] } };
  return s;
}

describe("interactions helpers", () => {
  it("builds a valid default for every trigger and action", () => {
    const s = scene();
    for (const on of INTERACTION_ON) {
      for (const kind of INTERACTION_ACTIONS) {
        const it = { ...defaultInteraction(s, on), do: [defaultAction(kind, s)] };
        if (kind === "openUrl" && on !== "click" && on !== "key") continue; // gesture-only
        const errs = validateScene({ ...s, interactions: [it] }).filter((i) => i.severity === "error" && i.path.startsWith("interactions"));
        expect(errs, `${on} / ${kind}`).toEqual([]);
        expect(actionKind(it.do[0])).toBe(kind);
      }
    }
  });
  it("switches triggers and checks URLs", () => {
    const s = scene();
    const it = defaultInteraction(s, "click");
    expect(withTrigger(it, "key", s)).toMatchObject({ on: "key", key: "Space" });
    expect(withTrigger(it, "key", s)).not.toHaveProperty("target");
    expect(withTrigger(it, "scroll", s).at).toBe(0.5);
    expect(actionProblem({ openUrl: "javascript:alert(1)" }, "click")).toBe("url");
    expect(actionProblem({ openUrl: "https://shop.example" }, "hover")).toBe("gesture");
    expect(actionProblem({ openUrl: "/shop" }, "click")).toBeNull();
  });
});
