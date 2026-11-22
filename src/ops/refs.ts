// Asset references inside a scene (models, svg files, textures, HDRIs,
// audio): collected by `check` (missing files, budget, licences) and
// rewritten by `export` (library ids → copied relative paths).

import type { AssetEntry, ObjectDef, SceneDoc } from "../core/types";
import { MATERIAL_TEXTURE_SLOTS } from "../core/validate";
import { walkObjects } from "./tree";

export interface AssetRef {
  path: string; // as written in the scene ("assets/x.glb" | "library:id")
  at: string; // scene path ("objects#fox.src")
  kind: AssetEntry["kind"];
}

type Visitor = (value: string, at: string, kind: AssetEntry["kind"]) => string | void;

// Visits every asset string; when the visitor returns a string, it replaces the value (mutates `scene`).
export function visitAssetRefs(scene: SceneDoc, visit: Visitor): void {
  const env = scene.environment;
  if (env) {
    const bg = env.background as unknown;
    if (bg && typeof bg === "object" && typeof (bg as { hdri?: unknown }).hdri === "string") {
      const r = visit((bg as { hdri: string }).hdri, "environment.background.hdri", "hdri");
      if (typeof r === "string") (bg as { hdri: string }).hdri = r;
    }
    const lighting = env.lighting as unknown;
    if (lighting && typeof lighting === "object" && typeof (lighting as { hdri?: unknown }).hdri === "string") {
      const r = visit((lighting as { hdri: string }).hdri, "environment.lighting.hdri", "hdri");
      if (typeof r === "string") (lighting as { hdri: string }).hdri = r;
    }
  }
  const material = (m: unknown, at: string) => {
    if (!m || typeof m !== "object") return;
    const mat = m as Record<string, unknown>;
    // String slots only: procedural textures ({ "procedural": … }) are generated, not files.
    for (const k of MATERIAL_TEXTURE_SLOTS) {
      if (typeof mat[k] === "string") {
        const r = visit(mat[k] as string, `${at}.${k}`, "texture");
        if (typeof r === "string") mat[k] = r;
      }
    }
  };
  walkObjects(scene.objects, (o: ObjectDef) => {
    const at = `objects#${o.id}`;
    if (o.kind === "model" && typeof o.src === "string") {
      const r = visit(o.src, `${at}.src`, "model");
      if (typeof r === "string") o.src = r;
    }
    if (o.kind === "svg" && typeof o.src === "string" && !o.src.trim().startsWith("<")) {
      const r = visit(o.src, `${at}.src`, "svg");
      if (typeof r === "string") o.src = r;
    }
    if (o.kind === "text") {
      // Text fonts are library assets too (default "sans-bold"): a catalog id
      // maps to "library:fonts/<id>.typeface.json"; a path / ref is kept as is.
      const font = typeof o.font === "string" && o.font ? o.font : "sans-bold";
      const ref = font.includes("/") || font.includes(":") ? font : `library:fonts/${font}.typeface.json`;
      const r = visit(ref, `${at}.font`, "font");
      if (typeof r === "string") o.font = r;
    }
    if ("material" in o) material(o.material, `${at}.material`);
  });
  const audio = scene.audio;
  if (audio?.sounds) {
    for (const [name, s] of Object.entries(audio.sounds)) {
      if (s && typeof s === "object" && "src" in s && typeof s.src === "string") {
        const r = visit(s.src, `audio.sounds.${name}.src`, "audio");
        if (typeof r === "string") s.src = r;
      }
    }
  }
  if (audio?.music && typeof audio.music.src === "string") {
    const r = visit(audio.music.src, "audio.music.src", "audio");
    if (typeof r === "string") audio.music.src = r;
  }
}

export function collectAssetRefs(scene: SceneDoc): AssetRef[] {
  const refs: AssetRef[] = [];
  visitAssetRefs(scene, (path, at, kind) => void refs.push({ path, at, kind }));
  return refs;
}

export function kindFromPath(path: string): AssetEntry["kind"] {
  const ext = path.toLowerCase().split("?")[0].split(".").pop() ?? "";
  if (["glb", "gltf", "bin"].includes(ext)) return "model";
  if (["hdr", "exr"].includes(ext)) return "hdri";
  if (["png", "jpg", "jpeg", "webp", "ktx2", "avif"].includes(ext)) return "texture";
  if (["mp3", "ogg", "wav", "m4a", "aac", "opus"].includes(ext)) return "audio";
  if (["ttf", "otf", "woff", "woff2", "typeface"].includes(ext) || path.endsWith(".typeface.json")) return "font";
  if (ext === "svg") return "svg";
  return "other";
}

export function mimeFromPath(path: string): string {
  const ext = path.toLowerCase().split("?")[0].split(".").pop() ?? "";
  return (
    {
      glb: "model/gltf-binary",
      gltf: "model/gltf+json",
      bin: "application/octet-stream",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      avif: "image/avif",
      ktx2: "image/ktx2",
      svg: "image/svg+xml",
      hdr: "image/vnd.radiance",
      exr: "image/x-exr",
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      aac: "audio/aac",
      opus: "audio/opus",
      js: "text/javascript",
      mjs: "text/javascript",
      json: "application/json",
      ttf: "font/ttf",
      otf: "font/otf",
      woff: "font/woff",
      woff2: "font/woff2",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

// External files a .gltf references (buffers / images with relative URIs), as project paths.
export function gltfDependencies(gltfPath: string, gltfText: string): string[] {
  let json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  try {
    json = JSON.parse(gltfText);
  } catch {
    return [];
  }
  const dir = gltfPath.includes("/") ? gltfPath.slice(0, gltfPath.lastIndexOf("/") + 1) : "";
  const out: string[] = [];
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    const uri = item?.uri;
    if (typeof uri !== "string" || uri.startsWith("data:") || /^[a-z]+:/i.test(uri)) continue;
    out.push(joinPath(dir, decodeURIComponent(uri)));
  }
  return [...new Set(out)];
}

// POSIX join resolving "." and ".." segments (never above the root).
export function joinPath(dir: string, rel: string): string {
  const parts = `${dir}${rel}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}
