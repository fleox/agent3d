// @vitest-environment happy-dom
// HUD theming (buttonText auto-contrast, per-element colours, panel) and
// timeline.* in expressions.
import { describe, expect, it } from "vitest";
import { createHud } from "./hud";
import { contrastRatio, parseColor, readableTextOn } from "../../core/color";
import { timelineInfo } from "../timeline/controller";

describe("HUD theme", () => {
  it("button text contrasts with the accent (WCAG ≥ 4.5) unless buttonText is set", () => {
    for (const accent of ["#ffd400", "#ff006e", "#e6ff00", "#1d4ed8", "#22c55e", "#ffffff", "#000000"]) {
      const text = readableTextOn(accent);
      expect(contrastRatio(parseColor(accent)!, parseColor(text)!)).toBeGreaterThanOrEqual(4.5);
    }
    const container = document.createElement("div");
    createHud(container, { accent: "#e6ff00", elements: [{ id: "b", type: "button", text: "Go", action: "go" }] }, () => undefined);
    expect(container.querySelector("style")!.textContent).toContain("color:#111318;background:#e6ff00");
    const c2 = document.createElement("div");
    createHud(c2, { accent: "#e6ff00", buttonText: "#ff00ff", elements: [{ id: "b", type: "button", text: "Go", action: "go" }] }, () => undefined);
    expect(c2.querySelector("style")!.textContent).toContain("color:#ff00ff;background:#e6ff00");
  });

  it("per-element color / background and the panel style", () => {
    const container = document.createElement("div");
    createHud(
      container,
      {
        elements: [
          { id: "p", type: "text", style: "pill", text: "x", color: "#111111", background: "#ffd400" },
          { id: "b", type: "button", text: "Go", action: "go", background: "#ffffff" },
          { id: "over", type: "text", style: "panel", text: "Game over\nScore 3" },
        ],
      },
      () => undefined,
    );
    const q = (id: string) => container.querySelector(`[data-id="${id}"]`) as HTMLElement;
    expect(q("p").getAttribute("style")).toMatch(/background/);
    expect(q("p").getAttribute("style")).toMatch(/color/);
    expect(q("b").getAttribute("style")).toMatch(/color: (#111318|rgb\(17, 19, 24\))/);
    expect(q("over").className).toContain("a3d-panel");
    expect(container.querySelector("style")!.textContent).toContain(".a3d-panel{");
  });

  it("timeline.segment / .progress / .marker drive visibility and text without a script", () => {
    const container = document.createElement("div");
    const hud = createHud(
      container,
      {
        elements: [
          { id: "c1", type: "text", text: "Design", visible: "timeline.segment == 'design'" },
          { id: "c2", type: "text", text: "Build", visible: "timeline.segment == 'build'" },
          { id: "m", type: "text", text: "{timeline.marker}" },
          { id: "cta", type: "button", text: "Go", action: "go", visible: "timeline.progress >= 0.9" },
        ],
      },
      () => undefined,
    );
    const def = { duration: 10, tracks: [], segments: { design: [0, 4] as [number, number], build: { from: "b", to: 10 } }, markers: { a: 1, b: 4 } };
    const q = (id: string) => container.querySelector(`[data-id="${id}"]`) as HTMLElement;
    hud.setTimeline(timelineInfo(def, 2));
    hud.update({}, 0);
    expect(q("c1").style.display).toBe("");
    expect(q("c2").style.display).toBe("none");
    expect(q("m").textContent).toBe("a");
    expect(q("cta").style.display).toBe("none");
    hud.setTimeline(timelineInfo(def, 9.5));
    hud.update({}, 0.1);
    expect(q("c1").style.display).toBe("none");
    expect(q("c2").style.display).toBe("");
    expect(q("m").textContent).toBe("b");
    expect(q("cta").style.display).toBe("");
    // A script's own `timeline` key wins.
    hud.update({ timeline: { segment: "design" } }, 0.2);
    expect(q("c1").style.display).toBe("");
  });

  it("timelineInfo: playing segment first, end of the timeline included, no marker before the first", () => {
    const def = { duration: 10, tracks: [], segments: { intro: [0, 5] as [number, number], outro: [5, 10] as [number, number] }, markers: { mid: 5 } };
    expect(timelineInfo(def, 0)).toEqual({ time: 0, duration: 10, progress: 0, segment: "intro", marker: "" });
    expect(timelineInfo(def, 10).segment).toBe("outro");
    expect(timelineInfo(def, 2, "outro").segment).toBe("outro");
    expect(timelineInfo(def, 2, "seek").segment).toBe("intro");
    expect(timelineInfo(def, 5).marker).toBe("mid");
  });
});
