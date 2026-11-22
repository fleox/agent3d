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

// Levenshtein distance ≤ 1 (one insertion, deletion or substitution).
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

// Relevance score of a text against query words (0 = no match). Per word:
// exact title/id word 5 > exact tag 4 > title prefix 3 > tag prefix 2 >
// fuzzy (one typo, words ≥ 4 letters) or description prefix 1. Every word
// must match somewhere. `strict` ignores the description (`extra`): sources
// with rich prose descriptions (Poly Haven) otherwise rank a chair "with a warm
// oak frame" for "oak".
export function score(query: string, fields: { title?: string; id?: string; tags?: string[]; extra?: string }, opts: { strict?: boolean } = {}): number {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!words.length) return 1;
  const title = `${fields.title ?? ""} ${fields.id ?? ""}`.toLowerCase();
  const tags = (fields.tags ?? []).map((t) => t.toLowerCase());
  const extra = opts.strict ? "" : (fields.extra ?? "").toLowerCase();
  let total = 0;
  const titleWords = title.split(/[\s_\-/]+/).filter(Boolean);
  const tagWords = tags.flatMap((t) => t.split(/[\s_\-/]+/)).filter(Boolean);
  const extraWords = extra.split(/[^a-z0-9]+/).filter(Boolean);
  for (const raw of words) {
    const w = singular(raw);
    const eq = (t: string) => t === raw || singular(t) === w;
    let s = 0;
    if (titleWords.some(eq)) s = 5;
    else if (titleWords.some((t) => t.startsWith(w))) s = 3;
    if (tags.some(eq)) s = Math.max(s, 4);
    else if (tagWords.some((t) => eq(t) || t.startsWith(w))) s = Math.max(s, 2);
    if (!s && w.length >= 4 && [...titleWords, ...tagWords].some((t) => t.length >= 4 && nearlyEqual(singular(t), w))) s = 1;
    if (!s && extraWords.some((t) => t.startsWith(w))) s = 1;
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
