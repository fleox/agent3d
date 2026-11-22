# Coin collector arena

A playable 16:9 3D platformer ("Coin Rush"): the Kenney platformer hero (`library:models/characters/platformer-hero.glb`, clips idle / walk / jump) runs and jumps across a floating grass island and three platforms to grab 12 coins before the 45 s timer ends. Light physics (dynamic hero, static platforms, trigger coins, gravity), a follow camera, fall → respawn, best time saved with `api.storage`, win / time's-up screens with **Play again**, synth sounds and a self-playing **attract mode** (the hero collects coins on its own until a key or tap).

## Controls

| | Keyboard | Touch / mouse |
|---|---|---|
| Move | arrows / WASD | hold a finger: the hero walks toward it (relative to the screen centre) |
| Jump | Space | quick tap, or swipe up |
| Start / retry | any key | tap, or the **Play again** button |

## How it works (`scripts/collector.js`)

- The hero's horizontal velocity is set from input each step; jumping sets `velocity.y` when it touches a body tagged `ground` (`api.physics.contacts`).
- Coins (tag `coin`, trigger bodies) are collected with `api.physics.overlaps`.
- `api.state`: `phase` (`attract` | `play` | `won` | `over`), `coins`, `total`, `time`, `timeBar` (0..1, the HUD bar), `best`.

## What to tweak

| Change | Where |
|---|---|
| Time limit, run speed, jump strength | `data.collector`: `time`, `speed`, `jump` (gravity: `physics.gravity`) |
| Level layout | platforms `arena`, `stepA`, `stepB`, `tower` (keep tag `ground` + a static `body`); coins in `objects#coins` (add / move children, keep tag `coin`) |
| Hero | `objects#hero.src` — another animated library character; the script plays clips `idle`, `walk`, `jump` (rename them in `play(...)` calls for other models, e.g. robot: `Idle`, `Walking`, `Jump`) |
| Texts / colours | `ui.elements`, `ui.accent`, `environment.background` |

The round island's collision box is a 10 × 10 square (`objects#arena.body.size`), inscribed in the visual circle.
