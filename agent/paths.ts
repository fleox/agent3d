import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";

// The CLI runs either bundled (dist/agent/agent3d.mjs, inside the npm
// package or a clone) or from source (agent/*.ts under tsx / vitest). Both
// layouts resolve to the same folders:
//   dist/runtime   the player (agent3d-runtime.js + chunks/, .single.js)
//   dist/studio    the Studio SPA
//   library/       built-in CC0 assets (+ index.json)
//   templates/     starter projects
// $AGENT3D_DIST overrides the dist folder; $AGENT3D_LIBRARY and
// $AGENT3D_TEMPLATES override the other two (tests).

declare const __AGENT3D_BUNDLED__: boolean | undefined;

export function isBundled(): boolean {
  return typeof __AGENT3D_BUNDLED__ !== "undefined" && !!__AGENT3D_BUNDLED__;
}

// Root of the package this CLI file belongs to.
export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // bundled: <pkg>/dist/agent/agent3d.mjs (chunks: <pkg>/dist/agent/chunks/x.mjs)
  if (isBundled()) return here.endsWith("chunks") ? resolve(here, "..", "..", "..") : resolve(here, "..", "..");
  return resolve(here, "..");
}

export function distRoot(): string {
  if (process.env.AGENT3D_DIST) return resolve(process.env.AGENT3D_DIST);
  return join(packageRoot(), "dist");
}

export const runtimeDir = (): string => join(distRoot(), "runtime");
export const studioDir = (): string => join(distRoot(), "studio");
export const libraryDir = (): string => (process.env.AGENT3D_LIBRARY ? resolve(process.env.AGENT3D_LIBRARY) : join(packageRoot(), "library"));
export const templatesDir = (): string => (process.env.AGENT3D_TEMPLATES ? resolve(process.env.AGENT3D_TEMPLATES) : join(packageRoot(), "templates"));

export const RUNTIME_ENTRY = "agent3d-runtime.js";
export const RUNTIME_SINGLE = "agent3d-runtime.single.js";
// Photo-only lite runtime (src/runtime/lite/, src/ops/liteRuntime.ts).
export const RUNTIME_PHOTO = "agent3d-photo.js";

export function runtimeBuilt(): boolean {
  return existsSync(join(runtimeDir(), RUNTIME_ENTRY));
}

export interface VersionInfo {
  name: string;
  version: string;
}

// dist/version.json when built, else package.json.
export function readVersionInfo(): VersionInfo {
  const file = join(distRoot(), "version.json");
  if (existsSync(file)) {
    try {
      const v = JSON.parse(readFileSync(file, "utf8")) as Partial<VersionInfo>;
      if (v.version) return { name: v.name ?? pkg.name, version: v.version };
    } catch {
      /* fall back to package.json */
    }
  }
  return { name: pkg.name, version: pkg.version };
}

export const PACKAGE_NAME = pkg.name;

// onnxruntime-web files for `assets depth` (authoring-time depth maps):
// dist/agent/ort/ (copied by vite.agent.config.ts), else node_modules in a
// clone / under vitest. Null when neither exists.
export const ORT_FILES = ["ort.wasm.bundle.min.mjs", "ort-wasm-simd-threaded.wasm"] as const;
export function ortDir(): string | null {
  const candidates = [join(distRoot(), "agent", "ort"), join(packageRoot(), "node_modules", "onnxruntime-web", "dist")];
  return candidates.find((d) => ORT_FILES.every((f) => existsSync(join(d, f)))) ?? null;
}
