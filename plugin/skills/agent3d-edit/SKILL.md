---
name: agent3d-edit
description: Change an existing Agent3D project - summarise the scene, then patch objects, materials, lights, camera, background, timeline keyframes and behaviours, rebrand it (swap the text, colours, logo), re-time animations, fix framing on phones, and re-render to check every change visually. Use when the user wants to modify a 3D banner, hero, character, landscape, product scene or game that already exists as an Agent3D project folder (scene.json), or a template.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge) for renders.
metadata:
  version: "0.1.0"
  repository: "https://github.com/fleox/agent3d"
allowed-tools: Bash Read Write
---

# Edit an Agent3D project

A project is a folder with `agent3d.json`, `scene.json` (the scene), `assets/` (+ `assets/manifest.json` with licences), `scripts/`, `renders/` and `dist/` (exports). Edit it through the CLI, not by hand: patches are validated and atomic, and the plan tells you exactly what changed.

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `npx -y @fleox/agent3d@0.1.0 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## 1. Understand before changing

```bash
npx -y @fleox/agent3d@0.1.0 info --project my-banner --json
npx -y @fleox/agent3d@0.1.0 scene summary --project my-banner --json
npx -y @fleox/agent3d@0.1.0 render --project my-banner --sheet --json
```

Look at the sheet (Read the `data.sheet` PNG, relative to the project folder `data.dir`), then tell the user in two or three sentences what the scene contains (target and aspect, the main objects, the motion) before proposing changes. Read details on demand:

```bash
npx -y @fleox/agent3d@0.1.0 object get title --project my-banner --json
npx -y @fleox/agent3d@0.1.0 scene get --path objects#title.material --project my-banner --json
npx -y @fleox/agent3d@0.1.0 timeline get --project my-banner --json
npx -y @fleox/agent3d@0.1.0 catalog behaviours float --json
```

## 2. Patch

Put the ops in a file (or pass them inline as one JSON argument) and apply:

```bash
npx -y @fleox/agent3d@0.1.0 scene patch --project my-banner --file ops.json --dry-run --json
npx -y @fleox/agent3d@0.1.0 scene patch --project my-banner --file ops.json --json
```

| Op | Shape | Use |
|---|---|---|
| `set` | `{ "op": "set", "path": "camera.position", "value": [0, 1, 9] }` | Replace a value (creates missing keys) |
| `merge` | `{ "op": "merge", "path": "target", "value": { "posterTime": 2, "height": null } }` | Deep merge (RFC 7396: `null` deletes a key) |
| `remove` | `{ "op": "remove", "path": "postfx[1]" }` | Delete a value (plan, needs `--yes`) |
| `addObject` | `{ "op": "addObject", "object": { … }, "parent": "group-id", "index": 0 }` | New object (top level without `parent`) |
| `updateObject` | `{ "op": "updateObject", "id": "title", "set": { "text": "Hello", "size": 0.9 } }` | Deep merge into an object (`id` and `children` can't change) |
| `removeObject` | `{ "op": "removeObject", "id": "pill" }` | Delete with its children and its timeline tracks (plan, needs `--yes`) |
| `moveObject` | `{ "op": "moveObject", "id": "gem", "parent": "props" }` | Re-parent (`"parent": null` = top level) or reorder (`index`) |
| `addBehaviour` | `{ "op": "addBehaviour", "id": "key", "behaviour": { "type": "flicker", "amount": 0.2 } }` | Append a behaviour to an object or a light |
| `addTrack` | `{ "op": "addTrack", "track": { "target": "title.rotation.y", "keys": [[0, -5], [4, 5], [8, -5]], "ease": "inOutSine" } }` | Add or replace a timeline track (creates the timeline) |
| `removeTrack` | `{ "op": "removeTrack", "target": "title.rotation.y" }` | Delete a track (plan, needs `--yes`) |

**Paths**: `camera.fov`, `lights[0].intensity`, `lights#key.color` (a light by id), `objects#title.material.color` (an object by id anywhere in the tree), `objects#torus.position[1]` (one coordinate), `environment.background`, `target.posterTime`, `postfx[0].strength`.

**The deep-merge gotcha**: `updateObject` / `merge` keep keys you don't mention. Switching a material preset that way keeps the old `color`, `roughness`… (gold stays white). Replace the whole material with `set` on `objects#<id>.material` when you change the look; use `updateObject` for small tweaks (`{ "material": { "color": "#ff3366" } }`).

