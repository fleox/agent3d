# Agent3D catalog

<!-- Generated from src/core/catalog.ts by renderCatalogMarkdown() (src/ops/docs.ts). Do not edit by hand. -->

Everything a scene can reference by id. Agents: query it with the `catalog_get` tool or `agent3d catalog [section] [id]`.

## Contents

- [Geometries](#geometries) (18)
- [Behaviours](#behaviours) (23)
- [Generators](#generators) (15)
- [Particle presets](#particle-presets) (10)
- [Shaders](#shaders) (7)
- [Post effects](#post-effects) (7)
- [Fonts](#fonts) (5)
- [Synth sounds](#synth-sounds) (12)
- [Material presets](#material-presets) (19)

## Geometries

Mesh / instances `geometry: { "type": "<id>", …params }`. Sizes in units (≈ metres).

### `box`

Box. _Cost: ~12 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `width` | number (0…∞) | `1` | Size on X. |
| `height` | number (0…∞) | `1` | Size on Y. |
| `depth` | number (0…∞) | `1` | Size on Z. |

### `roundedBox`

Box with rounded edges (nice for UI-like blocks, dice, buttons). _Cost: ~500 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `width` | number (0…∞) | `1` | Size on X. |
| `height` | number (0…∞) | `1` | Size on Y. |
| `depth` | number (0…∞) | `1` | Size on Z. |
| `radius` | number (0…∞) | `0.1` | Corner radius. |
| `segments` | integer (1…16) | `4` | Corner smoothness. |

### `sphere`

Sphere. _Cost: ~segments*heightSegments*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Radius. |
| `segments` | integer (3…256) | `32` | Smoothness (radial segments). |
| `heightSegments` | integer (2…256) | `24` | Vertical segments. |

### `cylinder`

Cylinder (different top/bottom radii make a truncated cone). _Cost: ~segments*4 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radiusTop` | number (0…∞) | `0.5` | Top radius. |
| `radiusBottom` | number (0…∞) | `0.5` | Bottom radius. |
| `height` | number (0…∞) | `1` | Height. |
| `segments` | integer (3…256) | `32` | Smoothness (radial segments). |
| `openEnded` | boolean | `false` | No caps. |

### `cone`

Cone. _Cost: ~segments*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Base radius. |
| `height` | number (0…∞) | `1` | Height. |
| `segments` | integer (3…256) | `32` | Smoothness (radial segments). |

### `capsule`

Capsule (pill). _Cost: ~1000 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.3` | Radius. |
| `length` | number (0…∞) | `0.6` | Length of the straight part. |
| `segments` | integer (2…64) | `16` | Smoothness. |

### `torus`

Torus (donut). _Cost: ~radialSegments*tubularSegments*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Ring radius. |
| `tube` | number (0…∞) | `0.15` | Tube radius. |
| `radialSegments` | integer (2…∞) | `24` | Tube segments. |
| `tubularSegments` | integer (3…∞) | `64` | Ring segments. |
| `arc` | number (0…360) | `360` | Arc in degrees. |

### `torusKnot`

Torus knot (decorative). _Cost: ~tubularSegments*radialSegments*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Radius. |
| `tube` | number (0…∞) | `0.15` | Tube radius. |
| `tubularSegments` | integer (3…∞) | `128` | Segments along the knot. |
| `radialSegments` | integer (3…∞) | `16` | Tube segments. |
| `p` | integer (1…∞) | `2` | Winds around its axis. |
| `q` | integer (1…∞) | `3` | Winds around the torus interior. |

### `plane`

Flat rectangle facing +Z (rotate [-90,0,0] for a floor). _Cost: ~2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `width` | number (0…∞) | `1` | Width. |
| `height` | number (0…∞) | `1` | Height. |
| `widthSegments` | integer (1…∞) | `1` | Subdivisions (for shaders). |
| `heightSegments` | integer (1…∞) | `1` | Subdivisions. |

### `circle`

Flat disc facing +Z. _Cost: ~segments triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Radius. |
| `segments` | integer (3…256) | `32` | Smoothness (radial segments). |

### `ring`

Flat ring facing +Z. _Cost: ~segments*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `innerRadius` | number (0…∞) | `0.3` | Inner radius. |
| `outerRadius` | number (0…∞) | `0.5` | Outer radius. |
| `segments` | integer (3…256) | `32` | Smoothness (radial segments). |

### `icosahedron`

Icosahedron (detail 0 = low-poly gem, 3+ = smooth sphere). _Cost: ~20*4^detail triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Radius. |
| `detail` | integer (0…6) | `0` | Subdivision. |

### `dodecahedron`

Dodecahedron. _Cost: ~36 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Radius. |
| `detail` | integer (0…5) | `0` | Subdivision. |

### `octahedron`

Octahedron (diamond). _Cost: ~8 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Radius. |
| `detail` | integer (0…5) | `0` | Subdivision. |

### `tetrahedron`

Tetrahedron (pyramid). _Cost: ~4 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `0.5` | Radius. |
| `detail` | integer (0…5) | `0` | Subdivision. |

### `lathe`

Surface of revolution from a 2D profile (vases, bottles, chess pieces). _Cost: ~points*segments*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `points` **(required)** | array |  | Profile [[x,y], …] (x = radius) from bottom to top. |
| `segments` | integer (3…256) | `32` | Smoothness (radial segments). |

### `extrude`

Extruded 2D shape (stars, arrows, custom polygons). _Cost: ~points*20 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `shape` **(required)** | array |  | Polygon [[x,y], …] (closed automatically). |
| `depth` | number (0…∞) | `0.2` | Extrusion depth. |
| `bevel` | number (0…∞) | `0.02` | Bevel size. |

### `tube`

Tube along a smooth curve through points (pipes, paths, ribbons). _Cost: ~tubularSegments*radialSegments*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `points` **(required)** | array |  | Curve points [[x,y,z], …]. |
| `radius` | number (0…∞) | `0.05` | Tube radius. |
| `tubularSegments` | integer (2…∞) | `64` | Segments along the curve. |
| `radialSegments` | integer (3…∞) | `8` | Segments around. |
| `closed` | boolean | `false` | Close the loop. |

## Behaviours

Object or light `behaviours: [{ "type": "<id>", "when"?: "always|hover|click|visible|scroll", "delay"?: s, …params }]`. Angles in degrees, speeds in deg/s or cycles/s as noted.

### `rotate`

Spin continuously.

| Param | Type | Default | Description |
|---|---|---|---|
| `axis` | vec3 | `[0,1,0]` | Axis. |
| `speed` | number | `45` | Degrees per second. |

```json
{"type":"rotate","axis":[0,1,0],"speed":30}
```

### `float`

Gentle up-down floating (sine).

| Param | Type | Default | Description |
|---|---|---|---|
| `amplitude` | number (0…∞) | `0.15` | Height of the motion. |
| `speed` | number (0…∞) | `0.5` | Cycles per second. |
| `phase` | number | `0` | Phase offset (0..1) to desync objects. |

### `bob`

Bouncy hop (abs sine) — characters, icons.

| Param | Type | Default | Description |
|---|---|---|---|
| `height` | number (0…∞) | `0.3` | Hop height. |
| `speed` | number (0…∞) | `1.5` | Hops per second. |

### `pulse`

Breathing scale.

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…∞) | `0.08` | Scale change (0.1 = ±10%). |
| `speed` | number (0…∞) | `1` | Cycles per second. |

### `wobble`

Jelly-like squash and stretch.

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…∞) | `0.08` | Intensity. |
| `speed` | number (0…∞) | `2` | Speed. |

### `sway`

Pendulum rotation back and forth (trees, signs).

| Param | Type | Default | Description |
|---|---|---|---|
| `axis` | vec3 | `[0,0,1]` | Rotation axis. |
| `angle` | number (0…∞) | `8` | Max angle (degrees). |
| `speed` | number (0…∞) | `0.5` | Cycles per second. |

### `orbit`

Move in a circle around a centre.

| Param | Type | Default | Description |
|---|---|---|---|
| `center` | vec3 | `[0,0,0]` | Centre (parent space). |
| `radius` | number (0…∞) | `2` | Radius. |
| `speed` | number | `30` | Degrees per second. |
| `axis` | vec3 | `[0,1,0]` | Axis. |
| `faceDirection` | boolean | `false` | Turn to face the direction of travel. |
| `phase` | number | `0` | Start angle (degrees). |

### `path`

Follow a smooth path through points.

| Param | Type | Default | Description |
|---|---|---|---|
| `points` **(required)** | array |  | [[x,y,z], …]. |
| `duration` | number (0…∞) | `5` | Seconds per lap. |
| `loop` | boolean | `true` | Loop (closed curve). |
| `faceDirection` | boolean | `true` | Look along the path. |

### `followPointer`

Lean / move toward the mouse or finger.

| Param | Type | Default | Description |
|---|---|---|---|
| `strength` | number (0…∞) | `0.5` | How far it moves (units). |
| `smoothing` | number (0…0.99) | `0.9` | 0 = instant, 0.95 = very smooth. |
| `mode` | `move` \\| `rotate` \\| `both` | `"rotate"` | Move or rotate. |

### `lookAtPointer`

Turn to face the pointer (eyes, heads, turrets).

| Param | Type | Default | Description |
|---|---|---|---|
| `maxAngle` | number (0…∞) | `35` | Max rotation (degrees). |
| `smoothing` | number (0…0.99) | `0.85` | Smoothing. |

### `hoverScale`

Grow when hovered.

| Param | Type | Default | Description |
|---|---|---|---|
| `scale` | number (0…∞) | `1.15` | Scale when hovered. |
| `smoothing` | number (0…0.99) | `0.8` | Smoothing. |

### `hoverLift`

Rise and tilt when hovered (cards, products).

| Param | Type | Default | Description |
|---|---|---|---|
| `height` | number | `0.2` | Lift. |
| `tilt` | number | `10` | Tilt toward the pointer (degrees). |

### `clickBounce`

Squash-bounce on click / tap.

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…∞) | `0.25` | Intensity. |

### `spinOnClick`

Do a full spin on click (or each time the pointer enters, with trigger hover).

| Param | Type | Default | Description |
|---|---|---|---|
| `axis` | vec3 | `[0,1,0]` | Axis. |
| `duration` | number (0…∞) | `0.8` | Seconds. |
| `trigger` | `click` \\| `hover` | `"click"` | What starts a spin: a click / tap, or the pointer entering the object. |

### `scrollRotate`

Rotate with the page scroll.

| Param | Type | Default | Description |
|---|---|---|---|
| `axis` | vec3 | `[0,1,0]` | Axis. |
| `degrees` | number | `360` | Rotation across the whole scroll range. |

### `scrollMove`

Move with the page scroll (parallax depth).

| Param | Type | Default | Description |
|---|---|---|---|
| `offset` | vec3 | `[0,2,0]` | Offset across the scroll range. |

### `drift`

Slow random wandering inside a box (fish, dust, balloons).

| Param | Type | Default | Description |
|---|---|---|---|
| `area` | vec3 | `[1,1,1]` | Box size around the start position. |
| `speed` | number (0…∞) | `0.3` | Speed. |
| `seed` | integer | `1` | Random seed. |

### `blink`

Toggle visibility / flicker (lights, signs, eyes).

| Param | Type | Default | Description |
|---|---|---|---|
| `interval` | number (0…∞) | `3` | Seconds between blinks. |
| `duration` | number (0…∞) | `0.15` | Blink length. |
| `random` | boolean | `true` | Irregular timing. |

### `colorCycle`

Cycle the material colour through a palette.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ff006e","#8338ec","#3a86ff"]` | Palette. |
| `speed` | number (0…∞) | `0.5` | Colours per second. |
| `emissive` | boolean | `false` | Also drive the emissive colour. |

### `flicker`

Random intensity flicker (fire, candles — on lights or emissive materials).

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…1) | `0.3` | 0..1. |
| `speed` | number (0…∞) | `8` | Speed. |

### `billboard`

Always face the camera (sprites, labels).

| Param | Type | Default | Description |
|---|---|---|---|
| `lockY` | boolean | `true` | Only rotate around Y. |

### `appear`

Entrance animation when the scene becomes visible.

| Param | Type | Default | Description |
|---|---|---|---|
| `effect` | `scale` \\| `fade` \\| `rise` \\| `drop` \\| `spin` | `"scale"` | Effect. |
| `duration` | number (0…∞) | `0.8` | Seconds. |
| `ease` | `outBack` \\| `outCubic` \\| `outElastic` \\| `outBounce` | `"outBack"` | Easing. |

### `magnet`

Pulled toward the pointer when close, springs back.

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…1) | `0.25` | Influence radius (screen fraction 0..1). |
| `strength` | number (0…∞) | `0.4` | Pull (units). |

## Generators

Procedural content, zero download: `{ "kind": "generator", "generator": "<id>", "params": { … }, "seed"?: n }`.

### `terrain`

Heightmap terrain with colour bands (low-poly or smooth): hills, mountains, islands, dunes. _Cost: ~resolution^2*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `size` | number (0…∞) | `40` | Width/depth. |
| `resolution` | integer (8…512) | `96` | Grid cells per side. |
| `height` | number (0…∞) | `6` | Max height. |
| `scale` | number (0…∞) | `1` | Noise scale (bigger = wider features). |
| `octaves` | integer (1…8) | `5` | Detail levels. |
| `shape` | `hills` \\| `mountains` \\| `island` \\| `dunes` \\| `canyon` \\| `flat` | `"hills"` | Overall shape. |
| `palette` | colors | `["#e2c290","#6aa84f","#38761d","#7f6a5d","#ffffff"]` | Colours from low to high (sand, grass, rock, snow). |
| `lowpoly` | boolean | `true` | Faceted shading. |
| `waterLevel` | number | `0.6` | Water surface height in world units (absolute, not a fraction of height); null = no water. |
| `waterColor` | color | `"#3d9bd6"` | Water colour. |

### `trees`

Scattered stylised trees. _Cost: ~count*~150 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…2000) | `30` | How many. |
| `area` | vec3 | `[30,0,30]` | Scatter box (x, 0, z). |
| `style` | `pine` \\| `round` \\| `palm` \\| `birch` \\| `dead` \\| `mixed` | `"mixed"` | Tree style. |
| `minScale` | number (0…∞) | `0.7` | Min scale. |
| `maxScale` | number (0…∞) | `1.4` | Max scale. |
| `leafColors` | colors | `["#2e7d32","#43a047","#66bb6a"]` | Foliage colours. |
| `trunkColor` | color | `"#6d4c41"` | Trunk colour. |
| `onTerrain` | boolean | `true` | Drop onto a sibling terrain generator. |
| `sway` | boolean | `true` | Wind sway animation. |

### `rocks`

Scattered low-poly rocks. _Cost: ~count*80 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…2000) | `20` | How many. |
| `area` | vec3 | `[20,0,20]` | Scatter box. |
| `minSize` | number (0…∞) | `0.3` | Min size. |
| `maxSize` | number (0…∞) | `1.5` | Max size. |
| `colors` | colors | `["#8d8d8d","#757575","#9e9e9e"]` | Colours. |
| `onTerrain` | boolean | `true` | Drop onto a sibling terrain. |

### `grass`

Instanced grass blades swaying in the wind. _Cost: ~count*1 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…100000) | `5000` | Blades. |
| `area` | vec3 | `[20,0,20]` | Area. |
| `height` | number (0…∞) | `0.4` | Blade height. |
| `colors` | colors | `["#2d6a1f","#8bc34a"]` | Colours (base → tip). |
| `wind` | number (0…∞) | `0.5` | Wind strength. |
| `onTerrain` | boolean | `true` | Follow a sibling terrain. |

### `flowers`

Scattered little flowers. _Cost: ~count*40 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…20000) | `200` | How many. |
| `area` | vec3 | `[20,0,20]` | Area. |
| `colors` | colors | `["#ff5d8f","#ffd166","#ffffff","#9b5de5"]` | Petal colours. |
| `onTerrain` | boolean | `true` | Follow a sibling terrain. |

