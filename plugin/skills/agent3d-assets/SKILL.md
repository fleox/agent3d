---
name: agent3d-assets
description: Find and add 3D assets to an Agent3D project - the built-in CC0 library shipped offline (models, PBR textures, HDRIs, fonts), procedural generators that cost zero bytes, free account-less CC0 sources (Poly Haven, ambientCG, Khronos samples searched and downloaded once into the project; Kenney and Quaternius packs imported from a zip the user downloads), the user's own files, licences and attribution, and size budgets. Use when a scene needs a model, a texture, an HDRI, a logo, a sound or music, or when the user asks where assets come from or how they are licensed.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge) for renders.
metadata:
  version: "0.1.0"
  repository: "https://github.com/fleox/agent3d"
allowed-tools: Bash Read Write
---

# Assets for Agent3D scenes

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `npx -y @fleox/agent3d@0.1.0 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Pick the cheapest thing that looks right

1. **Procedural first** (zero download, deterministic, recolourable): primitives (`catalog geometries`), generators (`catalog generators`: terrain, trees, rocks, grass, flowers, water, clouds, city, character, planet, starfield, blob, waveGrid, maze, road), particles (`catalog particlePresets`), shaders, synth sounds (`catalog sounds`: coin, jump, hit, explosion, click, powerup, laser, win, lose, whoosh, ambient-pad, chiptune-loop).
2. **The built-in library** (ships with Agent3D, works offline, nothing to download, copied into the export automatically): ~110 low-poly models (characters, animals, nature, buildings, city, food and bakery, products, props, vehicles, space…), PBR texture sets (brick, concrete, fabric, grass ground, rusty metal, wood planks), 4 HDRIs (studio, sky, sunset, night), 5 fonts.
3. **Free CC0 sources online**, downloaded **once** into `assets/` with their licence: Poly Haven (models, textures, HDRIs), ambientCG (textures, HDRIs), Khronos glTF samples (models; CC0 or CC-BY), Kenney and Quaternius (game packs; manual zip).
4. **The user's own files** (logo SVG, product GLB, brand audio): `assets add <file> --license …`.

## The built-in library

```bash
npx -y @fleox/agent3d@0.1.0 assets library --query tree --json
npx -y @fleox/agent3d@0.1.0 assets library --kind hdri --json
npx -y @fleox/agent3d@0.1.0 assets library --query character --kind model --json
```

Each hit has `ref` (use it as is in the scene), `description` (with the bounding box), `tags`, `license`, `kb`, and for models `triangles` and `animations` (the clip names of animated models). Listings show 50 results per page: narrow with `--query` and `--kind`; when `more` is true, page with `--offset 50` (or `--limit 100`, `--all`).

```bash
npx -y @fleox/agent3d@0.1.0 assets library --kind model --offset 50 --json
npx -y @fleox/agent3d@0.1.0 assets library --kind model --all --json
```

```json
{ "op": "addObject", "object": { "id": "tree", "kind": "model", "src": "library:models/nature/pine-tree.glb", "fit": 2, "position": [-6, -1, 0] } }
```

- Always set `fit` (the largest dimension in units): library models come in very different native sizes (the boombox is 2 cm, the lantern 26 units). `center: true` (default) puts the bottom centre at the object's position.
- Animated models: `"animation": { "clip": "Wave", "loop": true, "speed": 1 }` (clip name or index). The hit's `animations` lists the exact clip names (knight / mage / skeleton: `Idle`, `Walking_A`, `Running_A`, `Cheer`, `Jump_Full_Short`, `Death_A`…; robot: `Idle`, `Walking`, `Running`, `Dance`, `Jump`, `Wave`…); `--query walk` also matches clip names.
- Textures: `"material": { "map": "library:textures/brick-color.jpg", "normalMap": "library:textures/brick-normal.jpg", "roughnessMap": "library:textures/brick-roughness.jpg", "repeat": [3, 3] }`.
- HDRIs: `"environment": { "lighting": { "hdri": "library:hdri/studio.hdr", "intensity": 1 } }` for reflections; `"background": { "hdri": "library:hdri/sunset.jpg", "blur": 0.2 }` to show it.
- Recolour a model: `"material": { "color": "#ff8fab" }` on the model object overrides every mesh (or `"preset": "clay"` for a uniform stylised look).

## Searching free sources (network)

```bash
npx -y @fleox/agent3d@0.1.0 assets search "wood planks" --kind texture --project my-scene --json
npx -y @fleox/agent3d@0.1.0 assets search sunset --kind hdri --source polyhaven --project my-scene --json
npx -y @fleox/agent3d@0.1.0 assets search fox --source khronos --project my-scene --json
```

Hits: `source`, `id`, `title`, `kind`, `license`, `author`, `attribution` (when the licence needs one), `previewUrl` (show it to the user or open it), `pageUrl`, `downloads` (resolutions / formats). Per-source failures come in `data.errors` without failing the search. Search terms match titles and tags: try synonyms ("planks", "wood floor") when a search is poor.

Download one hit into the project (licence recorded in `assets/manifest.json`):

```bash
npx -y @fleox/agent3d@0.1.0 assets add --hit @hit.json --resolution 1k --project my-scene --json
```

`@hit.json` is a file holding one hit object from the search (or pass the JSON inline). Models come back with `data.asset.bounds`: `size` (w × h × d in model units, node transforms applied), `center`, `min` / `max` and `upAxis` (`"y"`, or `"z?"` when the model is much deeper than tall — it may lie on its back; check it with `render --isolate <objectId>`). Local `.glb` / `.gltf` files added with `assets add <file>` return the same `bounds`. Textures from ambientCG / Poly Haven download the whole set (colour, normal, roughness, AO) and return `data.asset.suggestion.material`, a ready material to `set` on an object. Poly Haven models download as `.gltf` + `.bin` + textures in a folder: use the returned `path` as the model `src`. Keep `--resolution 1k` for the web (2k only for a hero close-up). Sources start at 1k: `--resolution 512` (or `256`) downloads 1k and downscales every texture to that size with headless Chrome (`data.asset.optimized`); `--max-size <px>` does the same for any resolution.

```bash
npx -y @fleox/agent3d@0.1.0 assets add --hit @hit.json --resolution 512 --project my-banner --json
```

## Kenney and Quaternius packs (manual zip)

Their hits are `manual: true`: there is no direct download (the hit's `note` says so). Ask the user to download the pack zip from `pageUrl` (free, no account), then import it with `assets add <file.zip>` (the zip importer extracts only `.glb` / `.gltf` + textures; `--filter` keeps the models whose path contains the word, repeat it for several words; `--name` sets the folder under `assets/models/`):

```bash
npx -y @fleox/agent3d@0.1.0 assets add ~/Downloads/kenney_platformer-kit.zip --source kenney --license CC0-1.0 --filter coin --filter flag --name platformer --project my-game --json
```

The answer lists the imported model paths (`models`) to use as `src`, plus `totalKb`. Importing a whole pack can add megabytes: always filter to what the scene uses. (MCP clients: the `assets_add` tool takes `{ "file", "source", "license", "filter": [...] }`.)

## The user's own files

```bash
npx -y @fleox/agent3d@0.1.0 assets add ./logo.svg --license proprietary --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets add ./bottle.glb --license proprietary --author "Acme" --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets add ./jingle.mp3 --kind audio --license CC-BY-4.0 --author "Jane Doe" --source-url https://example.com/jingle --project my-game --json
```

`--license` is required (an SPDX id such as `CC0-1.0`, `CC-BY-4.0`, or `proprietary` for the user's own work). Files go to `assets/models/`, `assets/textures/`, `assets/hdri/`, `assets/audio/`, `assets/fonts/`, `assets/svg/` or `assets/other/` by kind, unless `--path` says otherwise. SVG logos become 3D with an `svg` object; product models with a `model` object and `fit`; audio with `audio.sounds` / `audio.music` (`{ "src": "assets/audio/jingle.mp3" }`).

## Listing and removing

```bash
npx -y @fleox/agent3d@0.1.0 assets list --project my-scene --json
npx -y @fleox/agent3d@0.1.0 assets remove assets/textures/old.jpg --project my-scene --json
npx -y @fleox/agent3d@0.1.0 assets remove assets/textures/old.jpg --yes --project my-scene --json
```

`assets list` shows each file's size on disk, licence, whether it exists and which objects use it (`usedBy`); sizes that changed on disk are rewritten into `assets/manifest.json` (`refreshed`). `remove` prints a plan (with `usedBy`) unless `--yes`: fix the references first.

## Shrinking textures (over budget)

When `check` reports `budget`, its hint names the heaviest files. Downscale them in place (lossy, so it prints a plan unless `--yes`):

```bash
npx -y @fleox/agent3d@0.1.0 assets optimize assets/textures/wood_planks --max-size 512 --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets optimize assets/textures/wood_planks --max-size 512 --yes --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets optimize --all --max-size 1024 --quality 75 --yes --project my-hero --json
```

- Paths are files or folders; `--all` takes every texture and `.glb` under `assets/`. `--max-size` (default 1024) is the longest side in pixels, never upscaled; `--quality` (default 80) applies to JPEG / WebP.
- Standalone `.jpg` / `.png` / `.webp` keep their format and path (the scene does not change). Images embedded in a `.glb` are re-encoded inside the binary (an opaque PNG becomes a JPEG). A file is only rewritten when it gets smaller; `assets/manifest.json` sizes follow.
- The result lists every file (`beforeBytes`, `afterBytes`, `changed`) and image (`from` / `to` as `WxH type KB`), plus `savedKb`. Run `check` again, then `render` to make sure the textures still look right (512 suits banners and small props; keep 1024 for a hero's main surface).
- Needs headless Chrome (like `render`). MCP: the `assets_optimize` tool takes `{ "paths": [...] | "all": true, "maxSize", "quality" }`.

## Licences and attribution

- CC0 needs no credit; everything Agent3D searches is CC0, except some Khronos samples (CC-BY-4.0) and the library's fonts (Apache-2.0 / OFL-1.1) and fox model (CC-BY parts).
- `check` lists every asset whose licence needs attribution (`licences`, and `attribution` infos); `export` writes them to `<name>/CREDITS.txt` and returns `credits`. Tell the user to keep the credits (a line near the embed or on a credits page).
- Never download from sites that need an account, scrape a page, or add a file whose licence you don't know. If the user supplies a file, ask who made it and under which licence.
- Exports never hotlink: every file is copied into the export.

## Budgets

The `check` KB budget per target counts assets + scripts + scene (runtime excluded): banner 600 KB, card 400, square / inline 600, hero 1500, fullscreen / game 4000 (`target.budgetKb` overrides it). Typical sizes: a library model 5–800 KB (median ~25 KB), a library texture set ~200–300 KB, a library HDRI ~350–400 KB (`.hdr`) or ~70–150 KB (`.jpg`), a downloaded 1k texture set 2–4 MB (the colour JPG alone ~1.3 MB), a Poly Haven 1k HDRI ~1.5 MB. A banner with a downloaded 1k texture set is already over budget: prefer library textures, `repeat` a small texture, or a material colour. Details and the per-source notes: [references/sources.md](references/sources.md).
