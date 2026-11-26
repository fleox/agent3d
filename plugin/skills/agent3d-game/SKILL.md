---
name: agent3d-game
description: Build a mini game or an interactive 3D experience for a web page with Agent3D scripts - a sandboxed ScriptApi (objects, input with keyboard, pointer and touch swipes, rigid-body physics with real shapes, joints, a character controller and collision events, spawning and cloning, HUD with placeholders, synth sounds, best-score storage, events), game patterns (ready / play / over state machine, difficulty ramp, attract mode so screenshots show action), and testing through deterministic headless renders. Use when the user wants a playable game, a quiz-like interaction, a clickable 3D configurator or anything that needs logic beyond behaviours and timelines.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge) for renders.
metadata:
  version: "0.5.0"
  repository: "https://github.com/fleox/agent3d"
allowed-tools: Bash Read Write
---

# Mini games with Agent3D

A game is an ordinary scene (`target.kind: "game"`) plus **scripts**: ES modules listed in `scene.scripts`, each exporting a factory that gets the sandboxed `api` and returns lifecycle hooks. Everything else (objects, HUD, sounds, physics bodies, data) stays declarative in `scene.json`.

**Language:** talk to the user in their language; keep commands, ids, code and files in English.

Every command is `npx -y @fleox/agent3d@0.5.0 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Start

```bash
npx -y @fleox/agent3d@0.5.0 new dodge --target game --title "Dodge" --json
npx -y @fleox/agent3d@0.5.0 scene summary --project dodge --json
```

The game starter has a `kinematic` player moved by position, coins with a `coin` tag, a follow camera, a score HUD, a coin sound and `scripts/game.js` (move with arrows / WASD, collect coins). Game templates to start from (`templates list --json`): `game-coin-collector`, `game-runner`, `game-maze`, `game-tap-targets`, `game-physics-playground` (rigid bodies, impulses, impact sounds) — `new my-game --template game-physics-playground --json`. A complete validated example (lane runner: lanes, spawning by cloning, difficulty ramp, best score, attract mode) is in skill `agent3d-create` → `references/recipes.md` ("Lane runner game"; "Physics toss game" for rigid bodies); patterns in [references/game-patterns.md](references/game-patterns.md); the full API in [references/script-api.md](references/script-api.md).

## The script contract

```js
// scripts/game.js — no imports: everything comes from `api`.
export default function (api) {
  const player = api.get("player");
  return {
    start() { api.state.phase = "ready"; api.state.score = 0; },
    update(dt, t) { /* every fixed step (default 1/60 s) */ },
    onEvent(name, payload) { /* HUD button actions and api.emit() */ },
    dispose() {},
  };
}
```

- `update(dt, t)` runs at a fixed step (`scene.physics.step`, default 1/60): the game is a pure function of time and input, so headless renders are reproducible.
- `api.state` is shared with the HUD: `"text": "Score {score}"` interpolates it, `"visible": "phase == 'over'"` evaluates a small safe expression (comparisons, `&&`, `||`, `!`, strings, numbers).
- `api.data` is `scene.data` (tuning, level layouts): keep numbers there so they can be patched without touching code.
- Randomness: `api.random()` / `api.randomRange(a, b)` (seeded by `scene.seed`), never `Math.random()` (renders would differ every time).

## Sandbox rules (`check` enforces them)

Scripts only get `api`. `check` fails (`forbidden-script`) on `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, `Function`, `import` / `import()` / `import.meta`, `document`, `window`, `globalThis`, `self`, `localStorage` / `sessionStorage` / `indexedDB` / cookies, `parent`, `top`, `opener`, `postMessage`, `importScripts`, `navigator`, `location`, `Worker`. Use `api.storage` for the best score, `api.ui` for the HUD, `api.input` for keys and touch, `api.audio` for sounds. Words in strings and comments are not flagged; property names like `obj.parent` are fine.

## Workflow

