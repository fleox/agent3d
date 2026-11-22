# Patch ops cookbook

Apply with `python3 <skill dir>/scripts/agent3d.py scene patch --project <dir> --file ops.json --json` (add `--dry-run` to preview, `--yes` when the plan removes something or replaces a whole collection such as `lights`, `postfx`, `objects`, `timeline.tracks` or `ui.elements`: `plan.replaces` lists them). Ops run in order on a copy; the result is validated; on any error nothing is written and the error names the failing op (`details.opIndex`).

## Paths

| Path | Points at |
|---|---|
| `camera`, `camera.position`, `camera.fov` | The camera |
| `environment.background`, `environment.lighting`, `environment.fog`, `environment.rig`, `environment.contactShadows` | Environment |
| `lights[0]`, `lights#key`, `lights#key.intensity` | A light by index or by id |
| `objects#title`, `objects#title.material.color` | An object by id, searched in the whole tree (children too) |
| `objects#torus.position[1]` | One element of an array |
| `objects#title.behaviours[0].speed` | A behaviour parameter |
| `timeline.duration`, `timeline.tracks[0].keys`, `timeline.markers`, `timeline.segments`, `timeline.scroll` | Timeline |
| `camera.shots`, `camera.shots[1].duration` | Cinematic camera moves |
| `interactions`, `interactions[0].do` | Hover / click / scroll / key triggers |
| `ui.elements#retry.text`, `ui.elements#score.visible` | A HUD element by id (`#id` works in any array of objects with ids: `lights#key`, `ui.elements#…`) |
| `postfx[0].strength`, `target.posterTime`, `ui.elements[2].text`, `data.speed` | Anything else in the scene |

An unknown id fails with `invalid` and the hint lists how to find ids (`object list`).

## Objects

```json
[
  { "op": "addObject", "object": { "id": "props", "kind": "group", "position": [0, 0, -1] } },
  { "op": "addObject", "parent": "props", "object": { "id": "crystal", "kind": "mesh", "geometry": { "type": "icosahedron", "radius": 0.6 }, "material": { "preset": "glass" }, "position": [7.5, 0, 0] } },
  { "op": "updateObject", "id": "title", "set": { "text": "Spring sale", "size": 0.9 } },
  { "op": "moveObject", "id": "torus", "parent": "props", "index": 0 },
  { "op": "moveObject", "id": "torus", "parent": null }
]
```

Object kinds: `mesh` (geometry + material), `text`, `model` (`src` = `assets/…` or `library:<id>`, `fit`, `animation`), `group`, `generator` (`generator` + `params` + `seed`), `particles` (`preset` + overrides), `instances` (one geometry many times: `layout` grid / scatter / circle / list), `svg` (inline markup or a project path, extruded). Common fields: `position`, `rotation` (degrees), `scale` (number or [x, y, z]), `visible`, `castShadow`, `receiveShadow`, `behaviours`, `children`, `tags`, `body` (physics), `href` (click opens a URL, pointer cursor), `userData`, `attach: "camera"` (top-level objects: rides with the camera; `position` / `rotation` are then in camera space, x right, y up, -z forward — `[0, -1.2, -6]` = 6 units in front of the lens — for captions and chapter labels that stay on screen during shots and scroll stories).

Duplicating a prop: `object get <id>`, change its `id` and `position`, `addObject`. Many copies: one `instances` object instead (cheaper):

```json
{ "op": "addObject", "object": { "id": "coins", "kind": "instances", "geometry": { "type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.08 }, "material": { "preset": "gold" }, "layout": { "type": "circle", "count": 12, "radius": 4 } } }
```

## Text and letters

```json
[
  { "op": "updateObject", "id": "title", "set": { "font": "inter-black", "splitLetters": true, "outline": { "width": 0.05, "color": "#1a1033" } } },
  { "op": "addTrack", "track": { "target": "title/0.rotation.z", "keys": [[0, 0], [1, 12, "outBack"], [2, 0, "inOutSine"]] } },
  { "op": "addTrack", "track": { "target": "children:title.position.y", "keys": [[0, "-=1"], [0.8, "+=0", "outCubic"]], "stagger": 0.05, "staggerFrom": "center" } },
  { "op": "addTrack", "track": { "target": "title/2.material.color", "keys": [[0, "#ffffff"], [1, "#ffd166"]] } }
]
```

