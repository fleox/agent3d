---
name: agent3d-publish
description: "Export an Agent3D scene and put it on a website - embed folder (Web Component + static files), single HTML file, poster image or WebM video; paste the snippet in plain HTML, WordPress (Custom HTML block + uploaded folder), AgentCMS (the Agent3D scene block plugin), React / Next.js / Astro / Vue (custom element usage, client-only loading); paths, caching, performance and accessibility checklist, and the Content-Security-Policy the runtime needs. Use when the user wants to publish, embed, ship, download or share a 3D scene they built with Agent3D, or asks why it does not show on their site."
version: 0.1.0
author: Agent3D
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Agent3D, 3D, Export, Embed, WordPress, React]
    related_skills: [agent3d-create, agent3d-edit, agent3d-assets, agent3d-game]
---

# Publish an Agent3D scene

**Language:** talk to the user in their language; keep commands, code and files in English.

Every command is `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Running the commands (Hermes)

Every `agent3d <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agent3d.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only), **Node.js 22+** and, for renders, posters and videos, Google Chrome / Chromium / Edge. The Agent3D engine is the `@fleox/agent3d` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENT3D_CMD` overrides the engine command (e.g. `node /path/to/agent3d/dist/agent/agent3d.mjs` from a clone); `AGENT3D_CHROME` points at a browser binary.
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agent3d import run, patch, needs_confirmation, Agent3dError` — `run("scene", "summary", project="my-banner")` returns `data` and raises `Agent3dError(code, message, hint, details)` when `ok` is false (validation issues are in `details["issues"]`); `patch(ops, project=…)` sends patch ops on stdin.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)`. Show the plan to the user before re-running with `--yes`.
- **Looking at renders:** `render` returns PNG paths (`data.sheet`, `data.frames`). Open them with your vision / image tool; if you can't view images, rely on `data.inspect` and `check --render` and tell the user you couldn't check the look.
- **Long-running commands** (`serve`, `studio`, `mcp`) need the user's own terminal: give them the command instead of running it.
- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):
  - `render_and_check.py`: Renders an Agent3D project headless (contact sheet + frames) and runs `check`, then prints the image paths to look at and a compact verdict.

## Before exporting

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py check --project my-banner --render --json
```

No errors, no warnings (or warnings the user accepted). Keep the `licences` list: credits ship in the export.

## Formats

| Format | Command | Gives | Use it for |
|---|---|---|---|
| `embed` (default) | `export --project my-banner` | a folder: `agent3d-runtime/` (shared), `<name>/` (scene.json, assets, scripts, poster.webp, CREDITS.txt), `index.html` (demo), `snippet.html` | Any website you can upload files to; several scenes share one runtime |
| `single-html` | `export --format single-html --project my-banner` | one `<name>.html` with the runtime, the scene and the assets inline (data: URIs) | Sending a file, hosting a standalone page, an `<iframe>` in a strict CMS. ~2 MB minimum (the runtime) |
| `poster` | `export --format poster --project my-banner` | `dist/poster.webp` (or `--image png`) at `target.posterTime` (`--time 2`), 2x pixel ratio | Social images, email, a fallback |
| `video` | `export --format video --duration 8 --fps 30 --project my-banner` | `dist/video.webm` | Social posts, presentations, places that can't run WebGL |

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py export --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py export --project my-banner --name spring-banner --out ./site/agent3d --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py export --format single-html --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py export --format poster --time 2 --image png --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py export --format video --duration 8 --fps 30 --size 1600x400 --project my-banner --json
```

- Exporting again into a non-empty folder prints a plan (`needsConfirmation`, with the existing entries): re-run with `--yes` after the user agreed.
- `--no-poster` skips the poster (no Chrome needed); the element then shows nothing until the first frame and has no fallback without WebGL. Prefer keeping it.
- The result gives `snippet`, `out`, `entry` (the demo page), `totalKb`, `sizes` (runtime, scene, assets, scripts, poster), `credits` and `issues`.

## The snippet

```html
<script type="module" src="./agent3d-runtime/agent3d-runtime.js"></script>
<agent3d-scene src="./my-banner/scene.json" poster="./my-banner/poster.webp" aria-label="Golden Crust Bakery: a warm 3D title with floating pastries"></agent3d-scene>
```

- Paths are relative to the page. When the folder is uploaded to `/agent3d/` on the site and used on pages at different depths, switch to root-absolute URLs: `src="/agent3d/agent3d-runtime/agent3d-runtime.js"`, `src="/agent3d/my-banner/scene.json"`, `poster="/agent3d/my-banner/poster.webp"`. Asset paths inside the scene resolve against the `scene.json` URL, so the `<name>/` folder must stay intact.
- The element is `display: block; width: 100%` and keeps the scene's aspect ratio (CSS `aspect-ratio`), or `target.height` when set. Size it with its container (`max-width`, grid column…).
- It loads lazily (starts when visible), pauses off-screen, caps the pixel ratio, freezes on the poster frame for visitors who prefer reduced motion, and shows the poster when WebGL is missing.
- Events: `agent3d-ready` (`event.detail.player`: `play()`, `pause()`, `seek(t)`) and `agent3d-error` (`event.detail`: `{ code, message, path }`).
- The same `agent3d-runtime/` folder serves every scene of the site: upload it once, re-upload it after updating Agent3D.

## Where it goes

Step-by-step per platform (plain HTML, WordPress, AgentCMS, React / Next.js, Astro, Vue / Nuxt, Svelte, static hosts and CDNs): [references/integrations.md](references/integrations.md). In short:

- **Plain HTML / static hosts** (Netlify, GitHub Pages, Cloudflare Pages, S3): copy the export folder next to the page, paste the snippet. Open `index.html` of the export through a local server (`python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py serve --project my-banner` previews the project; module scripts don't run from `file://`: opened that way, the demo page only shows the poster and a note asking for a web server).
- **WordPress**: upload the export folder to the server (SFTP / the host's file manager, e.g. `wp-content/uploads/agent3d/`), then a **Custom HTML** block with the snippet using root-absolute URLs. The media library refuses `.js` / `.json` files.
- **AgentCMS**: install the **Agent3D scene** plugin (`integrations/agentcms/agent3d-scene.zip` in the Agent3D repository): it uploads an export folder from its settings page and adds an "Agent3D scene" editor block.
- **React / Next.js / Astro / Vue**: load the runtime on the client only, render `<agent3d-scene>` as a plain custom element (details and TypeScript typing in the reference).

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
| `embed` | `script-src 'self'` (the module and its lazy chunks, plus scene scripts, loaded from the site); `connect-src 'self'` (scene.json, fonts, models, HDRIs, audio are fetched); `img-src 'self' blob:` (poster, textures; glTF embedded textures use blob: URLs); `style-src 'unsafe-inline'` only when the scene has a HUD (`ui`: the HUD injects a `<style>` element) |
| `single-html` | the above plus `script-src 'unsafe-inline' blob:` (the inline module runtime, and scene scripts run as blob: modules), `connect-src data:` and `img-src data: blob:` (assets are inlined as data: URIs) |

If the runtime and scenes live on another origin (a CDN or an assets subdomain), add that origin to `script-src`, `connect-src` and `img-src`, and serve the files with CORS (`Access-Control-Allow-Origin`). Details: [references/integrations.md](references/integrations.md).

## Rules

- Don't hotlink the runtime or assets from another site: everything ships in the export folder.
- Overwriting an existing export, or a site's files, needs the user's go: show what will be replaced.
- Never put secrets or personal data in `scene.json` or scripts: they are public files.
