---
name: engine-internals
description: Contributor notes for the Agent3D engine — the SceneDoc contract and SCENE_VERSION (src/core/types.ts), the catalog and its params / cost formulas (src/core/catalog.ts), validation (validate.ts, validateMotion.ts), json paths, eases, postfx looks / tiers / GPU cost, the library index, MemoryFs, and src/ops/ (project + starters, scene apply / patch / diff, objects / tree, timeline, check + budget + postfxCheck + scriptLint + framing, assets + sources with injected fetch, optimize, templates, export + framework wrappers + runtime chunks + zip, docs/catalog.md generation) and the AI tool catalog (src/ai/). Invoke when adding or changing a catalog entry, a scene field, a validation or check rule, an export file, an asset source, an op or an AI tool in this repository.
---

# Engine (core, ops, AI tools) — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("Hard rules", "Ops", "Export format", "AI tools", "Ownership boundaries") and [AGENTS.md](../../../AGENTS.md) ("The catalog is declared once", "The scene format is a contract") first. Don't commit unless asked. `src/core/types.ts`, `src/core/catalog.ts` are contracts: additive changes only, and say so in your report. For the player and registries see [`runtime-internals`](../runtime-internals/SKILL.md); generators / shaders / audio see [`procedural-internals`](../procedural-internals/SKILL.md); commands, MCP, skills and Hermes see [`agent-cli-internals`](../agent-cli-internals/SKILL.md); the inspector see [`studio-internals`](../studio-internals/SKILL.md); templates and the library see [`content-internals`](../content-internals/SKILL.md).

## Where things live

| Concern | Code | Tests |
|---|---|---|
| Scene format | `src/core/types.ts` (`SceneDoc`, `SCENE_VERSION = 1`, `Issue`, `AssetEntry`) | typecheck |
| Catalog | `src/core/catalog.ts`: `ParamSpec`, `CatalogEntry { id, description, params, cost?, example?, material?, gpu?, details? }`, `CATALOG` (12 sections), `catalogEntry()`, `materialPreset()` | `src/runtime/registry.test.ts`, `src/runtime/build/lookdev.test.ts` |
| Validation | `src/core/validate.ts` (`validateScene`, `normalizeScene`, `defaultScene`, key lists `SCENE_KEYS`, `OBJECT_KEYS`, `TARGET_KEYS`, `CAMERA_KEYS`, `ENV_KEYS`, `LIGHT_KEYS`, `MATERIAL_KEYS`, `BODY_KEYS`…, class `V`), `validateMotion.ts` (timeline / interactions / shots, `TIMELINE_KEYS`, `TRACK_KEYS`, `SHOT_TYPES`), `suggest.ts` (`closest`, `didYouMean`) | `src/core/validate*.test.ts`, `validateMotion.test.ts`, `validatePhysics.test.ts` |
| Paths, eases, postfx | `src/core/jsonPath.ts` (`parsePath`, `getAt`, `setAt`, `mergePatch`, `deepEqual`), `ease.ts` (`parseEase`, `EASE_NAMES`), `postfx.ts` (`expandPostFx`, `qualitySettings`, `activePostFx`, `postfxCost`, `gpuCost`) | `src/ops/scene.test.ts`, `src/core/postfx.test.ts` |
| Project / scene | `src/ops/project.ts` (`createProject`, `saveScene`, `readSceneFile`), `starters.ts` (`starterScene`, `STARTER_GAME_SCRIPT`), `scene.ts` (`diffScenes`, `applyScene`, `applyPatchOps`, `patchScene`, `PATCH_OPS`, `replacedCollections`), `tree.ts`, `objects.ts`, `timeline.ts` | `src/ops/scene.test.ts`, `timeline.test.ts` |
| Check | `src/ops/check.ts` (`checkProject`, `framingIssues`, `drawCallCauses`), `budget.ts` (`evalCost`, `estimateTriangles`, `frameTriangles`, `TRIANGLE_AIM`, `TRIANGLE_LIMIT`, `DRAW_CALL_LIMIT`), `postfxCheck.ts`, `scriptLint.ts` (`FORBIDDEN`, `lintScript`), `refs.ts` (`visitAssetRefs`, `collectAssetRefs`), `gltf.ts` | `src/ops/check.test.ts` |
| Assets | `src/ops/assets.ts`, `sources/` (`types.ts`: `SourceId`, `SOURCE_IDS`, `AssetSource`, `FetchLike`, `fetchJson`, `fetchBytes`, `score`, `rank`; `index.ts`: `SOURCES`), `zip.ts` | `src/ops/assets.test.ts` (`stubFetch`), `zip.test.ts` |
| Optimize | `src/ops/optimize.ts` (`ImageCodec` injected), `optimizeSizing.ts` (`planTextureSizes`, `TEXTURE_TIERS`), `optimizeGlb.ts` (lazy `meshoptimizer`) | `optimize.test.ts`, `optimizeGlb.test.ts` |
| Export | `src/ops/export.ts` (`buildExport`, `sri`, `staticImports`), `exportFrameworks.ts` (`reactWrapper`, `vueWrapper`, `svelteWrapper`, `ELEMENT_DTS`, `embedGuide`), `runtimeChunks.ts` (`CHUNK_FEATURES`, `pageRuntime`, `needsGameChunk`) | `src/ops/export.test.ts` |
| Templates, docs | `src/ops/templates.ts`, `docs.ts` (`renderCatalogMarkdown`) | `templates.content.test.ts`, `docs.test.ts` |
| AI tools | `src/ai/tools.ts` (`ORDER`, `AI_TOOLS`, `listAiTools`, `callAiTool`), `sceneTools.ts` (`SCENE_TOOLS`), `assetTools.ts` (`ASSET_TOOLS`, `RENDER_TOOL`), `shared.ts` (`checkInput`, `mutationResult`, `compactIssues`), `types.ts` (`AiTool`, `ToolContext`, `ToolHost`) | `src/ai/tools.test.ts` |