`splitLetters` makes each glyph a child `<id>/<n>` (n = 0, 1, … counting non-space characters, line after line) with its own pivot and material. `children:<id>` targets every letter. A simpler per-letter entrance without tracks: `"reveal": { "effect": "rise", "stagger": 0.05, "duration": 0.7, "delay": 0.2, "order": "forward" }` (effects rise, fade, scale, spin, drop; it implies `splitLetters`). Other text fields: `font` (`catalog fonts`), `size`, `depth` (0 = flat), `bevel` (a number: bevel size in scene units, 0 = sharp), `letterSpacing` (scene units, scale it with `size`), `lineHeight`, `maxWidth` (wraps on spaces), `kerning` (on by default), `align`. Validation rejects a `<id>/<n>` target on a text that is not split, but not a letter index past the end: count the letters yourself. The block is centred vertically on `position` and placed by `align` (`center` default, `left` = lines start at x, `right` = lines end at x); extra lines grow it up and down. Split letters × `outline` = two meshes per letter (draw calls add up fast).

## Materials

```json
[
  { "op": "set", "path": "objects#title.material", "value": { "preset": "gold" } },
  { "op": "updateObject", "id": "title", "set": { "material": { "roughness": 0.25 } } },
  { "op": "set", "path": "objects#logo.material", "value": { "preset": "neon", "color": "#3ee8ff", "emissive": "#3ee8ff", "emissiveIntensity": 2.5 } },
  { "op": "set", "path": "objects#backdrop.material", "value": { "type": "shader", "shader": "gradientFlow", "uniforms": { "colors": ["#ff7eb3", "#7afcff", "#feffb7"], "speed": 0.3 } } },
  { "op": "set", "path": "objects#floor.material", "value": { "preset": "matte", "map": "library:textures/wood-planks-color.jpg", "normalMap": "library:textures/wood-planks-normal.jpg", "roughnessMap": "library:textures/wood-planks-roughness.jpg", "repeat": [4, 4] } }
]
```

```json
[
  { "op": "addObject", "object": { "id": "plinth", "kind": "mesh", "geometry": { "type": "cylinder", "radiusTop": 1.6, "radiusBottom": 1.6, "height": 0.4 }, "position": [0, -2.2, -1.5],
    "material": { "type": "physical", "color": "#ffffff", "roughness": 0.35, "map": { "procedural": "wood", "rings": 14 }, "bumpMap": { "procedural": "wood", "rings": 14 }, "bumpScale": 0.3, "clearcoat": 0.6 } } },
  { "op": "updateObject", "id": "plinth", "set": { "material": { "triplanar": 0.5 } } },
  { "op": "set", "path": "objects#plinth.material.roughnessMap", "value": { "procedural": "noise" } },
  { "op": "set", "path": "objects#blob.material", "value": { "preset": "carPaint", "color": "#c2183c" } }
]
```

`set` replaces (use it to change the look), `updateObject` merges (use it for one property). Models accept a `material` override too (it recolours every mesh of the model).

