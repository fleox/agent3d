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
| `timeline` | TimelineDef? | Keyframe animation |
| `postfx` | PostFxDef[]? | Post effects in order |
| `physics` | PhysicsWorldDef? | Gravity and fixed step (games) |
| `scripts` | string[]? | Project paths of script modules (`"scripts/game.js"`) |
| `ui` | UiDef? | HUD elements (games, interactive scenes) |
| `audio` | AudioDef? | Named sounds and music |
| `data` | object? | Free-form data scripts read as `api.data` |
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

## Camera

```json
"camera": { "type": "perspective", "fov": 30, "position": [0, 0, 12], "target": [0, 0, 0], "controls": "parallax", "parallax": { "strength": 0.3, "smoothing": 0.92 } }
```

- `type`: `perspective` (`fov`, default 45) or `orthographic` (`zoom`: world units visible vertically, default 10).
- `position`, `target` (look-at point, default origin), `near`, `far`.
- `controls`: `none` (fixed), `orbit` (drag; `orbitZoom`, `orbitLimits: { minDistance, maxDistance, minPolar, maxPolar }`), `parallax` (drifts with the pointer: `parallax.strength`, `smoothing`), `scroll` (follows `scrollPath: [{ position, target? }, …]` with the page scroll), `follow` (games: `follow: { target, offset, smoothing, lookAhead }`).
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

- `background`: a colour; `"transparent"`; `{ "gradient": [colours], "angle": deg }` (0 = bottom → top); `{ "radial": [centre, edge] }`; `{ "sky": { "top", "horizon", "bottom", "sun": { "direction", "color", "size" } | false, "stars": count } }`; `{ "hdri": path, "blur": 0..1 }`.
- `lighting` (image-based lighting for reflections): `studio`, `soft`, `sunset`, `night`, `neutral`, `none`, or `{ "hdri": path, "intensity": n }`. `lightingIntensity` scales it.
- `fog`: linear `{ color, near, far }` or exponential `{ color, density }`.
- `ground`: a plane at `y` (`size`, `color`, `roughness`, `grid`, `shadowOnly` to only catch shadows so objects sit on the page).

## Lights

```json
"lights": [
  { "id": "fill", "type": "hemisphere", "skyColor": "#fff1dc", "groundColor": "#3a1d0b", "intensity": 0.8 },
  { "id": "key", "type": "directional", "position": [4, 6, 6], "intensity": 2.4, "castShadow": true },
  { "id": "rim", "type": "point", "position": [-5, 2, -3], "color": "#ffb366", "intensity": 30, "distance": 20 }
]
```

`type`: `ambient`, `directional`, `point` (`distance`, `decay`), `spot` (`angle` in degrees, `penumbra`, `target`), `hemisphere` (`skyColor`, `groundColor`), `rect` (`width`, `height`). Common: `id`, `color`, `intensity`, `position`, `target`, `castShadow`, `behaviours` (e.g. `flicker`). A scene with lit materials and neither lights nor environment lighting renders black: `scene validate` warns.

## Objects

Common fields (all kinds): `id`, `name`, `position`, `rotation` (degrees, XYZ order), `scale` (number or `[x, y, z]`), `visible`, `castShadow`, `receiveShadow`, `behaviours`, `children`, `tags` (scripts: `api.findByTag`), `body` (physics), `href` (clicking opens the URL; pointer cursor), `userData`.

