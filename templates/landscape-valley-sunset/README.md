# Mountain valley at sunset

A 21:9 golden-hour landscape, fully procedural (0 KB of assets): a low-poly `terrain` (shape `valley`: forested walls, a snowy range closing the far end, borders sinking smoothly with the default `edgeFalloff`) with snow above an absolute `snowHeight`, an animated `water` lake on the valley floor (the terrain's own plane is off with `waterPlane: false`; `waterLevel` still shapes the shore and keeps trees out of the water), 520 swaying pines sharing the terrain's position (they stay below the snow), pink clouds and fireflies near the camera. The light comes from a **physical sky** (`preset: "golden-hour"`, sun 5° up at the right edge of the frame) which also adds the matching warm sun light and sky lighting; **height fog** fills the valley while peaks and sky stay clear. A `cinematic` look, soft `godrays` and a light warm grade finish it. The camera drifts on a 14 s loop and follows the pointer (parallax).

## What to tweak

| Change | Where |
|---|---|
| Another valley | `objects#valley.seed`; relief `params.height` / `params.scale`; `params.shape` `basin` for a lake ringed by mountains; lake size `params.waterLevel` (absolute height; keep `objects#lake.position[1]` equal to it). Keep `valley`, `lake` and `pines` at the same `position` |
| Sun position | `environment.background.sky.sun.elevation` (degrees above the horizon) / `.azimuth` (0 = behind the camera, 90 = from the right, 180 = straight ahead in the frame; 152 puts it at the right edge of the 21:9 frame, 120 just out of frame) |
| Time of day | `environment.background.sky.preset`: `sunrise`, `morning`, `golden-hour`, `sunset`, `dusk` (every preset is tuned for the default `exposure` 1; 0.7 = deeper colours, 1.3 = brighter) |
| Sky colour | `.rayleigh` (more = deeper colours), `.turbidity` (haze), `.mieDirectionalG` (size of the sun glow), `.exposure` |
| Valley mist | `environment.fog` (`density`, `height` = top of the mist, `falloff`) |
| Forest | `objects#pines.params.count`, `.leafColors`, `.style` |
| Snow | `objects#valley.params.snowHeight` (absolute altitude; lower = more snow; the pines stay below it), last `palette` colour |
| Lake colour | `objects#lake.params.color` (deep) / `.shallowColor` (reflection near the shore) |
| Light shafts | `postfx` `godrays.intensity` (0 = off) |
| Motion | `timeline` camera keys, `camera.parallax.strength` |

Budget 300 KB (nothing downloaded). About 150 k triangles (estimate; more with the shadow pass) (pines, water, shadow pass): lower `objects#pines.params.count` for weak devices; `quality: auto` drops the AO of the cinematic look on low-end GPUs.
