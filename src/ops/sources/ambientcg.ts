// ambientCG (https://ambientcg.com) — CC0 PBR materials and HDRIs.
// Public API, no key: https://ambientcg.com/api/v2/full_json?type=Material&q=…&include=downloadData,previewData
// Downloads are zips (extracted with the pure-TS zip reader).

import { readZip } from "../zip";
import { fetchBytes, fetchJson, SourceError, type AssetHit, type AssetSource, type DownloadedFiles } from "./types";

const API = "https://ambientcg.com/api/v2/full_json";

interface AcgAsset {
  assetId: string;
  displayName?: string;
  dataType?: string;
  tags?: string[];
  shortLink?: string;
  previewImage?: Record<string, string>;
  downloadFolders?: Record<string, { downloadFiletypeCategories?: Record<string, { downloads?: { attribute: string; downloadLink?: string; fullDownloadPath?: string; fileName?: string; size?: number }[] }> }>;
}

function downloadsOf(a: AcgAsset): Record<string, string> {
  const out: Record<string, string> = {};
  for (const folder of Object.values(a.downloadFolders ?? {})) {
    for (const cat of Object.values(folder.downloadFiletypeCategories ?? {})) {
      for (const d of cat.downloads ?? []) {
        const url = d.downloadLink ?? d.fullDownloadPath;
        if (url && d.attribute) out[d.attribute] = url;
      }
    }
  }
  return out;
}

// "1k" → "1K-JPG" (materials) or "1K" (HDRIs); exact attribute names also work.
function pickDownload(downloads: Record<string, string>, resolution?: string): [string, string] {
  const keys = Object.keys(downloads);
  if (!keys.length) throw new SourceError("This ambientCG asset has no downloads.");
  const want = (resolution ?? "1k").toUpperCase();
  const exact = keys.find((k) => k.toUpperCase() === want);
  const pref = exact ?? keys.find((k) => k.toUpperCase() === `${want}-JPG`) ?? keys.find((k) => k.toUpperCase().startsWith(want)) ?? keys.find((k) => k.toUpperCase().startsWith("1K")) ?? keys[0];
  return [pref, downloads[pref]];
}

export const ambientcg: AssetSource = {
  id: "ambientcg",
  title: "ambientCG (CC0 PBR materials, HDRIs)",
  kinds: ["texture", "hdri"],
  async search(q, fetch) {
    if (q.kind && q.kind !== "texture" && q.kind !== "hdri") return [];
    const types = q.kind === "hdri" ? ["HDRI"] : q.kind === "texture" ? ["Material"] : ["Material", "HDRI"];
    const hits: AssetHit[] = [];
    for (const type of types) {
      const url = `${API}?type=${type}&q=${encodeURIComponent(q.query)}&include=downloadData,previewData&limit=${q.limit ?? 12}`;
      const data = await fetchJson<{ foundAssets?: AcgAsset[] }>(fetch, url);
      for (const a of data.foundAssets ?? []) {
        hits.push({
          source: "ambientcg",
          id: a.assetId,
          title: a.displayName ?? a.assetId,
          kind: type === "HDRI" ? "hdri" : "texture",
          license: "CC0-1.0",
          author: "ambientCG",
          previewUrl: a.previewImage?.["256-PNG"] ?? a.previewImage?.["128-PNG"],
          pageUrl: a.shortLink ?? `https://ambientcg.com/view?id=${a.assetId}`,
          tags: a.tags?.slice(0, 8),
          downloads: downloadsOf(a),
          note: type === "HDRI" ? "Zip with an .hdr/.exr environment map." : "Zip with Color / NormalGL / Roughness maps (extracted).",
        });
      }
    }
    return hits.slice(0, q.limit ?? 20);
  },
  async download(hit, fetch, opts): Promise<DownloadedFiles> {
    const [, url] = pickDownload(hit.downloads, opts.resolution);
    const bytes = await fetchBytes(fetch, url);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const id = hit.id;
    if (!isZip) {
      const name = url.split("?")[0].split("/").pop() || `${id}.bin`;
      return { files: { [name]: bytes }, main: name };
    }
    if (hit.kind === "hdri") {
      const files = await readZip(bytes, { inflate: opts.inflate, filter: (n) => /\.(hdr|exr)$/i.test(n) });
      const names = Object.keys(files).sort((a, b) => (a.endsWith(".hdr") ? -1 : 1) - (b.endsWith(".hdr") ? -1 : 1));
      if (!names.length) throw new SourceError(`ambientCG zip for ${id} contains no .hdr/.exr file.`);
      const main = names[0].split("/").pop()!;
      return { files: { [main]: files[names[0]] }, main };
    }
    const files = await readZip(bytes, { inflate: opts.inflate, filter: (n) => /_(Color|NormalGL|Roughness|AmbientOcclusion)\.(jpe?g|png|webp)$/i.test(n) });
    const out: Record<string, Uint8Array> = {};
    const material: Record<string, unknown> = {};
    for (const [name, data] of Object.entries(files)) {
      const base = name.split("/").pop()!;
      const rel = `${id}/${base}`;
      out[rel] = data;
      if (/_Color\./i.test(base)) material.map = rel;
      else if (/_NormalGL\./i.test(base)) material.normalMap = rel;
      else if (/_Roughness\./i.test(base)) material.roughnessMap = rel;
    }
    const main = (material.map as string) ?? Object.keys(out)[0];
    if (!main) throw new SourceError(`ambientCG zip for ${id} has no Color/NormalGL/Roughness maps.`);
    return { files: out, main, suggestion: { material } };
  },
};
