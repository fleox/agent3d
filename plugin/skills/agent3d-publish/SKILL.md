---
name: agent3d-publish
description: Export an Agent3D scene and put it on a website - embed folder (Web Component + static files + generated React / Vue / Svelte wrappers and EMBED.md), zip, single HTML file, poster, MP4 / WebM video, GIF or animated WebP; paste the snippet in plain HTML, WordPress, Webflow, Shopify, AgentCMS, React / Next.js / Astro / Vue / Svelte; personalise texts with data-* attributes, drive it from JavaScript (play, pause, seek, setData, events), base URL, cache-busting, integrity, performance and accessibility checklist, and the Content-Security-Policy the runtime needs. Use when the user wants to publish, embed, ship, download or share a 3D scene they built with Agent3D, or asks why it does not show on their site.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge) for renders.
metadata:
  version: "0.1.0"
  repository: "https://github.com/fleox/agent3d"
allowed-tools: Bash Read Write
---

# Publish an Agent3D scene

**Language:** talk to the user in their language; keep commands, code and files in English.

Every command is `npx -y @fleox/agent3d@0.1.0 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Before exporting

```bash
npx -y @fleox/agent3d@0.1.0 check --project my-banner --render --json
```

No errors, no warnings (or warnings the user accepted). Keep the `licences` list: credits ship in the export.

## Formats

| Format | Command | Gives | Use it for |
|---|---|---|---|
| `embed` (default) | `export --project my-banner` | a folder: `agent3d-runtime/` (shared), `<name>/` (scene.json, assets, scripts, poster.webp, og-image.png, CREDITS.txt), `index.html` (demo), `snippet.html`, `head.html`, `EMBED.md` (for the website owner), `frameworks/` (React / Vue / Svelte wrappers + types) | Any website you can upload files to; several scenes share one runtime |
| `zip` | `export --format zip --project my-banner` | the embed folder as one `<name>-embed.zip` | Handing the export to someone, uploading through a file manager |
| `single-html` | `export --format single-html --project my-banner` | one `<name>.html` with the runtime, the scene and the assets inline (data: URIs) | Sending a file, a standalone page, an `<iframe>` in Squarespace / Wix / Framer. ~1.8 MB minimum (the runtime) |
| `poster` | `export --format poster --project my-banner` | `dist/poster.webp` (`--image png\|jpeg`, `--quality high`, `--transparent`) at `target.posterTime` (`--time 2`), 2x pixel ratio | Social images, email, a fallback |
| `video` | `export --format video --out dist/promo.mp4 --project my-banner` | MP4 (H.264) for a `.mp4` `--out`, else `dist/video.webm` (VP9) | Social posts, presentations, places that can't run WebGL |
| `gif` | `export --format gif --project my-banner` | `dist/animation.gif` (looping, 640 px, 15 fps) | Email, chat, READMEs |

```bash
npx -y @fleox/agent3d@0.1.0 export --project my-banner --json
npx -y @fleox/agent3d@0.1.0 export --project my-banner --name spring-banner --out ./site/agent3d --json
npx -y @fleox/agent3d@0.1.0 export --project my-banner --base-url /wp-content/uploads/agent3d/ --cache-bust --json
npx -y @fleox/agent3d@0.1.0 export --format zip --project my-banner --json
npx -y @fleox/agent3d@0.1.0 export --format single-html --project my-banner --json
npx -y @fleox/agent3d@0.1.0 export --format poster --time 2 --image png --quality high --project my-banner --json
npx -y @fleox/agent3d@0.1.0 export --format video --out dist/promo.mp4 --duration 8 --fps 30 --size 1920x1080 --project my-banner --json
npx -y @fleox/agent3d@0.1.0 export --format gif --duration 4 --project my-banner --json
```

- Exporting again into a non-empty folder prints a plan (`needsConfirmation`, with the existing entries): re-run with `--yes` after the user agreed.
- `--base-url` makes every URL absolute from that base (the folder's final location on the site), so the snippet works on pages at any depth or from a CDN. `--cache-bust` versions the runtime folder (`agent3d-runtime-<hash>/`) and the scene URL so they can be cached for a year. The snippet pins the runtime with Subresource Integrity (`--no-integrity` to drop it).
- `--no-poster` skips the poster and the og-image (no Chrome needed); the element then shows nothing until the first frame and has no fallback without WebGL. Prefer keeping it.
- The result gives `snippet`, `head` (all modulepreload links), `integrity`, `out`, `entry` (the demo page), `totalKb`, `sizes` (runtime, scene, assets, scripts, poster), `credits` and `issues`.

Media straight from `render` (frame-exact, any size / fps; LOOK at a few frames of the result):

```bash
npx -y @fleox/agent3d@0.1.0 render --video renders/promo.mp4 --duration 6 --size 1920x1080 --quality high --project my-banner --json
npx -y @fleox/agent3d@0.1.0 render --gif renders/banner.gif --duration 4 --project my-banner --json
npx -y @fleox/agent3d@0.1.0 render --webp renders/banner.webp --duration 4 --project my-banner --json
npx -y @fleox/agent3d@0.1.0 render --frames 2 --size 2400x600 --quality ultra --transparent --project my-banner --json
```

`--quality high|ultra` supersamples 2× / 3× (smoother edges), `--transparent` gives alpha PNG / GIF / WebP, `--scroll 0.5` renders a scroll-driven scene at that scroll progress. MP4 needs Google Chrome or Edge (H.264 encoder); with Chromium, render `.webm`.

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
- Attributes: `autoplay="false"`, `paused`, `loop="false|true|pingpong"`, `quality="low|medium|high|auto"`, `interactive="false"`, `data-*` (below).
- JavaScript: `await el.ready`, `el.play()`, `el.pause()`, `await el.seek(t)`, `await el.setData({...})`, `el.trigger(name, payload)`. Events: `agent3d:ready`, `agent3d:error` (`{ code, message, path }`), `agent3d:event` (`{ name, payload }`: script / HUD events), `agent3d:click` (`{ id }`: the object clicked), `agent3d:progress`.
- The same runtime folder serves every scene of the site: upload it once, re-upload it after updating Agent3D.

## Personalised scenes (data bindings)

Write `{data.key}` in a text object's `text` (or an `href`), give defaults in `scene.data`, and the page fills them per embed — no re-export:

```bash
npx -y @fleox/agent3d@0.1.0 scene patch --project my-banner '[{"op":"set","path":"data","value":{"title":"Spring sale"}},{"op":"updateObject","id":"title","set":{"text":"{data.title}"}}]' --json
```

```html
<agent3d-scene src="./my-banner/scene.json" data-title="Summer sale −30%"></agent3d-scene>
```

`{data.cta|Shop now}` has a fallback; `data-cta-label` maps to `ctaLabel`; `el.setData({ title: "…" })` changes it live. Renders show the `scene.data` values.

## Where it goes

Step-by-step per platform (plain HTML, WordPress, AgentCMS, React / Next.js, Astro, Vue / Nuxt, Svelte, static hosts and CDNs): [references/integrations.md](references/integrations.md). In short:

- **Plain HTML / static hosts** (Netlify, GitHub Pages, Cloudflare Pages, S3): copy the export folder next to the page, paste the snippet. Open `index.html` of the export through a local server (`npx -y @fleox/agent3d@0.1.0 serve --project my-banner` previews the project; module scripts don't run from `file://`: opened that way, the demo page only shows the poster and a note asking for a web server).
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
- [ ] Size: `totalKb` minus the runtime is within the target budget; images are 1k; the poster is a few tens of KB.
- [ ] Phones: rendered at phone width (`render --size 390x98` for a 4:1 banner) and the text is readable.
- [ ] Credits: `CREDITS.txt` lines are shown on the site when a licence requires attribution.
- [ ] The page's Content-Security-Policy allows the runtime (below).