### `water`

Animated water surface (waves + specular). _Cost: ~20000 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `size` | number (0…∞) | `40` | Width/depth. |
| `color` | color | `"#1e6fa8"` | Deep colour. |
| `shallowColor` | color | `"#5ec8e5"` | Light colour. |
| `waveHeight` | number (0…∞) | `0.15` | Wave height. |
| `waveSpeed` | number (0…∞) | `1` | Wave speed. |
| `opacity` | number (0…1) | `0.85` | Opacity. |

### `clouds`

Puffy low-poly clouds drifting. _Cost: ~count*400 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…200) | `8` | Clouds. |
| `area` | vec3 | `[40,6,40]` | Area. |
| `height` | number | `10` | Altitude. |
| `color` | color | `"#ffffff"` | Colour. |
| `speed` | number (0…∞) | `0.3` | Drift speed. |

### `city`

Procedural city blocks with buildings (skylines, isometric towns). _Cost: ~blocks^2*4*12 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `blocks` | integer (1…40) | `6` | Blocks per side. |
| `blockSize` | number (0…∞) | `4` | Block size. |
| `street` | number (0…∞) | `1.2` | Street width. |
| `minHeight` | number (0…∞) | `1` | Min building height. |
| `maxHeight` | number (0…∞) | `8` | Max building height. |
| `colors` | colors | `["#e0e1dd","#778da9","#415a77","#ffd6a5"]` | Building colours. |
| `windows` | boolean | `true` | Lit windows (emissive). |
| `windowColor` | color | `"#ffe8a3"` | Window colour. |
| `trees` | boolean | `true` | Street trees. |

