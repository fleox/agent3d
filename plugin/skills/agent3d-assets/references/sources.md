# Asset sources

Agent3D only uses free sources that need **no account** and allow redistribution, and it downloads each file **once into the project** (`assets/` + `assets/manifest.json`). At run time nothing is fetched from those sites: exports carry their own copies.

| Source | `--source` | Kinds | Licence | How |
|---|---|---|---|---|
| Built-in library | (none: `assets library`) | models, textures, HDRIs, fonts | CC0, except fonts (OFL-1.1), three Khronos product samples (sneaker, iridescent lamp, velvet sofa: CC-BY-4.0) and the fox (CC-BY parts) | `library:<id>` in the scene, copied into exports (fonts only when used) |
| Poly Haven (polyhaven.com) | `polyhaven` | model, texture, hdri | CC0 | `assets search` → `assets add --hit` (models: `.gltf` + `.bin` + textures) |
| ambientCG (ambientcg.com) | `ambientcg` | texture, hdri | CC0 | `assets search` → `assets add --hit` (zip extracted: colour, normal GL, roughness, AO) |
| Khronos glTF-Sample-Assets | `khronos` | model | CC0 or CC-BY-4.0 (attribution recorded) | `assets search` → `assets add --hit` (`.glb`) |
| Kenney (kenney.nl) | `kenney` | model packs | CC0 | curated index; the user downloads the zip, then `assets add <file.zip> --source kenney --license CC0-1.0 --filter <word>` |
| Quaternius (quaternius.com) | `quaternius` | model packs (characters, animals, nature) | CC0 | same as Kenney, with `--source quaternius` |

## The manifest

`assets/manifest.json` holds one entry per file: `path`, `kind` (model, texture, hdri, audio, font, svg, other), `bytes`, `source` (local, polyhaven, ambientcg, khronos, kenney, quaternius or a URL), `sourceUrl`, `license`, `author`, `attribution` (the text to show when the licence asks for it), `addedAt`. Never edit it by hand: `assets add` and `assets remove` keep it right, `check` reads it, `export` turns it into `CREDITS.txt`.

## Choosing resolutions

- Textures: 1k for anything that is not full-screen. A 1k colour map is ~1.3 MB as JPG; normal and roughness maps add as much again. Tile with `repeat` rather than going up in resolution.
- HDRIs for lighting only (not shown): a 512 × 256 `.hdr` is enough (library `studio`, `sky`, `sunset`, `night`, ~360-410 KB); the library's 1024 × 512 `.hdr` files (`softbox`, `warehouse`, `forest`, `city`, `beach`, `night-city`, 1.5-1.9 MB) give crisper reflections for products and heroes. Shown as a background: a `.jpg` equirect (library: 1024 × 512 or 2048 × 1024), with `blur` to hide its resolution. `assets optimize` does not shrink `.hdr` / `.exr` files: pick the resolution at download time (`--resolution 1k`).
- Procedural alternatives cost zero bytes: `lighting` presets (`studio`, `soft`, `sunset`, `night`), physical skies, procedural textures (`catalog textures`).
- Models: prefer low-poly (Kenney, Quaternius, the library) for banners and games. Photogrammetry models from Poly Haven are heavy (tens of thousands of triangles plus 1k–4k textures): use them only in heroes or product scenes, check the budget with `check --render`, and run `assets optimize` (smart texture sizes, WebP, meshopt geometry, optional `--simplify`) before exporting.

## Attribution text

When `license` is CC-BY-4.0 (Khronos samples, the library's sneaker, iridescent lamp, velvet sofa and fox) or OFL-1.1 (library fonts), keep the credit that `check` and `export` give (for example: `"Fox" — Model by PixelMannen (CC0-1.0); Rigging & Animation by tomkranis (CC-BY-4.0)… Source: Khronos glTF-Sample-Assets.`). Put it on the page near the element or on a credits page, with a link to the licence. CC0 assets need nothing, but crediting Poly Haven, ambientCG, Kenney or Quaternius is appreciated.

## What not to do

- Don't use assets from marketplaces or sites that need a login (Sketchfab, TurboSquid, CGTrader…) through Agent3D: their licences vary per file and downloads need accounts. If the user owns such a file, they add it themselves with `assets add <file> --license <their licence>`.
- Don't hotlink: a URL in `src` would make the export depend on another site. Download into the project instead.
- Don't import whole packs: filter to the models the scene uses (`--filter coin --filter flag`).
