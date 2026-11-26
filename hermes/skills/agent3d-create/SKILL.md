---
name: agent3d-create
description: "Build a 3D element for a web page from a brief with Agent3D - an animated banner, a hero, a mascot or character, a low-poly landscape, a product showcase, a logo in 3D, a 3D photo (a user's photo given depth that moves with the pointer), a mini game - by writing a JSON scene, rendering it headless and LOOKING at the screenshots until it looks professional, then exporting a self-contained embed (Web Component + static files, or one HTML file). Use when the user asks for something 3D, animated or interactive for their website (\"an animated banner for my bakery\", \"a low-poly island hero\", \"a 3D version of my logo\", \"make this photo 3D / bring this picture to life\", \"a mini game where...\")."
version: 0.5.0
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

First run on a machine: `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py doctor --json` checks Node, Chrome and does a test render: `{ ok: true, data: { checks } }` when everything required passes, else `{ ok: false, error: { code: "doctor-failed", hint } }` (exit 1) with one hint per failed check and every check in `error.details.checks`. Without Chrome, renders and posters fail with a hint (install Chrome, or set `AGENT3D_CHROME`); `export --no-poster` still works.

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
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py catalog postfx look --json
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene summary --project bakery-banner --json
   ```
   Sections: geometries, materialPresets, shaders, textures (procedural, zero bytes), lightRigs, behaviours, generators, particlePresets, postfx (with the `look` presets and each effect's GPU cost), fonts, sounds. Built-in models, textures and HDRIs: `assets library --query <word>` (skill `agent3d-assets`). The field-by-field scene format is in the `agent3d-edit` skill (`references/patch-ops.md`).
4. **Build with patches** (small, reviewable, ids stay stable). Write the ops to a file and apply them:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene patch --project bakery-banner --file ops.json --json
   ```
   ```json
   [
     { "op": "set", "path": "environment.background", "value": { "gradient": ["#2a1306", "#5c2c0c", "#a8561b"], "angle": 10 } },
     { "op": "set", "path": "environment.rig", "value": "golden-hour" },
     { "op": "set", "path": "objects#title.material", "value": { "preset": "satin", "color": "#fff4e0" } },
     { "op": "updateObject", "id": "title", "set": { "text": "Golden Crust", "font": "serif-bold", "size": 1.1, "behaviours": [{ "type": "float", "amplitude": 0.08, "speed": 0.4 }], "reveal": { "effect": "rise", "stagger": 0.05, "duration": 0.7 } } },
     { "op": "addObject", "object": { "id": "donut", "kind": "mesh", "geometry": { "type": "torus", "radius": 0.7, "tube": 0.32 }, "material": { "preset": "ceramic", "color": "#d9944a" }, "position": [-9.5, -0.6, -1] } },
     { "op": "set", "path": "postfx", "value": [{ "type": "look", "preset": "cinematic", "intensity": 0.7 }] }
   ]
   ```
   (On the banner starter this swaps the title's `appear` for a per-letter `reveal`, adds a golden-hour light rig on top of the starter's lights and replaces its bloom with a graded film look.)
   A patch is atomic and validated: on errors nothing is written and `issues` lists each problem with its JSON path and a "did you mean" hint. Removals (`removeObject`, `remove`) and ops that replace a whole collection (`set` / `merge` on `postfx`, `lights`, `objects`, `timeline.tracks`, `ui.elements`, `interactions`, `behaviours`…) print a plan with `needsConfirmation: true` (`plan.replaces` lists each collection and its item count): re-run with `--yes` once that is what you want — the example above replaces the starter's `postfx`, so it needs `--yes`. Full ops reference and gotchas: references in `agent3d-edit` (`patch-ops.md`). For a brand new scene, write the whole file and use `scene apply --file scene.json` (always a plan first, then `--yes`).
   - **Gotcha:** `updateObject` and `merge` deep-merge. Switching `material.preset` with `updateObject` keeps the old `color` / `roughness` overrides (gold stays white). To change a look, **replace** the material: `{ "op": "set", "path": "objects#title.material", "value": { "preset": "gold" } }`.
