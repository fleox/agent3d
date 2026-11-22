// The built-in asset library (library/ in the npm package, library/index.json).
// Scenes reference its assets as "library:<id>" (e.g. "library:models/nature/pine-tree.glb").
// The front door (CLI, Studio) loads the index and the bytes; ops only see these types.

import type { AssetEntry } from "./types";

export interface LibraryAsset {
  id: string; // path inside library/, e.g. "models/nature/pine-tree.glb" (referenced as "library:models/nature/pine-tree.glb")
  path: string; // file path inside library/ ("models/nature/pine-tree.glb")
  kind: AssetEntry["kind"];
  license: string; // "CC0-1.0", …
  author?: string;
  tags: string[];
  bytes: number;
  description: string;
  // Text to show when the licence requires attribution.
  attribution?: string;
  sourceUrl?: string;
  // Models (scripts/build-library.mjs reads them from the GLB): animation clip
  // names (play with `animation: { clip }`) and the triangle count.
  animations?: string[];
  triangles?: number;
  skinned?: boolean;
}

export interface LibraryIndex {
  assets: LibraryAsset[];
}

// Reads library asset bytes by id (export copies them next to the scene).
export interface LibraryProvider {
  index: LibraryIndex;
  read(id: string): Promise<Uint8Array>;
}

export const LIBRARY_PREFIX = "library:";

export function isLibraryRef(path: unknown): boolean {
  return typeof path === "string" && path.startsWith(LIBRARY_PREFIX);
}

export function libraryId(ref: string): string {
  return ref.slice(LIBRARY_PREFIX.length);
}

export function findLibraryAsset(index: LibraryIndex | undefined, id: string): LibraryAsset | undefined {
  return index?.assets.find((a) => a.id === id);
}
