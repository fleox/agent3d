import { describe, expect, it } from "vitest";
import { GENERATORS, type CatalogEntry } from "../../core/catalog";
import type { ObjectDef } from "../../core/types";
import { objectTriangles } from "../../ops/budget";
import { GENERATOR_IMPLS } from "./index";
import { makeCtx, primitives } from "./generators.test";

// The catalog `cost` formula of a generator is what `check` budgets without a
// render (src/ops/budget.ts). It must stay close to what the generator really
// builds: for the defaults, for every enum option / flipped boolean, and when
// the size-driving numbers grow. Points and line segments count as primitives.
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.6;

// Numeric params that drive the primitive count, with the value to try.
const SCALE: Record<string, number | unknown[]> = {
  count: 3,
  resolution: 48,
  blocks: 10,
  columns: 24,
  rows: 16,
  detail: 4,
  dots: 4000,
  length: 120,
  size: 15,
  trees: 30,
  grass: 4000,
  flowers: 150,
  data: [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [2, 4, 6, 8],
  ],
};

function variants(entry: CatalogEntry): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{}];
  for (const p of entry.params) {
    if (p.type === "enum") for (const opt of p.options ?? []) if (opt !== p.default) out.push({ [p.name]: opt });
    if (p.type === "boolean") out.push({ [p.name]: !p.default });
    const scaled = SCALE[p.name];
    if (scaled !== undefined && (Array.isArray(scaled) ? p.type === "array" : p.type === "number" || p.type === "integer")) {
      // count: relative (×3), others absolute.
      let v = p.name === "count" && typeof p.default === "number" ? Math.round(p.default * 3) : scaled;
      if (typeof v === "number") v = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
      out.push({ [p.name]: v });
    }
  }
  return out;
}

describe("generator cost formulas match what the generators build", () => {
  for (const entry of GENERATORS) {
    it(entry.id, async () => {
      expect(entry.cost, `${entry.id} has no cost formula`).toBeTruthy();
      const misses: string[] = [];
      for (const params of variants(entry)) {
        const built = await GENERATOR_IMPLS[entry.id]!(params, makeCtx(5));
        const p = primitives(built.object);
        const actual = p.triangles + p.points + p.lines;
        const estimate = objectTriangles({ id: "g", kind: "generator", generator: entry.id, params } as unknown as ObjectDef);
        const ratio = estimate > 0 ? actual / estimate : Infinity;
        if (ratio < MIN_RATIO || ratio > MAX_RATIO) misses.push(`${JSON.stringify(params)}: built ${Math.round(actual)}, cost "${entry.cost}" = ${estimate} (×${ratio.toFixed(2)})`);
        built.dispose?.();
      }
      expect(misses, `${entry.id}\n${misses.join("\n")}`).toEqual([]);
    });
  }
});
