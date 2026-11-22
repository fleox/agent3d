# CLAUDE.md — Agent3D

Agent3D is **the 3D studio your AI agent can run**. An agent (Claude Code, Claude, Hermes, any MCP client) describes a 3D element for a web page — an animated banner, a hero, a character, a landscape, a product showcase, a mini game — as a JSON **scene** (`scene.json`), previews it **headless with screenshots** to check its work, and **exports a self-contained embed** (a Web Component + static files, or one HTML file) for any website.

Sibling of AgentCRM (`../agentcrm/`) and AgentCMS (`../cms/`): when in doubt about a pattern (CLI framework, output contract, MCP server, skills, Hermes generation, versioning), **read the agentcrm equivalent and mirror it**.

## Hard rules

1. **Self-contained, no server, no account.** The runtime, the CLI, the Studio and the exports never call a third-party service at run time. The only network use is the *optional* `assets search|add` against free, account-less CC0 sources (Poly Haven, ambientCG, Kenney, Quaternius, Khronos samples) — files are downloaded **once into the project** with their licence in `assets/manifest.json`. Exports never hotlink. No CDN, no web fonts, no analytics.
2. **One engine, four front doors.** Business logic lives in `src/ops/` (pure TS over `ProjectFs`, no DOM, no Node APIs). The Studio (`src/studio/`), the CLI (`agent/`), the MCP server (`agent/mcp/`) and the Studio assistant call ops. Never re-implement a rule in a command or a page.
3. **The catalog is declared once** (`src/core/catalog.ts`): geometries, material presets, shaders, behaviours, generators, particle presets, post effects, fonts, sounds. Validation, runtime registries, AI tools and docs derive from it. A catalog id without a runtime implementation fails the tests.
4. **AI tools are declared once** in `src/ai/tools.ts` (name, description, JSON schema, `mutating`, handler calling `src/ops/`). MCP `tools/list`, `agent3d tools list|call` and the Studio assistant expose exactly that list.
5. **Scenes are data.** Everything a scene can do must be expressible in `scene.json` (+ optional scripts). The runtime is a pure function of (scene, assets, time) in deterministic mode — screenshots must be reproducible.
6. **Web-friendly by default**: lazy start (IntersectionObserver), pause off-screen, `prefers-reduced-motion`, DPR cap, poster fallback when WebGL is missing, `aria-label`, responsive aspect ratio, budgets checked by `agent3d check`.
7. **Scripts are sandboxed by contract**: game scripts only get `ScriptApi` (`src/runtime/api.ts`); `check` rejects forbidden globals (fetch, XMLHttpRequest, WebSocket, eval, Function, import(), document, window, globalThis, localStorage, cookie, parent, top, postMessage, importScripts).
8. All code, comments, docs, skills: **English**. Agents translate for the user at runtime.
9. `npm run typecheck`, `npm test`, `npm run build` must pass. Vitest tests next to the code (`*.test.ts`). Tests never touch the network (inject `fetch`).

## Layout

