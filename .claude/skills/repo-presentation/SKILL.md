---
name: repo-presentation
description: How the Agent3D public presentation is built and kept true — the README (GitHub page and npm page of @fleox/agent3d), docs/ layout and index, pinned commands, the showcase stills, Studio screenshots, terminal demos, real Claude Code sessions and the demo film in .github/assets, the Claude Code marketplace entry, community files and wording rules (licence, no planned features, no hosted service, no Claude attribution). Invoke when changing the README, adding or restructuring a page in docs/, adding an image or demo, or editing the plugin / marketplace descriptions in this repository.
---

# GitHub and npm presentation — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) first. Don't commit or push unless asked. Everything public is in English. Mirror of AgentCRM's `repo-presentation` skill (`../agentcrm/.claude/skills/repo-presentation/`): when in doubt, do what it does.

## The README is two pages

`README.md` is both the GitHub page and the npm page of `@fleox/agent3d` (it is in `package.json → files`). So:

- npm renders it away from the repository. Every link is **absolute**: `https://github.com/fleox/agent3d/blob/main/…` (files), `https://github.com/fleox/agent3d/tree/main/…` (folders), `https://raw.githubusercontent.com/fleox/agent3d/main/…` (images). The default branch is `main`: `blob/master` links are 404s. Only in-page anchors (`#quick-start`) stay relative.
- The README ships with a release: a README text fix reaches npm only with the next published version.
- It is a landing page, same shape as AgentCRM's: logo + tagline + badges + anchor nav → demo video poster → Why (three columns) → Quick start (Claude Code plugin + prompts + the real-session GIFs, agent table, without an agent) → Features (showcase stills grid + loop GIF + grouped bullets: Look, Motion, Content, Games, Web, Quality) → The Studio (screenshots, `<picture>` light / dark) → Templates (grid image, how to build the live gallery, collapsed table of every template) → How it works (diagram + text + snippet) → Compared → CLI (GIFs + collapsed command table) → MCP → Documentation → Contributing → License. Details belong in `docs/`; link them.
- Numbers in the README (31 templates, 38 material presets, 29 behaviours, 22 generators, 20 post effects, 13 fonts, 179 library assets…) come from the code: re-count with `agent3d catalog --json`, `agent3d templates list --json` and `agent3d assets library --json` when the catalog, templates or library change.
- The collapsed templates table is generated from `templates/*/template.json` (title, id, kind, aspect, first sentence of the description) with the template's own `preview.png`; regenerate it when a template is added, renamed or re-described.
- Pinned commands (`npx -y @fleox/agent3d@x.y.z …`) in the README, `docs/*.md`, `hermes/README.md` and `integrations/agentcms/README.md` are bumped by `scripts/sync-version.mjs` at `npm version`, and the `version` npm script stages `README.md` and `docs`. Write them with the **current** version; never write an unpinned `npx @fleox/agent3d` in the README or docs. Run every command you add with the published package outside the repo (`cd /tmp/x && npx -y @fleox/agent3d@<v> …` — inside the repo, npx resolves the local package).
- The "How it works" picture is `how-it-works-{light,dark}.png` ("one engine, four front doors" + the render loop + static export); keep it in step with `docs/architecture.md`.

## Layout

| Path | Content |
|---|---|
| `docs/README.md` | Index of the documentation (Start here / Reference / Contributors): add every new page there |
| `docs/getting-started.md`, `art-direction.md`, `studio.md`, `mcp.md` | Start here |
| `docs/scene-format.md`, `catalog.md` (generated), `cli.md` (reference generated), `scripting.md`, `export.md`, `assets.md`, `security.md` | Reference |
| `docs/architecture.md`, `studio-api.md`, `releasing.md` | Contributors / maintainers |
| `docs/images/` | Older recipe renders used by docs pages |
| `hermes/README.md` | The Hermes Agent page (skills table, Python scripts) |
| `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json` | Claude Code marketplace (`fleox/agent3d`) + plugin (`agent3d@agent3d`) descriptions; the version lives in `plugin.json` only and `check:skills` enforces it |
| `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | Community and maintenance files |

Generated docs are test inputs: `docs/catalog.md` (`src/ops/docs.test.ts`, `UPDATE_DOCS=1` rewrites it) and the command reference in `docs/cli.md` (`npm run docs:cli`, `npm run check:docs`). Don't hand-edit their generated parts.

## Images, demos and the video

Everything lives in `.github/assets/` and is referenced from the README with absolute `raw.githubusercontent.com/fleox/agent3d/main/…` URLs (the film through `https://cdn.jsdelivr.net/gh/fleox/agent3d@main/.github/assets/agent3d-demo.mp4`, which serves it with a video content type), so an image fix reaches GitHub **and** the npm page with a push to `main` (no release needed — only README *text* waits for a release). Working scripts live in `.github/demos/`.

