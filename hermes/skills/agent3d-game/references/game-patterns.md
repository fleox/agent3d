# Game patterns

Snippets assume `const { … } = api.data` for tuning values kept in `scene.data`.

## State machine with HUD per phase

```json
"ui": {
  "elements": [
    { "id": "score", "type": "text", "text": "Score {score}", "anchor": "top-left", "style": "pill" },
    { "id": "best", "type": "text", "text": "Best {best}", "anchor": "top-right", "style": "pill" },
    { "id": "title", "type": "text", "text": "Lane Runner", "anchor": "center", "style": "title", "visible": "phase == 'ready'" },
    { "id": "start", "type": "button", "text": "Play", "anchor": "bottom", "action": "start", "visible": "phase == 'ready'" },
    { "id": "over", "type": "text", "text": "Game over - {score}", "anchor": "center", "style": "title", "visible": "phase == 'over'" },
    { "id": "retry", "type": "button", "text": "Retry", "anchor": "bottom", "action": "retry", "visible": "phase == 'over'" }
  ],
  "color": "#ffffff",
  "accent": "#ef476f"
}
```

```js
function reset(phase) {
  for (const b of blocks) b.remove();
  blocks = [];
  api.state.phase = phase;
  api.state.score = 0;
  api.state.best = Number(api.storage.get("best") ?? 0);
}
return {
  start() { reset("ready"); },
  onEvent(name) { if (name === "start" || name === "retry") reset("play"); },
  update(dt) { if (api.state.phase === "over") return; /* … */ },
};
```

## Keyboard + touch

```js
const swipe = api.input.swipe();
if (api.input.pressed("ArrowLeft") || api.input.pressed("KeyA") || swipe === "left") lane = Math.max(0, lane - 1);
if (api.input.pressed("ArrowRight") || api.input.pressed("KeyD") || swipe === "right") lane = Math.min(2, lane + 1);
if (api.input.pressed("Space") || api.input.pointer.justPressed || swipe === "up") jump();
// Smooth toward the target lane instead of teleporting:
player.position.x += (lanes[lane] - player.position.x) * Math.min(1, dt * 14);
```

Continuous movement: `isDown` for keys, and for touch move toward `api.input.pointerWorld()` while `api.input.pointer.down`.

## Spawning by cloning

Declare the template once, hidden, with a body:

```json
{ "id": "block", "kind": "mesh", "geometry": { "type": "box", "width": 1.4, "height": 1, "depth": 1 }, "material": { "preset": "clay", "color": "#ef476f" }, "position": [0, 0.5, -60], "visible": false, "tags": ["template"], "body": { "type": "trigger", "shape": "box" } }
```

```js
let n = 0;
function spawn() {
  const x = lanes[Math.floor(api.random() * lanes.length)];
  const b = api.clone("block", { id: `block${n++}`, position: [x, 0.5, -30] });
  b.visible = true;
  blocks.push(b);
}
// Move and recycle:
for (const b of blocks.slice()) {
  b.position.z += speed * dt;
  if (b.position.z > 6) { b.remove(); blocks.splice(blocks.indexOf(b), 1); }
}
```

Spawn close enough that the first obstacle appears within 2–3 seconds (a render at t = 3 should show it).

## Collisions

```js
if (api.state.phase === "play" && api.physics.overlaps(player, b)) gameOver();
```

Dynamic bodies (balls, falling crates) use real rigid-body responses:

```js
start() {
  api.physics.onCollision((a, b, info) => {
    // info: { point, normal, impulse, speed } — only real impacts make noise
    if ((a.id === "ball" || b.id === "ball") && info.impulse > 1) api.audio.play("hit");
  });
},
update() {
  if (api.input.pressed("Space")) api.physics.applyImpulse("ball", [0, 6, 0]);
},
```

## Physics recipes

Bodies are real rigid bodies (cannon-es): they rotate, tumble, stack and fall asleep. The simulation is deterministic (fixed step), so renders replay exactly.

**Platformer hero** — a capsule character controller (no tipping, no wall sticking, coyote-time jumps):

```json
{ "id": "hero", "kind": "model", "src": "library:models/characters/robot.glb", "scale": 0.3, "position": [0, 1, 0], "body": { "type": "dynamic", "shape": "capsule", "radius": 0.35, "height": 1.4, "character": true } }
```

Size the model first: `render --isolate hero --json` returns `isolated.size` (the robot is ≈ 4.8 units tall unscaled, so `scale: 0.3` makes a 1.45-unit hero), then fit the capsule `height` / `radius` (world units) to it.

```js
update() {
  const x = (api.input.isDown("ArrowRight") ? 1 : 0) - (api.input.isDown("ArrowLeft") ? 1 : 0);
  api.physics.moveCharacter(hero, { x, z: 0 }, { speed: 6, acceleration: 40, airControl: 0.35 });
  if (api.input.pressed("Space") && api.physics.jump(hero, 7)) api.audio.play("jump");
  // api.physics.grounded(hero) picks the animation clip (jump / run / idle)
}
```

