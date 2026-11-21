// Every catalog id must have a runtime implementation (and vice versa).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../core/catalog";
import { SOUND_IMPLS } from "./audio/index";
import { BEHAVIOUR_IMPLS } from "./behaviours/index";
import { GEOMETRY_IMPLS, buildGeometry } from "./build/geometry";
import { resolveMaterialDef } from "./build/materials";
import { GENERATOR_IMPLS } from "./generators/index";
import { PARTICLE_PRESET_PARAMS } from "./particles/index";
import { POSTFX_IMPLS } from "./postfx/index";
import { SHADER_IMPLS } from "./shaders/index";

const ids = (list: readonly { id: string }[]) => list.map((x) => x.id).sort();
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("runtime registries match the catalog", () => {
  const cases: [string, readonly { id: string }[], Record<string, unknown>][] = [
    ["geometries", CATALOG.geometries, GEOMETRY_IMPLS],
    ["behaviours", CATALOG.behaviours, BEHAVIOUR_IMPLS],
    ["particlePresets", CATALOG.particlePresets, PARTICLE_PRESET_PARAMS],
    ["postfx", CATALOG.postfx, POSTFX_IMPLS],
    ["generators", CATALOG.generators, GENERATOR_IMPLS],
    ["shaders", CATALOG.shaders, SHADER_IMPLS],
    ["sounds", CATALOG.sounds, SOUND_IMPLS],
  ];
  for (const [name, catalog, impls] of cases) {
    it(`${name}: every id is implemented, no extra implementation`, () => {
      expect(Object.keys(impls).sort()).toEqual(ids(catalog));
    });
  }

  it("material presets resolve to a known material type", () => {
    const types = ["standard", "physical", "basic", "lambert", "toon", "normal", "matcap", "gradient", "shader"];
    for (const p of CATALOG.materialPresets) {
      const def = resolveMaterialDef({ preset: p.id });
      expect(types, p.id).toContain(def.type);
    }
  });

  it("every catalog geometry builds with its defaults", () => {
    for (const g of CATALOG.geometries) {
      const params: Record<string, unknown> = {};
      for (const p of g.params) if (p.required) params[p.name] = p.name === "points" && g.id === "tube" ? [[0, 0, 0], [1, 1, 0], [2, 0, 0]] : [[0, 0], [0.5, 0.2], [0.3, 0.8]];
      const geo = buildGeometry({ type: g.id as never, ...params });
      expect(geo.getAttribute("position").count, g.id).toBeGreaterThan(0);
    }
  });

  it("every catalog font ships in library/fonts", () => {
    for (const f of CATALOG.fonts) expect(existsSync(join(root, "library", "fonts", `${f.id}.typeface.json`)), f.id).toBe(true);
  });
});
