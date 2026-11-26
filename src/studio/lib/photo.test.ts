import { describe, expect, it } from "vitest";
import type { PhotoObjectDef, SceneDoc } from "../../core/types";
import { defaultScene, validateScene } from "../../core/validate";
import { applyPatchOps } from "../../ops/scene";
import { canEstimateDepth, depthResultPath, depthToolInput, imageOptions, isImagePath, newPhotoObject, photoIdBase, photoSpecs, selectedImage } from "./photo";
import { fieldOps, newObject, objPath } from "./patches";
import { PHOTO_MATERIAL_SPECS, PHOTO_MODE_SPEC, PHOTO_MOTION_SPECS, PHOTO_SPECS } from "../inspector/specs";
import { PHOTO_AUTO_MOTIONS, PHOTO_MODES } from "../../core/validate";

const photo = (extra: Partial<PhotoObjectDef> = {}): PhotoObjectDef => ({ id: "p", kind: "photo", src: "assets/textures/a.jpg", ...extra });
const names = (o: PhotoObjectDef) => photoSpecs(o).map((s) => s.name);

describe("photo inspector specs", () => {
  it("shows segments only for mesh, layers only for layers, edgeCut for both", () => {
    expect(names(photo())).toEqual(["width", "height", "strength", "focus"]);
    expect(names(photo({ mode: "parallax" }))).not.toContain("edgeCut");
    expect(names(photo({ mode: "mesh" }))).toEqual(["width", "height", "strength", "focus", "segments", "edgeCut"]);
    expect(names(photo({ mode: "layers" }))).toEqual(["width", "height", "strength", "focus", "layers", "edgeCut"]);
  });
  it("keeps a field the mode ignores visible while it is set (so it can be reset)", () => {
    expect(names(photo({ mode: "parallax", segments: 64 }))).toContain("segments");
  });
  it("uses the engine enums", () => {
    expect(PHOTO_MODE_SPEC.options).toEqual([...PHOTO_MODES]);
    expect(PHOTO_MOTION_SPECS.find((s) => s.name === "auto")?.options).toEqual([...PHOTO_AUTO_MOTIONS]);
  });
  it("spec defaults are values the engine accepts", () => {
    const o = photo({ mode: "mesh", depth: "assets/textures/a-depth.png" }) as unknown as Record<string, unknown>;
    for (const s of PHOTO_SPECS) if (s.default !== undefined) o[s.name] = s.default;
    o.motion = Object.fromEntries(PHOTO_MOTION_SPECS.filter((s) => s.default !== undefined).map((s) => [s.name, s.default]));
    o.material = Object.fromEntries(PHOTO_MATERIAL_SPECS.filter((s) => s.default !== undefined).map((s) => [s.name, s.default]));
    const scene = { ...defaultScene(), objects: [o] } as unknown as SceneDoc;
    expect(validateScene(scene).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("photo helpers", () => {
  it("recognises image paths", () => {
    expect(isImagePath("assets/textures/a.JPG")).toBe(true);
    expect(isImagePath("library:textures/x.webp")).toBe(true);
    expect(isImagePath("assets/models/a.glb")).toBe(false);
  });
  it("lists project images first, then library textures, keeping the current value", () => {
    const opts = imageOptions(
      [{ path: "assets/textures/a.jpg" }, { path: "assets/models/m.glb" }, { path: "assets/textures/gone.png", missing: true }],
      { assets: [{ id: "textures/wood.jpg", path: "textures/wood.jpg", kind: "texture", license: "CC0-1.0", tags: [], bytes: 1, description: "" }, { id: "models/x.glb", path: "models/x.glb", kind: "model", license: "CC0-1.0", tags: [], bytes: 1, description: "" }] },
      "assets/other.png",
    );
    expect(opts.map((o) => [o.group, o.value])).toEqual([
      ["current", "assets/other.png"],
      ["project", "assets/textures/a.jpg"],
      ["library", "library:textures/wood.jpg"],
    ]);
    expect(imageOptions([], { assets: [{ id: "textures/wood.jpg", path: "textures/wood.jpg", kind: "texture", license: "", tags: [], bytes: 1, description: "" }] }, undefined, { library: false })).toEqual([]);
  });
  it("takes the selected object's image", () => {
    expect(selectedImage(photo())).toBe("assets/textures/a.jpg");
    expect(selectedImage({ id: "m", kind: "mesh", geometry: { type: "plane" }, material: { map: "assets/textures/b.png" } })).toBe("assets/textures/b.png");
    expect(selectedImage({ id: "m", kind: "mesh", geometry: { type: "plane" }, material: { map: { procedural: "noise" } } })).toBeUndefined();
    expect(selectedImage(null)).toBeUndefined();
  });
  it("builds a valid new photo with a unique id, through the add patch op", () => {
    expect(photoIdBase("assets/textures/My Cat.jpg")).toBe("photo-My-Cat");
    expect(photoIdBase("library:textures/.png")).toBe("photo");
    const scene = defaultScene();
    const obj = newObject(scene, { kind: "photo", src: "assets/textures/cat.jpg" });
    expect(obj).toEqual({ id: "photo-cat", kind: "photo", src: "assets/textures/cat.jpg", mode: "parallax", position: [0, 0, 0] });
    const next = applyPatchOps(scene, [{ op: "addObject", object: obj }]);
    expect(validateScene(next).filter((i) => i.severity === "error")).toEqual([]);
    expect(newObject(next, { kind: "photo", src: "assets/textures/cat.jpg" }).id).not.toBe("photo-cat");
    expect(newPhotoObject("x", "a.png").mode).toBe("parallax");
  });
  it("motion fields write nested paths through patch ops", () => {
    const scene = { ...defaultScene(), objects: [photo()] } as SceneDoc;
    const ops = fieldOps(scene, objPath("p", "motion.auto"), "orbit");
    const next = applyPatchOps(scene, ops);
    expect((next.objects[0] as PhotoObjectDef).motion).toEqual({ auto: "orbit" });
  });
});

describe("depth tool round trip", () => {
  it("sends the image and reads the written path", () => {
    expect(depthToolInput(photo())).toEqual({ image: "assets/textures/a.jpg" });
    expect(depthResultPath({ path: "assets/textures/a-depth.png" })).toBe("assets/textures/a-depth.png");
    expect(depthResultPath({ depth: "./assets/textures/a-depth.png", kb: 3 })).toBe("assets/textures/a-depth.png");
    expect(depthResultPath("assets/textures/a-depth.png")).toBe("assets/textures/a-depth.png");
    expect(depthResultPath({ status: "refused" })).toBeUndefined();
    expect(depthResultPath(null)).toBeUndefined();
  });
  it("is gated on the host capability", () => {
    expect(canEstimateDepth({ depth: true })).toBe(true);
    expect(canEstimateDepth({})).toBe(false);
  });
});
