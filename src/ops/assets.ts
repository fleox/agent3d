// Project assets (assets/ + assets/manifest.json), asset search/download
// from free sources, zip import and the built-in library listing.

import type { ProjectFs } from "../core/fs";
import { normalizePath } from "../core/fs";
import { slugify } from "../core/ids";
import type { LibraryAsset, LibraryIndex } from "../core/library";
import type { AssetEntry, AssetManifest } from "../core/types";
import { closest } from "../core/suggest";
import { KB, OpsError, nowIso, readJsonOr, writeJson } from "./context";
import { ASSET_MANIFEST_FILE, readSceneFile, SCENE_FILE } from "./project";
import { collectAssetRefs, kindFromPath } from "./refs";
import { SOURCE_IDS, SOURCES, SourceError, score, type AssetHit, type FetchLike, type SourceId } from "./sources";
import { readZip, type InflateRaw } from "./zip";

export type { AssetHit, SourceId } from "./sources";

const KIND_DIR: Record<AssetEntry["kind"], string> = { model: "models", texture: "textures", hdri: "hdris", audio: "audio", font: "fonts", svg: "svg", other: "other" };

export async function readAssetManifest(fs: ProjectFs): Promise<AssetManifest> {
  const m = await readJsonOr<AssetManifest>(fs, ASSET_MANIFEST_FILE, { assets: [] });
  return { assets: Array.isArray(m.assets) ? m.assets : [] };
}

async function writeAssetManifest(fs: ProjectFs, m: AssetManifest): Promise<void> {
  m.assets.sort((a, b) => a.path.localeCompare(b.path));
  await writeJson(fs, ASSET_MANIFEST_FILE, m);
}

export interface AssetListing extends AssetEntry {
  exists: boolean;
  usedBy: string[]; // scene paths referencing it
}

// Manifest entries + files present under assets/ but unregistered (license "unknown").
export async function listAssets(fs: ProjectFs): Promise<{ assets: AssetListing[]; totalKb: number }> {
  const manifest = await readAssetManifest(fs);
  const refs = (await fs.exists(SCENE_FILE)) ? collectAssetRefs(await readSceneFile(fs)) : [];
  const files = new Set((await fs.list("assets/")).filter((f) => f !== ASSET_MANIFEST_FILE));
  const out: AssetListing[] = [];
  for (const a of manifest.assets) {
    out.push({ ...a, exists: files.has(a.path), usedBy: refs.filter((r) => r.path === a.path).map((r) => r.at) });
    files.delete(a.path);
  }
  for (const f of files) {
    out.push({ path: f, kind: kindFromPath(f), bytes: await fs.size(f), source: "local", license: "unknown", addedAt: "", exists: true, usedBy: refs.filter((r) => r.path === f).map((r) => r.at) });
  }
  return { assets: out, totalKb: KB(out.reduce((a, b) => a + (b.exists ? b.bytes : 0), 0)) };
}

export interface AddAssetInput {
  path: string; // project path under assets/ (a bare file name is placed in assets/<kind>s/)
  bytes: Uint8Array;
  kind?: AssetEntry["kind"];
  source: string;
  license: string;
  author?: string;
  sourceUrl?: string;
  attribution?: string;
}

