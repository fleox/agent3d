---
name: agent3d-assets
description: "Find and add 3D assets to an Agent3D project - the built-in CC0 library shipped offline (models, PBR textures, HDRIs, fonts), procedural generators that cost zero bytes, free account-less CC0 sources (Poly Haven, ambientCG, Khronos samples searched and downloaded once into the project; Kenney and Quaternius packs imported from a zip the user downloads), the user's own files, depth maps for 3D photos (assets depth, a local model downloaded once), licences and attribution, size budgets, and making textures and models lighter (assets optimize: per-usage sizes, WebP, meshopt, simplify). Use when a scene needs a model, a texture, an HDRI, a logo, a sound or music, or when the user asks where assets come from or how they are licensed."
version: 0.2.3
author: Agent3D
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Agent3D, 3D, Assets, CC0, Licences]
    related_skills: [agent3d-create, agent3d-edit, agent3d-game, agent3d-publish]
---

# Assets for Agent3D scenes

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Running the commands (Hermes)

Every `agent3d <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agent3d.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only), **Node.js 22+** and, for renders, posters and videos, Google Chrome / Chromium / Edge. The Agent3D engine is the `@fleox/agent3d` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENT3D_CMD` overrides the engine command (e.g. `node /path/to/agent3d/dist/agent/agent3d.mjs` from a clone); `AGENT3D_CHROME` points at a browser binary.
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agent3d import run, patch, needs_confirmation, Agent3dError` — `run("scene", "summary", project="my-banner")` returns `data` and raises `Agent3dError(code, message, hint, details)` when `ok` is false (validation issues are in `details["issues"]`); `patch(ops, project=…)` sends patch ops on stdin.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)`. Show the plan to the user before re-running with `--yes`.
- **Looking at renders:** `render` returns PNG paths (`data.sheet`, `data.frames`). Open them with your vision / image tool; if you can't view images, rely on `data.inspect` and `check --render` and tell the user you couldn't check the look.
- **Long-running commands** (`serve`, `studio`, `mcp`) need the user's own terminal: give them the command instead of running it.

## Pick the cheapest thing that looks right

1. **Procedural first** (zero download, deterministic, recolourable): primitives (`catalog geometries`), generators (`catalog generators`: terrain, trees, rocks, grass, flowers, water, clouds, city, character, planet, starfield, blob, waveGrid, maze, road, floatingIsland, globe, crystals, galaxy, bars3d, abstractShapes), particles (`catalog particlePresets`), shaders (`catalog shaders`), procedural textures for any material slot (`catalog textures`: marble, wood, terrazzo, carbon, noise, voronoi, flakes, brushed, grid, checker, stripes, dots: `"map": { "procedural": "wood" }`), procedural environment lighting (`"lighting": "studio"`, `soft`, `sunset`, `night`) and physical skies, synth sounds (`catalog sounds`: coin, jump, hit, explosion, click, powerup, laser, win, lose, whoosh, ambient-pad, chiptune-loop).
2. **The built-in library** (ships with Agent3D, works offline, nothing to download, copied into the export automatically): about 130 models (rigged characters with animation clips: knight, mage, rogue, barbarian, skeleton, robot, mini soldier, platformer hero; animals, nature, buildings, city, food and bakery, vehicles, space; photoreal products and props: sneaker, velvet sofa, iridescent lamp, lounge chair, water bottle, boombox, marble bust, brass vase, alarm clock, potted succulent, rubber duck, modern armchair, coffee table…), 6 PBR texture sets (brick, concrete, fabric, grass ground, rusty metal, wood planks), 10 HDRIs (softbox, studio, warehouse, forest, city, beach, sky, sunset, night, night-city; each `.hdr` + `.jpg`), 13 fonts (`catalog fonts`).
3. **Free CC0 sources online**, downloaded **once** into `assets/` with their licence: Poly Haven (models, textures, HDRIs), ambientCG (textures, HDRIs), Khronos glTF samples (models; CC0 or CC-BY), Kenney and Quaternius (game packs; manual zip).
4. **The user's own files** (logo SVG, product GLB, brand audio): `assets add <file> --license …`.

## The built-in library

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets library --query tree --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets library --kind hdri --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets library --query character --kind model --json
```

The answer lists the matches in `data.assets[]` (with `data.total` and `data.more`; `assets search` below names its list `data.hits[]` instead). Each entry has `ref` (use it as is in the scene), `description` (with the bounding box), `tags`, `license`, `kb`, and for models `triangles`, `size` (bounding box w × h × d in model units, Y-up) and `animations` (the clip names of animated models). Listings show 50 results per page: narrow with `--query` and `--kind`; when `more` is true, page with `--offset 50` (or `--limit 100`, `--all`).

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets library --kind model --offset 50 --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets library --kind model --all --json
```

