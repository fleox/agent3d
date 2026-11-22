# ScriptApi reference

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

`type`: `static` (walls, ground), `dynamic` (simulated), `kinematic` (moved by your script — set its position every step or give it a velocity — and pushes dynamic bodies), `trigger` (detects overlaps, no response). Shapes (`box`, `sphere`, `cylinder`, `capsule`, `convex`, `trimesh`, `heightfield`, `compound`, `auto`), materials, collision layers, joints (hinge, point, distance, lock, spring) and `physics.debug` wireframes are listed below (recipes: `game-patterns.md` → Physics recipes). Angles and angular velocities are in degrees (/ s), like rotations everywhere.

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
| `shape` | `box` (default: the bounding box of the object's **own** geometry — never its child objects — in the object's rotated frame), `sphere`, `cylinder`, `capsule` (Y-up), `convex` (hull of the mesh / model, good for dynamic models), `trimesh` (exact triangles; static / kinematic only — level geometry, models), `heightfield` (terrain generators), `compound` (`shapes`; without `shapes`: one box for the object + one per child object without a body), `auto` (primitive geometry → matching shape, terrain → heightfield, static models / meshes → trimesh, dynamic → convex) |
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

Child objects never enlarge a measured collider: a child with its own `body` gets its own collider; a decorative child (a platform's dirt layer) is ignored unless the parent uses `"shape": "compound"` without `shapes`, which adds one box per such child. No explicit `size` / `offset` is needed for a platform with decorations. A `group` (no geometry of its own) measures its children.

Generators that publish collision boxes (the maze generator with `bodies: true`) get a static compound body with the generator's id.

**Joints** (`physics.joints[]`, pivots and axes in world space at scene start; omit `b` to attach `a` to the world):

| `type` | Fields |
|---|---|
| `hinge` | `pivot`, `axis` (default `[0, 1, 0]`), `motor: { speed (degrees / s), maxForce? }`, `limits: [minDeg, maxDeg]` (relative to the start pose) — doors, wheels, flippers |
| `point` | `pivot` — ball-and-socket: pendulums, chains, ragdoll joints |
| `distance` | `distance` (default: current distance between the centres) — rigid rods |
| `lock` | — welds two bodies together (breakable with `maxForce`) |
| `spring` | `restLength` (default: current distance), `stiffness` (default 50), `damping` (default 1), `pivot` = world anchor on `b` (or the world point when `b` is omitted) |

All joints take `maxForce` (default 1e6) and `collideConnected` (default `false`).

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
| `api.physics.moveCharacter(obj, { x, z } \| [x, z], { speed?, acceleration?, airControl? }?)` | Character controller: steer horizontally toward `move × speed` (move length ≤ 1, default speed 5), keeps the vertical velocity, reduced control in the air; turns the body into a character (no rotation, no friction). Call once per update |
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
      api.physics.moveCharacter(hero, { x, z: 0 }, { speed: 6 }); // relative to a lift it stands on
      hero.position.set(hero.position.x, hero.position.y, 0); // stay on the z = 0 plane (keeps grounded state)
      if (api.input.pressed("Space") && api.physics.jump(hero, 7)) api.audio.play("jump");
    },
  };
}
```

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
| `api.on(event, handler)`, `api.emit(event, payload?)` | Custom events between scripts (HUD buttons emit their `action`); also delivered to every script's `onEvent(name, payload)` |
| `api.storage.get(key)`, `api.storage.set(key, value)` | Small persistent values (best score), namespaced per scene, never throws |
| `api.data` | `scene.data` (tuning, levels), merged with the page's `data-*` attributes / `element.setData()` overrides |
| `api.restart()` | Rebuild the scene from its definition |
| `api.log(...args)` | Debug output (browser console) |

Audio only starts after a user gesture; the HUD shows a mute button bottom-right when the scene has sounds.

## Events in and out

| Source | Reaches scripts as |
|---|---|
| HUD button `action` | `onEvent(action)` / `api.on(action)` |
| Timeline marker crossed (`timeline.markers: { "peak": 1 }`) | `api.on("peak", (p) => …)` / `onEvent("peak", { marker, time })` |
| Interaction action `{ "emit": "name", "payload"? }` | `api.on("name")` / `onEvent` |
| The page: `document.querySelector("agent3d-scene").trigger("start", { level: 2 })` | `api.on("start")` / `onEvent("start", { level: 2 })` |
| A blocked `openUrl` in headless renders | `api.on("openUrl", ({ url, blocked }) => …)` |

Out: every `api.emit(name, payload)` and HUD action is re-dispatched on the element as an `agent3d:event` DOM event (`detail: { name, payload }`), e.g. `api.emit("score", { score: 12 })` for the page's analytics. Script-emitted events and HUD actions also fire the scene's `{ "on": "event", "event": "<name>" }` interactions (like markers, interaction `emit` actions and page `trigger()` calls): to play a timeline segment from a script, `api.emit("win")` with `{ "on": "event", "event": "win", "do": [{ "play": "celebrate" }] }` in `scene.interactions`.

Example — a timeline marker starts the round, the page learns the score:

```js
export default function (api) {
  return {
    start() {
      api.state.phase = "intro";
      api.on("go", () => { api.state.phase = "play"; }); // timeline.markers: { "go": 1.5 }
    },
    onEvent(name) {
      if (name === "retry") { api.state.score = 0; api.state.phase = "play"; }
    },
    update() {
      if (api.state.phase === "play" && api.input.pressed("Space")) {
        api.state.score = Number(api.state.score ?? 0) + 1;
        api.emit("score", { score: api.state.score }); // page: agent3d:event
      }
    },
  };
}
```

