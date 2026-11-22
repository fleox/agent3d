# Character showcase

A 16:9 cartoon line-up, 100 % procedural (0 KB of assets): five `character` generators on pastel clay pedestals, each with its own style, expression and animation, all turning their heads toward the pointer (`eyesFollowPointer`) and growing a little on hover:

| Object | Style | Animation | Expression |
|---|---|---|---|
| `astronaut` (centre) | `astronaut` | `cheer` | `laugh` |
| `robot` | `robot` | `dance` | — (screen face) |
| `fox` | `fox` | `wave` | `happy` |
| `kid` | `humanoid` (curly hair, hoodie, headphones) | `dance` | `wink` |
| `cat` | `cat` | `jump` | `surprised` |

They rise in one after the other (`appear`), a "Meet the crew" title (text from `data.title`, Fredoka `display` font with an outline) pops in (`appear`), confetti falls, soft studio light + contact shadows + the `product` look finish it. Drag to orbit (zoom off, limited tilt).

## What to tweak

| Change | Where |
|---|---|
| Title | `data.title` (or `data-title="…"` on the element); remove `objects#title` for an image-only hero |
| A character | `objects#<id>.params`: `style` (`humanoid`, `astronaut`, `robot`, `blob`, `cat`, `fox`, `bird`, `ghost`), colours (`skin`, `shirt`, `pants`, `hair`, `accent`), `expression` (`happy`, `laugh`, `neutral`, `surprised`, `wink`, `sad`, `angry`, `sleepy`), `animation` (`idle`, `walk`, `run`, `wave`, `jump`, `dance`, `cheer`, `celebrate`, `sit`, `point`, `talk`), humanoid `hairStyle` / `outfit` / `accessories` |
| Toon look | each character `params.shading: "toon"` + `postfx: [{ "type": "outline", "color": "#3b2232" }]` |
| Fewer characters | remove the outer pair (`kid`, `cat`, `pedL2`, `pedR2`) and narrow `camera.fov` to ~22 |
| Pedestal colours | `objects#ped*.material.color` |
| Background | `environment.background.radial` |
| A rigged library hero instead | replace `astronaut` by `{ "kind": "model", "src": "library:models/characters/knight.glb", "fit": 2.2, "animation": { "clip": "Cheer" } }` (≈ 700 KB) |

~75 draw calls ; ~100 k triangles per frame (more counted with the AO pre-pass). `quality: auto` drops AO on low-end devices.
