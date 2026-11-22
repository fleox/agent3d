# Assets

Scenes reference assets by **project path** (`assets/models/bottle.glb`) or by **library id** (`library:models/products/water-bottle.glb`). Exports copy every referenced file; nothing is hotlinked.

## The built-in library

`library/` ships in the npm package and works offline: about 130 glTF models (rigged characters with animation clips, animals, nature, buildings, city, food and bakery (croissant, baguette, bread loaf, donut, cupcake, cookie, pain au chocolat), photoreal products (sneaker, sofa, lamp, boombox…), props, platformer kit, vehicles, space…), 6 PBR texture sets (brick, concrete, fabric, grass ground, rusty metal, wood planks: colour, normal, roughness), 10 HDRIs (softbox, studio, warehouse, forest, city, beach, sky, sunset, night, night-city; `.hdr` for lighting, `.jpg` for backgrounds) and the 13 text fonts. `library/index.json` lists each item with its licence, author, tags, size and (models) bounding box and triangle count.

```bash
npx -y @fleox/agent3d@0.2.1 assets library --query tree --json
npx -y @fleox/agent3d@0.2.1 assets library --kind hdri --json
npx -y @fleox/agent3d@0.2.1 assets library --kind model --all --json
```

Hits carry `ref`, `kind`, `kb`, `license`, `tags`, `description` and, for models, `triangles`, `animations` (clip names) and `size` (bounding box w × h × d, Y-up) — use it to pick `fit`. 50 results per page: `--limit`, `--offset` (when `more` is true) or `--all` (the `library_list` tool takes `limit` — 0 for all — and `offset`).

Everything is CC0 except the fonts (OFL-1.1) and four Khronos glTF samples under CC-BY-4.0: `models/products/sneaker.glb` (Shopify), `iridescent-lamp.glb` and `velvet-sofa.glb` (Wayfair), and the animated fox (CC-BY parts). Using them is fine; `check` reports their credit and exports write it to `CREDITS.txt` and the demo page. Sources and per-file provenance: [`library/LICENSES.md`](../library/LICENSES.md) and `library/sources.json`.

## Project assets

`assets/` + `assets/manifest.json` (`AssetEntry`: path, kind, bytes, source, sourceUrl, license, author, attribution, addedAt).

```bash
npx -y @fleox/agent3d@0.2.1 assets add ./logo.svg --license proprietary --project my-banner --json
npx -y @fleox/agent3d@0.2.1 assets list --project my-banner --json
npx -y @fleox/agent3d@0.2.1 assets remove assets/svg/logo.svg --yes --project my-banner --json
```

`--license` is required for local files. Files go to `assets/models|textures|hdri|audio|fonts|svg|other/` by kind unless `--path` is given. `assets list` reports `exists`, `usedBy` and the size on disk for each entry (read-only: `stale` lists entries whose recorded size differs from the file). Models (`assets add <file>.glb` or a downloaded hit) return `bounds` — `size` (w × h × d, node transforms applied), `center`, `min`, `max` and an `upAxis` guess (`"y"`, or `"z?"` for models that may have been exported Z-up) — and `agent3d render --isolate <objectId>` shows one object alone, auto-framed, to check its orientation.

### Optimising textures and models

```bash
npx -y @fleox/agent3d@0.2.1 assets optimize --all --project my-hero --json            # plan: size per file + why
npx -y @fleox/agent3d@0.2.1 assets optimize --all --dry-run --project my-hero --json  # real savings, nothing written
npx -y @fleox/agent3d@0.2.1 assets optimize --all --yes --project my-hero --json
npx -y @fleox/agent3d@0.2.1 assets optimize assets/models/robot.glb --simplify 0.5 --yes --project my-game --json
```

`assets optimize [<path>…] [--all] [--max-size <px>] [--format auto|webp|jpeg|png|keep] [--quality 80] [--compress meshopt|none] [--simplify <ratio>] [--simplify-error 0.01] [--dry-run] [--yes]` (`src/ops/optimize.ts`, MCP `assets_optimize`):

**Smart texture sizes** (`src/ops/optimizeSizing.ts`). Unless `--max-size` forces one size, every texture gets the size the scene needs, reported with the reason:

- canvas size from the target: a reference CSS width per kind (banner / hero 1440, fullscreen 1920, game 1280, inline 800, square 600, card 400) × the aspect (or `target.height`) × the DPR (`maxDpr`, max 2);
- the object's size on screen: its size (`fit`, geometry parameters, text length, `scale` up the tree, timeline scale keys) over the visible height at its closest camera distance (fixed camera, scroll path, timeline camera / object keys, follow offset, orbit `minDistance` — or 0.6× the distance when zoom is free); orthographic cameras use `zoom`;
- divided by the material `repeat`, times the role factor (colour 1, normal 0.75, roughness / metalness / AO 0.5), times 1.5 for a model's texture atlas, plus a 15 % margin;
- rounded up to a tier: 256 / 512 / 1024 / 2048 (equirect backgrounds use the horizontal field of view, ÷ blur, tiers up to 4096; HDRI used only for lighting: 1024). Colour maps never go below 512 on heroes / fullscreen; cards and games are capped at 1024. Textures the scene does not place (scripts, unused files) get 1024. Never upscales.