## Invariants and traps

**Catalog**

- Param `type` drives both validation (`V.param`) and the Studio controls (`src/studio/inspector/` reuses `ParamSpec`). `default`, `min`, `max`, `options`, `required` are enforced by `validateScene`; an unknown param is an `unknown-param` warning with a "did you mean" (geometry aliases in `PARAM_ALIASES`).
- `cost` is a string formula evaluated by `evalCost` (`+ - * / ^`, parentheses, `min(…)` / `max(…)`, `~` ignored). Variables come from `paramVars`: numbers as is, booleans 0 / 1, an enum sets `<name>_<option>` to 1 (so `count*(70*style_pine+460*style_palm)` weighs a style), array params expose `<name>` (length) and `<name>Cells` (nested leaves). Any other identifier evaluates to **0 silently** (on purpose for the unset enum options): a typo turns part of the budget off. Generator formulas are checked against real output by `src/runtime/generators/cost.test.ts`; geometry formulas are not. Only geometries and generators are costed from the catalog (`objectTriangles`); particles, text, svg and models have hard-coded estimates there. Add a case to "evaluates cost formulas" / "estimates a scene" in `check.test.ts` for a non-trivial formula.
- `gpu` on a post effect feeds `gpuCost` (absent = `"low"`) → quality tiers and `check`'s GPU report: an expensive effect without `gpu` is never dropped on low tiers.
- Parity is tested per section: geometries, behaviours, particlePresets, postfx, generators, shaders, sounds (`registry.test.ts`, `Object.keys(impls)` must equal the ids, no extras); textures and lightRigs (`lookdev.test.ts`); materialPresets must resolve to a known type; fonts must ship `library/fonts/<id>.typeface.json`. **instanceLayouts has no parity test**: implement the `case` in `src/runtime/build/instances.ts` yourself.

**Validation**

