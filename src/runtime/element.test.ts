// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { defaultScene } from "../core/validate";
import { Agent3DSceneElement, defineElement } from "./element";

describe("<agent3d-scene> aria-label", () => {
  defineElement("agent3d-scene-test");
  const sizing = (el: Agent3DSceneElement, title: string) => (el as unknown as { applySizing(s: unknown): void }).applySizing({ ...defaultScene({ id: "t", title }), ariaLabel: undefined });

  it("sets the label from the scene and follows reloads", () => {
    const el = document.createElement("agent3d-scene-test") as Agent3DSceneElement;
    sizing(el, "First");
    expect(el.getAttribute("aria-label")).toBe("First");
    sizing(el, "Second");
    expect(el.getAttribute("aria-label")).toBe("Second");
  });
  it("never overrides an author-provided label", () => {
    const el = document.createElement("agent3d-scene-test") as Agent3DSceneElement;
    el.setAttribute("aria-label", "Our spring sale");
    sizing(el, "Scene title");
    expect(el.getAttribute("aria-label")).toBe("Our spring sale");
  });
});
