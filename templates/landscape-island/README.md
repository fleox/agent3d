# Low-poly island

A 16:9 procedural diorama, zero downloads: an island `terrain` (beach band, grass, rocky summit) in an animated turquoise `water` sea, a mixed forest + palms (`trees`, swaying in the wind, never placed under water), `rocks`, `flowers` and drifting `clouds` under a soft sky. The camera orbits slowly; visitors can drag to orbit and scroll/pinch to zoom (limited).

## What to tweak

| Change | Where |
|---|---|
| Another island | `objects#island.seed` (any integer), `.params.height`, `.params.scale` (bigger = wider features) |
| Terrain colours | `objects#island.params.palette` (sand, grass, forest, rock, snow) |
| Sea colours | `objects#sea.params.color` / `.shallowColor`, waves `.waveHeight` |
| Forest density / style | `objects#forest.params.count`, `.style` (`pine`, `round`, `birch`, `mixed`…), `.leafColors` |
| Autumn | `objects#forest.params.leafColors: ["#d9822b", "#c0392b", "#f1c40f"]` |
| Sky | `environment.background.sky` (`top`, `horizon`, `sun.direction`), keep `environment.fog.color` close to the horizon |
| Turn speed | `camera.autoRotate` (0 = still) |
| Room for a headline | the orbit sweeps the island across the whole frame: set `camera.autoRotate` to `0` (and `camera.controls` to `"none"` if the hero sits behind clickable HTML), then move `camera.target` sideways, e.g. `[-8, 1, 0]`, so the island sits on the right and the left half stays calm for the text |

Scatter generators (`trees`, `rocks`, `flowers`) sit on the sibling terrain and avoid its `waterLevel` (keep the sea's y ≈ `waterLevel`).

Budget: everything is procedural (0 KB of assets), so the hero's default 1500 KB budget applies; the cost is GPU time (triangles), which `check --render` measures.
