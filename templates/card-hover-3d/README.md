# 3D product card

A 4:5 card for product grids: a realistic PBR water bottle (`library:models/products/water-bottle.glb`) turning slowly above a soft clay disc with a contact shadow, studio HDRI reflections and a pale gradient. On hover the product rig lifts, tilts toward the pointer and grows slightly. The lower third stays calm for an HTML name / price overlay.

## What to tweak

| Change | Where |
|---|---|
| Product | `objects#product.src` (any library model or `assets/<file>.glb`), `.fit` (largest dimension ≈ 1.55 for this frame) |
| Hover feel | `objects#productRig` behaviours: `hoverLift.height` / `.tilt`, `hoverScale.scale` |
| Idle spin | `objects#product` `rotate.speed` (deg/s; 0 = still) |
| Card colours | `environment.background.gradient`, `objects#disc.material.color`, shadow tint `environment.ground.color` |
| Link the card | add `"href": "/product/123"` to `objects#productRig` |

Tone mapping is `neutral` so brand colours stay accurate. Many cards on one page: keep `target.lazy` (default) so off-screen cards don't render.
