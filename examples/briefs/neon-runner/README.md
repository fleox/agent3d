# Endless runner

A genuinely playable 16:9 endless runner ("Lane Dash"): a procedural runner on the `road` generator, three lanes, barriers to dodge or jump, coin trails, speed ramping up over time, score (distance + coins × 10), best score saved with `api.storage`, game over with a **Play again** button, synth sounds (zero bytes) and a self-playing **attract mode** — with no input the game plays itself (never loses), so the embed is alive and the headless renders show action.

## Controls

| | Keyboard | Touch / mouse |
|---|---|---|
| Change lane | ← / → (A / D) | tap the left / right half, or swipe left / right |
| Jump | ↑, W or Space | swipe up |
| Start / retry | any of the above, Enter | tap, or the **Play again** button |

## How it works (`scripts/runner.js`)

- Pools of 8 barriers (tag `barrier`) and 12 coins (tag `coin`) are recycled: rows spawn at z = −70 and scroll toward the camera at `speed`; the road reads `road.userData.speed` so its stripes match.
- Collisions are lane + z checks (no physics needed); a jump (sine arc) clears barriers.
- `api.state` exposes `phase` (`attract` | `play` | `over`), `score`, `best`, `coins`, `speed`, `lane` — the HUD placeholders and `visible` conditions read them.

## What to tweak

| Change | Where |
|---|---|
| Difficulty | `data.runner`: `startSpeed`, `maxSpeed`, `accel` (units/s²), `coinValue` |
| Game name / texts | `ui.elements` (`title`, `hint`, `over`, `retry`) |
| Runner look | `objects#runner.params` (`style`, colours) — or replace it with a library model (keep id `runner`, e.g. `library:models/characters/robot.glb` with `animation.clip: "Running"`) |
| Barrier / coin look | the children of `objects#obstacles` / `objects#pickups` (keep the tags) |
| Road / scenery | `objects#road.params` (`color`, `lineColor`), `hillsL` / `hillsR` tree styles, `environment.background.sky` |
| Sounds | `audio.sounds` (synth presets: `coin`, `jump`, `lose`, `click`, `whoosh`, …) |

Games ignore `prefers-reduced-motion` by design (`target.reducedMotion: "ignore"`): the visitor starts them explicitly.
