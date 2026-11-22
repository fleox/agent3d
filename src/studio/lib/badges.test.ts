import { describe, expect, it } from "vitest";
import { badgeCorners } from "./badges";

describe("viewport badges avoid the HUD", () => {
  it("keeps the defaults without a HUD", () => {
    expect(badgeCorners(undefined)).toEqual({ camera: "tr", selection: "tl" });
  });
  it("moves away from HUD corners (score top-left, lives top-right)", () => {
    expect(badgeCorners({ elements: [{ id: "score", type: "text", anchor: "top-left" }, { id: "lives", type: "text", anchor: "top-right" }] })).toEqual({ camera: "br", selection: "bl" });
    expect(badgeCorners({ elements: [{ id: "title", type: "text", anchor: "top" }, { id: "go", type: "button", anchor: "bottom-right" }] })).toEqual({ camera: "bl", selection: "tl" });
  });
});
