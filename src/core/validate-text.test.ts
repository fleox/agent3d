// Validation of text / svg typography fields (kerning, wrap, outline, letters, reveal, svg options).
import { describe, expect, it } from "vitest";
import type { SceneDoc } from "./types";
import { defaultScene, validateScene } from "./validate";

const scene = (objects: unknown[], tracks: unknown[] = []): SceneDoc => ({ ...defaultScene({ kind: "banner" }), objects, ...(tracks.length ? { timeline: { duration: 3, tracks } } : {}) }) as SceneDoc;
const errors = (s: SceneDoc) => validateScene(s).filter((i) => i.severity === "error");

describe("text typography fields", () => {
  it("accepts the full set", () => {
    const s = scene([{ id: "t", kind: "text", text: "Hi", font: "bebas-neue", kerning: false, maxWidth: 4, curveSegments: 10, outline: { width: 0.05, color: "#000000", depth: 0.1 }, reveal: { effect: "spin", stagger: 0.05, duration: 0.5, delay: 0.2, ease: "outBack", order: "center" } }]);
    expect(errors(s)).toEqual([]);
    expect(errors(scene([{ id: "t", kind: "text", text: "Hi", outline: true, font: "assets/fonts/brand.typeface.json" }]))).toEqual([]);
  });

  it("rejects bad values with paths", () => {
    const e = errors(scene([{ id: "t", kind: "text", text: "Hi", outline: { width: -1, glow: 1 }, reveal: { effect: "explode", ease: "wobbly" }, maxWidth: 0 }]));
    const paths = e.map((i) => i.path);
    expect(paths).toContain("objects#t.outline.width");
    expect(paths).toContain("objects#t.reveal.effect");
    expect(paths).toContain("objects#t.reveal.ease");
    expect(paths).toContain("objects#t.maxWidth");
    // Unknown fields are warnings (ignored by the runtime).
    expect(validateScene(scene([{ id: "t", kind: "text", text: "Hi", outline: { glow: 1 } }])).some((i) => i.path === "objects#t.outline.glow" && i.severity === "warning")).toBe(true);
  });

  it("letter track targets need a split text", () => {
    const track = { target: "t/2.position.y", keys: [[0, 0], [1, 1]] };
    expect(errors(scene([{ id: "t", kind: "text", text: "Hello", splitLetters: true }], [track]))).toEqual([]);
    expect(errors(scene([{ id: "t", kind: "text", text: "Hello", reveal: {} }], [track]))).toEqual([]);
    const e = errors(scene([{ id: "t", kind: "text", text: "Hello" }], [track]));
    expect(e[0]?.hint).toMatch(/splitLetters/);
    expect(errors(scene([{ id: "t", kind: "text", text: "Hello", splitLetters: true }], [{ target: "x/2.position.y", keys: [[0, 0]] }])).length).toBe(1);
  });
});

describe("svg fields", () => {
  it("validates fit / keepColors / strokes / curveSegments / layerGap", () => {
    const ok = scene([{ id: "l", kind: "svg", src: "<svg></svg>", fit: "height", keepColors: true, strokes: false, curveSegments: 16, layerGap: 0.01 }]);
    expect(errors(ok)).toEqual([]);
    const bad = errors(scene([{ id: "l", kind: "svg", src: "<svg></svg>", fit: "cover", keepColors: "yes", layerGap: -1 }])).map((i) => i.path);
    expect(bad).toEqual(expect.arrayContaining(["objects#l.fit", "objects#l.keepColors", "objects#l.layerGap"]));
  });
});