### `character`

Stylised low-poly character built from primitives, with procedural animations (idle, walk, run, wave, jump, dance). _Cost: ~2000 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `style` | `humanoid` \\| `robot` \\| `blob` \\| `cat` \\| `bird` | `"humanoid"` | Body style. |
| `skin` | color | `"#f1c27d"` | Skin / body colour. |
| `shirt` | color | `"#3a86ff"` | Top colour. |
| `pants` | color | `"#22223b"` | Bottom colour. |
| `hair` | color | `"#3b2a20"` | Hair colour. |
| `accent` | color | `"#ff006e"` | Accent (shoes, eyes, antenna). |
| `animation` | `idle` \\| `walk` \\| `run` \\| `wave` \\| `jump` \\| `dance` \\| `none` | `"idle"` | Animation. |
| `animationSpeed` | number (0…∞) | `1` | Animation speed. |
| `height` | number (0…∞) | `1.8` | Total height. |
| `eyesFollowPointer` | boolean | `false` | Eyes follow the pointer. |

### `planet`

Small stylised planet with continents, optional rings and atmosphere. _Cost: ~20*4^detail triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `2` | Radius. |
| `palette` | colors | `["#2a6f97","#52b788","#8d6e63","#ffffff"]` | Ocean, land, mountain, ice. |
| `landAmount` | number (0…1) | `0.45` | 0..1. |
| `rings` | boolean | `false` | Rings. |
| `ringColor` | color | `"#e9c46a"` | Ring colour. |
| `atmosphere` | boolean | `true` | Glow halo. |
| `atmosphereColor` | color | `"#8ecae6"` | Halo colour. |
| `detail` | integer (1…7) | `5` | Subdivision. |

