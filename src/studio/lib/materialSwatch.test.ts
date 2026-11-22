import { describe, expect, it } from "vitest";
import { MATERIAL_PRESETS } from "../../core/catalog";
import { validateScene } from "../../core/validate";
import { presetSheetScene, presetSwatch } from "./materialSwatch";

describe("material preset previews", () => {
  it("has a CSS swatch for every preset", () => {
    for (const p of MATERIAL_PRESETS) {
      const bg = presetSwatch(p);
      expect(bg, p.id).toMatch(/gradient/);
      expect(bg, p.id).not.toMatch(/undefined|NaN/);
    }
  });
  it("lays every preset out on a valid render sheet", () => {
    const { scene, width, height, cells } = presetSheetScene();
    expect(Object.keys(cells)).toHaveLength(MATERIAL_PRESETS.length);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(validateScene(scene).filter((i) => i.severity === "error")).toEqual([]);
  });
});
