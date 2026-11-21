// Khronos glTF-Sample-Assets (https://github.com/KhronosGroup/glTF-Sample-Assets).
// Index: raw.githubusercontent.com/…/Models/model-index.json; licences per
// model in Models/<name>/metadata.json. Only models whose every licence is
// CC0-1.0 or CC-BY-4.0 are returned (attribution recorded for CC-BY).

import { fetchBytes, fetchJson, rank, score, SourceError, type AssetHit, type AssetSource, type DownloadedFiles } from "./types";

const RAW = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";
const ALLOWED = new Set(["CC0-1.0", "CC-BY-4.0"]);

interface IndexEntry {
  label: string;
  name: string;
  screenshot?: string;
  tags?: string[];
  variants?: Record<string, string>;
}

interface Metadata {
  legal?: { license?: string; artist?: string; owner?: string; what?: string; year?: string }[];
  summary?: string;
}

export const khronos: AssetSource = {
  id: "khronos",
  title: "Khronos glTF sample models (CC0 / CC-BY only)",
  kinds: ["model"],
  async search(q, fetch) {
    if (q.kind && q.kind !== "model") return [];
    const index = await fetchJson<IndexEntry[]>(fetch, `${RAW}/model-index.json`);
    const candidates = rank(
      index.filter((m) => m.variants?.["glTF-Binary"]).map((m) => ({ item: m, score: score(q.query, { title: m.label, id: m.name, tags: m.tags }) })),
      Math.min(30, (q.limit ?? 10) * 2),
    );
    const hits: AssetHit[] = [];
    await Promise.all(
      candidates.map(async (m) => {
        let meta: Metadata;
        try {
          meta = await fetchJson<Metadata>(fetch, `${RAW}/${m.name}/metadata.json`);
        } catch {
          return;
        }
        const legal = meta.legal ?? [];
        if (!legal.length || !legal.every((l) => l.license && ALLOWED.has(l.license))) return;
        const ccby = legal.some((l) => l.license === "CC-BY-4.0");
        const authors = [...new Set(legal.map((l) => l.artist).filter(Boolean))] as string[];
        hits.push({
          source: "khronos",
          id: m.name,
          title: m.label,
          kind: "model",
          license: ccby ? "CC-BY-4.0" : "CC0-1.0",
          author: authors.join(", ") || undefined,
          ...(ccby ? { attribution: `"${m.label}" — ${legal.map((l) => `${l.what ?? "model"} by ${l.artist ?? l.owner ?? "unknown"} (${l.license})`).join("; ")}. Source: Khronos glTF-Sample-Assets.` } : {}),
          previewUrl: m.screenshot ? `${RAW}/${m.name}/${m.screenshot}` : undefined,
          pageUrl: `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/${m.name}`,
          tags: m.tags,
          downloads: { glb: `${RAW}/${m.name}/glTF-Binary/${m.variants!["glTF-Binary"]}` },
          note: meta.summary,
        });
      }),
    );
    const order = new Map(candidates.map((c, i) => [c.name, i]));
    return hits.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).slice(0, q.limit ?? 10);
  },
  async download(hit, fetch): Promise<DownloadedFiles> {
    const url = hit.downloads.glb;
    if (!url) throw new SourceError(`Khronos model ${hit.id} has no .glb download.`);
    const name = `${hit.id}.glb`;
    return { files: { [name]: await fetchBytes(fetch, url) }, main: name };
  },
};