| `kind` | Specific fields |
|---|---|
| `mesh` | `geometry: { type, …params }` (catalog geometries), `material` |
| `text` | `text`, `font` (`sans-bold` default, `sans`, `serif-bold`, `mono`, `display`), `size` (cap height, default 1), `depth` (0.2; 0 = flat), `bevel` (0.02), `align` (`center` default; the text is centred on its position), `letterSpacing`, `lineHeight`, `material` |
| `model` | `src` (`.glb` / `.gltf` path or `library:<id>`), `fit` (largest dimension in units), `center` (bottom centre at the origin, default true), `animation: { clip, loop, speed, crossfade }`, `material` (override for every mesh) |
| `group` | Only `children` |
| `generator` | `generator` (catalog id: terrain, trees, rocks, grass, flowers, water, clouds, city, character, planet, starfield, blob, waveGrid, maze, road), `params`, `seed`, `material` (override of the main surface for `blob`, `rocks`, `terrain`, `planet` — e.g. `{ "type": "shader", "shader": "gradientFlow" }` on a blob keeps its morph; without colour / preset / map, lit materials keep the generator's vertex colours) |
| `particles` | `preset` (stars, snow, rain, fireflies, confetti, sparks, dust, bubbles, embers, hearts) and overrides: `count`, `area`, `size`, `color` (one or a list), `speed`, `direction`, `spread`, `lifetime`, `opacity`, `blending` (`normal` / `additive`), `shape` (`point`, `square`, `circle`, `star`, `spark`), `seed` |
| `instances` | One `geometry` + `material` drawn many times: `layout` = `{ type: "grid", count: [x, y, z], spacing: [x, y, z] }`, `{ type: "scatter", count, area, minScale, maxScale, randomRotation, seed }`, `{ type: "circle", count, radius }` or `{ type: "list", items: [transforms] }`; `colors` cycled per instance |
| `svg` | `src` (inline SVG markup or a project path), `size` (width, default 2), `depth` (0.2), `bevel`, `material`: a logo extruded into 3D |

### Geometry

`{ "type": "<id>", …params }` with the catalog's parameters (sizes in units): `box`, `roundedBox`, `sphere`, `cylinder` (`radiusTop`, `radiusBottom`, `height`), `cone`, `capsule`, `torus`, `torusKnot`, `plane` (faces +Z: rotate `[-90, 0, 0]` for a floor), `circle`, `ring`, `icosahedron`, `dodecahedron`, `octahedron`, `tetrahedron`, `lathe` (`points` profile), `extrude` (`shape` polygon), `tube` (`points` curve). Each has a triangle cost formula used by `check`.

### Material

```json
"material": { "preset": "gold", "roughness": 0.25 }
```

- `preset`: plastic, matte, clay, chrome, brushedMetal, gold, copper, glass, frostedGlass, rubber, pearl, holographic, neon, toon, flat, lowpoly, velvet, wireframe, normal. Explicit fields override it.
- `type`: `standard`, `physical`, `basic`, `lambert`, `toon`, `normal`, `matcap`, `gradient` (`gradient: [colours]` vertical ramp), `shader` (`shader: <catalog id>`, `uniforms`).
- Fields: `color`, `metalness`, `roughness`, `emissive`, `emissiveIntensity`, `opacity`, `transparent`, `wireframe`, `flatShading`, `side` (`front`, `back`, `double`); physical: `transmission`, `thickness`, `ior`, `clearcoat`, `iridescence`, `sheen`; textures: `map`, `normalMap`, `roughnessMap` (paths or library ids), `repeat: [u, v]`.

## Behaviours

```json
"behaviours": [
  { "type": "float", "amplitude": 0.1, "speed": 0.3 },
  { "type": "hoverScale", "scale": 1.1, "when": "always" },
  { "type": "appear", "effect": "rise", "duration": 1, "delay": 0.2 }
]
```

Procedural animation and interaction on objects and lights: `type` (catalog id), `when` (`always` default, `hover`, `click`, `visible`, `scroll`), `delay` (s), and the behaviour's parameters. The 23 behaviours (rotate, float, bob, pulse, wobble, sway, orbit, path, followPointer, lookAtPointer, hoverScale, hoverLift, clickBounce, spinOnClick, scrollRotate, scrollMove, drift, blink, colorCycle, flicker, billboard, appear, magnet) and their parameters are in [catalog.md](catalog.md#behaviours).

## Timeline

```json
"timeline": {
  "duration": 8,
  "loop": true,
  "trigger": "visible",
  "tracks": [
    { "target": "title.rotation.y", "keys": [[0, -5], [4, 5], [8, -5]], "ease": "inOutSine" },
    { "target": "camera.position", "keys": [[0, [0, 0, 12]], [8, [0, 0, 11]]] },
    { "target": "key.intensity", "keys": [[0, 2], [4, 3], [8, 2]] }
  ]
}
```

- `duration` (s), `loop` (`true`, `false` or `"pingpong"`), `autoplay` (default true), `trigger` (`load`, `visible` default, `hover`, `click`, `scroll`: time follows the scroll progress of the element through the viewport).
- Track `target`: `<objectId>.<property path>` (`position`, `position.x`, `rotation.y` in degrees, `scale` (number = uniform), `visible`, `material.opacity`, `material.color`, `material.emissiveIntensity`), `camera.position` / `camera.target` / `camera.fov`, `<lightId>.intensity` / `<lightId>.color`.
- `keys`: `[time, value]` sorted by time; values are numbers, `[x, y, z]`, colours or booleans.
- `ease`: `linear`, `inQuad` / `outQuad` / `inOutQuad`, same for `Cubic`, `Sine`, `Expo`, `Back`, plus `outElastic`, `outBounce`, `step`.

## Post effects

`postfx: [{ "type": "bloom", "strength": 0.5, "threshold": 0.85 }, { "type": "vignette", "darkness": 0.9 }]` — `bloom`, `vignette`, `film`, `chromatic`, `pixelate`, `outline`, `dof`, applied in order (parameters in [catalog.md](catalog.md#post-effects)).

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

- `body` on an object: `type` (`static`, `dynamic`, `kinematic`, `trigger`), `shape` (`box`, `sphere`, `auto`), `size`, `radius`, `mass`, `restitution`, `friction`, `velocity`, `fixedRotation`.
- UI elements: `id`, `type` (`text`, `button`, `bar`), `text` with `{state key}` placeholders, `anchor` (top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right), `style` (`plain`, `pill`, `title`, `subtitle`), `value` (bar: state key holding 0..1), `action` (button: event sent to scripts), `visible` (boolean, state key or expression such as `"phase == 'over'"`). `ui.font` takes system font stacks only (no web font is fetched).
- Audio: synthesised presets (zero bytes; catalog `sounds`) or project files. Audio never starts before a user gesture; `muted` sets the initial state of the mute button.
- Scripts: see [scripting.md](scripting.md).

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
