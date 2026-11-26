---
name: runtime-internals
description: Contributor notes for the Agent3D Three.js runtime core shipped to websites (src/runtime/ except generators/, shaders/, audio/) - the api.ts / registry.ts contracts, the <agent3d-scene> element, data bindings, the Player (deterministic clock, seek, snapshot, lazy start, offscreen pause, context release, reduced motion, DPR cap, quality tiers), the scene builder (build/), behaviours, timeline / interactions / shots, particles, post effects, the game script host and physics, the Studio editor overlay and the lazy chunk layout of vite.runtime.config.ts. Invoke when changing any of those files, adding a behaviour, material preset, post effect, ScriptApi method or element attribute, or debugging non-reproducible renders, runtime size or a lazy chunk leaking into the entry in this repository.
---

# Runtime core — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("Hard rules", "Builds", "Export format", "Headless render") and [AGENTS.md](../../../AGENTS.md) first. Don't commit unless the user asked in this conversation. Procedural content (generators, shader materials, synth sounds, `random.ts`) is [`procedural-internals`](../procedural-internals/SKILL.md); validation, ops, check budgets and export are [`engine-internals`](../engine-internals/SKILL.md); `agent3d render` / CDP / the CLI host are [`agent-cli-internals`](../agent-cli-internals/SKILL.md); the Studio side of the editor overlay is [`studio-internals`](../studio-internals/SKILL.md).

## Where things live

| Piece | File(s) | Notes |
|---|---|---|
| Public contract | [src/runtime/api.ts](../../../src/runtime/api.ts) | `MountOptions`, `Player`, `ScriptApi`, `ScriptFactory`, `FrameStats`, `InspectResult`, `EditorBridge`. Types only. **Contract: additive changes only, say so in your report** |
| Registries contract | [src/runtime/registry.ts](../../../src/runtime/registry.ts) | `BuildContext`, `BuiltObject`, `BehaviourImpl` / `BehaviourContext`, `GeneratorImpl`, `ShaderImpl`, `SoundImpl`, `Rng`. Same rule |
| Entry | [src/runtime/index.ts](../../../src/runtime/index.ts) | exports `mountScene`, `Agent3DSceneElement`, `bindSceneData`, `liveContextCount`, `version`; `defineElement()`; sets `globalThis.Agent3D` once per page |
| Web Component | [src/runtime/element.ts](../../../src/runtime/element.ts) | the header comment is the attribute / child / event / `::part` reference; `observedAttributes`, `loadToken` guards stale loads, `webglcontextlost/restored`, `beforeprint` |
| Data bindings | [src/runtime/data.ts](../../../src/runtime/data.ts) | `bindSceneData`, `datasetToData`; applied to the SceneDoc before the build |
| Player | [src/runtime/player.ts](../../../src/runtime/player.ts) | `PlayerImpl`: renderer config, rAF loop, `seek`, `snapshot` / `snapshotHighQuality`, `stats`, `inspect`, `state`, `release`, auto quality (`adaptQuality`) |
| Assets / input | [assets.ts](../../../src/runtime/assets.ts) (`createResolver`: `assetUrls` > absolute URL > `library:` > `assetBase`), [input.ts](../../../src/runtime/input.ts), [inspectView.ts](../../../src/runtime/inspectView.ts) (`refineInView`, `cameraInside` for `check` framing) |
| Scene builder | [src/runtime/build/index.ts](../../../src/runtime/build/index.ts) (`World`), [context.ts](../../../src/runtime/build/context.ts) (`loadShaders` / `loadGenerators`, lazy) | geometry / extrude, materials (+ `toon.ts`, `textures.ts`), text, svg, model, instances, lights + `rigs.ts`, environment + `sky.ts` / `heightFog.ts` / `contactShadows.ts`, camera |
| Motion | [behaviours/](../../../src/runtime/behaviours/) (`index.ts` = `BEHAVIOUR_IMPLS`, `runner.ts`), [timeline/](../../../src/runtime/timeline/) (`controller`, `sample`, `easing`, `overrides`, `interactions`, `scroll`, `shots`) | |
| Particles | [particles/index.ts](../../../src/runtime/particles/index.ts), `presets.ts` (`PARTICLE_PRESET_PARAMS`) | positions computed in the vertex shader from time: zero CPU, deterministic |
| Post effects | [postfx/index.ts](../../../src/runtime/postfx/index.ts) (`POSTFX_IMPLS`, `createPostFx`), `hdr.ts`, `ldr.ts`, `finish.ts`, `background.ts`, `common.ts` | tiers / cost / look expansion live in [src/core/postfx.ts](../../../src/core/postfx.ts) |
| Game | [game/index.ts](../../../src/runtime/game/index.ts) (`GameHost`, implements `ScriptApi`), `physics.ts` / `physicsHost.ts` / `physicsShapes.ts` / `physicsDebug.ts`, `hud.ts`, `expr.ts`, `audio.ts` | |
| Editor overlay | [editor/index.ts](../../../src/runtime/editor/index.ts), `grid.ts`, `math.ts` | imported lazily by the Studio only (`src/studio/panels/Viewport.tsx`); websites never load it |
| Build | [vite.runtime.config.ts](../../../vite.runtime.config.ts) | `stripCatalogProse()` plugin; `--mode single` = `codeSplitting: false` |
| Photo-only lite runtime | [src/runtime/lite/](../../../src/runtime/lite/) (`index.ts` element + full-runtime fallback, `player.ts` raw WebGL2 player), [elementBase.ts](../../../src/runtime/elementBase.ts) (the element minus the renderer, shared), [build/photoCore.ts](../../../src/runtime/build/photoCore.ts) (photo motion / parallax math / GLSL, shared with `build/photo.ts`), `build/cameraFit.ts`, `num.ts`, `assetResolver.ts`, `src/core/qualityTier.ts` | `--mode photo` → `dist/runtime/agent3d-photo.js` (one file, `minifyGlsl`). **Never import three (or `util.ts`, `assets.ts`, `camera.ts`) from these modules**: `src/runtime/lite/lite.test.ts` walks the import graph. Eligibility: `src/ops/liteRuntime.ts`. Pixel parity with the full runtime: `agent/render/photoLite.e2e.test.ts`. A change to the photo look goes in `photoCore.ts` (both runtimes) |

