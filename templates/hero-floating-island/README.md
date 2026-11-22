# Floating island hero

A 16:9 dreamy hero, 100 % procedural (0 KB of assets): a `floatingIsland` generator (grassy top, trees, flowers, a pond with a waterfall, rocky underside, floating debris, slow bob) hanging over a sea of pastel `clouds`, two small islets in the distance, three flapping birds (tiny groups: a capsule body and two `sway` wings, carried by an `orbit` behaviour) and `magic` glints. The background is a screen gradient (salmon → peach → lavender → blue), the distance fades into a matching peach `fog`, and a softened `dreamy` look plus a warm grade finish it. The camera turns slowly (`autoRotate`) and drifts with the pointer (`parallax`).

## What to tweak

| Change | Where |
|---|---|
| Another island | `objects#island.seed`, `.params.trees`, `.treeStyle` (`pine`, `palm`, `birch`…), `.flowers`, `.hills` |
| Waterfall side | `objects#island.rotation[1]` (the waterfall faces the camera at 110°) |
| Island colours | `objects#island.params.grassColors`, `.dirtColor`, `.rockColors`, `.leafColors`, `.waterColor` |
| Sky mood | `environment.background.gradient` (bottom → top) and `environment.fog.color` (keep it close to the gradient at the clouds' height) |
| Night version | gradient `["#1b1640", "#3a2c6b", "#0b0d24"]`, fog `#2a2350`, swap `glints` for `fireflies`, lights dimmer and bluer |
| Birds | `objects#bird1..3` — `orbit.radius`, `.speed` (negative = clockwise), `scale`; remove them for a calmer scene |
| Motion | `camera.autoRotate` (0 = still), `camera.parallax.strength` |
| Room for a headline | set `camera.autoRotate` to 0 and move `camera.target` sideways (e.g. `[-4, -0.3, 0]`) so the island sits on one side |

Budget: hero 1500 KB (it uses none); about 100 k triangles, mostly grass blades and clouds — lower `objects#island.params.grass` and `objects#cloudSea.params.count` for weaker devices.
