---
name: agent3d-create
description: Build a 3D element for a web page from a brief with Agent3D - an animated banner, a hero, a mascot or character, a low-poly landscape, a product showcase, a logo in 3D, a mini game - by writing a JSON scene, rendering it headless and LOOKING at the screenshots until it looks professional, then exporting a self-contained embed (Web Component + static files, or one HTML file). Use when the user asks for something 3D, animated or interactive for their website ("an animated banner for my bakery", "a low-poly island hero", "a 3D version of my logo", "a mini game where...").
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge) for renders.
metadata:
  version: "0.1.0"
  repository: "https://github.com/fleox/agent3d"
allowed-tools: Bash Read Write
---

# Create a 3D web element

Agent3D turns a JSON **scene** (`scene.json` in a project folder) into a 3D element for a web page. You write the scene, render it headless with the user's own Chrome, **look at the images**, fix, and export an embed that works on any static site: no server, no account, no CDN.

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `npx -y @fleox/agent3d@0.1.0 <command> --json` and prints one object: `{"ok": true, "data": …}` or `{"ok": false, "error": {"code", "message", "hint"}}`. Read `error.hint` when `ok` is false: it says what to do. `npx -y @fleox/agent3d@0.1.0 help scene --json` lists any command's actions and options. Pass `--project <dir>` to every project command (default: the current directory).

First run on a machine: `npx -y @fleox/agent3d@0.1.0 doctor --json` checks Node, Chrome and does a test render: `{ ok: true, data: { checks } }` when everything required passes, else `{ ok: false, error: { code: "doctor-failed", hint } }` (exit 1) with one hint per failed check and every check in `error.details.checks`. Without Chrome, renders and posters fail with a hint (install Chrome, or set `AGENT3D_CHROME`); `export --no-poster` still works.

## The loop

1. **Clarify the brief** (ask at most 3 short questions, propose defaults for the rest):
   - **Where it goes and its shape**: a full-width banner (4:1), a hero (16:9 or 21:9), a card (1:1 or 4:5), a square, fullscreen, inline, a game (16:9). This sets `target.kind` and `target.aspect`.
   - **Brand**: colours (hex), the text to show (exact spelling), the mood (playful, premium, techy, natural), a logo (SVG file?).
   - **Text in 3D or in HTML?** If the page puts its own headline and buttons over or next to the element, keep the 3D side free (see composition below) and don't duplicate the text in 3D.
   - **Motion**: calm ambient loop (default for banners), interactive (follow the pointer, hover, orbit), scroll-driven, or a game.
2. **Start** from a template or from the starter for the target:
   ```bash
   npx -y @fleox/agent3d@0.1.0 templates list --json
   npx -y @fleox/agent3d@0.1.0 new bakery-banner --target banner --title "Golden Crust Bakery" --json
   npx -y @fleox/agent3d@0.1.0 new bakery-banner --template banner-neon-title --title "Golden Crust Bakery" --json
   ```
   Without `--template`, `new` writes an attractive valid starter for the target (banner: gradient background, studio lights, a floating 3D title, a few props, dust particles, a slow loop; game: + `scripts/game.js`). `--aspect 21:9` overrides the aspect.
3. **Learn what exists** before writing anything. Never guess ids or parameter names:
   ```bash
   npx -y @fleox/agent3d@0.1.0 catalog --json
   npx -y @fleox/agent3d@0.1.0 catalog generators terrain --json
   npx -y @fleox/agent3d@0.1.0 catalog behaviours --json
   npx -y @fleox/agent3d@0.1.0 scene summary --project bakery-banner --json
   ```
   Sections: geometries, materialPresets, shaders, behaviours, generators, particlePresets, postfx, fonts, sounds. Built-in models, textures and HDRIs: `assets library --query <word>` (skill `agent3d-assets`).