1. Design the loop with the user in one paragraph: goal, controls (keyboard + touch), how you lose, what the score counts, how long a round lasts (30–90 s for a web page).
2. Declare the scene: player and obstacle templates (hidden, with `tags` and a `body`), camera, HUD elements per phase, sounds (`catalog sounds`), `data` for tuning.
3. Write the script (patterns below). Keep it under ~200 lines; one file is fine.
4. Validate and lint: `npx -y @fleox/agent3d@0.5.0 check --project dodge --json` (sandbox errors carry the line: `scripts/game.js:12`).
5. Render several moments and LOOK:
   ```bash
   npx -y @fleox/agent3d@0.5.0 render --project dodge --sheet --frames 0,2,4,6 --json
   ```
   Plain renders have no player input, so the game must show something on its own: an **attract mode** (an autopilot plays during the `ready` phase, behind the title and Play button). The HUD is captured because the scene has a `ui` (`--capture page` forces it); posters (`export --format poster`, the embed's `poster.webp`) and videos show the canvas only, without the HUD. Check `data.issues` and `data.consoleErrors` for `script-error`. `data.state` is the script's `api.state` after the last frame (e.g. `{ "score": 0, "phase": "ready" }`); frame and sheet paths are relative to the project folder `data.dir`.
6. **Play it headlessly** with `--input`: a JSON script of simulated keys / clicks applied while seeking (frames are rendered in time order), then check `data.state` and the frames:
   ```bash
   npx -y @fleox/agent3d@0.5.0 render --project dodge --sheet --frames 0,1,2,3 --input '[{"t": 0.2, "click": [0, -0.3]}, {"t": 0.5, "key": "ArrowLeft", "hold": 0.6}, {"t": 1.5, "key": "Space", "down": true}, {"t": 1.6, "key": "Space", "down": false}]' --json
   ```
   Events: `{ "t", "key", "down" }` (`key` is a `KeyboardEvent.code`: `ArrowLeft`, `KeyA`, `Space`…; `down: false` releases), `{ "t", "key", "hold": seconds }` (press and release), `{ "t", "click": [x, y] }`, `{ "t", "pointer": [x, y] }` (add `"down": true` / `false` to press / release there), `{ "t", "pointerDown": [x, y] }` and `{ "t", "pointerUp": [x, y] }` (hold the pointer: `api.input.pointer.down`), `{ "t", "drag": { "from": [x, y], "to": [x, y], "duration": 0.4 } }` (press, move, release), `{ "t", "swipe": "left" | "right" | "up" | "down" }` (what `api.input.swipe()` returns next step), `{ "t", "scroll": 0.5 }` (page scroll progress, scroll-driven scenes), `{ "t", "ui": "retryBtn" }` (click that HUD button by id — a warning in `inputWarnings` when it is hidden at that time), `{ "t", "emit": "retry" }` (emit the event / button action directly), `{ "t", "segment": "intro" }` (play a timeline segment) — canvas coordinates −1..1, y up (a canvas `click` never presses a HUD button: use `ui`). Unknown fields are rejected (exit 2, the hint lists the valid shapes). Test the touch controls too, e.g. `--input '[{"t": 0.5, "swipe": "left"}, {"t": 1.2, "drag": {"from": [0, -0.5], "to": [0, 0.3], "duration": 0.3}}]'`. Use `@inputs.json` for longer scripts. MCP: `render_preview` takes the same events as `input`.
7. To test a state that is hard to reach with input (game over screen, high score), temporarily set the starting phase in `api.data` (e.g. `"startPhase": "over"`), render, then restore it.
8. `check`, then `export` (skill `agent3d-publish`). Games export like any scene; the embed gets keyboard focus on click (`tabindex`, `role="application"`).

## Game patterns in one screen

- **Phases**: `ready` (title, Play button, attract mode) → `play` → `over` (score, Retry button). HUD elements use `visible` expressions on `phase`; buttons emit their `action` to `onEvent`.
- **Input**: `api.input.pressed("ArrowLeft")` (went down this step) for discrete moves, `isDown` for continuous movement, `api.input.swipe()` for touch ("left" / "right" / "up" / "down"), `api.input.pointer` (normalised −1..1, `down`, `justPressed`), `api.input.pointerWorld()` for aiming on the ground plane. Always support both keyboard and touch.
- **Spawning**: hide a template object (`"visible": false`), then `api.clone("block", { id, position })` (synchronous, cheap) and set `visible = true`; `obj.remove()` when it leaves the screen. Keep your own array of live clones.
- **Physics** (real rigid bodies, cannon-es, deterministic fixed step): give objects a `body` — `type` `static` (floor, walls), `dynamic` (simulated: it falls, **rotates**, tumbles, stacks, sleeps), `kinematic` (you set its position, it pushes dynamic bodies), `trigger` (overlap detection only); `shape` `box` (default, from the object's own bounds — child objects never enlarge it; `compound` without `shapes` merges them), `sphere`, `cylinder`, `capsule`, `convex`, `trimesh`, `heightfield`, `compound` or `auto`. Pick the body by role:

  | Role | Body | Drive it with |
  |---|---|---|
  | Player moved by position (top-down, lanes, the starter) | `kinematic` | `obj.position.x += …` |
  | Platformer hero (gravity, jumps) | `dynamic`, `capsule`, `"character": true` | `api.physics.moveCharacter` + `jump`, `grounded` |
  | Player driven by velocity / impulses (roller, ship) | `dynamic` + `"fixedRotation": true` | `setVelocity`, `applyImpulse`, `applyForce` |
  | Props that should tumble (crates, balls, pins) | `dynamic` (`sphere` for balls, `ccd` for fast ones) | impulses, collisions |
  | Pickups, goals, kill zones | `trigger` | `onTriggerEnter`, `overlaps` |
  | Moving platforms | `kinematic` | position every update (pushes props, carries characters standing on it — never move the hero with it yourself) |

  A dynamic player without `character` / `fixedRotation` tips over as soon as friction acts on it. Events: `onCollision((a, b, info) => …)` (`info.impulse` gates impact sounds), `onTriggerEnter` / `Exit`, `contacts`, `raycast` on the real shapes. Joints (`physics.joints`: hinge, point, distance, lock, spring) build doors, pendulums, chains, wheels. `"physics": { "debug": true }` + a render shows the colliders. Recipes: `references/game-patterns.md` → Physics recipes; complete example: template `game-physics-playground`.
- **Motion from scripts**: timeline markers (`timeline.markers`) reach scripts as events — `api.on("peak", fn)` or `onEvent("peak", { marker, time })` — so a timeline can cue gameplay. Segments are played by `scene.interactions` (`on: click | hover | key | scroll | event`, `do: [{ "play": "<segment>" }]`) and by the page (`element.trigger`, `player.playSegment`); a script plays one by emitting an event: `api.emit("win")` (and HUD button `action`s) fire `{ "on": "event", "event": "win", "do": [{ "play": "celebrate" }] }`. Per-frame gameplay feedback stays in `update` (scale, position, `setColor`). `api.camera.shake(intensity, duration)` for hits; `camera.shake` / `camera.shots` in the scene are for cinematic (non-game) motion.
- **Links**: scripts cannot navigate. A "Shop now" / "Play the full game" object gets an `href` or a click interaction `{ "openUrl": "https://…" }` (user gesture only; renders emit an `openUrl` event instead).
- **Page ↔ game**: every `api.emit(name, payload)` (and HUD button action) reaches the page as an `agent3d:event` DOM event on `<agent3d-scene>`, and `element.trigger(name, payload)` from the page calls `api.on(name)` / `onEvent` (e.g. report the score, start a level from an HTML button). Details: skill `agent3d-publish`.
- **Difficulty ramp**: speed and spawn rate grow with time, clamped (`speed = Math.min(max, speed + dt * 0.4)`).
- **Best score**: `api.storage.get("best")` / `api.storage.set("best", n)` (namespaced, never throws).
- **Feedback**: `api.audio.play("hit")`, `api.camera.shake(0.3, 0.4)`, `api.ui.toast("+10", 1)`, `obj.setColor(...)`.
- **Restart**: reset your own state in a function called from `onEvent("retry")`, or `api.restart()` to rebuild the scene from its definition.
- **HUD look**: `ui.color` (text), `ui.accent` (buttons, pills' accent), `ui.buttonText` (button labels; default: white or near-black, whichever contrasts with the accent), and per element `color` / `background` (a pill, panel, button or bar track: one highlighted pill, a red danger button). `style: "panel"` is a backdrop card for game-over / pause screens (`\n` breaks lines, the first line is the heading); `pill` stays on one line. Patch one element by id: `{ "op": "set", "path": "ui.elements#retry.text", "value": "Try again" }`.

## Performance (games need a steady 60 fps)

- Post effects: no `ao` or `dof` (and no `look` preset `cinematic` / `product`, which contain `ao`): `check` warns (`postfx-cost`). Avoid `godrays`, `lensflare`, `outline`, `smaa` unless they are the point. Cheap: `bloom`, `grading`, `vignette`, `film`, `chromatic`, `fxaa` (merged or single passes). `taa` costs nothing while playing (it only supersamples stills). Read `data.budget.gpu` of `check`.
- Leave `target.quality` at `auto` (drops heavy effects and the pixel ratio on weak devices and adapts while playing); `low` for very busy scenes.
- One shadow-casting light; static level geometry as primitives or `trimesh`; clone templates instead of `spawn` in loops; `remove()` what leaves the screen; keep `physics.substeps` at 1 unless tall stacks jitter.

## Rules

- No external code, no network, no DOM: only `api`. Tell the user when a request needs something the sandbox forbids (online leaderboards, analytics) and offer a local alternative (best score in storage).
- Games must be playable on phones: touch swipes / taps for every control, big HUD buttons, no hover-only interactions. The HUD scales with the embed and anchors in one row never overlap (3 × 3 grid; side columns get ~80 px on a 360 px phone): keep side texts short, put sentences in `top` / `center` / `bottom`.
- Phone sizes: the embed keeps `target.aspect` at any width, so a 16:9 game is 390 × 219 on a 390 px phone — render exactly that (`render --size 390x219`) and check the HUD leaves room for the action. `--size 390x700` shows a taller box, which only happens when `target.height` or the page's CSS sets a height (the camera then widens its vertical view to keep the horizontal framing). For a mobile-first game, use a portrait `target.aspect` (`"9:16"` or `"3:4"`), raise the fov (65–75) or pull the camera back until every lane / target fits, and render at `--width 390`.
- Audio starts only after a user gesture (browser rule); the HUD shows a mute toggle. Keep sounds short and not too loud (`volume` 0.4–0.6).
- Reduced motion: games default to `target.reducedMotion: "ignore"` (the player drives the motion); other kinds default to `static`. Don't set `static` on a game: it would freeze it.
- Keep the first frame meaningful (attract mode) and `target.posterTime` on a frame with action: it is the poster and the reduced-motion still.
