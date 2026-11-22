---
name: agent3d-create
description: "Build a 3D element for a web page from a brief with Agent3D - an animated banner, a hero, a mascot or character, a low-poly landscape, a product showcase, a logo in 3D, a mini game - by writing a JSON scene, rendering it headless and LOOKING at the screenshots until it looks professional, then exporting a self-contained embed (Web Component + static files, or one HTML file). Use when the user asks for something 3D, animated or interactive for their website (\"an animated banner for my bakery\", \"a low-poly island hero\", \"a 3D version of my logo\", \"a mini game where...\")."
version: 0.1.0
author: Agent3D
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Agent3D, 3D, WebGL, Banner, Design, Web]
    related_skills: [agent3d-edit, agent3d-assets, agent3d-game, agent3d-publish]
---

# Create a 3D web element

Agent3D turns a JSON **scene** (`scene.json` in a project folder) into a 3D element for a web page. You write the scene, render it headless with the user's own Chrome, **look at the images**, fix, and export an embed that works on any static site: no server, no account, no CDN.

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py <command> --json` and prints one object: `{"ok": true, "data": …}` or `{"ok": false, "error": {"code", "message", "hint"}}`. Read `error.hint` when `ok` is false: it says what to do. `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py help scene --json` lists any command's actions and options. Pass `--project <dir>` to every project command (default: the current directory).

First run on a machine: `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py doctor --json` checks Node, Chrome and does a test render. Without Chrome, renders and posters fail with a hint (install Chrome, or set `AGENT3D_CHROME`); `export --no-poster` still works.

## Running the commands (Hermes)

Every `agent3d <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agent3d.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only), **Node.js 22+** and, for renders, posters and videos, Google Chrome / Chromium / Edge. The Agent3D engine is the `@fleox/agent3d` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENT3D_CMD` overrides the engine command (e.g. `node /path/to/agent3d/dist/agent/agent3d.mjs` from a clone); `AGENT3D_CHROME` points at a browser binary.
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agent3d import run, patch, needs_confirmation, Agent3dError` — `run("scene", "summary", project="my-banner")` returns `data` and raises `Agent3dError(code, message, hint, details)` when `ok` is false (validation issues are in `details["issues"]`); `patch(ops, project=…)` sends patch ops on stdin.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)`. Show the plan to the user before re-running with `--yes`.
- **Looking at renders:** `render` returns PNG paths (`data.sheet`, `data.frames`). Open them with your vision / image tool; if you can't view images, rely on `data.inspect` and `check --render` and tell the user you couldn't check the look.
- **Long-running commands** (`serve`, `studio`, `mcp`) need the user's own terminal: give them the command instead of running it.
- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):
  - `new_banner.py`: Creates an Agent3D banner project in one step (starter or template), applies brand colours and text, and renders a first contact sheet.
  - `render_and_check.py`: Renders an Agent3D project headless (contact sheet + frames) and runs `check`, then prints the image paths to look at and a compact verdict.

## The loop

1. **Clarify the brief** (ask at most 3 short questions, propose defaults for the rest):
   - **Where it goes and its shape**: a full-width banner (4:1), a hero (16:9 or 21:9), a card (1:1 or 4:5), a square, fullscreen, inline, a game (16:9). This sets `target.kind` and `target.aspect`.
   - **Brand**: colours (hex), the text to show (exact spelling), the mood (playful, premium, techy, natural), a logo (SVG file?).
   - **Text in 3D or in HTML?** If the page puts its own headline and buttons over or next to the element, keep the 3D side free (see composition below) and don't duplicate the text in 3D.
   - **Motion**: calm ambient loop (default for banners), interactive (follow the pointer, hover, orbit), scroll-driven, or a game.
2. **Start** from a template or from the starter for the target:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py templates list --json
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py new bakery-banner --target banner --title "Golden Crust Bakery" --json
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py new bakery-banner --template banner-neon-title --title "Golden Crust Bakery" --json
   ```
   Without `--template`, `new` writes an attractive valid starter for the target (banner: gradient background, studio lights, a floating 3D title, a few props, dust particles, a slow loop; game: + `scripts/game.js`). `--aspect 21:9` overrides the aspect.