```json
{ "op": "addObject", "object": { "id": "tree", "kind": "model", "src": "library:models/nature/pine-tree.glb", "fit": 2, "position": [-6, -1, 0] } }
```

- Always set `fit` (the largest dimension in units): library models come in very different native sizes (the boombox is 2 cm, the lantern 26 units). `center: true` (default) puts the bottom centre at the object's position.
- Animated models: `"animation": { "clip": "Wave", "loop": true, "speed": 1 }` (clip name or index). The hit's `animations` lists the exact clip names (knight / mage / skeleton: `Idle`, `Walking_A`, `Running_A`, `Cheer`, `Jump_Full_Short`, `Death_A`…; robot: `Idle`, `Walking`, `Running`, `Dance`, `Jump`, `Wave`…); `--query walk` also matches clip names.
- Textures: `"material": { "map": "library:textures/brick-color.jpg", "normalMap": "library:textures/brick-normal.jpg", "roughnessMap": "library:textures/brick-roughness.jpg", "repeat": [3, 3] }`.
- HDRIs: `"environment": { "lighting": { "hdri": "library:hdri/softbox.hdr", "intensity": 1 } }` for reflections (softbox for products, warehouse / city / forest / beach for photoreal outdoors and interiors, studio / sky / sunset / night for lighter files); `"background": { "hdri": "library:hdri/forest.jpg", "blur": 0.2 }` to show it, with `"rotation": 120` to turn it and `"groundProjection": { "height": 2, "radius": 60 }` to stand objects on the photo's ground. Weight: `studio`, `sky`, `sunset`, `night` `.hdr` are ~360-410 KB; `softbox`, `warehouse`, `forest`, `city`, `beach`, `night-city` `.hdr` are 1.5-1.9 MB (fine for a hero or product scene, too heavy for a banner or card: use a procedural `lighting` preset there). The `.jpg` previews are 50-250 KB.
- Photoreal library models (products, props) carry 1k PBR textures and weigh 170 KB to 1.8 MB each: check `kb` and `triangles` in the listing, and prefer them for heroes and product scenes.
- Recolour a model: `"material": { "color": "#ff8fab" }` on the model object overrides every mesh (or `"preset": "clay"` for a uniform stylised look).

## Searching free sources (network)

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets search "wood planks" --kind texture --project my-scene --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets search sunset --kind hdri --source polyhaven --project my-scene --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets search fox --source khronos --project my-scene --json
```

The answer lists the matches in `data.hits[]`; each hit has `source`, `id`, `title`, `kind`, `license`, `author`, `attribution` (when the licence needs one), `previewUrl` (show it to the user or open it), `pageUrl`, `downloads` (resolutions / formats). Per-source failures come in `data.errors` without failing the search. Search terms match titles and tags: try synonyms ("planks", "wood floor") when a search is poor.

Download one hit into the project (licence recorded in `assets/manifest.json`):

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets add --hit @hit.json --resolution 1k --project my-scene --json
```

`@hit.json` is a file holding one hit object from the search (or pass the JSON inline). Models come back with `data.asset.bounds`: `size` (w × h × d in model units, node transforms applied), `center`, `min` / `max` and `upAxis` (`"y"`, or `"z?"` when the model is much deeper than tall — it may lie on its back; check it with `render --isolate <objectId>`, which renders that object alone from the front (+Z) on a neutral background). Local `.glb` / `.gltf` files added with `assets add <file>` return the same `bounds`. Textures from ambientCG / Poly Haven download the whole set (colour, normal, roughness, AO) and return `data.asset.suggestion.material`, a ready material to `set` on an object. Poly Haven models download as `.gltf` + `.bin` + textures in a folder: use the returned `path` as the model `src`. Keep `--resolution 1k` for the web (2k only for a hero close-up). Sources start at 1k: `--resolution 512` (or `256`) downloads 1k and downscales every texture to that size with headless Chrome (`data.asset.optimized`); `--max-size <px>` does the same for any resolution.

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets add --hit @hit.json --resolution 512 --project my-banner --json
```

## Kenney and Quaternius packs (manual zip)

Their hits are `manual: true`: there is no direct download (the hit's `note` says so). Ask the user to download the pack zip from `pageUrl` (free, no account), then import it with `assets add <file.zip>` (the zip importer extracts only `.glb` / `.gltf` + textures; `--filter` keeps the models whose path contains the word, repeat it for several words; `--name` sets the folder under `assets/models/`):

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets add ~/Downloads/kenney_platformer-kit.zip --source kenney --license CC0-1.0 --filter coin --filter flag --name platformer --project my-game --json
```

The answer lists the imported model paths (`models`) to use as `src`, plus `totalKb`. Importing a whole pack can add megabytes: always filter to what the scene uses. (MCP clients: the `assets_add` tool takes `{ "file", "source", "license", "filter": [...] }`.)

