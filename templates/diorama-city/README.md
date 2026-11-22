# Isometric city diorama

A 1:1 Townscaper-style miniature: a procedural `city` (4×4 blocks of pastel buildings with windows, parks and street trees) on a rounded clay slab, seen through an **orthographic** isometric camera that turns slowly (drag to orbit, polar angle limited). Five library vehicles (taxi, sedans, police car, hatchback) drive around two street loops with the `path` behaviour (right-hand traffic, softened corners).

## What to tweak

| Change | Where |
|---|---|
| Another town | `objects#city.seed` |
| Building colours / heights | `objects#city.params.colors`, `.minHeight`, `.maxHeight` |
| Night mode | `objects#city.params.windowColor` stays lit: set `environment.background.radial: ["#2a2f5a", "#11132a"]`, `environment.lighting: "night"`, `lights#sun.intensity: 0.4`, add `postfx: [{"type": "bloom", "strength": 0.8, "threshold": 0.6}]` |
| Vehicles | `objects#taxi/sedan/police/hatch/truck.src` (any `library:models/vehicles/*.glb`), speed = `path.duration` (s per lap) |
| Framing | `camera.zoom` (world units visible vertically; 38 keeps the slab in frame at every angle) |

## Street coordinates (for your own paths)

With `blocks: 4`, `blockSize: 4`, `street: 1.8` the street centre lines are at x / z = −11.6, −5.8, 0, 5.8, 11.6. Lanes are ±0.45 from a centre line; the two loops use 5.35 (inner) and 11.15 (outer). If you change the city params, recompute: `c_k = -total/2 + street/2 + k·(blockSize + street)` with `total = blocks·blockSize + (blocks+1)·street`.