3. **Learn what exists** before writing anything. Never guess ids or parameter names:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py catalog --json
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py catalog generators terrain --json
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py catalog behaviours --json
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene summary --project bakery-banner --json
   ```
   Sections: geometries, materialPresets, shaders, behaviours, generators, particlePresets, postfx, fonts, sounds. Built-in models, textures and HDRIs: `assets library --query <word>` (skill `agent3d-assets`).
4. **Build with patches** (small, reviewable, ids stay stable). Write the ops to a file and apply them:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene patch --project bakery-banner --file ops.json --json
   ```
   ```json
   [
     { "op": "set", "path": "environment.background", "value": { "gradient": ["#2a1306", "#5c2c0c", "#a8561b"], "angle": 10 } },
     { "op": "set", "path": "objects#title.material", "value": { "preset": "plastic", "color": "#fff4e0", "roughness": 0.3 } },
     { "op": "updateObject", "id": "title", "set": { "text": "Golden Crust", "font": "serif-bold", "size": 1.1 } },
     { "op": "addObject", "object": { "id": "donut", "kind": "mesh", "geometry": { "type": "torus", "radius": 0.7, "tube": 0.32 }, "material": { "preset": "clay", "color": "#d9944a" }, "position": [-8.2, 0.3, -1] } }
   ]
   ```
   A patch is atomic and validated: on errors nothing is written and `issues` lists each problem with its JSON path and a "did you mean" hint. Removals (`removeObject`, `remove`) print a plan with `needsConfirmation: true`: re-run with `--yes` once that is what you want. Full ops reference and gotchas: references in `agent3d-edit` (`patch-ops.md`). For a brand new scene, write the whole file and use `scene apply --file scene.json` (always a plan first, then `--yes`).
   - **Gotcha:** `updateObject` and `merge` deep-merge. Switching `material.preset` with `updateObject` keeps the old `color` / `roughness` overrides (gold stays white). To change a look, **replace** the material: `{ "op": "set", "path": "objects#title.material", "value": { "preset": "gold" } }`.
5. **Render and LOOK** (this is the step that makes it good):
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project bakery-banner --sheet --count 4 --json
   ```
   Then open `data.sheet` (a PNG contact sheet with time labels) with your vision / image tool and judge it like an art director:
   - **Framing at the aspect ratio**: nothing important cut at the edges; the subject reads at a glance; wide banners keep content in the central ~80% of the width.
   - **Composition**: a clear focal point, balanced weight, room left for HTML text if the page needs it.
   - **Text**: spelled right, readable (contrast with the background), not overlapped by props.
   - **Colours**: match the brand; not washed out or blown out by bloom; the background separates from the subject.
   - **Motion**: frames differ (something moves), but nothing jumps; the first frame is not empty (an `appear` behaviour hides objects at t = 0, so set `target.posterTime` after it).
   - Also read `data.issues`, `data.consoleErrors` and `data.inspect.objects` (each top-level object's `inView`: full / partial / none, and `screenCoverage`).
   - `--frames 0,2,4` picks exact times; `--size 390x700` simulates a phone-shaped container; `--scale 2` gives retina-sharp frames.
6. **Fix and repeat** until it looks finished. Two or three iterations are normal; say what you changed and why.
7. **Check** until there are no errors and no warnings:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py check --project bakery-banner --render --json
   ```
   It validates the scene, missing assets and scripts, the script sandbox, the triangle and KB budgets for the target, framing (with `--render`) and web settings (aria label, reduced motion, lazy start, pixel ratio cap), and lists licences that need attribution (`infos` with code `attribution`: keep those credits; the export writes `CREDITS.txt`).
