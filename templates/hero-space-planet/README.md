# Space planet hero

A cinematic 21:9 hero: a low-poly ringed planet (`planet` generator, continents + ice caps + glowing atmosphere) spinning slowly on its axis, a small moon on a tilted orbit, side-lit by a strong sun so the night side falls into shadow, in front of a slow `nebula` shader backdrop (a large plane at z = -18) with a slab of twinkling `stars` particles, coloured nebula dust, a comet crossing on a path, bloom, a faint lens flare, a cinematic grade, vignette and fine grain. The camera breathes on a 12 s loop and drifts with the pointer. The left half is empty for an HTML headline.

## What to tweak

| Change | Where |
|---|---|
| Planet colours | `objects#planet.params.palette` (ocean, land, mountain, ice), `.landAmount` |
| Rings | `objects#planet.params.rings`, `.ringColor` |
| Atmosphere | `objects#planet.params.atmosphereColor` |
| Spin | `objects#planet.params.spin` (deg/s — use this, not a `rotate` behaviour, so the rings stay stable) |
| Axis tilt | `objects#planet.rotation` |
| Planet on the left | x of `objects#planet` and `objects#moonPivot` → `-3.4` |
| Nebula backdrop | `objects#nebulaSky.material.uniforms.colors` (dark → bright gas), `.scale`, `.speed`; dust tint `objects#nebula.color` |
| Stars | `objects#stars.count` / `.size` (a slab in front of the backdrop: a `starfield` generator around the camera would be hidden by the backdrop plane) |
| Sunlight | `lights#sun.position` (behind = thin crescent, in front = full disc) / `.color` / `.intensity` |
