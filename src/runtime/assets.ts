// Asset path resolution + cached loaders.
//
// resolveAsset(path) — how a scene path becomes a URL:
//   1. `assetUrls[path]` (single-html export: data:/blob: URLs) wins;
//   2. absolute URLs ("http:", "https:", "data:", "blob:", "/…") are kept;
//   3. "library:<id>" → `${libraryBase}<id>`. Library ids ARE relative paths
//      with their extension ("library:models/fox.glb" → `${libraryBase}models/fox.glb`),
//      except fonts: "library:fonts/sans-bold" → `${libraryBase}fonts/sans-bold.typeface.json`;
//   4. anything else is project-relative: `${assetBase}<path>`.
// Defaults: assetBase "./", libraryBase `${assetBase}assets/library/` (where
// `agent3d export` copies the library files a scene uses).

import type * as THREE from "three";

export interface AssetResolverOptions {
  assetBase?: string;
  libraryBase?: string;
  assetUrls?: Record<string, string>;
}

function withSlash(s: string): string {
  return s.endsWith("/") ? s : s + "/";
}

export function createResolver(opts: AssetResolverOptions): (path: string) => string {
  const assetBase = withSlash(opts.assetBase ?? "./");
  const libraryBase = withSlash(opts.libraryBase ?? assetBase + "assets/library/");
  const urls = opts.assetUrls ?? {};
  return (path: string) => {
    if (urls[path]) return urls[path];
    if (/^(https?:|data:|blob:|\/)/.test(path)) return path;
    if (path.startsWith("library:")) {
      let id = path.slice("library:".length);
      if (id.startsWith("fonts/") && !/\.json$/.test(id)) id += ".typeface.json";
      if (urls["library:" + id]) return urls["library:" + id];
      return libraryBase + id;
    }
    return assetBase + path.replace(/^\.\//, "");
  };
}

// ─── Cached loaders (each loader module is imported lazily) ─────────────

const textCache = new Map<string, Promise<string>>();
export function fetchText(url: string): Promise<string> {
  let p = textCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.text();
    });
    p.catch(() => textCache.delete(url));
    textCache.set(url, p);
  }
  return p;
}

export async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}

const textureCache = new Map<string, Promise<THREE.Texture>>();
export function loadTexture(url: string): Promise<THREE.Texture> {
  let p = textureCache.get(url);
  if (!p) {
    p = import("three").then(
      (T) =>
        new Promise<THREE.Texture>((resolve, reject) => {
          new T.TextureLoader().load(url, resolve, undefined, () => reject(new Error(`Cannot load texture ${url}`)));
        }),
    );
    p.catch(() => textureCache.delete(url));
    textureCache.set(url, p);
  }
  return p.then((t) => {
    const c = t.clone();
    c.needsUpdate = true;
    return c;
  });
}
