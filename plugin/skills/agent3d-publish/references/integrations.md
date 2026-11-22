# Integrations

All examples assume the embed export was uploaded to `/agent3d/` at the root of the site:

```
/agent3d/agent3d-runtime/agent3d-runtime.js   (+ chunks/)
/agent3d/spring-banner/scene.json             (+ assets/, scripts/, poster.webp, CREDITS.txt)
```

Export straight into that layout with `npx -y @fleox/agent3d@0.1.0 export --project spring-banner --out ./public/agent3d --base-url /agent3d/ --json` (the `<name>` folder defaults to the project name; `--name` changes it; `--base-url` writes root-absolute URLs in the snippet, the wrappers and EMBED.md). Paste the `snippet` of the result: the examples below shorten the integrity hashes and the poster markup.

## Plain HTML

```html
<script type="module" src="/agent3d/agent3d-runtime/agent3d-runtime.js"></script>

<section class="hero">
  <div class="hero-text">
    <h1>Fresh bread every morning</h1>
    <a class="button" href="/order">Order now</a>
  </div>
  <agent3d-scene src="/agent3d/spring-banner/scene.json" poster="/agent3d/spring-banner/poster.webp"
                 aria-label="Golden Crust Bakery: a warm 3D title with floating pastries"></agent3d-scene>
</section>
```

- One `<script type="module">` per page is enough for any number of scenes; browsers run a module URL once.
- Overlaying HTML text on the scene: put both in a `position: relative` container and the text in an absolutely positioned layer; the scene keeps its aspect ratio underneath.
- Transparent scenes (`target.transparent: true`) let the page background show through.
- Caching: the runtime's chunk files have content hashes; `agent3d-runtime.js` and `scene.json` don't. Export with `--cache-bust` (runtime in `agent3d-runtime-<hash>/`, `scene.json?v=<hash>`) to cache everything for a year; otherwise long cache headers are safe for `chunks/` only.
- Personalise per page with `data-*` attributes (`data-title="Summer sale"` fills `{data.title}` in the scene) or `document.querySelector("agent3d-scene").setData({ title: "…" })`.
- `head.html` lists `<link rel="modulepreload">` for every module the runtime needs up front: put it in the `<head>` of pages with scenes for the fastest start (the snippet already preloads three.js).

## WordPress

1. Export with `--base-url /wp-content/uploads/agent3d/` and upload the export folder there: SFTP, the host's file manager, or a file-manager plugin (the media library refuses `.js` and `.json`).
2. Edit the page, add a **Custom HTML** block and paste the snippet from the export result (it already has the absolute URLs):
   ```html
   <script type="module" src="/wp-content/uploads/agent3d/agent3d-runtime/agent3d-runtime.js" integrity="sha384-…"></script>
   <agent3d-scene src="/wp-content/uploads/agent3d/spring-banner/scene.json" aspect="4:1" role="img" aria-label="…">
     <img slot="poster" src="/wp-content/uploads/agent3d/spring-banner/poster.webp" alt="…" width="1200" height="300" style="display:block;width:100%;height:auto">
   </agent3d-scene>
   ```
3. Page builders (Elementor, Divi…) have an equivalent HTML widget. Full-width: put the block in a full-width group / section.
4. Security plugins that add a CSP: allow the directives from the skill's CSP table. Caching / optimisation plugins must not "combine" or "defer" the module script (exclude `agent3d-runtime`).
5. No file access at all (some hosted plans): export `single-html`, host the file elsewhere you control and embed it with an `<iframe src="…/spring-banner.html" style="width:100%;aspect-ratio:4/1;border:0" title="…" loading="lazy"></iframe>`.

## AgentCMS

The Agent3D repository ships an AgentCMS plugin (`integrations/agentcms/`, packed as `agent3d-scene.zip`):

1. In the AgentCMS admin: **Plugins → Install**, drop `agent3d-scene.zip` (or, for a site this computer manages: `npx -y @agent-cms/agentcms@0.3.13 ext install agent3d-scene.zip --site <alias> --json`, then the same with `--yes` after showing the plan).
2. **Settings → Agent3D scenes**: pick the export folder (`dist/embed` of the project). The plugin uploads it to `agent3d/` on the site's hosting and lists the scenes it found.
3. In the post editor, insert the **Agent3D scene** block ("+" or `/`), choose a scene in the Block tab (or paste a `scene.json` URL), set the accessible label and an optional caption.
4. Publish. The published page contains the `<agent3d-scene>` element and the runtime module script; sites hosted in a sub-folder are handled.

