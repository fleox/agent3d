# Neon title banner

A 4:1 synthwave banner: a Bebas Neue headline ("AFTER DARK") with a sunset gradient that glows (`gradientEmissive`) and a dark recessed `outline`, dropping in letter by letter from the centre (`reveal`); a cyan neon script tagline in Pacifico that pops in and flickers; neon tubes, a scrolling neon grid floor, a gradient sun, rising sparks and dust. Bloom + punchy grade + light chromatic fringes. The camera drifts with the pointer.

## What to tweak

| Change | Where |
|---|---|
| Headline / tagline | `data.title`, `data.script` (or `data-title` / `data-script` on the embed) |
| Headline colours | `objects#title.material.gradient` (bottom → top), `emissiveIntensity` for the glow |
| Tagline colour | `objects#script.material` (neon preset: `color` + `emissive`) |
| Grid colour | `objects#gridLong.material` and `objects#gridCross.material` |
| Sun colours | `objects#sun.material.gradient` (bottom → top) |
| Tube colours / shapes | `objects#tubeLeft`, `objects#tubeRight` (`geometry.points`) |
| Glow amount | `postfx[0]` (bloom `strength`, `threshold`) |
| Grid speed | timeline track `gridCross.position.z` (keep the distance a multiple of 1.6 for a seamless loop) |

~10 characters fit at `size` 1.5; reduce `objects#title.size` for longer text. Reduced motion shows the frame at `target.posterTime` (3 s, after the entrance).