5. **Render and LOOK** (this is the step that makes it good):
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project bakery-banner --sheet --count 4 --json
   ```
   Then open `data.sheet` (a PNG contact sheet with time labels; paths are relative to the project folder `data.dir`) with your vision / image tool and judge it like an art director:
   - **Framing at the aspect ratio**: nothing important cut at the edges; the subject reads at a glance; wide banners keep content in the central ~80% of the width.
   - **Composition**: a clear focal point, balanced weight, room left for HTML text if the page needs it.
   - **Text**: spelled right, readable (contrast with the background), not overlapped by props.
   - **Colours**: match the brand; not washed out or blown out by bloom; the background separates from the subject.
   - **Motion**: frames differ (something moves), but nothing jumps; the first frame is not empty (an `appear` behaviour hides objects at t = 0, so set `target.posterTime` after it).
   - Also read `data.issues`, `data.consoleErrors` and `data.inspect.objects` (each top-level object's `inView`: full / partial / none, and `screenCoverage`).
   - `--frames 0,2,4` picks exact times; `--scale 2` gives retina-sharp frames; `--quality high` supersamples 2x for a final look at fine edges and text.
   - Interactive and scroll scenes: `--input '[{"t": 1.9, "pointer": [0, -0.3]}]'` hovers (or `"click": [x, y]`, coordinates -1..1, y up) before the following frames; `--scroll 0.5` shows (one frame) a scroll-driven scene half-way down the page (with `timeline.trigger: "scroll"`, plain `--count 8` already walks through the scroll states).
   - Phones: the embed keeps `target.aspect` at any width, so render the real phone size: `--size 390x98` for a 4:1 banner, `--size 390x219` for 16:9. A taller `--size` (390x700) only previews pages whose CSS (or `target.height`) gives the element a height: the camera then widens its view to keep the horizontal framing. Portrait designs use a portrait `target.aspect` (art direction → Framing per target).
   - To show the user the motion: `--gif renders/preview.gif --duration 4` (or `--video <file>.mp4`, `--webp <file>.webp`); the path is relative to the project folder.
   - `--isolate <objectId>` renders one object alone (no behaviours, scripts or UI), at the origin, auto-framed from the front three-quarter view (+Z front) on a neutral grey background, and returns `data.isolated.size`: the fastest way to check that a downloaded model faces +Z, stands upright and has a sensible size.
     ```bash
     python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project bakery-banner --isolate croissant-left --json
     ```
   - Transparent scenes (`target.transparent`): frames keep their alpha and the contact sheet gets a checkerboard behind them; `--bg "#ffffff"` (any CSS colour) previews the scene over the host page's colour, frames included; `--bg none` turns it off.
6. **Fix and repeat** until it looks finished. Two or three iterations are normal; say what you changed and why.
7. **Check** until there are no errors and no warnings:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py check --project bakery-banner --render --json
   ```
   It validates the scene, missing assets and scripts, the script sandbox, the triangle and KB budgets for the target, framing (with `--render`) and web settings (aria label, reduced motion, lazy start, pixel ratio cap), and lists licences that need attribution (`infos` with code `attribution`: keep those credits; the export writes `CREDITS.txt`).
   - `data.budget.gpu` is the post-processing cost: `effects` (each with its `gpu` tier and passes), `passes`, `level` (`none`, `light`, `moderate`, `heavy`) and `dropped.low` (effects the `low` quality tier switches off on weak devices). A `postfx-cost` issue means too many fullscreen passes (a warning on games and fullscreen targets, an info elsewhere) or `ao` / `dof` on a game: keep the effects that change the image the most. Grading, vignette, film, chromatic and sharpen merge into one nearly free pass.
   - Over the KB budget: `assets optimize` (skill `agent3d-assets`) shrinks project textures and models. Library assets are never shrunk there: the photographic `.hdr` files weigh 0.35 to 1.9 MB, so on banners and cards prefer a procedural `lighting` preset (`studio`, `soft`, `sunset`, `night`: zero bytes) plus a light rig.
