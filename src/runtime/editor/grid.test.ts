import { describe, expect, it } from "vitest";
import { createEditorGrid, gridFadeRadius } from "./grid";

describe("editor grid", () => {
  it("fades closer for a close camera, clamped both ways", () => {
    expect(gridFadeRadius(2, 1)).toBe(12);
    expect(gridFadeRadius(10, 2)).toBe(30);
    expect(gridFadeRadius(1e5, 0)).toBe(600);
  });
  it("is an editor helper that is depth-tested but never writes depth", () => {
    const g = createEditorGrid();
    expect(g.mesh.userData).toMatchObject({ helper: true, editorHelper: true });
    const m = g.mesh.material as import("three").ShaderMaterial;
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
    g.dispose();
  });
});
