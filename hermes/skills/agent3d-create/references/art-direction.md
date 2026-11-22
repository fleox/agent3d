# Art direction for 3D web elements

Numbers that work with the Agent3D runtime (ACES tone mapping, physically based lights, units ≈ metres). Start from them, render, look, adjust.

## Framing per target

The visible width at the subject's depth is `2 × distance × tan(fov / 2) × aspect`.

| Target | Aspect | Camera | Visible area at z = 0 | Layout |
|---|---|---|---|---|
| banner | 4:1 | fov 30, position [0, 0, 12] | ≈ 25.8 × 6.4 | Title centred (≤ 11 units wide), props at abs(x) 7.5–9, nothing in the top / bottom 10% |
| hero | 16:9 | fov 35, position [0, 0, 9] | ≈ 10.1 × 5.7 | Subject at x ≈ ±2.5 when HTML text sits on the other half |
| hero (wide) | 21:9 | fov 40, position [0, 9–11, 22–30] looking down a little | | Landscapes, panoramas |
| card | 1:1 or 4:5 | fov 32, position [0, 1.5, 5.6], target [0, 1, 0] | ≈ 3.2 × 3.2 | A character or product, centred, ground shadow |
| square | 1:1 | fov 30, position [0, 1.4, 6] | | Product turntable (orbit + autoRotate) |
| game | 16:9 | fov 50–55, behind and above the player | | Keep the HUD corners free of important action |

- The default banner title (`sans-bold`, size 1, "Golden Crust Bakery") is about 10.7 units wide: shorten the text, lower `size`, or move props further out.
- `inspect.objects[].inView` = `partial` on a prop means it is cut by the frame. Particles spanning the whole frame are expected to be `partial` (the `clipped` info from `check --render` can be ignored for them).
- Phones: the embed keeps the aspect ratio, so a 4:1 banner is only ~95 px tall on a 390 px screen. Keep text big (title size ≥ 0.9 in a banner) or use a taller aspect for mobile (`target.height` or a second export). Render at `--size 390x98` to see it.

## Lighting recipes

All lights are in `lights[]`. Give them ids (`key`, `fill`, `rim`) so you can tune them with paths like `lights#key.intensity`.

**Studio (products, logos, titles)**
```json
[
  { "id": "fill", "type": "hemisphere", "skyColor": "#ffffff", "groundColor": "#8a8f99", "intensity": 0.9 },
  { "id": "key", "type": "directional", "position": [3, 6, 4], "intensity": 2.2, "castShadow": true },
  { "id": "rim", "type": "spot", "position": [-3, 4, -3], "target": [0, 1, 0], "intensity": 40, "angle": 35, "penumbra": 0.6 }
]
```
with `"environment": { "lighting": "studio" }` (or `{ "hdri": "library:hdri/studio.hdr" }`) for reflections, and `"ground": { "y": 0, "shadowOnly": true }` so the object sits on the page.

**Warm sunset (landscapes, food, lifestyle)**: hemisphere sky `#cfe8ff` / ground `#6b5a3e` at 0.9, directional sun from the side and low (`[-10, 14, 8]`), colour `#ffe0b0`, intensity 2.4, shadows on; `lighting: "sunset"` at 0.6; sky background with `horizon` `#ffd8a8` and fog of the same colour starting beyond the subject.

**Night neon (tech, gaming, nightlife)**: dark background (`#07061a` → `#1a0b3d`), very low fill (hemisphere 0.3), two saturated point lights (magenta `#ff2fd6` and cyan `#3ee8ff`, intensity 10–40, distance 12–20) on opposite sides, `neon` material preset on thin shapes, `lighting: "night"`, bloom strength 0.5–0.8 threshold 0.85.

**Soft pastel (characters, kids, friendly brands)**: `lighting: "soft"`, hemisphere white / tinted ground at 1, key 2–2.2 with shadows on a shadow-only ground, rim directional from behind in a warm tint at 1.5. Clay and toon materials.

Too bright? Lower `environment.lightingIntensity` first (IBL adds up with every light), then point lights. A generator like `blob` is very reflective: point lights around 12 at distance 12 are plenty. Too flat? Raise the key and lower the fill; add a rim.

## Palettes

