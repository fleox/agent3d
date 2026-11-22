# Liquid chrome banner

A 4:1 dark abstract banner: a full-frame `liquidChrome` shader backdrop (kept soft by depth of field), a holographic blob on the left, a chrome blob on the right, a tiny iridescent bead, and a heavy Inter Black title whose letters rise from the centre outwards. Cinematic grade, light bloom, grain, pointer parallax. Zero asset bytes besides the font.

## What to tweak

| Change | Where |
|---|---|
| Title | `data.title` (or `data-title` on the embed). 4–8 letters fit at `size` 1.9; reduce `objects#title.size` for longer words |
| Backdrop colours | `objects#backdrop.material.uniforms.colors` (dark → light reflection ramp), `speed`, `scale` |
| Backdrop softness | `postfx[0]` (`dof` `aperture` / `maxblur`; remove it for a sharp backdrop) |
| Blob finishes | `objects#blobLeft.material` (holographic), `objects#blobRight.material` (chrome) — any preset, e.g. `soapBubble`, `pearl`, `gold` |
| Letter animation | `objects#title.reveal` (`effect`, `stagger`, `order`) |
| Grade | `postfx` `grading.look` (`cinematic`; try `cool`, `bleach`) |

Reduced motion shows the frame at 2.2 s (title fully revealed).
