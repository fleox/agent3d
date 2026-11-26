---
name: agent3d-publish
description: Export an Agent3D scene and put it on a website - embed folder (Web Component + static files + generated React / Vue / Svelte wrappers and EMBED.md), zip, single HTML file, poster, MP4 / WebM video, GIF or animated WebP; paste the snippet in plain HTML, WordPress, Webflow, Shopify, AgentCMS, React / Next.js / Astro / Vue / Svelte; personalise texts with data-* attributes, drive it from JavaScript (play, pause, seek, setData, events), base URL, cache-busting, integrity, performance and accessibility checklist, and the Content-Security-Policy the runtime needs. Use when the user wants to publish, embed, ship, download or share a 3D scene they built with Agent3D, or asks why it does not show on their site.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge) for renders.
metadata:
  version: "0.4.0"
  repository: "https://github.com/fleox/agent3d"
allowed-tools: Bash Read Write
---

# Publish an Agent3D scene

**Language:** talk to the user in their language; keep commands, code and files in English.

Every command is `npx -y @fleox/agent3d@0.4.0 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Before exporting

```bash
npx -y @fleox/agent3d@0.4.0 check --project my-banner --render --json
```

No errors, no warnings (or warnings the user accepted). Keep the `licences` list: credits ship in the export.

## Formats

| Format | Command | Gives | Use it for |
|---|---|---|---|
| `embed` (default) | `export --project my-banner` | `<project>/dist/embed/`: `agent3d-runtime/` (shared), `<name>/` (scene.json, assets, scripts, poster.webp, og-image.png, CREDITS.txt), `index.html` (demo), `snippet.html`, `head.html`, `EMBED.md` (for the website owner), `frameworks/` (React / Vue / Svelte wrappers + `agent3d-scene.d.ts`) | Any website you can upload files to; several scenes share one runtime |
| `zip` | `export --format zip --project my-banner` | the embed folder as one `dist/zip/<name>-embed.zip` | Handing the export to someone, uploading through a file manager |
| `single-html` | `export --format single-html --project my-banner` | one `dist/single-html/<name>.html` with the runtime, the scene and the assets inline (data: URIs) — about 2 MB minimum (the runtime is not split) | Sending a file, a standalone page, an `<iframe>` in Squarespace / Wix / Framer |
| `poster` | `export --format poster --project my-banner` | `dist/poster.webp` at `target.posterTime` (`--time 2`), 2× pixel ratio (`--scale`); `--image png\|jpeg`, `--quality high\|ultra`, `--transparent` (png / webp) | Social images, email, a fallback |
| `video` | `export --format video --project my-banner` | `dist/video.webm` (VP9), or MP4 (H.264) when `--out` ends in `.mp4`; `--duration`, `--fps`, `--size`, `--quality` | Social posts, presentations, places that can't run WebGL |
| `gif` | `export --format gif --project my-banner` | `dist/animation.gif` (looping, 640 px wide, 15 fps by default) | Email, chat, READMEs |

Every asset the scene uses is copied into the export (never hotlinked): a 3D photo ships its photo and its depth PNG (`<name>/assets/textures/…`, `<name>/assets/depth/…`), never the depth model. `CREDITS.txt` lists the depth map with the photo's licence and author.

Default outputs land in `<project>/dist/`. A relative `--out` is resolved from the **project folder** (like every output path of `render` and `export`): `--project my-banner --out dist/promo.mp4` writes `my-banner/dist/promo.mp4`; absolute paths are kept.

```bash
npx -y @fleox/agent3d@0.4.0 export --project my-banner --json
npx -y @fleox/agent3d@0.4.0 export --project my-banner --name spring-banner --out ./site/agent3d --json
npx -y @fleox/agent3d@0.4.0 export --project my-banner --base-url /wp-content/uploads/agent3d/ --cache-bust --out ./wp --json
npx -y @fleox/agent3d@0.4.0 export --project my-banner --optimize --json
npx -y @fleox/agent3d@0.4.0 export --format zip --project my-banner --json
npx -y @fleox/agent3d@0.4.0 export --format single-html --project my-banner --json
npx -y @fleox/agent3d@0.4.0 export --format poster --time 2 --image png --quality high --transparent --project my-banner --json
npx -y @fleox/agent3d@0.4.0 export --format video --out dist/promo.mp4 --duration 8 --fps 30 --size 1920x1080 --project my-banner --json
npx -y @fleox/agent3d@0.4.0 export --format gif --duration 4 --project my-banner --json
```

Embed / zip options:

| Option | Effect |
|---|---|
| `--name <slug>` | The scene folder / file name (default: the project name) |
| `--base-url <url>` | The snippet, the framework wrappers and EMBED.md use this base (the folder's final location: `/wp-content/uploads/agent3d/`, `https://cdn.example.com/3d/`), so the snippet works from pages at any depth or another origin |
| `--cache-bust` | Runtime in `agent3d-runtime-<hash>/` and `scene.json?v=<hash>`: serve both with `Cache-Control: max-age=31536000, immutable` |
| `--no-integrity` | Drops the Subresource Integrity hashes (`integrity="sha384-…"` on the runtime script and preloads, default on) |
| `--optimize` | Optimised copies of the assets in the export only (the project is untouched): textures resized to what the scene needs, `.glb` geometry meshopt-compressed with WebP textures (the result's `optimized` lists before / after bytes). Texture work needs Chrome. Meshopt models need `'wasm-unsafe-eval'` in a CSP (below) |
| `--no-poster` | No poster nor og-image (no Chrome needed). The element then shows nothing until the first frame and has no fallback without WebGL: prefer keeping it |
| `--no-og` | No `<name>/og-image.png` (1200×630 social preview). To use it, add `<meta property="og:image" content="https://<site>/…/<name>/og-image.png">` and `<meta name="twitter:card" content="summary_large_image">` to the page head — crawlers need an absolute URL (the demo `index.html` uses a relative one) |
| `--no-extras` | No `EMBED.md` and no `frameworks/` |
| `--runtime auto\|full` | `auto` (default, also for `single-html`): a scene that is a single 3D photo (one `photo` object in parallax mode or without depth, fixed perspective camera, `#hex` or transparent background, no timeline / interactions / postfx / scripts / text) ships the photo-only lite runtime `agent3d-photo.js` (~14 KB gzipped, no three.js) instead of ~210 KB. `full` forces `agent3d-runtime.js` |

- **Page weight**: for a brief like "under 300 KB", quote `pageKb` / `pageKbGzip` from the export result (what a visitor downloads for this scene, runtime chunks included — `folderKb` counts every file written, unused chunks too). `--prune-runtime` copies only the chunks this scene loads (a smaller folder to upload) — only when this runtime folder serves this scene alone; other scenes sharing `agent3d-runtime/` may need the chunks it leaves out.
- **3D photo heroes**: check the result's `runtime`. `"photo-lite"` = the light runtime (the snippet loads `agent3d-runtime/agent3d-photo.js`); `"full"` comes with `runtimeReasons` (e.g. `"post effects (postfx)"`, `"2 objects (the lite runtime shows exactly one photo)"`). When the brief is about page weight and the reasons are cosmetic (a vignette, a 3D headline that could be HTML text over the element), tell the user what removing them would save. The lite and full runtimes render the same pixels.
- Exporting again into a non-empty folder prints a plan (`needsConfirmation`, with the existing entries): re-run with `--yes` after the user agreed.
- The result gives `snippet`, `head` (all modulepreload links), `integrity`, `runtimeDir`, `out`, `entry` (the demo page, or the zip / html file), `pageKb` / `pageKbGzip` (what a visitor downloads for this scene: the runtime entry + the lazy chunks it uses + scene, assets, scripts, poster — quote this one as the page weight), `folderKb` (= `totalKb`, every file written, all chunks and og-image included), `page` (runtime files loaded / chunks skipped), `runtime` (`photo-lite` or `full`, + `runtimeReasons`), `sizes` (`runtimeKb`, `sceneKb`, `assetsKb`, `scriptsKb`, `posterKb`), `credits`, `issues` (+ `optimized` with `--optimize`). Media formats return `{ format, path, codec?, frames?, fps?, duration?, size, bytes }`.

Media straight from `render` (frame-exact, any size / fps; LOOK at a few frames of the result):

```bash
npx -y @fleox/agent3d@0.4.0 render --video renders/promo.mp4 --duration 6 --size 1920x1080 --quality high --project my-banner --json
npx -y @fleox/agent3d@0.4.0 render --gif renders/banner.gif --duration 4 --project my-banner --json
npx -y @fleox/agent3d@0.4.0 render --webp renders/banner.webp --duration 4 --project my-banner --json
npx -y @fleox/agent3d@0.4.0 render --frames 2 --size 2400x600 --quality ultra --transparent --project my-banner --json
npx -y @fleox/agent3d@0.4.0 render --scroll 0.5 --project my-scroll-story --json
```

`--quality high|ultra` supersamples 2× / 3× (smoother edges), `--transparent` gives alpha PNG / GIF / WebP, `--scroll 0.5` holds a scroll-driven scene at that scroll progress, `--fps` / `--start` / `--bitrate` tune videos, `--yes` overwrites an existing media file. `--video`, `--gif` and `--webp` paths (like `--out`) are relative to the project folder. MP4 needs Google Chrome or Edge (H.264 encoder); with Chromium, render `.webm`. Videos and posters capture the WebGL canvas only (no HUD).

Scenes whose timeline waits for the visitor (`autoplay: false`, `trigger: "manual"` / `"click"`, segments played by interactions) are still at t = 0 in a plain render: film the segment with `--segment`, or play the interaction with `--input` (frames, `--video`, `--gif` and `--webp` all apply it):

```bash
npx -y @fleox/agent3d@0.4.0 render --video renders/celebrate.webm --segment celebrate --duration 4 --project my-mascot --json
npx -y @fleox/agent3d@0.4.0 render --sheet --frames 0,1,2,3 --input '[{"t": 0, "segment": "celebrate"}]' --project my-mascot --json
```

`--reduced-motion` renders what visitors with prefers-reduced-motion see.

## The snippet

```html
<link rel="modulepreload" href="./agent3d-runtime/chunks/three.module-….js" integrity="sha384-…">
<script type="module" src="./agent3d-runtime/agent3d-runtime.js" integrity="sha384-…"></script>
<agent3d-scene src="./my-banner/scene.json" aspect="4:1" role="img" aria-label="Golden Crust Bakery: a warm 3D title with floating pastries">
  <img slot="poster" src="./my-banner/poster.webp" alt="Golden Crust Bakery: a warm 3D title with floating pastries" width="1200" height="300" decoding="async" style="display:block;width:100%;height:auto">
</agent3d-scene>
```

Always paste the snippet from the export result (hashes and file names change with every runtime build).

- Paths are relative to the page unless the export used `--base-url`. Asset paths inside the scene resolve against the `scene.json` URL, so the `<name>/` folder must stay intact.
- The `<img slot="poster">` shows before the runtime loads, without JavaScript / WebGL and when printing, at the right size (no layout shift); keep it.
- The element is `display: block; width: 100%` and keeps the scene's aspect ratio, or `target.height` when set. Size it with its container (`max-width`, grid column…); CSS on the element wins.
- It loads lazily (starts when visible), pauses off-screen, caps the pixel ratio, freezes on the poster frame for visitors who prefer reduced motion, recovers from a lost GPU context, frees everything when removed (SPAs).
- Attributes: `src`, `poster` (or the `<img slot="poster">`), `aspect` (reserved before scene.json loads), `alt`, `autoplay="false"`, `paused`, `loop="false|true|pingpong"`, `quality="low|medium|high|auto"` (pixel-ratio cap 1 / 1.5 / 2; `low` also drops antialiasing, shadows and post effects), `interactive="false"` (page scroll and clicks pass through), `library-base`, `aria-label`, `data-*` (below). The element reflects `status="loading|ready|error|unsupported"`.
- JavaScript: `const player = await el.ready` (after the first frame), `el.play()`, `el.pause()`, `await el.seek(t)`, `await el.setData({...})`, `el.data`, `el.trigger(name, payload)` (scene scripts' `api.on(name)`, `{ "on": "event" }` interactions), `await el.reload()`. Events (bubbling): `agent3d:ready` (`{ player }`), `agent3d:error` (`{ code, message, path? }`), `agent3d:event` (`{ name, payload }`: scripts' `api.emit`, HUD actions, timeline markers, interaction `emit`), `agent3d:click` (`{ id, x, y }`: the object clicked, `null` for the background), `agent3d:progress` (`{ loaded, total }`).
- Styling: `::part(poster)`, `::part(loading)`, `::part(loading-bar)`, `::part(fallback)`, `--agent3d-background`, `--agent3d-loading-color`, `--agent3d-poster-fit`, `--agent3d-fade`; a child with `slot="fallback"` replaces the no-WebGL fallback.
- The same runtime folder serves every scene of the site: upload it once, re-upload it after updating Agent3D.

## Personalised scenes (data bindings)

Write `{data.key}` in a text object's `text` (or an `href`), give defaults in `scene.data`, and the page fills them per embed — no re-export:

```bash
npx -y @fleox/agent3d@0.4.0 scene patch --project my-banner '[{"op":"set","path":"data","value":{"title":"Spring sale"}},{"op":"updateObject","id":"title","set":{"text":"{data.title}"}}]' --json
```

```html
<agent3d-scene src="./my-banner/scene.json" data-title="Summer sale −30%"></agent3d-scene>
```

Placeholders work in text objects' `text`, any object's `href` and HUD texts. `{data.cta|Shop now}` has a fallback; `data-cta-label` maps to `ctaLabel`; `data-json='{"price": 9}'` merges an object; `el.setData({ title: "…" })` changes it live; scripts read the merged values as `api.data`. Renders and posters show the `scene.data` defaults (the poster is rendered once, at export): pick defaults that look right on their own. Leave layout room for the longest value a page may pass — a longer `data-title` widens the text (or wraps with `maxWidth`, growing the block up and down around its position). Keep the scene `title` / `ariaLabel` free of placeholders: the export copies them as written into the snippet's `aria-label` / `alt`, `index.html` and EMBED.md.

## Where it goes

Step-by-step per platform (plain HTML, WordPress, AgentCMS, React / Next.js, Astro, Vue / Nuxt, Svelte, static hosts and CDNs): [references/integrations.md](references/integrations.md). In short:

- **Plain HTML / static hosts** (Netlify, GitHub Pages, Cloudflare Pages, S3): copy the export folder next to the page, paste the snippet. Open `index.html` of the export through a local server (`npx -y @fleox/agent3d@0.4.0 serve --project my-banner` previews the project; module scripts don't run from `file://`: opened that way, the demo page only shows the poster and a note asking for a web server).
- **WordPress**: export with `--base-url /wp-content/uploads/agent3d/`, upload the export folder there (SFTP / the host's file manager), then a **Custom HTML** block with the snippet. The media library refuses `.js` / `.json` files.
- **Webflow / Shopify**: host the folder on a static host or CDN, export with `--base-url https://…/`, paste the snippet in an Embed element / Custom Liquid section.
- **Squarespace / Wix / Framer**: `single-html` in an `<iframe>`.
- **AgentCMS**: install the **Agent3D scene** plugin (`integrations/agentcms/agent3d-scene.zip` in the Agent3D repository): it uploads an export folder from its settings page and adds an "Agent3D scene" editor block.
- **React / Next.js / Vue / Svelte**: the export's `frameworks/` folder has ready components (`Agent3DScene.tsx` is a typed, SSR-safe client component); Astro: the snippet with `is:inline`. Details in the reference; the export's `EMBED.md` has the same for the website owner.

## Checklist before handing over

- [ ] `check` clean; rendered and looked at; the poster frame is complete (nothing hidden by an entrance animation).
- [ ] `aria-label` describes the scene in one sentence (from `ariaLabel` or `title`); purely decorative scenes can say so ("Decorative animated background").
- [ ] Important text is also in the HTML of the page (search engines and screen readers don't read WebGL).
- [ ] `target.reducedMotion` is `static` for banners and heroes (default), `ignore` only for games.
- [ ] Size: `sizes` minus `runtimeKb` is within the target budget (`export --optimize` shrinks textures and models); the poster is a few tens of KB.
- [ ] Phones: rendered at phone width (`render --size 390x98` for a 4:1 banner) and the text is readable.
- [ ] Credits: `CREDITS.txt` lines are shown on the site when a licence requires attribution.
- [ ] The page's Content-Security-Policy allows the runtime (below).

## Content-Security-Policy

The runtime never calls third-party hosts, uses no `eval` / `new Function`, and needs no web fonts: no `'unsafe-eval'`, ever. `'wasm-unsafe-eval'` is needed only for meshopt-compressed models (`export --optimize`, `assets optimize`). What a CSP must allow:

| Export | Directives |
|---|---|
| `embed` | `script-src 'self'` (the module and its lazy chunks, plus scene scripts, loaded from the site); `connect-src 'self'` (scene.json, fonts, models, HDRIs, audio are fetched); `img-src 'self' blob:` (poster, textures; glTF embedded textures use blob: URLs); `style-src 'unsafe-inline'` only when the scene has a HUD (`ui`: the HUD injects a `<style>` element; the element's own styles are constructable stylesheets); `'wasm-unsafe-eval'` in script-src only for meshopt-compressed models (`export --optimize`) |
| `single-html` | the above plus `script-src 'unsafe-inline' blob:` (the inline module runtime, and scene scripts run as blob: modules), `connect-src data:` and `img-src data: blob:` (assets are inlined as data: URIs) |

If the runtime and scenes live on another origin (a CDN or an assets subdomain), add that origin to `script-src`, `connect-src` and `img-src`, and serve the files with CORS (`Access-Control-Allow-Origin`). Details: [references/integrations.md](references/integrations.md).

## Rules

- Don't hotlink the runtime or assets from another site: everything ships in the export folder.
- Overwriting an existing export, or a site's files, needs the user's go: show what will be replaced.
- Never put secrets or personal data in `scene.json` or scripts: they are public files.
