# Mountain valley at sunset

A 21:9 golden-hour landscape, fully procedural: a low-poly `terrain` (shape `mountains`) with snow-capped peaks (`snowLine`) and a teal lake filling the valley floor, 260 swaying pines, a low sun in a gradient sky, warm distance fog, pink clouds and fireflies near the camera. The camera drifts slowly on a 14 s loop and follows the pointer (parallax). Light bloom + vignette.

## What to tweak

| Change | Where |
|---|---|
| Another valley | `objects#valley.seed`; relief `params.height` / `params.scale`; lake size `params.waterLevel` (absolute height) |
| Time of day | `environment.background.sky` (`top`, `horizon`, `sun.direction` — y small = low sun), `environment.fog.color`, `lights#sun.color` |
| Blue hour | sky `top: "#141b3d"`, `horizon: "#7a6fb0"`, fog `#57507f`, sun colour `#9fb2ff`, `environment.lighting: "night"` |
| Forest | `objects#pines.params.count`, `.leafColors`, `.style` |
| Snow | `objects#valley.params.snowLine` (0..1 height fraction; lower = more snow), last `palette` colour |
| Lake colour | `objects#valley.params.waterColor` (keep it teal: blue water under warm fog turns purple) |
| Haze depth | `environment.fog.near` / `.far` |
| Motion | `timeline` camera keys, `camera.parallax.strength` |
