# Product turntable hero

A 16:9 e-commerce hero: a realistic PBR boombox (`library:models/products/boombox.glb`) on a terrazzo pedestal (procedural `terrazzo` texture, zero bytes) with a gold rim and a terracotta plinth, lit by the studio HDRI (reflections), a `softbox` light rig and a warm rim light, grounded by a soft contact shadow on the pedestal top. `product` look (AO, crisp grade, supersampled stills) + light vignette. The camera turns slowly around the product (autoRotate 12°/s); visitors can drag to orbit (zoom disabled, polar angle limited so the floor never shows from below). Hovering lifts the product slightly.

## What to tweak

| Change | Where |
|---|---|
| Product | `objects#product.src` — another library model (`library:models/products/water-bottle.glb`, `…/lantern.glb`, `library:models/food/burger.glb`…) or your own `assets/<file>.glb`; `fit` = largest dimension in units (≈1.9 fills the pedestal) |
| Pedestal | `objects#pedestal.material.map` (terrazzo `colors`: base then chips, `chipSize`, `density`) — or `{ "preset": "marble" }`; rim `objects#pedestalRim.material.preset` (`gold`, `chrome`, `copper`); plinth `objects#plinth.material.color` |
| Background | `environment.background.radial` (inner → outer colour) |
| Turn speed | `camera.autoRotate` (deg/s, 0 = static) |
| Reflections | `environment.lighting.hdri` (`library:hdri/studio.hdr`, `sunset.hdr`, `night.hdr`) and `.intensity` |
| Shadow | `environment.contactShadows` (`opacity`, `blur`, `color`; `y` = pedestal top) |

Tone mapping is `neutral` so product colours stay true. Budget: the boombox is ~250 KB + the HDRI ~400 KB (`budgetKb` 1200).
