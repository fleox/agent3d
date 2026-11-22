# Wave grid banner

A dark 4:1 tech / data banner: ~8,000 dots (`waveGrid` generator, one draw call) undulate like a signal and ripple under the pointer, beneath a flat Space Grotesk headline that rises letter by letter and a small blinking mono kicker ("LIVE DATA · 24/7"). Light bloom, cool grade, faint chromatic fringes, vignette; the camera drifts with the pointer.

## What to tweak

| Change | Where |
|---|---|
| Headline / kicker | `data.headline`, `data.kicker` (or `data-headline` / `data-kicker` on the embed) |
| Headline look | `objects#headline.font`, `.size`, `.material.color` (keep it ≤ `#d0e8ff` or the bloom haloes it) |
| Grid colours | `objects#grid.params.colors` (colour ramp, 2–3 colours) |
| Wave height / speed | `objects#grid.params.amplitude`, `.speed` |
| Bars or lines instead of dots | `objects#grid.params.shape`: `"bars"` or `"lines"` |
| Density | `objects#grid.params.columns`, `.rows`, `.spacing` (keep columns × spacing ≈ 40 so the field reaches both edges) |
| Background | `environment.background.radial` and `environment.fog.color` (keep them close) |
| Glow | `postfx[0]` bloom `strength` / `threshold` |

No text in 3D? Delete `objects#headline` and `objects#kicker` and overlay HTML. Reduced motion shows the frame at 2 s.