- Every object / section has an allow-list of keys (`SCENE_KEYS`, `OBJECT_KEYS[kind]`, `BASE_OBJECT_KEYS`, …). A field added to `types.ts` but not to its list is an `unknown-field` **warning** ("ignored by the runtime"), and `npm run check:skills` rejects any skill scene example with warnings.
- `validateScene` never throws: it returns `Issue[]` with paths like `objects#logo.material.roughness`. Ids are declared first (lights, objects) so references resolve in any order; motion is validated after, through `validateMotion(s, { objects, lights, letters, letterCounts })`.
- `normalizeScene` adds structural defaults only. A breaking format change bumps `SCENE_VERSION` (read from source by `scripts/write-version.mjs` → `dist/version.json` `sceneVersion`) and needs a migration there; `validateScene` rejects any other `version`.

**Scene writes**

- `applyScene` / `patchScene` never write when the result has errors, the plan is empty (idempotence) or `dryRun`. `patchScene` runs ops on a copy; a failing op throws `OpsError` with `details.opIndex`. All writes go through `saveScene` (validates, bumps `agent3d.json` `updatedAt`).
- `diffScenes` compares top-level keys generically: a new top-level field shows up in `plan.sections` with no work, but new collections that `set` / `merge` replace wholesale must be covered by `replacedCollections` so the CLI asks for confirmation (`agent/commands/scene.ts`).

**Check**

- `ok` = zero errors. Every templates folder must instantiate and pass `check` with zero errors (`templates.content.test.ts`), and so must the starters (`check.test.ts` "passes the starter project"): a new `error` rule that fires on them breaks the suite — fix the content or make it a warning.
- Runtime stats (`opts.runtimeStats`, from `render`) supersede the triangle estimate; framing issues come only from `opts.inspect`.
- Asset refs are found by `visitAssetRefs` in `refs.ts`. A new scene field holding a file path must be added there, or `check` won't see it missing, `export` won't copy it and `optimize` won't rewrite it.

**Assets, export, tools**

- Network only via the `FetchLike` argument; tests use `stubFetch` (URL prefix → JSON / bytes, records `calls`). Failures inside a source throw `SourceError`; `searchAssetsDetailed` turns them into per-source `errors`.
- `buildExport` is pure: it returns a file map and the front door writes it. Embed extras (`EMBED.md`, `frameworks/`) are behind `extras` (default true). A new lazy runtime chunk unknown to `CHUNK_FEATURES` counts as loaded and disables pruning (reported in `unknown`): add its feature rule.
- `checkInput` validates only `required` + **top-level** types and enums; nested shapes are the handler's (or `validateScene`'s) job. Schemas may use only the keywords allowed by `checkSchema` in `tools.test.ts`; descriptions must exceed 60 chars. `mutating` drives `mcp --read-only`, MCP `readOnlyHint`, and the Studio assistant's confirmation; destructive / idempotent hints are the `DESTRUCTIVE` / `IDEMPOTENT` sets in `agent/mcp/server.ts`.

## How to add a catalog entry

1. Entry in the right array of `src/core/catalog.ts`: precise `description`, typed `params` with defaults / ranges, `cost` (geometries, generators), `gpu` (postfx), `material` (generators honouring `material`), `example` if useful.
2. Runtime implementation in the matching registry (`GEOMETRY_IMPLS`, `BEHAVIOUR_IMPLS`, `GENERATOR_IMPLS`, `POSTFX_IMPLS`, `SHADER_IMPLS`, `SOUND_IMPLS`, `PARTICLE_PRESET_PARAMS`, procedural textures / rigs in `src/runtime/build/`) — see runtime / procedural skills. If it needs a new lazy chunk, add it to `CHUNK_FEATURES`.
3. `npx vitest run src/runtime/registry.test.ts src/runtime/build/lookdev.test.ts src/core/validate.test.ts`.
4. `UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts` (rewrites `docs/catalog.md`).
5. Renaming / removing an id or param: `grep -rn "<id>" plugin/skills docs templates` and fix every hit; then `npm run hermes:build`.

## How to add a scene field

