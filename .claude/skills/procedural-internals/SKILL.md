---
name: procedural-internals
description: Contributor notes for Agent3D procedural content — the generators (src/runtime/generators/, incl. character/, terrain, water + waterMaterial, trees, city, globe, galaxy, floatingIsland, birds, clouds, params.ts, geom.ts, the GENERATOR_IMPLS registry), the GLSL shader materials (src/runtime/shaders/), the WebAudio synth presets (src/runtime/audio/), the seeded RNG and noise (src/runtime/random.ts), and the bundled 3D-text fonts (library/fonts/ + scripts/build-fonts.mjs, convert-font.mjs, font-kerning.mjs). Invoke when adding or changing a generator, shader, sound preset or font, touching seeded randomness or noise, or fixing a catalog `cost` formula in this repository.
---

# Procedural content — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("Hard rules" 3 and 5, "Layout", "Builds", "Ownership boundaries") and [AGENTS.md](../../../AGENTS.md) ("The catalog is declared once", "Skills follow the code") first. Don't commit unless asked. The catalog entries and the registry types are contracts owned elsewhere: [`src/core/catalog.ts`](../../../src/core/catalog.ts) and [`src/runtime/registry.ts`](../../../src/runtime/registry.ts) change additively only, and you say so in your report. How objects are built, materials overridden and the player clocked: [`runtime-internals`](../runtime-internals/SKILL.md); validation, `check` budgets and `docs/catalog.md`: [`engine-internals`](../engine-internals/SKILL.md); templates and library assets: [`content-internals`](../content-internals/SKILL.md); the Studio font picker: [`studio-internals`](../studio-internals/SKILL.md).

## Where things live

| Piece | Implementation | Registered in | Tests |
|---|---|---|---|
| Generators (22) | one file per id in `src/runtime/generators/`; the character in `character.ts` + `character/` (`parts.ts` bone kit + skinning, `face.ts`, `humanoid.ts`, `mascots.ts`, `animate.ts`, `rig.ts` types) | `GENERATOR_IMPLS` in `generators/index.ts` | `generators.test.ts` (defaults, determinism, every enum option, terrain, maze, road…), `content.test.ts` (character, floatingIsland, globe, bars3d, crystals / galaxy / abstractShapes, water depth), `landscape.test.ts` (terrain shapes, scatter on snow / several terrains, road, birds), `water.test.ts` (reflections) |
| Param reader | `generators/params.ts`: `readParams`, `generatorParams(id, raw, ctx)`, `shaderParams` — falls back to the catalog default, clamps to `min`/`max`, rejects enum values not in `options` | also used by `build/textures.ts` and `build/rigs.ts` | through every generator test |
| Geometry helpers | `generators/geom.ts`: `MeshBuilder` (merged, vertex-coloured, one draw call), `jitter`, `shade`, `ramp`, `findGround`, `scatterPoint`, `vertexColorMaterial`, `disposeObject`, `built()` | — | `generators.test.ts` ("findGround") |
| Shared shading | `waterMaterial.ts` (water + terrain water, `attachReflection`, `reflectionScale(quality)`), `wind.ts` (foliage sway via `onBeforeCompile`) | — | `water.test.ts` |
| Shaders (17) | `src/runtime/shaders/index.ts` (7) + `extra.ts` (`EXTRA_SHADERS`, 10), built with `make()` from `common.ts` (`VERT`, `PALETTE_FN`, `OUT`, `colorsUniform`, `MAX_COLORS` = 6); GLSL snippets `noise.glsl.ts` (`GLSL_NOISE`), `meshGradient.glsl.ts` | `SHADER_IMPLS` | `shaders/shaders.test.ts`, `generators.test.ts` ("liquidChrome shader") |
| Sounds (12) | `src/runtime/audio/index.ts` presets over `synth.ts` (`voice`, `tone`, `noise`, `sequence`, `autoStop`, `stopVoice`, `midi`) | `SOUND_IMPLS` | `audio/audio.test.ts` (fake WebAudio graph) |
| RNG + noise | `src/runtime/random.ts`: `createRng` (sfc32 seeded by splitmix32), `hashSeed`, `noise2D/3D`, `fbm2D/3D`, `ridged2D` | used by `build/index.ts` (`rngFor`), `player.ts`, `game/index.ts`, `build/textures.ts` | `src/runtime/random.test.ts` |
| Fonts (13) | `library/fonts/<id>.typeface.json` + `library/fonts/LICENSES.md`; built by `scripts/build-fonts.mjs` (`FONTS` list) → `scripts/convert-font.mjs` (`CHARS`, `convertFile`) → `scripts/font-kerning.mjs` (`readSfntTables`, `gposKerning`, `kernTableKerning`) | catalog `FONTS`; `library/index.json` via `scripts/build-library.mjs` | `generators.test.ts` (accents), `registry.test.ts`, `build/text.test.ts` (kerning), `src/ops/check.test.ts` (per-glyph cost) |

