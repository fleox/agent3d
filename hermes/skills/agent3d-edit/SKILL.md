---
name: agent3d-edit
description: "Change an existing Agent3D project - summarise the scene, then patch objects, materials and textures, lights and light rigs, sky / fog / background, camera and camera shots, post effects and looks, timeline keyframes (easing, stagger, letters, segments, scroll), behaviours and hover / click interactions, rebrand it (swap the text, colours, logo), re-time animations, fix framing on phones, and re-render to check every change visually. Use when the user wants to modify a 3D banner, hero, character, landscape, product scene or game that already exists as an Agent3D project folder (scene.json), or a template."
version: 0.2.2
author: Agent3D
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [Agent3D, 3D, WebGL, Editing, Rebrand]
    related_skills: [agent3d-create, agent3d-assets, agent3d-game, agent3d-publish]
---

# Edit an Agent3D project

A project is a folder with `agent3d.json`, `scene.json` (the scene), `assets/` (+ `assets/manifest.json` with licences), `scripts/`, `renders/` and `dist/` (exports). Edit it through the CLI, not by hand: patches are validated and atomic, and the plan tells you exactly what changed.

**Language:** talk to the user in their language; keep commands, ids and files in English.

Every command is `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Running the commands (Hermes)

Every `agent3d <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agent3d.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only), **Node.js 22+** and, for renders, posters and videos, Google Chrome / Chromium / Edge. The Agent3D engine is the `@fleox/agent3d` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENT3D_CMD` overrides the engine command (e.g. `node /path/to/agent3d/dist/agent/agent3d.mjs` from a clone); `AGENT3D_CHROME` points at a browser binary.
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agent3d import run, patch, needs_confirmation, Agent3dError` — `run("scene", "summary", project="my-banner")` returns `data` and raises `Agent3dError(code, message, hint, details)` when `ok` is false (validation issues are in `details["issues"]`); `patch(ops, project=…)` sends patch ops on stdin.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)`. Show the plan to the user before re-running with `--yes`.
- **Looking at renders:** `render` returns PNG paths (`data.sheet`, `data.frames`). Open them with your vision / image tool; if you can't view images, rely on `data.inspect` and `check --render` and tell the user you couldn't check the look.
- **Long-running commands** (`serve`, `studio`, `mcp`) need the user's own terminal: give them the command instead of running it.
- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):
  - `render_and_check.py`: Renders an Agent3D project headless (contact sheet + frames) and runs `check`, then prints the image paths to look at and a compact verdict.

## 1. Understand before changing

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py info --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene summary --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project my-banner --sheet --json
```

Look at the sheet (Read the `data.sheet` PNG, relative to the project folder `data.dir`), then tell the user in two or three sentences what the scene contains (target and aspect, the main objects, the motion) before proposing changes. Read details on demand:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py object get title --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene get --path objects#title.material --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py timeline get --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py catalog behaviours float --json
```

## 2. Patch

Put the ops in a file (or pass them inline as one JSON argument) and apply:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene patch --project my-banner --file ops.json --dry-run --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py scene patch --project my-banner --file ops.json --json
```

| Op | Shape | Use |
|---|---|---|
| `set` | `{ "op": "set", "path": "camera.position", "value": [0, 1, 9] }` | Replace a value (creates missing keys; replacing a whole collection — `lights`, `postfx`, `objects`, `timeline.tracks`, `ui.elements`… — is a plan that needs `--yes`) |
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
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py object update title --set material.color="#ffd166" --set size=0.9 --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py object add --id ball --geometry sphere --set geometry.radius=0.4 --set 'position=[3,0,0]' --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py object move gem --parent props --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py object remove pill --project my-banner --json
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py object remove pill --yes --project my-banner --json
```

`--set` takes dotted keys and JSON values (`--set 'position=[0,1,0]'`, `--set visible=false`). More recipes per task (materials, lights, camera, timeline, behaviours, post effects): [references/patch-ops.md](references/patch-ops.md).

## 3. Timeline, behaviours and interactions

- **Behaviours** are procedural, per object or light, always running (or `when`: hover, click, visible, scroll; `delay` in seconds). Change parameters with `updateObject` on `behaviours` (an array: `set` it whole) or a path like `objects#title.behaviours[1].speed`.
- **Timeline** tracks animate a property between keyframes. `target` is `<selector>.<property>`:
  - selector: an object or light id, `camera`, `environment`, `postfx`, a comma list `a,b`, `tag:<tag>`, `children:<id>`, or one letter of a text `<textId>/<n>` (needs `splitLetters` or `reveal` on the text; n counts non-space characters from 0);
  - property: `position`, `position.x`, `rotation.y` (degrees), `scale`, `visible`, `material.opacity` / `color` / `emissiveIntensity` / `roughness`…, `material.uniforms.<name>`; lights `intensity`, `color`; camera `position`, `target`, `fov`, `focus`; `environment.fog.density`, `environment.exposure`; `postfx.<type>.<param>` (an effect written in `postfx` or brought by a `look` preset, e.g. `postfx.bloom.strength` with `{ "type": "look", "preset": "product" }`); models `morph.<name>`, `animation.<clip>.weight`.