- Presets: `catalog materialPresets` (the photoreal set: carPaint, ceramic, marble, terrazzo, wood, carbonFiber, leather, satin, silk, brushedAluminium, ice, water, diamond, gem, jelly, chromeGradient, soapBubble, mattePastel, emissiveGradient).
- Texture slots (`map`, `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `emissiveMap`, `bumpMap`, `displacementMap`, `alphaMap`) take a path, a `library:` id or a procedural texture `{ "procedural": "<id>", …params }` (`catalog textures`: marble, wood, terrazzo, carbon, noise, voronoi, flakes, brushed, grid, checker, stripes, dots; zero bytes, seamless). `triplanar` (true or repeats per unit) projects them without UVs (generators, stretched shapes).
- `"type": "physical"` unlocks `transmission`, `thickness`, `ior`, `clearcoat`, `iridescence`, `sheen`, `anisotropy`, `attenuationColor`, `dispersion`… (full list in `docs/scene-format.md`).

## Lights and environment

```json
[
  { "op": "set", "path": "lights#key.intensity", "value": 2.4 },
  { "op": "set", "path": "lights#rim.color", "value": "#ffb366" },
  { "op": "set", "path": "environment.lighting", "value": "sunset" },
  { "op": "set", "path": "environment.lightingIntensity", "value": 0.6 },
  { "op": "set", "path": "environment.background", "value": { "radial": ["#2b2d6e", "#0d0e24"] } },
  { "op": "set", "path": "environment.fog", "value": { "color": "#ffd8a8", "near": 30, "far": 90 } },
  { "op": "set", "path": "environment.ground", "value": { "y": 0, "size": 20, "shadowOnly": true } },
  { "op": "addBehaviour", "id": "key", "behaviour": { "type": "flicker", "amount": 0.2, "speed": 6 } }
]
```

A product studio in five ops (a light rig replaces the hand-placed lights; contact shadows ground the subject):

```json
[
  { "op": "set", "path": "environment.background", "value": { "radial": ["#f6efe8", "#d8cbbf"], "center": [0.5, 0.62] } },
  { "op": "set", "path": "environment.lighting", "value": { "hdri": "library:hdri/softbox.hdr", "intensity": 1 } },
  { "op": "set", "path": "environment.rig", "value": { "preset": "softbox", "intensity": 1.1 } },
  { "op": "set", "path": "environment.contactShadows", "value": { "opacity": 0.6, "blur": 2.5 } },
  { "op": "set", "path": "lights", "value": [] }
]
```

Outdoors and abstract backgrounds (each `set` replaces the previous background; `remove` asks for `--yes`):

```json
[
  { "op": "set", "path": "environment.background", "value": { "sky": { "preset": "golden-hour", "sun": { "azimuth": 125 } } } },
  { "op": "remove", "path": "environment.lighting" },
  { "op": "set", "path": "environment.fog", "value": { "density": 0.025, "height": 1, "falloff": 0.25 } },
  { "op": "set", "path": "environment.background", "value": { "meshGradient": ["#ff9a8b", "#ff6a88", "#7b5cff", "#2ad4ff"], "speed": 0.15 } },
  { "op": "set", "path": "environment.background", "value": { "hdri": "library:hdri/forest.jpg", "rotation": 120, "groundProjection": { "height": 2, "radius": 60 } } },
  { "op": "set", "path": "environment.shadows", "value": { "type": "vsm", "softness": 4 } }
]
```

- Backgrounds: a colour, `"transparent"` (also set `target.transparent: true`), `{ "gradient": [c1, c2, c3], "angle": 0, "grain": 0.03 }`, `{ "radial": [centre, edge], "center": [x, y] }`, `{ "meshGradient": [2-6 colours], "speed", "scale", "seed" }`, a gradient sky `{ "sky": { "top", "horizon", "bottom", "sun", "stars" } }`, a **physical sky** `{ "sky": { "preset": "sunrise" | "morning" | "noon" | "afternoon" | "golden-hour" | "sunset" | "dusk", "sun": { "elevation", "azimuth" }, "clouds", "turbidity" } }` (it adds a matching sun light and lights the scene: drop `environment.lighting`), `{ "hdri": "library:hdri/sunset.jpg", "blur": 0.3, "rotation": deg, "groundProjection": true }`.
- `lighting`: `studio`, `soft`, `sunset`, `night`, `neutral`, `sky`, `none` (procedural, zero bytes) or `{ "hdri": path, "intensity", "rotation" }`. Library HDRIs: `assets library --kind hdri`.
- `fog`: linear `{ color, near, far }`, exponential `{ color, density }`, height fog `{ density, height, falloff }` (colour defaults to the sky horizon).
- `rig`: `catalog lightRigs` (studio-3point, softbox, product-top, rim, dramatic, golden-hour, noon, overcast, neon, moonlight), or `{ "preset", "intensity", "rotation", "scale", "castShadow", "color" }`. Its lights add to `lights`: empty or dim those when the rig does the job. Rigs assume a subject about 1-3 units around the origin (`scale` for bigger scenes).
- `contactShadows`: `true` or `{ "opacity", "blur", "far", "y", "size", "resolution", "color", "frames": 1 }` (soft shadows under objects, no shadow-casting light). `shadows`: `{ "type": "pcf" | "vsm", "softness", "mapSize", "intensity" }` for shadow-casting lights.
- Lights (`type`): ambient, hemisphere (`skyColor`, `groundColor`), directional, point (`distance`, `decay`), spot (`angle`, `penumbra`, `target`, `volumetric: true` for a visible beam), rect (`width`, `height`, `panel: true` draws the glowing panel).

Adding a light: `{ "op": "set", "path": "lights", "value": [ …the whole array… ] }` (read it with `scene get --path lights` first) or `{ "op": "merge", "path": "lights#rim", "value": { "intensity": 20 } }` to tune one.

## Camera

```json
[
  { "op": "set", "path": "camera.position", "value": [0, 1.5, 9] },
  { "op": "set", "path": "camera.target", "value": [0, 1, 0] },
  { "op": "set", "path": "camera.fov", "value": 35 },
  { "op": "merge", "path": "camera", "value": { "controls": "orbit", "autoRotate": 10, "orbitZoom": false, "orbitLimits": { "minPolar": 50, "maxPolar": 95 } } }
]
```

`orbitLimits` takes `minDistance`, `maxDistance`, `minPolar` / `maxPolar` (degrees from straight above) and `minAzimuth` / `maxAzimuth` (degrees around Y, 0 = camera on +Z: `-45` / `45` keeps a product's back hidden).

Cinematic shots and handheld shake (shots run on the timeline clock, scroll-driven with `trigger: "scroll"`; a `focus` shot needs a `dof` effect in `postfx`):

```json
[
  { "op": "merge", "path": "camera", "value": { "controls": "none", "lookAt": "blob", "shake": { "amount": 0.02, "rotation": 0.25, "speed": 0.4 }, "shots": [
    { "type": "pushIn", "at": 0, "duration": 2, "distance": 2.5 },
    { "type": "orbit", "at": 2, "duration": 2, "angle": 40, "elevation": 10 },
    { "type": "focus", "at": 3, "duration": 1, "object": "blob" }
  ] } },
  { "op": "set", "path": "camera.shots[1].duration", "value": 3 },
  { "op": "set", "path": "postfx", "value": [{ "type": "look", "preset": "cinematic" }, { "type": "dof", "aperture": 0.003 }] }
]
```

Shot types: `dolly`, `pushIn`, `pullOut`, `truck`, `pedestal`, `crane`, `orbit`, `zoom`, `move`, `path` (`points`, `lookAt`), `lookAt`, `focus`; each has `at`, `duration`, `ease` (default `inOutCubic`). `lookAt` on the camera keeps an object centred (replaces `target`).

Controls: `none`, `orbit` (drag), `parallax` (drifts with the pointer: `parallax.strength`, `smoothing`), `scroll` (follows `scrollPath` with the page scroll), `follow` (games: `follow.target`, `offset`, `smoothing`). Orthographic: `"type": "orthographic", "zoom": 10` (world units visible vertically; isometric looks).

## Timeline

```json
[
  { "op": "addTrack", "track": { "target": "title.rotation.y", "keys": [[0, -5], [4, 5], [8, -5]], "ease": "inOutSine" } },
  { "op": "addTrack", "track": { "target": "camera.position", "keys": [[0, [0, 0, 12]], [8, [0, 0, 11]]], "ease": "inOutSine" } },
  { "op": "addTrack", "track": { "target": "key.intensity", "keys": [[0, 2], [4, 3], [8, 2]] } },
  { "op": "addTrack", "track": { "target": "title.material.color", "keys": [[0, "#ffffff"], [4, "#ffd166"], [8, "#ffffff"]] } },
  { "op": "addTrack", "track": { "target": "badge.visible", "keys": [[0, false], [1.5, true]], "ease": "step" } },
  { "op": "merge", "path": "timeline", "value": { "duration": 8, "loop": true, "trigger": "visible" } },
  { "op": "removeTrack", "target": "title.rotation.y" }
]
```

`addTrack` replaces an existing track with the same target. Colour keys blend in OKLCh by default (perceptual: orange → teal stays saturated instead of going grey); `"colorSpace": "oklab" | "rgb" | "hsl"` on the track changes it. Values: numbers, [x, y, z], colours, booleans, or relative strings `"+=1"`, `"-=0.5"`, `"*=1.2"` (from the property's rest value). `loop`: true, false or `"pingpong"`. A track on a property that a behaviour also drives (e.g. `position.y` + `float`) fights it: animate a parent group instead. Every key time must be within `duration` (validation warns otherwise).

Per-key easing, parametric eases, relative values and staggered multi-target tracks:

```json
[
  { "op": "updateObject", "id": "torus", "set": { "tags": ["prop"] } },
  { "op": "updateObject", "id": "gem", "set": { "tags": ["prop"] } },
  { "op": "updateObject", "id": "pill", "set": { "tags": ["prop"] } },
  { "op": "addTrack", "track": { "target": "tag:prop.scale", "keys": [[0, 0.001], [0.8, 1, "spring(170, 12)"]], "stagger": 0.1, "staggerFrom": "center" } },
  { "op": "addTrack", "track": { "target": "torus,gem.rotation.z", "keys": [[0, 0], [4, 20, "inOutQuart"], [8, 0, "inOutQuart"]], "stagger": 0.5 } },
  { "op": "set", "path": "timeline.tracks[0].keys[1]", "value": [4, 5, "inOutSine"] }
]
```

- A key's third element is the ease of the segment that ends at it; the track `ease` is the default. Eases: `linear`, `step`, `in` / `out` / `inOut` + `Quad`, `Cubic`, `Quart`, `Quint`, `Sine`, `Expo`, `Circ`, `Back`, `Elastic`, `Bounce`, `"cubicBezier(x1, y1, x2, y2)"`, `"spring(stiffness, damping[, mass])"`, `"steps(n)"`.
- Selectors: an id, `a,b,c`, `tag:<tag>` (scene order), `children:<id>` (direct children, or the letters of a split text), `<textId>/<n>`, `camera`, `environment`, `postfx`. `stagger` (s) offsets each target; `staggerFrom`: `start`, `end`, `center`, `edges`, `random`.
- `postfx.<type>.<param>` (e.g. `postfx.vignette.darkness`, `postfx.dof.focus`) only targets effects written in `postfx`: the effects a `look` expands to are not targetable, so add the effect next to the look first.

Markers, segments and a hover state (pairs with the interactions below; on a starter, also shorten or remove its 8 s title track, or validation warns that its last key is never reached):

```json
[
  { "op": "merge", "path": "timeline", "value": { "duration": 4, "loop": false, "autoplay": "intro", "markers": { "lifted": 2.6 }, "segments": { "intro": { "from": 0, "to": 2 }, "hover-in": [2, "lifted"], "hover-out": ["lifted", 2] } } },
  { "op": "addTrack", "track": { "target": "blob.position.y", "keys": [[2, "+=0"], [2.6, "+=0.5", "outBack"]] } },
  { "op": "addTrack", "track": { "target": "blob.scale", "keys": [[0, 0.001], [1.2, 1, "spring(170, 12)"]] } }
]
```

`markers: { name: seconds }` emit an event when crossed; `segments: { name: { from, to, loop?, speed? } | [from, to] }` (seconds or marker names; `to < from` plays backwards); `autoplay`: `true`, `false` or a segment name. `trigger`: `load`, `visible`, `hover`, `click`, `scroll`, `manual` (only interactions move the clock).

Scroll-driven (time = scroll progress through the element; `agent3d render --count 8` shows the states, `--scroll 0.5` one position):

```json
[
  { "op": "merge", "path": "timeline", "value": { "trigger": "scroll", "scroll": { "start": "top bottom", "end": "bottom top", "smoothing": 0.8 } } }
]
```

`scroll.start` / `end`: `"<element edge> <viewport edge>"` with edges `top`, `center`, `bottom`, `N%`, `Npx`.

## Interactions

These play the segments of the markers block above (a segment must exist before an interaction names it):

```json
[
  { "op": "set", "path": "interactions", "value": [
    { "on": "hover", "target": "blob", "do": [{ "play": "hover-in" }] },
    { "on": "hoverEnd", "target": "blob", "do": [{ "play": "hover-out" }] },
    { "on": "click", "target": "blob", "do": [{ "openUrl": "https://shop.example.com/nova" }, { "emit": "blob-click" }] },
    { "on": "event", "event": "lifted", "do": [{ "set": { "path": "title.material.color", "value": "#e8336d" }, "duration": 0.2 }] }
  ] }
]
```

- `on`: `click`, `hover`, `hoverEnd` (on `target`, or the whole canvas), `visible`, `scroll` (`at`: progress crossed downward), `key` (`key`: a `KeyboardEvent.code` such as `Space`), `event` (a marker or emitted name); `once: true` fires once.
- Actions (`do`, in order): `{ "play": "<segment>" | "timeline", "reverse"? }`, `{ "toggle": "<segment>" }`, `{ "seek": seconds | "<marker>" }`, `{ "set": { "path": "<track target>", "value" }, "duration"?, "ease"? }`, `{ "emit": "<name>" }`, `{ "openUrl": "https://..." | "/path", "newTab"? }` (click / key only; the only way a scene navigates), `{ "playClip": "<clip>", "target": "<modelId>", "crossfade"? }`.
- Segments named in `play` / `toggle` must exist in `timeline.segments` (validation says so). Targets get a pointer cursor.
- Without patches (MCP or the CLI tool runner): `interactions_set` appends with `add` or replaces with `interactions`:
  ```bash
  python3 <skill dir>/scripts/agent3d.py tools call interactions_set --input '{"add": [{"on": "click", "target": "blob", "do": [{"toggle": "hover-in"}]}], "dryRun": true}' --project my-hero --json
  ```
- Check hover states headless: `render --input '[{"t": 1.9, "pointer": [0, -0.3]}]' --frames 2,3`.

## Behaviours

```json
[
  { "op": "addBehaviour", "id": "logo", "behaviour": { "type": "hoverScale", "scale": 1.1 } },
  { "op": "addBehaviour", "id": "logo", "behaviour": { "type": "spinOnClick", "when": "click" } },
  { "op": "set", "path": "objects#logo.behaviours", "value": [{ "type": "float", "amplitude": 0.1, "speed": 0.3 }, { "type": "rotate", "speed": 15 }] },
  { "op": "set", "path": "objects#logo.behaviours[1].speed", "value": 10 }
]
```

Every behaviour and its parameters: `catalog behaviours` (or `catalog behaviours <id>`).

## Post effects, target, accessibility

```json
[
  { "op": "set", "path": "postfx", "value": [{ "type": "look", "preset": "product" }, { "type": "vignette", "darkness": 0.3 }] },
  { "op": "set", "path": "postfx", "value": [{ "type": "bloom", "strength": 0.5, "threshold": 0.85 }, { "type": "vignette", "darkness": 0.9 }] },
  { "op": "set", "path": "postfx", "value": [{ "type": "look", "preset": "product" }, { "type": "dof", "focusOn": "blob", "aperture": 0.003 }, { "type": "vignette", "darkness": 0.3 }] },
  { "op": "merge", "path": "target", "value": { "quality": "auto" } },
  { "op": "merge", "path": "target", "value": { "posterTime": 2, "reducedMotion": "static", "maxDpr": 1.5 } },
  { "op": "set", "path": "ariaLabel", "value": "Golden Crust Bakery: a warm 3D title with floating pastries" },
  { "op": "remove", "path": "postfx" }
]
```

- `{ "type": "look", "preset": "cinematic" | "product" | "dreamy" | "neon" | "retro" | "clean", "intensity": 0..1 }` expands into a tuned stack (`catalog postfx look` lists each expansion); an effect next to it overrides the matching expanded effect param by param. Effects and their GPU cost: `catalog postfx`. `check` reports `budget.gpu` and a `postfx-cost` issue when the stack is heavy (or `ao` / `dof` on a game).
- `target.quality`: `auto` (default: adapts to the device and frame rate), `low`, `medium`, `high`, `ultra`. Leave `auto` unless the user asks.

## Validation messages you will meet

- `unknown-param` (warning): a parameter the catalog doesn't know is ignored. The hint suggests the right name (e.g. `cylinder` takes `radiusTop` / `radiusBottom`, not `radius`).
- `unknown id` / "did you mean" (error): a geometry, preset, behaviour, generator… that doesn't exist.
- Range / type errors: the message gives the allowed range from the catalog.
- `invalid` from an op (no such id, bad path): fix the op; nothing was written.
