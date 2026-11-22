# The scene format (`scene.json`)

A scene is one JSON document, `SceneDoc` in [`src/core/types.ts`](../src/core/types.ts). Every front door reads and writes it: the Studio, the CLI, the MCP server and the runtime that plays it on web pages. It is validated by `validateScene` (`src/core/validate.ts`) against the catalog (`src/core/catalog.ts`, documented in [catalog.md](catalog.md)): unknown ids, parameters, types and ranges come back as issues with JSON paths and "did you mean" hints.

```bash
npx -y @fleox/agent3d@0.1.0 scene validate --project my-scene --json
npx -y @fleox/agent3d@0.1.0 scene validate --file candidate.json --json
```

## Conventions

- **Units** ≈ metres, **Y is up**; the camera looks at `camera.target`.
- **Angles are in degrees** everywhere (rotations, `fov`, spot `angle`, behaviour speeds in deg/s).
- **Colours** are CSS strings: `"#rrggbb"`, `"#rgb"`, `"rgb(…)"`, `"hsl(…)"` or a CSS name.
- **Asset paths** are project-relative (`"assets/models/fox.glb"`) or built-in library references (`"library:models/nature/pine-tree.glb"`, see `agent3d assets library`).
- **Time** is in seconds.
- **Ids** match `[a-zA-Z][a-zA-Z0-9_-]*` and are unique in the scene (objects; lights have their own ids).

## A complete minimal scene

```json
{
  "version": 1,
  "id": "hello",
  "title": "Hello",
  "ariaLabel": "A spinning gold torus knot",
  "target": { "kind": "card", "aspect": "1:1" },
  "camera": { "type": "perspective", "fov": 35, "position": [0, 0, 6], "target": [0, 0, 0] },
  "environment": { "background": { "radial": ["#2b2d6e", "#0d0e24"] }, "lighting": "studio" },
  "lights": [
    { "id": "key", "type": "directional", "position": [3, 5, 5], "intensity": 2 }
  ],
  "objects": [
    {
      "id": "knot",
      "kind": "mesh",
      "geometry": { "type": "torusKnot", "radius": 1, "tube": 0.3 },
      "material": { "preset": "gold" },
      "behaviours": [{ "type": "rotate", "axis": [0, 1, 0], "speed": 30 }]
    }
  ]
}
```

## Top level

| Field | Type | Notes |
|---|---|---|
| `version` | `1` | Format version (`SCENE_VERSION`) |
| `id`, `title` | string | `title` is also the default accessible label |
| `description` | string? | Free text |
| `target` | TargetDef | Where and how the scene is shown on a page |
| `camera` | CameraDef | |
| `environment` | EnvironmentDef | Background, image-based lighting, fog, ground |
| `lights` | LightDef[] | |
| `objects` | ObjectDef[] | The scene graph (objects can have `children`) |
| `timeline` | TimelineDef? | Keyframe animation, markers, segments, scroll scrubbing |
| `interactions` | InteractionDef[]? | No-code triggers: click / hover / scroll / key → play segments, set properties, open URLs |
| `postfx` | PostFxDef[]? | Post effects in order |
| `physics` | PhysicsWorldDef? | Rigid-body physics: gravity, fixed step, materials, layers, joints, debug (games) |
| `scripts` | string[]? | Project paths of script modules (`"scripts/game.js"`) |
| `ui` | UiDef? | HUD elements (games, interactive scenes) |
| `audio` | AudioDef? | Named sounds and music |
| `data` | object? | Free-form data scripts read as `api.data`; also the values of `{data.key}` placeholders (data bindings, below) |
| `ariaLabel` | string? | Accessible label of the element (defaults to `title`) |
| `seed` | number? | Seed of every random process (generators, particles, `api.random`) |

## Target

```json
"target": { "kind": "banner", "aspect": "4:1", "posterTime": 2, "reducedMotion": "static", "budgetKb": 600 }
```