## The user's own files

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets add ./logo.svg --license proprietary --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets add ./bottle.glb --license proprietary --author "Acme" --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets add ./jingle.mp3 --kind audio --license CC-BY-4.0 --author "Jane Doe" --source-url https://example.com/jingle --project my-game --json
```

`--license` is required (an SPDX id such as `CC0-1.0`, `CC-BY-4.0`, or `proprietary` for the user's own work). Files go to `assets/models/`, `assets/textures/`, `assets/hdri/`, `assets/audio/`, `assets/fonts/`, `assets/svg/` or `assets/other/` by kind, unless `--path` says otherwise. SVG logos become 3D with an `svg` object; product models with a `model` object and `fit`; audio with `audio.sounds` / `audio.music` (`{ "src": "assets/audio/jingle.mp3" }`).

SVG logos and icons:

```json
{ "op": "addObject", "object": { "id": "logo", "kind": "svg", "src": "assets/svg/logo.svg", "size": 2.4, "fit": "height", "depth": 0.25, "bevel": 0.03, "position": [-9, 0, 0] } }
```

Each path keeps its SVG colour (`keepColors`: default `true` without a `material`, `false` with one; `true` + a material = that finish with the SVG colours). Strokes (`stroke-width`, joins, caps) become solid outlines, so line-icon sets work (`currentColor` takes the material colour; `"strokes": false` ignores strokes). `size` is the width (`fit: "height"` or `"max"` sizes the other or the larger side), `layerGap` separates stacked paths. `<text>` is not supported: ask for the logo with text converted to outlines. Check it with `render --isolate logo`.

## Depth maps for 3D photos

When the user gives a photo and wants it to move in 3D (a "3D photo", parallax photo, "bring this picture to life"), the photo needs a **depth map**: a grey PNG, white = near, black = far, the same aspect as the photo. Estimate it locally:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets add ./street.jpg --license CC0-1.0 --author "Jane Doe" --project my-hero --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets depth assets/textures/street.jpg --project my-hero --json
```

- **Output.** `data.path` = `assets/depth/<photo name>-depth.png` (`--out` to change), at the photo size capped at 2048 px (`--max-size`), transparent on depth jumps (the runtime hides stretched edges there). `data.suggestion` is a ready `{ "kind": "photo", "src", "depth" }` object; `data.ms` the time taken (about 1-1.5 s per photo plus ~2 s to start Chrome). `--size` is the model input long side (default 518; up to 1036 for finer edges, about 4× slower).
- **Model.** Depth Anything V2 Small (27 MB, Apache-2.0), run in headless Chrome like `render` (WebAssembly, no GPU, no account). The **first run downloads it once** into `~/.agent3d/models/` (the `AGENT3D_MODELS` environment variable moves that folder); every later run works **offline**. Offline before the first download: the error hint gives the model URL and the folder to put it in, or paint a depth map by hand (grey PNG, white = near) and set it as `depth`. The model never goes into exports: only the PNG does.
- **Licence.** The depth map is registered in `assets/manifest.json` with the **photo's** licence and author (add the photo with `assets add --license … --author …` first; a photo missing from the manifest gives `derived`) and an attribution line naming the model. Ask the user who took the photo and under which licence before using it.
- Use it on a `photo` object (`src` = the photo, `depth` = `data.path`); skill `agent3d-create` covers the modes, motion and framing. Keep depth maps as PNG: `check` warns on a JPEG depth map (`photo-depth-lossy`), and `assets optimize` only resizes PNG depth maps losslessly.
- MCP: `image_depth { "image", "out", "size", "maxSize" }` returns the same fields; hosts without headless Chrome refuse it with a hint.

## Listing and removing

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets list --project my-scene --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets remove assets/textures/old.jpg --project my-scene --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets remove assets/textures/old.jpg --yes --project my-scene --json
```

`assets list` shows each file's size on disk, licence, whether it exists and which objects use it (`usedBy`); it is read-only: entries whose recorded size differs from the file on disk are listed in `stale` (`assets optimize` / `assets add` rewrite the manifest). `remove` prints a plan (with `usedBy`) unless `--yes`: fix the references first.

## Optimising textures and models

When `check` reports `budget` or `optimizable`, or before exporting a scene with project textures / `.glb` models, run `assets optimize`. Without `--yes` it prints the plan (no Chrome needed): for every file the size it will get and **why** (target kind, the object's size on screen, the camera distance, the texture role). Show the plan to the user, then apply:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets optimize --all --project my-hero --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets optimize --all --dry-run --project my-hero --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets optimize --all --yes --project my-hero --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets optimize assets/models/robot.glb --simplify 0.5 --yes --project my-game --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py assets optimize assets/textures/wood_planks --max-size 512 --format jpeg --yes --project my-banner --json
```

