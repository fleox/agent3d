// Asset path → URL resolution (see ./assets.ts for the rules). No Three.js,
// no loaders: shared by the full runtime and the photo-only lite runtime.

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
