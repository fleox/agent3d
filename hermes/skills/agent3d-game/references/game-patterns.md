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

Dynamic bodies (balls, falling crates) use real responses:

```js
start() {
  api.physics.onCollision((a, b) => {
    if (a.id === "ball" || b.id === "ball") api.audio.play("hit");
  });
},
update() {
  if (api.input.pressed("Space")) api.physics.applyImpulse("ball", [0, 6, 0]);
},
```

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
- Test touch controls with the same render: `{"t": 0.5, "swipe": "left"}` (→ `api.input.swipe()`), `{"t": 1, "drag": {"from": [-0.5, 0], "to": [0.5, 0], "duration": 0.3}}` (press, pointer moves, release), `{"t": 1, "pointerDown": [0, -0.5]}` … `{"t": 2, "pointerUp": true}` (hold-to-charge, slingshots).
- A phase that needs input (game over): put `"startPhase": "over"` in `scene.data`, call `reset(api.data.startPhase ?? "ready")` in `start`, render, then remove it.
- Show values you want to verify in a temporary HUD text (`"text": "speed {speed}"`) and read them on the render.
- Deterministic: same seed, same frames. If two renders of the same time differ, something uses `Math.random()` or wall-clock time.

## Interactive (non-game) logic

The same API drives configurators and playful banners: change a product colour from HUD buttons (`onEvent("red") → api.get("bottle").setColor("#d62828")`), count clicks on an object (`api.input.pointerWorld()?.objectId`), reveal a coupon after three taps. Keep `target.kind` as the page placement (banner, card…) rather than `game` when it is not a game.
