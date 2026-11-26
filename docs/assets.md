# Assets

Scenes reference assets by **project path** (`assets/models/bottle.glb`) or by **library id** (`library:models/products/water-bottle.glb`). Exports copy every referenced file; nothing is hotlinked.

## The built-in library

`library/` ships in the npm package and works offline: about 130 glTF models (rigged characters with animation clips, animals, nature, buildings, city, food and bakery (croissant, baguette, bread loaf, donut, cupcake, cookie, pain au chocolat), photoreal products (sneaker, sofa, lamp, boombox…), props, platformer kit, vehicles, space…), 6 PBR texture sets (brick, concrete, fabric, grass ground, rusty metal, wood planks: colour, normal, roughness), 10 HDRIs (softbox, studio, warehouse, forest, city, beach, sky, sunset, night, night-city; `.hdr` for lighting, `.jpg` for backgrounds) and the 13 text fonts. `library/index.json` lists each item with its licence, author, tags, size and (models) bounding box and triangle count.

```bash
npx -y @fleox/agent3d@0.4.0 assets library --query tree --json
npx -y @fleox/agent3d@0.4.0 assets library --kind hdri --json
npx -y @fleox/agent3d@0.4.0 assets library --kind model --all --json
```

Hits carry `ref`, `kind`, `kb`, `license`, `tags`, `description` and, for models, `triangles`, `animations` (clip names) and `size` (bounding box w × h × d, Y-up) — use it to pick `fit`. 50 results per page: `--limit`, `--offset` (when `more` is true) or `--all` (the `library_list` tool takes `limit` — 0 for all — and `offset`).

Everything is CC0 except the fonts (OFL-1.1) and four Khronos glTF samples under CC-BY-4.0: `models/products/sneaker.glb` (Shopify), `iridescent-lamp.glb` and `velvet-sofa.glb` (Wayfair), and the animated fox (CC-BY parts). Using them is fine; `check` reports their credit and exports write it to `CREDITS.txt` and the demo page. Sources and per-file provenance: [`library/LICENSES.md`](../library/LICENSES.md) and `library/sources.json`.

## Project assets

`assets/` + `assets/manifest.json` (`AssetEntry`: path, kind, bytes, source, sourceUrl, license, author, attribution, addedAt).

```bash
npx -y @fleox/agent3d@0.4.0 assets add ./logo.svg --license proprietary --project my-banner --json
npx -y @fleox/agent3d@0.4.0 assets list --project my-banner --json
npx -y @fleox/agent3d@0.4.0 assets remove assets/svg/logo.svg --yes --project my-banner --json
```

`--license` is required for local files. Files go to `assets/models|textures|hdri|audio|fonts|svg|other/` by kind unless `--path` is given. `assets list` reports `exists`, `usedBy` and the size on disk for each entry (read-only: `stale` lists entries whose recorded size differs from the file). Models (`assets add <file>.glb` or a downloaded hit) return `bounds` — `size` (w × h × d, node transforms applied), `center`, `min`, `max` and an `upAxis` guess (`"y"`, or `"z?"` for models that may have been exported Z-up) — and `agent3d render --isolate <objectId>` shows one object alone, auto-framed, to check its orientation.

### Optimising textures and models