| Field | Default | Meaning |
|---|---|---|
| `kind` | | `banner`, `hero`, `card`, `square`, `fullscreen`, `inline`, `game` (sets defaults, budgets and accessibility role) |
| `aspect` | per kind: banner 4:1, hero / inline / fullscreen / game 16:9, card 4:5, square 1:1 | `"W:H"`; the embed keeps it responsively |
| `height` | | Fixed CSS height (`"320px"`, `"60vh"`) instead of the aspect ratio |
| `budgetKb` | banner 600, card 400, square / inline 600, hero 1500, fullscreen / game 4000 | Max export weight (runtime excluded); `check` warns above |
| `transparent` | false | Transparent canvas: the page shows through (background ignored) |
| `lazy` / `pauseOffscreen` | true / true | Start when visible; pause when scrolled away |
| `maxDpr` | 2 | Cap of the device pixel ratio |
| `reducedMotion` | `static` (games: `ignore`) | For visitors who prefer reduced motion: `static` freezes on `posterTime` with entrance behaviours (`appear`) shown finished, `slow` halves speeds, `ignore` plays normally |
| `posterTime` | 0 | Time of the poster frame and the reduced-motion still. Pick a time after every `appear` (delay + duration) — starters use 1.5 |
| `antialias` | true | |
| `shadows` | true when a light casts shadows | |
| `toneMapping` / `exposure` | `aces` / 1 | `none`, `aces`, `agx`, `neutral`, `reinhard` |
| `quality` | `auto` | Rendering tier: `auto`, `low`, `medium`, `high`, `ultra` — see [Quality tiers](#quality-tiers) |

## Camera

```json
"camera": { "type": "perspective", "fov": 30, "position": [0, 0, 12], "target": [0, 0, 0], "controls": "parallax", "parallax": { "strength": 0.3, "smoothing": 0.92 } }
```

- `type`: `perspective` (`fov`, default 45) or `orthographic` (`zoom`: world units visible vertically, default 10).
- `position`, `target` (look-at point, default origin), `near`, `far`.
- `controls`: `none` (fixed), `orbit` (drag; `orbitZoom`, `orbitLimits: { minDistance, maxDistance, minPolar, maxPolar }`), `parallax` (drifts with the pointer: `parallax.strength`, `smoothing`), `scroll` (follows `scrollPath: [{ position, target? }, …]` with the page scroll), `follow` (games: `follow: { target, offset, smoothing, lookAhead }`).
- `lookAt`: an object id the camera keeps looking at (replaces `target`). `shake: { amount, rotation, speed, seed }`: handheld noise (position units, aim degrees). `shots`: cinematic moves — see [Camera shots](#camera-shots).
- `autoRotate`: degrees per second around the target (with `none` or `orbit`).

## Environment

```json
"environment": {
  "background": { "gradient": ["#2a1306", "#5c2c0c", "#a8561b"], "angle": 10 },
  "lighting": "studio",
  "lightingIntensity": 0.7,
  "fog": { "color": "#ffd8a8", "near": 30, "far": 90 },
  "ground": { "y": 0, "size": 20, "shadowOnly": true }
}
```

- `background`:
  - a colour, or `"transparent"`;
  - `{ "gradient": [colours], "angle": deg, "grain": 0..1 }` (0° = bottom → top; `grain` adds visible film grain);
  - `{ "radial": [centre, edge], "center": [x, y], "radius": n, "grain": 0..1 }` (`center` in 0..1, default `[0.5, 0.5]`);
  - `{ "meshGradient": [2–6 colours], "speed": 0.15, "scale": 1, "seed": 1, "grain": 0.035 }`: soft Stripe-like colour blobs filling the frame, drifting when `speed` > 0;
  - `{ "sky": { … } }`: a colour-gradient sky (`top`, `horizon`, `bottom`, `sun: { direction | elevation + azimuth, color, size } | false`, `stars`), or a **physical sky** (Preetham atmosphere) when `preset` (`sunrise`, `morning`, `noon`, `afternoon`, `golden-hour`, `sunset`, `dusk`) or `physical: true` is set. The physical sky's sun (`sun.elevation` degrees above the horizon, `sun.azimuth` degrees, 0 = towards the default camera at +Z, 90 = +X) also adds a matching directional **sun light** (warmer and dimmer near the horizon; `sun.light: false` to skip it, `sun.intensity`, `sun.color`, `sun.castShadow` — default true) and lights the scene through `lighting: "sky"` (the default with a physical sky). Tuning: `turbidity` (haze), `rayleigh` (blue scattering), `mieCoefficient`, `mieDirectionalG`, `exposure`, `clouds` (0..1), `stars`.
  - `{ "hdri": path, "blur": 0..1, "intensity": n, "rotation": deg, "groundProjection": true | { "height": 2, "radius": 60 } }`: an equirect photo (`.hdr`, `.exr` or `.jpg`). `rotation` turns it (and the IBL derived from it); `groundProjection` projects its lower half on a ground disc (`height` = camera height of the photo in scene units) so objects stand inside the photo.
- `lighting` (image-based lighting for reflections and fill): `studio`, `soft`, `sunset`, `night`, `neutral`, `sky` (from the background sky or mesh gradient), `none`, or `{ "hdri": path, "intensity": n, "rotation": deg }`. Without `lighting`, an HDRI background lights the scene, a physical sky uses `sky`, anything else `soft`. `lightingIntensity` scales it. Bundled HDRIs: `library:hdri/softbox.hdr` (product studio), `studio`, `warehouse`, `forest`, `city` (overcast street), `beach` (sunny), `sky`, `sunset`, `night`, `night-city` — each `.hdr` (lighting, blurred backgrounds) with a `.jpg` preview.
- `fog`: linear `{ color, near, far }`, exponential `{ color, density }`, or **height fog** `{ color, density, height, falloff }` (exponential fog thick below `height`, thinning above it with `falloff` — valleys and ground haze while hills and sky stay clear). Without `color`, fog takes the physical sky's horizon haze, the gradient sky's `horizon`, or the background colour, and the physical sky blends its horizon into that colour so fogged ground meets the sky seamlessly.
- `ground`: a plane at `y` (`size`, `color`, `roughness`, `grid`, `opacity`, `shadowOnly` to only catch shadows so objects sit on the page — those shadows fade out toward the plane's edges and the last ~15 % before the canvas edges, so they never end in a hard cut; a smaller `size` keeps them closer to the object; `opacity` sets the shadow darkness, default 0.28).
- `contactShadows`: `true` or `{ "opacity": 0.6, "blur": 2.5, "far": n, "y": n, "size": n, "resolution": 512, "color": "#000", "frames": 0 }` — soft blurred shadows right under the objects (product shots), no shadow-casting light needed. The plane is fitted to the objects automatically and fades out radially; `far` = how high above the plane objects still darken it; `frames: 1` renders it once (static scenes, cheaper).
- `rig`: a light rig from the catalog (`agent3d catalog lightRigs`): `"studio-3point"`, `"softbox"`, `"product-top"`, `"rim"`, `"dramatic"`, `"golden-hour"`, `"noon"`, `"overcast"`, `"neon"`, `"moonlight"`, or `{ "preset": "softbox", "intensity": 1, "rotation": deg, "scale": 1, "castShadow": true, "color": tint }`. Its lights are added to `lights` (positions assume a subject ~1–3 units around the origin; `scale` for bigger scenes).
- `shadows`: shadow-map quality for every shadow-casting light: `{ "type": "pcf" | "vsm", "softness": 4, "mapSize": 2048, "intensity": 1 }` (`vsm` = smooth blurred shadows). Directional shadow cameras are fitted to the scene automatically.

```json
"environment": {
  "background": { "sky": { "preset": "golden-hour", "sun": { "azimuth": 215 } } },
  "fog": { "density": 0.025, "height": 1, "falloff": 0.25 }
}
```

```json
"environment": {
  "background": { "radial": ["#f6efe8", "#d8cbbf"], "center": [0.5, 0.62] },
  "lighting": { "hdri": "library:hdri/softbox.hdr" },
  "rig": "softbox",
  "contactShadows": { "opacity": 0.7, "blur": 2.5 }
}
```

## Lights

```json
"lights": [
  { "id": "fill", "type": "hemisphere", "skyColor": "#fff1dc", "groundColor": "#3a1d0b", "intensity": 0.8 },
  { "id": "key", "type": "directional", "position": [4, 6, 6], "intensity": 2.4, "castShadow": true },
  { "id": "rim", "type": "point", "position": [-5, 2, -3], "color": "#ffb366", "intensity": 30, "distance": 20 }
]
```

`type`: `ambient`, `directional`, `point` (`distance`, `decay`), `spot` (`angle` in degrees, `penumbra`, `target`, `volumetric`), `hemisphere` (`skyColor`, `groundColor`), `rect` (area light: `width`, `height`, `panel`; lights standard / physical materials only). Common: `id`, `color`, `intensity`, `position`, `target`, `castShadow`, `shadow`, `behaviours` (e.g. `flicker`).

- `volumetric` (spot): `true` or `{ "intensity": 1, "length": n, "color": c }` — a cheap glowing light cone from the light to its target (beams in fog, stages, neon scenes).
- `panel` (rect): `true` draws the glowing rectangle itself, so the light source is visible in the frame (neon strips, softboxes).
- `shadow`: per-light shadow tuning `{ "softness", "mapSize", "bias", "normalBias", "intensity" }`, overriding `environment.shadows`. A scene with lit materials and neither lights nor environment lighting renders black: `scene validate` warns.

## Objects

Common fields (all kinds): `id`, `name`, `position`, `rotation` (degrees, XYZ order), `scale` (number or `[x, y, z]`), `visible`, `castShadow`, `receiveShadow`, `behaviours`, `children`, `tags` (scripts: `api.findByTag`), `body` (physics), `href` (clicking opens the URL; pointer cursor), `userData`.

| `kind` | Specific fields |
|---|---|
| `mesh` | `geometry: { type, …params }` (catalog geometries), `material` |
| `text` | `text`, `font` (catalog id, `sans-bold` default — see [Text and logos](#text-and-logos)), `size` (cap height, default 1), `depth` (0.2; 0 = flat), `bevel`, `align` (`center` default; the text is centred on its position), `letterSpacing`, `lineHeight`, `kerning`, `maxWidth`, `curveSegments`, `outline`, `splitLetters`, `reveal`, `material` |
| `model` | `src` (`.glb` / `.gltf` path or `library:<id>`), `fit` (largest dimension in units), `center` (bottom centre at the origin, default true), `animation: { clip, loop, speed, crossfade, offset, blend: { clip: weight } }`, `morph: { targetName: 0..1 }` (morph targets, animatable as `<id>.morph.<name>`), `material` (override for every mesh) |
| `group` | Only `children` |
| `generator` | `generator` (catalog id: terrain, trees, rocks, grass, flowers, water, clouds, city, character, planet, starfield, blob, waveGrid, maze, road, floatingIsland, globe, crystals, galaxy, bars3d, abstractShapes — `agent3d catalog generators <id>` lists the params), `params`, `seed`, `material` (override of the main surface for `blob`, `rocks`, `terrain`, `planet`, `floatingIsland`, `globe`, `crystals`, `bars3d`, `abstractShapes` — e.g. `{ "type": "shader", "shader": "gradientFlow" }` on a blob keeps its morph; without colour / preset / map, lit materials keep the generator's vertex colours) |
| `particles` | `preset` (stars, snow, rain, fireflies, confetti, sparks, dust, bubbles, embers, hearts, magic, smoke, fire, petals, leaves, galaxyDust, bokeh) and overrides: `count`, `area`, `size`, `color` (one or a list), `speed`, `direction`, `spread`, `lifetime`, `opacity`, `blending` (`normal` / `additive`), `shape` (`soft` (default), `point`, `square`, `circle`, `star`, `spark`, `streak` (velocity-stretched), `heart`, `bubble`, `smoke`, `petal`, `leaf`, `ring` (bokeh)), `seed`. All motion is a pure function of time (deterministic). |
| `instances` | One `geometry` + `material` drawn many times: `layout` = `{ type: "grid", count: [x, y, z], spacing: [x, y, z] }`, `{ type: "scatter", count, area, minScale, maxScale, randomRotation, seed }`, `{ type: "circle", count, radius }` or `{ type: "list", items: [transforms] }`; `colors` cycled per instance |
| `svg` | `src` (inline SVG markup or a project path), `size` (width by default, 2), `fit`, `depth` (0.2), `bevel`, `keepColors`, `strokes`, `curveSegments`, `layerGap`, `material`: a logo or icon extruded into 3D — see [Text and logos](#text-and-logos) |

### Geometry

`{ "type": "<id>", …params }` with the catalog's parameters (sizes in units): `box`, `roundedBox`, `sphere`, `cylinder` (`radiusTop`, `radiusBottom`, `height`), `cone`, `capsule`, `torus`, `torusKnot`, `plane` (faces +Z: rotate `[-90, 0, 0]` for a floor), `circle`, `ring`, `icosahedron`, `dodecahedron`, `octahedron`, `tetrahedron`, `lathe` (`points` profile), `extrude` (`shape` polygon), `tube` (`points` curve). Each has a triangle cost formula used by `check`.

### Material

```json
"material": { "preset": "gold", "roughness": 0.25 }
```

- `preset`: plastic, matte, clay, chrome, brushedMetal, gold, copper, glass, frostedGlass, rubber, pearl, holographic, neon, toon, flat, lowpoly, velvet, wireframe, normal, and the photoreal set carPaint, ceramic, marble, terrazzo, wood, carbonFiber, leather, satin, silk, brushedAluminium, ice, water, diamond, gem, jelly, chromeGradient, soapBubble, mattePastel, emissiveGradient (`agent3d catalog materialPresets`). Explicit fields override it.
- `type`: `standard`, `physical`, `basic`, `lambert`, `toon`, `normal`, `matcap`, `gradient` (`gradient: [colours]` vertical ramp), `shader` (`shader: <catalog id>`, `uniforms`).
- Fields: `color`, `metalness`, `roughness`, `emissive`, `emissiveIntensity`, `opacity`, `transparent`, `wireframe`, `flatShading`, `side` (`front`, `back`, `double`), `envMapIntensity` (reflection strength of the environment lighting).
- Physical (`type: "physical"`): `transmission`, `thickness`, `ior`, `clearcoat`, `clearcoatRoughness`, `iridescence`, `iridescenceIOR`, `iridescenceThicknessRange: [nm, nm]`, `sheen`, `sheenColor`, `sheenRoughness`, `anisotropy` (stretched highlights) + `anisotropyRotation` (degrees), `attenuationColor` + `attenuationDistance` (colour picked up through transmissive volumes: jelly, liquids, gems), `specularIntensity`, `specularColor`, `dispersion` (rainbow fire in transmissive gems, 0..10).
- Textures: `map`, `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `emissiveMap`, `bumpMap`, `displacementMap`, `alphaMap` — a path / library id, or a **procedural texture** `{ "procedural": "<id>", …params }` (`agent3d catalog textures`: marble, wood, terrazzo, carbon, noise, voronoi, flakes, brushed, grid, checker, stripes, dots), generated at load time, seamless, zero bytes. Colour slots use its `colors`; data slots use the pattern's height; `normalMap` derives normals from it. Scales: `normalScale`, `bumpScale`, `aoMapIntensity`, `displacementScale`; `repeat: [u, v]`.
- `triplanar`: `true` or a scale (repeats per unit) — projects `map`, `roughnessMap`, `metalnessMap`, `emissiveMap` and `normalMap` along the object's axes instead of its UVs (generators, terrain, stretched cylinders). The marble and terrazzo presets use it.
- `gradientEmissive` (gradient type): the colour ramp drives the emissive glow too.

```json
"material": { "type": "physical", "color": "#ffffff", "roughness": 0.3, "map": { "procedural": "wood", "rings": 14 }, "bumpMap": { "procedural": "wood", "rings": 14 }, "bumpScale": 0.3, "clearcoat": 0.6 }
```

### Text and logos

**Fonts** (`agent3d catalog fonts`): `sans-bold` (Inter Bold, default), `sans` (Inter), `inter-black`, `montserrat-extrabold`, `space-grotesk-bold`, `bebas-neue`, `anton` (condensed display), `serif-bold` / `serif` (Playfair Display-based elegant serif), `mono` (JetBrains Mono Bold), `display` (Fredoka SemiBold, rounded), `pacifico`, `lobster` (scripts). All OFL, subset to Latin-1 (accents work), shipped in the library and copied into exports only when used. `font` may also be a project path to a three.js typeface JSON (`assets/fonts/brand.typeface.json`, made with `scripts/convert-font.mjs`).

**Layout.** The font's kerning pairs apply by default (`"kerning": false` to disable — accented letters are kerned like their base letter). `letterSpacing` adds units between characters (negative tightens), `lineHeight` is a multiple of the font size (1.25), `"\n"` breaks lines and `maxWidth` (units) wraps on spaces; `align` places every line.

**Finish.** The bevel defaults to `min(depth × 0.3, size × 0.035)` and keeps the letter silhouette (half inset, half outset) with smooth normals; curve smoothness grows with `size` (`curveSegments` overrides it, max points per curve). `depth: 0` gives crisp flat (double-sided) lettering.

**Outline.** `"outline": true` or `{ "width": 0.06, "color": "#1a1033", "depth": 0.12, "material": {…} }` adds a recessed back layer: the glyphs offset outwards by `width` (units, default `size × 0.06`), behind the face — the sticker / comic-title look.

**Letters.** `"splitLetters": true` makes each glyph a child object `"<id>/<n>"` (n = 0, 1, … counting non-space characters, line after line), pivoting on its own centre, with its own material: timeline tracks can target `"title/0.position.y"`, `"title/3.rotation"`, `"title/2.material.color"`.

**Reveal.** A per-letter staggered entrance (implies `splitLetters`), driven by the scene clock (deterministic, settled under reduced motion like `appear`):

```json
{ "id": "title", "kind": "text", "text": "Launch day", "font": "inter-black", "size": 1, "depth": 0.25,
  "outline": { "width": 0.05, "color": "#120d2b" },
  "reveal": { "effect": "rise", "stagger": 0.05, "duration": 0.7, "delay": 0.2, "order": "forward" } }
```

`effect`: `rise` (default), `fade`, `scale`, `spin`, `drop`; `stagger` (0.04 s between letters), `duration` (0.6 s per letter), `delay` (0), `ease` (any timeline easing; default `outCubic`, `outBack` for scale / spin), `order` (`forward`, `reverse`, `center`, `random` — deterministic).

**SVG logos and icons.** Paths, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `line`, `use`, nested transforms and `<style>` classes are read; `fill-rule` (`nonzero` / `evenodd`) and holes are honoured; curves are sampled by length (large circles stay round). Fills are extruded with an optional `bevel`; strokes (`stroke-width`, `stroke-linejoin`, `stroke-linecap`, `stroke-miterlimit`) become solid stroke outlines — line-icon sets (`fill="none" stroke="currentColor"`) work, `currentColor` taking the material colour. Each path keeps its SVG colour (`keepColors`, default `true` without `material`, `false` with one; `true` + a material = that material's finish with the SVG colours); gradient paints use the mix of their end stops. `size` sets the width (`fit: "height"` / `"max"` to fit the other / larger side), the logo is centred on its position, later paths sit `layerGap` units in front (default `depth × 0.02`). `"strokes": false` ignores strokes. `<text>` is not supported: convert text to outlines in the design tool.

## Behaviours

```json
"behaviours": [
  { "type": "float", "amplitude": 0.1, "speed": 0.3 },
  { "type": "hoverScale", "scale": 1.1, "when": "always" },
  { "type": "appear", "effect": "rise", "duration": 1, "delay": 0.2 }
]
```

Procedural animation and interaction on objects and lights: `type` (catalog id), `when` (`always` default, `hover`, `click`, `visible`, `scroll`), `delay` (s), and the behaviour's parameters. The behaviours (rotate, float, bob, pulse, wobble, sway, orbit, path, followPointer, lookAtPointer, hoverScale, hoverLift, clickBounce, spinOnClick, scrollRotate, scrollMove, drift, blink, colorCycle, flicker, billboard, appear, magnet, spring, parallax, tilt, breathe, noise, lookAt…) and their parameters are in [catalog.md](catalog.md#behaviours). Pro motion: `spring` (pointer follow with overshoot), `parallax` (depth layers with pointer + scroll), `tilt` (card tilt on hover), `breathe` (organic idle), `noise` (organic wander), `lookAt` (face an object / the camera).

## Timeline

```json
"timeline": {
  "duration": 4,
  "trigger": "visible",
  "autoplay": "intro",
  "markers": { "lifted": 2.6 },
  "segments": { "intro": { "from": 0, "to": 2 }, "hover-in": [2, "lifted"], "hover-out": ["lifted", 2] },
  "tracks": [
    { "target": "children:title.position.y", "keys": [[0, "-=1.5"], [0.9, "+=0", "cubicBezier(0.16, 1, 0.3, 1)"]], "stagger": 0.06 },
    { "target": "tag:shape.scale", "keys": [[0.4, 0.001], [1.3, 1, "spring(170, 12)"]], "stagger": 0.08, "staggerFrom": "center" },
    { "target": "product.position.y", "keys": [[2, "+=0"], [2.6, "+=0.5", "outBack"]] },
    { "target": "camera.fov", "keys": [[0, 40], [2, 34]], "ease": "inOutSine" },
    { "target": "postfx.bloom.strength", "keys": [[0, 0], [2, 0.6]] }
  ]
}
```

- `duration` (s), `loop` (`true`, `false` or `"pingpong"`), `speed` (playback rate, default 1).
- `trigger` — what drives the clock: `load`, `visible` (default), `hover` (scrubs forward while hovered, back on leave), `click`, `scroll` (time = scroll progress, see `scroll`), `manual` (only interactions / `player.playSegment()` move it).
- `autoplay`: `true` (default), `false` (wait for an interaction), or a segment name — the trigger then plays only that segment (an intro that stops before the hover states).
- `markers: { name: seconds }` — crossing one emits an event with its name (payload `{ marker, time }`): scripts `api.on(name)`, interactions `{ "on": "event", "event": name }`, `player.on(name, fn)`, and the element's `agent3d:event`.
- `segments: { name: { from, to, loop?, speed? } | [from, to] }` — `from` / `to` in seconds or marker names; `to < from` plays backwards. `"timeline"` is the whole timeline.
- `scroll` (with `trigger: "scroll"`): `{ start, end, smoothing }` — ScrollTrigger-like positions `"<element edge> <viewport edge>"` with edges `top | center | bottom | N% | Npx`; default `"top bottom"` → `"bottom top"`; `smoothing` 0..0.99 (default 0.8). In deterministic renders the progress is `t / duration`, so `agent3d render --count 8` shows the scroll states.
- Track `target`: `<selector>.<property>`.
  - Selector: an object / light id, `camera`, `environment`, `postfx`, a comma list `a,b,c`, `tag:<tag>` (objects with that tag, scene order), `children:<id>` (direct children — text letters with `splitLetters` too), or a letter `<textId>/<n>`.
  - Object properties: `position`, `rotation` (degrees), `scale` (number = uniform) and their `.x/.y/.z`, `visible`, `material.<prop>` (`opacity`, `color`, `emissive`, `emissiveIntensity`, `metalness`, `roughness`, `transmission`, `iridescence`, `clearcoat`, `sheen`, …), `material.uniforms.<name>`; models: `morph.<name>`, `animation.<clip>.weight | speed | time` (blend clips, scrub a clip by scroll).
  - Lights: `intensity`, `color`, `position`, `target`, `angle` (degrees), `penumbra`, `distance`, `decay`. Camera: `position`, `target`, `fov`, `zoom` (orthographic), `focus` (depth-of-field distance → postfx `dof`). Environment: `fog.color | near | far | density`, `lightingIntensity`, `exposure`, `background` (solid colours). Post effects: `postfx.<type>.<param>` (numeric / colour params of an effect present in `postfx`).
- `keys`: `[time, value]` or `[time, value, ease]` sorted by time — the key's ease shapes the segment that ends at it. Values: numbers, `[x, y, z]`, colours, booleans, or relative strings `"+=1"`, `"-=0.5"`, `"*=1.2"` (from the property's rest value; vec3 keys may mix numbers and relative strings).
- `stagger` (s) offsets each target of a multi-target selector; `staggerFrom`: `start` (default), `end`, `center`, `edges`, `random` (seeded).
- `ease` (track default, `linear` when omitted): `linear`, `step`, `in` / `out` / `inOut` × `Quad`, `Cubic`, `Quart`, `Quint`, `Sine`, `Expo`, `Circ`, `Back`, `Elastic`, `Bounce` (e.g. `outCubic`, `inOutBack`), or parametric `"cubicBezier(x1, y1, x2, y2)"` (CSS), `"spring(stiffness, damping[, mass])"` (lower damping = more bounce; settles at the key), `"steps(n)"` / `"steps(n, start)"`.
- Reversed segments play the curve backwards (an `outBack` entrance becomes an `inBack` exit). For interruptible hover states prefer interaction `set` tweens or `toggle` (which resumes from where it is).

### Camera shots

```json
"camera": {
  "type": "perspective", "fov": 40, "position": [0, 1, 10], "target": [0, 0.5, 0],
  "shake": { "amount": 0.02, "rotation": 0.25, "speed": 0.4 },
  "shots": [
    { "type": "pushIn", "at": 0, "duration": 2, "distance": 2.5 },
    { "type": "path", "at": 2, "duration": 2.5, "points": [[2.5, 1.6, -1.2], [2.8, 1.7, -2]], "lookAt": "knot" },
    { "type": "crane", "at": 8, "duration": 2, "height": 2.5, "distance": -2 },
    { "type": "focus", "at": 3, "duration": 1, "object": "knot" }
  ]
}
```

Shots run on the timeline clock (scroll-driven with `trigger: "scroll"`; scene time without a timeline), in `at` order, each from the pose the previous ones left (overlaps blend). `ease` defaults to `inOutCubic`. Types: `dolly` / `pushIn` / `pullOut` (along the view axis by `distance`; pushIn default 25 % closer), `truck` (sideways), `pedestal` (up / down, target follows), `crane` (rises by `height` while the target stays; `distance` moves toward it), `orbit` (`angle` yaw, `elevation`, `distance` degrees / units), `zoom` (`fov`), `move` (to `position` / `target` / `fov`), `path` (Catmull-Rom through `points`, looking `lookAhead` ahead — default 0.05 of the path — or at `lookAt`: an object id or a point), `lookAt` (pan to `object` or `target`), `focus` (rack focus: postfx `dof` focus → `focus` distance or the distance to `object`). Camera tracks (`camera.position`…) apply after the shots.

## Interactions

```json
"interactions": [
  { "on": "hover", "target": "product", "do": [{ "play": "hover-in" }] },
  { "on": "hoverEnd", "target": "product", "do": [{ "play": "hover-out" }] },
  { "on": "click", "target": "product", "do": [{ "openUrl": "https://shop.example.com/donuts" }, { "emit": "product-click" }] },
  { "on": "hover", "target": "robot", "do": [{ "playClip": "Wave", "target": "robot", "crossfade": 0.25 }] },
  { "on": "click", "target": "robot", "do": [{ "set": { "path": "robot.morph.Surprised", "value": 1 }, "duration": 0.3, "ease": "outCubic" }] },
  { "on": "scroll", "at": 0.5, "once": true, "do": [{ "emit": "halfway" }] },
  { "on": "key", "key": "Space", "do": [{ "toggle": "open" }] },
  { "on": "event", "event": "lifted", "do": [{ "set": { "path": "cta.material.color", "value": "#e8336d" }, "duration": 0.2 }] }
]
```

- `on`: `click`, `hover`, `hoverEnd` (on `target`, or the whole canvas without one), `visible` (once, when the embed starts), `scroll` (progress crosses `at` downward), `key` (`key`: a `KeyboardEvent.code`), `event` (`event`: a marker or emitted name). `once: true` fires a single time.
- Actions (`do`, in order): `{ "play": "<segment>" | "timeline", "reverse"? }`, `{ "toggle": "<segment>" }` (forward, then backward from where it is), `{ "seek": seconds | "<marker>" }`, `{ "set": { "path", "value" }, "duration"?, "ease"? }` (any track target; tweened from the shown value, then held), `{ "emit": "<name>", "payload"? }`, `{ "openUrl": "https://…" | "/path", "newTab"? }`, `{ "playClip": "<clip>", "target": "<modelId>", "loop"?, "speed"?, "crossfade"? }`.
- `openUrl` is the only way a scene navigates: http(s) or page-relative URLs only, on `click` / `key` interactions only (a user gesture), never in headless renders (an `openUrl` event is emitted instead). Cross-origin URLs open in a new tab (`noopener,noreferrer`) unless `newTab: false`.
- Click / hover targets are pickable and get a pointer cursor.
- Headless: `agent3d render --input '[{"t": 0.5, "pointer": [0, 0]}, {"t": 2, "click": [0.7, 0.1]}]'` fires hover / click interactions at those times. Page scripts: `player.playSegment(name)`, `player.trigger("click", id)`, `player.emit(name)`, `player.on(name, fn)`, `player.setScrollProgress(p)`.

## Post effects

```json
"postfx": [
  { "type": "look", "preset": "cinematic" },
  { "type": "dof", "focusOn": "product", "aperture": 0.003 },
  { "type": "vignette", "darkness": 0.5 }
]
```

Each entry is a catalog effect (`{ "type": "<id>", …params }`, parameters and GPU cost in [catalog.md](catalog.md#post-effects)) or a **look preset** `{ "type": "look", "preset": "cinematic" | "product" | "dreamy" | "neon" | "retro" | "clean", "intensity"?: 0…1 }` that expands into a tuned stack (exact expansions in [catalog.md → Look presets](catalog.md#look-presets)). An effect listed next to a look overrides the matching expanded entry param by param (above: the look's vignette with `darkness` 0.5).

| Group | Effects |
|---|---|
| Realism (HDR, before tone mapping) | `ao` (GTAO contact shading — on a `shadowOnly` ground it becomes a contact shadow), `outline`, `godrays` (from the sky sun, a light id or the first directional light), `dof` (bokeh, `focusOn: "<objectId>"` autofocus), `bloom`, `lensflare` (anamorphic streaks + ghosts + halo) |
| Antialiasing | `fxaa`, `smaa`, `taa` (supersampled stills: deterministic renders, reduced-motion still and paused frames accumulate `samples` jittered frames; free while playing) |
| Stylised (declared order) | `tiltshift`, `pixelate`, `halftone`, `ascii`, `glitch` |
| Finish (merged into one pass) | `chromatic`, `sharpen`, `grading` (procedural looks `cinematic`, `teal-orange`, `warm`, `cool`, `bleach`, `noir`, `vintage`, `pastel` + exposure, white balance, contrast, lift / gamma / gain, split toning, saturation), `vignette`, `film` |

The pipeline order is fixed (the declared order only matters among the stylised effects): scene in half-float HDR (MSAA per quality tier) → realism effects (`ao` → `outline` → `godrays` → `dof` → `bloom` → `lensflare`) → tone mapping + background (the background keeps its exact colour) → `fxaa` / `smaa` → stylised → finish (sRGB + dithering, no banding). `ao`, `dof`, `godrays` and `outline` share one normal / depth pre-pass. Timeline tracks can animate `postfx.<type>.<param>` (e.g. `postfx.dof.focus` for a rack focus, `postfx.bloom.strength`).

### Quality tiers

`target.quality` (default `auto`):

| Tier | DPR cap | MSAA | Effects |
|---|---|---|---|
| `low` | 1 | off | `high`-cost effects (`ao`, `dof`) off, heavy effects at half resolution, ≤ 4 still samples |
| `medium` | 1.5 | 4× | all effects, heavy ones at half resolution |
| `high` | `maxDpr` (2) | 4× | all effects, heavy ones at half resolution, more samples |
| `ultra` | `maxDpr` | 8× | full-resolution effects, most samples, ≤ 64 still samples |

`auto` picks `high` on desktops, `medium` on phones / small GPUs and `low` on software GL, then adapts while playing: if the frame rate stays under 40 fps for 3 s it lowers the pixel ratio (down to 1), then the tier (never back up). Deterministic renders (`agent3d render`, posters, video) always use `high` unless the tier is explicit. `agent3d check` reports the post-processing GPU cost (`budget.gpu`) and warns about heavy effects on games.

## Physics, scripts, HUD and audio (games)

```json
"physics": { "gravity": [0, -9.81, 0], "step": 0.016666 },
"scripts": ["scripts/game.js"],
"ui": {
  "elements": [
    { "id": "score", "type": "text", "text": "Score {score}", "anchor": "top-left", "style": "pill" },
    { "id": "start", "type": "button", "text": "Play", "anchor": "bottom", "action": "start", "visible": "phase == 'ready'" },
    { "id": "energy", "type": "bar", "value": "energy", "anchor": "top" }
  ],
  "color": "#ffffff",
  "accent": "#ef476f"
},
"audio": { "sounds": { "coin": { "preset": "coin" }, "jingle": { "src": "assets/audio/jingle.mp3", "volume": 0.5 } }, "music": { "preset": "chiptune-loop", "volume": 0.3 } }
```

- `body` on an object: see [Rigid-body physics](#rigid-body-physics) below.
- UI elements: `id`, `type` (`text`, `button`, `bar`), `text` with `{state key}` placeholders, `anchor` (top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right), `style` (`plain`, `pill`, `title`, `subtitle`), `value` (bar: state key holding 0..1), `action` (button: event sent to scripts), `visible` (boolean, state key or expression such as `"phase == 'over'"`). `ui.font` takes system font stacks only (no web font is fetched).
- Audio: synthesised presets (zero bytes; catalog `sounds`) or project files. Audio never starts before a user gesture; `muted` sets the initial state of the mute button.
- Scripts: see [scripting.md](scripting.md).

### Rigid-body physics

Objects with a `body` are simulated as real rigid bodies (position **and rotation**; [cannon-es](https://github.com/pmndrs/cannon-es), MIT, bundled in a lazy runtime chunk that only loads when the scene has bodies or joints). The simulation runs at the fixed `physics.step` and is deterministic: `seek(t)` always gives the same transforms, whatever the seek order (renders and posters are reproducible).

```json
"physics": {
  "gravity": [0, -9.81, 0],
  "step": 0.016666,
  "substeps": 2,
  "iterations": 12,
  "sleep": true,
  "debug": false,
  "materials": { "ice": { "friction": 0.02 }, "rubber": { "friction": 0.9, "restitution": 0.8 } },
  "contacts": [{ "a": "ice", "b": "rubber", "friction": 0.1 }],
  "layers": ["player", "enemy"],
  "joints": [
    { "id": "door-hinge", "type": "hinge", "a": "door", "pivot": [-1, 1.2, 0], "axis": [0, 1, 0] },
    { "type": "point", "a": "bob", "pivot": [0, 5, 0] },
    { "type": "spring", "a": "crate", "b": "anchor", "restLength": 1.5, "stiffness": 60, "damping": 2 }
  ]
}
```

| `physics` field | Meaning |
|---|---|
| `gravity` | World gravity, default `[0, -9.81, 0]` (m/s²) |
| `step` | Fixed simulation step (s), default 1/60 |
| `substeps` | Solver sub-steps per step (1–8, default 1): stabler tall stacks, less tunnelling |
| `iterations` | Constraint solver iterations (default 10) |
| `sleep` | Resting bodies fall asleep (cheap, stable stacks); default `true` |
| `debug` | Draws collider wireframes on top of the scene (green dynamic, blue static, orange kinematic, magenta trigger, grey sleeping) — use it in `agent3d render` to check colliders |
| `materials` | Named surfaces `{ friction?, restitution? }` referenced by `body.material` |
| `contacts` | Per-pair overrides `{ a, b, friction?, restitution? }` between two named materials (otherwise friction = √(f₁·f₂), restitution = max) |
| `layers` | Collision layer names (bit order, max 16 with `"default"`); layers used by bodies are added automatically |
| `joints` | Constraints, see below |

**Body** (`objects#…body`):

| Field | Meaning |
|---|---|
| `type` | `dynamic` (simulated), `static` (immovable), `kinematic` (moved by scripts / velocity, pushes dynamic bodies, ignores gravity), `trigger` (detects overlaps, never pushes) |
| `shape` | `box` (default: the object's bounding box, in the object's rotated frame), `sphere`, `cylinder`, `capsule` (Y-up), `convex` (hull of the mesh / model, good for dynamic models), `trimesh` (exact triangles; static / kinematic only — level geometry, models), `heightfield` (terrain generators), `compound` (`shapes`), `auto` (primitive geometry → matching shape, terrain → heightfield, static models / meshes → trimesh, dynamic → convex) |
| `size`, `radius`, `height` | Override the measured box size / sphere, cylinder, capsule radius / cylinder, capsule height (world units) |
| `offset` | Collider centre relative to the object origin (default: bounding-box centre) |
| `shapes` | `compound`: `[{ "shape": "box" \| "sphere" \| "cylinder" \| "capsule", "size"?, "radius"?, "height"?, "offset"?, "rotation"? }]` (offsets from the object origin) |
| `mass` | kg, default 1 (dynamic only) |
| `friction`, `restitution`, `material` | Surface: friction (default 0.5), bounciness 0..1 (default 0.2), or a `physics.materials` name |
| `velocity`, `angularVelocity` | Initial velocity (m/s) and spin (degrees / s) |
| `linearDamping`, `angularDamping` | 0..1, default 0.01 (air drag) |
| `gravityScale` | Gravity multiplier (0 = floats) |
| `fixedRotation` | Never rotates (players driven by velocity) |
| `character` | Character controller body: fixed rotation, no friction (no wall sticking), never sleeps — drive it with `api.physics.moveCharacter` / `jump` |
| `sleep` | `false` keeps it always awake |
| `ccd` | Fast object (bullets, thrown balls): extra sub-steps against tunnelling |
| `layer`, `collidesWith` | Collision layer name and the layers it collides with (default: all) |

Generators that publish collision boxes (the maze generator with `bodies: true`) get a static compound body with the generator's id.

**Joints** (`physics.joints[]`, pivots and axes in world space at scene start; omit `b` to attach `a` to the world):

| `type` | Fields |
|---|---|
| `hinge` | `pivot`, `axis` (default `[0, 1, 0]`), `motor: { speed (degrees / s), maxForce? }` — doors, wheels, flippers |
| `point` | `pivot` — ball-and-socket: pendulums, chains, ragdoll joints |
| `distance` | `distance` (default: current distance between the centres) — rigid rods |
| `lock` | — welds two bodies together (breakable with `maxForce`) |
| `spring` | `restLength` (default: current distance), `stiffness` (default 50), `damping` (default 1), `pivot` = world anchor on `b` (or the world point when `b` is omitted) |

All joints take `maxForce` (default 1e6) and `collideConnected` (default `false`). Scripts drive bodies with `api.physics` (impulses, forces, torques, velocities, raycasts on the real shapes, contacts with point / normal / impulse, trigger enter / exit, character controller): see [scripting.md](scripting.md).

**Checking colliders**: set `"debug": true` and run `agent3d render` — the wireframes show exactly what collides.

## Project files around the scene

```
my-banner/
  agent3d.json        { name, title, createdAt, updatedAt, template?, agent3d }   (agent3d = engine version that last wrote it)
  scene.json          the SceneDoc
  assets/             + assets/manifest.json { assets: [{ path, kind, bytes, source, sourceUrl?, license, author?, attribution?, addedAt }] }
  scripts/            script modules
  renders/            PNGs from `agent3d render`
  dist/               exports from `agent3d export`
```

## Issues

Validation and `check` return `Issue` objects: `{ severity: "error" | "warning" | "info", code, path, message, hint? }`. Paths use ids where possible (`objects#logo.material.roughness`) and indices otherwise (`lights[0].intensity`). Errors block saving; warnings (unknown parameters, missing lights…) are saved but should be fixed; infos are advice (attribution, clipped objects).

## Data bindings

Text objects' `text`, any object's `href`, `title`, `ariaLabel` and HUD element texts may contain `{data.key}` placeholders: `{data.title}`, `{data.product.name}` (nested), `{data.cta|Shop now}` (fallback when the value is missing or empty). They are replaced on a copy of the scene before it is built, from `scene.data` — which the page can override per embed with `data-*` attributes (`<agent3d-scene data-title="Summer sale">`, `data-cta-label` → `ctaLabel`, `data-json='{"price": 9}'`) or `element.setData({...})` (see `docs/export.md`). A missing value without a fallback becomes an empty string, so give every key a default in `scene.data`.

```json
{ "data": { "title": "Spring sale", "cta": "Shop now" },
  "objects": [{ "id": "headline", "kind": "text", "text": "{data.title}", "href": "/sale?ref={data.cta}" }] }
```
