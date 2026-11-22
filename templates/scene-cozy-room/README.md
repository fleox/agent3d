# Cozy room diorama

A 1:1 isometric room corner (orthographic camera) at golden hour:

- photoreal CC0 props from the built-in library (Poly Haven, 1k textures): `armchair` (`modern-armchair.glb`), `table` (`coffee-table.glb`), `succulent` and `plant` (the same `potted-succulent.glb`, loaded once);
- a wooden floor (`library:textures/wood-planks-*`), two plaster walls, a striped sheen rug, a stack of books, framed art (a `grainGradient` shader canvas);
- a floor lamp built from primitives with an emissive shade and a flickering warm point light; a window frame with a `rect` area light (`panel: true`) and `dust` drifting in its light;
- a warm key light with soft VSM shadows, `cinematic` look + extra AO + warm grade, a slow 16 s camera sway and pointer parallax.

## What to tweak

| Change | Where |
|---|---|
| Wall colours | `objects#wallLeft/wallBack.material.color` |
| Floor | `objects#floor.material` (`map` / `normalMap`, `repeat`, `color` multiplies the texture — lighter = paler wood) |
| Furniture | swap `src` for other library props (`library:models/products/velvet-sofa.glb`, `lounge-chair.glb`, `props/brass-vase.glb`, `props/alarm-clock.glb`…) — `agent3d assets library --query interior`; keep `fit` in metres |
| Mood | `lights#sun` (colour / intensity), `lights#lampGlow`, `lights#windowLight`; night: sun intensity 0.3 and bluer, lamp 10 |
| Art | `objects#art.material.uniforms.colors` (or a `map` image in `assets/`) |
| Motion | `timeline` (camera sway), `objects#dust.count` |

**Weight:** ≈ 2.2 MB of photoreal assets (armchair 855 KB, succulent 767 KB, table 454 KB, floor textures ~150 KB), so `target.budgetKb` is raised to 2600. For a light page swap them for the low-poly Kenney props (`library:models/props/armchair.glb`, `table.glb`, `models/nature/cactus.glb`, ~50 KB total), or add them to the project (`assets add`) and shrink them with `agent3d assets optimize --all`.
