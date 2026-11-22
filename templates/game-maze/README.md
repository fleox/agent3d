# Marble maze

A playable 1:1 marble maze (great on mobile): a procedural `maze` generator (9 × 9, always solvable, walls registered as static physics bodies) and a glossy dynamic ball you roll from the entrance (top-left) to the glowing green exit (bottom-right) against the clock. Best time saved with `api.storage`, win screen + **Play again**, and an **attract mode** in which the ball solves the maze by itself (breadth-first search over `maze.userData.maze.walls`).

## Controls

| | Keyboard | Touch / mouse |
|---|---|---|
| Roll | arrows / WASD | hold a finger: the ball rolls toward it (relative to the screen centre) |
| Start / retry | any arrow, Space, Enter | touch, or the **Play again** button |

The clock starts with the first move.

## What to tweak

| Change | Where |
|---|---|
| Another maze | `seed` (scene) — every seed is a new perfect maze |
| Size / difficulty | `objects#maze.params.columns` / `.rows` (then move `objects#goal` / `goalGlow` to x = columns·cellSize/2 + 0.9, z = rows·cellSize/2 − cellSize/2, enlarge `objects#floor`, raise the camera) |
| Ball handling | `data.maze`: `accel`, `maxSpeed`, `damping` |
| Colours | `objects#maze.params.wallColor` / `.floorColor`, `objects#ball.material.color`, `environment.background` |
| Texts | `ui.elements` |

`api.state`: `phase` (`attract` | `play` | `won`), `time`, `best`, `progress` (attract-mode % along the solution path).
