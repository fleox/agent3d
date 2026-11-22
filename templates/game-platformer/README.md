# Sky platformer

A playable side-scrolling platformer, a complete example of the **physics character controller**:

- `hero` — the rigged KayKit knight (`library:models/characters/knight.glb`, clips `Idle`, `Running_A`, `Jump_Full_Short`, `Cheer`, `Death_A`) with a `capsule` body and `"character": true`; the script drives it with `api.physics.moveCharacter` (run, air control) and `api.physics.jump` (coyote time, no double jump), and faces it left / right.
- `g0`…`g6` — static platforms (a grass rounded box with a dirt child; the `body` box is measured from the whole group).
- `moverX` / `moverY` — **kinematic** lifts moved by the script every step (a sliding lift over the first big gap, an elevator up to the high ledge). The controller has no friction, so the script carries the hero with the lift it stands on (a short raycast down).
- `coin0…12` (tag `coin`) — collected by distance; `flag` — the goal.
- Background: four `floatingIsland` generators, a sea of `clouds` below, a gradient sky.

**Game loop** (`scripts/platformer.js`): `attract` (an autopilot runs the level, waiting for the lifts) → `play` (90 s timer, 3 lives, a checkpoint every 6 m of ground; falling below `fallY` costs a life) → `won` (time + best time in `api.storage`) / `over` → Space, tap or the Play again button restarts.

**Controls:** ← → / A D run, Space / W / ↑ jump. Touch: hold the left or right third of the screen to run, tap the middle third (or swipe up) to jump.

## What to tweak

| Change | Where |
|---|---|
| Feel | `data.platformer.speed` (run m/s), `.jump` (jump m/s), `physics.gravity` (−20: snappy) |
| Rules | `data.platformer.lives`, `.time`, `.fallY` |
| Hero | `objects#hero.src`: `rogue.glb`, `mage.glb`, `barbarian.glb` (same clip names); `fit` = size |
| Level | move / add `g*` platforms (top surface = `position[1] + 0.2`), coins and the flag; update `data.platformer.aiJumps` (x where the autopilot jumps) and the lift waits in `autopilot()` |
| Lifts | `moveLifts()` in the script (amplitude, speed) |
| Look | platform colours (`material.color` of `g*` and their `*Dirt` child), `environment.background.sky`, island `seed`s |

Test headless: `render --frames 2,6,10,14,18,22 --sheet` (attract run), `render --frames 1,3,6 --input '[{"t":0.5,"key":"ArrowRight","hold":5}]'` (falls → lives → game over).
