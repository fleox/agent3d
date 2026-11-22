# Space planet hero

A cinematic 21:9 hero: a low-poly ringed planet (`planet` generator, continents + ice caps + glowing atmosphere) spinning slowly on its axis, a small moon on a tilted orbit, a 4,000-star twinkling starfield, coloured nebula dust, a comet crossing on a path, bloom and vignette. The camera breathes on a 12 s loop and drifts with the pointer. The left half is empty for an HTML headline.

## What to tweak

| Change | Where |
|---|---|
| Planet colours | `objects#planet.params.palette` (ocean, land, mountain, ice), `.landAmount` |
| Rings | `objects#planet.params.rings`, `.ringColor` |
| Atmosphere | `objects#planet.params.atmosphereColor` |
| Spin | `objects#planet.params.spin` (deg/s — use this, not a `rotate` behaviour, so the rings stay stable) |
| Axis tilt | `objects#planet.rotation` |
| Planet on the left | x of `objects#planet` and `objects#moonPivot` → `-3.4` |
| Nebula tint | `objects#nebula.color` |
| Sunlight | `lights#sun.position` / `.color` |
