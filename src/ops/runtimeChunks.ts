// Which runtime files a page showing a given scene downloads: the entry, its
// static imports, and the lazy chunks (dynamic imports) whose feature the scene
// uses. Lets `export` report the real page weight (pageKb) instead of the
// whole runtime folder, and optionally copy only those chunks.
//
// Conservative by design: a chunk whose feature is not known here (a new lazy
// import in the runtime) counts as loaded and is reported in `unknown`, so the
// estimate errs on the heavy side and pruning falls back to every chunk.

import type { SceneDoc } from "../core/types";

// Lazy chunk base names (file name before "-<hash>.js") → does this scene load it?
type Need = (scene: SceneDoc, json: string) => boolean;

const hasKind = (scene: SceneDoc, kinds: string[]): boolean => {
  const walk = (objs: SceneDoc["objects"] | undefined): boolean => !!objs?.some((o) => kinds.includes(o.kind as string) || walk(o.children));
  return walk(scene.objects);
};
const hasBody = (scene: SceneDoc): boolean => {
  const walk = (objs: SceneDoc["objects"] | undefined): boolean => !!objs?.some((o) => !!(o as { body?: unknown }).body || walk(o.children));
  return walk(scene.objects);
};
// Same rule as the player (src/runtime/player.ts needsGame).
export const needsGameChunk = (scene: SceneDoc): boolean => !!(scene.scripts?.length || scene.ui?.elements?.length || scene.physics || scene.audio || hasBody(scene));