| Path | Content |
|---|---|
| `logo.svg`, `logo.png` | The mark (same identity as the Studio favicon inlined in `index.html`) |
| `social-preview.png` | 1280×640; the maintainer uploads it in GitHub → Settings → Social preview |
| `how-it-works-{light,dark}.png` | The architecture diagram (`.github/demos/visuals/how-it-works.html` rendered with headless Chrome by `shot.mjs`) |
| `showcase-<template-id>.jpg` | Hero stills of the best templates (README Features grid; captions name the template) |
| `showcase-loop.gif` | A short loop of several templates in motion |
| `templates-grid.jpg` | Every template's still in one grid |
| `studio-{editor,materials,timeline,postfx,start}-{light,dark}.jpg` | Real Studio screenshots |
| `demo-{cli,render,export,mcp}.gif` | Scripted VHS terminal demos |
| `demo-{create,edit,game}.gif` | Real Claude Code sessions |
| `agent3d-demo.mp4`, `video-poster.jpg` | The demo film and its README poster |

### Stills, loops and the template grid

Real renders only, never mock-ups or paint-overs: `agent3d render` of each template from the **published** package (`new /tmp/x/<id> --template <id>`, then `render --frames <t> --size … --quality high`), at a time where the scene is complete (titles revealed, games in attract mode). Loops use `render --gif` (or `--video` then ffmpeg). Look at every image before using it; one crop and ratio per grid. Templates' own `preview.png` files are what the collapsed table shows.

### Studio screenshots

The published package outside the repo (`cd /tmp/x && npx -y @fleox/agent3d@<v> studio --project <dir> --port <free> --no-open`), a project created from a template, headless Chrome over the DevTools protocol at 1440×900 CSS px, deviceScaleFactor 2, downscaled to 1600 px JPG (~85). Light and dark versions of the same state. Nothing personal on screen (no API key in the assistant panel, no `/Users/…` paths).

### Terminal demos

`vhs`, `ttyd`, `ffmpeg`, `jq` (Homebrew). Look: 1200×680, Padding 24, FontSize 18, Catppuccin Mocha, WindowBar Colorful, purple `❯` prompt, setup hidden. Tapes run the **published** CLI in a throw-away folder; re-render after a release that changes the output, then push (the README picks it up immediately). Renders inside a tape are real (headless Chrome), so leave them time.

### Real agent sessions

Recorded once with VHS around a real `claude` run in a clean folder (`claude --setting-sources project,local`, the plugin enabled in the folder's `.claude/settings.json`, everything local — the session must not use online assets), then composed: real time until the prompt is sent, the agent's work sped up with a **visible ×N label**, the answer held, ending on the result (the rendered scene or the exported page). README captions say "a real Claude Code session" and that the work is sped up; never present sped-up footage as real time. No tokens, account names or `/Users/…` paths on screen.

### The demo film

Built like AgentCRM's: Kokoro TTS (`kokoro-onnx`, voice `af_heart`, speed 0.95, espeak-ng from Homebrew) with an IPA dictionary for names and acronyms (Agent3D, 3D, CLI, MCP, AI, JSON, WebGL, GIF, CC0…), Chrome-rendered title cards and slides, real template renders and Studio footage recorded over CDP with a drawn cursor, the real agent sessions, burned-in subtitles, assembled with ffmpeg (1920×1080, H.264 + AAC, faststart, ≤ 25 MB). The working files are not in the repo; the result is `.github/assets/agent3d-demo.mp4` with `video-poster.jpg`. If the owner uploads it to YouTube, point the README poster at the YouTube URL.

## Writing rules

- Say what the product does today; describe nothing planned. Every feature claim must be checkable in the code, `docs/` or `agent3d catalog`; every command must run with the published package.
- The licence is **PolyForm Noncommercial 1.0.0**: say "source available", never "open source"; commercial use needs written authorization.
- No hosted service: never describe an Agent3D server, account, cloud or subscription. The network claims must match `docs/security.md` (optional CC0 asset search / download, the optional Studio assistant with the user's own key, nothing else; exports never call a third party).
- Comparisons (Spline, hand-coded Three.js, Lottie / video) stay factual and fair: what each one is good for, no disparagement.
- Requirements: Node.js 22+ for renders (the CLI runs on 20), Chrome / Chromium / Edge / Brave.
- No Claude attribution anywhere (commits, PRs, docs). The film and the GIFs may show Claude Code being used; that is the product's use case, not an attribution.
