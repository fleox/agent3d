# Aurora night banner

A 4:1 night banner: an `aurora` shader sky plane rippling behind low-poly `terrain` mountains (dark silhouettes with snowy peaks), twinkling stars, falling snow motes, two glowing `crystals` clusters (cyan left, violet right) casting coloured light pools on the snow, and a Montserrat ExtraBold headline that fades in letter by letter. Bloom, cool grade, grain, pointer parallax. Zero asset bytes besides the font.

## What to tweak

| Change | Where |
|---|---|
| Headline | `data.title` (or `data-title` on the embed). ~15 characters at `size` 0.8; reduce it for longer text |
| Aurora colours / speed | `objects#sky.material.uniforms` (`colors`, `speed`, `intensity`; keep `background` = `environment.background`) |
| Crystal colours | `objects#crystalsL.params.colors`, `objects#crystalsR.params.colors` (+ the matching `lights#glowL` / `glowR` colours) |
| Mountains | `objects#mountains.params` (`seed` on the object for another range, `height`, `palette`) |
| Letter animation | `objects#title.reveal` (`fade` here; `rise`, `drop`, `scale`, `spin`) |

Reduced motion shows the frame at 3 s (headline complete).
