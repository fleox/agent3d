import { describe, expect, it } from "vitest";
import type { SceneDoc } from "../core/types";
import { validateScene } from "../core/validate";
import { liteRuntimeEligibility } from "./liteRuntime";

const photoScene = (): SceneDoc =>
  ({
    version: 1,
    id: "lake",
    title: "Lake",
    target: { kind: "hero", aspect: "16:9" },
    camera: { type: "perspective", fov: 35, position: [0, 0, 3.5], target: [0, 0, 0] },
    environment: { background: "#0b1020" },
    lights: [{ type: "hemisphere", intensity: 1 }],
    objects: [{ id: "photo", kind: "photo", src: "assets/textures/lake.jpg", depth: "assets/depth/lake.png", mode: "parallax", strength: 0.8, motion: { auto: "orbit" } }],
  }) as SceneDoc;

const reasons = (patch: (s: SceneDoc) => void): string[] => {
  const s = photoScene();
  patch(s);
  const r = liteRuntimeEligibility(s);
  return r.ok ? [] : r.reasons;
};

describe("liteRuntimeEligibility", () => {
  it("accepts a single parallax / flat photo with a fixed perspective camera over a plain background", () => {
    expect(validateScene(photoScene()).filter((i) => i.severity === "error")).toEqual([]);
    expect(liteRuntimeEligibility(photoScene())).toEqual({ ok: true });
    expect(reasons((s) => delete (s.objects[0] as { depth?: string }).depth)).toEqual([]); // flat photo
    expect(reasons((s) => Object.assign(s.objects[0], { mode: "mesh", depth: undefined }))).toEqual([]); // no depth → flat whatever the mode
    expect(reasons((s) => (s.environment.background = "transparent"))).toEqual([]);
    expect(reasons((s) => Object.assign(s.target, { transparent: true, quality: "low", maxDpr: 1.5, reducedMotion: "slow", lazy: false }))).toEqual([]);
    expect(reasons((s) => Object.assign(s.objects[0], { position: [0.2, -0.1, 0.5], scale: 1.2, rotation: [0, 0, 0], material: { color: "#fff", opacity: 0.9 } }))).toEqual([]);
    expect(reasons((s) => Object.assign(s.environment, { lighting: "studio", fog: { density: 0.02 } }))).toEqual([]);
  });

  it("sends everything else to the full runtime, with the reasons", () => {
    expect(reasons((s) => Object.assign(s.objects[0], { mode: "mesh" }))).toEqual(['photo mode "mesh" (lite: parallax or a flat photo)']);
    expect(reasons((s) => s.objects.push({ id: "t", kind: "text", text: "Hi" }))).toEqual(["2 objects (the lite runtime shows exactly one photo)"]);
    expect(reasons((s) => (s.objects = [{ id: "b", kind: "mesh", geometry: { type: "box" } }]))).toEqual(['object "b" is a mesh, not a photo']);
    expect(reasons((s) => (s.objects = []))).toEqual(["0 objects (the lite runtime shows exactly one photo)"]);
    expect(reasons((s) => (s.camera.controls = "orbit"))).toEqual(['camera.controls "orbit"']);
    expect(reasons((s) => Object.assign(s.camera, { type: "orthographic" }))).toEqual(["camera is not perspective"]);
    expect(reasons((s) => Object.assign(s.camera, { autoRotate: 5, shots: [{ type: "pushIn", at: 0, duration: 2 }], shake: {} }))).toEqual(["camera.autoRotate", "camera.shots", "camera.shake"]);
    expect(reasons((s) => (s.environment.background = { gradient: ["#000", "#fff"] }))).toEqual(["environment.background is not a #hex colour or transparent"]);
    expect(reasons((s) => (s.environment.background = "rebeccapurple"))).toEqual(["environment.background is not a #hex colour or transparent"]);
    expect(reasons((s) => Object.assign(s.environment, { ground: {}, contactShadows: true, rig: "studio" }))).toEqual(["environment.ground", "environment.contactShadows", "environment.rig (light rig)"]);
    expect(reasons((s) => s.lights.push({ type: "rect" }, { type: "spot", volumetric: true }))).toEqual(["rect lights (visible panels)", "volumetric spot lights"]);
    expect(reasons((s) => Object.assign(s, { timeline: { duration: 2, tracks: [] }, interactions: [{ on: "click", do: [] }], postfx: [{ type: "bloom" }], scripts: ["scripts/a.js"], audio: {}, physics: {} }))).toEqual(["timeline", "interactions", "post effects (postfx)", "physics", "scripts", "audio"]);
    expect(reasons((s) => Object.assign(s, { ui: { elements: [{ id: "a", type: "text" }] } }))).toEqual(["ui (HUD)"]);
    expect(reasons((s) => (s.target.kind = "game"))).toEqual(["target.kind is game"]);
    expect(reasons((s) => (s.ariaLabel = "{data.title}"))).toEqual(["data bindings ({data.*} placeholders)"]);
    expect(reasons((s) => Object.assign(s.objects[0], { rotation: [0, 0, 5], behaviours: [{ type: "float" }], href: "/x", attach: "camera", visible: false }))).toEqual(["photo is hidden", "photo behaviours", "photo link (href)", "photo attached to the camera", "photo is rotated"]);
    expect(reasons((s) => Object.assign(s.objects[0], { children: [{ id: "c", kind: "group" }], scale: [1, 0, 1], material: { color: "red" } }))).toEqual(["photo has children", "photo scale is not positive", "photo material.color is not a #hex colour"]);
  });

  it("keeps photos with effects in the lite runtime (hex colours only)", () => {
    const fx = (effects: unknown) => reasons((s) => Object.assign(s.objects[0], { effects }));
    expect(fx({ fog: { color: "#dfe8f2" }, light: { follow: "pointer" }, reveal: { duration: 2 } })).toEqual([]);
    expect(fx({ fog: { color: "white" } })).toEqual(["photo effects.fog.color is not a #hex colour"]);
  });
});
