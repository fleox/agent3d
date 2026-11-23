---
name: studio-internals
description: Contributor notes for the Agent3D Studio SPA (src/studio/ - App / Editor boot, backends: CLI REST API vs in-browser IndexedDB projects, EditorStore and patch ops, inspector specs, timeline helpers, assistant loop, i18n en/fr, dark-only design tokens), index.html, vite.config.ts (AGENT3D_STUDIO_API proxy, test excludes), Tailwind / PostCSS, the runtime editor bridge (src/runtime/editor/ gizmos and grid, EditorBridge in api.ts), the studio HTTP API in agent/commands/serve.ts (docs/studio-api.md) and how `agent3d studio` serves dist/studio. Invoke when changing the Studio UI, its backends, the editor overlay, the studio API, or when screenshotting the Studio in this repository.
---

# Agent3D Studio — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("Hard rules", "Layout", "Ops") and [AGENTS.md](../../../AGENTS.md) first, then [docs/studio.md](../../../docs/studio.md) (user view) and [docs/studio-api.md](../../../docs/studio-api.md) (the REST contract). Don't commit unless asked. Siblings: [`engine-internals`](../engine-internals/SKILL.md) (ops, validation, AI tools the Studio calls), [`runtime-internals`](../runtime-internals/SKILL.md) (the Player the viewport mounts), [`agent-cli-internals`](../agent-cli-internals/SKILL.md) (`agent3d studio`, serve, render), [`procedural-internals`](../procedural-internals/SKILL.md), [`content-internals`](../content-internals/SKILL.md) (templates shown on the start screen), [`repo-presentation`](../repo-presentation/SKILL.md) (published Studio screenshots), [`create-mr`](../create-mr/SKILL.md).

## Where things live

| Piece | Source | Notes |
|---|---|---|
| Boot | `src/studio/main.tsx`, `App.tsx` | `detectApi()` (`GET ./api/info`, JSON content-type required) → `RemoteBackend`, else `LocalBackend`; no project or `?start=1` → `panels/StartScreen.tsx` |
| Editor shell | `src/studio/Editor.tsx` | builds the `EditorStore` whose persist calls `scene_patch` / `scene_apply`; reads deep-link params (`select`, `panel`, `dialog`, `assistant`, `device`, `events=0`) via `lib/urlState.ts` |
| Backends | `backend/types.ts` (`Backend`, `Capabilities`, `ToolCallError`, `MutationResult`), `remote.ts`, `local.ts`, `idb.ts` | remote: CLI envelope over `fetch` + `EventSource("./api/events")`; local: `PersistedFs` (MemoryFs → IndexedDB) and `callAiTool` / `listAiTools` in the page |
| State | `state/editorStore.ts` (framework-free, tested), `context.tsx` (UI store, `useEditor`, `useSnapshot`, `useUi`), `playerController.ts`, `tinyStore.ts`, `useLibraryBase.ts` | |
| Panels | `panels/` — `TopBar.tsx` (`Logo`, same drawing as the favicon in `index.html` and `.github/assets/logo.svg`), `Viewport.tsx`, `Outliner.tsx`, `AddPanel.tsx`, `BottomPanel.tsx`, `CheckPanel.tsx`, `JsonPanel.tsx`, `InteractionsPanel.tsx`, `ExportDialog.tsx`, `RenderDialog.tsx`, `MediaOptions.tsx`, `ShortcutsDialog.tsx` | |
| Inspector | `inspector/` — `specs.ts` (ParamSpecs for non-catalog fields, built from `core/catalog` + `core/validate` enums), `fields.tsx`, `ObjectInspector.tsx`, `EnvironmentSection.tsx`, `PostFxSection.tsx`, `PhysicsSection.tsx`, `ShotsSection.tsx`, `SceneSettings.tsx` | catalog entries render from their own `params` |
| Timeline | `timeline/Timeline.tsx` + `lib/tracks.ts` (`OBJECT_TRACK_PROPS`, `upsertKey`, `moveKey`, `snapTime`, `RULER_STEPS`, `rulerStep(duration, widthPx, minPx = 48)`), `lib/timelineEdit.ts`, `lib/timelineClock.ts`, `lib/easeEdit.ts` | |
| Edit → ops | `lib/patches.ts` (`objPath`, `fieldOps`, `newObject`, `takenIds`), `lib/gizmo.ts` (`objectTransformOps`, `lightMoveOps`, `cameraFromViewOps`), `lib/interactions.ts`, `lib/shots.ts`, `lib/postfxStack.ts` | pure, each has a `*.test.ts` |
| Assistant | `assistant/loop.ts` (Messages API tool loop, pure, injected fetch / `callTool`), `AssistantPanel.tsx` | user's own key in `localStorage` `agent3d.studio.anthropicKey`, sent only to api.anthropic.com |
| i18n | `i18n/en.ts` (source, `Messages` type), `fr.ts` (`fr: Messages`), `index.ts` (`t`, `?lang=`, `agent3d.studio.lang`) | |
| Styling | `index.css` (CSS variables on `:root`, `color-scheme: dark`), `tailwind.config.js` (`ink-0..4`, `line`, `fg`, `accent`, `key`, `agent`, `danger`, `warn`; 10-13 px font scale), `postcss.config.js` | dark only |
| Editor overlay | `src/runtime/editor/index.ts` (`SceneEditor`: TransformControls on a proxy, OrbitControls, picking, light helpers), `math.ts` (snap, euler continuity, `transformFields`), `grid.ts` (`createEditorGrid`, `gridFadeRadius`) | talks to the Player only through `EditorBridge` (`src/runtime/api.ts`, `MountOptions.editor`) |
| Studio API | `agent/commands/serve.ts` (`startStudioServer`, `studioCommand`, `localGuard`, `sseHub`), tests `agent/commands/serve.test.ts` | owned by the CLI; contract in `docs/studio-api.md` |

