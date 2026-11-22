# Night galaxy landscape

A calm 16:9 night scene, 100 % procedural (0 KB of assets). Back to front:

- `aurora` — a huge plane with the `aurora` shader (curtain colours, speed, brightness), with a slab of twinkling `stars` particles in front of it;
- `galaxy` — the `galaxy` generator (50–60 k additive stars, 3 arms, warm core, slow differential rotation), tilted 68° and hung high in the sky;
- `ridge` (far mountains) and `hills` (near ground) — two dark low-poly `terrain`s, plus scattered dark `rocks`;
- `crystalsA/B/C` — three `crystals` clusters (purple, cyan, pink) with pulsing emissive glow, each lit by a coloured point light (`glowA`, `glowB`) so the ground around them catches their colour;
- `fireflies` drifting over the ground.

Bloom, a cool grade, vignette and fine grain; supersampled stills (`taa`). The camera drifts on a 20 s loop and follows the pointer.

## What to tweak

| Change | Where |
|---|---|
| Aurora colours / speed | `objects#aurora.material.uniforms.colors`, `.speed`, `.intensity` |
| Galaxy | `objects#galaxy.params` (`arms`, `twist`, `armColor`, `accentColor`, `coreGlow`, `speed`), its `rotation` (tilt) and `position` |
| Crystal colours | `objects#crystalsA..C.params.colors` (base → tip) — keep `lights#glowA/glowB.color` matching |
| Crystal glow | `.params.glow`, `.pulse` (0 = steady) and the `bloom` strength |
| Ground colour | `objects#hills.params.palette`, `objects#ridge.params.palette` (keep them dark so the sky reads) |
| Room for a headline | the left half of the sky is calm; move `objects#galaxy.position[0]` to `-8` to swap sides |
| Motion | `timeline` camera keys (remove for a still camera), `camera.parallax.strength` |

Budget: hero 1500 KB (nothing downloaded); ~32 k triangles + 60 k galaxy points — light enough for phones.
