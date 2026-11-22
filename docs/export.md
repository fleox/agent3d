# Exports

`agent3d export` turns a project into files for a website. The engine builds the files (`buildExport` in `src/ops/export.ts`, pure); the CLI, the Studio and the MCP `export` tool write them. Run `check` first: an export refuses scenes with validation errors and missing files.

| Format | Command | Output |
|---|---|---|
| `embed` (default) | `agent3d export` | Folder for any static site |
| `single-html` | `agent3d export --format single-html` | One self-contained `.html` file |
| `poster` | `agent3d export --format poster [--time 2] [--image png]` | A still (`dist/poster.webp`), 2x pixel ratio |
| `video` | `agent3d export --format video [--duration 8] [--fps 30]` | A WebM (`dist/video.webm`) recorded by headless Chrome |

Common options: `--out <path>` (default `<project>/dist/<format>`, or the file for poster / video), `--name <slug>` (scene folder / file name, default the project name), `--size WxH`, `--timeout <s>`, `--yes` (overwrite a non-empty output folder; without it the command prints a plan with the existing entries). `--no-poster` skips the poster of embed / single-html exports (no Chrome needed).

## `embed`

```
dist/embed/
  agent3d-runtime/agent3d-runtime.js   the runtime (ES module, ~80 KB) …
  agent3d-runtime/chunks/*.js          … and its lazily loaded chunks (three.js, loaders, generators, post effects, game host)
  <name>/scene.json
  <name>/assets/…                      project assets + library assets used (assets/library/…)
  <name>/scripts/…                     game scripts
  <name>/poster.webp                   first-frame fallback and reduced-motion still
  <name>/CREDITS.txt                   licences that need attribution
  index.html                           demo page (the snippet in context, credits)
  snippet.html                         what to paste into a page
```

Snippet:

```html
<script type="module" src="./agent3d-runtime/agent3d-runtime.js"></script>
<agent3d-scene src="./<name>/scene.json" poster="./<name>/poster.webp" aria-label="…"></agent3d-scene>
```

- Paths are relative to the page; with pages at several depths, use root-absolute URLs (`/agent3d/<name>/scene.json`). Paths inside the scene resolve against the `scene.json` URL, and `library:` assets against `<scene dir>/assets/library/` (override with the `library-base` attribute).
- Several scenes share one `agent3d-runtime/` folder. Re-upload it after updating Agent3D.
- Browsers block module scripts on `file://`: opened by double-click, `index.html` shows the poster image and a note to serve the folder (`npx serve`, any static server). The `single-html` file works from `file://`.
- The result's `sizes` separate the runtime from the scene's own weight (`sceneKb`, `assetsKb`, `scriptsKb`, `posterKb`); the target's `budgetKb` applies to the latter.

## `single-html`

One `<name>.html`: the single-file runtime as an inline module, the scene in `<script type="application/json">`, assets as data: URIs in `<script type="application/json" data-assets>`, scripts as `<script type="text/agent3d-script" data-path="…">`. About 2 MB before assets (the runtime is not split); a warning is raised above 5 MB. Use it to send a file, host a standalone page, or embed in an `<iframe>`.

## The `<agent3d-scene>` element

| Attribute | Meaning |
|---|---|
| `src` | URL of `scene.json` |
| `poster` | Image shown until the first frame, and as the fallback without WebGL |
| `library-base` | Base URL of `library:` assets (default `<scene dir>/assets/library/`) |
| `aria-label` | Accessible label (written from `ariaLabel` / `title` by the export). When absent the element sets it from the scene; a label you write yourself is never overridden |

Behaviour: `display: block; width: 100%`, CSS `aspect-ratio` from `target.aspect` (or `target.height`, or `100vh` for fullscreen), `role="img"` (`role="application"` + `tabindex="0"` for games), lazy start when visible (the WebGL context is created then), pause off-screen, reduced-motion handling, pixel-ratio cap. Pages with many embeds stay under the browser's live-context cap: a non-game scene off-screen for 20 s, or the least recently seen off-screen one when 8 contexts are alive and another scene starts, frees its context and shows its last frame as an image; it rebuilds when it scrolls back into view. Events (bubbling): `agent3d-ready` (`detail.player`) and `agent3d-error` (`detail`: `{ code, message, path }`, codes such as `scene-load`, `asset-load`, `script-error`, `webgl-unavailable`).

Programmatic use without the element:

```js
import { mountScene } from "./agent3d-runtime/agent3d-runtime.js";
const player = mountScene(document.querySelector("#stage"), scene, { assetBase: "/agent3d/my-banner/" });
await player.ready;
player.pause();
```

`Player` (`src/runtime/api.ts`): `ready`, `play()`, `pause()`, `seek(t)`, `time()`, `update(scene)`, `resize()`, `stats()`, `inspect()`, `snapshot()`, `input`, `state()`, `dispose()`.

## Content-Security-Policy

| Export | Needs |
|---|---|
| embed | `script-src 'self'`, `connect-src 'self'`, `img-src 'self' blob:`; `style-src 'unsafe-inline'` when the scene has a HUD |
| single-html | also `script-src 'unsafe-inline' blob:`, `connect-src data:`, `img-src data: blob:` |

Why: the runtime is a module that imports its chunks; scene files (JSON, fonts, models, HDRIs, SVG, audio) are fetched; textures load as images and glTF embedded textures as blob: URLs; the HUD injects one `<style>`; single-html scene scripts are imported from blob: URLs. No `eval`, no third-party origin, no web fonts. Platform-specific integration (WordPress, AgentCMS, React, Next.js, Astro, Vue) is in the `agent3d-publish` skill: `plugin/skills/agent3d-publish/references/integrations.md`.

## Poster and video

Both use the headless render pipeline (deterministic time): the poster is the frame at `target.posterTime` (or `--time`), the video records `--duration` seconds (default: the timeline duration, else 5) at `--fps` with Chrome's MediaRecorder. Games render their attract mode (no input).