```
src/
  core/        types.ts (SceneDoc — THE format), catalog.ts, validate.ts, fs.ts (ProjectFs + MemoryFs), ids.ts, json paths, color
  runtime/     the Three.js player shipped to websites
    api.ts         public contract (mountScene, Player, ScriptApi)       registry.ts  implementation registries contract
    index.ts       exports mountScene + defines <agent3d-scene>          element.ts   the Web Component
    player.ts      Player implementation (renderer, loop, deterministic clock, resize, lazy/offscreen, reduced motion)
    build/         scene graph builder: objects, geometry, materials (+presets), text (fonts), svg, models (GLTF), instances, lights, environment (bg, sky, IBL, fog, ground), camera + controls
    behaviours/    one file per catalog behaviour          timeline/  keyframes + easing
    particles/     particle system + presets               postfx/    effect composer + effects
    generators/    procedural content (terrain, trees, character, city, …)   shaders/  GLSL shader materials
    game/          script host (ScriptApi), input, physics (light AABB/sphere), HUD, events, storage
    audio/         WebAudio synth presets + audio files
    random.ts      seeded RNG + noise (simplex/fbm) shared by procedural code
  ops/         engine: project.ts, scene.ts (get/apply/patch), objects.ts, timeline.ts, check.ts, assets.ts (+ sources/), templates.ts, export.ts, docs.ts
  ai/          tools.ts — the AI tool catalog
  studio/      Studio SPA (React + Tailwind): viewport, outliner, inspector, timeline, catalog browser, templates gallery, assistant
agent/         `agent3d` CLI (Node ≥ 20, bundled to dist/agent/agent3d.mjs) — commands/, mcp/, render/ (CDP headless Chrome), serve, nodeFs
library/       built-in CC0 assets shipped in the npm package (fonts/, models/, textures/, hdri/) + library/index.json (id, path, licence, author, tags)
templates/     starter projects (folder per template: agent3d.json, scene.json, scripts/, template.json {id,title,description,kind,tags})
plugin/skills/ Claude Code skills (single source)          hermes/  generated Python-agent skills (+ python/ wrapper, tests/)
integrations/agentcms/  AgentCMS plugin: "Agent3D scene" editor block (packed agent3d-scene.zip)
docs/          user docs (catalog.md + cli.md reference generated)   scripts/  build / check scripts
AGENTS.md      what must stay in sync (catalog, tools, skills, versions, Hermes, docs)
```

### Builds

- `vite.runtime.config.ts` → `dist/runtime/agent3d-runtime.js` (+ lazy `chunks/` for postfx, generators, physics/game, loaders, fonts) and, with `--mode single`, `dist/runtime/agent3d-runtime.single.js` (one file, dynamic imports inlined — for single-html exports).
- `vite.config.ts` → `dist/studio/` (the Studio SPA; `agent3d studio` / `serve` serve it).
- `vite.agent.config.ts` → `dist/agent/agent3d.mjs`, every dependency inlined (no runtime dependency). The CLI finds the runtime, studio, library and templates relative to its own file (`agent/paths.ts`, overridable with `AGENT3D_DIST`).

## The project folder

```
my-banner/
  agent3d.json      { name, title, createdAt, updatedAt, template?, agent3d }
  scene.json        SceneDoc
  assets/           + assets/manifest.json { assets: AssetEntry[] }
  scripts/          ES modules (ScriptFactory default export)
  renders/          screenshots from `agent3d render`
  dist/             exports from `agent3d export`
```

## Ops (src/ops/) — signatures every front door uses

All ops take a `ProjectFs` (project root) and return JSON-able results. Errors are `OpsError(code, message, hint?, details?)` (`src/ops/context.ts`, `toJSON()`) with codes `notFound | validation | conflict | invalid | forbidden-script | io`; validation failures carry `details.issues`. Network only through an injected `fetch` (`FetchLike`); zips through an injected `inflate` (default `DecompressionStream("deflate-raw")`).