export async function addAsset(fs: ProjectFs, input: AddAssetInput): Promise<AssetEntry> {
  if (!input.license?.trim()) throw new OpsError("invalid", "An asset needs a licence.", 'Pass license, e.g. "CC0-1.0" (public domain) or "CC-BY-4.0" (with author).');
  let path = input.path.replace(/^\.\//, "");
  const kind = input.kind ?? kindFromPath(path);
  if (!path.includes("/")) path = `assets/${KIND_DIR[kind]}/${path}`;
  try {
    path = normalizePath(path);
  } catch {
    throw new OpsError("invalid", `Invalid asset path "${input.path}".`, 'Use a project path under assets/, e.g. "assets/models/fox.glb".');
  }
  if (!path.startsWith("assets/") || path === ASSET_MANIFEST_FILE) throw new OpsError("invalid", `Assets live under assets/ (got "${path}").`, `Use e.g. "assets/${KIND_DIR[kind]}/${path.split("/").pop()}".`);
  await fs.writeBytes(path, input.bytes);
  const entry: AssetEntry = {
    path,
    kind,
    bytes: input.bytes.byteLength,
    source: input.source,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    license: input.license,
    ...(input.author ? { author: input.author } : {}),
    ...(input.attribution ? { attribution: input.attribution } : {}),
    addedAt: nowIso(),
  };
  const manifest = await readAssetManifest(fs);
  manifest.assets = manifest.assets.filter((a) => a.path !== path);
  manifest.assets.push(entry);
  await writeAssetManifest(fs, manifest);
  return entry;
}

// Removes the file + manifest entry. Reports scene paths still referencing it.
export async function removeAsset(fs: ProjectFs, path: string): Promise<{ removed: boolean; usedBy: string[] }> {
  const manifest = await readAssetManifest(fs);
  const inManifest = manifest.assets.some((a) => a.path === path);
  const exists = await fs.exists(path);
  if (!inManifest && !exists) {
    const s = closest(path, manifest.assets.map((a) => a.path));
    throw new OpsError("notFound", `No asset "${path}".`, s ? `Did you mean "${s}"?` : "List assets with assets_list / `agent3d assets list`.");
  }
  const usedBy = (await fs.exists(SCENE_FILE)) ? collectAssetRefs(await readSceneFile(fs)).filter((r) => r.path === path).map((r) => r.at) : [];
  if (exists) await fs.remove(path);
  if (inManifest) {
    manifest.assets = manifest.assets.filter((a) => a.path !== path);
    await writeAssetManifest(fs, manifest);
  }
  return { removed: true, usedBy };
}

// ─── Search & download ──────────────────────────────────────────────────

export interface SearchInput {
  query: string;
  kind?: AssetEntry["kind"];
  source?: SourceId;
  limit?: number;
}

export async function searchAssetsDetailed(input: SearchInput, fetchImpl: FetchLike): Promise<{ hits: AssetHit[]; errors: { source: SourceId; message: string }[] }> {
  if (!input.query?.trim()) throw new OpsError("invalid", "Empty search query.", 'Search with a few words, e.g. "pine tree", "wood floor", "sunset sky".');
  if (input.source && !SOURCES[input.source]) {
    throw new OpsError("invalid", `Unknown source "${input.source}".`, `${closest(input.source, SOURCE_IDS) ? `Did you mean "${closest(input.source, SOURCE_IDS)}"? ` : ""}Sources: ${SOURCE_IDS.join(", ")}.`);
  }
  const sources = input.source ? [SOURCES[input.source]] : Object.values(SOURCES).filter((s) => !input.kind || s.kinds.includes(input.kind));
  const errors: { source: SourceId; message: string }[] = [];
  const results = await Promise.all(
    sources.map(async (s) => {
      try {
        return await s.search({ query: input.query, kind: input.kind, limit: input.limit ?? 10 }, fetchImpl);
      } catch (e) {
        errors.push({ source: s.id, message: (e as Error).message });
        return [];
      }
    }),
  );
  if (input.source && errors.length) throw new OpsError("io", `Search on ${input.source} failed: ${errors[0].message}`, "Check the network connection, or try another source.");
  // Direct downloads first, curated (manual) packs after.
  const hits = results.flat().sort((a, b) => Number(!!a.manual) - Number(!!b.manual));
  return { hits, errors };
}

export async function searchAssets(input: SearchInput, fetchImpl: FetchLike): Promise<AssetHit[]> {
  return (await searchAssetsDetailed(input, fetchImpl)).hits;
}

export interface DownloadResult extends AssetEntry {
  // Every file written (the main one first).
  files: string[];
  // Ready-to-use scene snippet, e.g. { material: { map, normalMap, roughnessMap } }.
  suggestion?: Record<string, unknown>;
}

function substitute(v: unknown, map: (s: string) => string): unknown {
  if (typeof v === "string") return map(v);
  if (Array.isArray(v)) return v.map((x) => substitute(x, map));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, map)]));
  return v;
}

export async function downloadAsset(fs: ProjectFs, hit: AssetHit, fetchImpl: FetchLike, opts: { resolution?: string; name?: string; inflate?: InflateRaw } = {}): Promise<DownloadResult> {
  const source = SOURCES[hit?.source as SourceId];
  if (!hit || !source) throw new OpsError("invalid", "Pass an asset hit returned by assets_search (source, id, kind, downloads…).", `Sources: ${SOURCE_IDS.join(", ")}.`);
  if (hit.manual || !source.download || !Object.keys(hit.downloads ?? {}).length) {
    throw new OpsError(
      "invalid",
      `"${hit.title}" (${hit.source}) has no direct download.`,
      `Ask the user to download the pack from ${hit.pageUrl ?? "the source website"}, then import the zip: \`agent3d assets add <file.zip> --source ${hit.source} --license ${hit.license}\` (importAssetZip).`,
    );
  }
  let downloaded;
  try {
    downloaded = await source.download(hit, fetchImpl, { resolution: opts.resolution, inflate: opts.inflate });
  } catch (e) {
    if (e instanceof SourceError) throw new OpsError("io", `Download from ${hit.source} failed: ${e.message}`, "Retry, pick another resolution (1k, 2k) or another asset.");
    throw e;
  }
  const name = slugify(opts.name ?? hit.id, "asset");
  const dir = `assets/${KIND_DIR[hit.kind]}`;
  const names = Object.keys(downloaded.files);
  const single = names.length === 1;
  const target = (rel: string) => {
    if (single) {
      const ext = rel.includes(".") ? rel.slice(rel.lastIndexOf(".")) : "";
      return `${dir}/${name}${ext.toLowerCase()}`;
    }
    // Multi-file assets keep their relative layout inside <dir>/<name>/.
    const inner = rel.includes("/") ? rel.slice(rel.indexOf("/") + 1) : rel;
    return `${dir}/${name}/${inner}`;
  };
  const written: string[] = [];
  let mainEntry: AssetEntry | null = null;
  for (const rel of [downloaded.main, ...names.filter((n) => n !== downloaded.main)]) {
    const entry = await addAsset(fs, {
      path: target(rel),
      bytes: downloaded.files[rel],
      kind: rel === downloaded.main ? hit.kind : kindFromPath(rel),
      source: hit.source,
      sourceUrl: hit.pageUrl,
      license: hit.license,
      author: hit.author,
      attribution: hit.attribution,
    });
    written.push(entry.path);
    if (rel === downloaded.main) mainEntry = entry;
  }
  const suggestion = downloaded.suggestion ? (substitute(downloaded.suggestion, (s) => (s === "<path>" ? mainEntry!.path : downloaded.files[s] ? target(s) : s)) as Record<string, unknown>) : undefined;
  return { ...mainEntry!, files: written, ...(suggestion ? { suggestion } : {}) };
}

