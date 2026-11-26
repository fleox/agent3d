# Exports and media

`agent3d export` turns a project into files for a website; `agent3d render` also writes stills, videos and animations. The engine builds export files (`buildExport` in `src/ops/export.ts`, pure); the CLI, the Studio and the MCP `export` tool write them. Run `check` first: an export refuses scenes with validation errors and missing files.

| Format | Command | Output |
|---|---|---|
| `embed` (default) | `agent3d export` | Folder for any static site (+ `EMBED.md`, framework wrappers) |
| `zip` | `agent3d export --format zip` | The same folder as one `<name>-embed.zip` (to upload or send) |
| `single-html` | `agent3d export --format single-html` | One self-contained `.html` file |
| `poster` | `agent3d export --format poster [--time 2] [--image png\|webp\|jpeg] [--scale 2] [--quality high] [--transparent]` | A still (`dist/poster.webp`), 2× pixel ratio by default |
| `video` | `agent3d export --format video [--out dist/promo.mp4] [--duration 8] [--fps 30] [--preset vertical\|square\|landscape\|story]` | MP4 (H.264) when `--out` ends in `.mp4` (or with `--preset`: `dist/video-<preset>.mp4`), else WebM (VP9) |
| `gif` | `agent3d export --format gif [--duration 4] [--fps 15]` | A looping animated GIF (`dist/animation.gif`) |

Common options: `--out <path>` (default `<project>/dist/<format>`, or the file for poster / video / gif), `--name <slug>` (scene folder / file name, default the project name), `--size WxH`, `--timeout <s>`, `--yes` (overwrite a non-empty output folder; without it the command prints a plan with the existing entries).

Embed / zip options:

