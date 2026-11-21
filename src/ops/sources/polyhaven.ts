// Poly Haven (https://polyhaven.com) — CC0 HDRIs, PBR textures and models.
// Public API, no key: https://api.polyhaven.com/assets?t=hdris|textures|models
// and https://api.polyhaven.com/files/<id>.

import type { AssetEntry } from "../../core/types";
import { fetchBytes, fetchJson, rank, score, SourceError, type AssetHit, type AssetSource, type DownloadedFiles } from "./types";

const API = "https://api.polyhaven.com";
const TYPES: Partial<Record<AssetEntry["kind"], string>> = { hdri: "hdris", texture: "textures", model: "models" };
const RESOLUTIONS = ["1k", "2k", "4k"];

interface PhAsset {
  name: string;
  type: number; // 0 hdri, 1 texture, 2 model
  categories?: string[];
  tags?: string[];
  authors?: Record<string, string>;
  description?: string;
}

type FileLeaf = { url: string; size?: number; include?: Record<string, { url: string }> };
type PhFiles = Record<string, Record<string, Record<string, FileLeaf>>>;

const kindOfType = (t: number): AssetEntry["kind"] => (t === 0 ? "hdri" : t === 1 ? "texture" : "model");

export const polyhaven: AssetSource = {
  id: "polyhaven",
  title: "Poly Haven (CC0 HDRIs, textures, models)",
  kinds: ["hdri", "texture", "model"],
  async search(q, fetch) {
    const kinds = q.kind ? [q.kind] : (["hdri", "texture", "model"] as const);
    const results: { item: AssetHit; score: number }[] = [];
    for (const kind of kinds) {
      const t = TYPES[kind];
      if (!t) continue;
      const list = await fetchJson<Record<string, PhAsset>>(fetch, `${API}/assets?t=${t}`);
      for (const [id, a] of Object.entries(list)) {
        const s = score(q.query, { id, title: a.name, tags: [...(a.tags ?? []), ...(a.categories ?? [])], extra: a.description });
        if (!s) continue;
        const k = kindOfType(a.type ?? (kind === "hdri" ? 0 : kind === "texture" ? 1 : 2));
        results.push({
          score: s,
          item: {
            source: "polyhaven",
            id,
            title: a.name,
            kind: k,
            license: "CC0-1.0",
            author: Object.keys(a.authors ?? {}).join(", ") || undefined,
            previewUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256`,
            pageUrl: `https://polyhaven.com/a/${id}`,
            tags: a.tags?.slice(0, 8),
            downloads: Object.fromEntries(RESOLUTIONS.map((r) => [r, `${API}/files/${id}`])),
            note: k === "texture" ? "Downloads diffuse + normal (GL) + roughness maps." : k === "model" ? "Downloads a .gltf with its .bin and textures." : "Downloads an .hdr environment map.",
          },
        });
      }
    }
    return rank(results, q.limit ?? 20);
  },
  async download(hit, fetch, opts): Promise<DownloadedFiles> {
    const res = (opts.resolution ?? "1k").toLowerCase();
    const files = await fetchJson<PhFiles>(fetch, `${API}/files/${encodeURIComponent(hit.id)}`);
    const pick = (map: string, fmt: string): FileLeaf => {
      const byRes = files[map];
      const leaf = byRes?.[res]?.[fmt] ?? byRes?.["1k"]?.[fmt];
      if (!leaf) throw new SourceError(`Poly Haven "${hit.id}" has no ${map} ${fmt} at ${res} (available: ${Object.keys(byRes ?? {}).join(", ") || "none"}).`);
      return leaf;
    };
    if (hit.kind === "hdri") {
      const leaf = pick("hdri", "hdr");
      const name = `${hit.id}_${res}.hdr`;
      return { files: { [name]: await fetchBytes(fetch, leaf.url) }, main: name, suggestion: { environment: { lighting: { hdri: `<path>` }, background: { hdri: `<path>`, blur: 0.5 } } } };
    }
    if (hit.kind === "texture") {
      const out: Record<string, Uint8Array> = {};
      const maps: [string, string, string][] = [
        ["Diffuse", "diff", "map"],
        ["nor_gl", "nor_gl", "normalMap"],
        ["Rough", "rough", "roughnessMap"],
      ];
      const material: Record<string, unknown> = {};
      for (const [key, suffix, prop] of maps) {
        if (!files[key]) continue;
        const name = `${hit.id}/${hit.id}_${suffix}_${res}.jpg`;
        out[name] = await fetchBytes(fetch, pick(key, "jpg").url);
        material[prop] = name;
      }
      const main = (material.map as string) ?? Object.keys(out)[0];
      if (!main) throw new SourceError(`Poly Haven "${hit.id}" has no downloadable texture maps.`);
      return { files: out, main, suggestion: { material } };
    }
    const gltf = pick("gltf", "gltf");
    const dir = `${hit.id}/`;
    const out: Record<string, Uint8Array> = { [`${dir}${hit.id}_${res}.gltf`]: await fetchBytes(fetch, gltf.url) };
    for (const [rel, leaf] of Object.entries(gltf.include ?? {})) {
      if (rel.split("/").includes("..")) continue;
      out[`${dir}${rel}`] = await fetchBytes(fetch, leaf.url);
    }
    return { files: out, main: `${dir}${hit.id}_${res}.gltf` };
  },
};
