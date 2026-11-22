# Assets

Scenes reference assets by **project path** (`assets/models/bottle.glb`) or by **library id** (`library:models/products/water-bottle.glb`). Exports copy every referenced file; nothing is hotlinked.

## The built-in library

`library/` ships in the npm package and works offline: ~107 low-poly glTF models (rigged characters with animation clips, animals, nature, buildings, city, food, products, props, vehicles, space…), 6 PBR texture sets (colour, normal, roughness), 4 HDRIs (studio, sky, sunset, night; `.hdr` for lighting, `.jpg` for backgrounds) and 5 fonts. `library/index.json` lists each item with its licence, author, tags, size and (models) bounding box and triangle count.

```bash
npx -y @fleox/agent3d@0.1.0 assets library --query tree --json
npx -y @fleox/agent3d@0.1.0 assets library --kind hdri --json
```

Everything is CC0 except the fonts (Apache-2.0 / OFL-1.1) and the Khronos fox (CC-BY 4.0 parts). Sources and per-file provenance: [`library/LICENSES.md`](../library/LICENSES.md) and `library/sources.json`.

## Project assets

`assets/` + `assets/manifest.json` (`AssetEntry`: path, kind, bytes, source, sourceUrl, license, author, attribution, addedAt).

```bash
npx -y @fleox/agent3d@0.1.0 assets add ./logo.svg --license proprietary --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets list --project my-banner --json
npx -y @fleox/agent3d@0.1.0 assets remove assets/svg/logo.svg --yes --project my-banner --json
```

`--license` is required for local files. Files go to `assets/models|textures|hdri|audio|fonts|svg|other/` by kind unless `--path` is given. `assets list` reports `exists` and `usedBy` for each entry.

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
npx -y @fleox/agent3d@0.1.0 tools call assets_add --input '{"file": "/path/kenney_pack.zip", "source": "kenney", "license": "CC0-1.0", "filter": ["tree"]}' --project my-scene --json
```

Texture downloads return a `suggestion.material` using the set (map, normalMap, roughnessMap). Per-source failures are reported in `errors` without failing the search. Tests never touch the network (sources take an injected `fetch`).

## Licences in checks and exports

`check` lists assets whose licence requires attribution (`licences`, `attribution` infos); `export` writes them to `<name>/CREDITS.txt`, returns them as `credits` and shows them on the demo page.

## Procedural content

Generators (terrain, trees, rocks, grass, flowers, water, clouds, city, character, planet, starfield, blob, waveGrid, maze, road), particle presets, shaders and synth sounds cost zero bytes and are deterministic with `seed`. See [catalog.md](catalog.md).