8. **Export** and hand over:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py export --project bakery-banner --json
   ```
   `data.snippet` is what goes in the page; `data.out` holds `agent3d-runtime/` (shared by every scene of the site), `<name>/` (scene, assets, poster, `CREDITS.txt`), `index.html` (a demo page), `snippet.html`, `head.html`, `EMBED.md` and `frameworks/` (React / Vue / Svelte wrappers). A second export into the same folder needs `--yes`. Give the user: the snippet, the folder to upload, the total size, the credits, and offer `serve` for a live look (`python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py serve --project bakery-banner --open`). Other formats (zip, single HTML file, poster image, MP4 / WebM video, GIF) and site integration: skill `agent3d-publish`.

## Bring a photo to life (3D photo)

When the user gives a photo or an image and wants it in 3D, with parallax, "moving with the mouse" or "brought to life", don't model the scene: turn the picture itself into a **3D photo**, a `photo` object with a depth map. Start from the `hero-photo-3d` template (or the "3D photo hero" recipe in [references/recipes.md](references/recipes.md)).

1. **Copy the image into the project** with its licence (ask who took it and under which licence; skill `agent3d-assets`):
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py new my-hero --template hero-photo-3d --title "Old Town Tours" --json
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets add ./photo.jpg --license CC0-1.0 --author "Jane Doe" --project my-hero --json
   ```
2. **Estimate its depth map** (local, ~1-3 s; the first run downloads the 27 MB model once, then it works offline):
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets depth assets/textures/photo.jpg --project my-hero --json
   ```
   It writes `assets/depth/photo-depth.png` (white = near) and returns `data.suggestion` (`{ "kind": "photo", "src", "depth" }`). Open the PNG with your vision / image tool: the subject should be lighter than the background.
3. **Point the photo object at it** (or add one with `object add --json-def`):
   ```json
   [{ "op": "updateObject", "id": "photo", "set": { "src": "assets/textures/photo.jpg", "depth": "assets/depth/photo-depth.png", "strength": 0.5, "focus": 0.5 } }]
   ```
   Cover the frame: with the camera at fov 35 and distance 10, a 16:9 frame is about 11.2 × 6.3 units, so a 3:2 photo needs `width` ≈ 11.9 (a 4:3 photo ≈ 11.2; a portrait photo needs `height` ≈ 6.6 and leaves side bars, so prefer a portrait `target.aspect` or a card). Keep the camera still: the photo's shader moves the view.
4. **Choose the mode**: `parallax` (default, 2 triangles) for hero banners and small motions; `mesh` (a displaced grid) when the view moves more, e.g. `motion.auto: "orbit"`; `layers` (depth slices) for a pop-up-book look. `motion`: `pointer` (0..1), `gyro` (phones), `auto` (`sway` default, `orbit`, `zoom`, `none`, or a cinematic move below: plays in renders, videos and on touch screens), `speed` (cycles per 10 s), `scroll`.
5. **Render and look**, then move the pointer to see the depth:
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project my-hero --count 4 --sheet --json
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project my-hero --frames 0.5,1,1.5,2 --sheet --input '[{"t": 0.1, "pointer": [-1, 0]}, {"t": 0.9, "pointer": [1, 0]}, {"t": 1.4, "pointer": [0, 1]}, {"t": 1.9, "pointer": [0, -1]}]' --json
   ```
   Near things should slide against far things between frames, without smeared or doubled edges around the subject.