Shortcuts for one object (same validation, same plans):

```bash
npx -y @fleox/agent3d@0.1.0 object update title --set material.color="#ffd166" --set size=0.9 --project my-banner --json
npx -y @fleox/agent3d@0.1.0 object add --id ball --geometry sphere --set geometry.radius=0.4 --set 'position=[3,0,0]' --project my-banner --json
npx -y @fleox/agent3d@0.1.0 object move gem --parent props --project my-banner --json
npx -y @fleox/agent3d@0.1.0 object remove pill --project my-banner --json
npx -y @fleox/agent3d@0.1.0 object remove pill --yes --project my-banner --json
```

`--set` takes dotted keys and JSON values (`--set 'position=[0,1,0]'`, `--set visible=false`). More recipes per task (materials, lights, camera, timeline, behaviours, post effects): [references/patch-ops.md](references/patch-ops.md).

## 3. Timeline and behaviours

- **Behaviours** are procedural, per object or light, always running (or `when`: hover, click, visible, scroll; `delay` in seconds). Change parameters with `updateObject` on `behaviours` (an array: `set` it whole) or a path like `objects#title.behaviours[1].speed`.
- **Timeline** tracks animate a property between keyframes: `target` is `<objectId>.<property>` (`position`, `position.x`, `rotation.y` in degrees, `scale`, `visible`, `material.opacity`, `material.color`, `material.emissiveIntensity`), `camera.position` / `camera.target` / `camera.fov`, `<lightId>.intensity` / `<lightId>.color`. Keys are `[time, value]` sorted by time; `ease` is linear, in/out/inOut Quad, Cubic, Sine, Expo, Back, outElastic, outBounce or step.
  ```bash
  npx -y @fleox/agent3d@0.1.0 timeline set --duration 10 --loop true --trigger visible --project my-banner --json
  npx -y @fleox/agent3d@0.1.0 timeline add-track --target logo.rotation.y --keys "[[0,0],[10,360]]" --project my-banner --json
  npx -y @fleox/agent3d@0.1.0 timeline remove-track --target logo.rotation.y --yes --project my-banner --json
  ```
- Loops: the last key equals the first. Triggers: `load`, `visible` (default), `hover`, `click`, `scroll` (time = scroll progress).
- Re-timing everything: change `duration`, then the key times of each track (a patch `set` on `timeline.tracks[i].keys`).

## 4. Rebrand

1. Text: `updateObject` with the new `text` (check the length: banner titles wider than ~11 units collide with the props; lower `size` or move the props). `ariaLabel` and `title` too.
2. Colours: the background (`environment.background`), materials of the main objects (`set` the material), the rim light colour, particle `color`, HUD `ui.color` / `ui.accent` in games. Keep the structure of the palette (dark background tones, light subject, one accent).
3. Logo: an SVG becomes extruded 3D with `{ "kind": "svg", "src": "assets/svg/logo.svg", "size": 3, "depth": 0.2 }` (add the file with `assets add ./logo.svg --license proprietary`). Flat colour SVGs work best.
4. Fonts: `sans-bold`, `sans`, `serif-bold`, `mono`, `display` (bundled; no web fonts).
5. Render, compare with the previous sheet, and show both to the user if they asked for options.

## 5. Check on phones

The embed keeps the scene's aspect ratio at every width. A 4:1 banner is only ~98 px tall on a 390 px phone:

```bash
npx -y @fleox/agent3d@0.1.0 render --project my-banner --size 390x98 --scale 2 --frames 2 --json
```

If the title becomes unreadable: shorter text, bigger `size`, fewer props, or a separate mobile version (a copy of the project with `target.aspect` "4:3" or `target.height`, exported under another `--name`, switched with CSS media queries on the page).

## 6. Finish

`npx -y @fleox/agent3d@0.1.0 check --project my-banner --render --json` until no errors and no warnings, then re-export (`export --yes` overwrites the previous export folder; tell the user to re-upload `<name>/` and, after an Agent3D update, `agent3d-runtime/`). Skill `agent3d-publish` covers the site side.

## Rules

- Summarise and render before editing; render after every meaningful change and look at it.
- Prefer patches over rewriting `scene.json`; never edit `assets/manifest.json` by hand (`assets add|remove`).
- Plans with `needsConfirmation: true` wrote nothing: show the user what will be removed or replaced and get their agreement before re-running with `--yes`.
- Don't rename ids casually: timelines, behaviours, cameras (`follow.target`), HUD elements and scripts refer to them.