**Formats.** `auto` (default) = WebP — smaller than JPEG at the same quality, with alpha, decoded by every browser. Standalone files are renamed (`wood.jpg` → `wood.webp`), `scene.json` references and the manifest are rewritten (`renamed`); a file named by a script, a `.gltf` or scene data keeps its format. Images inside `.glb` models become WebP through `EXT_texture_webp` (required; three.js' GLTFLoader supports it). `jpeg` keeps images with alpha in their format; `png` is lossless; `keep` never changes formats. `--quality` (default 80) applies to WebP / JPEG; normal maps use at least 90. Re-encoding without resizing must save 10 % (generation loss is not worth less).

**Geometry** (`src/ops/optimizeGlb.ts`, the MIT `meshoptimizer` package — pure WebAssembly embedded in JS, works offline). Every `.glb` is welded (bitwise-identical vertices merged; non-indexed meshes become indexed) and reordered for the vertex cache — lossless. With `--compress meshopt` (default) positions and UVs go through the exponential filter (16-bit mantissa, shared exponent per component — seams stay watertight), normals / tangents through the octahedral filter (10 bits, `KHR_mesh_quantization`), and every vertex, index, animation and skin buffer is compressed with `EXT_meshopt_compression` (required, fallback buffer without data). Library models shrink by 40–80 % (castle 315 → 83 KB, forest patch 138 → 26 KB, boombox 249 → 96 KB). `--simplify <ratio>` keeps that fraction of each mesh's triangles within `--simplify-error` (fraction of the mesh size, default 0.01; borders locked); the result says when the bound stopped it early. Already meshopt-compressed files are decoded and re-encoded. Morph-target meshes are welded and compressed but not simplified; sparse accessors and Draco keep their geometry.

A file is only rewritten when it gets smaller; manifest sizes are refreshed. Without `--yes` the command prints the plan (sizes and reasons, no Chrome needed); `--dry-run` encodes everything (Chrome) and reports the real savings without writing. Textures need headless Chrome (canvas encode); geometry does not — MCP hosts without Chrome still compress models. Each file reports `maxSize`, `sizeReason`, `images` (`role`, `from` / `to`) and `geometry` (`trianglesBefore` / `After`, `verticesBefore` / `After`, `welded`, `filters`, `compressed`).

`check` adds an `optimizable` info when a texture is at least twice the size the scene needs or a project `.glb` over 50 KB is not meshopt-compressed, and its `budget` warning points at `assets optimize --all`. `assets add --hit … --resolution 512` downloads 1k and downscales it (format kept).

**Exports.** Library assets are never modified. `export --optimize` (embed / zip / single-html) exports optimised *copies* of every asset — project and library: textures smart-sized (format kept, scene paths unchanged), models meshopt-compressed with WebP textures — and returns `optimized` (`beforeKb`, `afterKb`, per file). The project is untouched.

**Runtime.** `GLTFLoader` gets three.js' `MeshoptDecoder` (a ~27 KB lazy chunk, inlined in single-HTML exports) only when a model declares `EXT_meshopt_compression`. It instantiates WebAssembly: a strict CSP needs `'wasm-unsafe-eval'` in `script-src` for scenes with compressed models.

**Not supported, on purpose:**

- *Draco* (`KHR_draco_mesh_compression`): the decoder is a ~280 KB wasm + worker; meshopt gives similar sizes with a 27 KB decoder. Draco models fail to load with a hint: re-export without Draco (Blender: uncheck "Compression"), or convert with `gltfpack -i in.glb -o out.glb -cc`, then `assets optimize`.
- *KTX2 / Basis Universal*: no MIT / Apache encoder runs offline in Node without native binaries, and the transcoder adds ~580 KB (wasm + JS) to the runtime. KTX2 mainly saves GPU memory; for download size, smart-sized WebP already gets most of the gain. Revisit if a pure-wasm encoder ships on npm.

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
npx -y @fleox/agent3d@0.2.1 assets search "wood planks" --kind texture --project my-scene --json
npx -y @fleox/agent3d@0.2.1 assets add --hit @hit.json --resolution 1k --project my-scene --json
npx -y @fleox/agent3d@0.2.1 assets add /path/kenney_pack.zip --source kenney --license CC0-1.0 --filter tree --project my-scene --json
```

Pack zips (Kenney, Quaternius): `assets add <file.zip> --source kenney|quaternius|local --license CC0-1.0 [--filter <word>]… [--name <pack>]` extracts only `.glb` / `.gltf` + textures into `assets/models/<name>/`. Texture downloads return a `suggestion.material` using the set (map, normalMap, roughnessMap). Per-source failures are reported in `errors` without failing the search. Tests never touch the network (sources take an injected `fetch`).

## Licences in checks and exports

`check` lists assets whose licence requires attribution (`licences`, `attribution` infos); `export` writes them to `<name>/CREDITS.txt`, returns them as `credits` and shows them on the demo page.

## Procedural content

Generators (terrain, trees, rocks, grass, flowers, water, clouds, city, character, planet, starfield, blob, waveGrid, maze, road, floatingIsland, globe, crystals, galaxy, bars3d, abstractShapes), particle presets, shaders, procedural textures (`{ "procedural": "wood" }` in a material slot) and synth sounds cost zero bytes and are deterministic with `seed`. See [catalog.md](catalog.md) and [scene-format.md](scene-format.md#generators-and-particles).
