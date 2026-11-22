// attach: "camera", HUD theming fields, new generator params (terrain shapes,
// road restyling, birds).
import { describe, expect, it } from "vitest";
import type { SceneDoc } from "./types";
import { defaultScene, validateScene } from "./validate";

const scene = (extra: Partial<SceneDoc>): SceneDoc => ({ ...defaultScene({ id: "t", title: "Test" }), ...extra });
const codes = (s: unknown) => validateScene(s).map((i) => `${i.severity}:${i.code}:${i.path}`);

describe("attach: camera", () => {
  const label = { id: "chapter", kind: "text" as const, text: "01", attach: "camera" as const, position: [0, -1, -6] as [number, number, number] };
  it("is valid on a top-level object in front of the lens", () => {
    expect(codes(scene({ objects: [label] }))).toEqual([]);
  });
  it("warns behind / inside the lens or without a position", () => {
    expect(codes(scene({ objects: [{ ...label, position: [0, 0, 2] }] }))).toContain("warning:framing:objects#chapter.position");
    const { position: _p, ...noPos } = label;
    expect(codes(scene({ objects: [noPos] }))).toContain("warning:framing:objects#chapter.position");
  });
  it("rejects nested objects and unknown targets", () => {
    expect(codes(scene({ objects: [{ id: "g", kind: "group", children: [label] }] }))).toContain("error:invalid:objects#chapter.attach");
    expect(codes(scene({ objects: [{ ...label, attach: "pointer" as never }] })).some((c) => c.startsWith("error:enum:objects#chapter.attach"))).toBe(true);
  });
});

describe("HUD theme fields", () => {
  it("accepts buttonText, per-element color / background and the panel style", () => {
    const s = scene({
      ui: {
        accent: "#e6ff00",
        buttonText: "#111111",
        elements: [
          { id: "over", type: "text", style: "panel", text: "Game over", color: "#ffffff", background: "rgba(0,0,0,.7)", visible: "timeline.marker == 'end'" },
          { id: "go", type: "button", text: "Go", action: "go", background: "#ffffff" },
        ],
      },
    });
    expect(codes(s)).toEqual([]);
    const bad = scene({ ui: { buttonText: "nope", elements: [{ id: "x", type: "text", text: "x", color: 3 as never, style: "card" as never }] } });
    const c = codes(bad);
    expect(c.some((x) => x.includes("ui.buttonText"))).toBe(true);
    expect(c.some((x) => x.includes("ui.elements#x.color"))).toBe(true);
    expect(c.some((x) => x.includes("ui.elements#x.style"))).toBe(true);
  });
});

describe("new generator params", () => {
  it("terrain basin / valley, edgeFalloff, snowHeight, waterPlane; road restyle; birds", () => {
    const s = scene({
      objects: [
        { id: "t", kind: "generator", generator: "terrain", params: { shape: "basin", edgeFalloff: 0.2, snowHeight: 12, waterLevel: 2, waterPlane: false } },
        { id: "v", kind: "generator", generator: "terrain", params: { shape: "valley" } },
        { id: "r", kind: "generator", generator: "road", params: { verge: false, curbColors: ["#e6ff00"], vergeColor: ["#111111", "#222222"] } },
        { id: "b", kind: "generator", generator: "birds", params: { count: 9, mode: "path", points: [[0, 5, 0], [10, 6, -5]], formation: "v", flapSpeed: 3, color: "#222222" } },
      ],
    });
    expect(codes(s)).toEqual([]);
    expect(codes(scene({ objects: [{ id: "t", kind: "generator", generator: "terrain", params: { edgeFalloff: 2 } }] })).some((c) => c.includes("edgeFalloff"))).toBe(true);
  });
});
