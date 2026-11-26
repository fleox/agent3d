// Validation of "photo" objects (3D photos: an image + a depth map).
import { describe, expect, it } from "vitest";
import type { SceneDoc } from "./types";
import { defaultScene, validateScene } from "./validate";

const scene = (objects: unknown[]): SceneDoc => ({ ...defaultScene({ kind: "hero" }), objects }) as SceneDoc;
const issues = (o: Record<string, unknown>) => validateScene(scene([{ id: "p", kind: "photo", ...o }]));
const errorPaths = (o: Record<string, unknown>) => issues(o).filter((i) => i.severity === "error").map((i) => i.path);

describe("photo objects", () => {
  it("accepts the full set without errors or warnings", () => {
    const full = {
      src: "assets/textures/street.jpg",
      depth: "assets/depth/street-depth.png",
      mode: "mesh",
      width: 6,
      height: 4,
      strength: 0.4,
      focus: 0.6,
      segments: 192,
      edgeCut: 0.1,
      motion: { pointer: 1, scroll: 0.3, gyro: false, auto: "orbit", speed: 0.5, smoothing: 0.2 },
      material: { opacity: 0.9, color: "#ffeedd", emissiveIntensity: 1 },
    };
    expect(issues(full).filter((i) => i.severity !== "info")).toEqual([]);
    expect(issues({ src: "library:photos/x.webp", depth: "library:photos/x-depth.png", mode: "layers", layers: 8 }).filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("validates occlude (boolean; ignored on a flat photo)", () => {
    expect(issues({ src: "assets/a.jpg", depth: "assets/d.png", occlude: true }).filter((i) => i.severity !== "info")).toEqual([]);
    expect(errorPaths({ src: "assets/a.jpg", depth: "assets/d.png", occlude: "yes" })).toContain("objects#p.occlude");
    const flat = issues({ src: "assets/a.jpg", occlude: true }).find((i) => i.path === "objects#p.occlude");
    expect(flat?.severity).toBe("info");
  });

  it("requires src and checks image extensions", () => {
    expect(errorPaths({ depth: "assets/d.png" })).toContain("objects#p.src");
    expect(issues({}).find((i) => i.code === "required")?.hint).toMatch(/\.jpg/);
    expect(errorPaths({ src: "assets/models/x.glb" })).toContain("objects#p.src");
    expect(errorPaths({ src: "assets/a.jpg", depth: "assets/d.exr" })).toContain("objects#p.depth");
    expect(errorPaths({ src: "assets/a.JPEG", depth: "assets/d.webp" })).toEqual([]);
  });

  it("rejects bad enums and ranges with did-you-mean", () => {
    const e = issues({ src: "assets/a.jpg", depth: "assets/d.png", mode: "meshh", strength: 2, focus: -0.1, segments: 4, layers: 17, edgeCut: 1.5, width: 0, motion: { auto: "spin", pointer: 3, gyro: "yes" } }).filter((i) => i.severity === "error");
    const paths = e.map((i) => i.path);
    for (const p of ["mode", "strength", "focus", "segments", "layers", "edgeCut", "width", "motion.auto", "motion.pointer", "motion.gyro"]) expect(paths).toContain(`objects#p.${p}`);
    expect(e.find((i) => i.path === "objects#p.mode")!.hint).toContain('"mesh"');
    expect(errorPaths({ src: "assets/a.jpg", depth: "assets/d.png", mode: "mesh", segments: 100.5 })).toContain("objects#p.segments");
    expect(errorPaths({ src: "assets/a.jpg", motion: "sway" })).toContain("objects#p.motion");
  });

  it("warns on unknown fields, unsupported material keys and a missing depth map", () => {
    const w = issues({ src: "assets/a.jpg", depth: "assets/d.png", strenght: 0.3, motion: { autos: "sway" }, material: { roughness: 0.5, opacty: 1 } }).filter((i) => i.severity === "warning");
    expect(w.map((i) => i.path)).toEqual(expect.arrayContaining(["objects#p.strenght", "objects#p.motion.autos", "objects#p.material.roughness", "objects#p.material.opacty"]));
    expect(w.find((i) => i.path === "objects#p.strenght")!.hint).toContain('"strength"');
    expect(w.find((i) => i.path === "objects#p.material.opacty")!.hint).toContain('"opacity"');
    const flat = issues({ src: "assets/a.jpg", mode: "layers" }).find((i) => i.code === "photo-flat");
    expect(flat).toMatchObject({ severity: "warning", path: "objects#p" });
    expect(flat!.hint).toContain("agent3d assets depth assets/a.jpg");
    // Mode-specific fields on another mode are only an info.
    expect(issues({ src: "assets/a.jpg", depth: "assets/d.png", segments: 64 }).find((i) => i.path === "objects#p.segments")?.severity).toBe("info");
  });

  it("does not ask for lights in a scene of photos only (photos are unlit)", () => {
    const base = { ...defaultScene({ id: "s" }), lights: [], environment: { background: "#000000" } } as SceneDoc;
    const photoOnly = { ...base, objects: [{ id: "g", kind: "group", children: [{ id: "p", kind: "photo", src: "assets/a.jpg", depth: "assets/d.png" }] }] } as unknown as SceneDoc;
    expect(validateScene(photoOnly).some((i) => i.code === "no-lights")).toBe(false);
    const withMesh = { ...base, objects: [{ id: "m", kind: "mesh", geometry: { type: "box" } }] } as unknown as SceneDoc;
    expect(validateScene(withMesh).some((i) => i.code === "no-lights")).toBe(true);
  });
});

describe("photo effects", () => {
  const ok = { src: "assets/a.jpg", depth: "assets/d.png" };
  it("accepts fog, light and reveal with every param", () => {
    const effects = {
      fog: { color: "#dfe8f2", amount: 0.5, start: 0.6, end: 0.1, drift: 0.4 },
      light: { color: "#ffe2b0", intensity: 1.2, ambient: 0.6, position: [-0.5, 0.3], height: 0.5, radius: 0.9, relief: 1.5, specular: 0.4, follow: "auto" },
      reveal: { progress: 0.4, from: "near", softness: 0.2, delay: 0.5 },
    };
    expect(issues({ ...ok, effects }).filter((i) => i.severity !== "info")).toEqual([]);
    expect(issues({ ...ok, effects: { fog: {}, light: {}, reveal: {} } })).toEqual([]);
  });

  it("reports unknown effects / params with did-you-mean, types and ranges", () => {
    const all = issues({ ...ok, effects: { fogg: {}, light: { intensty: 1, follow: "mouse", position: [2, 0], ambient: 1.5 }, reveal: { from: "middle", progress: "half" }, fog: 3 } });
    const at = (p: string) => all.find((i) => i.path === `objects#p.effects${p}`);
    expect(at(".fogg")).toMatchObject({ severity: "warning" });
    expect(at(".fogg")!.hint).toContain('"fog"');
    expect(at(".light.intensty")!.hint).toContain('"intensity"');
    for (const p of [".light.follow", ".light.position", ".light.ambient", ".reveal.from", ".reveal.progress", ".fog"]) expect(at(p)?.severity, p).toBe("error");
    expect(errorPaths({ ...ok, effects: [] })).toContain("objects#p.effects");
  });

  it("notes effects that need a depth map on a flat photo, and progress ignored with duration", () => {
    const flat = issues({ src: "assets/a.jpg", effects: { fog: {}, light: {}, reveal: { duration: 2, progress: 0.5 } } });
    const info = flat.filter((i) => i.severity === "info").map((i) => i.path);
    expect(info).toEqual(expect.arrayContaining(["objects#p.effects.fog", "objects#p.effects.reveal", "objects#p.effects.reveal.progress"]));
    expect(info).not.toContain("objects#p.effects.light"); // light works on a flat photo (flat normals)
  });

  it("blur and frame: params, scalar inset, rack and flat notes", () => {
    const good = { blur: { focus: 0.8, amount: 1, range: 0.05, to: 0.1, duration: 3, delay: 1 }, frame: { inset: [0.1, 0.2], threshold: 0.7, softness: 0.05, border: 0.02, color: "#111111", shadow: 0.5 } };
    expect(issues({ ...ok, effects: good })).toEqual([]);
    expect(issues({ ...ok, effects: { blur: {}, frame: { inset: 0.15 } } })).toEqual([]);
    const bad = issues({ ...ok, effects: { blur: { amount: -1, focus: 2, foucs: 1 }, frame: { inset: 0.6, threshold: "near", color: 3 } } });
    const at = (p: string) => bad.find((i) => i.path === `objects#p.effects${p}`);
    for (const p of [".blur.amount", ".blur.focus", ".frame.inset", ".frame.threshold", ".frame.color"]) expect(at(p)?.severity, p).toBe("error");
    expect(at(".blur.foucs")!.hint).toContain('"focus"');
    expect(errorPaths({ ...ok, effects: { frame: { inset: [0.1, 0.9] } } })).toContain("objects#p.effects.frame.inset");
    // a rack needs both `to` and `duration`
    expect(issues({ ...ok, effects: { blur: { to: 0.2 } } }).find((i) => i.path === "objects#p.effects.blur.to")?.severity).toBe("info");
    expect(issues({ ...ok, effects: { blur: { duration: 2 } } }).find((i) => i.path === "objects#p.effects.blur.duration")?.severity).toBe("info");
    // flat photo: both work (even blur, plain frame), with a note
    const flat = issues({ src: "assets/a.jpg", effects: { blur: {}, frame: {} } });
    expect(flat.filter((i) => i.severity === "error")).toEqual([]);
    expect(flat.map((i) => i.path)).toEqual(expect.arrayContaining(["objects#p.effects.blur", "objects#p.effects.frame"]));
  });

  it("validates effect timeline tracks", () => {
    const s = scene([{ id: "p", kind: "photo", ...ok, effects: { light: {}, reveal: {} } }, { id: "m", kind: "mesh", geometry: { type: "box" } }]);
    const track = (target: string, keys: unknown[]) => validateScene({ ...s, timeline: { duration: 4, tracks: [{ target, keys }] } } as SceneDoc).filter((i) => i.path.startsWith("timeline") && i.severity === "error");
    expect(track("p.effects.light.position", [[0, [-0.8, 0.5]], [4, [0.8, 0.5]]])).toEqual([]);
    expect(track("p.effects.light.position.x", [[0, -1], [4, 1]])).toEqual([]);
    expect(track("p.effects.light.color", [[0, "#ffffff"], [4, "#ff8800"]])).toEqual([]);
    expect(track("p.effects.reveal.progress", [[0, 0], [2, 1]])).toEqual([]);
    expect(track("p.effects.light.position", [[0, [1, 2, 3]]])[0].code).toBe("track-value");
    expect(track("p.effects.fog.amount", [[0, 0]])[0].message).toContain("no fog effect");
    expect(track("p.effects.light.follow", [[0, 1]])[0].message).toContain("not animatable");
    expect(track("p.effects.ligth.intensity", [[0, 1]])[0].hint).toContain('"light"');
    expect(track("m.effects.light.intensity", [[0, 1]])[0].message).toContain("not a 3D photo");
    const s2 = scene([{ id: "p", kind: "photo", ...ok, effects: { blur: {}, frame: {} } }]);
    const track2 = (target: string, keys: unknown[]) => validateScene({ ...s2, timeline: { duration: 4, tracks: [{ target, keys }] } } as SceneDoc).filter((i) => i.path.startsWith("timeline") && i.severity === "error");
    expect(track2("p.effects.blur.focus", [[0, 0.9], [3, 0.1]])).toEqual([]);
    expect(track2("p.effects.frame.inset", [[0, [0, 0]], [2, [0.12, 0.12]]])).toEqual([]);
    expect(track2("p.effects.frame.inset.y", [[0, 0.3]])).toEqual([]);
    expect(track2("p.effects.frame.color", [[0, "#000000"]])).toEqual([]);
  });
});
