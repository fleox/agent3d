# Built-in library — sources and licences

Everything in `library/` ships inside the Agent3D npm package and is used offline
(scenes reference it as `"library:<id>"`, e.g. `"library:models/nature/pine-tree.glb"`).
Every item is free to redistribute, modify and use commercially, with **no account**.
Almost everything is **CC0 1.0** (public domain dedication). The one exception is the
fox model, which also carries **CC BY 4.0** parts: its attribution line is below and
in `index.json` (`attribution` field). Exported embeds that use it should keep that credit.

Per-file provenance (author, original URL, pack) lives in `library/sources.json`;
`library/index.json` is generated from it by `node scripts/build-library.mjs`
(`--check` verifies that every file is valid, embedded, listed and that the index is up to date).
Fonts are documented separately in `library/fonts/LICENSES.md`.

## Licences

- **CC0 1.0 Universal**: https://creativecommons.org/publicdomain/zero/1.0/
  The author waives all rights. No attribution is required, though credit is appreciated.
- **CC BY 4.0**: https://creativecommons.org/licenses/by/4.0/
  You can use, adapt and redistribute it for any purpose as long as you credit the author,
  link the licence and say whether you changed it.

## Sources

| Source | Licence | What we use | Where it comes from |
|---|---|---|---|
| **KayKit** by Kay Lousberg (www.kaylousberg.com) | CC0 1.0 | Animated chibi characters (knight, mage, skeleton), medieval buildings, nature, hex tiles, props, furniture, city blocks, roads, cars, food, space base | Official GitHub repos `KayKit-Game-Assets/*` (Character Pack Adventurers 1.0 and Skeletons 1.0, Medieval Hexagon Pack 1.0, City Builder Bits, Dungeon Remastered, Furniture Bits, Halloween Bits, Restaurant Bits, Space Base Bits, Prototype Bits). Each repo has a `LICENSE.txt` that says CC0. |
| **Kenney** (www.kenney.nl) | CC0 1.0 | Platformer hero, mini soldier, platforms, blocks, coins, flag, clouds, grass, racing trucks, motorcycle, tracks, blaster, suburban house, forest tile, trophy, tree | Official Kenney starter kits on GitHub: `KenneyNL/Starter-Kit-3D-Platformer`, `-City-Builder`, `-Racing`, `-FPS`, `-Basic-Scene` (Mini Arena sample). The kit code is MIT, and the READMEs say: "Assets included in this package (2D sprites, 3D models and sound effects) are CC0 licensed". |
| **three.js examples**: RobotExpressive | CC0 1.0 | `characters/robot.glb` | `mrdoob/three.js/examples/models/gltf/RobotExpressive`. Model by Tomás Laulhé (Quaternius), CC0 1.0. Don McCurdy added face morph targets and converted it to glTF. |
| **Khronos glTF-Sample-Assets** | CC0 1.0 (Fox: CC0 + CC BY 4.0) | `animals/fox.glb`, `animals/fish.glb` (BarramundiFish, Microsoft), `food/avocado.glb` (Microsoft), `products/boombox.glb` (Microsoft), `products/water-bottle.glb` (Microsoft), `products/lantern.glb` (sbtron, Frank Galligan) | `KhronosGroup/glTF-Sample-Assets/Models/*`. Licences come from each model's `metadata.json`. |
| **Agent3D** (own work) | CC0 1.0 | Bakery models: `food/croissant.glb`, `food/baguette.glb`, `food/bread-loaf.glb`, `food/donut.glb`, `food/cupcake.glb`, `food/cookie.glb`, `food/pain-au-chocolat.glb` | Generated procedurally by `scripts/make-bakery-models.mjs` (three.js geometry + GLTFExporter, deterministic). Dedicated to the public domain under CC0 1.0. |
| **Poly Haven** (polyhaven.com) | CC0 1.0 | 6 PBR texture sets (`textures/*`) and 4 HDRIs (`hdri/*`) | Poly Haven public API and `dl.polyhaven.org`. Textures: Wood Floor Deck (Dimitrios Savva); Concrete Floor 02, Denim Fabric, Aerial Grass Rock, Rusty Metal 02, Red Brick 03 (Rob Tuytel). HDRIs: Studio Small 09 (Sergej Majboroda), Venice Sunset (Greg Zaal), Kloofendal 48d Partly Cloudy Pure Sky (Greg Zaal, Jarod Guest), Moonless Golf (Greg Zaal). |

## Attribution required (CC BY 4.0)

- **`models/animals/fox.glb`**: "Fox". Model by PixelMannen (CC0). Rigging and animation by
  tomkranis (CC BY 4.0, https://sketchfab.com/tomkranis). glTF conversion by @AsoboStudio
  and @scurest (CC BY 4.0). From KhronosGroup/glTF-Sample-Assets
  (https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox).
  Changes by Agent3D: textures re-encoded as 512 px WebP, unused data pruned.

## Modifications made by Agent3D

All third-party models were converted to single self-contained `.glb` files with glTF-Transform
(dedup, prune, resample of animation keys), with every buffer and texture embedded.
They use no Draco or meshopt compression, so the stock `GLTFLoader` loads them.
Texture atlases and PBR maps larger than 512 px were resized to 512 px and re-encoded
as WebP (`EXT_texture_webp`, which `GLTFLoader` supports natively). We kept only a few
animation clips for the KayKit characters (Idle, Walking_A, Running_A,
Jump_Full_Short, Cheer, Hit_A, Death_A, Interact, PickUp, Sit_Chair_Idle, plus a few
class-specific attacks) and the Kenney mini soldier. Poly Haven textures were
re-encoded as JPEG: colour at 1024 px, normal and roughness at 512 px. Poly Haven HDRIs
were downsampled to 512×256 Radiance `.hdr` for lighting, plus a 2048×1024
tonemapped `.jpg` for visible backgrounds. File names were changed to short
descriptive ids.

## Not included (and why)

- **kenney.nl pack zips** (Nature Kit, Food Kit, Car Kit, Space Kit, Animated Characters…):
  the site answers automated downloads with HTTP 403, so we used Kenney's official
  GitHub starter kits (also CC0) instead.
- **Quaternius packs** (animated animals, nature, platformer): they are hosted on
  Google Drive folders, which need an interactive page. We took no unofficial mirrors.
- **Khronos models we left out**: Duck (SCEA licence, not free), DamagedHelmet (has a CC BY-NC
  part), CesiumMan (CC BY plus a trademark logo), ToyCar and SheenChair (CC0, but 1.4–3.8 MB
  each after optimisation, over the size budget).
- **three.js Horse / Flamingo / Parrot / Stork**: no explicit licence statement.