| Option | Effect |
|---|---|
| `--base-url <url>` | URL of the export folder as seen from the pages (default `./`): `/wp-content/uploads/agent3d/`, `https://cdn.example.com/3d/`. The snippet, wrappers and EMBED.md use it, so the snippet works from any page depth or another origin. |
| `--cache-bust` | The runtime goes to `agent3d-runtime-<hash>/` (hash of its files) and the scene URL gets `?v=<hash>`: serve both with `Cache-Control: max-age=31536000, immutable`. Scenes exported with the same runtime share the folder. |
| `--no-integrity` | No Subresource Integrity. By default the runtime `<script>` and its preloads carry `integrity="sha384-…"`. |
| `--no-poster` | No poster / social image (no Chrome needed). The element then shows nothing before the first frame and has no fallback without WebGL. |
| `--no-og` | No `og-image.png`. |
| `--runtime auto\|full` | Also for `single-html`. `auto` (default) ships the [photo-only lite runtime](#photo-only-lite-runtime) when the scene is a single 3D photo; `full` always ships `agent3d-runtime.js`. |
| `--no-extras` | No `EMBED.md` and no `frameworks/`. |
| `--optimize` | Optimised asset copies (see `docs/assets.md`). |

## `embed`

```
dist/embed/
  agent3d-runtime/agent3d-runtime.js   the runtime entry (ES module) …
  agent3d-runtime/chunks/*.js          … three.js and lazily loaded chunks (loaders, generators, post effects, game host)
  agent3d-runtime/agent3d-photo.js     photo-only lite runtime (one file, no three.js) — what single-3D-photo scenes load
  <name>/scene.json
  <name>/assets/…                      project assets + library assets used (assets/library/…)
  <name>/scripts/…                     game scripts
  <name>/poster.webp                   2× supersampled first frame: shown before load, without WebGL, when printing
  <name>/og-image.png                  1200×630 social preview (the frame over a blurred copy of itself)
  <name>/CREDITS.txt                   licences that need attribution
  index.html                           demo page (the snippet in context, og:image meta, credits)
  snippet.html                         what to paste into a page
  head.html                            optional <link rel="modulepreload"> for every static runtime module
  EMBED.md                             for the website owner: platforms, frameworks, data bindings, API, CSP
  frameworks/react/Agent3DScene.tsx    React / Next.js client component (SSR-safe, typed)
  frameworks/vue/Agent3DScene.vue      Vue 3 / Nuxt component
  frameworks/svelte/Agent3DScene.svelte
  frameworks/agent3d-scene.d.ts        element + event types (HTMLElementTagNameMap)
```

Snippet:

```html
<link rel="modulepreload" href="./agent3d-runtime/chunks/three.module-….js" integrity="sha384-…">
<script type="module" src="./agent3d-runtime/agent3d-runtime.js" integrity="sha384-…"></script>
<agent3d-scene src="./<name>/scene.json" aspect="4:1" role="img" aria-label="…">
  <img slot="poster" src="./<name>/poster.webp" alt="…" width="1200" height="300" decoding="async" style="display:block;width:100%;height:auto">
</agent3d-scene>
```

- The `modulepreload` fetches three.js (the big static dependency) in parallel with the entry instead of after it.
- The `<img slot="poster">` is real markup: it shows (at the right aspect ratio, no layout shift) before the runtime has loaded, without JavaScript, without WebGL, from `file://` and when printing; the element fades it out after the first frame. Heroes and full-screen scenes get `fetchpriority="high"` on it: above the fold, the poster is usually the page's largest image (LCP).
- `aspect` reserves the scene's aspect ratio before `scene.json` is fetched.
- Paths are relative to the page unless `--base-url` is given. Paths inside the scene resolve against the `scene.json` URL, and `library:` assets against `<scene dir>/assets/library/` (override with the `library-base` attribute).
- Several scenes share one runtime folder. Re-upload it (and re-copy snippets: the integrity hash changes) after updating Agent3D.
- Browsers block module scripts on `file://`: opened by double-click, `index.html` shows the poster and a note to serve the folder (`npx serve`, any static server). The `single-html` file works from `file://`.
- **Page weight**: `pageKb` is what a visitor downloads for this scene — the runtime entry, its static imports and only the lazy chunks this scene loads (decided from its features: post effects, generators, text, models, SVG, sky, HDRI, game / physics / audio…; a chunk of unknown feature counts as loaded) + `scene.json` + assets + scripts + poster. `pageKbGzip` is the same compressed with gzip (what a server sending `Content-Encoding: gzip` transfers). `og-image.png`, `EMBED.md`, `frameworks/`, `index.html` and unused chunks are not part of it. `folderKb` (= `totalKb`) is every file written. `page` lists the runtime files loaded (`runtimeFiles`), the chunks this scene never loads (`skippedChunks`) and `unknownChunks`.
- `--prune-runtime` copies only the chunks this scene loads (smaller folder). Use it only when the runtime folder serves this scene alone: another scene of the site sharing `agent3d-runtime/` may need the left-out chunks, and so may this scene after an edit that adds a feature (re-export then). When a chunk's feature is unknown, every chunk is kept (info `prune-runtime`).
- The result's `runtime` is `"photo-lite"` or `"full"` (with `runtimeReasons`: why not the lite runtime).
- The result's `sizes` separate the runtime from the scene's own weight (`sceneKb`, `assetsKb`, `scriptsKb`, `posterKb`); the target's `budgetKb` applies to the latter. `head` lists every preload, `integrity` the entry's hash, `runtimeDir` the runtime folder.

## Photo-only lite runtime

A scene that is just a 3D photo — the common "3D photo hero" — does not need three.js. `dist/runtime/agent3d-photo.js` (built from `src/runtime/lite/` by `vite build --config vite.runtime.config.ts --mode photo`, part of `npm run build:runtime`) is one ES module of about 19 KB gzipped instead of about 210 KB for `agent3d-runtime.js` + three.js. `export` (embed, zip, single-html) ships it instead of the full runtime when the scene is eligible (`liteRuntimeEligibility` in `src/ops/liteRuntime.ts`) and `--runtime` is `auto` (default):

- exactly one object, a `photo` in `parallax` mode (or without `depth`: a flat photo), visible, not rotated, positive scale, no children, behaviours, `href`, `body` or `attach`, `material.color` (if any) a `#hex` colour;
- a `perspective` camera without `controls` (or `"none"`), `autoRotate`, `shots`, `shake`, `lookAt`, `follow`;
- `environment.background` a `#hex` colour or `"transparent"`; no `ground`, `contactShadows`, `rig`; no `rect` lights or volumetric spots (other lights are allowed: the photo is unlit);
- no `timeline`, `interactions`, `postfx`, `physics`, `scripts`, `ui` elements, `audio`; no `{data.*}` placeholder; not a `game`.

The snippet then loads `agent3d-runtime/agent3d-photo.js` (with its integrity hash, no `modulepreload`); `pageKb` / `pageKbGzip` / `page.runtimeKb` count that file only. Anything else (or `--runtime full`) uses the full runtime, and the result lists the reasons in `runtimeReasons`. The embed folder still contains the full runtime (the folder is shared by every scene of the site) unless `--prune-runtime` is given.

What the lite runtime does: it defines the same `<agent3d-scene>` element (the shared implementation in `src/runtime/elementBase.ts`: `src`, inline scene, `<img slot="poster">` faded out after the first frame, `aspect`, `alt`, `role` / `aria-label`, `paused` / `autoplay`, `quality`, `library-base`, `play()` / `pause()` / `seek()` / `reload()` / `ready`, `agent3d:ready` / `agent3d:error` / `agent3d:progress`, `status`, `::part()`s, print, context-loss recovery) and renders the photo with raw WebGL2: one full-canvas triangle whose fragments cast the scene camera's rays onto the photo plane and run the same relief-mapping shader as the full runtime (`src/runtime/build/photoCore.ts`), with the same motion (pointer, gyro, scroll, auto drift, smoothing, reduced motion), quality tier, pixel-ratio cap, lazy start and off-screen pause. Pixels match the full runtime (mean difference below 0.1 / 255 in `agent/render/photoLite.e2e.test.ts`). Without WebGL2 the poster stays (`status="unsupported"`). If a page loads only the lite runtime and also shows a scene it cannot render, that element imports `agent3d-runtime.js` from the same folder and renders through it — so a site may mix both runtimes on one page. Not in the lite runtime: `Player.inspect()` returns no objects, `pick()` is null, there is no off-screen WebGL context release (one context per lite scene).

## `single-html`

One `<name>.html`: the single-file runtime (or the photo-only lite runtime for an eligible scene) as an inline module, the scene in `<script type="application/json">`, assets as data: URIs in `<script type="application/json" data-assets>`, scripts as `<script type="text/agent3d-script" data-path="…">`. About 1.8 MB before assets (the runtime is not split); a warning is raised above 5 MB. Use it to send a file, host a standalone page, or embed in an `<iframe>` (Squarespace, Wix, Framer, Google Sites embed boxes).

## The `<agent3d-scene>` element

| Attribute | Meaning |
|---|---|
| `src` | URL of `scene.json` (or an inline `<script type="application/json">` child) |
| `poster` / `<img slot="poster">` | Image until the first frame; fallback without WebGL, on errors and when printing |
| `aspect` | `W:H` reserved before the scene loads; the scene's `target.aspect` wins once loaded |
| `alt` | Text alternative of the poster fallback (default: `aria-label`) |
| `autoplay="false"` | Load and show the first frame, play on `play()` |
| `paused` | Paused while present; removing it resumes |
| `loop="true\|false\|pingpong"` | Overrides `timeline.loop` |
| `quality="low\|medium\|high\|auto"` | Page-side override: pixel-ratio cap 1 / 1.5 / 2; `low` also drops antialiasing, shadows and post effects; `auto` picks from the device (cores, memory, Save-Data). It caps what the scene's own `target.quality` tier ([scene-format.md](scene-format.md#quality-tiers)) allows; it does not select a tier |
| `interactive="false"` | The canvas ignores the pointer (page scroll and clicks pass through) |
| `data-*` | Data bindings (below) |
| `library-base` | Base URL of `library:` assets (default `<scene dir>/assets/library/`) |
| `aria-label` | Accessible label (written by the export from `ariaLabel` / `title`). When absent the element sets it from the scene; a label you write is never overridden |

Behaviour: `display: block; width: 100%` and `aspect-ratio` (or `target.height`, or `100vh` for fullscreen) as `:host` styles, so page CSS on the element wins; `role="img"` (`role="application"` + `tabindex="0"` for games); lazy start when visible (the WebGL context is created then); pause off-screen and in background tabs; `prefers-reduced-motion` (still frame for banners / heroes); pixel-ratio cap; a thin loading bar after 400 ms (determinate from asset progress) — no layout shift. Pages with many embeds stay under the browser's live-context cap: a non-game scene off-screen for 20 s, or the least recently seen off-screen one when 8 contexts are alive and another scene starts, frees its context and shows its last frame as an image; it rebuilds when it scrolls back into view. A real WebGL context loss (GPU reset) is recovered (restore, or a fresh canvas after 3 s). Removing the element disposes everything (geometries, materials, textures, shadow maps, the context); re-inserting it remounts. When printing, the current frame (or the poster) is printed instead of the canvas.

The element carries `status="loading|ready|error|unsupported"` (style hooks).

JavaScript API:

```js
const el = document.querySelector("agent3d-scene");
const player = await el.ready;      // after the first frame
el.pause(); el.play(); await el.seek(2.5);
await el.setData({ title: "Winter sale" });   // rebinds {data.*} placeholders
el.data;                            // scene.data + data-* + setData
el.trigger("start", { level: 2 });  // api.on("start") in the scene's scripts
await el.reload();                  // re-fetch scene.json
```

DOM events (bubbling, composed):

| Event | `detail` |
|---|---|
| `agent3d:ready` | `{ player }` |
| `agent3d:error` | `{ code, message, path? }` — `scene-load`, `asset-load`, `script-error`, `webgl-unavailable`, `context-lost`, … |
| `agent3d:event` | `{ name, payload }` — scripts' `api.emit`, HUD button actions, `trigger()` |
| `agent3d:click` | `{ id, x, y }` — the object clicked (top-level or nearest interactive), `null` for the background; x / y in -1..1 |
| `agent3d:progress` | `{ loaded, total }` — asset loading |

`agent3d-ready` / `agent3d-error` are still dispatched for older pages.

Styling: `agent3d-scene::part(poster)`, `::part(poster-image)`, `::part(loading)`, `::part(loading-bar)`, `::part(fallback)`; custom properties `--agent3d-background` (behind the canvas while loading), `--agent3d-loading-color` (default `currentColor`), `--agent3d-poster-fit` (`cover`), `--agent3d-fade` (`.4s`). Custom no-WebGL content: a child with `slot="fallback"`.

### Data bindings

Text objects' `text`, any object's `href`, the scene `title` / `ariaLabel` and HUD texts may contain `{data.key}` placeholders (`{data.a.b}` for nested keys, `{data.cta|Shop now}` for a fallback). Values come from `scene.data`, overridden by `data-*` attributes (`data-cta-label` → `ctaLabel`, `data-json='{"price": 9}'` merges an object) and `setData()`. The substitution runs on a copy of the scene before the world is built (`bindSceneData`, `src/runtime/data.ts`), so renders, exports and the Studio show the values from `scene.data`. Scripts read the merged values as `api.data`.

```html
<agent3d-scene src="./sale/scene.json" data-title="Summer sale" data-price="-30%"></agent3d-scene>
```

### Programmatic use without the element

```js
import { mountScene } from "./agent3d-runtime/agent3d-runtime.js";
const player = mountScene(document.querySelector("#stage"), scene, {
  assetBase: "/agent3d/my-banner/",
  onEvent: (name, payload) => {}, onClick: (id, point) => {}, onProgress: (loaded, total) => {},
});
await player.ready;
player.pause();
```

`Player` (`src/runtime/api.ts`): `ready`, `play()`, `pause()`, `seek(t)`, `time()`, `update(scene)`, `resize()`, `stats()`, `inspect()`, `snapshot()`, `input`, `state()`, `emit()`, `dispose()`. `globalThis.Agent3D` = `{ mountScene, version, bindSceneData, liveContexts }`.

## Frameworks and platforms

`EMBED.md` (generated with the right URLs) covers: plain HTML and static hosts, WordPress (Custom HTML block + uploaded folder, `--base-url /wp-content/uploads/agent3d/`), Webflow (Embed element, files on your own host / CDN), Shopify (Custom Liquid section), Squarespace / Wix / Framer / Google Sites (single-html in an iframe), AgentCMS (the Agent3D scene block), React / Next.js (`frameworks/react/Agent3DScene.tsx`: `"use client"`, loads the runtime with a module script once, props for every attribute, `data` applied live, `onReady` / `onError` / `onSceneEvent` / `onSceneClick`), Vue / Nuxt (`isCustomElement`, `<ClientOnly>`), Svelte / SvelteKit, Angular (`CUSTOM_ELEMENTS_SCHEMA`). The `agent3d-publish` skill has step-by-step versions: `plugin/skills/agent3d-publish/references/integrations.md`.

## Content-Security-Policy

| Export | Needs |
|---|---|
| embed | `script-src 'self'`, `connect-src 'self'`, `img-src 'self' blob:`; `style-src 'unsafe-inline'` when the scene has a HUD; `script-src 'wasm-unsafe-eval'` when a model is meshopt-compressed (`assets optimize`, `export --optimize`) |
| single-html | also `script-src 'unsafe-inline' blob:`, `connect-src data:`, `img-src data: blob:` |

Why: the runtime is a module that imports its chunks; scene files (JSON, fonts, models, HDRIs, SVG, audio) are fetched; textures load as images and glTF embedded textures as blob: URLs; the HUD injects one `<style>`; single-html scene scripts are imported from blob: URLs. The element's own styles are constructable stylesheets (`adoptedStyleSheets`), not subject to `style-src`. No `eval` / `new Function` (verified on the built runtime), no workers, no third-party origin, no web fonts. Integrity: the snippet's `integrity` works with `require-sri-for`-style policies; chunks loaded later by `import()` are same-origin files of the same folder. The policy printed in `EMBED.md` is a slightly wider, copy-paste-safe superset (it also allows `data:` / `blob:` in `img-src` / `connect-src` and `worker-src 'self' blob:`); the table above is the minimum.

## Media from `render` and `export`

Every frame is seeked exactly with the deterministic player, so any fps, duration and size work and nothing is dropped however slow the software renderer is.

```bash
agent3d render --video promo.mp4 --fps 30 --duration 6 --size 1920x1080 --quality high
agent3d render --video promo.webm --duration 6            # VP9
agent3d render --gif banner.gif --duration 4 --fps 15     # 640 px wide by default
agent3d render --webp banner.webp --duration 4            # animated WebP (smaller, alpha)
agent3d render --frames 2 --size 2400x600 --quality ultra --transparent   # alpha PNG still, 3× supersampled
agent3d render --scroll 0.5                               # a scroll-driven scene half-way down the page (one frame)
```

- **MP4**: H.264 High profile through WebCodecs in headless Chrome, muxed by `agent/render/mp4.ts` (fast start: plays while downloading). Google Chrome / Edge have the encoder; some Chromium builds don't — the error says to render a `.webm` instead.
- **WebM**: VP9 through WebCodecs (key frame every 2 s); without WebCodecs, VP8 key frames taken from WebP stills.
- **GIF**: pure-TS encoder (`agent/render/gif.ts`): one global median-cut palette, ordered dithering (stable across frames), frame differencing (unchanged pixels transparent, frames cropped to the changed rectangle), exact delays, infinite loop. Transparent scenes keep their alpha.
- **Animated WebP**: WebP stills muxed into one file (`agent/render/webpAnim.ts`), alpha kept.
- **`--quality`**: `draft` / `standard` render at 1×, `high` at 2× and `ultra` at 3× the pixel ratio, then downscale with a box filter in the page (supersampling), clamped to 4096 px per side.
- **`--transparent`**: forces a transparent canvas (alpha PNG / GIF / WebP stills of a scene that has a background). Opaque formats (MP4, WebM, JPEG) draw transparent scenes over `--bg` (white by default).
- **`--scroll p`**: uses `Player.setScrollProgress` when the runtime has it, else renders the time the deterministic player maps to that progress.
- Video bitrate defaults from size × fps × quality (`--bitrate <Mbit/s>` overrides). Videos capture the WebGL canvas only (not the HUD).

### Social video presets

```bash
agent3d render --video reel.mp4 --preset vertical          # 1080×1920, one seamless loop of the photo move
agent3d export --format video --preset square              # dist/video-square.mp4
agent3d render --preset vertical --count 4 --sheet         # PNG frames of that framing first
```

| Preset | Size | For |
|---|---|---|
| `vertical` | 1080×1920 (9:16) | Reels, TikTok, Shorts, LinkedIn / Instagram vertical video |
| `square` | 1080×1080 (1:1) | Instagram / LinkedIn / Facebook feed |
| `landscape` | 1920×1080 (16:9) | YouTube, LinkedIn, X, websites |
| `story` | 1080×1920 (9:16), at most 15 s | Instagram / Facebook stories |

A preset sets the size, 30 fps, the bitrate (10 Mbit/s at 1080p, 8 for square: H.264 that LinkedIn / Instagram re-encode without visible loss) and the duration: **one seamless loop** of the first 3D photo's `motion.auto` (10 / `speed` seconds; a one-way move: its `duration`; `orbit` starts one cycle in, where its loop is steady), else the timeline duration, else 5 s. `--duration`, `--fps`, `--size`, `--bitrate` still override.

**Cover fit** (default with a preset when the scene has a 3D photo; `--fit cover|contain`): the frame's aspect rarely matches the scene's. The render uses the frame's aspect as `target.aspect` (the runtime keeps the vertical field of view and crops the sides), then tightens the camera (`fov` / ortho `zoom`) until every top-level photo facing the camera fills the frame, with a margin for `mesh` tilts — the photo's edges never show. The result's `notes` say what happened ("The scene (16:9) is cropped to 9:16 …", "Camera tightened 1.12× …", "Duration 10 s: one loop of …"). Text and objects laid out for 16:9 can be cut in 9:16: look at the frames. `--fit contain` keeps the runtime's own fit (a narrower frame widens the view, so the background shows around the photo).
- AVIF posters: Chrome cannot encode AVIF from a canvas yet, so exports ship WebP posters (`posterAvif` is accepted by `buildExport` when a host can provide one).

## Runtime size

`dist/runtime` is built by `vite.runtime.config.ts` with full minification and the catalog's prose stripped (validation and docs keep it). What a page downloads before the first frame is the entry plus its static imports (three.js, catalog, materials, utilities): about 220 KB gzipped (about 19 KB for a single-3D-photo scene, which gets the [photo-only lite runtime](#photo-only-lite-runtime)); everything else (loaders, post effects, generators, physics / HUD / audio, shader materials) is a lazy chunk loaded only by scenes that use it.
