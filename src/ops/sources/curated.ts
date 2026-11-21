// Search over the curated Kenney / Quaternius pack indexes (no network).

import { KENNEY_PACKS, type CuratedPack } from "./kenneyIndex";
import { QUATERNIUS_PACKS } from "./quaterniusIndex";
import { rank, score, type AssetHit, type AssetSource } from "./types";

function curatedSource(id: "kenney" | "quaternius", title: string, packs: CuratedPack[], author: string): AssetSource {
  return {
    id,
    title,
    kinds: ["model"],
    async search(q) {
      if (q.kind && q.kind !== "model") return [];
      return rank(
        packs.map((p) => ({
          score: score(q.query, { id: p.id, title: p.title, tags: p.tags, extra: p.description }),
          item: {
            source: id,
            id: p.id,
            title: `${p.title} (pack)`,
            kind: "model",
            license: "CC0-1.0",
            author,
            pageUrl: p.pageUrl,
            tags: p.tags,
            downloads: {},
            manual: true,
            note: `${p.description} No direct download: ask the user to download the pack zip from ${p.downloadPage ?? p.pageUrl}, then import it with \`agent3d assets add <file.zip> --source ${id}\` (only .glb/.gltf + textures are extracted; use --filter <word> to keep a few models).`,
          } satisfies AssetHit,
        })),
        q.limit ?? 10,
      );
    },
  };
}

export const kenney = curatedSource("kenney", "Kenney (CC0 3D packs, curated index — manual zip download)", KENNEY_PACKS, "Kenney");
export const quaternius = curatedSource("quaternius", "Quaternius (CC0 3D packs, curated index — manual zip download)", QUATERNIUS_PACKS, "Quaternius");