8. **Export** and hand over:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py export --project bakery-banner --json
   ```
   `data.snippet` is what goes in the page; `data.out` holds `agent3d-runtime/` (shared by every scene of the site), `<name>/` (scene, assets, poster), `index.html` (a demo page) and `snippet.html`. A second export into the same folder needs `--yes`. Give the user: the snippet, the folder to upload, the total size, the credits, and offer `serve` for a live look (`python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py serve --project bakery-banner --open`). Other formats (single HTML file, poster image, WebM video) and site integration: skill `agent3d-publish`.

## Art direction that looks professional

Short version below; details, palettes and numbers in [references/art-direction.md](references/art-direction.md); complete validated scenes per kind (banner, hero, landscape, character, product, game) in [references/recipes.md](references/recipes.md).

- **One idea per element.** A title and two or three props beats ten objects. Repetition of one shape at different depths looks designed; random variety looks noisy.
- **Composition**: put the subject on a third (x ≈ ±2.5 in a 16:9 hero at fov 35 / distance 9) when the page puts HTML text on the other side. Banners: centre the title, props at the far left and right (|x| ≥ 7.5 at fov 30 / z 12 in a 4:1 banner, whose visible width is about 26 units), nothing in the top and bottom 10%.
- **Lighting recipe** (start here, then tune): a hemisphere fill (sky colour ≈ background top, ground colour ≈ a darker brand tone, 0.8–1), a directional key from top-right-front (2–2.5, `castShadow` only if a ground shows the shadow), a coloured rim from behind (point or directional, warm against a cool scene or the reverse). `environment.lighting` gives reflections: `studio` for products and chrome, `sunset` for warm outdoors, `night` for neon.
- **Palette**: background in 2–3 close tones of the brand (dark → mid), subject in a lighter or more saturated tone, one accent. Check contrast in the render: a gold title on a gold background disappears.
- **Camera**: perspective fov 30–40 for banners and products (less distortion), 45–55 for landscapes and games. Wide banner: fov 30, z 12. Hero 16:9: fov 35, z 9. Card 1:1: fov 32, z 5.5–7.
- **Motion for web pages**: slow and loopable. Float amplitude 0.05–0.2 at 0.2–0.4 cycles/s, rotations 10–20 deg/s, timeline loops of 6–10 s that end where they start (`[[0,-5],[4,5],[8,-5]]`). Parallax strength 0.3–0.5. Keep `target.reducedMotion` at `static` (the default) for banners, and make `posterTime` a frame where everything is visible.
- **Post effects** sparingly: bloom only when there is something emissive (neon), strength 0.3–0.6, threshold ≥ 0.85; vignette 0.8–1 to focus a banner. No film grain or chromatic aberration on brand work unless asked.
- **Budgets** (the `check` budget is per target): banners and cards stay under ~50 k triangles and a few hundred KB of assets; heroes ~150 k; games ~200 k. Prefer generators, primitives and the built-in library (zero download) over large models; textures at 1k.

## Rules

- Never invent catalog ids, parameter names or library ids: read `catalog` and `assets library` first. Validation errors come with "did you mean" hints: follow them.
- Keep ids stable and meaningful (`title`, `donut`, `key`): timelines, behaviours and scripts refer to them.
- Units ≈ metres, Y up, angles in degrees, colours as CSS strings, time in seconds.
- Always render and look before saying it is done. If you cannot view images, read `data.inspect` and `check --render` issues and say that you could not check the look.
- Destructive steps (removing objects, `scene apply`, overwriting an export) print a plan first. When you are acting for the user on their own project, show what will change and get their agreement before `--yes`.
- Scripts (games, interactive logic) only get the sandboxed `api`: skill `agent3d-game`.
- Assets from outside the library: skill `agent3d-assets` (CC0 sources, licences recorded in the project).