- **Keys** are `[time, value]` or `[time, value, ease]` (the ease shapes the segment ending at that key) sorted by time. Values: numbers, `[x, y, z]`, colours, booleans, or relative strings `"+=0.5"`, `"-=1"`, `"*=1.2"` (from the rest value). The track `ease` (default `linear`) is `step`, `in` / `out` / `inOut` + `Quad`, `Cubic`, `Quart`, `Quint`, `Sine`, `Expo`, `Circ`, `Back`, `Elastic`, `Bounce`, or `"cubicBezier(0.16, 1, 0.3, 1)"`, `"spring(170, 12)"`, `"steps(4)"`. Multi-target selectors take `stagger` (seconds between targets) and `staggerFrom` (`start`, `end`, `center`, `edges`, `random`). Colour keys blend in OKLCh (saturated midpoints); `"colorSpace": "rgb"|"oklab"|"hsl"` on the track changes it.
  ```bash
  python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py timeline set --duration 10 --loop true --trigger visible --project my-banner --json
  python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py timeline add-track --target logo.rotation.y --keys "[[0,0],[10,360]]" --project my-banner --json
  python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py timeline add-track --target gem.position.y --keys '[[0,"+=0"],[1,"+=0.6","outBack"],[2,"+=0","inOutSine"]]' --project my-banner --json
  python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py timeline remove-track --target logo.rotation.y --yes --project my-banner --json
  ```
- Loops: the last key equals the first. Triggers: `load`, `visible` (default), `hover`, `click`, `scroll` (time = scroll progress; tune with `timeline.scroll`), `manual` (only interactions move it).
- **Markers and segments** name moments and ranges (`markers: { "lifted": 2.6 }`, `segments: { "hover-in": [2, "lifted"] }`); `autoplay: "intro"` plays only that segment on the trigger. **Interactions** (`scene.interactions`) wire hover / click / scroll / key / marker events to actions: play or toggle a segment, tween a property (`set`), `openUrl` (click / key only), emit an event, play a model clip. Agents on MCP or `tools call` can use the `interactions_set` tool (`{ "add": [...] }` or `{ "interactions": [...] }`, `dryRun`).
- **Camera shots** (`camera.shots`: pushIn, pullOut, dolly, truck, pedestal, crane, orbit, zoom, move, path, lookAt, focus) are cinematic moves on the timeline clock; `camera.shake` adds handheld noise.
- Re-timing everything: change `duration`, then the key times of each track (a patch `set` on `timeline.tracks[i].keys`). Patches for all of the above: [references/patch-ops.md](references/patch-ops.md).
- Check a hover or click state: `render --input '[{"t": 1.9, "pointer": [0, -0.3]}]' --frames 2,3` (coordinates -1..1, y up; `"click": [x, y]` clicks).

## 4. Rebrand

1. Text: `updateObject` with the new `text` (check the length: banner titles wider than ~11 units collide with the props; lower `size` or move the props). `ariaLabel` and `title` too.
2. Colours: the background (`environment.background`), materials of the main objects (`set` the material), the rim light colour, particle `color`, HUD `ui.color` / `ui.accent` in games. Keep the structure of the palette (dark background tones, light subject, one accent).
3. Logo: an SVG becomes extruded 3D with `{ "kind": "svg", "src": "assets/svg/logo.svg", "size": 3, "depth": 0.2 }` (add the file with `assets add ./logo.svg --license proprietary`). Each path keeps its SVG colour unless a `material` is set (`keepColors: true` keeps both), strokes become solid outlines (line icons work; `strokes: false` ignores them), `fit: "height"` sizes by height. `<text>` is not supported: outline the text in the design tool.
4. Fonts: 13 bundled fonts (`catalog fonts`: `sans-bold` default, `inter-black`, `montserrat-extrabold`, `space-grotesk-bold`, `bebas-neue`, `anton`, `serif-bold`, `serif`, `mono`, `display`, `pacifico`, `lobster`…; no web fonts). Kerning is on by default; `letterSpacing`, `maxWidth` (wraps), `outline`, `reveal` (letter-by-letter entrance).
5. Render, compare with the previous sheet, and show both to the user if they asked for options.

## 5. Check on phones

The embed keeps the scene's aspect ratio at every width. A 4:1 banner is only ~98 px tall on a 390 px phone:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py render --project my-banner --size 390x98 --scale 2 --frames 2 --json
```

If the title becomes unreadable: shorter text, bigger `size`, fewer props, or a separate mobile version (a copy of the project with `target.aspect` "4:3" or `target.height`, exported under another `--name`, switched with CSS media queries on the page).

## 6. Finish

`python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py check --project my-banner --render --json` until no errors and no warnings, then re-export (`export --yes` overwrites the previous export folder; tell the user to re-upload `<name>/` and, after an Agent3D update, `agent3d-runtime/`). Skill `agent3d-publish` covers the site side.

## Rules

- Summarise and render before editing; render after every meaningful change and look at it.
- Prefer patches over rewriting `scene.json`; never edit `assets/manifest.json` by hand (`assets add|remove`).
- Plans with `needsConfirmation: true` wrote nothing: show the user what will be removed or replaced and get their agreement before re-running with `--yes`.
- Don't rename ids casually: timelines, behaviours, cameras (`follow.target`), HUD elements and scripts refer to them.