**Velocity-driven player** (roller, hover ship) — a `dynamic` body with `"fixedRotation": true` (without it, friction tips the player over as soon as it moves):

```json
{ "id": "hero", "kind": "mesh", "geometry": { "type": "box", "width": 0.8, "height": 0.8, "depth": 0.8 }, "material": { "preset": "plastic", "color": "#ff6b6b" }, "position": [-6, 1, 0], "body": { "type": "dynamic", "fixedRotation": true } }
```

```js
update() {
  const x = (api.input.isDown("ArrowRight") ? 1 : 0) - (api.input.isDown("ArrowLeft") ? 1 : 0);
  const v = api.physics.getVelocity(hero);
  api.physics.setVelocity(hero, [x * 5, v[1], 0]); // keep gravity's vertical speed
  if (api.input.pressed("Space") && api.physics.grounded(hero)) api.physics.applyImpulse(hero, [0, 6, 0]);
}
```

**Throw / knock things over** — clone a hidden projectile (synchronous, keeps determinism) and launch it on a ballistic arc toward the pointer (`ccd: true` on fast projectiles stops tunnelling):

```js
const target = api.input.pointerWorld(); // { x, y, z, objectId? }
const from = [0, 1.3, 7], T = 0.6, g = 9.81;
const ball = api.clone("ballProto", { id: "ball" + ++n, position: from });
ball.visible = true;
api.physics.setVelocity(ball, [(target.x - from[0]) / T, (target.y - from[1]) / T + 0.5 * g * T, (target.z - from[2]) / T]);
```

Keep the prototype asleep out of sight: `"position": [0, -29.7, 0], "visible": false` resting on a hidden static shelf. The `game-physics-playground` template is a complete example (tower of blocks, rebuild without reload, impact sounds).

**Moving platforms** — `kinematic` bodies moved from the script (or given a velocity) push dynamic bodies and **carry characters** standing on them (sliding lifts, elevators going up or down, turntables): the engine adds the platform's motion to the hero every step, so never move the hero with the lift yourself (that would carry it twice). `grounded(hero)` stays true and `contacts(hero)` lists the lift on every step of the ride:

```js
lift.position.set(base + Math.sin(api.time() * 0.9) * 1.6, lift.position.y, 0); // every update
elevator.position.y = baseY + 1.5 - Math.cos(api.time() * 0.8) * 1.5;
const onLift = api.physics.grounded(hero) && api.physics.contacts(hero).some((o) => o.id === "lift");
```

**Keeping a 2.5D hero on its plane** — clamping every step is fine: small corrections keep the character's contacts and ground state (jumps still work). A respawn (a teleport of more than 0.5 m) clears them until the next step:

```js
hero.position.set(hero.position.x, hero.position.y, 0); // after moveCharacter, every update
```

**Platforms with decorations** — a measured collider (`box`, `auto`, `convex`, `trimesh`) uses the object's own geometry only, so a grass slab with a dirt child keeps a box centred on the slab: no explicit `size` / `offset` needed. To make the decoration solid too, use `"shape": "compound"` without `shapes` (one box per child without a body). A child with its own `body` always gets its own collider:

```json
{ "id": "ledge", "kind": "mesh", "geometry": { "type": "roundedBox", "width": 4, "height": 0.4, "depth": 2 }, "body": { "type": "static", "shape": "box" },
  "children": [{ "id": "ledgeDirt", "kind": "mesh", "geometry": { "type": "roundedBox", "width": 3.8, "height": 1, "depth": 1.8 }, "position": [0, -0.6, 0] }] }
```

**Doors, pendulums, chains, wheels** — `physics.joints` (world-space pivots at scene start; omit `b` to pin to the world):

```json
"physics": { "joints": [
  { "id": "door", "type": "hinge", "a": "door", "pivot": [-1, 1.2, 0], "axis": [0, 1, 0] },
  { "type": "point", "a": "bob", "pivot": [0, 5, 0] },
  { "id": "wheel", "type": "hinge", "a": "wheel", "pivot": [2, 0.5, 0], "axis": [0, 0, 1], "motor": { "speed": 180, "maxForce": 50 } }
] }
```

`api.physics.setMotorSpeed("wheel", 360)` changes a motor at run time. A flipper or a door that must stop: `"limits": [-30, 30]` (degrees from its start pose). Scaling a body from a script (`obj.scale.set(…)`) resizes its collider, unless a joint holds it.

**Sensors** — `trigger` bodies: `api.physics.onTriggerEnter((zone, other) => …)` / `onTriggerExit`, or poll `api.physics.overlaps(player, coin)` (exact shapes, works between any body types).

**Layers** — `"layer": "debris", "collidesWith": ["default"]` keeps debris from blocking the player; raycasts take `{ layers: ["default"], ignore: [player], triggers: false }`.

