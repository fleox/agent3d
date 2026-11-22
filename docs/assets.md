# Assets

Scenes reference assets by **project path** (`assets/models/bottle.glb`) or by **library id** (`library:models/products/water-bottle.glb`). Exports copy every referenced file; nothing is hotlinked.

## The built-in library

`library/` ships in the npm package and works offline: ~107 low-poly glTF models (rigged characters with animation clips, animals, nature, buildings, city, food, products, props, vehicles, space…), 6 PBR texture sets (colour, normal, roughness), 4 HDRIs (studio, sky, sunset, night; `.hdr` for lighting, `.jpg` for backgrounds) and 5 fonts. `library/index.json` lists each item with its licence, author, tags, size and (models) bounding box and triangle count.

```bash
npx -y @fleox/agent3d@0.1.0 assets library --query tree --json
npx -y @fleox/agent3d@0.1.0 assets library --kind hdri --json
npx -y @fleox/agent3d@0.1.0 assets library --kind model --all --json
```

Hits carry `ref`, `kind`, `kb`, `license`, `tags`, `description` and, for models, `triangles` and `animations` (clip names). 50 results per page: `--limit`, `--offset` (when `more` is true) or `--all` (the `library_list` tool takes `limit` — 0 for all — and `offset`).

Everything is CC0 except the fonts (Apache-2.0 / OFL-1.1) and the Khronos fox (CC-BY 4.0 parts). Sources and per-file provenance: [`library/LICENSES.md`](../library/LICENSES.md) and `library/sources.json`.

## Project assets

`assets/` + `assets/manifest.json` (`AssetEntry`: path, kind, bytes, source, sourceUrl, license, author, attribution, addedAt).

```bash
npx -y @fleox/agent3d@0.1.0 assets add ./logo.svg --license proprietary --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets list --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets remove assets/svg/logo.svg --yes --project my-banner --json
```

`--license` is required for local files. Files go to `assets/models|textures|hdri|audio|fonts|svg|other/` by kind unless `--path` is given. `assets list` reports `exists`, `usedBy` and the size on disk for each entry (stale manifest sizes are rewritten; `refreshed` lists them). Models (`assets add <file>.glb` or a downloaded hit) return `bounds` — `size` (w × h × d, node transforms applied), `center`, `min`, `max` and an `upAxis` guess (`"y"`, or `"z?"` for models that may have been exported Z-up) — and `agent3d render --isolate <objectId>` shows one object alone, auto-framed, to check its orientation.

### Shrinking textures

```bash
npx -y @fleox/agent3d@0.1.0 assets optimize assets/textures/wood_planks --max-size 512 --yes --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets optimize --all --max-size 1024 --quality 80 --yes --project my-hero --json
```

`assets optimize [<path>…] [--all] [--max-size 1024] [--quality 80]` decodes, downscales (longest side, never upscales) and re-encodes textures in headless Chrome (canvas): standalone `.jpg` / `.png` / `.webp` keep their format and path; images embedded in `.glb` models are rewritten inside the binary chunk (bufferViews re-packed, opaque PNGs become JPEG). A file changes only when the result is smaller; manifest sizes are refreshed. It is lossy, so it prints a plan unless `--yes`. `check`'s budget warning names the heaviest files and points here. `assets add --hit … --resolution 512` (below the 1k minimum of Poly Haven / ambientCG) downloads 1k and downscales it the same way; `--max-size` does it for any resolution.

## Free online sources

Searched live, downloaded once into the project with their licence (`src/ops/sources/`):

| Source | Kinds | Licence | Download |
|---|---|---|---|
| Poly Haven | models, textures, HDRIs | CC0 | direct (`assets add --hit`) |
| ambientCG | textures, HDRIs | CC0 | direct (zip extracted) |
| Khronos glTF-Sample-Assets | models | CC0 or CC-BY-4.0 | direct |
| Kenney | model packs | CC0 | manual zip, then import |
| Quaternius | model packs | CC0 | manual zip, then import |

```bash
npx -y @fleox/agent3d@0.1.0 assets search "wood planks" --kind texture --project my-scene --json
npx -y @fleox/agent3d@0.1.0 assets add --hit @hit.json --resolution 1k --project my-scene --json
npx -y @fleox/agent3d@0.1.0 assets add /path/kenney_pack.zip --source kenney --license CC0-1.0 --filter tree --project my-scene --json
```

Pack zips (Kenney, Quaternius): `assets add <file.zip> --source kenney|quaternius|local --license CC0-1.0 [--filter <word>]… [--name <pack>]` extracts only `.glb` / `.gltf` + textures into `assets/models/<name>/`. Texture downloads return a `suggestion.material` using the set (map, normalMap, roughnessMap). Per-source failures are reported in `errors` without failing the search. Tests never touch the network (sources take an injected `fetch`).

## Licences in checks and exports

`check` lists assets whose licence requires attribution (`licences`, `attribution` infos); `export` writes them to `<name>/CREDITS.txt`, returns them as `credits` and shows them on the demo page.

## Procedural content

Generators (terrain, trees, rocks, grass, flowers, water, clouds, city, character, planet, starfield, blob, waveGrid, maze, road), particle presets, shaders and synth sounds cost zero bytes and are deterministic with `seed`. See [catalog.md](catalog.md).