export const CHUNK_FEATURES: Record<string, { feature: string; needed: Need }> = {
  postfx: { feature: "post effects (scene.postfx)", needed: (s) => !!s.postfx?.length },
  generators: { feature: "generators", needed: (s) => hasKind(s, ["generator"]) },
  shaders: { feature: "shader materials / backgrounds", needed: (_s, j) => /"shader"\s*:/.test(j) },
  OrbitControls: { feature: "orbit controls", needed: (_s, j) => /"controls"\s*:\s*"orbit"/.test(j) },
  RectAreaLightUniformsLib: { feature: "rect lights (incl. light rigs)", needed: (s, j) => /"type"\s*:\s*"rect"/.test(j) || !!s.environment?.rig },
  Sky: { feature: "physical sky", needed: (_s, j) => /"sky"\s*:/.test(j) },
  HDRLoader: { feature: ".hdr environment", needed: (_s, j) => /\.hdr"/i.test(j) },
  EXRLoader: { feature: ".exr environment", needed: (_s, j) => /\.exr"/i.test(j) },
  GroundedSkybox: { feature: "HDRI ground projection", needed: (_s, j) => /"groundProjection"\s*:\s*(true|\{)/.test(j) },
  RoomEnvironment: { feature: "studio / soft image-based lighting", needed: () => true },
  text: { feature: "3D text", needed: (s) => hasKind(s, ["text"]) },
  svg: { feature: "SVG objects", needed: (s) => hasKind(s, ["svg"]) },
  model: { feature: "glTF models", needed: (s) => hasKind(s, ["model"]) },
  photo: { feature: "3D photos", needed: (s) => hasKind(s, ["photo"]) },
  game: { feature: "scripts / HUD / physics / audio", needed: (s) => needsGameChunk(s) },
  audio: { feature: "audio", needed: (s) => !!s.audio },
  physicsHost: { feature: "physics", needed: (s) => !!s.physics || hasBody(s) },
  // Nested lazy imports of the chunks above (loaded with them when needed).
  GLTFLoader: { feature: "glTF models", needed: (s) => hasKind(s, ["model"]) },
  SkeletonUtils: { feature: "glTF models", needed: (s) => hasKind(s, ["model"]) },
  meshopt_decoder: { feature: "meshopt-compressed models", needed: (s) => hasKind(s, ["model"]) },
  FontLoader: { feature: "3D text", needed: (s) => hasKind(s, ["text"]) },
  SVGLoader: { feature: "SVG objects", needed: (s) => hasKind(s, ["svg"]) },
  BufferGeometryUtils: { feature: "3D text / SVG", needed: (s) => hasKind(s, ["text", "svg"]) },
};

export function chunkBase(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.js$/, "");
  return name.replace(/-[A-Za-z0-9_-]{6,12}$/, "").replace(/\.module$/, "");
}

function resolveRel(dir: string, rel: string): string {
  const out: string[] = [];
  for (const p of (dir + rel).split("/")) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

// Static and dynamic relative imports of every runtime JS file.
export function importGraph(files: Record<string, Uint8Array>): Map<string, { static: string[]; dynamic: string[] }> {
  const dec = new TextDecoder();
  const graph = new Map<string, { static: string[]; dynamic: string[] }>();
  for (const [file, bytes] of Object.entries(files)) {
    if (!file.endsWith(".js")) continue;
    const src = dec.decode(bytes);
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
    const stat = new Set<string>();
    const dyn = new Set<string>();
    for (const m of src.matchAll(/\b(?:import|export)\s*(?:[^'"`();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g)) stat.add(resolveRel(dir, m[1]));
    for (const m of src.matchAll(/\bimport\(\s*[`"'](\.{1,2}\/[^`"']+)[`"']\s*\)/g)) dyn.add(resolveRel(dir, m[1]));
    for (const d of dyn) stat.delete(d);
    graph.set(file, { static: [...stat].filter((f) => files[f]), dynamic: [...dyn].filter((f) => files[f]) });
  }
  return graph;
}

export interface PageRuntime {
  // Runtime files the page downloads (entry first).
  loaded: string[];
  // Lazy chunks this scene never loads.
  skipped: string[];
  // Lazy chunks with no known feature (counted as loaded).
  unknown: string[];
  // Lazy chunk base name → the feature that loads it (for the loaded ones).
  features: Record<string, string>;
}

export function pageRuntime(files: Record<string, Uint8Array>, entry: string, scene: SceneDoc): PageRuntime {
  const graph = importGraph(files);
  const json = JSON.stringify(scene);
  const loaded = new Set<string>();
  const unknown = new Set<string>();
  const features: Record<string, string> = {};
  const queue = [entry];
  const add = (f: string) => {
    if (loaded.has(f)) return;
    loaded.add(f);
    queue.push(f);
  };
  // Files the entry imports statically (transitively): a dynamic import of one
  // of them (e.g. `import("three")` next to the static import) is no lazy chunk.
  const eager = new Set<string>([entry]);
  const todo = [entry];
  while (todo.length) {
    for (const s of graph.get(todo.pop()!)?.static ?? []) {
      if (eager.has(s)) continue;
      eager.add(s);
      todo.push(s);
    }
  }
  loaded.add(entry);
  while (queue.length) {
    const f = queue.shift()!;
    const g = graph.get(f);
    if (!g) continue;
    for (const s of g.static) add(s);
    for (const d of g.dynamic) {
      if (eager.has(d)) {
        add(d);
        continue;
      }
      const base = chunkBase(d);
      const rule = CHUNK_FEATURES[base];
      if (!rule) {
        unknown.add(d);
        add(d);
      } else if (rule.needed(scene, json)) {
        features[base] = rule.feature;
        add(d);
      }
    }
  }
  const js = Object.keys(files).filter((f) => f.endsWith(".js") && !f.endsWith(".single.js"));
  return { loaded: [...loaded], skipped: js.filter((f) => !loaded.has(f)), unknown: [...unknown], features };
}

// gzip size (CompressionStream; undefined where the platform has none).
export async function gzipSize(chunks: (Uint8Array | string)[], gzip?: (data: Uint8Array) => Promise<Uint8Array>): Promise<number | undefined> {
  const enc = new TextEncoder();
  let total = 0;
  for (const c of chunks) {
    const bytes = typeof c === "string" ? enc.encode(c) : c;
    if (gzip) {
      total += (await gzip(bytes)).byteLength;
      continue;
    }
    if (typeof CompressionStream === "undefined") return undefined;
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
    total += (await new Response(stream).arrayBuffer()).byteLength;
  }
  return total;
}