The editor shows the poster as a preview (the live scene runs on the published page and in the admin's page preview).

## Webflow, Shopify, Squarespace, Wix

- **Webflow**: Webflow can't host `.js` / `.json` files. Upload the export folder to a static host or CDN you control (Netlify, Cloudflare Pages, S3), export with `--base-url https://<that host>/agent3d/`, serve with CORS (`Access-Control-Allow-Origin: *`), and paste the snippet in an **Embed** element.
- **Shopify**: same hosting as Webflow, then a **Custom Liquid** section (or a theme snippet) with the snippet.
- **Squarespace, Wix, Framer, Google Sites**: their embed boxes run in an iframe. Export `single-html`, host the file, embed it with `<iframe src="…/spring-banner.html" style="width:100%;aspect-ratio:4/1;border:0" title="…" loading="lazy"></iframe>`.

## React

Copy `frameworks/react/Agent3DScene.tsx` from the export into the app (it already points at the export's runtime URL):

```tsx
import { Agent3DScene } from "./Agent3DScene";

<Agent3DScene
  src="/agent3d/spring-banner/scene.json"
  poster="/agent3d/spring-banner/poster.webp"
  aspect="4:1"
  data={{ title: "Summer sale" }}
  onReady={(el) => el.pause()}
  onSceneClick={(e) => console.log(e.id)}
/>
```

- It loads the runtime once with a module script (never bundled), forwards `agent3d:*` events to typed callbacks, applies `data` live (`setData`), and works with React 17–19.
- Without the wrapper: `<agent3d-scene src=… aspect=…>` as a plain custom element; `frameworks/agent3d-scene.d.ts` types the element and its events.

## Next.js

- Put the export under `public/agent3d/` (export with `--out ./public/agent3d --base-url /agent3d/`).
- Use the React wrapper: it is a client component (`"use client"`) and loads the runtime in an effect, so it is SSR-safe. Server rendering outputs the element; the scene starts after hydration.
- Don't `import()` the runtime URL from your code: the bundler would try to bundle it.

## Astro

```astro
<agent3d-scene src="/agent3d/spring-banner/scene.json" poster="/agent3d/spring-banner/poster.webp" aria-label="…"></agent3d-scene>
<script is:inline type="module" src="/agent3d/agent3d-runtime/agent3d-runtime.js"></script>
```

`is:inline` stops Astro from bundling the script. Inside a framework island, use `client:only` (the element has no server rendering).

## Vue / Nuxt

Tell the compiler it is a custom element:

```js
// vite.config.js (Vue)
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("agent3d-") } } })
// nuxt.config.ts
export default defineNuxtConfig({ vue: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("agent3d-") } } });
```

Then use `frameworks/vue/Agent3DScene.vue` from the export (`<Agent3DScene src=… aspect=… :data="{ title: '…' }" @scene-event=… />`), or the element directly with a module script in `index.html` / `app.head`. In Nuxt, wrap it in `<ClientOnly>`.

## Svelte / SvelteKit

`frameworks/svelte/Agent3DScene.svelte` from the export, or `<agent3d-scene src=… aspect=… aria-label=…></agent3d-scene>` as is with the runtime loaded in `onMount` (or `<svelte:head><script type="module" src=…></script></svelte:head>`).

## Angular

Add `CUSTOM_ELEMENTS_SCHEMA` to the component's `schemas`, load the runtime with a module script in `index.html`, and use the snippet.

## JavaScript API and events

```js
const el = document.querySelector("agent3d-scene");
await el.ready;                                   // first frame drawn
el.pause(); el.play(); await el.seek(2);
await el.setData({ title: "Winter sale" });
el.trigger("start");                              // api.on("start") in scene scripts
el.addEventListener("agent3d:click", (e) => analytics.track("3d-click", e.detail.id));
el.addEventListener("agent3d:event", (e) => console.log(e.detail.name, e.detail.payload));
el.addEventListener("agent3d:error", (e) => console.warn(e.detail.code, e.detail.message));
```

Attributes: `autoplay="false"`, `paused`, `loop="false|true|pingpong"`, `quality="low|medium|high|auto"`, `interactive="false"`, `alt`, `aspect`. Styling: `::part(poster)`, `::part(loading)`, `::part(loading-bar)`, `::part(fallback)`, `--agent3d-loading-color`, `--agent3d-background`; `status="loading|ready|error|unsupported"` on the element.

## Content-Security-Policy in detail

What the runtime does, and the directive it needs:

| Runtime behaviour | Directive |
|---|---|
| `<script type="module" src>` + lazy `import()` of `chunks/*.js` | `script-src` with the runtime's origin (`'self'`) |
| Scene scripts (games) imported by URL from `<name>/scripts/` | `script-src` (same origin) |
| Scene scripts in single-html exports and the Studio: imported from a `blob:` URL | `script-src blob:` |
| single-html: the runtime is an inline `<script type="module">` | `script-src 'unsafe-inline'` (or its hash) |
| `fetch` of scene.json, fonts (typeface JSON), models, HDRIs, SVGs, audio | `connect-src` with the files' origin (`data:` for single-html) |
| Textures and the poster as images; glTF embedded textures as `blob:` URLs | `img-src 'self' blob:` (`data:` for single-html) |
| HUD (`ui`): one injected `<style>` element | `style-src 'unsafe-inline'` |
| The element's own styles | nothing (constructable stylesheets) |
| meshopt-compressed models (`export --optimize`): WebAssembly decoder | `script-src 'wasm-unsafe-eval'` |
| WebGL, WebAudio | nothing |

Example for an embed with a HUD: `Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank area, console "Failed to load module script" | Wrong runtime URL, or the server sends `.js` as `text/plain` | Fix the path; serve `.js` as `text/javascript` |
| Poster stays, `agent3d:error` `scene-load` | Wrong `src`, or the scene's folder moved | Check the URL of `scene.json` in the browser |
| Console "Failed to find a valid digest in the 'integrity' attribute" | The runtime folder was replaced (Agent3D update) but the page kept the old snippet | Paste the new snippet (or export with `--no-integrity`) |
| Missing model or texture | The `<name>/assets/` folder was not uploaded, or renamed | Upload the whole `<name>/` folder |
| Works locally, not on the site | CSP | Allow the directives above |
| Nothing at all from `file://` | Browsers block module scripts on `file://` | Use a local server (`serve`, or any static server) |
| Poster forever on some devices | WebGL unavailable (`webgl-unavailable`) | Expected fallback; keep a good poster |
