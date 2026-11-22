---
name: agent3d-game
description: Build a mini game or an interactive 3D experience for a web page with Agent3D scripts - a sandboxed ScriptApi (objects, input with keyboard, pointer and touch swipes, light physics and collisions, spawning and cloning, HUD with placeholders, synth sounds, best-score storage, events), game patterns (ready / play / over state machine, difficulty ramp, attract mode so screenshots show action), and testing through deterministic headless renders. Use when the user wants a playable game, a quiz-like interaction, a clickable 3D configurator or anything that needs logic beyond behaviours and timelines.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 22+ and Google Chrome (or Chromium/Edge) for renders.
metadata:
  version: "0.1.0"
  repository: "https://github.com/fleox/agent3d"
allowed-tools: Bash Read Write
---

# Mini games with Agent3D

A game is an ordinary scene (`target.kind: "game"`) plus **scripts**: ES modules listed in `scene.scripts`, each exporting a factory that gets the sandboxed `api` and returns lifecycle hooks. Everything else (objects, HUD, sounds, physics bodies, data) stays declarative in `scene.json`.

**Language:** talk to the user in their language; keep commands, ids, code and files in English.

Every command is `npx -y @fleox/agent3d@0.1.0 <command> --json` with `--project <dir>`. Read `error.hint` when `ok` is false.

## Start

```bash
npx -y @fleox/agent3d@0.1.0 new dodge --target game --title "Dodge" --json
npx -y @fleox/agent3d@0.1.0 scene summary --project dodge --json
```

The game starter has a player, coins with a `coin` tag, a follow camera, a score HUD, a coin sound and `scripts/game.js` (move with arrows / WASD, collect coins). A complete validated example (lane runner: lanes, spawning by cloning, difficulty ramp, best score, attract mode) is in skill `agent3d-create` → `references/recipes.md` ("Game"); patterns in [references/game-patterns.md](references/game-patterns.md); the full API in [references/script-api.md](references/script-api.md).

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
4. Validate and lint: `npx -y @fleox/agent3d@0.1.0 check --project dodge --json` (sandbox errors carry the line: `scripts/game.js:12`).
5. Render several moments and LOOK:
   ```bash
   npx -y @fleox/agent3d@0.1.0 render --project dodge --sheet --frames 0,2,4,6 --json
   ```
   Plain renders have no player input, so the game must show something on its own: an **attract mode** (an autopilot plays during the `ready` phase, behind the title and Play button). The HUD is captured because the scene has a `ui` (`--capture page` forces it). Check `data.issues` and `data.consoleErrors` for `script-error`. `data.state` is the script's `api.state` after the last frame (e.g. `{ "score": 0, "phase": "ready" }`); frame and sheet paths are relative to the project folder `data.dir`.
6. **Play it headlessly** with `--input`: a JSON script of simulated keys / clicks applied while seeking (frames are rendered in time order), then check `data.state` and the frames:
   ```bash
   npx -y @fleox/agent3d@0.1.0 render --project dodge --sheet --frames 0,1,2,3 --input '[{"t": 0.2, "click": [0, -0.3]}, {"t": 0.5, "key": "ArrowLeft", "hold": 0.6}, {"t": 1.5, "key": "Space", "down": true}, {"t": 1.6, "key": "Space", "down": false}]' --json
   ```
   Events: `{ "t", "key", "down" }` (`key` is a `KeyboardEvent.code`: `ArrowLeft`, `KeyA`, `Space`…; `down: false` releases), `{ "t", "key", "hold": seconds }` (press and release), `{ "t", "click": [x, y] }`, `{ "t", "pointer": [x, y] }` (add `"down": true` / `false` to press / release there), `{ "t", "pointerDown": [x, y] }` and `{ "t", "pointerUp": [x, y] }` (hold the pointer: `api.input.pointer.down`), `{ "t", "drag": { "from": [x, y], "to": [x, y], "duration": 0.4 } }` (press, move, release), `{ "t", "swipe": "left" | "right" | "up" | "down" }` (what `api.input.swipe()` returns next step) — canvas coordinates −1..1, y up; a click on a HUD button does not trigger it — emit the action from a key instead while testing. Unknown fields are rejected (exit 2, the hint lists the valid shapes). Test the touch controls too, e.g. `--input '[{"t": 0.5, "swipe": "left"}, {"t": 1.2, "drag": {"from": [0, -0.5], "to": [0, 0.3], "duration": 0.3}}]'`. Use `@inputs.json` for longer scripts. MCP: `render_preview` takes the same events as `input`.
7. To test a state that is hard to reach with input (game over screen, high score), temporarily set the starting phase in `api.data` (e.g. `"startPhase": "over"`), render, then restore it.
8. `check`, then `export` (skill `agent3d-publish`). Games export like any scene; the embed gets keyboard focus on click (`tabindex`, `role="application"`).

## Game patterns in one screen

- **Phases**: `ready` (title, Play button, attract mode) → `play` → `over` (score, Retry button). HUD elements use `visible` expressions on `phase`; buttons emit their `action` to `onEvent`.
- **Input**: `api.input.pressed("ArrowLeft")` (went down this step) for discrete moves, `isDown` for continuous movement, `api.input.swipe()` for touch ("left" / "right" / "up" / "down"), `api.input.pointer` (normalised −1..1, `down`, `justPressed`), `api.input.pointerWorld()` for aiming on the ground plane. Always support both keyboard and touch.
- **Spawning**: hide a template object (`"visible": false`), then `api.clone("block", { id, position })` (synchronous, cheap) and set `visible = true`; `obj.remove()` when it leaves the screen. Keep your own array of live clones.
- **Collisions**: give objects a `body` (`static`, `dynamic`, `kinematic`, `trigger`; shape `box`, `sphere` or `auto`). `api.physics.overlaps(a, b)` for simple checks, `onCollision(handler)` for dynamic bodies, `raycast` for line of sight, `applyImpulse` for jumps.
- **Difficulty ramp**: speed and spawn rate grow with time, clamped (`speed = Math.min(max, speed + dt * 0.4)`).
- **Best score**: `api.storage.get("best")` / `api.storage.set("best", n)` (namespaced, never throws).
- **Feedback**: `api.audio.play("hit")`, `api.camera.shake(0.3, 0.4)`, `api.ui.toast("+10", 1)`, `obj.setColor(...)`.
- **Restart**: reset your own state in a function called from `onEvent("retry")`, or `api.restart()` to rebuild the scene from its definition.

## Rules

- No external code, no network, no DOM: only `api`. Tell the user when a request needs something the sandbox forbids (online leaderboards, analytics) and offer a local alternative (best score in storage).
- Games must be playable on phones: touch swipes / taps for every control, big HUD buttons, no hover-only interactions. The HUD scales with the embed and anchors in one row never overlap (3 × 3 grid; side columns get ~80 px on a 360 px phone): keep side texts short, put sentences in `top` / `center` / `bottom`, and check with `render --size 360x640`.
- Audio starts only after a user gesture (browser rule); the HUD shows a mute toggle. Keep sounds short and not too loud (`volume` 0.4–0.6).
- Reduced motion: games default to `target.reducedMotion: "ignore"` (the player drives the motion); other kinds default to `static`. Don't set `static` on a game: it would freeze it.
- Keep the first frame meaningful (attract mode) and `target.posterTime` on a frame with action: it is the poster and the reduced-motion still.
