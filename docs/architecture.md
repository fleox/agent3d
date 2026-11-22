# Architecture

Agent3D is a 3D studio with **no server of its own**. Four front doors share one engine; the engine works on a project folder; the output is static files any website can host.

```text
  Studio (React SPA)     agent3d CLI      MCP server (stdio)     Studio assistant
          \                  |                    |                     /
           \                 |                    |                    /
            +--------------- src/ops/ — the engine (pure TS) ---------+
            |   project · scene (get/apply/patch/diff) · objects · timeline
            |   check (validation, sandbox lint, budgets, framing, licences)
            |   assets (library, CC0 sources, zip import) · templates · export
            |                      (+ src/ai/tools.ts: the AI tool catalog)
            +----------- ProjectFs (node:fs / Studio API / memory) ------+
                                          |
                     scene.json · assets/ · scripts/ · renders/ · dist/
                                          |
              src/runtime/ — the Three.js player (<agent3d-scene>), shipped in every export
```

## Layers

- `src/core/` — the contracts: `types.ts` (SceneDoc, the format), `catalog.ts` (everything a scene can reference, declared once), `validate.ts` (structural + catalog validation with "did you mean"), `fs.ts` (`ProjectFs` + `MemoryFs`), ids, JSON paths, colours.
- `src/ops/` — every business rule, as pure functions over a `ProjectFs`: no DOM, no Node APIs, network only through an injected `fetch`, zips through an injected `inflate`. Errors are `OpsError(code, message, hint, details)`.
- `src/ai/tools.ts` — the AI tool catalog (name, description, JSON schema, `mutating`, handler calling ops). MCP `tools/list`, `agent3d tools list|call`, the Studio API and the assistant expose exactly this list.
- `src/runtime/` — the player shipped to websites: scene builder (objects, geometry, materials, text, SVG, models, instances, lights, environment, camera and controls), behaviours, timeline, particles, post effects, generators, shaders, the game host (ScriptApi, input, light physics, HUD, audio), the `<agent3d-scene>` element. Built with `vite.runtime.config.ts` to `dist/runtime/` (an ES module + lazy chunks, and a single-file build for single-HTML exports). Its registries are checked against the catalog by tests: a catalog id without an implementation fails.
- `src/studio/` — the visual editor (see [studio.md](studio.md)).
- `agent/` — the CLI (`agent3d`, bundled to `dist/agent/agent3d.mjs` with every dependency inlined): commands, the MCP server (JSON-RPC by hand), the headless renderer (`agent/render/`: a 127.0.0.1 server + the user's installed Chrome driven by a hand-written CDP client over Node's global `WebSocket`, no puppeteer), `serve` and `studio` servers, the Node `ProjectFs`.
- `library/` and `templates/` — built-in CC0 assets and starter projects shipped in the npm package.
- `plugin/skills/` — the agent skills (single source); `hermes/` is generated from them.

## The render loop

`agent3d render` → local HTTP server (runtime, library, project) → headless Chrome (`--headless=new`, SwiftShader WebGL) → preview page mounts the scene with `deterministic: true` → for each time `player.seek(t)` + `snapshot()` → optional contact sheet composed in the page → PNGs + `{ dir, frames, sheet, state, stats, inspect, issues, consoleErrors }` (paths relative to the project folder `dir`). `--input` applies a script of simulated keys / clicks between seeks, so games can be played headlessly. Deterministic mode makes every frame a pure function of (scene, assets, time): timelines, behaviours, particles and game scripts (fixed step, seeded RNG) replay identically. This is what lets an agent look at its work and iterate.

## Why no server

A 3D element on a web page needs nothing but static files. Agent3D keeps every step local — authoring, previews (the user's own Chrome), exports — and the only network use is the optional download of CC0 assets into the project. The output never phones home: no CDN, no web fonts, no analytics.