// ─── Zip import (Kenney / Quaternius packs, any zip of glTF files) ──────

export interface ImportZipOptions {
  name: string; // folder under assets/models/
  source: string;
  license: string;
  author?: string;
  sourceUrl?: string;
  attribution?: string;
  // Keep only entries whose path contains one of these words (case-insensitive).
  filter?: string[];
  inflate?: InflateRaw;
  maxFiles?: number;
}

const IMPORT_EXT = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2)$/i;

export async function importAssetZip(fs: ProjectFs, zip: Uint8Array, opts: ImportZipOptions): Promise<{ assets: AssetEntry[]; models: string[]; skipped: number }> {
  let files: Record<string, Uint8Array>;
  try {
    files = await readZip(zip, { inflate: opts.inflate, filter: (n) => IMPORT_EXT.test(n), maxBytes: 200 * 1024 * 1024 });
  } catch (e) {
    throw new OpsError("invalid", `Cannot read the zip: ${(e as Error).message}`, "Pass the original .zip downloaded from the pack page.");
  }
  let names = Object.keys(files);
  // Prefer GLB/glTF folders when a pack ships several formats.
  const words = (opts.filter ?? []).map((w) => w.toLowerCase()).filter(Boolean);
  const models = names.filter((n) => /\.(glb|gltf)$/i.test(n) && (!words.length || words.some((w) => n.toLowerCase().includes(w))));
  if (!models.length) throw new OpsError("invalid", "The zip contains no .glb / .gltf model" + (words.length ? ` matching ${words.join(", ")}` : "") + ".", "Kenney / Quaternius packs ship glTF in a 'GLB format' / 'glTF' folder; check the pack, or drop --filter.");
  const keepDirs = new Set(models.map((m) => (m.includes("/") ? m.slice(0, m.lastIndexOf("/") + 1) : "")));
  names = names.filter((n) => models.includes(n) || (!/\.(glb|gltf)$/i.test(n) && [...keepDirs].some((d) => n.startsWith(d) || n.includes("Textures") || n.includes("textures"))));
  const max = opts.maxFiles ?? 400;
  const skipped = Math.max(0, names.length - max);
  names = names.slice(0, max);
  const base = `assets/models/${slugify(opts.name, "pack")}`;
  const common = commonPrefix(names);
  const out: AssetEntry[] = [];
  for (const n of names) {
    const rel = n.slice(common.length).replace(/\s+/g, "-");
    out.push(await addAsset(fs, { path: `${base}/${rel}`, bytes: files[n], kind: kindFromPath(n), source: opts.source, license: opts.license, author: opts.author, sourceUrl: opts.sourceUrl, attribution: opts.attribution }));
  }
  return { assets: out, models: out.filter((a) => /\.(glb|gltf)$/i.test(a.path)).map((a) => a.path), skipped };
}

function commonPrefix(paths: string[]): string {
  if (!paths.length) return "";
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  const first = dirs[0];
  let i = 0;
  while (i < first.length && dirs.every((d) => d[i] === first[i])) i++;
  return i ? `${first.slice(0, i).join("/")}/` : "";
}

// ─── Built-in library ───────────────────────────────────────────────────

export function listLibrary(index: LibraryIndex, filter: { query?: string; kind?: AssetEntry["kind"]; limit?: number } = {}): { assets: (Pick<LibraryAsset, "id" | "kind" | "license" | "tags" | "description"> & { ref: string; kb: number; author?: string })[]; total: number } {
  let list = (index?.assets ?? []).filter((a) => !filter.kind || a.kind === filter.kind);
  if (filter.query?.trim()) {
    list = list
      .map((a) => ({ a, s: score(filter.query!, { id: a.id, title: a.id.replace(/[/-]/g, " "), tags: a.tags, extra: a.description }) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.a);
  }
  const total = list.length;
  return {
    total,
    assets: list.slice(0, filter.limit ?? 50).map((a) => ({ id: a.id, ref: `library:${a.id}`, kind: a.kind, license: a.license, ...(a.author ? { author: a.author } : {}), tags: a.tags, description: a.description, kb: KB(a.bytes) })),
  };
}
