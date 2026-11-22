import { describe, expect, it } from "vitest";
import { defaultScene, validateScene } from "./validate";
import { isAllowedUrl } from "./validateMotion";
import type { SceneDoc } from "./types";

function scene(over: Partial<SceneDoc> = {}): SceneDoc {
  const s = defaultScene({ id: "t", title: "T", kind: "banner" });
  s.lights = [{ id: "key", type: "directional", position: [1, 2, 3] }];
  s.objects = [
    { id: "a", kind: "mesh", geometry: { type: "box" }, tags: ["shape"] },
    { id: "b", kind: "mesh", geometry: { type: "sphere" }, tags: ["shape"] },
    { id: "g", kind: "group", children: [{ id: "c", kind: "mesh", geometry: { type: "box" } }] },
    { id: "bot", kind: "model", src: "library:models/characters/robot.glb", morph: { Surprised: 0.2 }, animation: { clip: "Idle", offset: 0.5, blend: { Wave: 0.3 } } },
  ];
  return { ...s, ...over } as SceneDoc;
}
const errors = (s: SceneDoc) => validateScene(s).filter((i) => i.severity === "error");
const codes = (s: SceneDoc) => validateScene(s).map((i) => `${i.severity}:${i.code}:${i.path}`);

describe("motion validation", () => {
  it("warns about letter targets past the end of a split text, with the letter count", () => {
    const s = scene({
      objects: [{ id: "title", kind: "text", text: "Hello World", splitLetters: true }, { id: "tag", kind: "text", text: "{data.title}", splitLetters: true }],
      timeline: { duration: 2, tracks: [{ target: "title/40.position.y", keys: [[0, 0], [1, 1]] }, { target: "title/9.position.y", keys: [[0, 0], [1, 1]] }, { target: "tag/40.position.y", keys: [[0, 0], [1, 1]] }] },
    });
    const issues = validateScene(s).filter((i) => i.code === "track-target");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].path).toBe("timeline.tracks[0].target");
    expect(issues[0].message).toContain("has 10 letters");
  });
  it("post effect tracks may animate effects brought by a look preset", () => {
    const ok = scene({ postfx: [{ type: "look", preset: "product" }], timeline: { duration: 2, tracks: [{ target: "postfx.bloom.strength", keys: [[0, 0], [2, 1]] }, { target: "postfx.vignette.darkness", keys: [[0, 0], [2, 1]] }] } });
    expect(errors(ok)).toEqual([]);
    const bad = scene({ postfx: [{ type: "look", preset: "product" }], timeline: { duration: 2, tracks: [{ target: "postfx.dof.focus", keys: [[0, 1], [2, 5]] }] } });
    expect(errors(bad).map((i) => i.message).join()).toContain("nor brought by a look preset");
  });
  it("accepts the full motion vocabulary", () => {
    const s = scene({
      postfx: [{ type: "bloom" }, { type: "dof" }],
      timeline: {
        duration: 4,
        trigger: "manual",
        speed: 1.5,
        autoplay: "intro",
        markers: { mid: 2 },
        segments: { intro: { from: 0, to: "mid" }, out: [2, 4] },
        tracks: [
          { target: "tag:shape.position.y", keys: [[0, "-=1"], [1, "+=0", "cubicBezier(0.22, 1, 0.36, 1)"]], stagger: 0.1, staggerFrom: "center" },
          { target: "a,b.scale", keys: [[0, "*=0"], [1, 1, "spring(170, 12)"]] },
          { target: "children:g.rotation", keys: [[0, ["+=0", "+=90", 0]], [2, [0, 0, 0]]], ease: "steps(4)" },
          { target: "camera.focus", keys: [[0, 5], [2, 8]] },
          { target: "environment.fog.color", keys: [[0, "#000"], [2, "#fff"]] },
          { target: "postfx.bloom.strength", keys: [[0, 0], [2, 1]] },
          { target: "bot.morph.Surprised", keys: [[0, 0], [1, 1]] },
          { target: "bot.animation.Wave.weight", keys: [[0, 0], [1, 1]] },
          { target: "key.penumbra", keys: [[0, 0], [1, 1]] },
        ],
      },
      interactions: [
        { on: "click", target: "a", do: [{ openUrl: "https://shop.example/p" }, { emit: "buy" }, { playClip: "Wave", target: "bot" }] },
        { on: "hover", target: "b", do: [{ play: "intro" }, { set: { path: "b.material.color", value: "#ff0000" }, duration: 0.3, ease: "outBack" }] },
        { on: "hoverEnd", target: "b", do: [{ play: "intro", reverse: true }] },
        { on: "key", key: "Space", do: [{ toggle: "out" }] },
        { on: "scroll", at: 0.5, once: true, do: [{ seek: "mid" }] },
        { on: "event", event: "mid", do: [{ play: "timeline" }] },
      ],
    });
    s.camera.shots = [
      { type: "pushIn", at: 0, duration: 2 },
      { type: "path", at: 2, duration: 2, points: [[1, 1, 1]], lookAt: "a" },
      { type: "focus", at: 3, duration: 1, object: "b" },
    ];
    s.camera.shake = { amount: 0.02 };
    s.camera.lookAt = "a";
    expect(errors(s)).toEqual([]);
    expect(validateScene(s).filter((i) => i.severity === "warning")).toEqual([]);
  });

  it("rejects bad easing, selectors, refs and relative values with hints", () => {
    const s = scene({
      timeline: {
        duration: 2,
        markers: { m: 1 },
        segments: { s1: { from: "nope", to: 1 } },
        autoplay: "missing",
        tracks: [
          { target: "a.position.x", keys: [[0, 0], [1, 1]], ease: "cubicBezier(2, 0, 1, 1)" as never },
          { target: "tag:ghost.scale", keys: [[0, 1]] },
          { target: "a.morph.x", keys: [[0, 1]] },
          { target: "a.position.y", keys: [[0, "+=x" as never]] },
          { target: "postfx.bloom.strength", keys: [[0, 1]] },
        ],
      },
    });
    const c = codes(s);
    expect(c).toContain("error:enum:timeline.tracks[0].ease");
    expect(c).toContain("error:track-target:timeline.tracks[1].target");
    expect(c).toContain("error:track-target:timeline.tracks[2].target");
    expect(c).toContain("error:track-value:timeline.tracks[3].keys[0][1]");
    expect(c).toContain("error:track-target:timeline.tracks[4].target"); // bloom not in postfx
    expect(c).toContain("error:unknown-ref:timeline.segments.s1.from");
    expect(c).toContain("error:unknown-ref:timeline.autoplay");
  });

  it("guards openUrl: http(s) only, user gestures only", () => {
    const s = scene({
      interactions: [
        { on: "hover", target: "a", do: [{ openUrl: "https://x.example" }] },
        { on: "click", do: [{ openUrl: "javascript:alert(1)" }] },
        { on: "click", target: "zzz", do: [{ play: "nope" }] },
      ],
    });
    const c = codes(s);
    expect(c).toContain("error:gesture:interactions[0].do[0].openUrl");
    expect(c).toContain("error:url:interactions[1].do[0].openUrl");
    expect(c).toContain("error:unknown-ref:interactions[2].target");
    expect(c).toContain("error:unknown-ref:interactions[2].do[0].play");
    expect(isAllowedUrl("https://a.b/c")).toBe(true);
    expect(isAllowedUrl("/shop")).toBe(true);
    expect(isAllowedUrl("//evil.example")).toBe(false);
    expect(isAllowedUrl("mailto:x@y.z")).toBe(false);
  });

  it("checks camera shots", () => {
    const s = scene();
    s.camera.shots = [{ type: "zoom", at: 0, duration: 1 } as never, { type: "wiggle" as never, at: 0, duration: 1 }, { type: "path", at: 0, duration: 1 }];
    const c = codes(s);
    expect(c).toContain("error:required:camera.shots[0].fov");
    expect(c).toContain("error:enum:camera.shots[1].type");
    expect(c).toContain("error:required:camera.shots[2].points");
  });
});
