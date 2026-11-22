# Scripting (games and interactive logic)

Behaviours and the timeline cover most motion. When a scene needs **logic** — a game, a configurator, a click counter — it lists ES modules in `scene.scripts`. Scripts are sandboxed by contract: they only receive the `api` object (`ScriptApi` in [`src/runtime/api.ts`](../src/runtime/api.ts)); `agent3d check` rejects anything that could reach the page, the network or storage directly.

The agent skill `agent3d-game` (`plugin/skills/agent3d-game/`) has the game patterns (state machine, attract mode, spawning, difficulty ramp) and a complete example is in `plugin/skills/agent3d-create/references/recipes.md`.

The contract is `ScriptApi` in `src/runtime/api.ts`. A script is an ES module listed in `scene.scripts` (`"scripts/game.js"`, project-relative) whose **default export** is a factory:

```js
export default function (api) {
  return {
    start() {},               // once, after every object is built (may be async)
    update(dt, t) {},         // every fixed step: dt = step (s), t = scene time (s)
    onEvent(name, payload) {},// HUD button actions and api.emit()
    dispose() {},             // scene removed
  };
}
```

Several scripts can run side by side; they share `api.state` and events.

## Scene graph

| Member | Description |
|---|---|
| `api.get(id)` | A `ScriptObject` for an object id (top level or nested), or `null` |
| `api.findByTag(tag)` | Objects whose `tags` contain `tag` |
| `api.spawn(objectDef, parentId?)` | Build a new object from a full definition (same shape as in `scene.json`); returns a Promise of the `ScriptObject`. Use for one-off objects |
| `api.clone(id, { id?, position? })` | Synchronous, cheap copy of an existing object (new id generated unless given). Use for anything spawned repeatedly |
| `api.camera` | The camera as a `ScriptObject` plus `lookAt(x, y, z)` and `shake(intensity, duration)` |

### ScriptObject

| Member | Description |
|---|---|
| `id`, `tags`, `userData` | From the definition (`userData` is writable) |
| `position`, `rotation`, `scale` | `{ x, y, z, set(x, y, z) }`; rotation in **degrees** |
| `velocity` | `{ x, y, z, set }` for physics bodies |
| `visible` | Read / write |
| `setColor(css)`, `setOpacity(0..1)` | Material tweaks |
| `playAnimation(clip, { loop?, speed?, crossfade? })` | Model clips (name or index) |
| `distanceTo(other)` | World distance |
| `remove()` | Delete it (clones and spawned objects) |

## Time and randomness

`api.time()` (scene time in seconds), `api.random()` (0..1), `api.randomRange(min, max)`. Seeded by `scene.seed`: the same seed and inputs give the same game, which is what makes headless renders reproducible. Never use `Math.random()` or `Date.now()` for gameplay.

## Input

| Member | Description |
|---|---|
| `api.input.isDown(code)` | Key held (`KeyboardEvent.code`: `"ArrowLeft"`, `"Space"`, `"KeyA"`…) |
| `api.input.pressed(code)` | Key went down during this step |
| `api.input.pointer` | `{ x, y, down, justPressed }`, normalised −1..1 over the canvas (mouse or touch) |
| `api.input.swipe()` | `"left" | "right" | "up" | "down" | null` for this step (touch gestures) |
| `api.input.pointerWorld()` | World point under the pointer on the y = 0 plane or on a body: `{ x, y, z, objectId? }` or `null` |

The embed takes keyboard focus when clicked (games get `tabindex="0"` and `role="application"`).

## Physics

Light AABB / sphere physics, fixed step. Objects take part when they have a `body`:

```json
"body": { "type": "dynamic", "shape": "sphere", "restitution": 0.7, "friction": 0.3, "mass": 1 }
```

`type`: `static` (walls, ground), `dynamic` (falls, bounces, pushed by impulses), `kinematic` (moved by your script, pushes dynamic bodies), `trigger` (detects overlaps, no response). `shape`: `box`, `sphere`, `auto` (from the bounding box); `size` / `radius` override it. `scene.physics.gravity` (default `[0, -9.81, 0]`), `scene.physics.step` (default 1/60).

