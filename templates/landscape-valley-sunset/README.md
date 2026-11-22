# Mountain valley at sunset

A 21:9 golden-hour landscape, fully procedural (0 KB of assets): a low-poly `terrain` (shape `mountains`) with snow-capped peaks (`snowLine`), an animated `water` lake on the valley floor (ripples catching the sun, shore foam), 220 swaying pines, pink clouds and fireflies near the camera. The light comes from a **physical sky** (`preset: "golden-hour"`, sun 3° above the ridge) which also adds the matching warm sun light and sky lighting; **height fog** fills the valley while peaks and sky stay clear. A `cinematic` look, soft `godrays` from the sun, a faint `lensflare` and a warm grade finish it. The camera drifts on a 14 s loop and follows the pointer (parallax).

## What to tweak

| Change | Where |
|---|---|
| Another valley | `objects#valley.seed`; relief `params.height` / `params.scale`; lake size `params.waterLevel` (absolute height; keep `objects#lake.position[1]` just above it) |
| Sun position | `environment.background.sky.sun.elevation` (degrees above the horizon) / `.azimuth` (180 = in front of the camera) |
| Time of day | `environment.background.sky.preset`: `sunrise`, `morning`, `golden-hour`, `sunset`, `dusk` (bright presets want `exposure` ≈ 0.4–0.6) |
| Sky colour | `.rayleigh` (more = deeper colours), `.turbidity` (haze), `.mieDirectionalG` (size of the sun glow), `.exposure` |
| Valley mist | `environment.fog` (`density`, `height` = top of the mist, `falloff`) |
| Forest | `objects#pines.params.count`, `.leafColors`, `.style` |
| Snow | `objects#valley.params.snowLine` (0..1 height fraction; lower = more snow), last `palette` colour |
| Lake colour | `objects#lake.params.color` (deep) / `.shallowColor` (reflection near the shore) |
| Light shafts | `postfx` `godrays.intensity` (0 = off), `lensflare` |
| Motion | `timeline` camera keys, `camera.parallax.strength` |

Budget 300 KB (nothing downloaded). About 300 k triangles drawn (pines, water, shadow pass): lower `objects#pines.params.count` for weak devices; `quality: auto` drops the AO of the cinematic look on low-end GPUs.