## Content-Security-Policy

The runtime never calls third-party hosts, uses no `eval` / `new Function`, and needs no web fonts. What a CSP must allow:

| Export | Directives |
|---|---|
| `embed` | `script-src 'self'` (the module and its lazy chunks, plus scene scripts, loaded from the site); `connect-src 'self'` (scene.json, fonts, models, HDRIs, audio are fetched); `img-src 'self' blob:` (poster, textures; glTF embedded textures use blob: URLs); `style-src 'unsafe-inline'` only when the scene has a HUD (`ui`: the HUD injects a `<style>` element; the element's own styles are constructable stylesheets); `'wasm-unsafe-eval'` in script-src only for meshopt-compressed models (`export --optimize`) |
| `single-html` | the above plus `script-src 'unsafe-inline' blob:` (the inline module runtime, and scene scripts run as blob: modules), `connect-src data:` and `img-src data: blob:` (assets are inlined as data: URIs) |

If the runtime and scenes live on another origin (a CDN or an assets subdomain), add that origin to `script-src`, `connect-src` and `img-src`, and serve the files with CORS (`Access-Control-Allow-Origin`). Details: [references/integrations.md](references/integrations.md).

## Rules

- Don't hotlink the runtime or assets from another site: everything ships in the export folder.
- Overwriting an existing export, or a site's files, needs the user's go: show what will be replaced.
- Never put secrets or personal data in `scene.json` or scripts: they are public files.
