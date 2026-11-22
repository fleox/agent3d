# SaaS globe hero

A 16:9 dark hero for SaaS, fintech and network products: the `globe` generator (dot-matrix continents, fresnel atmosphere, pulsing markers, great-circle arcs with travelling light pulses) sits on the right third of a deep-navy radial backdrop with a faint orbit ring and stars. The camera is offset to the left, so the **left half stays empty for the page's HTML headline and buttons** (place them over the canvas). Pointer parallax, bloom, a cool grade and supersampled stills. Zero asset bytes.

## What to tweak

| Change | Where |
|---|---|
| Cities and connections | `objects#globe.params.arcs` (`{ "from": [lat, lon], "to": [lat, lon] }`) — or `params.points` for markers only |
| Palette | `params.dotColor` (land), `arcColor`, `markerColor`, `atmosphereColor`, `baseColor`; backdrop `environment.background.radial` |
| Which side of the world faces the viewer | `params.longitude` (degrees at t = 0), `params.spin` (deg/s), `params.tilt` |
| Globe on the other side | flip the sign of `camera.position[0]` and `camera.target[0]` (and `background.center[0]` → 0.3) |
| Glow | `postfx[0]` (bloom) |
| Text in 3D instead of HTML | add a `text` object around x = −5 |

Reduced motion shows the frame at 2 s (after the globe's entrance).
