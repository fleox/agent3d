# Integrations

All examples assume the embed export was uploaded to `/agent3d/` at the root of the site:

```
/agent3d/agent3d-runtime/agent3d-runtime.js   (+ chunks/)
/agent3d/spring-banner/scene.json             (+ assets/, scripts/, poster.webp, CREDITS.txt)
```

Export straight into that layout with `python3 <skill dir>/scripts/agent3d.py export --project spring-banner --out ./public/agent3d --json` (the `<name>` folder defaults to the project name; `--name` changes it).

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
- Caching: the runtime's chunk files have content hashes; `agent3d-runtime.js` and `scene.json` don't. Long cache headers are safe for `chunks/` only.

## WordPress

1. Upload the export folder to the server: SFTP, the host's file manager, or a file-manager plugin, e.g. to `wp-content/uploads/agent3d/` (the media library refuses `.js` and `.json`).
2. Edit the page, add a **Custom HTML** block and paste the snippet with absolute URLs:
   ```html
   <script type="module" src="/wp-content/uploads/agent3d/agent3d-runtime/agent3d-runtime.js"></script>
   <agent3d-scene src="/wp-content/uploads/agent3d/spring-banner/scene.json" poster="/wp-content/uploads/agent3d/spring-banner/poster.webp" aria-label="…"></agent3d-scene>
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

## React

```jsx
import { useEffect } from "react";

export function Agent3DScene({ src, poster, label }) {
  useEffect(() => {
    // Load the runtime once, on the client only (it defines <agent3d-scene>).
    if (!customElements.get("agent3d-scene")) {
      const s = document.createElement("script");
      s.type = "module";
      s.src = "/agent3d/agent3d-runtime/agent3d-runtime.js";
      document.head.appendChild(s);
    }
  }, []);
  return <agent3d-scene src={src} poster={poster} aria-label={label} />;
}
```

- React 19 passes attributes to custom elements as is; with React 18 use plain string attributes as above (no objects).
- TypeScript: declare the element once.
  ```ts
  declare module "react" {
    namespace JSX {
      interface IntrinsicElements {
        "agent3d-scene": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; poster?: string };
      }
    }
  }
  ```
- Listen to `agent3d-ready` with a ref (`ref.current.addEventListener("agent3d-ready", e => e.detail.player.pause())`).

## Next.js

- Put the export under `public/agent3d/`.
- Load the runtime with `next/script` (`<Script type="module" src="/agent3d/agent3d-runtime/agent3d-runtime.js" strategy="afterInteractive" />`) in the layout or the page, and render `<agent3d-scene …>` in a client component (`"use client"`). Don't `import()` the runtime URL from your code: the bundler would try to bundle it (if you must, use `import(/* webpackIgnore: true */ "/agent3d/agent3d-runtime/agent3d-runtime.js")`).
- Server rendering outputs the empty element and the poster attribute; the scene starts after hydration.

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

Load the runtime with a module script in `index.html` / `app.head`, or in `onMounted`. In Nuxt, wrap the element in `<ClientOnly>`.

## Svelte / SvelteKit

`<agent3d-scene src=… poster=… aria-label=…></agent3d-scene>` works as is; load the runtime in `onMount` (or `<svelte:head><script type="module" src=…></script></svelte:head>`).

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
| WebGL, WebAudio | nothing |

Example for an embed with a HUD: `Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank area, console "Failed to load module script" | Wrong runtime URL, or the server sends `.js` as `text/plain` | Fix the path; serve `.js` as `text/javascript` |
| Poster stays, `agent3d-error` `scene-load` | Wrong `src`, or the scene's folder moved | Check the URL of `scene.json` in the browser |
| Missing model or texture | The `<name>/assets/` folder was not uploaded, or renamed | Upload the whole `<name>/` folder |
| Works locally, not on the site | CSP | Allow the directives above |
| Nothing at all from `file://` | Browsers block module scripts on `file://` | Use a local server (`serve`, or any static server) |
| Poster forever on some devices | WebGL unavailable (`webgl-unavailable`) | Expected fallback; keep a good poster |
