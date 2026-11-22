# The `agent3d` CLI

`agent3d` is the command-line front door of the Agent3D engine: the same operations as the Studio, the MCP server and the AI tools (`src/ops/`), plus headless renders and exports. It is one bundled file (`dist/agent/agent3d.mjs`, no runtime dependency) published as the npm package `@fleox/agent3d`.

```bash
npx -y @fleox/agent3d@0.2.0 help
npx -y @fleox/agent3d@0.2.0 help scene --json
```

Requirements: Node.js 22+ (20 works for everything except renders, which drive Chrome through Node's global `WebSocket`); Google Chrome, Chromium, Edge or Brave for `render`, `check --render`, posters and videos (`agent3d doctor` checks both).

## Conventions

- **Project**: every project command takes `--project <dir>` (default: the current directory). A project is a folder with `agent3d.json` and `scene.json` (see [scene-format.md](scene-format.md)).
- **`--json`**: prints exactly one object on stdout, `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint", "details"? } }`. Progress and logs go to stderr. Without `--json` the output is human-readable.
- **Exit codes**: 0 success, 1 failure (including `check` when the project is not ok, with `ok: true` and the report in `data`), 2 usage or validation errors.
- **Hints**: every error a user can hit carries a `hint` saying what to do. Validation errors carry `details.issues` (`{ severity, code, path, message, hint }`, paths like `objects#logo.material.roughness`).
- **Plans**: destructive or overwriting commands print `{ "needsConfirmation": true, "plan": … }` and write nothing unless `--yes`: `scene apply`, `scene patch` with removals, `object remove`, `timeline remove-track`, `export` into a non-empty folder, `assets remove`. Agents show the plan and ask before re-running with `--yes`.
- **JSON inputs**: `--file <path>` or `--file -` (stdin) for `scene apply|patch|validate` and `timeline set`; a positional `@file`, `-` or inline JSON works too. `--json-def` for `object add|update` and `timeline add-track`, `--input` for `tools call`, `--hit` for `assets add`.
- **Network**: only `assets search` and `assets add --hit` use the network (free, account-less CC0 sources). Everything else is local.

## Environment variables

| Variable | Effect |
|---|---|
| `AGENT3D_CHROME` | Path of the browser binary used for renders (default: the installed Chrome / Chromium / Edge / Brave) |
| `AGENT3D_DIST` | Folder holding `runtime/` and `studio/` builds (default: next to the CLI file) |
| `AGENT3D_LIBRARY` | Folder of the built-in asset library (default: the package's `library/`) |
| `AGENT3D_TEMPLATES` | Folder of the templates (default: the package's `templates/`) |

## A typical session

```bash
npx -y @fleox/agent3d@0.2.0 new bakery --target banner --title "Golden Crust Bakery" --json
npx -y @fleox/agent3d@0.2.0 catalog behaviours --json
npx -y @fleox/agent3d@0.2.0 scene patch --project bakery --file ops.json --json
npx -y @fleox/agent3d@0.2.0 render --project bakery --sheet --json      # look at data.sheet
npx -y @fleox/agent3d@0.2.0 check --project bakery --render --json
npx -y @fleox/agent3d@0.2.0 export --project bakery --json              # data.snippet, data.out
```

## Command reference

Generated from the CLI's own command list (`help --json`); `npm test` fails when it is stale.

<!-- BEGIN GENERATED: command reference (node scripts/build-cli-docs.mjs) -->

| Command | What it does |
|---|---|
| [`help`](#help) | List commands with their subcommands and options (--json gives a machine-readable list). |
| [`version`](#version) | Print the Agent3D version (CLI = runtime = skills version). |
| [`new`](#new) | Create a project folder (agent3d.json, scene.json, assets/, scripts/) — empty for its target, or from a template (`templates list`). |
| [`info`](#info) | Project overview: manifest, target, scene summary (objects, lights, camera, timeline), assets and the latest renders. |
| [`scene`](#scene) | Read, replace, patch and validate scene.json (the SceneDoc). apply / patch print a plan; destructive changes need --yes. |
| [`object`](#object) | Add, change, remove, list, inspect and re-parent scene objects (shortcuts over scene patch). |
| [`timeline`](#timeline) | Keyframe timeline: read it, replace it, add or remove a track (target "<objectId>.<property>", keys [[t, value], …]). |
| [`catalog`](#catalog) | What scenes can use, with parameters: geometries, materialPresets, shaders, textures, lightRigs, behaviours, generators, particlePresets, postfx, fonts, sounds. No section → sections with counts; a section → its entries; an id → the full entry (params, defaults, ranges, example). |
| [`templates`](#templates) | Starter projects (`agent3d new <dir> --template <id>`): list them, or show one (metadata + its scene summary). |
| [`check`](#check) | Pre-export checks: validation, missing assets / scripts, script sandbox lint, budget (triangles, KB), licences needing attribution; with --render also framing and runtime stats from a headless render. Exit 1 when not ok. |
| [`render`](#render) | Render the scene headless (installed Chrome, deterministic time) to PNGs — LOOK at them to check framing, colours, motion. Returns { dir, frames: [{ t, path }], sheet?, state, stats, inspect, issues, consoleErrors } (paths relative to the project folder `dir`). Games: --input plays a script of simulated keys / clicks / drags / swipes and `state` shows the result (e.g. the score). Media: --video (MP4 H.264 / WebM VP9), --gif or --webp (animated) render every frame exactly at any --fps / --duration / --size and return { path, format, codec, frames, fps, duration, size, bytes }. |
| [`serve`](#serve) | Live preview of the project on 127.0.0.1 (scene at its aspect ratio, play / pause, time scrubber): scene.json edits update the open page instantly, asset / script edits reload it. Runs until stopped (Ctrl+C). |
| [`studio`](#studio) | Open the Studio (visual editor: viewport, outliner, inspector, timeline, catalog, templates, assistant) on this computer, editing the project folder through a local API. Runs until stopped (Ctrl+C). |
| [`export`](#export) | Export for a website: embed (Web Component + static files + EMBED.md + React/Vue/Svelte wrappers, default), zip (the embed folder as one .zip), single-html (one file), poster (still image), video (MP4 H.264 / WebM VP9) or gif. Overwriting a non-empty --out needs --yes. |
| [`assets`](#assets) | Project assets (assets/ + manifest with licences): list, search free CC0 sources (Poly Haven, ambientCG, Kenney, Quaternius, Khronos), add (local file or a search hit — downloaded once into the project), optimize (smart-size + WebP textures, meshopt .glb geometry), remove, and browse the built-in library. |
| [`tools`](#tools) | The AI tool catalog (src/ai/tools.ts + render_preview) — exactly what the MCP server and the Studio assistant expose: list the tools with their JSON schemas, or call one with a JSON input. |
| [`mcp`](#mcp) | Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2025-03-26 / 2024-11-05): tools = the AI catalog + render_preview (returns the contact sheet as an image), resources = scene, summary, catalog. For Claude Desktop / Claude Code / Cursor. |
| [`doctor`](#doctor) | Check the setup: Node version, installed Chrome (+ version), the runtime / Studio builds, library and templates, and a headless WebGL test render of a 1-object scene (in a temp folder). A failed required check makes the command fail (exit 1, error code doctor-failed, one hint per failed check, every check in error.details.checks). |

Global options (every command): `--json` (Print one JSON object on stdout: { ok, data } or { ok: false, error: { code, message, hint } }), `--help` (Show the command's usage and options instead of running it).

### help

List commands with their subcommands and options (--json gives a machine-readable list).

```
agent3d help [<command>]
```

### version

Print the Agent3D version (CLI = runtime = skills version).

```
agent3d version
```

### new

Create a project folder (agent3d.json, scene.json, assets/, scripts/) — empty for its target, or from a template (`templates list`).

```
agent3d new <dir> [--template <id>] [--title <text>] [--target banner|hero|card|square|fullscreen|inline|game] [--aspect W:H]
```

| Option | Description |
|---|---|
| `--template <value>` | Start from this template (`agent3d templates list`). |
| `--title <value>` | Scene title (also its accessible label). |
| `--target <value>` | Where it is shown: banner, hero, card, square, fullscreen, inline, game (sets the default aspect). |
| `--aspect <value>` | Aspect ratio "W:H" (e.g. 4:1, 16:9, 1:1). |
| `--name <value>` | Project name (default: the folder name). |
| `--force` | Overwrite an existing project in the folder. |

_Writes to the project._

### info

Project overview: manifest, target, scene summary (objects, lights, camera, timeline), assets and the latest renders.

```
agent3d info [--project <dir>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |

### scene

Read, replace, patch and validate scene.json (the SceneDoc). apply / patch print a plan; destructive changes need --yes.

```
agent3d scene <get|summary|apply|patch|validate> [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `get` | `agent3d scene get [--path <json.path>]` | The full scene JSON, or the value at a path ("camera", "objects#logo.material"). |
| `summary` | `agent3d scene summary` | Compact outline: object tree (id, kind, geometry / generator / preset), lights, camera, timeline tracks, scripts. |
| `apply` | `agent3d scene apply --file <scene.json\|-> [--dry-run] [--yes]` | Replace the whole scene (validated). Prints the diff plan + needsConfirmation unless --yes. **Plan + `--yes`.** |
| `patch` | `agent3d scene patch --file <ops.json\|-> [--dry-run] [--yes]` | Apply patch ops ([{ "op": "set", "path": "camera.position", "value": [0,2,8] }, { "op": "addObject", "object": {…} }, …]). Removals need --yes. |
| `validate` | `agent3d scene validate [--file <scene.json\|->]` | Validate the project's scene (or a candidate file): issues with JSON paths, messages and hints. Exit 2 on errors. |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--file <value>` | Read the JSON input from this file (`-` = stdin). A positional @file / - / inline JSON works too. |
| `--path <value>` | get: a JSON path into the scene. |
| `--dry-run` | Compute the plan and the issues, write nothing. |
| `--yes` | Apply — only after the user confirmed the plan. |

### object

Add, change, remove, list, inspect and re-parent scene objects (shortcuts over scene patch).

```
agent3d object <add|update|remove|list|get|move> [<id>] [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `add` | `agent3d object add --json-def <json\|@file> \| --id <id> --geometry box [--set k=v …] [--parent <id>] [--index <n>]` | Add an object (validated). |
| `update` | `agent3d object update <id> [--json-def <json>] [--set k=v …]` | Change properties of an object (--set material.color=… changes only that key). |
| `remove` | `agent3d object remove <id> [--yes]` | Remove an object and its children (plan + needsConfirmation unless --yes). **Plan + `--yes`.** |
| `list` | `agent3d object list` | Every object (tree flattened): id, kind, geometry / generator / preset, parent, behaviours. |
| `get` | `agent3d object get <id>` | One object's full definition. |
| `move` | `agent3d object move <id> (--parent <id> \| --root) [--index <n>]` | Re-parent or reorder an object. |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--json-def <value>` | The object (add) or the properties to change (update) as JSON, @file or - (stdin). |
| `--set <value>` (repeatable) | key=value (dotted keys, JSON values), repeated: --set position=[0,1,0] --set material.color="#ff3366". |
| `--id <value>` | add: the new object's id ([a-zA-Z][a-zA-Z0-9_-]*). |
| `--kind <value>` | add: mesh, text, model, group, generator, particles, instances, svg. |
| `--geometry <value>` | add: geometry type (implies kind mesh) — `agent3d catalog geometries`. |
| `--generator <value>` | add: generator id (implies kind generator) — `agent3d catalog generators`. |
| `--preset <value>` | add: particle preset (implies kind particles) — `agent3d catalog particlePresets`. |
| `--text <value>` | add: the text (implies kind text). |
| `--src <value>` | add: model / svg source (project path or library:<id>). |
| `--parent <value>` | add / move: parent object id. |
| `--root` | move: to the top level. |
| `--index <value>` | add / move: position among the siblings. |
| `--dry-run` | Compute the plan and the issues, write nothing. |
| `--yes` | Apply — only after the user confirmed the plan. |

### timeline

Keyframe timeline: read it, replace it, add or remove a track (target "<objectId>.<property>", keys [[t, value], …]).

```
agent3d timeline <get|set|add-track|remove-track> [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `get` | `agent3d timeline get` | The timeline (duration, loop, trigger, tracks). |
| `set` | `agent3d timeline set --file <timeline.json\|-> \| [--duration <s>] [--loop true\|false\|pingpong] [--trigger load\|visible\|hover\|click\|scroll\|manual]` | Replace the timeline, or change its settings. |
| `add-track` | `agent3d timeline add-track --target <obj.prop> --keys <json> [--ease <name>] \| --json-def <track>` | Add a track, e.g. --target logo.rotation.y --keys "[[0,0],[4,360]]". |
| `remove-track` | `agent3d timeline remove-track --target <obj.prop> [--yes]` | Remove the track(s) of a target. **Plan + `--yes`.** |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--file <value>` | Read the JSON input from this file (`-` = stdin). A positional @file / - / inline JSON works too. |
| `--duration <value>` | set: duration in seconds. |
| `--loop <value>` | set: true, false or pingpong. |
| `--trigger <value>` | set: load, visible, hover, click, scroll or manual (started by an interaction or a script). |
| `--target <value>` | add-track / remove-track: "<objectId>.<property path>" (e.g. logo.position.y, camera.position). |
| `--keys <value>` | add-track: [[time, value], …] as JSON. |
| `--ease <value>` | add-track: easing (linear, inOutCubic, outBack, outElastic, …). |
| `--json-def <value>` | add-track: the whole track as JSON. |
| `--dry-run` | Compute the plan and the issues, write nothing. |
| `--yes` | Apply — only after the user confirmed the plan. |

### catalog

What scenes can use, with parameters: geometries, materialPresets, shaders, textures, lightRigs, behaviours, generators, particlePresets, postfx, fonts, sounds. No section → sections with counts; a section → its entries; an id → the full entry (params, defaults, ranges, example).

```
agent3d catalog [<section>] [<id>]
```

### templates

Starter projects (`agent3d new <dir> --template <id>`): list them, or show one (metadata + its scene summary).

```
agent3d templates <list|show> [<id>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agent3d templates list` | Templates with id, title, kind, tags and description. |
| `show` | `agent3d templates show <id>` | A template's metadata, files and scene. |

### check

Pre-export checks: validation, missing assets / scripts, script sandbox lint, budget (triangles, KB), licences needing attribution; with --render also framing and runtime stats from a headless render. Exit 1 when not ok.

```
agent3d check [--project <dir>] [--render [--out <dir>]]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--render` | Also render one frame headless (Chrome) for real triangle counts and framing (objects out of view, camera inside an object). The frame goes to a temporary folder (its absolute path is in `render`) unless --out is given. |
| `--out <value>` | --render: folder for the frame, relative to the project folder (e.g. renders). |

### render

Render the scene headless (installed Chrome, deterministic time) to PNGs — LOOK at them to check framing, colours, motion. Returns { dir, frames: [{ t, path }], sheet?, state, stats, inspect, issues, consoleErrors } (paths relative to the project folder `dir`). Games: --input plays a script of simulated keys / clicks / drags / swipes and `state` shows the result (e.g. the score). Media: --video (MP4 H.264 / WebM VP9), --gif or --webp (animated) render every frame exactly at any --fps / --duration / --size and return { path, format, codec, frames, fps, duration, size, bytes }.

```
agent3d render [--frames 0,1.5,3 | --count 4] [--size 1200x300] [--scale 2] [--quality draft|standard|high|ultra] [--transparent] [--scroll 0.5] [--sheet] [--input <json|@file>] [--isolate <objectId>] [--bg checker|<colour>|none] [--out renders/] | --video out.mp4|out.webm [--fps 30] [--duration 6] | --gif out.gif | --webp out.webp [--project <dir>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--frames <value>` | Comma-separated times in seconds. |
| `--count <value>` | Number of frames spread over the timeline (default 4). |
| `--size <value>` | Viewport WIDTHxHEIGHT in CSS pixels (default: width 1200 at the target aspect). |
| `--width <value>` | Viewport width when --size is not given (default 1200). |
| `--scale <value>` | Device pixel ratio (default 1; 2 = retina-sharp). |
| `--sheet` | Also compose a contact sheet (grid with time labels) — the one image to look at. |
| `--cols <value>` | Contact sheet columns (default: from the aspect). |
| `--capture <value>` | canvas (WebGL canvas only), page (includes the HUD / DOM overlays) or auto (page when the scene has a ui; default). |
| `--input <value>` | Games: simulated input applied while seeking, JSON array / @file / - : [{"t": 0.5, "key": "ArrowRight", "hold": 1}, {"t": 2, "key": "Space", "down": true}, {"t": 3, "click": [0, 0]}, {"t": 3, "pointer": [0.5, -0.2], "down": true}, {"t": 4, "pointerUp": true}, {"t": 1, "pointerDown": [0, 0]}, {"t": 1, "drag": {"from": [-0.5, 0], "to": [0.5, 0], "duration": 0.4}}, {"t": 2, "swipe": "left"}] (key = KeyboardEvent.code, coordinates -1..1, y up; unknown fields are rejected). Frames render in time order. |
| `--isolate <value>` | Render only this object (behaviours, scripts, UI dropped), at the origin, auto-framed from the front (+Z) three-quarter view on a neutral background (default 800x800, 1 frame) — to check a model's orientation and size. Returns isolated { size, center }. |
| `--bg <value>` | Background drawn under the frames: "checker", a CSS colour ("#fff", "rgb(…)", "white") or "none". Default: a checkerboard under the contact sheet of transparent scenes (frames keep their alpha). |
| `--out <value>` | Output folder, relative to the project folder (default <project>/renders). |
| `--quality <value>` | Supersampling: draft / standard (1×, default), high (2×), ultra (3×) — rendered larger and downscaled for smoother edges and detail (clamped to 4096 px). |
| `--transparent` | Render with a transparent canvas (alpha PNG / GIF / WebP) even if the scene has a background. |
| `--scroll <value>` | Scroll progress 0..1 for scroll-driven scenes (e.g. 0.5 = half-way through the page). Renders one frame unless --frames / --count are given. |
| `--video <value>` | Render a video file instead of PNGs (default 1280 px wide): .mp4 (H.264, needs Google Chrome) or .webm (VP9), path relative to the project folder. Frame-exact; see --fps, --duration, --start, --size, --quality. |
| `--gif <value>` | Render an animated GIF, path relative to the project folder (looping, global palette, frame differencing; default 640 px wide, 15 fps). |
| `--webp <value>` | Render an animated WebP, path relative to the project folder (smaller than GIF, alpha; default 800 px wide, 20 fps). |
| `--fps <value>` | Video / GIF / WebP frames per second (default 30 / 15 / 20, max 60). |
| `--duration <value>` | Video / GIF / WebP length in seconds (default the timeline duration, else 5). |
| `--start <value>` | Video / GIF / WebP start time in seconds (default 0). |
| `--bitrate <value>` | Video bitrate in Mbit/s (default from size, fps and --quality). |
| `--timeout <value>` | Seconds to wait for the scene to load (default 60). |
| `--yes` | --video / --gif / --webp: overwrite an existing file. |

_Writes to the project._

### serve

Live preview of the project on 127.0.0.1 (scene at its aspect ratio, play / pause, time scrubber): scene.json edits update the open page instantly, asset / script edits reload it. Runs until stopped (Ctrl+C).

```
agent3d serve [--port <n>] [--open] [--project <dir>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--port <value>` | First port to try (default 4321; 0 = any free port). |
| `--open` | Open the preview in the default browser. |

### studio

Open the Studio (visual editor: viewport, outliner, inspector, timeline, catalog, templates, assistant) on this computer, editing the project folder through a local API. Runs until stopped (Ctrl+C).

```
agent3d studio [--port <n>] [--no-open] [--project <dir>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--port <value>` | First port to try (default 4320; 0 = any free port). |
| `--no-open` | Don't open a browser. |

### export

Export for a website: embed (Web Component + static files + EMBED.md + React/Vue/Svelte wrappers, default), zip (the embed folder as one .zip), single-html (one file), poster (still image), video (MP4 H.264 / WebM VP9) or gif. Overwriting a non-empty --out needs --yes.

```
agent3d export [--format embed|zip|single-html|poster|video|gif] [--out <path>] [--name <slug>] [--base-url <url>] [--cache-bust] [--no-integrity] [--no-poster] [--no-og] [--yes] [--project <dir>]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--format <value>` | embed (default), zip, single-html, poster, video or gif. |
| `--out <value>` | Output folder, relative to the project folder (embed / zip / single-html: default <project>/dist/<format>) or file (poster / video / gif: default <project>/dist/poster.webp, video.webm, animation.gif; a .mp4 --out renders H.264). |
| `--name <value>` | Scene folder / file name in the export (default: the project name). |
| `--base-url <value>` | embed / zip: URL of the export folder as seen from the pages (default "./"), e.g. /wp-content/uploads/agent3d/ or https://cdn.example.com/3d/ — the snippet then works from any page. |
| `--cache-bust` | embed / zip: versioned runtime folder (agent3d-runtime-<hash>/) and ?v=<hash> on the scene URL, so both can be cached for a year. |
| `--no-integrity` | embed / zip: no Subresource Integrity hash on the runtime <script> (default: integrity="sha384-…"). |
| `--no-extras` | embed / zip: skip EMBED.md and frameworks/ (React / Vue / Svelte wrappers). |
| `--no-poster` | embed / zip / single-html: don't render a poster nor og-image (no Chrome needed). |
| `--no-og` | embed / zip: don't render the 1200×630 og-image.png social preview. |
| `--optimize` | embed / zip / single-html: export optimised copies of the assets (project and library) — textures at the size the scene needs (format kept), .glb geometry meshopt-compressed with WebP textures. The project is not modified. Textures need Chrome. |
| `--image <value>` | poster: webp (default), png or jpeg. |
| `--time <value>` | poster: time in seconds (default target.posterTime). |
| `--duration <value>` | video / gif: seconds (default the timeline duration, else 5). |
| `--fps <value>` | video / gif: frames per second (default 30 / 15). |
| `--quality <value>` | poster / video / gif: draft, standard (default), high (2× supersampling) or ultra (3×). |
| `--transparent` | poster (png / webp) / gif: transparent background. |
| `--size <value>` | poster / video / gif: WIDTHxHEIGHT in CSS pixels (default: at the target aspect, width 1200 for a poster, 960 for a video, 640 for a gif). |
| `--scale <value>` | poster: device pixel ratio (default 2). |
| `--timeout <value>` | Seconds to wait for the scene to load (default 60). |
| `--yes` | Apply — only after the user confirmed the plan. |

_Writes to the project._

### assets

Project assets (assets/ + manifest with licences): list, search free CC0 sources (Poly Haven, ambientCG, Kenney, Quaternius, Khronos), add (local file or a search hit — downloaded once into the project), optimize (smart-size + WebP textures, meshopt .glb geometry), remove, and browse the built-in library.

```
agent3d assets <list|search|add|optimize|remove|library> [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agent3d assets list` | The project's assets (path, kind, size on disk, source, licence). Read-only; `stale` lists manifest entries whose recorded size differs from the file. |
| `search` | `agent3d assets search <query> [--kind model\|texture\|hdri] [--source polyhaven\|ambientcg\|kenney\|quaternius\|khronos]` | Search free, account-less CC0 sources (network). Hits can be added with `assets add --hit '<json>'`. |
| `add` | `agent3d assets add <file> [--kind <k>] [--path assets/…] [--license CC0-1.0] [--author <name>] \| assets add <pack.zip> --source kenney\|quaternius\|local --license CC0-1.0 [--filter <word>]… [--name <pack>] \| assets add --hit <json\|@file> [--resolution 1k\|512] [--max-size <px>]` | Copy a local file into assets/, import a Kenney / Quaternius pack zip (only .glb/.gltf + textures, --filter keeps models whose path contains a word), or download a search hit (licence recorded in assets/manifest.json). Models return `bounds` (size w × h × d in model units + up-axis guess). --resolution below 1k (e.g. 512) downloads 1k and downscales (headless Chrome). |
| `optimize` | `agent3d assets optimize [<path>…] [--all] [--max-size <px>] [--format auto\|webp\|jpeg\|png\|keep] [--quality 80] [--compress meshopt\|none] [--simplify <ratio>] [--simplify-error 0.01] [--dry-run] [--yes]` | Make textures and models lighter. Textures (.jpg / .png / .webp files and the images inside .glb models) get the size the scene needs — computed per texture from the target, the object's size on screen, the camera distance and the texture role (reported with the reason; --max-size forces one size) — and are re-encoded as WebP by default (standalone files are renamed and scene references rewritten; models use EXT_texture_webp). .glb geometry is welded, reordered and meshopt-compressed (EXT_meshopt_compression, decoded by the runtime), optionally simplified (--simplify 0.5). Files only change when they get smaller. Lossy: prints the plan (sizes + reasons, no Chrome needed) unless --yes; --dry-run encodes everything and reports the real savings without writing. Textures need headless Chrome (geometry does not). **Plan + `--yes`.** |
| `remove` | `agent3d assets remove <path> [--yes]` | Delete an asset and its manifest entry (plan + needsConfirmation unless --yes). **Plan + `--yes`.** |
| `library` | `agent3d assets library [--query <text>] [--kind <k>] [--limit 50] [--offset 0] [--all]` | Built-in CC0 assets shipped with Agent3D — reference them as "library:<id>" (no download). Shows animation clips and triangles of models; 50 results per page (`more: true` → next page with --offset, or --all). |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--kind <value>` | model, texture, hdri, audio, font, svg or other. |
| `--source <value>` | search: one source only. add: where the file / pack comes from (kenney, quaternius, local — default local). |
| `--filter <value>` (repeatable) | add <pack.zip>: only import models whose path contains this word (repeatable: --filter coin --filter flag). |
| `--name <value>` | add <pack.zip>: folder name under assets/models/ (default: the zip name). |
| `--query <value>` | search / library: text to look for. |
| `--limit <value>` | library: results per page (default 50). |
| `--offset <value>` | library: skip the first N results (paging). |
| `--all` | library: every match, no limit. optimize: every texture and .glb under assets/. |
| `--hit <value>` | add: a hit from `assets search` (JSON, @file or -). |
| `--resolution <value>` | add --hit: texture / HDRI resolution (1k, 2k…; default 1k). Lower values (512, 256) download 1k and downscale to that size. |
| `--max-size <value>` | optimize / add --hit: longest texture side in pixels, for every texture (optimize default: a smart size per texture from the scene; never upscales). |
| `--quality <value>` | optimize / add --hit: JPEG / WebP quality 1-100 (default 80; normal maps use at least 90). |
| `--format <value>` | optimize: texture output format — auto (default, WebP), webp, jpeg (images with alpha keep their format), png or keep. |
| `--compress <value>` | optimize: .glb geometry compression — meshopt (default) or none. |
| `--simplify <value>` | optimize: keep this fraction of each .glb mesh's triangles (e.g. 0.5), within --simplify-error. |
| `--simplify-error <value>` | optimize --simplify: max deviation as a fraction of the mesh size (default 0.01). |
| `--dry-run` | optimize: encode everything and report the savings, write nothing. |
| `--path <value>` | add: destination path in the project (default assets/<kind>/<file name>). |
| `--license <value>` | add: the file's licence (SPDX id, e.g. CC0-1.0, CC-BY-4.0). |
| `--author <value>` | add: author / attribution name. |
| `--source-url <value>` | add: where the file comes from. |
| `--yes` | Apply — only after the user confirmed the plan. |

### tools

The AI tool catalog (src/ai/tools.ts + render_preview) — exactly what the MCP server and the Studio assistant expose: list the tools with their JSON schemas, or call one with a JSON input.

```
agent3d tools <list|call> [<name>] [--input <json|@file|->] [--project <dir>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agent3d tools list` | Tools with description, input schema and whether they write. |
| `call` | `agent3d tools call <name> --input <json\|@file\|->` | Run one tool against the project. |

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--input <value>` | call: the tool input as a JSON object, @file or - (stdin). |

### mcp

Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2025-03-26 / 2024-11-05): tools = the AI catalog + render_preview (returns the contact sheet as an image), resources = scene, summary, catalog. For Claude Desktop / Claude Code / Cursor.

```
agent3d mcp [--project <dir>] [--read-only]
```

| Option | Description |
|---|---|
| `--project <value>` | Project folder (default: the current directory). |
| `--read-only` | Expose only the tools that don't write. |

### doctor

Check the setup: Node version, installed Chrome (+ version), the runtime / Studio builds, library and templates, and a headless WebGL test render of a 1-object scene (in a temp folder). A failed required check makes the command fail (exit 1, error code doctor-failed, one hint per failed check, every check in error.details.checks).

```
agent3d doctor [--no-render]
```

| Option | Description |
|---|---|
| `--no-render` | Skip the test render. |

<!-- END GENERATED -->