### `starfield`

Large sphere of stars around the scene (space backdrops). _Cost: ~count triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…50000) | `3000` | Stars. |
| `radius` | number (0…∞) | `80` | Distance. |
| `colors` | colors | `["#ffffff","#cfe2ff","#ffe8c2"]` | Star colours. |
| `size` | number (0…∞) | `0.25` | Star size. |
| `twinkle` | boolean | `true` | Twinkle. |

### `blob`

Organic animated blob (noise-displaced sphere) — modern hero banners. _Cost: ~detail^2*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0…∞) | `1.2` | Radius. |
| `noise` | number (0…∞) | `0.3` | Displacement amount. |
| `speed` | number (0…∞) | `0.4` | Morph speed. |
| `detail` | integer (8…256) | `64` | Smoothness. |
| `colors` | colors | `["#ff7eb3","#a78bfa","#60a5fa","#5eead4"]` | Colour ramp flowing over the surface (brand colours). |

### `waveGrid`

Grid of points / bars rippling like a wave (tech / data banners). _Cost: ~columns*rows*2 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `columns` | integer (2…400) | `60` | Columns. |
| `rows` | integer (2…400) | `30` | Rows. |
| `spacing` | number (0…∞) | `0.3` | Spacing. |
| `amplitude` | number (0…∞) | `0.5` | Wave height. |
| `speed` | number (0…∞) | `1` | Speed. |
| `shape` | `dots` \\| `bars` \\| `lines` | `"dots"` | Element. |
| `colors` | colors | `["#3a86ff","#ff006e"]` | Colour ramp. |
| `pointerRipple` | boolean | `true` | Ripple under the pointer. |

