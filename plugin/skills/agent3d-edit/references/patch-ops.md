# Patch ops cookbook

Apply with `npx -y @fleox/agent3d@0.1.0 scene patch --project <dir> --file ops.json --json` (add `--dry-run` to preview, `--yes` when the plan removes something). Ops run in order on a copy; the result is validated; on any error nothing is written and the error names the failing op (`details.opIndex`).

## Paths

| Path | Points at |
|---|---|
| `camera`, `camera.position`, `camera.fov` | The camera |
| `environment.background`, `environment.lighting`, `environment.fog` | Environment |
| `lights[0]`, `lights#key`, `lights#key.intensity` | A light by index or by id |
| `objects#title`, `objects#title.material.color` | An object by id, searched in the whole tree (children too) |
| `objects#torus.position[1]` | One element of an array |
| `objects#title.behaviours[0].speed` | A behaviour parameter |
| `timeline.duration`, `timeline.tracks[0].keys` | Timeline |
| `postfx[0].strength`, `target.posterTime`, `ui.elements[2].text`, `data.speed` | Anything else in the scene |

An unknown id fails with `invalid` and the hint lists how to find ids (`object list`).

## Objects

```json
[
  { "op": "addObject", "object": { "id": "props", "kind": "group", "position": [0, 0, -1] } },
  { "op": "addObject", "parent": "props", "object": { "id": "gem", "kind": "mesh", "geometry": { "type": "icosahedron", "radius": 0.6 }, "material": { "preset": "glass" }, "position": [7.5, 0, 0] } },
  { "op": "updateObject", "id": "title", "set": { "text": "Spring sale", "size": 0.9 } },
  { "op": "moveObject", "id": "torus", "parent": "props", "index": 0 },
  { "op": "moveObject", "id": "torus", "parent": null }
]
```

Object kinds: `mesh` (geometry + material), `text`, `model` (`src` = `assets/…` or `library:<id>`, `fit`, `animation`), `group`, `generator` (`generator` + `params` + `seed`), `particles` (`preset` + overrides), `instances` (one geometry many times: `layout` grid / scatter / circle / list), `svg` (inline markup or a project path, extruded). Common fields: `position`, `rotation` (degrees), `scale` (number or [x, y, z]), `visible`, `castShadow`, `receiveShadow`, `behaviours`, `children`, `tags`, `body` (physics), `href` (click opens a URL, pointer cursor), `userData`.

Duplicating a prop: `object get <id>`, change its `id` and `position`, `addObject`. Many copies: one `instances` object instead (cheaper):

```json
{ "op": "addObject", "object": { "id": "coins", "kind": "instances", "geometry": { "type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.08 }, "material": { "preset": "gold" }, "layout": { "type": "circle", "count": 12, "radius": 4 } } }
```

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

`set` replaces (use it to change the look), `updateObject` merges (use it for one property). Models accept a `material` override too (it recolours every mesh of the model).

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

Backgrounds: a colour, `"transparent"` (also set `target.transparent: true`), `{ "gradient": [c1, c2, c3], "angle": 0 }`, `{ "radial": [centre, edge] }`, `{ "sky": { "top", "horizon", "bottom", "sun": { "direction", "color", "size" }, "stars": 500 } }`, `{ "hdri": "library:hdri/sunset.jpg", "blur": 0.3 }`. Lights (`type`): ambient, hemisphere (`skyColor`, `groundColor`), directional, point (`distance`, `decay`), spot (`angle`, `penumbra`, `target`), rect (`width`, `height`).

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

`addTrack` replaces an existing track with the same target. Values: numbers, [x, y, z], colours, booleans. `loop`: true, false or `"pingpong"`. A track on a property that a behaviour also drives (e.g. `position.y` + `float`) fights it: animate a parent group instead.

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
  { "op": "set", "path": "postfx", "value": [{ "type": "bloom", "strength": 0.5, "threshold": 0.85 }, { "type": "vignette", "darkness": 0.9 }] },
  { "op": "merge", "path": "target", "value": { "posterTime": 2, "reducedMotion": "static", "maxDpr": 1.5 } },
  { "op": "set", "path": "ariaLabel", "value": "Golden Crust Bakery: a warm 3D title with floating pastries" },
  { "op": "remove", "path": "postfx" }
]
```

## Validation messages you will meet

- `unknown-param` (warning): a parameter the catalog doesn't know is ignored. The hint suggests the right name (e.g. `cylinder` takes `radiusTop` / `radiusBottom`, not `radius`).
- `unknown id` / "did you mean" (error): a geometry, preset, behaviour, generator… that doesn't exist.
- Range / type errors: the message gives the allowed range from the catalog.
- `invalid` from an op (no such id, bad path): fix the op; nothing was written.
