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

  it("accepts the cinematic moves and their loop / duration / progress, with did-you-mean on typos", () => {
    const ok = { src: "assets/a.jpg", depth: "assets/d.png" };
    for (const auto of ["dolly", "pan", "rise", "vertigo"]) expect(errorPaths({ ...ok, motion: { auto } })).toEqual([]);
    expect(errorPaths({ ...ok, motion: { auto: "pan", loop: false, duration: 8, progress: 0.4 } })).toEqual([]);
    const typo = issues({ ...ok, motion: { auto: "doly" } }).find((i) => i.path === "objects#p.motion.auto");
    expect(typo?.severity).toBe("error");
    expect(typo!.hint).toContain('"dolly"');
    const bad = issues({ ...ok, motion: { auto: "rise", loop: "yes", duration: 0, progress: 1.5 } }).filter((i) => i.severity === "error").map((i) => i.path);
    expect(bad).toEqual(expect.arrayContaining(["objects#p.motion.loop", "objects#p.motion.duration", "objects#p.motion.progress"]));
    expect(issues({ ...ok, motion: { auto: "dolly", lopp: false } }).find((i) => i.path === "objects#p.motion.lopp")!.hint).toContain('"loop"');
    // duration without loop: false, or move fields without a move: info only
    expect(issues({ ...ok, motion: { auto: "dolly", duration: 6 } }).find((i) => i.path === "objects#p.motion.duration")?.severity).toBe("info");
    expect(issues({ ...ok, motion: { auto: "none", loop: false } }).find((i) => i.path === "objects#p.motion")?.severity).toBe("info");
  });

  it("validates timeline tracks on motion.progress (photos only)", () => {
    const scene = (target: string) => ({ ...defaultScene({ id: "s" }), objects: [{ id: "p", kind: "photo", src: "assets/a.jpg", depth: "assets/d.png", motion: { auto: "dolly" } }, { id: "m", kind: "mesh", geometry: { type: "box" } }], timeline: { duration: 4, trigger: "scroll", tracks: [{ target, keys: [[0, 0], [4, 1]] }] } }) as unknown as SceneDoc;
    const errs = (t: string) => validateScene(scene(t)).filter((i) => i.severity === "error");
    expect(errs("p.motion.progress")).toEqual([]);
    expect(errs("p.material.opacity")).toEqual([]);
    expect(errs("m.motion.progress").length).toBe(1);
    expect(errs("p.motion.progres")[0].hint).toContain('"motion.progress"');
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
