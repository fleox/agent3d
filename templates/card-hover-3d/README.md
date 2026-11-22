# 3D product card

A 4:5 card for product grids: a realistic PBR water bottle (`library:models/products/water-bottle.glb`) turning slowly above a glossy sage disc with a gold base trim and a contact shadow, in front of a soft gradient backdrop circle with a thin halo, three small floating pebbles, studio HDRI reflections, a warm rim light and a pale radial background. On hover the product rig lifts, tilts toward the pointer and grows slightly. The lower third stays calm for an HTML name / price overlay.

## What to tweak

| Change | Where |
|---|---|
| Product | `objects#product.src` (any library model or `assets/<file>.glb`), `.fit` (largest dimension ≈ 1.55 for this frame) |
| Hover feel | `objects#productRig` behaviours: `hoverLift.height` / `.tilt`, `hoverScale.scale` |
| Idle spin | `objects#product` `rotate.speed` (deg/s; 0 = still) |
| Card colours | `environment.background.radial`, `objects#disc.material.color`, `objects#backdrop.material.gradient`, `objects#baseRing` (gold trim), shadow tint `environment.ground.color` |
| Calmer card | remove `objects#backdrop`, `#halo`, `#pebbleA/B/C` (each is one draw call) |
| Link the card | add `"href": "/product/123"` to `objects#productRig` |

Tone mapping is `neutral` so brand colours stay accurate. Many cards on one page: keep `target.lazy` (default) so off-screen cards don't render.