| Member | Description |
|---|---|
| `api.physics.overlaps(a, b)` | Bounding volumes intersect (ids or objects) |
| `api.physics.contacts(a)` | Bodies currently touching `a` |
| `api.physics.raycast(from, dir, maxDistance?)` | First body hit: `{ objectId, distance, point }` or `null` |
| `api.physics.applyImpulse(obj, [x, y, z])` | Instant velocity change (jumps, kicks) |
| `api.physics.onCollision((a, b) => {})` | Called when two bodies start touching (register it in `start`) |

## HUD

Declared in `scene.ui.elements` (`type` text, button or bar; `anchor` top-left … bottom-right; `style` plain, pill, title, subtitle). Text placeholders `{key}` read `api.state.key`; `visible` takes a boolean, a state key or an expression (`"phase == 'over'"`, `"lives > 0 && !paused"`); a bar's `value` names a state key holding 0..1; a button's `action` is the event name sent to `onEvent`. `scene.ui.color` / `accent` / `font` (system font stacks only) theme it.

| Member | Description |
|---|---|
| `api.state` | Shared state object (HUD, tests). Write plain values |
| `api.ui.set(id, { text?, visible?, value? })` | Override an element directly |
| `api.ui.toast(text, seconds?)` | Short message in the middle |

## Audio, events, storage, misc

| Member | Description |
|---|---|
| `api.audio.play(name)` | A sound from `scene.audio.sounds` (`{ "preset": "coin" }` synthesised, or `{ "src": "assets/audio/x.mp3" }`) |
| `api.audio.music(on)` | Start / stop `scene.audio.music` |
| `api.on(event, handler)`, `api.emit(event, payload?)` | Custom events between scripts (HUD buttons emit their `action`) |
| `api.storage.get(key)`, `api.storage.set(key, value)` | Small persistent values (best score), namespaced per scene, never throws |
| `api.data` | `scene.data` (read it for tuning and levels) |
| `api.restart()` | Rebuild the scene from its definition |
| `api.log(...args)` | Debug output (browser console) |

Audio only starts after a user gesture; the HUD shows a mute button bottom-right when the scene has sounds.

## Determinism

`update(dt, t)` runs at a fixed step (`scene.physics.step`, default 1/60 s). In deterministic mode (headless renders, posters, videos) the player advances the simulation step by step up to the requested time, so a frame is a pure function of (scene, assets, time) as long as scripts use `api.random()` and `api.time()` instead of `Math.random()` and clocks. Seeking backwards rebuilds the scene from its definition and replays.

## Sandbox rules

`agent3d check` (and the Studio, the MCP `check` tool) lint every script (`src/ops/scriptLint.ts`). Strings, template text and comments are ignored; property accesses (`obj.parent`) and object keys are allowed. These identifiers fail the check with `forbidden-script`:

| Identifier | Why |
|---|---|
| `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` | network access |
| `eval`, `Function` | dynamic code execution |
| `import` statements, `import()`, `import.meta` | loading code (scripts are self-contained) |
| `document`, `window`, `globalThis`, `self` | page access outside the HUD |
| `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` | storage (use `api.storage`) |
| `parent`, `top`, `opener`, `postMessage` | other frames and pages |
| `importScripts`, `Worker` | spawning or loading code |
| `navigator`, `location` | device, network and navigation APIs |

The lint is a contract checked before export, not a runtime isolation boundary: scripts run as modules in the page. Only export scripts you (or your agent) wrote and checked. See [security.md](security.md).

## How scripts are loaded

- Embed exports copy scripts to `<name>/scripts/` and the runtime imports them by URL (same origin as the scene).
- Single-HTML exports inline them as `<script type="text/agent3d-script" data-path="scripts/game.js">` and the runtime imports them from a `blob:` URL (a CSP must allow `script-src blob:`, see [export.md](export.md)).
- The default export must be a function; otherwise the runtime reports `script-error` (in `render` results as `issues`, in the page as an `agent3d-error` event).

## Testing scripts

```bash
npx -y @fleox/agent3d@0.1.0 check --project my-game --json
npx -y @fleox/agent3d@0.1.0 render --project my-game --sheet --frames 0,2,4,6 --json
```

Renders have no input: give the game an attract mode (an autopilot during the `ready` phase) so frames show action, and read `issues` / `consoleErrors` of the render for script errors. The `Player` API (`src/runtime/api.ts`) also exposes `input.pointer/key/click` and `state()` for browser-based tests.
