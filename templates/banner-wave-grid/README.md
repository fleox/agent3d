# Wave grid banner

A dark 4:1 tech / data banner: ~6,600 glowing dots (`waveGrid` generator, one draw call) undulate like a signal and ripple under the pointer, beneath a monospace headline ("REAL-TIME INSIGHTS"). Bloom and a vignette finish the look; the camera drifts with the pointer.

## What to tweak

| Change | Where |
|---|---|
| Headline | `objects#headline.text`, `.size`, `.material.emissive` (glow colour) |
| Grid colours | `objects#grid.params.colors` (colour ramp, 2–3 colours) |
| Wave height / speed | `objects#grid.params.amplitude`, `.speed` |
| Bars or lines instead of dots | `objects#grid.params.shape`: `"bars"` or `"lines"` |
| Density | `objects#grid.params.columns`, `.rows`, `.spacing` (keep columns × spacing ≈ 39 so the field reaches both edges) |
| Background | `environment.background.radial` and `environment.fog.color` (keep them close) |
| Glow | `postfx[0]` bloom `strength` |

No text in 3D? Delete `objects#headline` and overlay HTML. The mono font is Apache-2.0 (`check` lists the attribution).
