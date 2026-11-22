# Neon title banner

A 4:1 synthwave banner: a glowing neon 3D headline ("AFTER DARK"), flickering neon tubes, a scrolling neon grid floor, a gradient sun, rising sparks and bloom. The camera drifts with the pointer (parallax).

## What to tweak

| Change | Where |
|---|---|
| Headline text | `objects#title.text` |
| Headline colour | `objects#title.material.color` / `.emissive` (keep `emissiveIntensity` ≈ 0.4 — higher blows out under bloom) |
| Grid colour | `objects#gridLong.material` and `objects#gridCross.material` |
| Sun colours | `objects#sun.material.gradient` (bottom → top) |
| Tube colours / shapes | `objects#tubeLeft`, `objects#tubeRight` (`geometry.points`) |
| Glow amount | `postfx[0]` (bloom `strength`, `threshold`) |
| Grid speed | timeline track `gridCross.position.z` (keep the distance a multiple of 1.6 for a seamless loop) |

Longer text: reduce `objects#title.size` (≈ 0.8 for 14 characters). Reduced motion shows the frame at `target.posterTime` (3 s, after the entrance animation).