## Invariants and traps

- **Determinism.** In `deterministic: true` the player never reads a clock: time only moves through `seek(t)`. `performance.now()` is allowed only in the live rAF loop, the lazy-start check and swipe timing in `input.ts`. Never call `Math.random` / `Date.now` in build, behaviour, timeline, particle or postfx code: use `ctx.rng` (`World.rngFor(id, seed)` = `createRng(seed ?? hashSeed(scene.seed ?? 1, id))`), `createRng` / `noise*` from `random.ts`, or `seededNoiseTexture` (postfx replaced the three addons' `Math.random` noise for this reason). Scripts get `api.random()` from the host's seeded rng. `agent/render/determinism.e2e.test.ts` (built runtime + Chrome) catches order-dependent results.
- **Seek order.** A backwards `seek` resets behaviours, motion and overrides (or restarts the game) and replays from 0. Behaviours whose result depends on how time is sliced must be listed in `STATEFUL_BEHAVIOURS` (`behaviours/runner.ts`) so `advanceMotionGrid` walks the fixed 1/30 s `motionGrid`; behaviours reading the camera go in `LATE_BEHAVIOURS`. `src/runtime/build/world.test.ts` ("deterministic seek grid", "World frame order") pins this.
- **Behaviours compose as offsets**: the runner restores the base transform each frame, then applies every behaviour in order. An implementation sets an absolute offset from `t` (see `rotate.ts`: `rotateOnAxis(axis, speed * t)`), never accumulates `dt` unless it is stateful.
- **Deterministic mode turns things off**: reduced motion detection, lazy start, auto quality, context release, `openUrl` navigation, audio unlock listeners; `preserveDrawingBuffer` is on so `snapshot()` can read the canvas. Keep new live-only features behind `!this.deterministic`.
- **Lazy chunk boundaries.** The entry statically imports three, the catalog, `player.ts`, `build/index.ts`, materials, behaviours, timeline, input, data. Everything else is `await import(...)`: `game/index` (and `physicsHost` → cannon-es inside it), `postfx/index`, `build/text`, `build/svg`, `build/model` (GLTFLoader, `meshopt_decoder`, SkeletonUtils), `shaders/index`, `generators/index`, `audio/index`, the three addons for sky, HDR/EXR, RoomEnvironment, GroundedSkybox, OrbitControls, RectAreaLight. `player.ts` imports `GameHost` and `PostFxPipeline` with `import type` only: a value import there pulls the whole chunk into the entry. Check `dist/runtime/` after `npm run build:runtime` (entry size and `chunks/` names) when you touch imports; docs/export.md "Runtime size" states the entry is about 220 KB gzipped.
- **Catalog prose stripping** (`stripCatalogProse`) only matches `description: "..."` and the `n|i|b|c|cs|v3|e("name", "desc"` helper calls with double-quoted literals: a description in backticks or single quotes ships to every website.
- **Single mode**: `build:runtime` runs the default build (empties `dist/runtime`) then `--mode single` (`emptyOutDir: false`). Running only the single build leaves stale chunks; running the default build after it deletes `agent3d-runtime.single.js`.
- **No network, no forbidden globals.** Runtime fetches only scene-relative / library URLs from `resolveAsset`. Script modules load via `URL.createObjectURL(new Blob(...))` + `import()` (single-html) - hence `blob:` in the CSP table of docs/export.md. No `eval` / `new Function` in the runtime (HUD expressions use `game/expr.ts`): grep the built bundle if you add a dependency path. `api.storage` is the only storage door (`localStorage` keyed `agent3d:<scene.id>:<key>`, errors swallowed).
- **Disposal and contexts.** `World.dispose()` disposes runners, rig, env, materials, background textures; `release()` (off-screen for `OFFSCREEN_RELEASE_MS`, or when `MAX_LIVE_CONTEXTS` = 8 are alive) keeps a webp still, disposes everything and `forceContextLoss()`. Games, editors and deterministic players are never released (`releasable()`). Anything you allocate on the GPU must be freed from a `dispose` reachable from `World.dispose()` / the postfx pipeline, or released players leak.
- **Quality**: DPR = `options.pixelRatio` ?? min(devicePixelRatio, `target.maxDpr ?? 2`, tier `dprCap`). Post effects above the tier are dropped by `activePostFx` before `createPostFx` runs; `"auto"` steps down with `lowerTier` after sustained low fps.

## How to add a behaviour

1. Catalog entry in `BEHAVIOURS` ([src/core/catalog.ts](../../../src/core/catalog.ts)): id, description, params with defaults / ranges, example. Validation follows automatically.
2. `src/runtime/behaviours/<id>.ts` exporting a `BehaviourImpl` (read params with `num` / `DEG` from `../util`, axes with `axisOf` from `common.ts`); register it in `behaviours/index.ts`. `src/runtime/registry.test.ts` fails until both lists match.
3. Frame-history state → `STATEFUL_BEHAVIOURS`; reads the camera → `LATE_BEHAVIOURS`; entrance (hidden at t = 0) → `ENTRANCE_BEHAVIOURS` (`runner.ts`).
4. Test in `src/runtime/behaviours/behaviours.test.ts`; `UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts`.

## How to add a material preset

1. Entry in `MATERIAL_PRESETS` (catalog): `props` is a `MaterialDef` without `preset`; its `type` must be one the registry test accepts. `resolveMaterialDef` (`build/materials.ts`) merges it; nothing else to register.
2. Render it on a lit scene (`agent3d render`) and look at it; regenerate `docs/catalog.md`.

## How to add a post effect

1. Catalog entry in the postfx list with params and `gpu: "low"|"medium"|"high"` (drives tier dropping and `check`'s GPU report via `src/core/postfx.ts`).
2. Implementation: `create<Name>(def, rt: FxRuntime): EffectHandle` in `postfx/hdr.ts` (add to `HDR_ORDER` in `postfx/index.ts`) or `ldr.ts`; a finish-pass effect is `finishOnly` plus uniforms in `finish.ts`. Register it in `POSTFX_IMPLS`. Seed any noise (`seededNoiseTexture`, `IGN_GLSL`).
3. Live params (`EffectHandle.set`, reached through `World.postfxParam` → pipeline `setParam` by timeline tracks / interactions) and internals: `src/runtime/postfx/postfx.test.ts`; `src/core/postfx.test.ts` for tiers / cost. Regenerate `docs/catalog.md`.

## How to add a ScriptApi method

1. Add it to `ScriptApi` in `api.ts` (additive; say so in your report) and implement it in the api object built by `GameHost` (`game/index.ts`). Deterministic: no real clock, randomness from `host.rng`.
2. If it replaces a forbidden global, keep `src/ops/scriptLint.ts` `FORBIDDEN` / its hint in sync (`src/ops/check.test.ts`).
3. Document it in [docs/scripting.md](../../../docs/scripting.md) and `plugin/skills/agent3d-game/references/script-api.md`, then `npm run hermes:build`. Test in `game/*.test.ts` (physics in `physics.test.ts`).

## How to add an element attribute

1. `element.ts`: header comment, `observedAttributes`, `attributeChangedCallback` (rebuild or live update), and how it reaches `mountScene` options. Test in `src/runtime/element.test.ts` (runs without WebGL).
2. Mirror it in `src/ops/exportFrameworks.ts` (framework wrappers + `agent3d-scene.d.ts`, `src/ops/export.test.ts`), [docs/export.md](../../../docs/export.md) "The `<agent3d-scene>` element", `plugin/skills/agent3d-publish/` (SKILL.md, `references/integrations.md`), and `integrations/agentcms/src/render.ts` if the block should set it (rebuild and commit `agent3d-scene.zip`).

## Tests

- Unit (Node, no WebGL; DOM tests opt in with `// @vitest-environment happy-dom`): `src/runtime/**/*.test.ts` - `element`, `data`, `assets`, `random`, `registry`, `inspectView`, `build/` (`world`, `camera`, `text`, `svg`, `lookdev` = procedural textures / rigs / sky, `heightFog`), `behaviours`, `timeline` (`timeline`, `motion`), `particles`, `postfx`, `game` (`physics`, `hud`, `hudTheme`, `expr`), `editor` (`grid`, `math`).
- Real browser (skip without `dist/runtime` or a Chromium-family browser; `AGENT3D_DIST` set also skips `agent/e2e-render.test.ts`): `agent/e2e-render.test.ts`, `agent/render/determinism.e2e.test.ts`, `agent/render/embed.e2e.test.ts`. They read the built runtime: rebuild it (`npm run build:runtime`) only when no other agent is using `dist/`.
- Looks changed (lighting, tone mapping, materials, postfx)? Re-render `plugin/skills/agent3d-create/references/recipes.md` scenes (AGENTS.md).

## Checks before handing over

```bash
npm run typecheck
npx vitest run src/runtime src/core src/ops/docs.test.ts src/ops/export.test.ts
npm test
# when imports or the build changed, and dist/ is yours to rebuild:
npm run build:runtime && ls -la dist/runtime dist/runtime/chunks
npx vitest run agent/e2e-render.test.ts agent/render/determinism.e2e.test.ts agent/render/embed.e2e.test.ts
```
