# 3D product card

A 4:5 card for product grids: a realistic PBR water bottle (`library:models/products/water-bottle.glb`) turning slowly above a glossy sage disc with a gold base trim and a soft contact shadow (`environment.contactShadows`), in front of a soft gradient backdrop circle with a thin halo, three small floating pebbles, studio HDRI reflections, a softbox light rig, a warm rim light, a pale radial background and the `product` look (AO, crisp grade, supersampled stills). On hover the product rig lifts, tilts toward the pointer and grows slightly. A flat name and price (data-bound) sit along the bottom; the product links to `{data.url}`.

## What to tweak

| Change | Where |
|---|---|
| Name / price / link | `data.name`, `data.price`, `data.url` (or `data-name`… on the embed); delete `objects#name` / `#price` to use an HTML overlay instead |
| Product | `objects#product.src` (any library model or `assets/<file>.glb`), `.fit` (largest dimension ≈ 1.55 for this frame) |
| Hover feel | `objects#productRig` behaviours: `hoverLift.height` / `.tilt`, `hoverScale.scale` |
| Idle spin | `objects#product` `rotate.speed` (deg/s; 0 = still) |
| Card colours | `environment.background.radial`, `objects#disc.material.color`, `objects#backdrop.material.gradient`, `objects#baseRing` (gold trim), shadow tint `environment.contactShadows.color` |
| Calmer card | remove `objects#backdrop`, `#halo`, `#pebbleA/B/C` (each is one draw call) |

Tone mapping is `neutral` so brand colours stay accurate. Many cards on one page: keep `target.lazy` (default) so off-screen cards don't render.
