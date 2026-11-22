# Product tilt card

A 4:5 product card: a thin clear-coated plate with an `iridescentFoil` face (the rainbow glare moves as the card tilts), a sun disc, and the library rubber duck **popping out of the card** (it sits 0.6 units in front and its head overflows the top edge). The whole `card` group has the `tilt` behaviour (leans toward the pointer anywhere over the canvas, lifts and grows), an entrance rise, and links to `{data.url}`. Clicking the duck bounces it; magic sparkles drift around.

## What to tweak

| Change | Where |
|---|---|
| Name / price / badge / link | `data.name`, `data.price`, `data.badge`, `data.url` (or `data-*` on the embed) |
| Product | `objects#duck.src` + `fit` (keep the top of the model above y ≈ 1.5 for the pop-out) |
| Card palette | `objects#face.material.uniforms.tint` (foil tint), `objects#window.material.color` (disc), `objects#plate.material.color` (rim), background radial |
| Tilt feel | `objects#card.behaviours[0]` (`maxAngle`, `lift`, `hoverOnly: true` to tilt only over the card) |

Reduced motion shows a still card (no tilt). Budget ≈ 375 KB of 400 (the duck model is 250 KB); a lighter product keeps it well under.