### `maze`

Grid maze walls from a seed (games). _Cost: ~columns*rows*24 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `columns` | integer (2…60) | `10` | Cells on X. |
| `rows` | integer (2…60) | `10` | Cells on Z. |
| `cellSize` | number (0…∞) | `2` | Cell size. |
| `wallHeight` | number (0…∞) | `1.5` | Wall height. |
| `wallColor` | color | `"#5e548e"` | Walls. |
| `floorColor` | color | `"#e0b1cb"` | Floor. |
| `bodies` | boolean | `true` | Add static physics bodies to walls. |

### `road`

Endless-runner road made of tiles that scroll toward the camera. _Cost: ~200 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `width` | number (0…∞) | `6` | Road width. |
| `length` | number (0…∞) | `60` | Visible length. |
| `lanes` | integer (1…8) | `3` | Lanes. |
| `color` | color | `"#3d405b"` | Asphalt. |
| `lineColor` | color | `"#f4f1de"` | Lane lines. |
| `speed` | number (0…∞) | `10` | Scroll speed (units/s), read by scripts as state.speed when set. |

## Particle presets

`{ "kind": "particles", "preset": "<id>", "count"?, "area"?, "size"?, "color"?, … }` — object fields override the preset.

| Id | Description |
|---|---|
| `stars` | Twinkling static stars. |
| `snow` | Falling snowflakes. |
| `rain` | Falling rain streaks. |
| `fireflies` | Glowing wandering dots. |
| `confetti` | Colourful confetti falling and spinning. |
| `sparks` | Fast upward sparks (additive). |
| `dust` | Slow floating dust motes. |
| `bubbles` | Rising bubbles. |
| `embers` | Rising glowing embers. |
| `hearts` | Rising little hearts. |