```bash
npx -y @fleox/agent3d@0.4.0 assets optimize --all --project my-hero --json            # plan: size per file + why
npx -y @fleox/agent3d@0.4.0 assets optimize --all --dry-run --project my-hero --json  # real savings, nothing written
npx -y @fleox/agent3d@0.4.0 assets optimize --all --yes --project my-hero --json
npx -y @fleox/agent3d@0.4.0 assets optimize assets/models/robot.glb --simplify 0.5 --yes --project my-game --json
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

## Depth maps (3D photos)

A photo object (`kind: "photo"`) becomes a "3D photo" with a `depth` map: a grey PNG, white = near, black = far, same aspect as the photo. `assets depth` estimates one at authoring time:

```bash
npx -y @fleox/agent3d@0.4.0 assets depth assets/textures/photo.jpg --project my-scene --json
```

- **Model.** [Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small) (ONNX, quantized, 27 MB, Apache-2.0, pinned revision), run locally by onnxruntime-web (WASM, up to 4 threads) in the same headless Chrome as the renders — about 1-1.5 s per photo at the default input size, plus ~2 s to start Chrome. `--size` sets the model input long side (default 518, up to 1036 for finer edges, ≈ 4× slower).
- **One-time download.** The first run downloads the model once (no account, no token) into `~/.agent3d/models/depth-anything-v2-small/<revision>/` (`AGENT3D_MODELS` overrides the folder), checks its size and SHA-256 and writes `NOTICE.txt` / `LICENSE.txt` next to it. Later runs work offline. Offline before the first download: the error says where to put the file by hand (or paint a depth map yourself). The model is never shipped: exports only carry the PNG.
- **Output.** `assets/depth/<photo name>-depth.png` (`--out` to change), at the photo size capped at 1024 px (`--max-size`; the model works at 518 px, so a bigger map only adds bytes), grey + alpha: the model's relative depth normalised with robust percentiles (1 % → black, 99 % → white), smoothed edge-aware, foreground dilated by one pixel so silhouettes keep their colour, and **alpha 0 on depth discontinuities** (where neighbouring depths differ by more than 8 %), so the runtime can hide stretched edges. Registered in `assets/manifest.json` with source `depth-anything-v2-small` and the photo's licence (`derived` when the photo is not in the manifest), the attribution naming the model.
- **Tool.** `image_depth { image, out?, size?, maxSize?, plate? }` returns `{ path, width, height, ms, model, suggestion }`; hosts without headless Chrome (the Studio's in-browser mode) refuse it with a hint.

### Background plates (bigger moves)

When the view moves, a 3D photo uncovers what was behind its foreground — pixels the photo never had. Without help the runtime borrows nearby background texels, which reads as smears, ghost copies and stretched halos next to people, signs and rooftops at strong `strength` / in `mesh` mode. A **background plate** fixes that (the "layered depth" idea of Facebook 3D photos, without a learned model):

```bash
npx -y @fleox/agent3d@0.4.0 assets plate assets/textures/photo.jpg --project my-scene --json
# or depth map + plate in one go:
npx -y @fleox/agent3d@0.4.0 assets depth assets/textures/photo.jpg --plate --project my-scene --json
```

- **What it is.** The photo with the foreground removed next to each occluding depth edge and filled with the background behind it, plus the **plate depth** (the background depth continued under the removed foreground). Set both on the photo object as `plate` and `plateDepth` (the result's `suggestion`). The runtime shows the plate only where moving foreground uncovers the background: the parallax ray continues behind a depth "wall" against the plate depth, the `mesh` backing sits at the plate depth with the plate colours, covered `layers` texels come from the plate. Same in the photo-only lite player.
- **How it is built** (`src/ops/plate.ts`, pure TS, ≈ 0.3 s for a 1600 px photo): edges = depth steps or the depth map's alpha-0 mask; the hole = the near side of each edge, as wide as that jump moves at the strongest view offset (`--strength`, default 1, or `--width` in pixels for a full near-to-far jump) + 2 px of blended colours on the far side; each hole texel is filled from the **far side only** (a depth-constrained nearest-texel transform that never accepts a source nearer than half the jump, so the foreground never bleeds in), mirrored across the edge so the background keeps its texture instead of a blurred blob. Small foreground subjects (people, poles) narrower than the band disappear from the plate entirely — the plate is only seen where they uncover it.
- **Output.** `assets/depth/<photo name>-plate.webp` (`--format png` without WebP; `--out`) and `assets/depth/<photo name>-plate-depth.png` (grey PNG, `--out-depth`), at the photo size capped at 1024 px (`--max-size`), registered with source `agent3d-plate` and the photo's licence. The depth map comes from `--depth`, else the photo object showing that image, else `assets/depth/<photo name>-depth.png`. Headless Chrome decodes the photo (the fill itself needs no browser); `assets optimize` sizes a plate like the photo (WebP) and keeps the plate depth a lossless PNG.
- **Cost.** One more image + one small PNG (≈ 100–160 KB for a 1024 px photo) and, in `parallax`, a second short march only on the edge pixels that need it. Worth it for strength ≥ 0.7, `mesh` mode, or photos with people / thin objects in front; a photo whose edges are mostly against a plain sky gains little.
- **Tool.** `image_plate { image, depth?, out?, outDepth?, maxSize?, strength?, width?, format? }` returns `{ path, depthPath, holeWidth, holePercent, ms, suggestion: { plate, plateDepth } }`; `image_depth { …, plate: true }` builds both.

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
npx -y @fleox/agent3d@0.4.0 assets search "wood planks" --kind texture --project my-scene --json
npx -y @fleox/agent3d@0.4.0 assets add --hit @hit.json --resolution 1k --project my-scene --json
npx -y @fleox/agent3d@0.4.0 assets add /path/kenney_pack.zip --source kenney --license CC0-1.0 --filter tree --project my-scene --json
```

Pack zips (Kenney, Quaternius): `assets add <file.zip> --source kenney|quaternius|local --license CC0-1.0 [--filter <word>]… [--name <pack>]` extracts only `.glb` / `.gltf` + textures into `assets/models/<name>/`. Texture downloads return a `suggestion.material` using the set (map, normalMap, roughnessMap). Per-source failures are reported in `errors` without failing the search. Tests never touch the network (sources take an injected `fetch`).

## Licences in checks and exports

`check` lists assets whose licence requires attribution (`licences`, `attribution` infos); `export` writes them to `<name>/CREDITS.txt`, returns them as `credits` and shows them on the demo page.

## Procedural content

Generators (terrain, trees, rocks, grass, flowers, water, clouds, city, character, planet, starfield, blob, waveGrid, maze, road, floatingIsland, globe, crystals, galaxy, bars3d, abstractShapes), particle presets, shaders, procedural textures (`{ "procedural": "wood" }` in a material slot) and synth sounds cost zero bytes and are deterministic with `seed`. See [catalog.md](catalog.md) and [scene-format.md](scene-format.md#generators-and-particles).
