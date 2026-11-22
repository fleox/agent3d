# Floating shapes banner

A 4:1 pastel banner: a rounded 3D headline ("Make it playful", Fredoka `display` font, white outline) that pops in letter by letter, surrounded by primitives in modern finishes — translucent `jelly` (torus, cube, gem), `pearl` knot, `mattePastel` ball / pill / cone, a gold ring. The shapes (tag `shape`) spring in with a staggered timeline track, then float, spin and move with the pointer as depth layers (`parallax` behaviour). The background is a slowly drifting `meshGradient`.

## What to tweak

| Change | Where |
|---|---|
| Headline | `data.title` (or `data-title` on the embed); `objects#title.font`, `.size`, `.material.color` |
| Background | `environment.background.meshGradient` (2–6 colours), `speed` |
| Shape finishes | `objects#<id>.material` for `torus`, `ball`, `cube`, `pill`, `knot`, `cone`, `gem`, `ring`, `dot`, `dot2` (jelly: `color` + `attenuationColor`) |
| Parallax depth | each shape's `parallax.depth` (1 = front, moves most) and `camera.parallax.strength` |
| Entrance | timeline track `tag:shape.scale` (`stagger`, `staggerFrom`, spring ease) and `objects#title.reveal` |

To leave room for HTML text instead of the 3D headline, delete `objects#title`; the shapes already frame the centre. Reduced motion shows the frame at 2.5 s.