## Invariants and traps

- **The Studio never decides validity.** Every edit becomes `PatchOp`s (`lib/patches.ts`, `lib/gizmo.ts`…), applied locally with `applyPatchOps` for instant feedback, then persisted as one debounced `scene_patch` (undo / redo / JSON panel → `scene_apply`). Issues shown live come from `validateScene`; check, export and renders go through the `check`, `export`, `render_preview`, `project_create` tools. A rule written in a component is a bug: put it in `src/ops/` and call the tool. `EditorStore.queue` collapses consecutive `set`s on the same path (drags) — `editorStore.test.ts` "op compaction" pins it.
- **Both backends must behave the same.** `LocalBackend` runs the very same `src/ai/tools.ts` handlers over a `PersistedFs`, so anything new must work without Node or Chrome: `capabilities` say what is missing (`render: false`, export only `single-html` + `poster` when `runtime/agent3d-runtime.single.js` or `dist/runtime/…` is reachable, `exportHint: "local"`). Gate UI on `backend.capabilities`, never on `backend.mode`.
- **The viewport bundles the runtime from source**: `playerController.ts` lazy-imports `../../runtime/index`, `Viewport.tsx` lazy-imports `../../runtime/editor/index`. A runtime change reaches the Studio only after `npm run build:studio`; `src/runtime/editor/` must stay out of `src/runtime/index.ts` (websites never load it). The editor grid is tagged `userData.helper` + `userData.editorHelper` so contact shadows / postfx masks skip it — keep that for any new helper object.
- **The assistant uses the tool catalog, not private calls**: tools from `backend.tools()` (`/api/tools` or `listAiTools()`), results from `backend.call`; after a `mutating` tool the scene reloads, and the card keeps `before` for Undo. A new Studio action that agents should also have is a new AI tool in `src/ai/`, not Studio code.
- **i18n parity**: `MessageKey` is derived from `en.ts`, so a missing en key fails `npm run typecheck`; `i18n/i18n.test.ts` fails on fr key drift or mismatched `{var}` placeholders; `i18n/hardcoded.test.ts` lints `.tsx` for literal JSX text and `title` / `placeholder` / `aria-label` / `label` / `hint` / `alt` strings (extend `ALLOWED` only for technical tokens) and requires a `fields.<name>` label in both bundles for every ParamSpec in `inspector/specs.ts` and every `MATERIAL_TEXTURE_SLOTS` entry.
- **Dark only**: no light theme, no `prefers-color-scheme` switch; `index.html` sets `<meta name="color-scheme" content="dark">`. Colours come from the Tailwind tokens, not raw hex.
- **Studio API security** (`serve.ts`): 127.0.0.1 only, `localGuard` rejects foreign `Host` / `Origin` with 403; after a tool call or `PUT` / `DELETE`, `watcher.ignoreWritten([...])` mutes the echo so the Studio does not reimport its own write as an external change. A new write route needs the same `ignoreWritten`, the envelope with a `hint`, a `serve.test.ts` case and a `docs/studio-api.md` entry.
- **No network** beyond the assistant's api.anthropic.com call: no CDN, web fonts or remote images (system font stacks in `tailwind.config.js`).

