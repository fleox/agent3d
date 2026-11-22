# Product turntable hero

A 16:9 e-commerce hero: a realistic PBR boombox (`library:models/products/boombox.glb`) on a clay pedestal with a gold rim, lit by the studio HDRI (reflections) plus a key light casting a soft contact shadow. The camera turns slowly around the product (autoRotate 12°/s); visitors can drag to orbit (zoom disabled, polar angle limited so the floor never shows from below). Hovering lifts the product slightly.

## What to tweak

| Change | Where |
|---|---|
| Product | `objects#product.src` — another library model (`library:models/products/water-bottle.glb`, `…/lantern.glb`, `library:models/food/burger.glb`…) or your own `assets/<file>.glb`; `fit` = largest dimension in units (≈1.9 fills the pedestal) |
| Pedestal | `objects#pedestal.material.color`, rim `objects#pedestalRim.material.preset` (`gold`, `chrome`, `copper`) |
| Background | `environment.background.radial` (inner → outer colour) |
| Turn speed | `camera.autoRotate` (deg/s, 0 = static) |
| Reflections | `environment.lighting.hdri` (`library:hdri/studio.hdr`, `sunset.hdr`, `night.hdr`) and `.intensity` |
| Shadow strength | `lights#key.intensity`, `environment.ground.color` |

Tone mapping is `neutral` so product colours stay true. Budget: the boombox is ~250 KB + the HDRI ~400 KB (`budgetKb` 1200).
