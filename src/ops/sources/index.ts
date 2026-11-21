import { ambientcg } from "./ambientcg";
import { kenney, quaternius } from "./curated";
import { khronos } from "./khronos";
import { polyhaven } from "./polyhaven";
import type { AssetSource, SourceId } from "./types";

export * from "./types";
export { KENNEY_PACKS, type CuratedPack } from "./kenneyIndex";
export { QUATERNIUS_PACKS } from "./quaterniusIndex";

export const SOURCES: Record<SourceId, AssetSource> = { polyhaven, ambientcg, kenney, quaternius, khronos };
