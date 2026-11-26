# The scene format (`scene.json`)

A scene is one JSON document, `SceneDoc` in [`src/core/types.ts`](../src/core/types.ts). Every front door reads and writes it: the Studio, the CLI, the MCP server and the runtime that plays it on web pages. It is validated by `validateScene` (`src/core/validate.ts`) against the catalog (`src/core/catalog.ts`, documented in [catalog.md](catalog.md)): unknown ids, fields, parameters, types and ranges come back as issues with JSON paths and "did you mean" hints.

```bash
npx -y @fleox/agent3d@0.4.0 scene validate --project my-scene --json
npx -y @fleox/agent3d@0.4.0 scene validate --file candidate.json --json
```

This page documents every field once, in the order a scene is usually built. Catalog parameters (geometry sizes, behaviour speeds, generator options, post-effect settings…) are not repeated here: `agent3d catalog <section> [id]` and [catalog.md](catalog.md) list them with types, ranges and defaults.

## Contents

1. [Conventions](#conventions) · [A complete minimal scene](#a-complete-minimal-scene) · [Top level](#top-level)
2. [Target](#target) — placement on the page, budgets, accessibility, [quality tiers](#quality-tiers)
3. [Camera](#camera) — controls, look-at, shake, [camera shots](#camera-shots)
4. [Environment](#environment) — background, [sky](#sky), [HDRI](#hdri-backgrounds), image lighting, fog, ground, contact shadows, light rigs, shadow quality
5. [Lights](#lights)
6. [Objects](#objects) — common fields, kinds, [geometry](#geometry), [instances](#instances)
7. [Materials and textures](#materials-and-textures)
8. [Text and logos](#text-and-logos) — fonts, layout, outline, letters, reveal, SVG
9. [Models](#models) — glTF files, library models, animation clips, morph targets · [Photo (3D photo)](#photo-3d-photo) — an image + depth map
10. [Generators and particles](#generators-and-particles)
11. [Behaviours](#behaviours)
12. [Timeline](#timeline) — tracks, eases, relative values, stagger, markers, segments, scroll scrubbing
13. [Interactions](#interactions) — no-code triggers and `openUrl`
14. [Post effects](#post-effects)
15. [Physics](#physics) — world, bodies, joints
16. [Scripts, HUD and audio](#scripts-hud-and-audio)
17. [Data bindings](#data-bindings)
18. [Issues](#issues) · [Project files around the scene](#project-files-around-the-scene)

## Conventions

- **Units** ≈ metres, **Y is up**; the camera looks at `camera.target`.
- **Angles are in degrees** everywhere (rotations, `fov`, spot `angle`, behaviour speeds and angular velocities in deg/s).
- **Colours** are CSS strings: `"#rrggbb"`, `"#rgb"`, `"rgb(…)"`, `"hsl(…)"` or a CSS name.
- **Asset paths** are project-relative (`"assets/models/fox.glb"`) or built-in library references (`"library:models/nature/pine-tree.glb"`, see `agent3d assets library`).
- **Time** is in seconds.
- **Ids** match `[a-zA-Z][a-zA-Z0-9_-]*` and are unique across the whole scene: objects (children included) **and** lights share one namespace.

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
| `target` | TargetDef | Where and how the scene is shown on a page — [Target](#target) |
| `camera` | CameraDef | [Camera](#camera) |
| `environment` | EnvironmentDef | Background, image-based lighting, fog, ground, rigs, shadows — [Environment](#environment) |
| `lights` | LightDef[] | [Lights](#lights) |
| `objects` | ObjectDef[] | The scene graph (objects can have `children`) — [Objects](#objects) |
| `timeline` | TimelineDef? | Keyframes, markers, segments, scroll scrubbing — [Timeline](#timeline) |
| `interactions` | InteractionDef[]? | Click / hover / scroll / key → play segments, set properties, open URLs — [Interactions](#interactions) |
| `postfx` | PostFxDef[]? | Post effects and look presets — [Post effects](#post-effects) |
| `physics` | PhysicsWorldDef? | Rigid-body world: gravity, step, materials, layers, joints, debug — [Physics](#physics) |
| `scripts` | string[]? | Project paths of script modules (`"scripts/game.js"`) — [Scripts](#scripts-hud-and-audio) |
| `ui` | UiDef? | HUD elements (games, interactive scenes) |
| `audio` | AudioDef? | Named sounds and music |
| `data` | object? | Free-form data: scripts read it as `api.data`; also the values of `{data.key}` placeholders — [Data bindings](#data-bindings) |
| `ariaLabel` | string? | Accessible label of the element (defaults to `title`) |
| `seed` | number? | Seed of every random process (generators, particles, `api.random`) |

## Target

```json
"target": { "kind": "banner", "aspect": "4:1", "posterTime": 2, "reducedMotion": "static", "budgetKb": 600 }
```

| Field | Default | Meaning |
|---|---|---|
| `kind` | (required) | `banner`, `hero`, `card`, `square`, `fullscreen`, `inline`, `game` — sets defaults, budgets and the accessibility role |
| `aspect` | (required) | `"W:H"`; the embed keeps it responsively. `agent3d new` uses banner 4:1, hero / inline / fullscreen / game 16:9, card 4:5, square 1:1 |
| `height` | | Fixed CSS height (`"320px"`, `"60vh"`, `"20rem"`) instead of the aspect ratio |
| `budgetKb` | banner / square / inline 600, card 400, hero 1500, fullscreen / game 4000 | Max export weight (runtime excluded); `check` warns above |
| `transparent` | false | Transparent canvas: the page shows through (background ignored) |
| `lazy` / `pauseOffscreen` | true / true | Start when visible; pause when scrolled away |
| `maxDpr` | 2 | Cap of the device pixel ratio |
| `reducedMotion` | `static` (games: `ignore`) | For visitors who prefer reduced motion: `static` freezes on `posterTime` with entrance effects (`appear`, text `reveal`) shown finished, `slow` halves speeds, `ignore` plays normally |
| `posterTime` | 0 | Time of the poster frame and the reduced-motion still. Pick a time after every entrance (delay + duration) — starters use 1.5 |
| `antialias` | true | |
| `shadows` | true when a light casts shadows | Shadow maps on / off |
| `toneMapping` / `exposure` | `aces` / 1 | `none`, `aces`, `agx`, `neutral`, `reinhard` |
| `quality` | `auto` | Rendering tier: `auto`, `low`, `medium`, `high`, `ultra` (below) |

### Quality tiers

| Tier | DPR cap | MSAA | Post effects |
|---|---|---|---|
| `low` | 1 | off | `high`-cost effects (`ao`, `dof`) off, heavy effects at half resolution, ≤ 4 still samples |
| `medium` | 1.5 | 4× | all effects, heavy ones at half resolution |
| `high` | `maxDpr` (2) | 4× | all effects, heavy ones at half resolution, more samples |
| `ultra` | `maxDpr` | 8× | full-resolution effects, most samples, ≤ 64 still samples |

`auto` picks `high` on desktops, `medium` on phones / small GPUs and `low` on software GL, then adapts while playing: if the frame rate stays under 40 fps for 3 s it lowers the pixel ratio (down to 1), then the tier (never back up). Deterministic renders (`agent3d render`, posters, videos) use `high` unless the tier is explicit. `agent3d check` reports the post-processing GPU cost (`budget.gpu`) and warns about heavy effects on games. (The element's `quality` attribute is a separate, page-side pixel-ratio cap: see [export.md](export.md#the-agent3d-scene-element).)

## Camera

```json
"camera": { "type": "perspective", "fov": 30, "position": [0, 0, 12], "target": [0, 0, 0], "controls": "parallax", "parallax": { "strength": 0.3, "smoothing": 0.92 } }
```

| Field | Meaning |
|---|---|
| `type` | `perspective` (`fov` in degrees, default 45) or `orthographic` (`zoom`: world units visible vertically, default 10) |
| `position`, `target` | Camera position and look-at point (default origin) |
| `near`, `far` | Clipping planes |
| `controls` | `none` (fixed, default), `orbit` (drag), `parallax` (drifts with the pointer), `scroll` (follows `scrollPath` with the page scroll), `follow` (games: tracks `follow.target`) |
| `orbitZoom`, `orbitLimits` | `orbit`: wheel / pinch zoom (default on); `{ minDistance, maxDistance, minPolar, maxPolar, minAzimuth, maxAzimuth }` (degrees; polar 0 = from above, azimuth 0 = camera on +Z, 90 = +X) |
| `parallax` | `{ strength, smoothing }` |
| `scrollPath` | `[{ position, target? }, …]` for `controls: "scroll"` |
| `follow` | `{ target: "<objectId>", offset, smoothing, lookAhead }` |
| `autoRotate` | Degrees per second around the target (with `none` or `orbit`) |
| `lookAt` | An object id the camera keeps looking at (its world position replaces `target`) |
| `shake` | Handheld noise `{ amount (units, default 0.03), rotation (degrees, default 0.4), speed (default 0.5), seed }` |
| `shots` | Cinematic moves on the timeline clock (below) |

### Camera shots

```json
"camera": {
  "type": "perspective", "fov": 40, "position": [0, 1, 10], "target": [0, 0.5, 0],
  "shake": { "amount": 0.02, "rotation": 0.25, "speed": 0.4 },
  "shots": [
    { "type": "pushIn", "at": 0, "duration": 2, "distance": 2.5 },
    { "type": "path", "at": 2, "duration": 2.5, "points": [[2.5, 1.6, -1.2], [2.8, 1.7, -2]], "lookAt": "knot" },
    { "type": "focus", "at": 3, "duration": 1, "object": "knot" },
    { "type": "crane", "at": 8, "duration": 2, "height": 2.5, "distance": -2 }
  ]
}
```

Shots run on the timeline clock (scroll-driven with `trigger: "scroll"`; scene time without a timeline), in `at` order, each from the pose the previous ones left (overlaps blend). Every shot has `type`, `at` (start, s), `duration` and `ease` (default `inOutCubic`, any [timeline ease](#eases)).

| `type` | Fields |
|---|---|
| `dolly` / `pushIn` / `pullOut` | Along the view axis by `distance` (pushIn default: 25 % closer) |
| `truck` | Sideways by `distance` |
| `pedestal` | Up / down by `distance` (the target follows) |
| `crane` | Rises by `height` while the target stays; `distance` moves toward it |
| `orbit` | Around the target: `angle` (yaw, degrees), `elevation` (degrees), `distance` |
| `zoom` | `fov` |
| `move` | To `position` / `target` / `fov` |
| `path` | Catmull-Rom through `points`, looking `lookAhead` ahead (0..0.5 of the path, default 0.05) or at `lookAt` (an object id or a point) |
| `lookAt` | Pan to `object` (or `target`) |
| `focus` | Rack focus: postfx `dof` focus → `focus` distance or the distance to `object` |

Camera timeline tracks (`camera.position`, …) apply after the shots.

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

### Background

| Form | Meaning |
|---|---|
| `"#14102a"`, `"transparent"` | A colour, or no background (see also `target.transparent`) |
| `{ "gradient": [colours], "angle": deg, "grain": 0..1 }` | Linear gradient (0° = bottom → top); `grain` adds visible film grain |
| `{ "radial": [centre, edge], "center": [x, y], "radius": n, "grain": 0..1 }` | Radial gradient (`center` in 0..1, default `[0.5, 0.5]`) |
| `{ "meshGradient": [2–6 colours], "speed": 0.15, "scale": 1, "seed": 1, "grain": 0.035 }` | Soft Stripe-like colour blobs filling the frame, drifting when `speed` > 0 |
| `{ "sky": { … } }` | Gradient or physical sky (below) |
| `{ "hdri": path, … }` | Equirect photo (below) |

### Sky

A **colour-gradient sky**: `top`, `horizon`, `bottom`, `sun: { direction | elevation + azimuth, color, size } | false`, `stars` (count).

A **physical sky** (Preetham atmosphere) when `preset` (`sunrise`, `morning`, `noon`, `afternoon`, `golden-hour`, `sunset`, `dusk`) or `physical: true` is set. Its sun (`sun.elevation` degrees above the horizon, `sun.azimuth` degrees, 0 = towards the default camera at +Z, 90 = +X) also adds a matching directional **sun light** (warmer and dimmer near the horizon; `sun.light: false` skips it; `sun.intensity`, `sun.color`, `sun.castShadow` — default true) and lights the scene through `lighting: "sky"` (the default with a physical sky). Tuning: `turbidity` (haze, 1..20), `rayleigh` (blue scattering, 0..4), `mieCoefficient`, `mieDirectionalG`, `exposure` (default 1: a multiplier of the preset's own exposure — every preset is tuned to look rich with ACES / AgX at 1; 0.7 for deeper colours, 1.3 for a brighter sky), `clouds` (0..1), `stars`.

```json
"environment": {
  "background": { "sky": { "preset": "golden-hour", "sun": { "azimuth": 215 } } },
  "fog": { "density": 0.025, "height": 1, "falloff": 0.25 }
}
```

### HDRI backgrounds

`{ "hdri": path, "blur": 0..1, "intensity": n, "rotation": deg, "groundProjection": true | { "height": 2, "radius": 60 } }`: an equirect photo (`.hdr`, `.exr` or `.jpg`). `rotation` turns it around Y (and the image lighting derived from it); `groundProjection` projects its lower half on a ground disc (`height` = camera height of the photo in scene units) so objects stand inside the photo.

Bundled HDRIs (`library:hdri/<name>.hdr` for lighting and blurred backgrounds, `.jpg` previews): `softbox` (product studio), `studio`, `warehouse`, `forest`, `city` (overcast street), `beach` (sunny), `sky`, `sunset`, `night`, `night-city`.

### Lighting, fog, ground

| Field | Meaning |
|---|---|
| `lighting` | Image-based lighting (reflections and fill): `studio`, `soft`, `sunset`, `night`, `neutral`, `sky` (from the background sky or mesh gradient), `none`, or `{ "hdri": path, "intensity": n, "rotation": deg }`. Without it, an HDRI background lights the scene, a physical sky uses `sky`, anything else `soft` |
| `lightingIntensity` | Scales the image lighting |
| `fog` | Linear `{ color, near, far }`, exponential `{ color, density }`, or **height fog** `{ color, density, height, falloff }` (thick below `height`, thinning above with `falloff` — valleys and ground haze while hills and sky stay clear). Without `color`, fog takes the physical sky's horizon haze, the gradient sky's `horizon` or the background colour, and the physical sky blends its horizon into it so fogged ground meets the sky seamlessly |
| `ground` | A plane at `y`: `size`, `color`, `roughness`, `grid`, `opacity`, `shadowOnly` (only catches shadows so objects sit on the page; those shadows fade toward the plane's edges and the last ~15 % before the canvas edges; `opacity` = shadow darkness, default 0.28; a smaller `size` keeps them closer to the object) |

### Contact shadows, light rigs, shadow quality

| Field | Meaning |
|---|---|
| `contactShadows` | `true` or `{ "opacity": 0.6, "blur": 2.5, "far": 1.5, "y": n, "size": n, "center": [x, z], "resolution": 512, "color": "#000", "frames": 0 }` — soft blurred shadows right under the objects (product shots), no shadow-casting light needed. The plane is fitted to the solid objects (particles / points ignored) and fades out radially; it is centred on them (also with an explicit `size`) unless `center` places it; `far` = how high above the plane (scene units) the shadow reaches: the darkness fades from full at the plane to nothing at `far`. Default ≈ 0.9 × the height of what stands on the plane (meshes touching it), so a title floating above a product doesn't count; meshes whose bottom is higher than 0.6 × `far` above the plane never cast (floating objects leave no smudge). Raise `far` for a taller, softer shadow, lower it for a tight contact line; `frames` = re-render every frame (0, default) or only the first N (`1` for static scenes, cheaper) |
| `rig` | A light rig from the catalog (`agent3d catalog lightRigs`): `studio-3point`, `softbox`, `product-top`, `rim`, `dramatic`, `golden-hour`, `noon`, `overcast`, `neon`, `moonlight` — or `{ "preset": "softbox", "intensity": 1, "rotation": deg, "scale": 1, "castShadow": true, "color": tint }`. Its lights are added to `lights` (positions assume a subject ~1–3 units around the origin; `scale` for bigger scenes) |
| `shadows` | Shadow-map quality for every shadow-casting light: `{ "type": "pcf" \| "vsm", "softness": 3, "mapSize": 2048, "intensity": 1 }` (`vsm` = smooth blurred shadows; `softness` 0 = hard). Directional shadow cameras are fitted to the scene automatically |

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
  { "id": "rim", "type": "point", "position": [-5, 2, -3], "color": "#ffb366", "intensity": 30, "distance": 20 },
  { "id": "beam", "type": "spot", "position": [0, 6, 2], "target": [0, 0, 0], "angle": 25, "penumbra": 0.4, "volumetric": true },
  { "id": "strip", "type": "rect", "position": [0, 3, -2], "width": 4, "height": 0.3, "color": "#ff3d8b", "intensity": 8, "panel": true }
]
```

| Field | Lights | Meaning |
|---|---|---|
| `id` | all | Optional; unique with the object ids (timeline targets, gizmos) |
| `type` | all | `ambient`, `directional`, `point`, `spot`, `hemisphere`, `rect` |
| `color`, `intensity`, `position`, `target` | all | `target` = aim point of directional / spot / rect lights |
| `castShadow`, `shadow` | directional, point, spot | `shadow`: `{ softness, mapSize, bias, normalBias, intensity }`, overriding `environment.shadows` |
| `skyColor`, `groundColor` | hemisphere | |
| `distance`, `decay` | point, spot | |
| `angle` (degrees), `penumbra`, `volumetric` | spot | `volumetric`: `true` or `{ intensity, length, color }` — a cheap glowing cone from the light to its target (beams in fog, stages) |
| `width`, `height`, `panel` | rect | Area light (lights standard / physical materials only); `panel: true` draws the glowing rectangle itself, visible in the frame and in reflections |
| `behaviours` | all | e.g. `flicker` |

A scene with lit materials and neither lights nor environment lighting renders black: `scene validate` warns.

## Objects

Common fields (every kind):

| Field | Meaning |
|---|---|
| `id` | Unique id (see [Conventions](#conventions)) |
| `kind` | `mesh`, `text`, `svg`, `model`, `photo`, `group`, `generator`, `particles`, `instances` |
| `name` | Display name (Studio outliner) |
| `position`, `rotation`, `scale` | Transform; `rotation` in degrees (XYZ order); `scale` a number or `[x, y, z]` |
| `visible`, `castShadow`, `receiveShadow` | |
| `children` | Nested objects (transforms are relative to the parent) |
| `behaviours` | [Behaviours](#behaviours) |
| `tags` | Labels for scripts (`api.findByTag`) and timeline selectors (`tag:<tag>`) |
| `body` | Physics body — [Physics](#physics) |
| `href` | Clicking the object (or a child) opens this URL, pointer cursor; never in headless renders. `javascript:` URLs are refused; cross-origin URLs open in a new tab. For http(s)-only links with `newTab` control use an `openUrl` [interaction](#interactions) |
| `userData` | Free data scripts read and write (`obj.userData`) |
| `attach` | `"camera"` (top-level objects only): the object rides with the camera. `position` / `rotation` are then in **camera space** — x right, y up, **-z forward**: `[0, -1.2, -6]` sits 6 units in front of the lens, a little below the centre. Captions, chapter labels and HUD-like 3D text stay on screen while the camera moves (timeline tracks, shots, scroll stories, parallax). Timeline tracks on the object animate it in camera space too. `check` warns when z ≥ -0.2 (behind / inside the lens) |

| `kind` | Specific fields | See |
|---|---|---|
| `mesh` | `geometry`, `material` | [Geometry](#geometry), [Materials](#materials-and-textures) |
| `text` | `text`, `font`, `size`, `depth`, `bevel`, `align`, `letterSpacing`, `lineHeight`, `kerning`, `maxWidth`, `curveSegments`, `outline`, `splitLetters`, `reveal`, `material` | [Text and logos](#text-and-logos) |
| `svg` | `src`, `size`, `fit`, `depth`, `bevel`, `keepColors`, `strokes`, `curveSegments`, `layerGap`, `material` | [Text and logos](#svg-logos-and-icons) |
| `model` | `src`, `fit`, `center`, `animation`, `morph`, `material` | [Models](#models) |
| `photo` | `src`, `depth`, `mode`, `width`, `height`, `strength`, `focus`, `segments`, `layers`, `edgeCut`, `occlude`, `motion`, `material`, `effects` | [Photo (3D photo)](#photo-3d-photo) |
| `group` | only `children` | |
| `generator` | `generator`, `params`, `seed`, `material` | [Generators](#generators-and-particles) |
| `particles` | `preset` + overrides | [Particles](#particles) |
| `instances` | `geometry`, `material`, `layout`, `colors` | [Instances](#instances) |

### Geometry

`"geometry": { "type": "<id>", …params }` with the catalog's parameters (sizes in units): `box`, `roundedBox`, `sphere`, `cylinder` (`radiusTop`, `radiusBottom`, `height`), `cone`, `capsule`, `torus`, `torusKnot`, `plane` (faces +Z: rotate `[-90, 0, 0]` for a floor), `circle`, `ring`, `icosahedron`, `dodecahedron`, `octahedron`, `tetrahedron`, `lathe` (`points` profile), `extrude` (`shape` polygon), `tube` (`points` curve). Each has a triangle cost formula used by `check`.

```json
{ "id": "pedestal", "kind": "mesh", "geometry": { "type": "cylinder", "radiusTop": 1.2, "radiusBottom": 1.3, "height": 0.4 }, "material": { "preset": "marble" }, "position": [0, -0.2, 0] }
```

### Instances

One `geometry` + `material` drawn many times in a single draw call:

| `layout.type` | Fields |
|---|---|
| `grid` | `count: [x, y, z]`, `spacing: [x, y, z]` |
| `scatter` | `count`, `area: [x, y, z]`, `minScale`, `maxScale`, `randomRotation`, `seed` |
| `circle` | `count`, `radius` |
| `list` | `items: [{ position?, rotation?, scale? }, …]` |

`colors` (list) is cycled per instance.

```json
{ "id": "dots", "kind": "instances", "geometry": { "type": "sphere", "radius": 0.08 }, "material": { "preset": "neon" },
  "layout": { "type": "scatter", "count": 120, "area": [12, 3, 4], "seed": 3 }, "colors": ["#ff3d8b", "#4dd2ff"] }
```

## Materials and textures

```json
"material": { "preset": "gold", "roughness": 0.25 }
```

| Field | Meaning |
|---|---|
| `preset` | `agent3d catalog materialPresets`: plastic, matte, clay, chrome, brushedMetal, gold, copper, glass, frostedGlass, rubber, pearl, holographic, neon, toon, flat, lowpoly, velvet, wireframe, normal, and the photoreal set carPaint, ceramic, marble, terrazzo, wood, carbonFiber, leather, satin, silk, brushedAluminium, ice, water, diamond, gem, jelly, chromeGradient, soapBubble, mattePastel, emissiveGradient. Explicit fields override it |
| `type` | `standard`, `physical`, `basic`, `lambert`, `toon` (cel bands on the direct light, environment fill kept, so the lit band shows the colour as given; `roughness` default 0.75), `normal`, `matcap`, `gradient` (`gradient: [colours]`: vertical ramp in object space; `gradientEmissive: true` makes the ramp drive the glow too), `shader` (`shader: <catalog id>`, `uniforms`) |
| `color`, `metalness`, `roughness`, `emissive`, `emissiveIntensity`, `opacity`, `transparent`, `wireframe`, `flatShading`, `side` (`front`, `back`, `double`) | Common |
| `envMapIntensity` | Reflection strength of the environment lighting |
| `transmission`, `thickness`, `ior`, `dispersion` (0..10, rainbow fire in gems), `attenuationColor`, `attenuationDistance` | Physical: glass, liquids, gems, jelly |
| `clearcoat`, `clearcoatRoughness`, `sheen`, `sheenColor`, `sheenRoughness`, `iridescence`, `iridescenceIOR`, `iridescenceThicknessRange` (`[nm, nm]`), `anisotropy` + `anisotropyRotation` (degrees), `specularIntensity`, `specularColor` | Physical surface layers |
| `map`, `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `emissiveMap`, `bumpMap`, `displacementMap`, `alphaMap` | Textures: a path / library id, or a procedural texture (below) |
| `normalScale`, `bumpScale`, `aoMapIntensity`, `displacementScale`, `repeat: [u, v]` | Texture scales |
| `triplanar` | `true` or a scale (repeats per unit): projects `map`, `roughnessMap`, `metalnessMap`, `emissiveMap` and `normalMap` along the object's axes instead of its UVs (generators, terrain, stretched cylinders). The marble and terrazzo presets use it |

Physical fields need `"type": "physical"` (or a preset that is physical: glass, carPaint, gem…); `scene validate` warns when one is set on another type.

**Procedural textures**: `{ "procedural": "<id>", …params }` in any texture slot (`agent3d catalog textures`: marble, wood, terrazzo, carbon, noise, voronoi, flakes, brushed, grid, checker, stripes, dots) — generated at load time, seamless, zero bytes. Colour slots use its `colors`; data slots use the pattern's height; `normalMap` derives normals from it.

```json
"material": { "type": "physical", "color": "#ffffff", "roughness": 0.3, "map": { "procedural": "wood", "rings": 14 }, "bumpMap": { "procedural": "wood", "rings": 14 }, "bumpScale": 0.3, "clearcoat": 0.6 }
```

**Shaders**: `{ "type": "shader", "shader": "aurora", "uniforms": { "speed": 0.5 } }` — `agent3d catalog shaders` lists the shaders (plasma, waves, noise, hologram, gradientFlow, toonRim, dissolve, gradientMesh, aurora, liquidChrome, nebula, caustics, fresnelGlow, iridescentFoil, lavaLamp, grainGradient, matrixRain) and their uniforms; timeline tracks animate them as `material.uniforms.<name>`.

## Text and logos

```json
{ "id": "title", "kind": "text", "text": "Launch day", "font": "inter-black", "size": 1, "depth": 0.25,
  "outline": { "width": 0.05, "color": "#120d2b" },
  "reveal": { "effect": "rise", "stagger": 0.05, "duration": 0.7, "delay": 0.2, "order": "forward" } }
```

| Field | Default | Meaning |
|---|---|---|
| `text` | (required) | `"\n"` breaks lines; may hold `{data.key}` placeholders |
| `font` | `sans-bold` | Catalog font id, or a project path to a three.js typeface JSON (below) |
| `size` | 1 | Cap height in units |
| `depth` | 0.2 | Extrusion; `0` = crisp flat (double-sided) lettering |
| `bevel` | `min(depth × 0.3, size × 0.035)` | Keeps the letter silhouette (half inset, half outset) with smooth normals |
| `align` | `center` | `left`, `center`, `right` — the text block is centred on its position, `align` places every line |
| `letterSpacing` | 0 | Units added between characters (negative tightens), on top of kerning |
| `lineHeight` | 1.25 | Multiple of the font size |
| `kerning` | true | The font's kerning pairs (accented letters are kerned like their base letter) |
| `maxWidth` | | Wrap lines on spaces at this width (units) |
| `curveSegments` | grows with `size` | Max points per glyph curve |
| `outline` | | `true` or `{ "width", "color" (default #111111), "depth", "material" }`: a recessed back layer — the glyphs offset outwards by `width` (default `size × 0.06`), behind the face (sticker / comic-title look) |
| `splitLetters` | false | Each glyph becomes a child object `"<id>/<n>"` (n = 0, 1, … counting non-space characters, line after line), pivoting on its own centre, with its own material: timeline tracks can target `"title/0.position.y"`, `"title/3.rotation"`, `"title/2.material.color"`, or all letters with `children:title` |
| `reveal` | | Per-letter staggered entrance (implies `splitLetters`), on the scene clock (deterministic; shown finished under reduced motion like `appear`) |
| `material` | | Face material |

`reveal`: `effect` (`rise` default, `fade`, `scale`, `spin`, `drop`), `stagger` (0.04 s between letters), `duration` (0.6 s per letter), `delay` (0), `ease` (any [timeline ease](#eases); default `outCubic`, `outBack` for scale / spin), `order` (`forward`, `reverse`, `center`, `random` — deterministic).

**Fonts** (`agent3d catalog fonts`): `sans-bold` (Inter Bold, default), `sans` (Inter), `inter-black`, `montserrat-extrabold`, `space-grotesk-bold`, `bebas-neue`, `anton` (condensed display), `serif-bold` / `serif` (Playfair Display), `mono` (JetBrains Mono Bold), `display` (Fredoka SemiBold, rounded), `pacifico`, `lobster` (scripts). All OFL-1.1 (credited in exports), subset to Latin-1 (accents work), shipped in the library and copied into exports only when used. A brand font: convert it with `scripts/convert-font.mjs` and set `"font": "assets/fonts/brand.typeface.json"`.

### SVG logos and icons

```json
{ "id": "logo", "kind": "svg", "src": "assets/svg/logo.svg", "size": 3, "depth": 0.15, "bevel": 0.01 }
```

| Field | Default | Meaning |
|---|---|---|
| `src` | (required) | Inline SVG markup or a project path to an `.svg` |
| `size`, `fit` | 2, `width` | `size` sets the width; `fit: "height"` / `"max"` sets the height / larger side instead. The logo is centred on its position |
| `depth`, `bevel` | 0.2 | Extrusion (0 = flat) and bevel of the fills |
| `keepColors` | `true` without `material`, `false` with one | Each path keeps its SVG colour; `true` + a material = that material's finish with the SVG colours. Gradient paints use the mix of their end stops |
| `strokes` | true | Strokes (`stroke-width`, `stroke-linejoin`, `stroke-linecap`, `stroke-miterlimit`) become solid outlines — line-icon sets (`fill="none" stroke="currentColor"`) work, `currentColor` taking the material colour |
| `curveSegments` | 12 | Points per curve (curves are sampled by length: large circles stay round) |
| `layerGap` | `depth × 0.02` | Later paths sit this far in front (painter's order) |

Paths, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `line`, `use`, nested transforms and `<style>` classes are read; `fill-rule` (`nonzero` / `evenodd`) and holes are honoured. `<text>` is not supported: convert text to outlines in the design tool.

## Models

```json
{ "id": "robot", "kind": "model", "src": "library:models/characters/robot.glb", "fit": 2,
  "animation": { "clip": "Idle", "loop": true, "crossfade": 0.3 }, "position": [0, 0, 0], "rotation": [0, 20, 0] }
```

| Field | Default | Meaning |
|---|---|---|
| `src` | (required) | `.glb` / `.gltf` project path or `library:<id>` (`agent3d assets library --kind model` lists ids, sizes, triangle counts and clip names) |
| `fit` | | Scale the model so its largest dimension equals this size (units) — library and downloaded models come in arbitrary units |
| `center` | true | Move the model so its bounding-box bottom centre sits at the object's origin |
| `animation` | | `{ clip (name or index), loop, speed, crossfade (s), offset (start time in the clip, s), blend: { "<clip>": weight } }` — `blend` plays extra clips at once with weights 0..1, animatable as `<id>.animation.<clip>.weight` |
| `morph` | | Morph-target influences by name `{ "Smile": 0.6 }`, animatable as `<id>.morph.<name>` |
| `material` | | Overrides every material of the model (a colour, a preset…) |

Interactions switch clips with `playClip`, scripts with `obj.playAnimation(clip)`. Check a new model's orientation and size with `agent3d render --isolate <id>`. Library models are CC0 except a few CC-BY-4.0 ones (`models/products/sneaker.glb`, `iridescent-lamp.glb`, `velvet-sofa.glb`, the animated fox) whose credit `check` reports and exports write to `CREDITS.txt` — see [assets.md](assets.md).

Compressed models: `.glb` files with `EXT_meshopt_compression` (made by `assets optimize`) and `EXT_texture_webp` load as is; Draco-compressed models are not supported.

## Photo (3D photo)

A 2D image given depth by a **depth map**: the picture moves in 3D with the pointer, the scroll, the phone's gyroscope or an automatic drift — the "3D photo" / parallax-photo effect for heroes and banners.

```json
{ "id": "street", "kind": "photo", "src": "assets/textures/street.jpg", "depth": "assets/depth/street-depth.png",
  "mode": "parallax", "width": 6, "strength": 0.35, "focus": 0.5,
  "motion": { "pointer": 1, "scroll": 0.2, "auto": "sway", "speed": 1 } }
```

| Field | Default | Meaning |
|---|---|---|
| `src` | (required) | The image: `.jpg` / `.jpeg` / `.png` / `.webp` project path or `library:<id>` |
| `depth` | | The depth map (same rules as `src`, same aspect ratio as the image). Without it the photo is flat (`validate` warns) |
| `mode` | `parallax` | `parallax`: one flat quad with shader parallax (relief mapping) — the 3D-photo look for small motions. `mesh`: a displaced grid that survives larger camera moves. `layers`: the photo cut into depth slices, a pop-up-book look |
| `width`, `height` | 4, from the image aspect | World size in units. With only `width`, the height follows the image; both set override the aspect |
| `strength` | 0.5 | Depth effect amount, 0..1 (parallax holds up to ~0.9; mesh ~0.7 with the photo a bit wider than the frame; layers ~0.6) |
| `focus` | 0.5 | The depth (0 = far … 1 = near) that stays still while the view moves |
| `segments` | 256 | `mesh` only: grid cells on the long side, 8..1024 (integer) |
| `layers` | 6 | `layers` only: number of slices, 2..16 (integer) |
| `edgeCut` | 0.08 | `mesh` / `layers`: hide stretched edges where the depth jumps more than this (0..1; 0 = off) |
| `occlude` | false | 3D inside the photo: the photo writes the true depth of its pixels, so 3D objects placed between its depth planes are hidden by its nearer parts, and its motion moves the real camera so they slide with the photo (below). A no-op without other objects; ignored on a flat photo |
| `motion` | | What moves the view (combined): `pointer` (0..1, default 1), `scroll` (0..1, default 0), `gyro` (phones, default true when `pointer` > 0), `auto` (`sway` default, `orbit`, `zoom`, `none`: a looping drift used in headless renders, videos and on touch screens), `speed` (cycles per 10 s), `smoothing` (0..1) |
| `material` | | Only `opacity`, `color` (tint) and `emissiveIntensity` (photos are unlit); other material fields are ignored with a warning |
| `effects` | | Depth-driven effects: `fog`, `light`, `reveal` ([below](#photo-effects)) |

### Photo effects

`effects` adds depth-driven effects to the photo, applied to the texel the parallax finds (every mode: `parallax`, `mesh`, `layers`; the photo-only lite runtime too). Each effect is an object; `{}` takes the defaults. They are deterministic (time = the player clock), so renders and videos are reproducible.

```json
"effects": {
  "fog":    { "color": "#dfe8f2", "amount": 0.6, "start": 0.7, "end": 0, "drift": 0.3 },
  "light":  { "color": "#ffe2b0", "intensity": 1, "ambient": 0.75, "position": [0.4, 0.4], "height": 0.6, "radius": 0.8, "relief": 1, "specular": 0.25, "follow": "pointer" },
  "reveal": { "progress": 1, "from": "far", "softness": 0.15, "duration": 2, "delay": 0.3 }
}
```

| Effect | Param | Default | Meaning |
|---|---|---|---|
| `fog` | `color` | `#ffffff` | Haze colour (match the sky: a cool grey-blue at dusk, warm at sunset) |
| | `amount` | 0.6 | Maximum fog opacity, 0..1 |
| | `start` | 0.7 | Depth (0 far … 1 near) where the fog starts: everything farther fades into it |
| | `end` | 0 | Depth fully fogged (`start` > `end`: distance haze) |
| | `drift` | 0.3 | Speed of the drifting wisps (0 = static) |
| `light` | `color` | `#ffffff` | Light colour |
| | `intensity` | 1 | Light strength |
| | `ambient` | 0.75 | Share of the original photo left unlit (lower = darker surroundings, a stronger flashlight) |
| | `position` | [0.4, 0.4] | Light position over the photo, `[x, y]` in -1..1 (right / top = 1): the fixed position (`follow: "none"`) and the start of the auto path |
| | `height` | 0.6 | Height above the photo: lower rakes the relief more |
| | `radius` | 0.8 | Size of the light pool |
| | `relief` | 1 | Strength of the normals derived from the depth map |
| | `specular` | 0.25 | Glints on the relief, 0..1 |
| | `follow` | `pointer` | `pointer`: the light follows the pointer, and a slow deterministic path (around `position`) when there is none (headless renders, touch screens); `auto`: that path only; `none`: fixed at `position` |
| `reveal` | `progress` | 1 | 0 = hidden … 1 = fully shown |
| | `from` | `far` | Which depth appears first (`far`: the background, then nearer slices) |
| | `softness` | 0.15 | Width of the slice edge (depth units) |
| | `duration` | | Seconds: when set, `progress` animates 0 → 1 by itself from `delay` (`progress` is then ignored) |
| | `delay` | 0 | Seconds before the reveal starts |

- `fog` and `reveal` need a depth map (ignored on a flat photo, `validate` says so); `light` also works on a flat photo (flat surface, a pool of light).
- The light keeps the photo's colours (it scales them) and never clips highlights to white. Reduced motion: the light stays at `position` and a timed `reveal` is shown finished.
- A timed `reveal` hides the photo at t = 0: set `target.posterTime` after `delay + duration` so posters show the photo.
- Two photos stacked (same size and position, the top one with `reveal`) make a photo-to-photo transition, slice by slice.
- **Timeline**: `<photoId>.effects.<effect>.<param>` animates numbers, colours and the light `position` (`[x, y]` keys, or `.x` / `.y`), e.g. rack the light across with `{ "target": "hero.effects.light.position", "keys": [[0, [-0.9, 0.5]], [4, [0.9, 0.5]]] }` (with `follow: "none"`), or drive `effects.reveal.progress` / `effects.fog.amount`. The effect must be declared on the photo (`{}` is enough). `from` and `follow` are not animatable.

**Depth-map convention.** A grayscale image, **white = near, black = far**, the same aspect ratio as the photo. Its alpha channel, when present, marks depth discontinuities: **alpha 0 = cut edge** (the runtime hides the stretched triangles there in `mesh` / `layers`). Keep it a **PNG**: lossy JPEG / WebP compression adds steps to the relief and drops the alpha mask (`check` reports a JPEG depth map; `assets optimize` only resizes PNG depth maps, losslessly, ~512–1024 px — they are smooth data — and never converts them to a lossy format).

**Workflow.**

1. Add the photo: `agent3d assets add photo.jpg` (or a `library:` image).
2. Estimate its depth map, locally (no account, no network once the model is downloaded): `agent3d assets depth assets/textures/photo.jpg` — it writes `assets/depth/photo-depth.png` and registers it in `assets/manifest.json` with the photo's licence ([assets.md](assets.md#depth-maps-3d-photos)).
3. Add the object: `{ "kind": "photo", "src": "…/photo.jpg", "depth": "assets/depth/photo-depth.png" }` (`object_add` / `agent3d object add`).
4. `agent3d render --count 4 --sheet` (the `auto` drift shows the effect in stills), tune `strength` / `focus` / `mode`.
5. `agent3d check`: `missing-asset` (photo or depth file), `photo-occlude` / `photo-depth-range` (3D objects inside the photo's depth, below), `photo-depth-aspect` (the depth map's aspect differs from the photo's by more than 2 %: regenerate it), `photo-heavy` (photo over 1.5 MB: `agent3d assets optimize <photo>`, which keeps a photo at ≥ 1024 px), `photo-depth-lossy` (JPEG depth map). Triangles: `parallax` 2, `layers` 2 × layers, `mesh` segments × segments × aspect × 2.

### 3D inside the photo

With `"occlude": true` a depth photo is a real 3D backdrop: text, meshes, models and particles can live **between** its depth planes and be hidden by its foreground — a title passing behind the nearest building, snow falling in front of and behind a subject, a 3D logo standing on a table in the picture. The `photo-title-inside` template is a worked example.

```json
{ "id": "photo", "kind": "photo", "src": "assets/textures/street.webp", "depth": "assets/depth/street-depth.png",
  "width": 11.9, "strength": 0.8, "focus": 0.45, "occlude": true },
{ "id": "title", "kind": "text", "text": "OLD TOWN", "size": 0.92, "position": [-0.2, 1.55, 0.12] }
```

**Where the photo's pixels are.** A pixel of depth-map value `d` (0 far … 1 near) sits at the photo's local z:

- `range = strength × width × 0.25` (world units), centred on `focus` (the focus depth is at z = 0, the photo's own position);
- `mesh`: `z = (d − focus) × range`;
- `parallax` / `layers`: `z = D·u / (1 + u)` with `u = (d − focus) × range / D`, D = the distance from the camera to the photo plane — the same as the mesh formula while z is small next to D (this exact form is what makes the motion coherent, below).

You rarely compute it: `scene_summary` (`agent3d scene summary`) gives every depth photo a `depthRange: [zFar, zNear]` (world z of its depth-0 and depth-1 pixels, from the scene's camera), and with `occlude` on, `check` reports the range (`photo-depth-range`). An object at world z is hidden wherever the photo is nearer than z: to put a title "behind the foreground", pick the depth of the subject that should cover it (sample the depth map, or read it off a render), place the title a little farther (smaller z) than that subject and nearer than what should stay behind it. Then render with the pointer at the corners (`render --input '[{"t":0.5,"pointer":[-1,0.7]},{"t":1.5,"pointer":[1,-0.7]}]' --sheet`) and adjust x / y / z until the right part is covered. Particles whose `area` spans the whole depth range fall both in front of and behind the subject. Without `occlude`, `check` reports objects placed inside a depth photo's range (`photo-occlude`, info): they always draw over it.

**Motion.** With `occlude`, the photo's view offset (pointer, gyroscope, scroll, `auto` drift) also moves the real camera parallel to the photo plane, with an off-axis projection that keeps the photo itself still on screen: the photo pixels shift exactly as before, and a 3D object at the z of depth `d` slides exactly like the photo pixels of depth `d` — it stays glued to the facade it sits behind. The `zoom` drift becomes a dolly (approximate unless the photo is centred on the camera). `mesh` mode: the camera move replaces the grid tilt. Only the first occluding photo drives the camera; it is not moved under `camera.controls: "orbit"`. Exact when the camera looks straight at the photo (the usual hero set-up: camera on +z, photo unrotated); an orthographic camera gets the occlusion but no camera move.

**Rendering.** An occluding photo is drawn in the opaque pass (alpha-tested: a PNG / WebP with transparency keeps its cut-out at alpha 0.5), so transparent objects (particles, fading text) depth-test against it. A single photo with `occlude` and nothing else still exports with the lite photo runtime.

## Generators and particles

### Generators

```json
{ "id": "land", "kind": "generator", "generator": "terrain", "seed": 7, "params": { "size": 40, "height": 6 } }
```

Procedural content built at load time, deterministic with `seed` (default: derived from `scene.seed` and the object id), zero bytes: `terrain`, `trees`, `rocks`, `grass`, `flowers`, `water`, `clouds`, `city`, `character`, `planet`, `starfield`, `blob`, `waveGrid`, `maze`, `road`, `floatingIsland`, `globe`, `crystals`, `galaxy`, `bars3d`, `abstractShapes`, `birds`. `agent3d catalog generators <id>` lists each one's `params`.

**Landscapes** are one `terrain` plus scatterers and water, all at the **same `position`** (scatterers with `onTerrain` sit on the terrain sharing their parent, but keep one frame so `area` covers the terrain you see):

- `shape`: `basin` (a lake ringed by mountains — set `waterLevel` ≈ 0.1 × `height`), `valley` (flat floor along z, mountain walls, a range closing the far end — a camera on +z looks down it), `mountains`, `hills`, `island`, `dunes`, `canyon`, `flat`.
- `edgeFalloff` (0..1) sinks the borders smoothly below 0 instead of ending in vertical cut walls (default 0.3 for `mountains`, 0.2 `basin`, 0.15 `valley`).
- `snowHeight` puts snow above an absolute altitude (same units as `waterLevel`), so two terrains of different `height` share one snow line; `snowLine` stays a 0..1 fraction of each terrain's own relief. Trees, grass and flowers stay a little below the snow (a treeline) and out of the water; rocks may sit on snow.
- `waterPlane: false` drops the terrain's own water plane while `waterLevel` keeps shaping the shore and keeping scatterers dry: add a `water` object at `y = waterLevel` for full control of the lake.
- Mirror lakes: a `water` object with `"reflections": true` (+ `reflectivity`, default 0.8) reflects the scene in a planar mirror; keep `waveHeight` / `ripples` low for a calm mirror. Cost: the scene is rendered a second time every frame (half resolution on the `medium` quality tier, off on `low`); deterministic, no extra download. The terrain's own water plane has no reflections: use `waterPlane: false` + a `water` object.

```json
{ "id": "basin", "kind": "generator", "generator": "terrain", "seed": 7,
  "params": { "shape": "basin", "size": 160, "resolution": 160, "height": 34, "lowpoly": false, "waterLevel": 3.5, "waterPlane": false, "snowHeight": 18,
    "palette": ["#9a9378", "#4f6b47", "#36503a", "#6f6a78", "#f6f2f4"] } },
{ "id": "lake", "kind": "generator", "generator": "water", "position": [0, 3.5, 0], "params": { "size": 160, "color": "#34506e", "shallowColor": "#a9bccd", "waveHeight": 0.02, "ripples": 0.35 } },
{ "id": "pines", "kind": "generator", "generator": "trees", "params": { "count": 900, "area": [150, 0, 150], "style": "pine", "minScale": 0.55, "maxScale": 1.15 } },
{ "id": "flock", "kind": "generator", "generator": "birds", "position": [0, 14, -5], "params": { "count": 9, "mode": "drift", "formation": "v", "area": [70, 3, 0], "heading": 12, "speed": 5 } }
```

With a camera at `[0, 5, 22]` looking at `[0, 9, -40]`, a `sunrise` sky and fog `{ "density": 0.016, "height": 7 }`, that is a misty mountain lake at dawn.

`birds` is a flock in one instanced draw call: chevron-shaped birds flapping (and gliding) in the shader, flying a pure function of time — `orbit` around the object, `path` through `points`, or `drift` across `area` along `heading` — in a `loose` cloud or a `v` formation. `road` restyles with `color`, `lineColor`, `curbColors` (one colour = solid curbs), `vergeColor` and `verge: false` (road only, e.g. a neon runner on black).

`material` overrides the main surface of the generators that support it (`blob`, `rocks`, `terrain`, `planet`, `floatingIsland`, `globe`, `crystals`, `bars3d`, `abstractShapes`; the catalog entry says which part) — e.g. `{ "type": "shader", "shader": "gradientFlow" }` on a blob keeps its morph. Without a colour / preset / map, lit materials keep the generator's own vertex colours. Generators that publish collision boxes (the maze with `bodies: true`) get a static compound body.

### Particles

```json
{ "id": "sparkles", "kind": "particles", "preset": "magic", "count": 120, "area": [8, 3, 2], "color": ["#ffd166", "#ff7ab6"] }
```

`preset` (`agent3d catalog particlePresets`: stars, snow, rain, fireflies, confetti, sparks, dust, bubbles, embers, hearts, magic, smoke, fire, petals, leaves, galaxyDust, bokeh) and overrides: `count`, `area` (emission box), `size`, `color` (one or a list), `speed`, `direction`, `spread` (0..1), `lifetime`, `opacity`, `blending` (`normal` / `additive`), `shape` (`soft` default, `point`, `square`, `circle`, `star`, `spark`, `streak` (velocity-stretched), `heart`, `bubble`, `smoke`, `petal`, `leaf`, `ring`), `seed`. All motion is a pure function of time (deterministic).

## Behaviours

```json
"behaviours": [
  { "type": "float", "amplitude": 0.1, "speed": 0.3 },
  { "type": "hoverScale", "scale": 1.1 },
  { "type": "appear", "effect": "rise", "duration": 1, "delay": 0.2 }
]
```

Procedural animation and interaction on objects and lights: `type` (catalog id), `when` (`always` default, `hover`, `click`, `visible`, `scroll`), `delay` (s), and the behaviour's parameters ([catalog.md](catalog.md#behaviours)): rotate, float, bob, pulse, wobble, sway, orbit, path, followPointer, lookAtPointer, hoverScale, hoverLift, clickBounce, spinOnClick, scrollRotate, scrollMove, drift, blink, colorCycle, flicker, billboard, appear, magnet, spring (pointer follow with overshoot), parallax (depth layers with pointer + scroll), tilt (card tilt on hover), breathe (organic idle), noise (organic wander), lookAt (face an object / the camera). Behaviours stack with timeline tracks.

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

| Field | Default | Meaning |
|---|---|---|
| `duration` | (required) | Seconds |
| `loop` | false | `true`, `false` or `"pingpong"` |
| `speed` | 1 | Playback rate |
| `trigger` | `visible` | What drives the clock: `load`, `visible`, `hover` (scrubs forward while hovered, back on leave), `click`, `scroll` (time = scroll progress, see `scroll`), `manual` (only interactions, scripts and `player.playSegment()` move it) |
| `autoplay` | true | `false` waits for an interaction; a segment name makes the trigger play only that segment (an intro that stops before the hover states) |
| `markers` | | `{ name: seconds }` — crossing one emits an event with its name (payload `{ marker, time }`): scripts `api.on(name)`, interactions `{ "on": "event" }`, `player.on(name, fn)`, the element's `agent3d:event` |
| `segments` | | `{ name: { from, to, loop?, speed? } \| [from, to] }` — `from` / `to` in seconds or marker names; `to < from` plays backwards. `"timeline"` names the whole timeline |
| `scroll` | | With `trigger: "scroll"`: `{ start, end, smoothing }` — ScrollTrigger-like `"<element edge> <viewport edge>"` with edges `top`, `center`, `bottom`, `N%`, `Npx`; default `"top bottom"` → `"bottom top"`; `smoothing` 0..0.99 (default 0.8). In deterministic renders the progress is `t / duration` (`agent3d render --count 8` shows the scroll states; `--scroll 0.5` one position) |
| `tracks` | (required) | Keyframe tracks (below) |

### Tracks

`{ "target": "<selector>.<property>", "keys": [...], "ease"?, "stagger"?, "staggerFrom"?, "colorSpace"? }`

- **Selector**: an object / light id, `camera`, `environment`, `postfx`, a comma list `a,b,c`, `tag:<tag>` (objects with that tag, scene order), `children:<id>` (direct children — text letters with `splitLetters` too), or a letter `<textId>/<n>`.
- **Object properties**: `position`, `rotation` (degrees), `scale` (number = uniform) and their `.x` / `.y` / `.z`, `visible`, `material.<prop>` (`opacity`, `color`, `emissive`, `emissiveIntensity`, `metalness`, `roughness`, `transmission`, `iridescence`, `clearcoat`, `sheen`, …), `material.uniforms.<name>`; models: `morph.<name>`, `animation.<clip>.weight | speed | time` (blend clips, scrub a clip by scroll); 3D photos: `effects.<effect>.<param>` ([Photo effects](#photo-effects)).
- **Lights**: `intensity`, `color`, `position`, `target`, `angle` (degrees), `penumbra`, `distance`, `decay`. **Camera**: `position`, `target`, `fov`, `zoom` (orthographic), `focus` (depth-of-field distance → postfx `dof`). **Environment**: `fog.color | near | far | density`, `lightingIntensity`, `exposure`, `background` (solid colours). **Post effects**: `postfx.<type>.<param>` (numeric / colour params of an effect present in `postfx`).
- **Keys**: `[time, value]` or `[time, value, ease]`, sorted by time — a key's ease shapes the segment that *ends* at it (overriding the track ease). Values: numbers, `[x, y, z]`, colours, booleans, or relative strings `"+=1"`, `"-=0.5"`, `"*=1.2"` (from the property's rest value; vec3 keys may mix numbers and relative strings).
- **Stagger**: `stagger` (s) offsets each target of a multi-target selector; `staggerFrom`: `start` (default), `end`, `center`, `edges`, `random` (seeded).
- **Colour keys** blend in `colorSpace`: `oklch` (default — perceptual, keeps the chroma, so orange → teal stays saturated instead of passing through grey), `oklab` (perceptual straight line), `rgb` (linear-light RGB, the old behaviour), `hsl` (around the hue wheel, the short way). Interaction `set` transitions and the `colorCycle` behaviour blend in OKLCh too.

### Eases

`linear` (track default), `step`, `in` / `out` / `inOut` × `Quad`, `Cubic`, `Quart`, `Quint`, `Sine`, `Expo`, `Circ`, `Back`, `Elastic`, `Bounce` (e.g. `outCubic`, `inOutBack`), or parametric `"cubicBezier(x1, y1, x2, y2)"` (CSS), `"spring"` / `"spring(stiffness, damping[, mass])"` (lower damping = more bounce; settles at the key), `"steps(n)"` / `"steps(n, start)"`. The same names work in camera shots, text reveals and interaction `set` tweens.

Reversed segments play the curve backwards (an `outBack` entrance becomes an `inBack` exit). For interruptible hover states prefer interaction `set` tweens or `toggle` (which resumes from where it is).

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

| Field | Meaning |
|---|---|
| `on` | `click`, `hover`, `hoverEnd` (on `target`, or the whole canvas without one), `visible` (once, when the embed starts), `scroll` (progress crosses `at` downward), `key` (`key`: a `KeyboardEvent.code`), `event` (`event`: a marker or emitted name) |
| `target`, `key`, `event`, `at` | The trigger's subject (see `on`) |
| `once` | Fire a single time |
| `do` | Actions, run in order (below) |

| Action | Effect |
|---|---|
| `{ "play": "<segment>" \| "timeline", "reverse"? }` | Play a segment (or the whole timeline from 0) |
| `{ "toggle": "<segment>" }` | Forward, then backward from where it is on the next trigger (open / close) |
| `{ "seek": seconds \| "<marker>" }` | Jump the timeline |
| `{ "set": { "path", "value" }, "duration"?, "ease"? }` | Any [track target](#tracks), tweened from the shown value, then held |
| `{ "emit": "<name>", "payload"? }` | Event for scripts, interactions, `player.on` and the page (`agent3d:event`) |
| `{ "openUrl": "https://…" \| "/path", "newTab"? }` | Navigate (below) |
| `{ "playClip": "<clip>", "target": "<modelId>", "loop"?, "speed"?, "crossfade"? }` | Switch a model's animation clip |

- `openUrl` (with object `href`) is the only way a scene navigates. `openUrl` accepts http(s) or page-relative URLs only, on `click` / `key` interactions only (a user gesture), never in headless renders (an `openUrl` event is emitted instead). Cross-origin URLs open in a new tab (`noopener,noreferrer`) unless `newTab: false`.
- Click / hover targets become pickable and get a pointer cursor.
- Headless: `agent3d render --input '[{"t": 0.5, "pointer": [0, 0]}, {"t": 2, "click": [0.7, 0.1]}]'` fires hover / click interactions at those times. Page scripts: `player.playSegment(name)`, `player.trigger("click", id)`, `player.emit(name)`, `player.on(name, fn)`, `player.setScrollProgress(p)`.

## Post effects

```json
"postfx": [
  { "type": "look", "preset": "cinematic" },
  { "type": "dof", "focusOn": "product", "aperture": 0.003 },
  { "type": "vignette", "darkness": 0.5 }
]
```

Each entry is a catalog effect (`{ "type": "<id>", …params }`, parameters and GPU cost in [catalog.md](catalog.md#post-effects)) or a **look preset** `{ "type": "look", "preset": "cinematic" | "product" | "dreamy" | "neon" | "retro" | "clean", "intensity"?: 0..1 }` that expands into a tuned stack (exact expansions in [catalog.md → Look presets](catalog.md#look-presets)). An effect listed next to a look overrides the matching expanded entry param by param (above: the look's vignette with `darkness` 0.5). Each effect appears once.

| Group | Effects |
|---|---|
| Realism (HDR, before tone mapping) | `ao` (GTAO contact shading — on a `shadowOnly` ground it becomes a contact shadow), `outline`, `godrays` (from the sky sun, a light id or the first directional light), `dof` (bokeh; `focusOn: "<objectId>"` autofocus), `bloom`, `lensflare` (anamorphic streaks + ghosts + halo) |
| Antialiasing | `fxaa`, `smaa` (keep one), `taa` (supersampled stills: deterministic renders, the reduced-motion still and paused frames accumulate `samples` jittered frames; free while playing) |
| Stylised (declared order) | `tiltshift`, `pixelate`, `halftone`, `ascii`, `glitch` |
| Finish (merged into one pass) | `chromatic`, `sharpen`, `grading` (procedural looks `cinematic`, `teal-orange`, `warm`, `cool`, `bleach`, `noir`, `vintage`, `pastel` + exposure, white balance, contrast, lift / gamma / gain, split toning, saturation), `vignette`, `film` |

The pipeline order is fixed (the declared order only matters among the stylised effects): scene in half-float HDR (MSAA per [quality tier](#quality-tiers)) → realism (`ao` → `outline` → `godrays` → `dof` → `bloom` → `lensflare`) → tone mapping + background (the background keeps its exact colour) → `fxaa` / `smaa` → stylised → finish (sRGB + dithering, no banding). `ao`, `dof`, `godrays` and `outline` share one normal / depth pre-pass. Timeline tracks animate `postfx.<type>.<param>` (e.g. `postfx.dof.focus` for a rack focus, `postfx.bloom.strength`).

## Physics

Objects with a `body` are simulated as real rigid bodies (position **and rotation**) by [cannon-es](https://github.com/pmndrs/cannon-es) (MIT), bundled in a lazy runtime chunk that only loads when the scene has bodies or joints. The simulation runs at the fixed `physics.step` and is deterministic: `seek(t)` always gives the same transforms, whatever the seek order (renders and posters are reproducible). Scripts drive bodies with `api.physics` ([scripting.md](scripting.md#physics)).

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

### World

| `physics` field | Default | Meaning |
|---|---|---|
| `gravity` | `[0, -9.81, 0]` | m/s² |
| `step` | 1/60 | Fixed simulation step (s); scripts' `update` runs at the same step |
| `substeps` | 1 | Solver sub-steps per step (1–8): stabler tall stacks, less tunnelling |
| `iterations` | 10 | Constraint solver iterations |
| `sleep` | true | Resting bodies fall asleep (cheap, stable stacks) |
| `debug` | false | Draws collider wireframes on top of the scene (green dynamic, blue static, orange kinematic, magenta trigger, grey sleeping) — use it with `agent3d render` to check colliders |
| `materials` | | Named surfaces `{ friction?, restitution? }` referenced by `body.material` |
| `contacts` | | Per-pair overrides `{ a, b, friction?, restitution? }` between two named materials (otherwise friction = √(f₁·f₂), restitution = max) |
| `layers` | | Collision layer names in bit order (max 16 with `"default"`, always first); layers used by bodies but not listed are appended |
| `joints` | | Constraints (below) |

### Bodies

```json
{ "id": "ball", "kind": "mesh", "geometry": { "type": "sphere", "radius": 0.5 }, "position": [0, 4, 0],
  "body": { "type": "dynamic", "shape": "sphere", "mass": 1, "restitution": 0.6, "material": "rubber" } }
```

| `body` field | Default | Meaning |
|---|---|---|
| `type` | (required) | `dynamic` (simulated), `static` (immovable), `kinematic` (moved by scripts / velocity, pushes dynamic bodies, ignores gravity), `trigger` (detects overlaps, never pushes) |
| `shape` | `box` | `box` (the bounding box of the object's **own** geometry, in its rotated frame), `sphere`, `cylinder`, `capsule` (Y-up), `convex` (hull of the mesh / model — good for dynamic models), `trimesh` (exact triangles; static / kinematic only — level geometry), `heightfield` (terrain generators; static / kinematic only), `compound` (`shapes`, or without `shapes`: one box for the object plus one per child object without a body — merges decorative children), `auto` (sphere / capsule / cylinder / box geometry → that shape; terrain → heightfield; other meshes, models, SVGs → trimesh when static / kinematic, convex when dynamic; generators → trimesh when static; else box) |
| `size`, `radius`, `height` | measured | Override the box size / the sphere, cylinder, capsule radius / the cylinder, capsule height (world units) |
| `offset` | bounding-box centre | Collider centre relative to the object origin |
| `shapes` | | `compound`: `[{ "shape": "box" \| "sphere" \| "cylinder" \| "capsule", "size"?, "radius"?, "height"?, "offset"?, "rotation"? }]` (offsets from the object origin) |
| `mass` | 1 | kg (dynamic only) |
| `friction`, `restitution`, `material` | 0.5, 0.2 | Surface friction, bounciness 0..1, or a `physics.materials` name |
| `velocity`, `angularVelocity` | | Initial velocity (m/s) and spin (degrees / s) |
| `linearDamping`, `angularDamping` | 0.01 | 0..1 (air drag) |
| `gravityScale` | 1 | Gravity multiplier (0 = floats) |
| `fixedRotation` | false | Never rotates |
| `character` | false | Character-controller body: fixed rotation, no friction (no wall sticking), never sleeps — drive it with `api.physics.moveCharacter` / `jump` |
| `sleep` | true | `false` keeps it always awake |
| `ccd` | false | Fast object (bullets, thrown balls): extra sub-steps against tunnelling |
| `layer`, `collidesWith` | `"default"`, all | Collision layer name and the layers it collides with |

Measured shapes use the object's own geometry (with the parts a model, generator or text builds), never its child objects: a child with a `body` gets its own collider, a child without one is decoration unless the parent uses `"shape": "compound"` without `shapes` (each such child becomes a box of the compound). A `group` has no geometry of its own, so its body measures its children (those without a body).

**Scaling a body from a script** (`obj.scale.set(…)`) rebuilds its collider at the new size (velocity kept). A body held by a joint keeps its start-size collider (a `physics` warning says so); timeline / behaviour scale animations never resize colliders.

**Dynamic bodies rotate.** A player or a vehicle you steer by setting its velocity tumbles under friction unless it has `"character": true` (platformers, top-down heroes) or `"fixedRotation": true`.

### Joints

`physics.joints[]`: pivots and axes in world space at scene start; `a` (and `b`) are object ids with a body; omit `b` to attach `a` to the world. Every joint takes `id` (for `api.physics.setMotorSpeed`), `maxForce` (default 1e6) and `collideConnected` (default `false`).

| `type` | Fields |
|---|---|
| `hinge` | `pivot`, `axis` (default `[0, 1, 0]`), `motor: { speed (degrees / s), maxForce? }`, `limits: [minDeg, maxDeg]` (angle range relative to the start pose, e.g. `[0, 110]` for a door, `[-30, 30]` for a flipper) — doors, wheels, flippers |
| `point` | `pivot` — ball-and-socket: pendulums, chains, ragdolls |
| `distance` | `distance` (default: the current distance between the centres) — rigid rods |
| `lock` | Welds two bodies (breakable with `maxForce`) |
| `spring` | `restLength` (default: the current distance), `stiffness` (50), `damping` (1); `pivot` = world anchor on `b` (or the world point when `b` is omitted) |

## Scripts, HUD and audio

```json
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
"audio": {
  "sounds": { "coin": { "preset": "coin" }, "jingle": { "src": "assets/audio/jingle.mp3", "volume": 0.5 } },
  "music": { "preset": "chiptune-loop", "volume": 0.3, "loop": true },
  "muted": false
}
```

- **`scripts`**: project paths of ES modules whose default export receives the `ScriptApi`. The contract, the sandbox rules and headless testing are in [scripting.md](scripting.md).
- **`ui.elements[]`**: `id`, `type` (`text`, `button`, `bar`), `text` with `{key}` placeholders from `api.state` (`{score}`, `{state.lives}`, or an expression), `anchor` (`top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`), `style` (`plain`, `pill` — always one line, the side columns grow to fit it and the centre title wraps instead —, `title`, `subtitle`, `panel` — a backdrop card for game-over / pause screens: multi-line text with `\n`, the first line set as a heading), `value` (bar: state key holding 0..1), `action` (button: event sent to scripts), `visible` (boolean, state key or expression such as `"phase == 'over'"`), `color` / `background` (per element: text colour; background of a pill, panel, button or bar track — a bar's `color` is its fill; a button with only `background` gets an auto-contrast label). `ui.font` takes CSS system font stacks only (no web font is fetched); `ui.color` (text), `ui.accent` (buttons, bar fills) and `ui.buttonText` theme it — without `buttonText`, button labels are white or near-black, whichever contrasts best with the accent (WCAG ≥ 4.5 whenever one of them can).
- **Timeline state in the HUD** (no script needed): expressions and placeholders read `timeline.time`, `timeline.duration`, `timeline.progress` (0..1), `timeline.segment` (the segment being played, else the first declared segment containing the current time, else `""`) and `timeline.marker` (the last marker at or before the current time, `""` before the first). A script's own `state.timeline` key wins.

### Pattern: scroll-story chapter labels

A scroll-driven story (`timeline.trigger: "scroll"`) whose chapter label stays on screen while the camera travels — a 3D caption attached to the camera, plus HUD pills that follow the segments:

```json
"timeline": {
  "duration": 10, "trigger": "scroll",
  "segments": { "design": [0, 3], "build": [3, 7], "launch": [7, 10] },
  "markers": { "design": 1, "build": 5, "launch": 9 },
  "tracks": [{ "target": "camera.position", "keys": [[0, [0, 1.2, 8]], [4, [14, 1.6, 8]], [8, [28, 1, 8]]], "ease": "inOutCubic" }]
},
"objects": [
  { "id": "kicker", "kind": "text", "attach": "camera", "text": "OUR PROCESS", "size": 0.12, "depth": 0, "align": "left", "position": [-1.55, 0.78, -4] }
],
"ui": {
  "accent": "#ffd400",
  "elements": [
    { "id": "ch1", "type": "text", "style": "pill", "anchor": "top-left", "text": "01 · Design", "visible": "timeline.segment == 'design'" },
    { "id": "ch2", "type": "text", "style": "pill", "anchor": "top-left", "text": "02 · Build", "visible": "timeline.segment == 'build'" },
    { "id": "ch3", "type": "text", "style": "pill", "anchor": "top-left", "text": "03 · Launch", "visible": "timeline.segment == 'launch'", "background": "#ffd400", "color": "#111111" },
    { "id": "cta", "type": "button", "anchor": "bottom", "text": "Start a project", "action": "cta", "visible": "timeline.progress >= 0.9" }
  ]
}
```

The camera-attached kicker never leaves the frame; each pill shows only during its chapter; the button appears for the last 10 % of the scroll and emits `cta` (scripts `api.on("cta")`, interactions `{ "on": "event", "event": "cta" }`, the page's `agent3d:event`). For a link, a clickable 3D object with `href` (or an `openUrl` click interaction) is the no-script way.
- **`audio`**: `sounds` are named sounds scripts play with `api.audio.play(name)` — synthesised presets (`agent3d catalog sounds`: coin, jump, hit, explosion, click, powerup, laser, win, lose, whoosh, ambient-pad, chiptune-loop; zero bytes) or project files, each with `volume`; `music` (`src` or `preset`, `volume`, `loop`) starts with `api.audio.music(true)`; `muted` sets the initial state of the HUD's mute button. Audio never starts before a user gesture.

## Data bindings

```json
{ "data": { "title": "Spring sale", "cta": "Shop now" },
  "objects": [{ "id": "headline", "kind": "text", "text": "{data.title}", "href": "/sale?ref={data.cta}" }] }
```

Text objects' `text`, every object's `href`, the scene's `title` / `ariaLabel`, HUD element texts, interaction links (`interactions[].do[].openUrl`) and string values inside generator `params` may contain `{data.key}` placeholders: `{data.title}`, `{data.product.name}` (nested), `{data.cta|Shop now}` (fallback when the value is missing or empty). They are replaced on a copy of the scene before it is built, from `scene.data` — which the page overrides per embed with `data-*` attributes (`<agent3d-scene data-title="Summer sale">`, `data-cta-label` → `ctaLabel`, `data-json='{"price": 9}'`) or `element.setData({...})` ([export.md](export.md#data-bindings)). A missing value without a fallback becomes an empty string, so give every key a default in `scene.data`. Scripts read the merged values as `api.data`.

In generator `params`, a placeholder that is the **whole** value binds the raw data value — arrays, numbers, objects: `"params": { "data": "{data.values}", "maxHeight": "{data.height|3}" }` with `"data": { "values": [3, 5, 8] }` gives bars3d the array (a fallback is read as JSON when it is one). Inside a longer string it is text, like everywhere else. Validation skips the type check of a bound param, so keep `scene.data` defaults of the right type. `agent3d export` resolves `title` / `ariaLabel` placeholders (with `scene.data` and fallbacks) in the snippet's `aria-label` / poster `alt`, the demo page's `<title>` / `og:title` and EMBED.md.

## Issues

Validation and `check` return `Issue` objects: `{ severity: "error" | "warning" | "info", code, path, message, hint? }`. Paths use ids where possible (`objects#logo.material.roughness`) and indices otherwise (`lights[0].intensity`). Errors block saving; warnings (unknown parameters, missing lights…) are saved but should be fixed; infos are advice (attribution, clipped objects, optimisable assets).

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