6. **Bigger moves: add a plate.** For `strength` ≥ 0.7, `mode: "mesh"`, or people / signs / poles in front of the background, build the background plate and set it on the photo (it shows what the foreground uncovers, instead of smears and stretched halos):
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets plate assets/textures/photo.jpg --project my-hero --json
   ```
   ```json
   [{ "op": "updateObject", "id": "photo", "set": { "plate": "assets/depth/photo-plate.webp", "plateDepth": "assets/depth/photo-plate-depth.png" } }]
   ```
   (`assets depth … --plate` does depth map + plate in one go.) Render again with pointer moves to the corners and compare the silhouettes.

**Cinematic moves** (a camera move from a single photo — set `motion.auto`, look at a sheet over one loop `--frames 0,2.5,5,7.5`):

| `auto` | Move | Good for |
|---|---|---|
| `dolly` | slow push in toward the `focus` plane (a Ken Burns with depth) | streets, interiors, products, portraits |
| `pan` | lateral truck left → right | landscapes, skylines, wide shots |
| `rise` | crane up, pushing in a little | buildings, mountains, reveals |
| `vertigo` | dolly zoom: the `focus` plane keeps its size while the background swells | dramatic subjects with a deep background (set `focus` to the subject's depth) |

They loop seamlessly every 10 / `speed` s (ping-pong, safe for video loops); `"loop": false` plays one move over `motion.duration` seconds and holds; `"progress": 0..1` freezes the move, and a timeline track `"<id>.motion.progress"` drives it (scroll story: `timeline.trigger: "scroll"`, see the `photo-scroll-story` template; crossfade photos with `"<id>.material.opacity"` tracks). Defaults are artefact-free at any `strength`; reduced motion keeps the photo still.

**Social video** in one line (1080×1920, 30 fps, one seamless loop of the move, MP4 H.264 ~10 Mbit/s, the photo covers the vertical frame — no edges; `notes` say what was cropped):
```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project my-hero --video renders/reel.mp4 --preset vertical --json   # or square / landscape / story
```
Check the framing first with PNGs: `render --preset vertical --count 4 --sheet`. Text placed for 16:9 gets cropped in 9:16: make the headline narrower or drop it for the video.

Tips:

- `strength`: 0.5 by default; parallax holds a bold 0.7-0.9 (hero banners), mesh ~0.7 with the photo slightly wider than the frame (its border shows otherwise), layers ~0.6 (halos around subjects above that). When silhouettes smear, add a plate (step 6) or lower it, and check with `render --input` pointer moves to the corners.
- `focus` = the subject's depth (0 far … 1 near, read it from the depth map: a mid-grey subject ≈ 0.5): the subject stays put and the rest moves around it, which reads as depth instead of wobble.
- Headlines: put them over a calm area of the photo (sky, wall, blurred background), use `"material": { "type": "basic", "color": "#ffffff" }` and `target.toneMapping: "none"` so white stays white (photos themselves are never tone mapped), and check the contrast in the render. A kerned 3D title (`depth` > 0, lit material) also works over a darker photo.
- `check` reports `photo-depth-aspect` (regenerate the depth map after cropping the photo), `photo-heavy` (over 1.5 MB: `assets optimize`) and `photo-depth-lossy` (keep the depth map a PNG). A covering photo is never reported as `clipped`.
- **Web weight**: before exporting, run `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets optimize --all --yes --project my-hero --json`: the photo becomes WebP at the size the hero needs (about 40 % lighter; the scene path is rewritten) and the depth map stays a lossless PNG (already ≤ 1024 px from `assets depth`: the model works at 518 px). A photo-only hero then weighs about 0.4 MB of images plus the runtime.
- Exports copy the photo, its depth map and its plate like any asset; the model never ships.

**Depth effects** (`"effects"` on the photo object, every mode, kept by the 19 KB photo player; `{}` = defaults; full table in docs/scene-format.md "Photo effects"):

- Fog (distance haze, drifting wisps): `"fog": { "color": "#c9d6ea", "amount": 0.55 }`. Match the colour to the sky; `start` (default 0.7) = the depth where the haze begins, lower it to keep more of the scene clear.
- Light (a flashlight / sunbeam raking the relief, follows the pointer, a slow auto path in renders): `"light": { "color": "#ffe2b0", "ambient": 0.55, "height": 0.45 }`. Lower `ambient` = darker surroundings and a stronger pool; lower `height` = more raking. Check it with `render --input` pointer moves.
- Reveal (the photo appears slice by slice, far first): `"reveal": { "duration": 2.5, "delay": 0.3 }` (an intro), `"from": "near"` for the subject first; set `target.posterTime` after the reveal ends so the poster is not empty.
- Blur (rack focus / depth of field, a lens-like soft blur away from the focus depth): `"blur": { "focus": 0.7, "to": 0.05, "duration": 3, "delay": 0.5 }` racks from the foreground (0.7) to the far distance and back, in a loop (`duration` s per leg); without `to` the focus stays put. Look at the depth map first to pick depths (white = 1 near). `amount` = max blur radius in % of the photo width (default 0.6; 0.6–1 reads as a lens).
- Frame ("out of frame": the photo in a smaller frame, the near subject stepping out over the page): `"frame": { "inset": [0.2, 0.22], "threshold": 0.6, "color": "#2a2520", "border": 0.012 }`. Pick a photo with a clear near subject crossing where the frame edge will be (a head above the top edge, an object beside it) and put `threshold` between the subject's depth and the background's. Outside the frame the page (scene background) shows: give it a colour matching the photo's ground if the ground is near (it pops out too). `"focus"` below the subject's depth (e.g. 0.3) makes the subject slide over the border when the view moves. Reads best in `parallax` mode.
- Animate them from the timeline: `{ "target": "photo.effects.light.position", "keys": [[0, [-0.9, 0.5]], [4, [0.9, 0.5]]], "ease": "inOutSine" }` (with `"follow": "none"`), `photo.effects.fog.amount`, `photo.effects.reveal.progress`, `photo.effects.blur.focus` (a rack on your own timing), `photo.effects.frame.inset` (the frame closing in).

### Title behind the subject (3D inside the photo)

When the user wants the 3D content *inside* the picture (a title passing behind the nearest building, snow falling in front of and behind a person, a 3D logo standing on a table in the photo), set `"occlude": true` on the photo. It then writes the true depth of its pixels, so objects placed between its depth planes are hidden by its nearer parts, and its pointer / gyro / auto motion moves the real camera so they slide exactly with the photo. Start from the `photo-title-inside` template (`new my-hero --template photo-title-inside`).

1. Turn it on: `[{ "op": "set", "path": "objects#photo.occlude", "value": true }]`.
2. Read where the photo's depths are: `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene summary --project my-hero --json` → the photo's `depthRange: [zFar, zNear]` (world z of its depth-0 and depth-1 pixels; the `focus` depth is at the photo's own z). A depth-map value d sits at about `z = (d - focus) × strength × width × 0.25` (exact formula in `docs/scene-format.md`, "3D inside the photo").
3. Place the title: z a little smaller (farther) than the depth of the subject that should cover it, larger than what should stay behind it; x / y so the subject overlaps part of the letters. E.g. a street at `strength` 0.8, `focus` 0.45, `width` 11.9: the sky is at z ≈ -1.2, the nearest facade at z ≈ 1.15, a title at z ≈ -0.15 (depth ≈ 0.4) is covered at both ends by the nearest buildings; a subtitle at z ≈ 0.35 stays in front.
4. Particles: give them an `area` whose z spans the whole range (e.g. `"area": [12, 8, 4]` centred at z ≈ 0.4) so they fall in front of and behind the subject.
5. Render with the pointer at the corners and look: the subject must cover the letters at the same place in every frame (no sliding of the title over the facade):
   ```bash
   python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project my-hero --frames 0.5,1.5,2.5,3.5 --sheet --input '[{"t":0.5,"pointer":[-1,0.7]},{"t":1.5,"pointer":[1,-0.7]},{"t":2.5,"pointer":[1,1]},{"t":3.5,"pointer":[-1,-1]}]' --json
   ```
   Too much hidden → move the title nearer (larger z) or away from the subject; nothing hidden → farther (smaller z) or overlapping the subject. Keep the camera looking straight at the photo (the default set-up). Without `occlude`, `check` reports objects inside a photo's depth range (`photo-occlude`): leave it off for a headline meant to float over the picture.

## Other front doors: MCP and the Studio

Everything above also works without the shell:

- **MCP server** — `agent3d mcp` serves one project folder over stdio: the same tools as `tools list` (scene_patch, check, export…) plus `render_preview`, whose contact sheet comes back as an image the client can look at. Claude Code: `claude mcp add agent3d -- python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py mcp --project /path/to/my-banner` (add `--scope project` to write `.mcp.json` for the repository). Claude Desktop / Cursor: in `claude_desktop_config.json` / `.cursor/mcp.json`:
  ```json
  { "mcpServers": { "agent3d": { "command": "npx", "args": ["-y", "@fleox/agent3d@0.5.0", "mcp", "--project", "/Users/me/agent3d/my-banner"] } } }
  ```
  `--read-only` exposes only the tools that don't write. Desktop apps may not see the shell's `PATH`: use the absolute path of `npx` as `command` if the server doesn't start.
- **Studio** — `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py studio --project bakery-banner` opens a visual editor on the same folder (viewport with move / rotate / scale gizmos, outliner, inspector, timeline, catalog and library, templates, check, render and export dialogs; English or French). It prints its local URL and runs until stopped. Edits go through the same validated tools, and changes you make from the CLI appear live in it, so the user can watch and tweak your work. The viewport starts in edit mode (scripts don't run, the timeline is paused and scrubbed); interact mode (`I`) runs the scene as the website does: scripts, hover / click / scroll triggers.

## Art direction that looks professional

Short version below; the "Premium defaults" section of [references/art-direction.md](references/art-direction.md) gives the starting values per kind (plus palettes and numbers), and [references/recipes.md](references/recipes.md) holds complete validated scenes per kind (banner, hero, landscape, character, product, game).

**Premium starting points** (one line each in the scene, zero bytes; parameters via `catalog <section> <id>`):

- **Light with a rig** instead of hand-placed lights: `"environment": { "rig": "softbox" }` (products), `"studio-3point"`, `"product-top"`, `"rim"`, `"dramatic"`, `"golden-hour"`, `"noon"`, `"overcast"`, `"neon"`, `"moonlight"` (`catalog lightRigs`). Rigs assume a subject about 1 to 3 units around the origin (`{ "preset": "softbox", "scale": 3 }` for bigger scenes); their lights add to `lights`, so drop or dim the starter's lights when you add one.
- **Reflections**: `environment.lighting` `studio` / `soft` / `sunset` / `night` (procedural), or a library HDRI (`{ "hdri": "library:hdri/softbox.hdr" }` for products, about 1.5 MB: heroes and product scenes only).
- **Outdoors**: a physical sky `{ "sky": { "preset": "golden-hour" } }` (sunrise, morning, noon, afternoon, golden-hour, sunset, dusk) brings its own sun light and lighting; add height fog `{ "density": 0.025, "height": 1, "falloff": 0.25 }` for depth.
- **Abstract backgrounds**: `{ "meshGradient": ["#ff9a8b", "#ff6a88", "#7b5cff", "#2ad4ff"], "speed": 0.15 }` (soft drifting colour blobs) or a 2 to 3 tone `gradient` / `radial` with `"grain": 0.03`.
- **Grounding**: `"contactShadows": { "opacity": 0.6, "blur": 2.5 }` puts soft shadows under products and characters without a shadow-casting light.
- **Materials**: photoreal presets (carPaint, ceramic, marble, satin, leather, brushedAluminium, gem, jelly…: `catalog materialPresets`) and procedural texture slots `"map": { "procedural": "wood" }` (`catalog textures`) beat flat colours.
- **Finish**: one `look` post effect sets bloom, grading, vignette and antialiasing in a single line: `{ "type": "look", "preset": "product" }` (also cinematic, dreamy, neon, retro, clean; `intensity` 0..1). Add an effect next to it to override one param (`{ "type": "vignette", "darkness": 0.3 }`). Leave `target.quality` at `auto`: it adapts to the visitor's device.
- **Typography**: 13 fonts (`catalog fonts`: inter-black, montserrat-extrabold, bebas-neue, anton for punch; serif-bold / serif for premium; pacifico, lobster for script; display for playful). `outline` gives the sticker look, `maxWidth` wraps, and `reveal` (`{ "effect": "rise", "stagger": 0.05 }`) animates letter by letter. Set `target.posterTime` after the reveal ends.
- **Motion and interaction**: per-key easing (`[1, 12, "outBack"]`, `"spring(170, 12)"`), staggered multi-target tracks (`tag:<tag>`, `children:<id>`), camera `shots` (pushIn, orbit, crane, path…), hover / click `interactions` that play timeline segments or open a URL, and `timeline.trigger: "scroll"` for scroll stories. Recipes for each: `agent3d-edit` (`references/patch-ops.md`).

Fundamentals:

- **One idea per element.** A title and two or three props beats ten objects. Repetition of one shape at different depths looks designed; random variety looks noisy.
- **Composition**: put the subject on a third (x ≈ ±2.5 in a 16:9 hero at fov 35 / distance 9) when the page puts HTML text on the other side. Banners: centre the title, props at the far left and right (|x| ≥ 7.5 at fov 30 / z 12 in a 4:1 banner, whose visible width is about 26 units), nothing in the top and bottom 10%.
- **Palette**: background in 2–3 close tones of the brand (dark → mid), subject in a lighter or more saturated tone, one accent. Check contrast in the render: a gold title on a gold background disappears.
- **Camera**: perspective fov 30–40 for banners and products (less distortion), 45–55 for landscapes and games. Wide banner: fov 30, z 12. Hero 16:9: fov 35, z 9. Card 1:1: fov 32, z 5.5–7.
- **Motion for web pages**: slow and loopable. Float amplitude 0.05–0.2 at 0.2–0.4 cycles/s, rotations 10–20 deg/s, timeline loops of 6–10 s that end where they start (`[[0,-5],[4,5],[8,-5]]`). Parallax strength 0.3–0.5. Keep `target.reducedMotion` at `static` (the default) for banners, and make `posterTime` a frame where everything is visible (after every `appear` / `reveal` delay + duration; reduced-motion visitors see them finished anyway, but the exported poster does not).
- **Post effects** with restraint: no film grain, chromatic aberration, glitch or ascii on brand work unless asked; `ao` and `dof` are expensive (never on games: `check` warns).
- **Budgets** (the `check` budget is per target): triangles are counted per frame with every pass (shadow maps, AO pre-pass): banners and cards stay under ~150 k and a few hundred KB of assets; heroes ~400 k; games ~300 k (`references/art-direction.md` → Performance budgets). Prefer generators, primitives, procedural textures and the built-in library over large models; textures at 1k, then `assets optimize`.

## Rules

- Never invent catalog ids, parameter names or library ids: read `catalog` and `assets library` first. Validation errors come with "did you mean" hints: follow them.
- Keep ids stable and meaningful (`title`, `donut`, `key`): timelines, behaviours and scripts refer to them.
- Units ≈ metres, Y up, angles in degrees, colours as CSS strings, time in seconds.
- Always render and look before saying it is done. If you cannot view images, read `data.inspect` and `check --render` issues and say that you could not check the look.
- Destructive steps (removing objects, `scene apply`, overwriting an export) print a plan first. When you are acting for the user on their own project, show what will change and get their agreement before `--yes`.
- Scripts (games, interactive logic) only get the sandboxed `api`: skill `agent3d-game`.
- Assets from outside the library: skill `agent3d-assets` (CC0 sources, licences recorded in the project).
