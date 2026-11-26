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
| `api.input.pointerWorld()` | World point under the pointer on a body (its rendered mesh) or else on the y = 0 plane: `{ x, y, z, objectId? }` or `null` |

The embed takes keyboard focus when clicked (games get `tabindex="0"` and `role="application"`).

## Physics

Real rigid-body physics (cannon-es, fixed step, deterministic): bodies rotate, tumble, stack, roll and sleep. Objects take part when they have a `body`:

```json
"body": { "type": "dynamic", "shape": "sphere", "restitution": 0.7, "friction": 0.3, "mass": 1 }
```

`type`: `static` (walls, ground), `dynamic` (simulated), `kinematic` (moved by your script — set its position every step or give it a velocity — and pushes dynamic bodies), `trigger` (detects overlaps, no response). Shapes (`box`, `sphere`, `cylinder`, `capsule`, `convex`, `trimesh`, `heightfield`, `compound`, `auto`), materials, collision layers, joints (hinge, point, distance, lock, spring) and `physics.debug` wireframes are described in [scene-format.md](scene-format.md#physics). Angles and angular velocities are in degrees (/ s), like rotations everywhere.

Moving a body from a script (`obj.position.set`, `obj.rotation.set`) teleports it (dynamic bodies keep their velocity; kinematic bodies sweep to the new pose so they push what they touch). A character keeps its contacts and `grounded()` state through small corrections (under 0.5 m: clamping z every step, snapping to a lane), so jumps keep working; a longer teleport (respawn) clears them until the next step. A player whose velocity you set every step should have `"fixedRotation": true` (or `"character": true`), otherwise friction makes it tumble.

**Moving platforms carry characters.** A character standing on a `kinematic` body — moved by `position.set` every step or by a velocity, sliding, lifting or turning — rides it: the platform's motion is added for the step, `moveCharacter` steering stays relative to the platform, and `grounded()` / `contacts()` report the platform every step (even while it moves down). Do not carry the hero yourself.

| Member | Description |
|---|---|
| `api.physics.overlaps(a, b)` | Exact shape overlap right now (ids or objects, any body types, no step needed) |
| `api.physics.contacts(a)` | Objects touching `a` during the last step (incl. triggers) |
| `api.physics.raycast(from, dir, maxDistance?, { ignore?, layers?, triggers? }?)` | Nearest hit on the real shapes: `{ objectId, distance, point, normal }` or `null` (triggers are hit unless `triggers: false`) |
| `api.physics.applyImpulse(obj, [x, y, z], point?)` | Instant velocity change; a world `point` off the centre also spins it |
| `api.physics.applyForce(obj, [x, y, z], point?)` / `applyTorque(obj, [x, y, z])` | Continuous push for the next step (call every update: thrusters, wind) |
| `api.physics.setVelocity(obj, v)` / `getVelocity(obj)` | Linear velocity (m/s) — also `obj.velocity.x = …` |
| `api.physics.setAngularVelocity(obj, deg)` / `getAngularVelocity(obj)` | Spin in degrees / s |
| `api.physics.grounded(obj)` | Standing on something (a contact pushing up; characters also count ground within a few cm under their feet, so it does not flicker on moving platforms) |
| `api.physics.moveCharacter(obj, { x, z }, { speed?, acceleration?, airControl? }?)` | Character controller: steer horizontally toward `move × speed` (move length ≤ 1, default speed 5), keeps the vertical velocity, reduced control in the air; turns the body into a character (no rotation, no friction). Call once per update |
| `api.physics.jump(obj, speed?)` | Jumps (default 6 m/s) when grounded or within 0.12 s of leaving the ground (coyote time); no double jump; returns `true` when it jumped |
| `api.physics.wake(obj)` | Wake a sleeping body |
| `api.physics.setMotorSpeed(jointId, deg)` | Hinge motor speed of a `physics.joints` entry |
| `api.physics.onCollision((a, b, info) => {})` | Contact began (also for triggers); `info = { point, normal (a → b), impulse (N·s), speed (m/s) }` — e.g. play a sound when `info.impulse > 1` (register it in `start`) |
| `api.physics.onCollisionEnd((a, b) => {})` | Contact ended |
| `api.physics.onTriggerEnter((trigger, other) => {})` / `onTriggerExit(...)` | Something entered / left a trigger body |

Platformer sketch:

```js
export default function (api) {
  const hero = api.get("hero"); // body: { "type": "dynamic", "shape": "capsule", "character": true }
  return {
    update() {
      const x = (api.input.isDown("ArrowRight") ? 1 : 0) - (api.input.isDown("ArrowLeft") ? 1 : 0);
      api.physics.moveCharacter(hero, { x, z: 0 }, { speed: 6 });
      if (api.input.pressed("Space") && api.physics.jump(hero, 7)) api.audio.play("jump");
    },
  };
}
```

## HUD

Declared in `scene.ui.elements` (`type` text, button or bar; `anchor` top-left … bottom-right; `style` plain, pill, title, subtitle). Text placeholders `{key}` read `api.state.key`; `visible` takes a boolean, a state key or an expression (`"phase == 'over'"`, `"lives > 0 && !paused"`); a bar's `value` names a state key holding 0..1; a button's `action` is the event name sent to `onEvent`. `scene.ui.color` / `accent` / `font` (system font stacks only) theme it.

Layout and phones: the HUD is a 3 × 3 grid (top / middle / bottom rows × left / centre / right columns), so anchors in the same row never overlap: the centre column takes at most 56 % of the width (the whole row when that row has no side anchor) and long texts wrap. The mute button sits under the bottom-right elements. Font sizes, paddings, bars and buttons follow the embed size (CSS container units, `min(width, height)`-aware) between a readable minimum (11–12 px, title 20 px) and their desktop size (title 44 px). Limits: a narrow embed (≈ 360 px) leaves ~80 px per side column, so keep side texts short (`Score 3`, `♥♥♥`) and put long sentences in a centre anchor; several elements in one anchor stack vertically and can still reach the next row on very short embeds. Render at phone size to check (`render --size 360x640`).

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
| `api.on(event, handler)`, `api.emit(event, payload?)` | Custom events between scripts (HUD buttons emit their `action`). Every emitted event also reaches the page as an `agent3d:event` DOM event (`detail: { name, payload }`) on `<agent3d-scene>`, and the page can send events in with `element.trigger(name, payload)` — e.g. report a game's score to analytics, or start a level from a button outside the canvas |
| `api.storage.get(key)`, `api.storage.set(key, value)` | Small persistent values (best score), namespaced per scene, never throws |
| `api.data` | `scene.data`, merged with the page's `data-*` attributes and `element.setData()` values ([data bindings](scene-format.md#data-bindings)) — tuning, levels, personalisation |
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
- The default export must be a function; otherwise the runtime reports `script-error` (in `render` results as `issues`, in the page as an `agent3d:error` event).

## Testing scripts

```bash
npx -y @fleox/agent3d@0.3.0 check --project my-game --json
npx -y @fleox/agent3d@0.3.0 render --project my-game --sheet --frames 0,2,4,6 --json
```

Plain renders have no input: give the game an attract mode (an autopilot during the `ready` phase) so frames show action, and read `issues` / `consoleErrors` of the render for script errors. The render result also carries `state` (the script's `api.state` after the last frame).

To play the game headlessly, pass a script of simulated input with `--input` (JSON array, `@file` or `-`); events are applied while seeking, in time order, and the frames are rendered in time order:

```bash
npx -y @fleox/agent3d@0.3.0 render --project my-game --frames 0,1,2 --input '[{"t": 0.2, "key": "ArrowRight", "hold": 0.8}, {"t": 1.2, "click": [0, 0]}]' --json
```

| Event | Meaning |
|---|---|
| `{ "t": 0.5, "key": "ArrowRight", "down": true }` | key down (`down: false` = key up); `key` is a `KeyboardEvent.code` |
| `{ "t": 0.5, "key": "Space", "hold": 0.3 }` | press at `t`, release at `t + hold` |
| `{ "t": 1, "click": [0, 0] }` | click (press + release) at a canvas point (−1..1, y up): `api.input.pointer.justPressed`, object `onClick` |
| `{ "t": 1, "pointer": [0.5, -0.2] }` | move the pointer (`"down": true` / `false` also presses / releases it there) |
| `{ "t": 1, "pointerDown": [0, 0] }` | press the pointer and hold it (`api.input.pointer.down` stays true) |
| `{ "t": 2, "pointerUp": [0.4, 0] }` | release it there (`"pointerUp": true`: where the pointer is) |
| `{ "t": 1, "drag": { "from": [-0.5, 0], "to": [0.5, 0], "duration": 0.4 } }` | press at `from`, move to `to` over `duration` s (default 0.3; 30 pointer moves per second), release |
| `{ "t": 1, "swipe": "left" }` | a swipe gesture: `api.input.swipe()` returns `"left"` / `"right"` / `"up"` / `"down"` during the next step |
| `{ "t": 1, "scroll": 0.5 }` | page scroll progress 0..1 (scroll-driven scenes; `null` = back to t / duration) |
| `{ "t": 3, "ui": "retryBtn" }` | click the HUD button `retryBtn` (scene.ui element of type `button`): its `action` is emitted. Unknown ids are a usage error with a "did you mean"; a button hidden at that time is reported in `inputWarnings` |
| `{ "t": 3, "emit": "retry", "payload"?: … }` | emit an event (`api.on`, interactions `{ "on": "event" }`) |
| `{ "t": 0, "segment": "intro", "reverse"?: true }` | play a timeline segment (`--segment intro` adds this at t = 0) |

The same events apply to `--video` / `--gif` / `--webp` captures, each at its own time. `--reduced-motion` mounts the scene as prefers-reduced-motion visitors see it; `--scroll 0.9` names frames by progress (`<stamp>-s0_9.png`, `scroll` in the result).

An event with an unknown field (`{"t": 1, "tap": [0, 0]}`, `{"t": 1, "click": [0, 0], "hold": 1}`) is a usage error (exit 2) whose hint lists the valid shapes. `render_preview` (MCP) takes the same events as `input`. The `Player` API (`src/runtime/api.ts`) exposes the same `input.pointer/key/click/down/up/swipe` and `state()` for browser-based tests.
