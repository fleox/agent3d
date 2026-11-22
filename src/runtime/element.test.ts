// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { SceneDoc } from "../core/types";
import { defaultScene } from "../core/validate";
import { Agent3DSceneElement, defineElement, parseAspectRatio, prepareScene } from "./element";

defineElement("agent3d-scene-test");

describe("<agent3d-scene> aria-label", () => {
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

describe("prepareScene", () => {
  const base = (): SceneDoc =>
    ({
      ...defaultScene({ id: "t", title: "T" }),
      data: { title: "From scene" },
      timeline: { duration: 2, loop: true, tracks: [] },
      postfx: [{ type: "bloom" }],
      objects: [{ id: "a", kind: "text", text: "{data.title}" }],
    }) as SceneDoc;
  it("binds data attributes over scene.data", () => {
    const s = prepareScene(base(), { data: { title: "Summer sale" } });
    expect((s.objects[0] as { text: string }).text).toBe("Summer sale");
    expect(s.data).toEqual({ title: "Summer sale" });
    expect((prepareScene(base(), {}).objects[0] as { text: string }).text).toBe("From scene");
  });
  it("overrides loop and quality", () => {
    expect(prepareScene(base(), { loop: "false" }).timeline!.loop).toBe(false);
    expect(prepareScene(base(), { loop: "pingpong" }).timeline!.loop).toBe("pingpong");
    const low = prepareScene(base(), { quality: "low" });
    expect(low.target.maxDpr).toBe(1);
    expect(low.target.antialias).toBe(false);
    expect(low.postfx).toBeUndefined();
    expect(prepareScene(base(), { quality: "medium" }).target.maxDpr).toBe(1.5);
    expect(prepareScene(base(), { quality: "high" }).postfx).toHaveLength(1);
  });
  it("parses aspect ratios", () => {
    expect(parseAspectRatio("4:1")).toBe("4 / 1");
    expect(parseAspectRatio("16/9")).toBe("16 / 9");
    expect(parseAspectRatio("nope")).toBeNull();
  });
});

describe("<agent3d-scene> lifecycle without WebGL", () => {
  const base = defaultScene({ id: "s", title: "No GL" });
  const scene = { ...base, target: { ...base.target, lazy: false }, objects: [] } as SceneDoc;
  const mount = (attrs: Record<string, string>) => {
    const el = document.createElement("agent3d-scene-test") as Agent3DSceneElement;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = JSON.stringify(scene);
    el.appendChild(script);
    return el;
  };
  it("reserves the aspect ratio, shows the poster and reports webgl-unavailable", async () => {
    const el = mount({ poster: "poster.webp", aspect: "4:1" });
    const errors: string[] = [];
    el.addEventListener("agent3d:error", (e) => errors.push((e as CustomEvent).detail.code));
    document.body.appendChild(el);
    const root = el.shadowRoot!;
    expect(root).toBeTruthy();
    expect((el as unknown as { sizeCssText: string }).sizeCssText).toContain("aspect-ratio:4 / 1");
    await new Promise((r) => setTimeout(r, 30));
    expect(el.getAttribute("status")).toBe("unsupported");
    expect(errors).toContain("webgl-unavailable");
    const poster = root.querySelector("img[part=poster-image]") as HTMLImageElement;
    expect(poster.getAttribute("src")).toBe("poster.webp");
    expect(poster.alt).toBe("No GL");
    expect(root.querySelector('[part="loading"]')).toBeTruthy();
    el.remove();
    expect(el.player).toBeNull();
    expect(el.querySelector("canvas")).toBeNull();
  });
  it("exposes data from scene, data-* attributes and setData", async () => {
    const el = mount({ "data-title": "Attr", "data-cta-label": "Go" });
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));
    expect(el.data).toMatchObject({ title: "Attr", ctaLabel: "Go" });
    await el.setData({ title: "JS" });
    expect(el.data.title).toBe("JS");
    el.remove();
  });
});