- **Smart size (default).** Each texture gets the smallest tier (256 / 512 / 1024 / 2048; up to 4096 for an equirect background) that still gives about one texel per screen pixel where the scene shows it: canvas size from the target (a hero ≈ 2880×1620 device px), object size (`fit`, geometry, scale) and closest camera distance (orbit zoom, scroll paths and timeline camera keys count), divided by `repeat`. Normal maps get ~0.75× and roughness ~0.5× of the colour size; a model's atlas ~1.5× its on-screen size. Heroes never go below 512 for colour maps; games and cards are capped at 1024. Textures not placed in `scene.json` (scripts, unused) get 1024. `--max-size <px>` forces one size for everything. Never upscales.
- **WebP (default `--format auto`).** Standalone `.jpg` / `.png` files become `.webp`: the file is renamed and every `scene.json` reference rewritten (`renamed` in the result) — unless a script, a `.gltf` or scene data names the file, then the format is kept (`note`). Images inside `.glb` models become WebP with `EXT_texture_webp`. `--format jpeg|png|keep` for other needs; `--quality` (default 80; normal maps at least 90).
- **Geometry.** `.glb` models are welded (duplicate vertices merged), reordered for the GPU vertex cache and compressed with meshopt (`EXT_meshopt_compression`, 16-bit positions / UVs, 10-bit normals — invisible), which typically cuts the geometry by 60–80 %; the runtime loads the decoder (~27 KB) only for models that use it. It is WebAssembly: a site with a strict Content-Security-Policy needs `'wasm-unsafe-eval'` in `script-src` for scenes with compressed models (tell the user; skill `agent3d-publish` covers CSP). `--simplify 0.5` keeps about half of the triangles within `--simplify-error` (default 0.01 = 1 % of the mesh size; the result says when it stopped early); `--compress none` skips meshopt. Draco-compressed models cannot be decoded (the runtime refuses them too): re-export them without Draco.
- A file only changes when it gets clearly smaller (re-encoding without resizing needs a 10 % gain); `assets/manifest.json` follows. Each file reports `maxSize`, `sizeReason`, its images (`role`, `from` / `to` as `WxH type KB`) and `geometry` (triangles / vertices before and after, filters). `--dry-run` encodes everything and returns the real savings without writing.
- After applying, run `check` and `render` and look at the image: textures and models must look the same. If a surface looks soft, re-run that file with `--max-size 2048`.
- Library assets (`library:`) are never modified, and `.hdr` / `.exr` files are not optimised at all: when a library HDRI pushes a scene over its KB budget, `assets optimize` has nothing to do (`files: []`); switch to a lighter HDRI or a procedural `lighting` preset. `export --optimize` exports optimised copies of every asset (library ones included; textures keep their format there) without touching the project.
- Textures need headless Chrome (like `render`); geometry does not. MCP: `assets_optimize` takes `{ "paths": [...] | "all": true, "maxSize", "quality", "format", "compress", "simplify", "simplifyError", "dryRun" }` — call it with `dryRun: true` first.

## Licences and attribution

- CC0 needs no credit; everything Agent3D searches is CC0, except some Khronos samples (CC-BY-4.0). In the library, the fonts are OFL-1.1 and four models need a credit: `models/products/sneaker.glb` (Shopify, CC-BY-4.0), `models/products/iridescent-lamp.glb` and `models/products/velvet-sofa.glb` (Eric Chadwick, Wayfair, CC-BY-4.0) and `models/animals/fox.glb` (CC-BY parts). Using them is fine: the listing shows `license` and `author`, `check` reports the credit and the export writes it.
- `check` lists every asset whose licence needs attribution (`licences`, and `attribution` infos); `export` writes them to `<name>/CREDITS.txt` and returns `credits`. Tell the user to keep the credits (a line near the embed or on a credits page).
- Never download from sites that need an account, scrape a page, or add a file whose licence you don't know. If the user supplies a file, ask who made it and under which licence.
- Exports never hotlink: every file is copied into the export.

## Budgets

The `check` KB budget per target counts assets + scripts + scene (runtime excluded): banner 600 KB, card 400, square / inline 600, hero 1500, fullscreen / game 4000 (`target.budgetKb` overrides it). Typical sizes: a library model 6 KB to 1.8 MB (median ~30 KB; photoreal products 170 KB to 1.8 MB), a library texture set ~150–270 KB, a library HDRI 0.36–1.9 MB (`.hdr`) or 50–250 KB (`.jpg`), a library font 80–230 KB (copied only when used), a downloaded 1k texture set 2–4 MB (the colour JPG alone ~1.3 MB), a Poly Haven 1k HDRI ~1.5 MB. A banner with a downloaded 1k texture set is already over budget: prefer library textures, `repeat` a small texture, or a material colour. Details and the per-source notes: [references/sources.md](references/sources.md).