1. `src/core/types.ts`: optional field, additive (contract — report it).
2. `src/core/validate.ts`: add the key to its allow-list and validate it (`V.number`, `enumOf`, `color`, `vec`…) with an actionable hint; motion fields go in `validateMotion.ts`. Test in the matching `src/core/validate*.test.ts`.
3. If it holds a file path: `visitAssetRefs` in `src/ops/refs.ts`. If it changes cost: `budget.ts` / `check.ts`. If it adds a top-level collection: `replacedCollections` in `src/ops/scene.ts`. If it activates a lazy chunk: `CHUNK_FEATURES`.
4. Runtime support (runtime skill), Studio inspector (`src/studio/inspector/specs.ts` + section) if editable.
5. Docs: [docs/scene-format.md](../../../docs/scene-format.md) (prose + example), `plugin/skills/agent3d-edit/references/patch-ops.md` or `agent3d-create/references/art-direction.md` as relevant, then `npm run hermes:build`.

## How to add a check rule

1. In `checkProject` (`src/ops/check.ts`), in the right block (Assets, Scripts, Budget, Framing, Runtime performance, Post-processing, Web friendliness): `{ severity, code, path, message, hint }`, the hint naming the exact fix (tool + CLI form). Script sandbox rules go in `FORBIDDEN` (`scriptLint.ts`), GPU rules in `postfxCheck.ts`.
2. Pick severity with care: `error` fails `check`, every template and the starters must stay error-free.
3. Test in `src/ops/check.test.ts` (MemoryFs project from `createProject`), then run `templates.content.test.ts`.
4. Mention the new code where agents read check output (skills `agent3d-create` / `agent3d-publish`) if they must react to it.

## How to add an export file

1. `buildExport` in `src/ops/export.ts`: `out["<path>"] = …` in the embed branch (behind `extras` if it is a helper, not something the page loads); single-html inlines everything instead. Generators of text files go in `exportFrameworks.ts`.
2. Keep it out of `pageKb` unless visitors download it. Test in `src/ops/export.test.ts` ("builds the embed file map").
3. Update [docs/export.md](../../../docs/export.md), the "Export format" block of CLAUDE.md, the `agent3d-publish` skill; if the layout or element attributes change, `integrations/agentcms/src/render.ts` (+ rebuild `agent3d-scene.zip`).

## How to add an asset source

1. `src/ops/sources/<id>.ts` implementing `AssetSource` (`search` with `score` / `rank`, optional `download` returning `DownloadedFiles`), using only `fetchJson` / `fetchBytes` on the injected fetch. Keep only CC0 / CC-BY results and fill `license`, `author`, `attribution`.
2. Add the id to `SourceId` and `SOURCE_IDS` (`sources/types.ts`, the `assets_search` schema enum follows) and to `SOURCES` (`sources/index.ts`). Update the hard-coded lists: the `AssetEntry.source` comment in `types.ts`, `assets search` usage / summary in `agent/commands/assets.ts`.
3. Test with `stubFetch` in `src/ops/assets.test.ts` (search ranking, download layout, licence filter, `fetch.calls`); never the real network.
4. Docs: [docs/assets.md](../../../docs/assets.md), `plugin/skills/agent3d-assets/references/sources.md`, CLAUDE.md hard rule 1 list, `node scripts/build-cli-docs.mjs`.

## How to add an AI tool

Handler in `SCENE_TOOLS` or `ASSET_TOOLS` calling ops only; add its name to `ORDER` (`src/ai/tools.ts` throws at import if a name in `ORDER` is missing; a tool absent from `ORDER` is never exposed) and to `EXPECTED` in `tools.test.ts`; set `mutating`; update the `DESTRUCTIVE` / `IDEMPOTENT` sets if relevant, [docs/mcp.md](../../../docs/mcp.md), the CLAUDE.md "AI tools" list and the skill that uses it.

## Checks before handing over

```bash
npm run typecheck
npx vitest run src/core src/ops src/ai
npx vitest run src/runtime/registry.test.ts src/runtime/build/lookdev.test.ts   # catalog changes
UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts                               # catalog changes, then review the diff
node scripts/build-cli-docs.mjs --check                                         # when a command / option changed
npm test
```