- Build the background from 2–3 tones of the brand colour (gradient from dark to mid, `angle` 0 = bottom → top) and make the subject lighter or more saturated. Radial backgrounds (`{ "radial": [centre, edge] }`) focus the eye on the centre.
- One accent colour for the smallest elements (sparks, a ring, particles).
- Bakery / food: `#2a1306 #5c2c0c #a8561b` + cream `#fff4e0` + dough `#d9944a`.
- Tech / SaaS: `#0d0e24 #2b2d6e` + iridescent / pearl + accents `#ff4fd8` `#3ee8ff`.
- Nature: sky `#3a7bd5` → `#ffd8a8`, greens `#7cb35b #4e8a3a`, sand `#f2d49b`, sea `#1d6fa3 #4fc3d9`.
- Pastel: `#ffe5ec #ffc2d1 #fb6f92` + deep plum `#3d2c4e` for contrast.
- Gold, chrome and glass need an environment to reflect (`lighting` set) and a background that is not the same colour.

## Materials

- `preset` first, then a few overrides (`color`, `roughness`). Presets: plastic, matte, clay, chrome, brushedMetal, gold, copper, glass, frostedGlass, rubber, pearl, holographic, neon, toon, flat, lowpoly, velvet, wireframe, normal.
- Clay / matte / lowpoly read well at small sizes and stay calm. Chrome and gold look premium but need reflections and contrast. Glass needs something behind it.
- Shaders (`{ "type": "shader", "shader": "gradientFlow", "uniforms": { … } }`) animate a surface for free: plasma, waves, noise, hologram, gradientFlow, toonRim, dissolve (animate `uniforms.progress` with a timeline track).

## Motion

- Behaviours are cheap procedural motion: `float`, `rotate`, `sway`, `bob`, `pulse`, `orbit`, `drift`; interaction: `followPointer`, `lookAtPointer`, `hoverScale`, `hoverLift`, `clickBounce`, `spinOnClick`, `magnet`; scroll: `scrollRotate`, `scrollMove`; entrance: `appear` (effect scale / fade / rise / drop / spin).
- Desync repeated objects with `phase` (float) so they don't move in unison.
- Timeline loops: same value at 0 and at `duration`, `ease: "inOutSine"` for breathing motion. Camera moves: animate `camera.position` slowly (a dolly of 1–2 units over 8 s) or use `controls: "parallax"`.
- Scroll stories: `timeline.trigger: "scroll"` maps the timeline to the scroll progress of the embed; or `camera.controls: "scroll"` with a `scrollPath`.
- Banners must not distract from the page: no flashing, no fast spins, loops ≥ 6 s, `blink` and `flicker` only on small elements. Respect reduced motion (`target.reducedMotion: "static"`, default) and pick a `posterTime` where the composition is complete.

## Performance budgets

`check` warns above these limits (`target.budgetKb` overrides the KB one); the "aim for" column is what keeps a page fast on a mid-range phone.

| Target | KB budget (assets + scripts + scene, runtime excluded) | Triangle limit in `check` | Aim for |
|---|---|---|---|
| banner | 600 | 500 k | ≤ 50 k triangles |
| card | 400 | 400 k | ≤ 50 k |
| square / inline | 600 | 500 k | ≤ 80 k |
| hero | 1500 | 1 M | ≤ 150 k |
| fullscreen | 4000 | 2 M | ≤ 300 k |
| game | 4000 | 2 M | ≤ 200 k, draw calls < 150 (`check` warns above 150) |

- The shared runtime (`agent3d-runtime/`, ~1.6 MB uncompressed, loaded lazily in chunks: only what the scene uses is fetched) is not counted: it is downloaded once per site and cached.
- `check` estimates the geometry triangles drawn once (`budget.estimatedTriangles`: catalog cost formulas, measured per-glyph costs for 3D text — a bevelled glyph costs ~1.3 k triangles —, model counts from the library index or the `.glb` itself); `check --render` and `render` report the real counts (`stats.triangles`, `stats.drawCalls`), which include every pass (shadow maps re-draw the casters, post effects add quads) and are typically 2–4× the estimate. After a render, `budget.triangles` is the measured number (`trianglesSource: "runtime"`).
- Cheap: primitives, `instances`, generators, particles, library models (most are a few KB to tens of KB), `flat` / `basic` materials. Expensive: high `segments`, `detail` > 4 on icosahedrons, many shadow-casting lights, transmission (glass), `dof`, 4k textures.
- `target.maxDpr` (default 2) caps the pixel ratio; lower to 1.5 for heavy fullscreen scenes.