## How to add an inspector field

1. A catalog param: nothing in the Studio, it renders from `src/core/catalog.ts`. A scene field outside the catalog: add its `ParamSpec` to `inspector/specs.ts` (helpers `n`, `i`, `b`, `c`, `e`, `v3`, `s`), render it in the right section (`ObjectInspector.tsx`, `SceneSettings.tsx`…).
2. Write through `fieldOps(scene, path, value)` (`undefined` removes the key) and `store.edit(ops, { coalesce })` for sliders.
3. Labels: `fields.<name>` in `i18n/en.ts` and `i18n/fr.ts`.
4. If it is a new `types.ts` field: see AGENTS.md "The scene format is a contract" (docs, skill references).

## How to add a panel, dialog or deep-link param

1. Component in `panels/`; strings through `t("…")` with keys in both bundles.
2. UI state in `state/context.tsx` (`UiState`, `BottomTab`); deep-link param parsed in `Editor.tsx` and documented in the `lib/urlState.ts` header comment.
3. Data from tools only (`backend.call`), errors as `ToolCallError` (show `hint`).
4. Pure logic in `lib/<name>.ts` with `lib/<name>.test.ts`.

## How to add a Studio API route

1. Route in `startStudioServer` (`agent/commands/serve.ts`), envelope `{ ok, data }` / `{ ok: false, error: { code, message, hint } }`.
2. Method on `Backend` (`backend/types.ts`), implemented in **both** `remote.ts` and `local.ts`.
3. Test in `agent/commands/serve.test.ts`; document in `docs/studio-api.md`.

## Running and screenshotting

- `npm run dev`: plain Vite, no port in `vite.config.ts`, so Vite's default (5173, next free one if busy). The maintainer may already run it: don't kill it, and pass `--port <free>` for your own. Without a proxy, `/api/info` returns the SPA HTML → `LocalBackend` (library from `./library/`, single runtime from `./dist/runtime/`). `AGENT3D_STUDIO_API=http://127.0.0.1:4320 npm run dev` proxies `/api`, `/__runtime`, `/__library`, `/project` to a running `agent3d studio`.
- `agent3d studio [--project <dir>] [--port 4320] [--no-open]` serves `dist/studio` (`studioDir()` in `agent/paths.ts`, `$AGENT3D_DIST` overrides) as `fallbackRoot`, mounts `/__runtime/`, `/__library/`, `/project/`, tries 20 ports from the first; missing build → `studio-missing`. From a clone: `npm run build:studio` first (not while other agents run tests against `dist/`).
- Screenshots: `node .github/demos/shot.mjs <chrome> "http://localhost:<port>/?select=<id>&panel=timeline" out.png 1440 900 8000` (Node >= 22, headless Chrome + SwiftShader, dark media emulated, real-time wait). Deep-link params set the state; `events=0` stops the SSE. Published screenshots follow [`repo-presentation`](../repo-presentation/SKILL.md) (`studio-*-dark.jpg`, no API key or `/Users/…` path on screen).

## Tests

- Studio tests are pure Vitest files in the node environment: `src/studio/lib/*.test.ts`, `state/editorStore.test.ts`, `assistant/loop.test.ts`, `panels/mediaOptions.test.ts`, `i18n/*.test.ts`; overlay maths in `src/runtime/editor/math.test.ts`, `grid.test.ts`. No component rendering tests: keep logic out of `.tsx` so it can be tested.
- `vite.config.ts` `test.exclude` skips `.agent3d-tmp/**` (scratch projects may hold stray test files) besides `node_modules` and `dist`.

## Checks before handing over

```bash
npm run typecheck
npx vitest run src/studio src/runtime/editor agent/commands/serve.test.ts
npm test
# only when no other agent is using dist/:
npm run build:studio
```