4. **Build with patches** (small, reviewable, ids stay stable). Write the ops to a file and apply them:
   ```bash
   npx -y @fleox/agent3d@0.1.0 scene patch --project bakery-banner --file ops.json --json
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
   npx -y @fleox/agent3d@0.1.0 render --project bakery-banner --sheet --count 4 --json
   ```
   Then open `data.sheet` (a PNG contact sheet with time labels; paths are relative to the project folder `data.dir`) with the Read tool and judge it like an art director:
   - **Framing at the aspect ratio**: nothing important cut at the edges; the subject reads at a glance; wide banners keep content in the central ~80% of the width.
   - **Composition**: a clear focal point, balanced weight, room left for HTML text if the page needs it.
   - **Text**: spelled right, readable (contrast with the background), not overlapped by props.
   - **Colours**: match the brand; not washed out or blown out by bloom; the background separates from the subject.
   - **Motion**: frames differ (something moves), but nothing jumps; the first frame is not empty (an `appear` behaviour hides objects at t = 0, so set `target.posterTime` after it).
   - Also read `data.issues`, `data.consoleErrors` and `data.inspect.objects` (each top-level object's `inView`: full / partial / none, and `screenCoverage`).
   - `--frames 0,2,4` picks exact times; `--size 390x700` simulates a phone-shaped container; `--scale 2` gives retina-sharp frames.
   - `--isolate <objectId>` renders one object alone (no behaviours, scripts or UI), at the origin, auto-framed from the front three-quarter view (+Z front) on a neutral grey background, and returns `data.isolated.size`: the fastest way to check that a downloaded model faces +Z, stands upright and has a sensible size.
     ```bash
     npx -y @fleox/agent3d@0.1.0 render --project bakery-banner --isolate croissant-left --json
     ```
   - Transparent scenes (`target.transparent`): frames keep their alpha and the contact sheet gets a checkerboard behind them; `--bg "#ffffff"` (any CSS colour) previews the scene over the host page's colour, frames included; `--bg none` turns it off.
6. **Fix and repeat** until it looks finished. Two or three iterations are normal; say what you changed and why.
7. **Check** until there are no errors and no warnings:
   ```bash
   npx -y @fleox/agent3d@0.1.0 check --project bakery-banner --render --json
   ```
   It validates the scene, missing assets and scripts, the script sandbox, the triangle and KB budgets for the target, framing (with `--render`) and web settings (aria label, reduced motion, lazy start, pixel ratio cap), and lists licences that need attribution (`infos` with code `attribution`: keep those credits; the export writes `CREDITS.txt`).
8. **Export** and hand over:
   ```bash
   npx -y @fleox/agent3d@0.1.0 export --project bakery-banner --json
   ```
   `data.snippet` is what goes in the page; `data.out` holds `agent3d-runtime/` (shared by every scene of the site), `<name>/` (scene, assets, poster), `index.html` (a demo page) and `snippet.html`. A second export into the same folder needs `--yes`. Give the user: the snippet, the folder to upload, the total size, the credits, and offer `serve` for a live look (`npx -y @fleox/agent3d@0.1.0 serve --project bakery-banner --open`). Other formats (single HTML file, poster image, WebM video) and site integration: skill `agent3d-publish`.

## Art direction that looks professional

Short version below; details, palettes and numbers in [references/art-direction.md](references/art-direction.md); complete validated scenes per kind (banner, hero, landscape, character, product, game) in [references/recipes.md](references/recipes.md).

- **One idea per element.** A title and two or three props beats ten objects. Repetition of one shape at different depths looks designed; random variety looks noisy.
- **Composition**: put the subject on a third (x ≈ ±2.5 in a 16:9 hero at fov 35 / distance 9) when the page puts HTML text on the other side. Banners: centre the title, props at the far left and right (|x| ≥ 7.5 at fov 30 / z 12 in a 4:1 banner, whose visible width is about 26 units), nothing in the top and bottom 10%.
- **Lighting recipe** (start here, then tune): a hemisphere fill (sky colour ≈ background top, ground colour ≈ a darker brand tone, 0.8–1), a directional key from top-right-front (2–2.5, `castShadow` only if a ground shows the shadow), a coloured rim from behind (point or directional, warm against a cool scene or the reverse). `environment.lighting` gives reflections: `studio` for products and chrome, `sunset` for warm outdoors, `night` for neon.
- **Palette**: background in 2–3 close tones of the brand (dark → mid), subject in a lighter or more saturated tone, one accent. Check contrast in the render: a gold title on a gold background disappears.
- **Camera**: perspective fov 30–40 for banners and products (less distortion), 45–55 for landscapes and games. Wide banner: fov 30, z 12. Hero 16:9: fov 35, z 9. Card 1:1: fov 32, z 5.5–7.
- **Motion for web pages**: slow and loopable. Float amplitude 0.05–0.2 at 0.2–0.4 cycles/s, rotations 10–20 deg/s, timeline loops of 6–10 s that end where they start (`[[0,-5],[4,5],[8,-5]]`). Parallax strength 0.3–0.5. Keep `target.reducedMotion` at `static` (the default) for banners, and make `posterTime` a frame where everything is visible (after every `appear` delay + duration; reduced-motion visitors see `appear` finished anyway, but the exported poster does not).
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