```ts
// project.ts
createProject(fs, { name, title?, template?: string, templateFiles?: Record<string, Uint8Array|string>, target?: Partial<TargetDef>, force?: boolean }): Promise<{ manifest, scene, files: string[], issues }>
  // no template → starters.ts: an attractive valid scene per target kind (banner: gradient bg + studio lights + floating 3D title …; game: + scripts/game.js)
loadProject(fs): Promise<{ manifest: ProjectManifest; scene: SceneDoc }>
saveScene(fs, scene, opts?: { allowInvalid?: boolean }): Promise<{ issues: Issue[] }>   // validates; throws OpsError("validation") on errors unless allowInvalid; bumps agent3d.json updatedAt
// scene.ts
getScene(fs): Promise<SceneDoc>
summarizeScene(scene): SceneSummary          // { id, title, target, camera, background, lighting?, lights, objects: tree {id, kind, detail, position?, behaviours?, children?}, counts, timeline?, postfx?, scripts?, ui?, sounds? }
diffScenes(before | null, after): ScenePlan  // { empty, objects: { added, removed, changed: {id, fields}[], moved: {id, from, to, index}[] (parent changes + sibling reorders) }, sections: string[], summary }
applyScene(fs, next: SceneDoc, { dryRun? }): Promise<{ plan: ScenePlan; issues: Issue[]; applied: boolean }>
  // full replace. Never throws on invalid scenes: errors → applied false (nothing written). Same input twice → plan.empty, no write.
patchScene(fs, ops: PatchOp[], { dryRun? }): Promise<{ plan; issues; applied; scene }>
  // atomic: ops run on a copy (a failing op throws OpsError("invalid"|"conflict") with details.opIndex), the result is validated, errors → applied false.
  // PatchOp = { op: "set", path, value } | { op: "merge", path, value }  (RFC 7396: objects merge, null deletes) | { op: "remove", path }
  //         | { op: "addObject", object, parent?, index? } | { op: "updateObject", id, set }  (deep merge; id/children not changeable)
  //         | { op: "removeObject", id }  (also drops its timeline tracks) | { op: "moveObject", id, parent?: string|null, index? }
  //         | { op: "addBehaviour", id (object or light), behaviour } | { op: "addTrack", track } (replaces same target, creates/extends the timeline) | { op: "removeTrack", target }
  // paths (src/core/jsonPath.ts): "camera.position", "lights[0].intensity", "lights#key.color", "objects#<id>.material.color" (id searched in the whole tree), "objects#<id>.position[1]".
applyPatchOps(scene, ops): SceneDoc         // pure version
// objects.ts (wrappers over patchScene + pure tree helpers from tree.ts)
listObjects(fs): Promise<FlatObject[]>  getObject(fs, id): Promise<{ object, parent }>
addObject(fs, object, { parent?, index?, dryRun? })  updateObject(fs, id, set, { dryRun? })  removeObject(fs, id, opts)  moveObject(fs, id, { parent?, index? }, opts)  addBehaviour(fs, id, behaviour, opts)
findObject(objects, id) → { object, parent, container, index, depth } | null   walkObjects(objects, fn)   flattenObjects(scene)   allObjectIds(scene)
// timeline.ts
getTimeline(fs)  setTimeline(fs, timeline | null, opts)  addTrack(fs, track, opts)  removeTrack(fs, target, opts)  editTimeline(fs, { settings?, addTracks?, removeTargets? }, opts)
// validate (src/core/validate.ts)
validateScene(scene: unknown): Issue[]       // structural + catalog params (types, ranges, enums, unknown ids/fields/params → "did you mean"); paths "objects#logo.material.roughness"
normalizeScene(scene): SceneDoc              // structural defaults only (version, empty lights/objects/tracks/elements)
defaultScene({ id?, title?, kind?, aspect? }): SceneDoc   // minimal valid scene;  DEFAULT_ASPECT, DEFAULT_BUDGET_KB per kind
// check.ts
checkProject(fs, opts?: { runtimeStats?: FrameStats; inspect?: InspectResult; library?: LibraryIndex; runtimeKb?: number }): Promise<CheckReport>
  // CheckReport { ok, issues, counts, budget: { estimatedTriangles, heaviestObjects, assetsKb, scriptsKb, sceneKb, totalKb, budgetKb, runtimeKb }, licences: { path, license, author?, attribution }[] }
  // validation + missing assets (incl. .gltf buffers/images) / scripts + script sandbox lint (scriptLint.ts: lintScript(source, path)) + triangle (budget.ts, catalog `cost` formulas) and KB budgets
  // + framing (framingIssues(scene, inspect)) + runtime perf (draw calls > 150, triangles per kind) + licences needing attribution + web (ariaLabel, reducedMotion, lazy, maxDpr)
// assets.ts (+ sources/: polyhaven, ambientcg, khronos = live APIs; kenney, quaternius = curated indexes, manual zip download)
listAssets(fs): Promise<{ assets: (AssetEntry & { exists, usedBy })[]; totalKb }>
addAsset(fs, { path, bytes, kind?, source, license, author?, sourceUrl?, attribution? }): Promise<AssetEntry>   // bare file name → assets/<kind dir>/
removeAsset(fs, path): Promise<{ removed: true; usedBy: string[] }>
searchAssets({ query, kind?, source?, limit? }, fetchImpl): Promise<AssetHit[]>     // searchAssetsDetailed → { hits, errors } (per-source failures)
  // AssetHit { source, id, title, kind, license, author?, attribution?, previewUrl?, pageUrl?, tags?, downloads: Record<resolution|format, url>, manual?, note? }
downloadAsset(fs, hit, fetchImpl, opts?: { resolution?, name?, inflate? }): Promise<AssetEntry & { files: string[]; suggestion? }>   // → assets/<kind>s/<name>.<ext> or assets/<kind>s/<name>/…
importAssetZip(fs, zipBytes, { name, source, license, author?, sourceUrl?, attribution?, filter?: string[], inflate?, maxFiles? }): Promise<{ assets, models, skipped }>   // Kenney / Quaternius packs
listLibrary(libraryIndex, { query?, kind?, limit? }): { assets: { id, ref: "library:<id>", kind, license, author?, tags, description, kb }[]; total }
// templates.ts   TemplateInfo { id, title, description, kind, tags, aspect }; TemplateIndex = TemplateInfo[]
listTemplates(index, { kind?, query? })  findTemplate(index, id)  parseTemplateInfo(json, fallbackId)  instantiateTemplate(fs, id, files, { name, title?, force? }) — files read from templates/<id>/ by the front door
// export.ts
buildExport(fs, { format: "embed" | "single-html", name?, runtime: RuntimeFiles, library: LibraryProvider, poster?: Uint8Array }): Promise<ExportResult>
  // RuntimeFiles { files: Record<string, Uint8Array> } (dist/runtime: "agent3d-runtime.js" + "chunks/…"; single-html: "agent3d-runtime.single.js")
  // LibraryProvider { index: LibraryIndex; read(id): Promise<Uint8Array> } (src/core/library.ts)
  // ExportResult { format, name, files: Record<string, Uint8Array|string> (relative to the export root), snippet, entry, totalKb, sizes: { runtimeKb, sceneKb, assetsKb, scriptsKb, posterKb }, credits, issues }
  // pure (the front door writes files; prefixFiles(files, dir) helps). Throws on validation errors / missing files.
// docs.ts
renderCatalogMarkdown(): string               // docs/catalog.md (src/ops/docs.test.ts fails when stale; UPDATE_DOCS=1 rewrites)
```

