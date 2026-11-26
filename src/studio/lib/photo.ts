// 3D photo helpers (kind "photo"): which inspector fields apply to a mode,
// which project / library files can be picked as the image or depth map, the
// new-object default, and the `image_depth` tool round trip. Validity is the
// engine's (src/core/validate.ts): these only shape the UI.

import type { ParamSpec } from "../../core/catalog";
import type { LibraryIndex } from "../../core/library";
import type { ObjectDef, PhotoObjectDef } from "../../core/types";
import { PHOTO_MODE_SPEC, PHOTO_SPECS } from "../inspector/specs";

export type PhotoMode = NonNullable<PhotoObjectDef["mode"]>;

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
export const isImagePath = (path: string): boolean => IMAGE_RE.test(path.replace(/[?#].*$/, ""));

export const photoMode = (o: Pick<PhotoObjectDef, "mode">): PhotoMode => o.mode ?? (PHOTO_MODE_SPEC.default as PhotoMode);

// Per-mode fields: segments only for "mesh", layers only for "layers",
// edgeCut for the two that cut geometry. A field already set stays visible
// (so it can be reset) even when the mode ignores it.
const ONLY: Record<string, PhotoMode[]> = { segments: ["mesh"], layers: ["layers"], edgeCut: ["mesh", "layers"] };
export function photoSpecs(o: PhotoObjectDef): ParamSpec[] {
  const mode = photoMode(o);
  const values = o as unknown as Record<string, unknown>;
  // occlude needs a depth map
  return PHOTO_SPECS.filter((sp) => (sp.name === "occlude" ? !!o.depth : !ONLY[sp.name] || ONLY[sp.name].includes(mode)) || values[sp.name] !== undefined);
}

// Options of the image pickers: project images (assets_list result), then
// library images (textures). `current` is always listed so it stays selectable.
export interface ImageOption {
  value: string;
  label: string;
  group: "project" | "library" | "current";
}
export function imageOptions(projectAssets: { path: string; missing?: boolean }[] | undefined, library: LibraryIndex | undefined, current?: string, opts: { library?: boolean } = {}): ImageOption[] {
  const out: ImageOption[] = [];
  const seen = new Set<string>();
  const push = (o: ImageOption) => {
    if (seen.has(o.value)) return;
    seen.add(o.value);
    out.push(o);
  };
  for (const a of projectAssets ?? []) if (!a.missing && isImagePath(a.path)) push({ value: a.path, label: a.path.replace(/^assets\//, ""), group: "project" });
  if (opts.library !== false) for (const a of library?.assets ?? []) if (a.kind === "texture" && isImagePath(a.path || a.id)) push({ value: `library:${a.id}`, label: a.id.replace(/^textures\//, ""), group: "library" });
  if (current && !seen.has(current)) out.unshift({ value: current, label: current.replace(/^assets\//, ""), group: "current" });
  return out;
}

// The image an "add 3D photo" action starts from: the selected object's own
// image (a photo's src, or a string colour map), when there is one.
export function selectedImage(o: ObjectDef | null | undefined): string | undefined {
  if (!o) return undefined;
  if (o.kind === "photo") return o.src;
  const map = (o as { material?: { map?: unknown } }).material?.map;
  return typeof map === "string" && isImagePath(map) ? map : undefined;
}

export function photoIdBase(src: string): string {
  const base = (src.split(/[/:]/).pop() ?? "").replace(IMAGE_RE, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return base ? `photo-${base}`.slice(0, 40) : "photo";
}

export function newPhotoObject(id: string, src: string, position: [number, number, number] = [0, 0, 0]): PhotoObjectDef {
  return { id, kind: "photo", src, mode: "parallax", position };
}

// image_depth tool (src/ai/assetTools.ts): input from the photo, output → the depth path.
export const DEPTH_TOOL = "image_depth";
export const depthToolInput = (o: PhotoObjectDef): Record<string, unknown> => ({ image: o.src });
export function depthResultPath(result: unknown): string | undefined {
  if (typeof result === "string") return isImagePath(result) ? result : undefined;
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  for (const k of ["depth", "path", "out", "file"]) {
    const v = r[k];
    if (typeof v === "string" && isImagePath(v)) return v.replace(/^\.\//, "");
  }
  return undefined;
}

// The depth button needs a host with a depth estimator (CLI: headless Chrome).
export const canEstimateDepth = (caps: { depth?: boolean }): boolean => caps.depth === true;