Parity: `src/runtime/registry.test.ts` and the "catalog coverage" block of `generators.test.ts` fail when a catalog id has no implementation or an implementation has no catalog id (generators, shaders, sounds, fonts).

## Invariants and traps

**Determinism (rule 5)**

- A generator's randomness comes from `ctx.rng` only. `build/index.ts` hands it `createRng(def.seed ?? hashSeed(scene.seed ?? 1, def.id))`: same scene seed + same object id (or same object `seed`) → same geometry. No `Math.random`, `Date.now` or `performance.now` anywhere in generators / shaders (none today; no lint catches it — the determinism test does, by fingerprinting two builds).
- `update(t, dt)` must be a pure function of `t` (ignore `dt` for state, or recompute from `t`): renders seek to arbitrary times. Prefer animating in the vertex shader from a `uTime` uniform (trees, grass, clouds, galaxy, birds, water): zero CPU per frame and deterministic. Tests: "builds with default params, deterministically" (update at 1.25 s then fingerprint), character "is deterministic (pure function of t)", birds "a pure function of t", road "scrolls as a pure function of t".
- The order of `rng` calls is part of the output. Inserting an `rng.next()` before existing draws reshuffles every existing scene using that generator (templates' `preview.png`, recipe renders, README stills). Draw new randomness *after* the existing draws, or from a sub-RNG (`createRng(hashSeed(seed, "feature"))`).
- `random.ts` is shared with particles, behaviours and `api.random`: changing `createRng`, `hashSeed` or the fixed noise permutation (seed 1337) changes every scene. Don't, unless that is the point (and re-render the recipes, AGENTS.md "Skills follow the code").

**Params are validated by the catalog, read through `params.ts`**

- `validateScene` checks `params` against the catalog entry (types, ranges, enums, unknown names with "did you mean"); generator params containing `{data.` skip type checks (bound at run time, `bars3d` data). Never re-validate in the generator: read every value with `generatorParams(id, raw, ctx)`. Reading a name the catalog does not declare throws `<id>: no catalog param "<name>"`. The builder already merges defaults (`withDefaults` in `src/runtime/util.ts`), but the tests call impls with `{}`, so the reader's fallback matters.
- `numOrNull` distinguishes an explicit `null` ("no water": terrain `waterLevel`) from absent. Colours go through `ctx.color` (scene palette references), not `new THREE.Color` directly.
- A `material` field on the catalog entry is what makes an object-level `material` override legal (validation warns `ignored` otherwise). The override replaces the material of every mesh flagged `mesh.userData.materialTarget = true`; keep the flag on the meshes the entry's `material` text describes.

**Costs must match real output**

- `check` estimates triangles from the catalog `cost` formula (`evalCost` in `src/ops/budget.ts`: numbers, param names, `+ - * / ^`, `min()` / `max()`, `~` ignored; booleans are 0 / 1, an enum sets `<name>_<option>` to 1, array params give their length and `<name>Cells`). [`cost.test.ts`](../../../src/runtime/generators/cost.test.ts) builds every generator at its defaults, with each other enum option, each flipped boolean and the size-driving params raised (`SCALE`), and fails when the formula is off by more than ×0.6–×1.6 (triangles + points + line segments, via `primitives()` from `generators.test.ts`). When a style or option changes the mesh a lot, weigh it in the formula (`character`, `trees`, `bars3d`, `waveGrid`) rather than widening the tolerance. After a render, measured runtime stats win over the estimate, so a wrong formula only misleads agents before their first render.
- Text cost is per font: `TRIS_PER_GLYPH_SEGMENT` in `budget.ts`, measured on "Hamburgefonstiv ABCDEFGHIJ" (`check.test.ts` "estimates text per glyph like the runtime", 10 % tolerance). A new font without an entry falls back to 12.

**Performance and bundling**

- One draw call per material, not per item: stamp copies into `MeshBuilder` (rocks, trees, city, clouds) or use one `InstancedMesh` (grass, birds, globe dots). Character = 1–3 skinned meshes (`parts.ts`), whatever the accessories. `birds` test asserts one instanced draw call.
- Costly optional features read `ctx.quality` (absent = high): water reflections are off on `low`, half resolution on `medium` (`reflectionScale`).
- `generators/index.ts` and `shaders/index.ts` are lazy chunks (`loadGenerators` / `loadShaders` in `build/context.ts`; sounds load from `game/audio.ts`). Never import a generator, `generators/index.ts` or `shaders/index.ts` statically from runtime core: it moves the whole area into `agent3d-runtime.js`. Only `params.ts` and the `*.glsl.ts` snippets (`meshGradient.glsl.ts` in `build/environment.ts`) are shared statically; keep them light.
- Return `built(group, { update, heightAt })`: its `dispose` frees geometries, materials and textures. Canvas is unavailable headless in tests: build textures as `DataTexture` (city windows).

**Build order and siblings**

- Within a parent, generators with id `terrain` are built first (`build/index.ts`), then everything else in parallel; `ctx.siblings` holds what is built. A new ground-like generator exposing `heightAt` is *not* built first: scatterers declared next to it may not see it. `findGround` ranks siblings by footprint (`userData.size`) and `userData.surface` (`"terrain"` first, `"water"` ignored); `userData.waterLevel` / `snowLevel` steer `scatterPoint`. `floatingIsland` plants the sibling generators itself with a private `siblings` map.

**Shaders and sounds**

- Every shader material has `uTime` advanced by `update(t)` and is a `THREE.ShaderMaterial` (`shaders.test.ts` checks both for every id). `make(id, fragment, bind, names)`: `names` maps catalog param → uniform for `material.userData.setParam` (the timeline animating `uniforms.progress` of `dissolve`); a param missing from `names` cannot be animated. `colors` arrays are capped at `MAX_COLORS` and mutated in place. End fragments with `${OUT}` (tone mapping + colour space) or the shader ignores the renderer's exposure.
- Sounds are zero-byte synthesis. `audio.test.ts` plays and stops every preset on a fake context that only implements gain, oscillator, biquad filter, buffer source, delay and `createBuffer`: a preset using another node type fails there (extend `fakeContext` deliberately). Music presets must loop until `stop()`.

**Fonts**

- Every catalog font needs `library/fonts/<id>.typeface.json` with the French accents tested in `generators.test.ts` (`CHARS` in `convert-font.mjs` keeps Latin-1 + € Œ œ …) and kerning pairs (`text.test.ts`, mono excepted). Fonts whose OFL declares a Reserved Font Name get a neutral `family` (`rfn` in `build-fonts.mjs`: "A3D Serif", "A3D Script Bold").
- `build-fonts.mjs` is the only code that downloads anything (once, into `.agent3d-tmp/fonts-src`); it needs opentype.js passed as `--opentype <opentype.module.js>` (not a dependency: `npm pack opentype.js@1.3.4`).

## How to add a generator

1. `src/core/catalog.ts` `GENERATORS`: id, description an agent can choose from, params with the `n/i/b/c/cs/v3/e` helpers (types, ranges, defaults), `cost` formula, and `material` if an override makes sense. Additive contract change: report it.
2. `src/runtime/generators/<id>.ts`: `export const <id>: GeneratorImpl = (raw, ctx) => { const p = generatorParams("<id>", raw, ctx); … return built(group, { update }); }` — `ctx.rng` only, `MeshBuilder` / instancing, `update` pure in `t`, `materialTarget` flags, `ctx.quality` for costly options, `onTerrain` through `findGround` + `scatterPoint` if it scatters.
3. Register it in `GENERATOR_IMPLS` (`generators/index.ts`).
4. Tests: the generic ones run automatically (defaults, determinism, every enum option with `count: 20, resolution: 16`); add specific ones in `content.test.ts` or `landscape.test.ts` (shape, data, pointer hooks), and make `cost.test.ts` pass (add the param that drives the count to `SCALE` if it has a new name). Generators building only points or lines must be added to the `["starfield", "waveGrid", "galaxy"]` exception.
5. `UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts` (regenerates `docs/catalog.md`).
6. Mention it where agents choose content (`plugin/skills/agent3d-create/references/art-direction.md` or a validated, rendered scene in `recipes.md`), never with its full param list; maybe a template (`templates/<id>/`, see `content-internals`).

## How to add a shader

1. Catalog `SHADERS` entry (params; `colors` for palettes).
2. A `make("<id>", fragment, bind, names, opts?)` in `shaders/extra.ts` (add it to `EXTRA_SHADERS`) or `index.ts` (`SHADER_IMPLS`); use `uTime`, `PALETTE_FN` / `colorsUniform`, `GLSL_NOISE`, end with `${OUT}`; list every animatable param in `names`.
3. `npx vitest run src/runtime/shaders src/runtime/registry.test.ts`, regenerate `docs/catalog.md`, look at it in a real render (`agent3d render`: the tests never compile GLSL).

## How to add a sound preset

1. Catalog `SOUND_PRESETS` entry (no params). 2. A `SoundImpl` in `audio/index.ts` — `sfx(duration, v => tone/noise…)` for one-shots, a `play` returning `{ stop: () => stopVoice(v, …) }` with `sequence` for loops — added to `SOUND_IMPLS` (quote hyphenated ids). 3. `npx vitest run src/runtime/audio`, regenerate `docs/catalog.md`.

## How to add a font

1. Check the licence (OFL / Apache, embedding and subsetting allowed; note any Reserved Font Name). 2. Add `{ id, family, url | ...fontsource(pkg, weight), rfn? }` to `FONTS` in `scripts/build-fonts.mjs`; run `node scripts/build-fonts.mjs --opentype <opentype.module.js> --only <id>` and check the reported kern pairs and `missing:` glyphs. 3. Add its row to `library/fonts/LICENSES.md` (`build-library.mjs` reads author / licence from it), then `node scripts/build-library.mjs` (`--check` verifies). 4. Catalog `FONTS` entry, label in `src/studio/components/FontPicker.tsx` (`LABELS`), measured `TRIS_PER_GLYPH_SEGMENT` in `src/ops/budget.ts`. 5. Regenerate `docs/catalog.md`; `npx vitest run src/runtime/build/text.test.ts src/ops/check.test.ts`.

## Checks before handing over

```bash
npm run typecheck
npx vitest run src/runtime/generators src/runtime/shaders src/runtime/audio src/runtime/random.test.ts src/runtime/registry.test.ts
npx vitest run src/runtime/build/text.test.ts src/ops/check.test.ts src/ops/docs.test.ts src/ops/templates.content.test.ts
node scripts/build-library.mjs --check      # after a font change
npm test
```

Looks changed (palette, lighting response, motion)? Re-render the affected recipes and templates and look at the images (AGENTS.md); don't run `npm run build` while other agents test against `dist/`.