## Export format

`embed` (default) — drop the folder on any static site:
```
<out>/
  agent3d-runtime/agent3d-runtime.js (+ chunks/)     shared by every scene on the site
  <name>/scene.json  assets/…  scripts/…  poster.webp
  index.html          demo page (the snippet in context)
  snippet.html        what to paste in the page
```
Snippet: `<script type="module" src="./agent3d-runtime/agent3d-runtime.js"></script><agent3d-scene src="./<name>/scene.json" poster="./<name>/poster.webp"></agent3d-scene>` — relative paths in the scene resolve against the scene.json URL; library assets are copied into `<name>/assets/library/`.

`single-html` — one `<name>.html` with the single-file runtime, the scene inline (`<script type="application/json">`) and assets as data: URIs (budget warning above 5 MB).

Also: `agent3d export --format poster` (PNG/WebP still) and `--format video` (WebM via headless Chrome MediaRecorder).

## Headless render (agent/render/)

`agent3d render [--frames 0,1.5,3 | --count 4] [--size 1200x300] [--sheet] [--out renders/]` →
1. starts a 127.0.0.1 HTTP server serving `dist/runtime`, the library and the project;
2. launches the user's **installed Chrome / Chromium / Edge / Brave** (`agent/render/browser.ts` finds it; `AGENT3D_CHROME` overrides; none → hint to install Chrome or `npx playwright install chromium`) with `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --remote-debugging-port=0` and a temp profile;
3. drives it with a hand-written CDP client over Node's global `WebSocket` (no puppeteer);
4. the preview page mounts the scene with `deterministic: true`, sets `window.__agent3d`, then for each frame `player.seek(t)` + `snapshot()`; with `--sheet` composes a contact sheet (grid with small time labels in each cell's bottom-left corner, clear of top HUDs) in the page canvas;
5. writes PNGs, returns `{ dir, frames: [{ t, path }], sheet?, state, stats, inspect, issues, consoleErrors }` (paths relative to the project folder `dir`) so the agent can *look* at the images and fix framing / budget problems. `--input <json>` (games) applies simulated keys / clicks / pointer moves between seeks (`render_preview` `input`); `state` is `player.state()` after the last frame.

## CLI contract (mirror of agentcrm)

- `--json` → exactly one `{ ok: true, data }` or `{ ok: false, error: { code, message, hint } }` on stdout; logs on stderr. Exit 0 ok, 1 failure, 2 usage / validation.
- Every error a user can hit has an actionable `hint`.
- Destructive or overwriting commands print `{ needsConfirmation: true, plan }` unless `--yes` (scene apply replacing objects, export overwriting a folder, assets remove).
- The project is `--project <dir>` (default: current directory).
- Commands: `help`, `version`, `new <dir> [--template id] [--title] [--target banner|hero|…] [--aspect]`, `info`, `scene get|summary|apply|patch|validate`, `object add|update|remove|list|get|move`, `timeline get|set|add-track|remove-track`, `catalog [section] [id]`, `templates list|show`, `check`, `render`, `serve [--port]` (live-reload preview), `studio [--port]`, `export [--format embed|single-html|poster|video] [--out]`, `assets list|search|add|remove|library`, `tools list|call <name> --input`, `mcp [--read-only]`, `doctor`.

## AI tools (src/ai/tools.ts)

`project_info`, `scene_get`, `scene_summary`, `scene_apply`, `scene_patch`, `scene_validate`, `object_add`, `object_update`, `object_remove`, `object_list`, `timeline_set`, `catalog_get`, `templates_list`, `project_create`, `check`, `assets_list`, `assets_search`, `assets_add`, `library_list`, `export` — plus `render_preview` registered by the CLI/MCP host only (it needs Chrome; the tool returns image paths, and MCP returns the contact sheet as an `image` content block so multimodal clients see it). Tools take `ToolContext { fs, fetch?, host: { render?, runtimeFiles?, library?, templates? } }`.

## Ownership boundaries (parallel work)

| Area | Folders |
|---|---|
| Runtime core | `src/runtime/` except `generators/`, `shaders/`, `audio/`; `vite.runtime.config.ts` |
| Procedural content | `src/runtime/generators/`, `src/runtime/shaders/`, `src/runtime/audio/`, `src/runtime/random.ts`, `library/fonts/` |
| Engine | `src/core/validate.ts` (+ helpers), `src/ops/`, `src/ai/` |
| CLI | `agent/`, `vite.agent.config.ts`, `tsconfig.agent.json` |
| Studio | `src/studio/`, `index.html`, `vite.config.ts`, tailwind / postcss |
| Content | `templates/`, `library/` (except fonts), `examples/` |
| Distribution | `plugin/`, `hermes/`, `.claude-plugin/`, `docs/` (except `catalog.md`, `studio-api.md`), `integrations/agentcms/`, `scripts/check-skills.mjs`, `scripts/build-hermes.mjs`, `scripts/build-cli-docs.mjs` (+ `cli-docs.mjs`, `cli-docs.test.ts`), `scripts/sync-version.mjs`, `scripts/write-version.mjs`, `README.md`, `AGENTS.md`, `changelog.json` |

`src/core/types.ts`, `src/core/catalog.ts`, `src/runtime/api.ts`, `src/runtime/registry.ts` are **contracts**: change them only additively and say so in your report. `package.json` dependencies: ask the lead (no new runtime dependency besides `three` without a strong reason).
