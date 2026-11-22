# Agent3D catalog

<!-- Generated from src/core/catalog.ts by renderCatalogMarkdown() (src/ops/docs.ts). Do not edit by hand. -->

Everything a scene can reference by id. Agents: query it with the `catalog_get` tool or `agent3d catalog [section] [id]`.

## Contents

- [Geometries](#geometries) (18)
- [Behaviours](#behaviours) (29)
- [Generators](#generators) (21)
- [Particle presets](#particle-presets) (17)
- [Shaders](#shaders) (17)
- [Procedural textures](#procedural-textures) (12)
- [Light rigs](#light-rigs) (10)
- [Post effects](#post-effects) (20)
- [Fonts](#fonts) (13)
- [Synth sounds](#synth-sounds) (12)
- [Material presets](#material-presets) (38)

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

| Id | Description |
|---|---|
| `box` | Box. |
| `roundedBox` | Box with rounded edges (nice for UI-like blocks, dice, buttons). |
| `sphere` | Sphere. |
| `cylinder` | Cylinder (different top/bottom radii make a truncated cone). |
| `cone` | Cone. |
| `capsule` | Capsule (pill). |
| `torus` | Torus (donut). |
| `torusKnot` | Torus knot (decorative). |
| `plane` | Flat rectangle facing +Z (rotate [-90,0,0] for a floor). |
| `circle` | Flat disc facing +Z. |
| `ring` | Flat ring facing +Z. |
| `icosahedron` | Icosahedron (detail 0 = low-poly gem, 3+ = smooth sphere). |
| `dodecahedron` | Dodecahedron. |
| `octahedron` | Octahedron (diamond). |
| `tetrahedron` | Tetrahedron (pyramid). |
| `lathe` | Surface of revolution from a 2D profile (vases, bottles, chess pieces). |
| `extrude` | Extruded 2D shape (stars, arrows, custom polygons). |
| `tube` | Tube along a smooth curve through points (pipes, paths, ribbons). |

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

### `spring`

Follow the pointer with spring physics (overshoot and settle) — lively cards, mascots.

| Param | Type | Default | Description |
|---|---|---|---|
| `strength` | number (0…∞) | `0.4` | Travel (units) at the canvas edge. |
| `stiffness` | number (1…∞) | `120` | Spring stiffness (higher = snappier). |
| `damping` | number (0…∞) | `12` | Damping (lower = more bounce). |
| `mass` | number (0.01…∞) | `1` | Mass. |
| `mode` | `move` \\| `rotate` \\| `both` | `"move"` | Move, lean (rotate) or both. |
| `angle` | number (0…∞) | `15` | Lean at the edge (degrees, rotate mode). |

```json
{"type":"spring","mode":"both","strength":0.3,"damping":9}
```

### `parallax`

Depth layer moving with the pointer (and the page scroll) in proportion to its depth — stack layers with different depths.

| Param | Type | Default | Description |
|---|---|---|---|
| `depth` | number | `0.5` | 0 = background, 1 = foreground (negative: opposite way). |
| `pointer` | number | `0.3` | Pointer travel (units) at depth 1. |
| `scroll` | number | `0` | Vertical travel (units) across the scroll range at depth 1. |
| `smoothing` | number (0…0.99) | `0.9` | Smoothing. |

```json
{"type":"parallax","depth":1,"pointer":0.4}
```

### `tilt`

Card tilt: leans toward the pointer, lifts and scales up (product cards, posters).

| Param | Type | Default | Description |
|---|---|---|---|
| `maxAngle` | number (0…60) | `12` | Max tilt (degrees). |
| `scale` | number (0…∞) | `1.04` | Scale while active. |
| `lift` | number | `0.1` | Move toward the camera (units, +Z). |
| `hoverOnly` | boolean | `true` | Only while the object is hovered (else whenever the pointer is over the canvas). |
| `reverse` | boolean | `false` | Lean away from the pointer. |
| `smoothing` | number (0…0.99) | `0.86` | Smoothing. |

### `breathe`

Organic breathing: slow inhale, shorter exhale, Y expands most (idle characters, blobs).

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…∞) | `0.04` | Scale change (0.04 = 4 %). |
| `period` | number (0.1…∞) | `4` | Seconds per breath. |
| `rise` | number | `0.02` | Rise at full inhale (units). |
| `phase` | number | `0` | Phase offset (0..1). |

### `noise`

Organic wandering from smooth noise: position + rotation (calmer, less repetitive than float / sway).

| Param | Type | Default | Description |
|---|---|---|---|
| `amplitude` | vec3 | `[0.1,0.1,0.05]` | Position amplitude per axis (units). |
| `rotation` | vec3 | `[3,3,2]` | Rotation amplitude per axis (degrees). |
| `speed` | number (0…∞) | `0.3` | Speed. |
| `seed` | integer | `1` | Noise seed. |

### `lookAt`

Turn to face another object, the camera or a point (smoothed). The object's front is +Z.

| Param | Type | Default | Description |
|---|---|---|---|
| `target` | string | `"camera"` | Object id or "camera" (default). |
| `point` | vec3 |  | Look at this point instead (parent space of the scene). |
| `smoothing` | number (0…0.99) | `0.85` | Smoothing. |
| `lockY` | boolean | `false` | Only turn around the vertical axis. |

```json
{"type":"lookAt","target":"hero","lockY":true}
```

| Id | Description |
|---|---|
| `rotate` | Spin continuously. |
| `float` | Gentle up-down floating (sine). |
| `bob` | Bouncy hop (abs sine) — characters, icons. |
| `pulse` | Breathing scale. |
| `wobble` | Jelly-like squash and stretch. |
| `sway` | Pendulum rotation back and forth (trees, signs). |
| `orbit` | Move in a circle around a centre. |
| `path` | Follow a smooth path through points. |
| `followPointer` | Lean / move toward the mouse or finger. |
| `lookAtPointer` | Turn to face the pointer (eyes, heads, turrets). |
| `hoverScale` | Grow when hovered. |
| `hoverLift` | Rise and tilt when hovered (cards, products). |
| `clickBounce` | Squash-bounce on click / tap. |
| `spinOnClick` | Do a full spin on click (or each time the pointer enters, with trigger hover). |
| `scrollRotate` | Rotate with the page scroll. |
| `scrollMove` | Move with the page scroll (parallax depth). |
| `drift` | Slow random wandering inside a box (fish, dust, balloons). |
| `blink` | Toggle visibility / flicker (lights, signs, eyes). |
| `colorCycle` | Cycle the material colour through a palette. |
| `flicker` | Random intensity flicker (fire, candles — on lights or emissive materials). |
| `billboard` | Always face the camera (sprites, labels). |
| `appear` | Entrance animation when the scene becomes visible. |
| `magnet` | Pulled toward the pointer when close, springs back. |
| `spring` | Follow the pointer with spring physics (overshoot and settle) — lively cards, mascots. |
| `parallax` | Depth layer moving with the pointer (and the page scroll) in proportion to its depth — stack layers with different depths. |
| `tilt` | Card tilt: leans toward the pointer, lifts and scales up (product cards, posters). |
| `breathe` | Organic breathing: slow inhale, shorter exhale, Y expands most (idle characters, blobs). |
| `noise` | Organic wandering from smooth noise: position + rotation (calmer, less repetitive than float / sway). |
| `lookAt` | Turn to face another object, the camera or a point (smoothed). The object's front is +Z. |

## Generators

Procedural content, zero download: `{ "kind": "generator", "generator": "<id>", "params": { … }, "seed"?: n }`.

### `terrain`

Heightmap terrain with colour bands (low-poly or smooth): hills, mountains, islands, dunes. _Cost: ~resolution^2*2 triangles._

**`material` override** (object-level `"material": { … }`): The ground (not the water plane). Without colour / preset / map the palette bands are kept (e.g. { "roughness": 0.6, "flatShading": false }).

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
| `snowLine` | number (0…1) | `1` | Height fraction (0..1, above the water) where the last palette colour (snow) caps the peaks; 1 = summit only. |

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

**`material` override** (object-level `"material": { … }`): Every rock. Without colour / preset / map the per-rock colours are kept.

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

Animated stylised water: waves, shallow → deep colour from the terrain depth below, animated shore foam lines, ripple normals with a moving sun glint, fresnel. _Cost: ~20000 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `size` | number (0…∞) | `40` | Width/depth. |
| `color` | color | `"#1e6fa8"` | Deep colour. |
| `shallowColor` | color | `"#5ec8e5"` | Shallow / crest colour. |
| `foamColor` | color | `"#ffffff"` | Foam colour. |
| `waveHeight` | number (0…∞) | `0.15` | Wave height. |
| `waveSpeed` | number (0…∞) | `1` | Wave speed. |
| `foam` | number (0…∞) | `0.6` | Shore foam band width (depth units; 0 = none). Needs a sibling terrain below. |
| `ripples` | number (0…∞) | `1` | Ripple normal strength (sun glint). |
| `depthRange` | number (0.01…∞) | `3` | Depth at which the colour is fully deep. |
| `opacity` | number (0…1) | `0.9` | Opacity. |
| `lowpoly` | boolean | `false` | Faceted low-poly water (no ripples). |

### `clouds`

Drifting clouds: soft puffy cotton balls (or faceted low-poly), bright tops, cool shadowed undersides, silver-lining rim. _Cost: ~count*1500 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…200) | `8` | Clouds. |
| `area` | vec3 | `[40,6,40]` | Area. |
| `height` | number | `10` | Altitude. |
| `size` | number (0…∞) | `1` | Cloud size factor. |
| `color` | color | `"#ffffff"` | Colour (lit tops). |
| `shadowColor` | color | `"#a9bdd6"` | Underside colour. |
| `speed` | number (0…∞) | `0.3` | Drift speed. |
| `style` | `puffy` \\| `lowpoly` | `"puffy"` | puffy = smooth soft puffs, lowpoly = faceted. |

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

Chibi character or mascot built from soft clay-like primitives on a real skeleton: expressive face (eyes with highlights, brows, mouth expressions), hair styles, outfits, accessories and procedural animations (idle, walk, run, wave, jump, dance, cheer, celebrate, sit, point, talk). Styles: humanoid, astronaut (bubble helmet), robot (glowing screen face), blob, cat, fox, bird, ghost. _Cost: ~14000 triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `style` | `humanoid` \\| `astronaut` \\| `robot` \\| `blob` \\| `cat` \\| `fox` \\| `bird` \\| `ghost` | `"humanoid"` | Body style. |
| `skin` | color |  | Skin / fur / body colour (default per style). |
| `shirt` | color |  | Top / suit colour (robot: metal, blob: body, bird: wings; default per style). |
| `pants` | color |  | Bottom colour (robot: joints; default per style). |
| `hair` | color |  | Hair / brows colour (cat: stripes, fox: socks and ear tips, bird: crest; default per style). |
| `accent` | color |  | Accent: shoes, caps, scarves, robot glow, nose, beak (default per style). |
| `expression` | `happy` \\| `laugh` \\| `neutral` \\| `surprised` \\| `wink` \\| `sad` \\| `angry` \\| `sleepy` | `"happy"` | Facial expression (cheer / celebrate / dance / run switch the default happy face to a laugh). |
| `hairStyle` | `short` \\| `long` \\| `bob` \\| `bun` \\| `ponytail` \\| `spiky` \\| `curly` \\| `none` | `"short"` | Hair style (humanoid). |
| `outfit` | `tshirt` \\| `hoodie` \\| `dress` \\| `suit` \\| `overalls` | `"tshirt"` | Outfit (humanoid). |
| `accessories` | array | `[]` | Accessories (humanoid / astronaut): any of cap, beanie, crown, glasses, sunglasses, headphones, backpack, scarf, bowtie. |
| `animation` | `idle` \\| `walk` \\| `run` \\| `wave` \\| `jump` \\| `dance` \\| `cheer` \\| `celebrate` \\| `sit` \\| `point` \\| `talk` \\| `none` | `"idle"` | Animation. sit = sitting on the ground; point = points to the screen right (mirror with scale [-1, 1, 1] to point left). |
| `animationSpeed` | number (0…∞) | `1` | Animation speed. |
| `height` | number (0…∞) | `1.8` | Total height. |
| `shading` | `smooth` \\| `lowpoly` \\| `toon` | `"smooth"` | smooth = soft claymation, lowpoly = faceted (fewer triangles), toon = cel-shaded. |
| `eyesFollowPointer` | boolean | `false` | Head turns toward the pointer. |

### `planet`

Small stylised planet with continents, optional rings and atmosphere. _Cost: ~20*4^detail triangles._

**`material` override** (object-level `"material": { … }`): The globe surface (ocean + land; rings and atmosphere keep theirs). Without colour / preset / map the palette is kept.

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
| `spin` | number | `0` | Globe rotation around its own (ring) axis in deg/s — use this rather than a rotate behaviour so the rings stay stable. |

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

**`material` override** (object-level `"material": { … }`): The whole blob; the morph keeps running with any material, shaders included (e.g. { "type": "shader", "shader": "gradientFlow" }, { "preset": "chrome" }). Without colour / preset / map the colour ramp is kept (e.g. { "type": "toon" }).

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

### `floatingIsland`

Stylised floating island diorama (hero favourite): grassy rolling top with a noisy outline, dirt band, rocky underside tapering to stalactite tips with coloured strata; optional trees, rocks, flowers, grass, a pond with a waterfall, floating debris and a slow bob. _Cost: ~6000+trees*150+grass+flowers*40 triangles._

**`material` override** (object-level `"material": { … }`): The island body (top + underside). Without colour / preset / map the vertex colours are kept.

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0.1…∞) | `3` | Top radius. |
| `depth` | number (0.1…∞) | `3.6` | Underside depth (top to tip). |
| `hills` | number (0…4) | `1` | Top relief (0 = flat lawn). |
| `grassColors` | colors | `["#4f9a3a","#7cc24a","#b5dd6a"]` | Grass colours (dark → light). |
| `dirtColor` | color | `"#8a5a3c"` | Dirt band colour. |
| `rockColors` | colors | `["#7d6b5e","#93806f","#6a5a52","#a08c76"]` | Rock strata colours of the underside. |
| `trees` | integer (0…200) | `6` | Trees planted on top. |
| `treeStyle` | `pine` \\| `round` \\| `palm` \\| `birch` \\| `dead` \\| `mixed` | `"round"` | Tree style. |
| `leafColors` | colors | `["#2e7d32","#43a047","#7cb342"]` | Tree foliage colours. |
| `rocks` | integer (0…200) | `5` | Rocks on top. |
| `flowers` | integer (0…5000) | `60` | Flowers on top. |
| `grass` | integer (0…30000) | `1500` | Grass blades on top. |
| `waterfall` | boolean | `true` | Pond + waterfall pouring off the edge. |
| `waterColor` | color | `"#4fc3f7"` | Pond / waterfall colour. |
| `debris` | integer (0…100) | `6` | Small rocks floating around. |
| `float` | number (0…∞) | `0.12` | Bob amplitude (0 = still). |
| `lowpoly` | boolean | `true` | Faceted shading. |

### `globe`

Data globe for SaaS / network heroes: dot-matrix Earth (simplified continents), fresnel atmosphere, pulsing location markers and great-circle arcs with travelling light pulses between lat/lon points. _Cost: ~dots*0.35*6+~8000 triangles._

**`material` override** (object-level `"material": { … }`): The globe body sphere (dots, arcs and atmosphere keep theirs).

| Param | Type | Default | Description |
|---|---|---|---|
| `radius` | number (0.1…∞) | `2` | Radius. |
| `dots` | integer (200…60000) | `12000` | Dot lattice density (dots on the whole sphere before the land mask). |
| `continents` | boolean | `true` | Dots only on land (simplified continents). |
| `dotColor` | color | `"#7dd3fc"` | Land dot colour. |
| `oceanDotColor` | color | `"#0b1630"` | Ocean dot colour (same as baseColor = no ocean dots). |
| `baseColor` | color | `"#0b1630"` | Globe body colour. |
| `dotSize` | number (0…∞) | `1` | Dot size factor. |
| `points` | array | `[]` | Markers: [[lat, lon], …] or [{ "lat": 48.85, "lon": 2.35 }, …]. |
| `arcs` | array | `[]` | Arcs: [[[lat, lon], [lat, lon]], …] or [{ "from": [lat, lon], "to": [lat, lon] }, …]. Endpoints get markers. |
| `arcColor` | color | `"#f472b6"` | Arc colour. |
| `arcSpeed` | number (0…∞) | `1` | Pulse speed along the arcs. |
| `arcWidth` | number (0…∞) | `1` | Arc thickness factor. |
| `markerColor` | color | `"#fde68a"` | Marker colour. |
| `markerSize` | number (0…∞) | `1` | Marker size factor. |
| `atmosphere` | boolean | `true` | Atmosphere glow. |
| `atmosphereColor` | color | `"#38bdf8"` | Atmosphere colour. |
| `spin` | number | `6` | Rotation speed (deg/s). |
| `longitude` | number | `0` | Longitude facing the camera at t = 0 (degrees). |
| `tilt` | number | `12` | Axis tilt (degrees). |

### `crystals`

Glowing gem crystals: faceted hexagonal prisms with pointed tips (cluster on a rock base, ring, or scatter), base → tip colour gradient, emissive fresnel glow that pulses. Pair with the bloom post effect. _Cost: ~count*40+~600 triangles._

**`material` override** (object-level `"material": { … }`): The crystals (not the base). Without colour / preset / map the gradients are kept.

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…400) | `14` | Crystals. |
| `size` | number (0…∞) | `1.2` | Height of a typical crystal. |
| `colors` | colors | `["#7c3aed","#22d3ee","#f0abfc"]` | Gem colours (each crystal blends from one colour to the next). |
| `layout` | `cluster` \\| `ring` \\| `scatter` | `"cluster"` | Arrangement. |
| `spread` | number (0…∞) | `1` | Cluster radius / ring radius / scatter half-size. |
| `glow` | number (0…∞) | `0.8` | Emissive glow strength. |
| `pulse` | number (0…∞) | `1` | Glow pulse amount (0 = steady). |
| `opacity` | number (0…1) | `1` | Opacity (< 1 = translucent). |
| `base` | boolean | `true` | Rock base under a cluster. |
| `baseColor` | color | `"#4b4560"` | Base rock colour. |

### `galaxy`

Spiral galaxy of soft additive stars: logarithmic arms, warm bulge, star-forming knots, glowing core and differential rotation (inner faster). Space / AI / tech heroes. _Cost: ~count triangles._

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (100…300000) | `40000` | Stars. |
| `radius` | number (0.1…∞) | `6` | Radius. |
| `arms` | integer (1…8) | `3` | Spiral arms. |
| `twist` | number (0…∞) | `5` | Arm winding (radians from centre to rim). |
| `thickness` | number (0…∞) | `0.05` | Disc thickness (fraction of radius). |
| `coreColor` | color | `"#ffd8a8"` | Core colour. |
| `armColor` | color | `"#6d8bff"` | Outer arm colour. |
| `accentColor` | color | `"#ff7ac8"` | Star-forming knots colour. |
| `size` | number (0…∞) | `0.035` | Star size. |
| `speed` | number | `0.3` | Rotation speed. |
| `coreGlow` | number (0…1) | `0.9` | Core glow opacity. |

### `bars3d`

3D bar chart from data (row or grid) with rounded / box / cylinder bars, colour ramp by value / row / column, base plate and an eased staggered grow entrance (or a looping wave). Dashboards, stats, fintech heroes. _Cost: ~data*12+~200 triangles._

**`material` override** (object-level `"material": { … }`): Every bar (per-bar colours are kept as instance colours).

| Param | Type | Default | Description |
|---|---|---|---|
| `data` | array | `[3,5,4,7,6,9,8]` | Values: [3, 5, 8] (one row) or [[3, 5], [4, 7]] (grid: rows go back in depth). Items may be { "value": n }. |
| `barWidth` | number (0.01…∞) | `0.6` | Bar width. |
| `gap` | number (0…∞) | `0.25` | Gap between bars. |
| `maxHeight` | number (0.01…∞) | `3` | Height of the largest value. |
| `colors` | colors | `["#93c5fd","#6366f1","#c026d3"]` | Colour ramp (value) or palette (row / column). |
| `colorBy` | `value` \\| `row` \\| `column` | `"value"` | What picks the colour. |
| `shape` | `rounded` \\| `box` \\| `cylinder` | `"rounded"` | Bar shape. |
| `animation` | `grow` \\| `wave` \\| `none` | `"grow"` | grow = staggered entrance from t = 0; wave = looping ripple. |
| `duration` | number (0.01…∞) | `1.6` | Grow duration (s). |
| `base` | boolean | `true` | Base plate. |
| `baseColor` | color | `"#eef2ff"` | Base plate colour. |

### `abstractShapes`

Abstract Memphis / pastel composition for banners: spheres, tori, rings, pills, cones, cubes, half-discs, squiggles, triangles and stars evenly spread in a slab, gently floating and turning. _Cost: ~count*1500 triangles._

**`material` override** (object-level `"material": { … }`): Every shape (per-shape palette colours are kept as instance colours).

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | integer (1…300) | `22` | Shapes. |
| `area` | vec3 | `[10,4,2]` | Slab size (x, y, z). |
| `colors` | colors | `["#ff8fab","#ffd166","#06d6a0","#118ab2","#a78bfa","#ff6b6b"]` | Palette. |
| `shapes` | array |  | Subset of shape kinds (default all): sphere, torus, ring, pill, cone, cube, halfDisc, squiggle, triangle, star. |
| `minSize` | number (0…∞) | `0.5` | Smallest shape size. |
| `maxSize` | number (0…∞) | `1.6` | Largest shape size. |
| `style` | `matte` \\| `glossy` \\| `toon` | `"matte"` | Material look. |
| `motion` | number (0…∞) | `1` | Float / spin amount (0 = still). |

| Id | Description |
|---|---|
| `terrain` | Heightmap terrain with colour bands (low-poly or smooth): hills, mountains, islands, dunes. |
| `trees` | Scattered stylised trees. |
| `rocks` | Scattered low-poly rocks. |
| `grass` | Instanced grass blades swaying in the wind. |
| `flowers` | Scattered little flowers. |
| `water` | Animated stylised water: waves, shallow → deep colour from the terrain depth below, animated shore foam lines, ripple normals with a moving sun glint, fresnel. |
| `clouds` | Drifting clouds: soft puffy cotton balls (or faceted low-poly), bright tops, cool shadowed undersides, silver-lining rim. |
| `city` | Procedural city blocks with buildings (skylines, isometric towns). |
| `character` | Chibi character or mascot built from soft clay-like primitives on a real skeleton: expressive face (eyes with highlights, brows, mouth expressions), hair styles, outfits, accessories and procedural animations (idle, walk, run, wave, jump, dance, cheer, celebrate, sit, point, talk). Styles: humanoid, astronaut (bubble helmet), robot (glowing screen face), blob, cat, fox, bird, ghost. |
| `planet` | Small stylised planet with continents, optional rings and atmosphere. |
| `starfield` | Large sphere of stars around the scene (space backdrops). |
| `blob` | Organic animated blob (noise-displaced sphere) — modern hero banners. |
| `waveGrid` | Grid of points / bars rippling like a wave (tech / data banners). |
| `maze` | Grid maze walls from a seed (games). |
| `road` | Endless-runner road made of tiles that scroll toward the camera. |
| `floatingIsland` | Stylised floating island diorama (hero favourite): grassy rolling top with a noisy outline, dirt band, rocky underside tapering to stalactite tips with coloured strata; optional trees, rocks, flowers, grass, a pond with a waterfall, floating debris and a slow bob. |
| `globe` | Data globe for SaaS / network heroes: dot-matrix Earth (simplified continents), fresnel atmosphere, pulsing location markers and great-circle arcs with travelling light pulses between lat/lon points. |
| `crystals` | Glowing gem crystals: faceted hexagonal prisms with pointed tips (cluster on a rock base, ring, or scatter), base → tip colour gradient, emissive fresnel glow that pulses. Pair with the bloom post effect. |
| `galaxy` | Spiral galaxy of soft additive stars: logarithmic arms, warm bulge, star-forming knots, glowing core and differential rotation (inner faster). Space / AI / tech heroes. |
| `bars3d` | 3D bar chart from data (row or grid) with rounded / box / cylinder bars, colour ramp by value / row / column, base plate and an eased staggered grow entrance (or a looping wave). Dashboards, stats, fintech heroes. |
| `abstractShapes` | Abstract Memphis / pastel composition for banners: spheres, tori, rings, pills, cones, cubes, half-discs, squiggles, triangles and stars evenly spread in a slab, gently floating and turning. |

## Particle presets

`{ "kind": "particles", "preset": "<id>", "count"?, "area"?, "size"?, "color"?, … }` — object fields override the preset.

| Id | Description |
|---|---|
| `stars` | Twinkling static stars. |
| `snow` | Falling soft snowflakes. |
| `rain` | Falling rain streaks (velocity-stretched). |
| `fireflies` | Glowing wandering dots. |
| `confetti` | Colourful confetti falling and spinning. |
| `sparks` | Sparks fountain: fast streaks arcing under gravity, cooling from yellow to red (additive). Small emitter area: place it at the source. |
| `dust` | Slow floating dust motes. |
| `bubbles` | Rising bubbles. |
| `embers` | Rising glowing embers cooling to red. |
| `hearts` | Rising little hearts. |
| `magic` | Magic sparkles: twinkling star glints rising and shrinking (additive) — wands, reveals, product magic. |
| `smoke` | Soft rising smoke puffs that grow and fade (noise-shaped). Small emitter area: place it at the chimney / source. |
| `fire` | Flickering flame: additive noisy puffs rising fast, yellow → red, shrinking. Small emitter area: place it at the base of the fire. |
| `petals` | Cherry-blossom petals drifting down, fluttering and spinning. |
| `leaves` | Autumn leaves falling, fluttering and spinning. |
| `galaxyDust` | Flat disc of twinkling cosmic dust slowly swirling (inner faster). |
| `bokeh` | Big soft out-of-focus light orbs drifting (dreamy backgrounds). |

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

### `gradientMesh`

Animated mesh gradient (Stripe-like soft colour blobs) — perfect banner backdrop on a plane.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ff6ec4","#7873f5","#4adede","#ffd86f"]` | Up to 6 colours. |
| `speed` | number (0…∞) | `0.25` | Animation speed. |
| `scale` | number (0.1…∞) | `1` | Blob scale (higher = more blobs). |
| `grain` | number (0…1) | `0.04` | Film grain amount. |

### `aurora`

Northern-lights curtains over a dark sky (planes, sky domes).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#00ffa3","#00b3ff","#b400ff"]` | Curtain colours. |
| `background` | color | `"#030714"` | Sky colour. |
| `speed` | number (0…∞) | `0.3` | Speed. |
| `intensity` | number (0…∞) | `1.2` | Brightness. |

### `liquidChrome`

Flowing liquid chrome / metaballs with a coloured reflection ramp.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#0a0a12","#5a5f7a","#e8ecff","#9ab8ff"]` | Reflection ramp. |
| `speed` | number (0…∞) | `0.35` | Flow speed. |
| `scale` | number (0.1…∞) | `1.5` | Pattern scale. |

### `nebula`

Deep-space nebula with stars (star-nest style) — space backdrops.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#1b0b3b","#7b2ff7","#f72585","#4cc9f0"]` | Gas colours. |
| `speed` | number (0…∞) | `0.05` | Drift speed. |
| `stars` | number (0…3) | `1` | Star density. |
| `scale` | number (0.1…∞) | `1` | Scale. |

### `caustics`

Underwater light caustics (pools, water floors, light patterns).

| Param | Type | Default | Description |
|---|---|---|---|
| `color` | color | `"#bff6ff"` | Light colour. |
| `background` | color | `"#05677d"` | Base colour. |
| `speed` | number (0…∞) | `0.5` | Speed. |
| `scale` | number (0.1…∞) | `3` | Pattern scale. |
| `intensity` | number (0…∞) | `1.4` | Brightness. |

### `fresnelGlow`

Glowing rim (fresnel) — force fields, atmospheres, x-ray looks (additive, transparent).

| Param | Type | Default | Description |
|---|---|---|---|
| `color` | color | `"#4cc9f0"` | Rim colour. |
| `core` | color | `"#000000"` | Centre colour (black = see-through). |
| `power` | number (0.1…∞) | `2.5` | Rim sharpness. |
| `intensity` | number (0…∞) | `1.5` | Brightness. |
| `pulse` | number (0…∞) | `0` | Pulse speed (0 = steady). |

### `iridescentFoil`

Holographic foil: view-dependent rainbow with fine noise sparkle.

| Param | Type | Default | Description |
|---|---|---|---|
| `speed` | number (0…∞) | `0.3` | Shimmer speed. |
| `scale` | number (0.1…∞) | `2` | Rainbow bands. |
| `sparkle` | number (0…1) | `0.5` | Glitter amount. |
| `tint` | color | `"#ffffff"` | Tint. |

### `lavaLamp`

Soft rising lava-lamp blobs (warm retro backdrops).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#2a0845","#ff512f","#f09819"]` | Background → blob colours. |
| `speed` | number (0…∞) | `0.3` | Speed. |
| `scale` | number (0.1…∞) | `1` | Blob size. |

### `grainGradient`

Static-friendly grainy gradient (editorial, film look).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ffb88c","#de6262","#4b1248"]` | Gradient colours. |
| `angle` | number | `30` | Gradient angle (degrees). |
| `grain` | number (0…1) | `0.06` | Grain amount. |
| `speed` | number (0…∞) | `0` | Grain animation (0 = static). |

### `matrixRain`

Falling digital glyph rain (cyber / hacker look).

| Param | Type | Default | Description |
|---|---|---|---|
| `color` | color | `"#3dff7a"` | Glyph colour. |
| `background` | color | `"#000a03"` | Background. |
| `speed` | number (0…∞) | `1` | Fall speed. |
| `columns` | number (4…200) | `40` | Columns across the surface. |

| Id | Description |
|---|---|
| `plasma` | Animated colourful plasma. |
| `waves` | Moving stripes / waves. |
| `noise` | Animated smooth noise (clouds, smoke, marble). |
| `hologram` | Sci-fi hologram with scanlines and fresnel rim (transparent). |
| `gradientFlow` | Smooth flowing multi-colour gradient (backgrounds, blobs). |
| `toonRim` | Cartoon shading with coloured rim light. |
| `dissolve` | Noise dissolve driven by `uniforms.progress` (0..1) — animate it in the timeline. |
| `gradientMesh` | Animated mesh gradient (Stripe-like soft colour blobs) — perfect banner backdrop on a plane. |
| `aurora` | Northern-lights curtains over a dark sky (planes, sky domes). |
| `liquidChrome` | Flowing liquid chrome / metaballs with a coloured reflection ramp. |
| `nebula` | Deep-space nebula with stars (star-nest style) — space backdrops. |
| `caustics` | Underwater light caustics (pools, water floors, light patterns). |
| `fresnelGlow` | Glowing rim (fresnel) — force fields, atmospheres, x-ray looks (additive, transparent). |
| `iridescentFoil` | Holographic foil: view-dependent rainbow with fine noise sparkle. |
| `lavaLamp` | Soft rising lava-lamp blobs (warm retro backdrops). |
| `grainGradient` | Static-friendly grainy gradient (editorial, film look). |
| `matrixRain` | Falling digital glyph rain (cyber / hacker look). |

## Procedural textures

Any material texture slot (`map`, `normalMap`, `roughnessMap`, `metalnessMap`, `bumpMap`, `aoMap`, `emissiveMap`, `alphaMap`, `displacementMap`) accepts `{ "procedural": "<id>", …params }` instead of a file: generated at load time, seamless, zero bytes. Colour slots use `colors`; data slots use the pattern height; `normalMap` derives normals from it.

### `marble`

Veined marble.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#f4f2ee","#b9b6b1","#5d5a57"]` | Base → vein colours. |
| `veins` | number (0…1) | `0.6` | Vein sharpness. |
| `turbulence` | number (0…∞) | `1` | Vein waviness. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `wood`

Wood grain (rings + fibres).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#d9a066","#a0632f","#6b3a17"]` | Light → dark wood. |
| `rings` | number (1…∞) | `10` | Growth rings. |
| `grain` | number (0…1) | `0.5` | Fibre detail. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `terrazzo`

Terrazzo: stone chips in a cement base.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#efe9e1","#e07a5f","#3d405b","#81b29a","#f2cc8f"]` | Base colour, then chip colours. |
| `density` | number (0…1) | `0.5` | Chip density. |
| `chipSize` | number (0.2…4) | `1` | Chip size. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `carbon`

Twill-woven carbon fibre.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#0b0b0d","#2a2c31","#5b5e66"]` | Dark → light fibre. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `noise`

Smooth fractal noise (clouds, stains, variation, bump).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#000000","#ffffff"]` | Ramp colours. |
| `octaves` | integer (1…8) | `5` | Detail layers. |
| `contrast` | number (0…∞) | `1` | Contrast. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `voronoi`

Cells (leather grain, scales, cracked ground, stone).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ffffff","#000000"]` | Cell colour → border colour. |
| `jitter` | number (0…1) | `1` | Cell irregularity. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `flakes`

Metallic paint flakes — use as normalMap (sparkle) or roughnessMap.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#808080","#ffffff"]` | Flake colours (map slot). |
| `strength` | number (0…1) | `0.6` | Flake tilt (normal slot). |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `brushed`

Brushed-metal streaks — use as roughnessMap or bumpMap.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#9a9a9a","#d0d0d0"]` | Ramp colours. |
| `streaks` | number (0.1…∞) | `1` | Streak density. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `grid`

Grid lines (blueprint, tiles, sci-fi floors).

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#0b1d3a","#6fd3ff"]` | Background → line colours. |
| `cells` | integer (1…256) | `8` | Cells per texture side. |
| `lineWidth` | number (0…0.5) | `0.04` | Line width (fraction of a cell). |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `checker`

Checkerboard.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ffffff","#222222"]` | Two colours. |
| `cells` | integer (1…256) | `8` | Cells per texture side. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `stripes`

Stripes.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ffffff","#ff4d6d"]` | Alternating colours. |
| `count` | integer (1…256) | `8` | Stripes per texture side. |
| `angle` | number | `0` | Angle in degrees (0, 45, 90 tile seamlessly). |
| `softness` | number (0…0.5) | `0.05` | Edge softness. |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

### `dots`

Polka dots.

| Param | Type | Default | Description |
|---|---|---|---|
| `colors` | colors | `["#ffffff","#ff4d6d"]` | Background → dot colours. |
| `cells` | integer (1…256) | `8` | Dots per texture side. |
| `radius` | number (0…0.5) | `0.3` | Dot radius (fraction of a cell). |
| `scale` | number (0.05…∞) | `1` | Pattern repeats across the texture. |
| `seed` | integer | `1` | Random seed. |
| `resolution` | integer (32…2048) | `512` | Texture size in pixels. |

| Id | Description |
|---|---|
| `marble` | Veined marble. |
| `wood` | Wood grain (rings + fibres). |
| `terrazzo` | Terrazzo: stone chips in a cement base. |
| `carbon` | Twill-woven carbon fibre. |
| `noise` | Smooth fractal noise (clouds, stains, variation, bump). |
| `voronoi` | Cells (leather grain, scales, cracked ground, stone). |
| `flakes` | Metallic paint flakes — use as normalMap (sparkle) or roughnessMap. |
| `brushed` | Brushed-metal streaks — use as roughnessMap or bumpMap. |
| `grid` | Grid lines (blueprint, tiles, sci-fi floors). |
| `checker` | Checkerboard. |
| `stripes` | Stripes. |
| `dots` | Polka dots. |

## Light rigs

`environment.rig: "<id>"` or `{ "preset": "<id>", …params }` — named lighting setups added to `lights` (positions assume a subject ~1–3 units around the origin; use `scale` for bigger scenes, `rotation` to turn the rig).

### `studio-3point`

Classic key / fill / rim: warm key with soft shadow, cool fill, bright back rim. Safe default for anything.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `softbox`

Large overhead and side softboxes (area lights): soft wrap-around product lighting with long glossy highlights.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `product-top`

Overhead softbox + two vertical strip lights: luxury product / packshot look (best on glossy and metal).

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `rim`

Two strong back rims (cool and warm) and a faint front fill: silhouettes and edge highlights on dark backgrounds.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `dramatic`

One hard side key (spot) with deep shadows and a thin rim — moody, high contrast.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `golden-hour`

Low warm sun with long shadows and a blue sky fill.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `noon`

High white sun with crisp shadows and a sky-blue fill.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `overcast`

Soft shadowless daylight (big sky dome, faint top key).

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `neon`

Magenta and cyan side lights (area panels) over a dark ambient — night / synthwave.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

### `moonlight`

Cool blue moon key with soft shadows and a dim night-sky fill.

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…∞) | `1` | Overall brightness multiplier. |
| `rotation` | number | `0` | Rotate the whole rig around Y (degrees). |
| `castShadow` | boolean | `true` | Key light casts shadows. |
| `scale` | number (0.05…∞) | `1` | Distance multiplier (big scenes). |
| `color` | color |  | Tint mixed into every light (optional). |

| Id | Description |
|---|---|
| `studio-3point` | Classic key / fill / rim: warm key with soft shadow, cool fill, bright back rim. Safe default for anything. |
| `softbox` | Large overhead and side softboxes (area lights): soft wrap-around product lighting with long glossy highlights. |
| `product-top` | Overhead softbox + two vertical strip lights: luxury product / packshot look (best on glossy and metal). |
| `rim` | Two strong back rims (cool and warm) and a faint front fill: silhouettes and edge highlights on dark backgrounds. |
| `dramatic` | One hard side key (spot) with deep shadows and a thin rim — moody, high contrast. |
| `golden-hour` | Low warm sun with long shadows and a blue sky fill. |
| `noon` | High white sun with crisp shadows and a sky-blue fill. |
| `overcast` | Soft shadowless daylight (big sky dome, faint top key). |
| `neon` | Magenta and cyan side lights (area panels) over a dark ambient — night / synthwave. |
| `moonlight` | Cool blue moon key with soft shadows and a dim night-sky fill. |

## Post effects

Scene `postfx: [{ "type": "<id>", …params }]`.

### `look`

Named look preset expanding into a tuned stack (`details.presets` lists exactly what each one expands to). Effects listed next to it override the matching expanded entry param by param. _GPU cost: medium._

| Param | Type | Default | Description |
|---|---|---|---|
| `preset` | `cinematic` \\| `product` \\| `dreamy` \\| `neon` \\| `retro` \\| `clean` | `"cinematic"` | Look preset. |
| `intensity` | number (0…1) | `1` | Strength of the look (scales its effect amounts). |

```json
{"type":"look","preset":"cinematic"}
```

### `bloom`

Glow around bright / emissive parts (HDR threshold, 5-level mip blur). _GPU cost: medium._

| Param | Type | Default | Description |
|---|---|---|---|
| `strength` | number (0…∞) | `0.8` | Strength. |
| `radius` | number (0…∞) | `0.4` | Radius / spread (0…1). |
| `threshold` | number (0…∞) | `0.85` | Luminance threshold (HDR: >1 = only emissive / very bright parts). |
| `smoothing` | number (0…1) | `0.1` | Soft knee above the threshold (0 = hard cut). |

### `ao`

Ambient occlusion (GTAO): contact shading in creases and under objects — grounds them and makes scenes read as real. Best with a ground. _GPU cost: high._

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…2) | `1` | Darkening amount. |
| `radius` | number (0.01…10) | `0.6` | Sampling radius in scene units (≈ metres). |
| `thickness` | number (0.01…10) | `1` | Assumed thickness of surfaces (larger = darker behind thin objects). |
| `falloff` | number (0…1) | `1` | Distance falloff (0 = none, 1 = smooth). |

```json
{"type":"ao","intensity":1,"radius":0.6}
```

### `outline`

Cartoon outlines (toon look) from depth + normal edges. _GPU cost: medium._

| Param | Type | Default | Description |
|---|---|---|---|
| `color` | color | `"#000000"` | Line colour. |
| `thickness` | number (0…∞) | `1` | Thickness (CSS px). |

### `godrays`

Light shafts (screen-space radial scattering) from the sky sun, a light or a point, occluded by objects. _GPU cost: medium._

| Param | Type | Default | Description |
|---|---|---|---|
| `source` | string | `"auto"` | Where the rays come from: "auto" (sky sun, else the first directional / spot light, else top centre), "sun", or a light id. |
| `intensity` | number (0…4) | `0.6` | Strength. |
| `length` | number (0…1) | `0.85` | Ray length (0…1 of the distance to the source). |
| `decay` | number (0.5…1) | `0.96` | Falloff along the ray. |
| `color` | color |  | Tint of the light source glow (default: the light / sun colour). |
| `size` | number (0…1) | `0.1` | Size of the source glow (fraction of the screen). |

```json
{"type":"godrays","intensity":0.7}
```

### `dof`

Depth of field (bokeh disc blur). Blur = |depth − focus| × aperture (clamped to maxblur). `focusOn` keeps an object sharp wherever it moves. _GPU cost: high._

| Param | Type | Default | Description |
|---|---|---|---|
| `focus` | number (0…∞) | `8` | Focus distance from the camera (scene units). |
| `focusOn` | string |  | Object id to autofocus on every frame (overrides focus). |
| `aperture` | number (0…∞) | `0.002` | Aperture: blur per unit of distance from the focus plane. |
| `maxblur` | number (0…0.1) | `0.01` | Max blur radius (fraction of the screen height). |

### `lensflare`

Procedural lens flare from HDR highlights: anamorphic streaks, ghosts and a halo (no textures). _GPU cost: medium._

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…4) | `0.5` | Overall strength. |
| `threshold` | number (0…∞) | `1.2` | HDR luminance that flares (>1 = only very bright parts). |
| `streaks` | number (0…4) | `1` | Anamorphic horizontal streaks amount. |
| `ghosts` | number (0…4) | `0.5` | Ghost reflections amount. |
| `halo` | number (0…4) | `0.3` | Halo ring amount. |
| `tint` | color | `"#9fc4ff"` | Streak colour. |

```json
{"type":"lensflare","intensity":0.6}
```

### `fxaa`

Fast approximate antialiasing (smooths shader / texture edges MSAA misses). Cheap. _GPU cost: low._

_No parameters._

### `smaa`

Subpixel morphological antialiasing — sharper than FXAA. _GPU cost: medium._

_No parameters._

### `taa`

Supersampled stills: deterministic renders (agent3d render / poster / video), the reduced-motion still and paused frames accumulate `samples` sub-pixel-jittered frames (perfect edges, smooth AO / shadows). No cost while playing. _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `samples` | integer (2…64) | `8` | Jittered frames per still. |

```json
{"type":"taa","samples":8}
```

### `tiltshift`

Tilt-shift miniature look: blur above and below a sharp horizontal band. _GPU cost: medium._

| Param | Type | Default | Description |
|---|---|---|---|
| `focus` | number (0…1) | `0.5` | Vertical centre of the sharp band (0 = bottom, 1 = top). |
| `width` | number (0…1) | `0.18` | Half height of the sharp band (fraction of the screen). |
| `blur` | number (0…4) | `1` | Blur strength. |

### `pixelate`

Retro pixels. _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `pixelSize` | integer (1…32) | `4` | Pixel size (CSS px). |

### `halftone`

Print halftone dots (comic / risograph banners). _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `size` | number (2…64) | `6` | Dot spacing (CSS px). |
| `angle` | number | `45` | Screen angle in degrees. |
| `mono` | boolean | `false` | Black ink only (else CMYK colour dots). |

### `ascii`

ASCII-art characters (procedural 5×5 glyphs). _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `size` | number (4…64) | `8` | Cell size (CSS px). |
| `mono` | boolean | `false` | Single ink colour instead of the scene colours. |
| `color` | color | `"#33ff88"` | Ink colour when mono. |

### `glitch`

Digital glitch: block displacement, RGB split, scan jitter (deterministic, driven by time). _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…1) | `0.5` | Strength (0…1). |
| `speed` | number (0…20) | `1` | Glitch bursts per second. |

### `chromatic`

Chromatic aberration: RGB fringes growing towards the edges (dreamy / lens). _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…0.05) | `0.002` | Shift amount (fraction of the screen). |
| `radial` | boolean | `true` | Radial lens fringes (false = uniform diagonal shift). |

### `sharpen`

Unsharp-mask sharpening (crisper details after AA / blur). _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `amount` | number (0…2) | `0.3` | Strength. |

### `grading`

Colour grading in one pass: a procedural `look` LUT + exposure, white balance, contrast, lift / gamma / gain, split toning, saturation. _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `look` | `none` \\| `cinematic` \\| `teal-orange` \\| `warm` \\| `cool` \\| `bleach` \\| `noir` \\| `vintage` \\| `pastel` | `"none"` | Procedural look (see GRADING_LOOKS). |
| `intensity` | number (0…1) | `1` | Strength of the look. |
| `exposure` | number (-5…5) | `0` | Exposure in stops. |
| `contrast` | number (0…3) | `1` | Contrast (S-curve, 1 = neutral). |
| `saturation` | number (0…3) | `1` | Saturation (0 = grey). |
| `vibrance` | number (-1…1) | `0` | Saturates muted colours more than vivid ones. |
| `temperature` | number (-1…1) | `0` | White balance: −1 cool … +1 warm. |
| `tint` | number (-1…1) | `0` | White balance: −1 green … +1 magenta. |
| `lift` | number (-0.5…0.5) | `0` | Raises (or crushes, < 0) the blacks. |
| `gamma` | number (0.2…5) | `1` | Midtones (>1 brighter). |
| `gain` | number (0…3) | `1` | Highlights multiplier. |
| `shadows` | color |  | Split toning: shadow tint colour (with `toning`). |
| `highlights` | color |  | Split toning: highlight tint colour (with `toning`). |
| `toning` | number (0…1) | `0` | Split toning strength. |
| `bleach` | number (0…1) | `0` | Bleach bypass (silver retention) amount. |

```json
{"type":"grading","look":"teal-orange","intensity":0.8}
```

### `vignette`

Darker (or tinted) edges. _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `offset` | number (0…∞) | `1` | Size (bigger = smaller vignette). |
| `darkness` | number (0…∞) | `1.1` | Darkness. |
| `color` | color | `"#000000"` | Vignette colour. |

### `film`

Film grain (luma-weighted, deterministic) + optional scanlines. _GPU cost: low._

| Param | Type | Default | Description |
|---|---|---|---|
| `intensity` | number (0…1) | `0.35` | Grain. |
| `grayscale` | boolean | `false` | Black and white. |
| `scanlines` | number (0…1) | `0` | Scanlines strength. |
| `size` | number (0.5…8) | `1.5` | Grain size (CSS px). |

### Look presets

`{ "type": "look", "preset": "<id>", "intensity"?: 0…1 }` expands into exactly this stack (`intensity` scales the amounts; effects listed next to the look override the matching entry param by param):

| Preset | Description | Expands to |
|---|---|---|
| `cinematic` | Film-like: contact AO, restrained bloom, teal / orange grade, soft vignette, fine grain, supersampled stills. | `[{"type":"ao","intensity":0.9,"radius":0.6},{"type":"bloom","strength":0.25,"radius":0.6,"threshold":2.2,"smoothing":0.4},{"type":"grading","look":"cinematic"},{"type":"vignette","offset":1,"darkness":0.75},{"type":"film","intensity":0.06},{"type":"taa","samples":8}]` |
| `product` | Clean studio product shot: strong contact AO, crisp detail, neutral punchy grade, faint vignette, supersampled stills. | `[{"type":"ao","intensity":1.1,"radius":0.5},{"type":"bloom","strength":0.15,"radius":0.5,"threshold":2.5,"smoothing":0.4},{"type":"grading","contrast":1.07,"saturation":1.04,"vibrance":0.1},{"type":"sharpen","amount":0.25},{"type":"vignette","offset":1.1,"darkness":0.4},{"type":"taa","samples":8}]` |
| `dreamy` | Soft and glowing: wide bloom, pastel grade, gentle lens fringes, light vignette. | `[{"type":"bloom","strength":0.45,"radius":0.85,"threshold":1,"smoothing":0.6},{"type":"grading","look":"pastel"},{"type":"chromatic","amount":0.0015},{"type":"vignette","offset":1,"darkness":0.5},{"type":"film","intensity":0.04}]` |
| `neon` | Night-club neon: strong tight bloom, anamorphic streaks, saturated contrasty grade, deep vignette. | `[{"type":"bloom","strength":1.3,"radius":0.55,"threshold":0.55,"smoothing":0.2},{"type":"lensflare","intensity":0.45,"threshold":1.4,"streaks":1.2,"ghosts":0.2,"halo":0.1},{"type":"grading","contrast":1.15,"saturation":1.2,"vibrance":0.2},{"type":"chromatic","amount":0.001},{"type":"vignette","offset":0.95,"darkness":0.95}]` |
| `retro` | Old film / VHS: vintage faded grade, heavy grain + scanlines, fringes, strong vignette. | `[{"type":"grading","look":"vintage"},{"type":"film","intensity":0.3,"scanlines":0.25},{"type":"chromatic","amount":0.0025,"radial":false},{"type":"vignette","offset":0.9,"darkness":1.2},{"type":"bloom","strength":0.3,"radius":0.6,"threshold":1.6,"smoothing":0.4}]` |
| `clean` | Minimal polish for UI-like scenes: FXAA, subtle contrast, light sharpening, supersampled stills. | `[{"type":"fxaa"},{"type":"grading","contrast":1.04,"saturation":1.02},{"type":"sharpen","amount":0.15},{"type":"vignette","offset":1.2,"darkness":0.25},{"type":"taa","samples":8}]` |

### Grading looks

`{ "type": "grading", "look": "<id>", "intensity"?: 0…1 }` — procedural LUTs (no texture); explicit grading params override them:

| Look | Description | Values |
|---|---|---|
| `cinematic` | Soft S-curve, slightly desaturated, teal shadows / warm highlights. | `{"contrast":1.12,"saturation":0.92,"vibrance":0.1,"shadows":"#2f6f86","highlights":"#ffb27a","toning":0.32,"lift":0.015,"gain":1.02}` |
| `teal-orange` | Blockbuster complementary split: teal shadows, orange skin / highlights. | `{"contrast":1.18,"saturation":1.05,"vibrance":0.2,"shadows":"#1b6f8a","highlights":"#ff9a4a","toning":0.55,"gain":1.03}` |
| `warm` | Golden-hour warmth. | `{"temperature":0.3,"tint":0.04,"saturation":1.06,"contrast":1.05,"highlights":"#ffcf8f","toning":0.2}` |
| `cool` | Crisp cool daylight / tech. | `{"temperature":-0.3,"saturation":0.96,"contrast":1.06,"shadows":"#2d5c9e","toning":0.22}` |
| `bleach` | Bleach bypass: desaturated, punchy, metallic. | `{"bleach":0.65,"saturation":0.7,"contrast":1.2}` |
| `noir` | Black and white, deep contrast. | `{"saturation":0,"contrast":1.35,"lift":-0.02,"gain":1.06}` |
| `vintage` | Faded film print: lifted blacks, warm, muted greens. | `{"saturation":0.78,"contrast":0.92,"lift":0.07,"gain":0.96,"temperature":0.15,"shadows":"#4f6a5a","highlights":"#ffe0ae","toning":0.35}` |
| `pastel` | Airy, soft and bright. | `{"saturation":0.82,"contrast":0.86,"lift":0.08,"gamma":1.08,"highlights":"#ffe3ef","shadows":"#8a9fd8","toning":0.25}` |

## Fonts

Text objects `font: "<id>"` (bundled, no web font fetch).

| Id | Description |
|---|---|
| `sans-bold` | Inter Bold — clean neo-grotesk, the default: headlines, UI-like titles. |
| `sans` | Inter Regular — subtitles, taglines, small labels. |
| `inter-black` | Inter Black — heavy, punchy headlines (tech, sport, sales). |
| `montserrat-extrabold` | Montserrat ExtraBold — wide geometric sans: bold brand titles, posters. |
| `space-grotesk-bold` | Space Grotesk Bold — quirky tech grotesk (startups, crypto, dev tools). |
| `bebas-neue` | Bebas Neue — tall condensed all-caps display: banners, cinema, sport. |
| `anton` | Anton — heavy condensed impact display: loud banners, sales. |
| `serif-bold` | Playfair Display Bold — elegant high-contrast serif (luxury, editorial, food). |
| `serif` | Playfair Display Regular — refined serif for subtitles and quotes. |
| `mono` | JetBrains Mono Bold — monospace (tech, code, terminal looks); no kerning by design. |
| `display` | Fredoka SemiBold — rounded, friendly (kids, games, playful brands). |
| `pacifico` | Pacifico — brush script (retro, surf, cafés, handwritten feel). |
| `lobster` | Lobster — bold connected script (retro signage, bakery, vintage). |

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
| `brushedMetal` | Brushed steel. | `{"type":"physical","color":"#c8ccd2","roughness":0.35,"metalness":1,"anisotropy":0.6}` |
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
| `carPaint` | Metallic car paint: sparkling flakes under a glossy clearcoat. | `{"type":"physical","color":"#b3121f","metalness":0.6,"roughness":0.4,"clearcoat":1,"clearcoatRoughness":0.03,"normalMap":{"procedural":"flakes","scale":40},"normalScale":0.2}` |
| `ceramic` | Glazed ceramic / porcelain (soft body, glossy glaze). | `{"type":"physical","color":"#f3efe8","roughness":0.45,"metalness":0,"clearcoat":1,"clearcoatRoughness":0.06}` |
| `marble` | Polished white marble with grey veins (procedural, triplanar-mapped: no UV stretching). | `{"type":"physical","color":"#ffffff","roughness":0.2,"metalness":0,"clearcoat":0.4,"clearcoatRoughness":0.1,"map":{"procedural":"marble"},"triplanar":0.5}` |
| `terrazzo` | Terrazzo stone with coloured chips (procedural, triplanar-mapped). | `{"type":"physical","color":"#ffffff","roughness":0.45,"metalness":0,"map":{"procedural":"terrazzo"},"triplanar":0.5}` |
| `wood` | Varnished wood grain (procedural texture). | `{"type":"physical","color":"#ffffff","roughness":0.5,"metalness":0,"clearcoat":0.5,"clearcoatRoughness":0.2,"map":{"procedural":"wood"}}` |
| `carbonFiber` | Woven carbon fibre under clearcoat (procedural texture). | `{"type":"physical","color":"#ffffff","roughness":0.35,"metalness":0.3,"clearcoat":1,"clearcoatRoughness":0.04,"map":{"procedural":"carbon","scale":12},"anisotropy":0.5}` |
| `leather` | Fine-grain leather with soft sheen. | `{"type":"physical","color":"#6b3a22","roughness":0.62,"metalness":0,"sheen":0.5,"sheenRoughness":0.5,"sheenColor":"#c49a7a","bumpMap":{"procedural":"voronoi","scale":60},"bumpScale":0.6}` |
| `satin` | Satin fabric: soft anisotropic sheen. | `{"type":"physical","color":"#c9a0dc","roughness":0.4,"metalness":0,"sheen":1,"sheenRoughness":0.3,"sheenColor":"#ffffff","anisotropy":0.4}` |
| `silk` | Silk: bright, very soft sheen. | `{"type":"physical","color":"#f2d7c9","roughness":0.3,"metalness":0,"sheen":1,"sheenRoughness":0.2,"sheenColor":"#fff4ec","specularIntensity":0.6}` |
| `brushedAluminium` | Brushed aluminium with stretched (anisotropic) highlights. | `{"type":"physical","color":"#d9dce1","roughness":0.3,"metalness":1,"anisotropy":0.85,"roughnessMap":{"procedural":"brushed","scale":1}}` |
| `ice` | Clear blue-tinted ice with a frosty surface. | `{"type":"physical","color":"#eaf8ff","roughness":0.1,"metalness":0,"transmission":1,"thickness":1.2,"ior":1.31,"attenuationColor":"#8fd3ff","attenuationDistance":1.2,"bumpMap":{"procedural":"noise","scale":3},"bumpScale":0.4}` |
| `water` | Liquid water: clear, slightly blue-green. | `{"type":"physical","color":"#ffffff","roughness":0.02,"metalness":0,"transmission":1,"thickness":1,"ior":1.333,"attenuationColor":"#4fc3d9","attenuationDistance":2}` |
| `diamond` | Diamond: high IOR with rainbow dispersion (fire). | `{"type":"physical","color":"#ffffff","roughness":0,"metalness":0,"transmission":1,"thickness":2.5,"ior":2.33,"dispersion":8,"specularIntensity":1,"envMapIntensity":2.5,"attenuationColor":"#dde8ff","attenuationDistance":3}` |
| `gem` | Coloured gemstone (ruby-like; change color/attenuationColor for sapphire, emerald…). | `{"type":"physical","color":"#ffe5ec","roughness":0,"metalness":0,"transmission":1,"thickness":1,"ior":1.77,"dispersion":2,"attenuationColor":"#e0115f","attenuationDistance":0.5,"envMapIntensity":1.4}` |
| `jelly` | Gummy jelly: coloured, translucent, glossy. | `{"type":"physical","color":"#ff7aa2","roughness":0.12,"metalness":0,"transmission":0.95,"thickness":1.5,"ior":1.35,"attenuationColor":"#ff2d6f","attenuationDistance":0.6,"clearcoat":1,"clearcoatRoughness":0.1}` |
| `chromeGradient` | Chrome tinted by a colour ramp (set `gradient`). | `{"type":"gradient","gradient":["#7f5cff","#ff5ca8","#ffd36e"],"metalness":1,"roughness":0.08}` |
| `soapBubble` | Soap bubble: clear with thin-film rainbow reflections. | `{"type":"physical","color":"#ffffff","roughness":0,"metalness":0,"transmission":1,"thickness":0.05,"ior":1.1,"iridescence":1,"iridescenceIOR":1.33,"iridescenceThicknessRange":[120,900],"side":"double"}` |
| `mattePastel` | Soft matte pastel with a velvety edge (stylised product renders). | `{"type":"physical","color":"#f7c8d8","roughness":0.75,"metalness":0,"sheen":0.4,"sheenRoughness":0.8,"sheenColor":"#ffffff"}` |
| `emissiveGradient` | Glowing colour ramp (set `gradient`; blooms with postfx bloom). | `{"type":"gradient","gradient":["#00e5ff","#7c4dff","#ff3d9a"],"emissive":"#ffffff","emissiveIntensity":1.6,"gradientEmissive":true,"roughness":0.4}` |
