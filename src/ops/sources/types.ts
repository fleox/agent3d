// Asset sources: free, account-less CC0 / CC-BY libraries searched by
// `agent3d assets search` and downloaded once into the project by
// `assets add`. Network goes only through the injected fetch.

import type { AssetEntry } from "../../core/types";
import type { InflateRaw } from "../zip";

export type SourceId = "polyhaven" | "ambientcg" | "kenney" | "quaternius" | "khronos";
export const SOURCE_IDS: readonly SourceId[] = ["polyhaven", "ambientcg", "kenney", "quaternius", "khronos"];

export type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

export interface AssetHit {
  source: SourceId;
  id: string;
  title: string;
  kind: AssetEntry["kind"];
  license: string; // SPDX-like: "CC0-1.0", "CC-BY-4.0"
  author?: string;
  attribution?: string;
  previewUrl?: string;
  pageUrl?: string;
  tags?: string[];
  // resolution / format → URL. Empty when the source has no direct download
  // (Kenney, Quaternius): download the pack by hand and import the zip.
  downloads: Record<string, string>;
  manual?: boolean;
  note?: string;
}

export interface SearchQuery {
  query: string;
  kind?: AssetEntry["kind"];
  limit?: number;
}

// What a source download produces: files relative to the asset folder, and the main one.
export interface DownloadedFiles {
  files: Record<string, Uint8Array>;
  main: string;
  // Ready-to-paste scene snippet (e.g. a material using the texture set).
  suggestion?: Record<string, unknown>;
}

export interface DownloadOptions {
  resolution?: string;
  inflate?: InflateRaw;
}

export interface AssetSource {
  id: SourceId;
  title: string;
  kinds: AssetEntry["kind"][];
  search(q: SearchQuery, fetch: FetchLike): Promise<AssetHit[]>;
  download?(hit: AssetHit, fetch: FetchLike, opts: DownloadOptions): Promise<DownloadedFiles>;
}

export class SourceError extends Error {
  override name = "SourceError";
}

export async function fetchJson<T>(fetch: FetchLike, url: string): Promise<T> {
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new SourceError(`Network error for ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new SourceError(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function fetchBytes(fetch: FetchLike, url: string): Promise<Uint8Array> {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new SourceError(`Network error for ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new SourceError(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Relevance score of a text against query words (0 = no match).
export function score(query: string, fields: { title?: string; id?: string; tags?: string[]; extra?: string }): number {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return 1;
  const title = `${fields.title ?? ""} ${fields.id ?? ""}`.toLowerCase();
  const tags = (fields.tags ?? []).map((t) => t.toLowerCase());
  const extra = (fields.extra ?? "").toLowerCase();
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (title.split(/[\s_-]+/).includes(w)) s = 5;
    else if (title.includes(w)) s = 3;
    if (tags.includes(w)) s = Math.max(s, 4);
    else if (tags.some((t) => t.includes(w))) s = Math.max(s, 2);
    if (!s && extra.includes(w)) s = 1;
    if (!s) return 0; // every word must match somewhere
    total += s;
  }
  return total;
}

export function rank<T>(items: { item: T; score: number }[], limit: number): T[] {
  return items
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}