## Shaders

Material `{ "type": "shader", "shader": "<id>", "uniforms": { …params } }`.

### `plasma`

Animated colourful plasma.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ff006e","#8338ec","#3a86ff"]` | Palette. |
| `speed` | number (0…∞) | `1` | Animation speed. |
| `scale` | number (0…∞) | `1` | Pattern scale. |

### `waves`

Moving stripes / waves.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#0b132b","#5bc0be"]` | Two colours. |
| `speed` | number (0…∞) | `1` | Speed. |
| `frequency` | number (0…∞) | `8` | Stripe frequency. |

### `noise`

Animated smooth noise (clouds, smoke, marble).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#1b1b3a","#ff9f1c"]` | Ramp colours. |
| `speed` | number (0…∞) | `0.3` | Speed. |
| `scale` | number (0…∞) | `2` | Scale. |

### `hologram`

Sci-fi hologram with scanlines and fresnel rim (transparent).

| Param | Type | Default | Description |
|---|---|---|---|
| `color` | color | `"#38f9ff"` | Colour. |
| `speed` | number (0…∞) | `1` | Scanline speed. |
| `lines` | number (0…∞) | `80` | Scanline count. |

### `gradientFlow`

Smooth flowing multi-colour gradient (backgrounds, blobs).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ff7eb3","#ff758c","#7afcff","#feffb7"]` | Palette. |
| `speed` | number (0…∞) | `0.4` | Speed. |

### `toonRim`

Cartoon shading with coloured rim light.

| Param | Type | Default | Description |
|---|---|---|---|
| `color` | color | `"#ffb347"` | Base colour. |
| `rim` | color | `"#ffffff"` | Rim colour. |
| `steps` | integer (1…8) | `3` | Shading bands. |

### `dissolve`

Noise dissolve driven by `uniforms.progress` (0..1) — animate it in the timeline.

| Param | Type | Default | Description |
|---|---|---|---|
| `color` | color | `"#ffffff"` | Colour. |
| `edge` | color | `"#ff7b00"` | Burning edge colour. |
| `progress` | number (0…1) | `0` | 0 = solid, 1 = gone. |

## Post effects

Scene `postfx: [{ "type": "<id>", …params }]`.

### `bloom`

Glow around bright / emissive parts.

| Param | Type | Default | Description |
|---|---|---|---|
| `strength` | number (0…∞) | `0.8` | Strength. |
| `radius` | number (0…∞) | `0.4` | Radius. |
| `threshold` | number (0…∞) | `0.85` | Luminance threshold. |

### `vignette`

Darker edges.

| Param | Type | Default | Description |
|---|---|---|---|
| `offset` | number (0…∞) | `1` | Size. |
| `darkness` | number (0…∞) | `1.1` | Darkness. |

### `film`

Film grain + scanlines.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…1) | `0.35` | Grain. |
| `grayscale` | boolean | `false` | Black and white. |

### `chromatic`

RGB shift (glitchy / dreamy).

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…∞) | `0.002` | Shift amount. |

### `pixelate`

Retro pixels.

| Param | Type | Default | Description |
|---|---|---|---|
| `pixelSize` | integer (1…32) | `4` | Pixel size. |

### `outline`

Cartoon outlines (toon look).

