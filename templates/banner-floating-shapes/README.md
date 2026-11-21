# Floating shapes banner

A 4:1 pastel banner: a rounded 3D headline ("Make it playful", display font) surrounded by glossy primitives (torus, rounded cube, sphere, capsule, torus knot, cone, gem) that float, spin slowly and shift with the pointer at different strengths, which reads as depth parallax.

## What to tweak

| Change | Where |
|---|---|
| Headline | `objects#title.text`, `.font` (`display`, `sans-bold`, `serif-bold`…), `.size`, `.material.color` |
| Background | `environment.background.gradient` (3 colours) and `.angle` |
| Shape colours | `objects#<id>.material.color` for `torus`, `ball`, `cube`, `pill`, `knot`, `cone`, `gem`, `ring`, `dot`, `dot2` |
| Parallax depth | each shape's `followPointer.strength` (bigger = feels closer) and `camera.parallax.strength` |
| Calmer motion | lower `float.amplitude` / `rotate.speed` on the shapes |

To leave room for HTML text instead of the 3D headline, delete `objects#title`; the shapes already frame the centre. The display font is OFL-1.1 (`check` lists its attribution); switch to `sans-bold` if you want zero attribution.