**Shapes** — boxes from the object's own mesh bounds are the default (cheapest, stable stacks; child objects are not included). Use `sphere` for balls (they roll), `capsule` for characters, `convex` for dynamic props of irregular shape (models), `trimesh` or `auto` for static level geometry (exact, e.g. a ramp model), `heightfield` / `auto` for a terrain generator, `compound` to assemble a few primitives (a table: top box + 4 leg boxes).

**Debugging** — `"physics": { "debug": true }` draws every collider (green dynamic, blue static, orange kinematic, magenta trigger, grey asleep) in renders: look at it whenever something falls through, floats or collides early. Remove it before export.

## Timeline cues and interactions in a game

A timeline can stage an intro (camera move, title drop) and hand over to the game with a marker:

```json
"timeline": { "duration": 3, "markers": { "go": 1.5 }, "tracks": [{ "target": "title.position.y", "keys": [[0, 6], [1.5, 3, "outBack"]] }] }
```

```js
start() {
  api.state.phase = "intro";
  api.on("go", () => { api.state.phase = "play"; }); // fires when the timeline crosses 1.5 s
},
```

`scene.interactions` work in games too: a key or a click can `emit` an event to the scripts (`{ "on": "key", "key": "KeyR", "do": [{ "emit": "retry" }] }` → `onEvent("retry")`), play a segment or open a URL (`{ "on": "click", "target": "cta", "do": [{ "openUrl": "https://…" }] }`). The reverse works too: an event a script `api.emit`s (or a HUD button `action`) fires `{ "on": "event", "event": "<name>" }` interactions — e.g. `api.emit("win")` → `{ "on": "event", "event": "win", "do": [{ "play": "celebrate" }] }`.

## Difficulty ramp

```js
speed = Math.min(maxSpeed, speed + dt * 0.4);
spawnTimer -= dt;
if (spawnTimer <= 0) { spawn(); spawnTimer = spawnEvery * (startSpeed / speed); }
```

## Game over and best score

```js
function gameOver() {
  api.state.phase = "over";
  api.audio.play("hit");
  api.camera.shake(0.3, 0.4);
  const best = Math.max(Number(api.state.best), Number(api.state.score));
  api.state.best = best;
  api.storage.set("best", best);
}
```

## Sounds

```json
"audio": { "sounds": { "move": { "preset": "whoosh", "volume": 0.4 }, "hit": { "preset": "lose" }, "point": { "preset": "coin", "volume": 0.5 } }, "music": { "preset": "chiptune-loop", "volume": 0.3 } }
```

Play sounds only in the `play` phase (the attract mode stays silent). Music: `api.audio.music(true)` when the game starts.

## Attract mode (so renders and the poster show action)

Headless renders have no input. During `ready`, run a simple autopilot so the scene moves behind the title:

```js
function autopilot() {
  const threat = blocks.find((b) => b.position.z > -8 && b.position.z < player.position.z && Math.abs(b.position.x - lanes[lane]) < 0.5);
  if (!threat) return 0;
  if (lane === 0) return 1;
  if (lane === 2) return -1;
  return api.random() < 0.5 ? -1 : 1;
}
// in update: const move = phase === "play" ? readInput() : autopilot();
```

Set `target.posterTime` to a frame where obstacles are on screen (3 s in the lane runner).

## Testing

- `render --frames 0,2,4,6 --sheet` and look: obstacles appear, the autopilot dodges, the HUD shows the right phase.
- `data.issues` / `data.consoleErrors` show script errors (`script-error` with the script path).
- `render --input '[{"t": 0.5, "key": "ArrowLeft", "hold": 1}]'` plays simulated input while seeking; `data.state` (the script's `api.state` after the last frame) tells whether it worked (score, phase, lives).
- Timeline-driven phases: render a frame after the marker (`--frames 0,2`) and check `data.state.phase`; a blocked `openUrl` click shows up as an `openUrl` event (`api.on("openUrl", ({ url, blocked }) => …)`).
- Test touch controls with the same render: `{"t": 0.5, "swipe": "left"}` (→ `api.input.swipe()`), `{"t": 1, "drag": {"from": [-0.5, 0], "to": [0.5, 0], "duration": 0.3}}` (press, pointer moves, release), `{"t": 1, "pointerDown": [0, -0.5]}` … `{"t": 2, "pointerUp": true}` (hold-to-charge, slingshots).
- A phase that needs input (game over): put `"startPhase": "over"` in `scene.data`, call `reset(api.data.startPhase ?? "ready")` in `start`, render, then remove it.
- Show values you want to verify in a temporary HUD text (`"text": "speed {speed}"`) and read them on the render.
- Deterministic: same seed, same frames. If two renders of the same time differ, something uses `Math.random()` or wall-clock time.

## Interactive (non-game) logic

The same API drives configurators and playful banners: change a product colour from HUD buttons (`onEvent("red") → api.get("bottle").setColor("#d62828")`), count clicks on an object (`api.input.pointerWorld()?.objectId`), reveal a coupon after three taps. Keep `target.kind` as the page placement (banner, card…) rather than `game` when it is not a game.