| Param | Type | Default | Description |
|---|---|---|---|
| `color` | color | `"#000000"` | Line colour. |
| `thickness` | number (0…∞) | `1` | Thickness. |

### `dof`

Depth of field (bokeh).

| Param | Type | Default | Description |
|---|---|---|---|
| `focus` | number (0…∞) | `8` | Focus distance. |
| `aperture` | number (0…∞) | `0.002` | Aperture. |
| `maxblur` | number (0…∞) | `0.01` | Max blur. |

## Fonts

Text objects `font: "<id>"` (bundled, no web font fetch).

| Id | Description |
|---|---|
| `sans-bold` | Geometric sans bold (default). |
| `sans` | Sans regular. |
| `serif-bold` | Serif bold. |
| `mono` | Monospace (tech). |
| `display` | Rounded display font (playful). |

## Synth sounds

Audio `sounds: { "<name>": { "preset": "<id>" } }` — synthesised with WebAudio, zero bytes.

| Id | Description |
|---|---|
| `coin` | Pickup / coin. |
| `jump` | Jump. |
| `hit` | Hit / damage. |
| `explosion` | Explosion. |
| `click` | UI click. |
| `powerup` | Power-up arpeggio. |
| `laser` | Laser shot. |
| `win` | Victory jingle. |
| `lose` | Game over. |
| `whoosh` | Whoosh. |
| `ambient-pad` | Soft looping pad (music). |
| `chiptune-loop` | Cheerful chiptune loop (music). |

## Material presets

Material `{ "preset": "<id>", …overrides }` — explicit properties override the preset.

| Preset | Description | Sets |
|---|---|---|
| `plastic` | Glossy plastic. | `{"type":"physical","color":"#e8e8e8","roughness":0.35,"metalness":0,"clearcoat":0.3}` |
| `matte` | Flat, non-reflective paint. | `{"type":"standard","color":"#d9d9d9","roughness":0.95,"metalness":0}` |
| `clay` | Soft clay / ceramic look (great for stylised scenes). | `{"type":"standard","color":"#e9dccb","roughness":0.8,"metalness":0}` |
| `chrome` | Mirror chrome (needs environment lighting). | `{"type":"physical","color":"#ffffff","roughness":0.05,"metalness":1}` |
| `brushedMetal` | Brushed steel. | `{"type":"physical","color":"#c8ccd2","roughness":0.35,"metalness":1}` |
| `gold` | Polished gold. | `{"type":"physical","color":"#ffcf6b","roughness":0.15,"metalness":1}` |
| `copper` | Copper. | `{"type":"physical","color":"#e8926a","roughness":0.25,"metalness":1}` |
| `glass` | Clear refractive glass. | `{"type":"physical","color":"#ffffff","roughness":0.02,"metalness":0,"transmission":1,"thickness":0.5,"ior":1.5}` |
| `frostedGlass` | Frosted glass. | `{"type":"physical","color":"#ffffff","roughness":0.4,"metalness":0,"transmission":1,"thickness":0.8,"ior":1.4}` |
| `rubber` | Matte rubber. | `{"type":"standard","color":"#2b2b2b","roughness":1,"metalness":0}` |
| `pearl` | Iridescent pearl. | `{"type":"physical","color":"#f4f1ee","roughness":0.25,"metalness":0,"iridescence":1,"clearcoat":1}` |
| `holographic` | Holographic iridescent foil. | `{"type":"physical","color":"#d7e3ff","roughness":0.15,"metalness":0.9,"iridescence":1}` |
| `neon` | Glowing neon (shines with bloom). | `{"type":"standard","color":"#ff2fd6","emissive":"#ff2fd6","emissiveIntensity":3,"roughness":0.5}` |
| `toon` | Cel-shaded cartoon. | `{"type":"toon","color":"#ffb347"}` |
| `flat` | Unlit flat colour (ignores lights). | `{"type":"basic","color":"#ffffff"}` |
| `lowpoly` | Faceted low-poly shading. | `{"type":"standard","color":"#8bc34a","roughness":0.9,"flatShading":true}` |
| `velvet` | Soft fabric with sheen. | `{"type":"physical","color":"#7b2d5b","roughness":0.9,"sheen":1}` |
| `wireframe` | Wireframe lines. | `{"type":"basic","color":"#7cf7ff","wireframe":true}` |
| `normal` | Rainbow normals (debug / playful). | `{"type":"normal"}` |
