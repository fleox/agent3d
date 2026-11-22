# Isometric city diorama

A 1:1 Townscaper-style miniature: a procedural `city` (3×3 blocks of pastel buildings with windows, parks and street trees) on a rounded clay slab, seen through an **orthographic** isometric camera that turns slowly (drag to orbit, polar angle limited). Five library vehicles (taxi, sedans, police car, hatchback), scaled up toy-style (`fit: 1.8`), drive around two street loops with the `path` behaviour (right-hand traffic, softened corners).

## What to tweak

| Change | Where |
|---|---|
| Another town | `objects#city.seed` |
| Building colours / heights | `objects#city.params.colors`, `.minHeight`, `.maxHeight` |
| Night mode | `objects#city.params.windowColor` stays lit: set `environment.background.radial: ["#2a2f5a", "#11132a"]`, `environment.lighting: "night"`, `lights#sun.intensity: 0.4`, add `{"type": "bloom", "strength": 0.8, "threshold": 0.6}` to `postfx` |
| Vehicles | `objects#taxi/sedan/police/hatch/truck.src` (any `library:models/vehicles/*.glb`), speed = `path.duration` (s per lap) |
| Framing | `camera.zoom` (world units visible vertically; 34.5 keeps the slab in frame at every angle), `camera.target` (y −1.2 centres the slab + buildings vertically) |

## Street coordinates (for your own paths)

With `blocks: 3`, `blockSize: 4`, `street: 2.2` the street centre lines are at x / z = −9.3, −3.1, 3.1, 9.3. Lanes are ±0.55 from a centre line; the two loops use 2.55 (inner, around the central block) and 8.75 (outer). If you change the city params, recompute: `c_k = -total/2 + street/2 + k·(blockSize + street)` with `total = blocks·blockSize + (blocks+1)·street`.

## Look (v0.2)

A low warm `sun` (long soft shadows over a 4096 shadow map), dimmed fill so the shadows read, a `cinematic` look at 0.5 (contact AO, grade, vignette, supersampled stills), a `tiltshift` band (the miniature-photo look: `focus`, `width`, `blur`) and a slight saturation boost. Remove `tiltshift` for a crisp infographic look; raise `lights#sun.position[1]` for a midday sun with short shadows.
