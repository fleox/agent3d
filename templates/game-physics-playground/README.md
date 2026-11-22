# Tower smash (physics)

A playable 16:9 rigid-body physics playground: a 9-level tower of 27 wooden blocks (Jenga-style, alternating layers) stands on a pedestal. Click or tap anywhere to lob a ball at the point under the pointer; the blocks are real rigid bodies (they tumble, slide, stack and fall asleep when at rest). Knock every block off the pedestal in as few throws as possible. Fewest throws saved with `api.storage`, impact sounds scaled by the contact impulse (`api.physics.onCollision` → `info.impulse`), a **Rebuild** button, and an **attract mode** in which an autopilot throws at the tower and rebuilds it, so the embed is alive.

## Controls

| | Touch / mouse | Keyboard |
|---|---|---|
| Throw | tap / click the spot to hit (`api.input.pointerWorld()`) | Space (throws at the pointer) |
| Rebuild | the **Rebuild** button | — |

## How it works

- Blocks: `body: { "type": "dynamic", "mass": 0.6, "friction": 0.55 }` — the collider is the box of the mesh (rotated blocks get a rotated box).
- Balls: clones of the hidden `ballProto` (`api.clone`, synchronous so the simulation stays deterministic), launched with a ballistic velocity (`api.physics.setVelocity`) and a random spin (`api.physics.setAngularVelocity`, degrees / s). `ccd: true` adds sub-steps so fast balls never tunnel through blocks. At most `data.playground.maxBalls` balls live at once.
- Rebuild: every block gets its start position / rotation back and zero velocities — no scene reload.
- `physics.substeps: 2` and `iterations: 12` keep the tall stack stable; set `physics.debug: true` to see the colliders in renders.

## What to tweak

| Change | Where |
|---|---|
| Tower height / shape | add or remove `block…` objects (keep the `block` tag; levels are 0.3 high, starting at y = 0.75) |
| Throw feel | `data.playground.throwSpeed` (higher = flatter, faster throws), `objects#ballProto.body.mass`, `objects#ballProto.geometry.radius` |
| Autopilot pace | `data.playground.autoEvery` (seconds between throws) |
| Bounciness / grip | `body.restitution` / `body.friction` on the blocks, the pedestal and the ground |
| Colours | `objects#block….material.color` (a stain over a procedural `wood` map, 128 px so the 27 blocks stay light on GPU memory), `objects#pedestal.material`, `environment.background` / `fog` |
| Texts | `ui.elements` |

`api.state`: `phase` (`attract` | `play` | `cleared`), `down` / `total` (blocks off the pedestal), `throws`, `best`, `balls`.
