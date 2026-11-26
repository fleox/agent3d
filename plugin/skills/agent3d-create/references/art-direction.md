# Art direction for 3D web elements

Numbers that work with the Agent3D runtime (ACES tone mapping by default, physically based lights, units ≈ metres). Start from them, render, look, adjust. Exact parameters live in the catalog — never guess them:

```bash
npx -y @fleox/agent3d@0.3.1 catalog lightRigs --json
npx -y @fleox/agent3d@0.3.1 catalog postfx look --json
npx -y @fleox/agent3d@0.3.1 catalog materialPresets --json
```

Complete, rendered scenes for each idea below: [recipes.md](recipes.md).

## Premium defaults

Start every scene from the row of its target kind, render, then deviate on purpose. "Look" = `postfx: [{ "type": "look", "preset": … }]`; "Rig" = `environment.rig`.

| Kind | Environment | Rig | Look / postfx | Quality tier | Recipe |
|---|---|---|---|---|---|
| banner (4:1) | `meshGradient` or 2–3 tone `gradient` / `radial` background, `lighting: "studio"` at 0.6–0.9 | `studio-3point` (or two hand-placed directionals) | `clean`; no bloom on light backgrounds | `auto` | gradient |
| hero (16:9) | `radial` background focused where the subject is, `lighting: "studio"` 0.4–0.8 | `studio-3point`, `dramatic` (moody), `neon` (night) | `cinematic` at 0.6–0.8, or `neon` at 0.7 | `auto` | reveal, scroll, neon |
| product / card / square | light `radial` background in the product's tones, `lighting: "studio"` (zero bytes) or `{ "hdri": "library:hdri/softbox.hdr" }` (richer, +1.5 MB) | `softbox` (soft, any material), `product-top` (glossy, metal) | `product` | `auto` | product |
| landscape (21:9) | physical sky `{ "sky": { "preset": "golden-hour" \| "afternoon" \| … } }` + height fog; the sky adds the sun light | none (the sky's sun) or `golden-hour` / `noon` / `overcast` with a gradient sky | bloom + warm `grading` + vignette, or `cinematic` at 0.6–0.8 on light scenes (its AO pre-pass re-draws all the geometry) | `auto` | landscape |
| character | soft `radial` background, `lighting: "soft"` | `studio-3point` with a warm `color` tint | `clean` (or none) | `auto` | character |
| game | plain gradient / colour, `lighting: "studio"` or `"soft"` | `studio-3point` | none, or cheap only: `bloom`, `grading`, `vignette`, `fxaa` | `medium` | game |

Always: `contactShadows` under objects that stand on something (products, characters, props) — it needs no shadow-casting light; `ariaLabel`; a `posterTime` where the composition is complete.

`contactShadows.far` is how high above the plane objects still cast (scene units; default ≈ 0.9 × the height of what stands on the plane). Objects floating higher than 0.6 × `far` leave no smudge, so a title hovering over a product does not darken the floor; raise `far` for a taller, softer shadow under a tall object, lower it for a tight contact line. `y` pins the plane when particles or a low prop would otherwise pull it down.

**Mobile and games — avoid**:

- `ao` and `dof` (high GPU cost), `godrays` and `lensflare` (medium) re-render or sample the scene every frame (one `bloom` is acceptable); `taa` only supersamples stills and paused frames. `check` reports the cost in `budget.gpu` (`level` none / light / moderate / heavy, `dropped.low` = effects the `low` tier turns off) and flags it (`postfx-cost`: info above ~15 fullscreen passes, a warning for `ao` / `dof` on a game target). The `cinematic` and `product` looks include `ao` + `taa`: fine on a hero still, not in a game.
- Volumetric spots, several shadow-casting lights, transmission (`glass`, `diamond`, `jelly`, `soapBubble` on large surfaces) and 2k+ textures.
- Heavy HDRIs on small embeds: the bundled `.hdr` files weigh 0.4–1.9 MB each; `lighting: "studio" | "soft" | "sunset" | "night"` are free.
- Set `target.quality: "medium"` (DPR 1.5, heavy effects at half resolution) for games and busy fullscreen scenes; `auto` already drops to `medium` on phones and lowers the pixel ratio when the frame rate stays under 40 fps.

## Framing per target

The visible width at the subject's depth is `2 × distance × tan(fov / 2) × aspect`.

| Target | Aspect | Camera | Visible area at z = 0 | Layout |
|---|---|---|---|---|
| banner | 4:1 | fov 30, position [0, 0, 12] | ≈ 25.8 × 6.4 | Title centred (≤ 11 units wide), props at abs(x) 7.5–9, nothing in the top / bottom 10% |
| hero | 16:9 | fov 35, position [0, 0, 9–10] | ≈ 10.1 × 5.7 | Subject at x ≈ ±2.5 when HTML text sits on the other half; a centred headline ≤ 8 units wide |
| hero (wide) | 21:9 | fov 38–40, high and far, looking slightly down | | Landscapes, panoramas: keep ~35 % sky |
| card | 1:1 or 4:5 | fov 30–32, position [0, 1.5, 5.4], target [0, 1, 0] | ≈ 3.2 × 3.2 | A character or product, centred, contact shadow |
| square | 1:1 | fov 28–30, position [0, 1.2–1.4, 6.3] | | Product turntable (orbit + autoRotate) |
| game | 16:9 (desktop-first) or 9:16 / 3:4 (mobile-first) | fov 42–55 at 16:9, 65–75 in portrait, behind and above the action | | Keep the HUD corners and the bottom button row free of important action |

- The default banner title (`sans-bold`, size 1, "Golden Crust Bakery") is about 10.7 units wide: shorten the text, lower `size`, use `maxWidth` to wrap, or move props further out.
- `inspect.objects[].inView` = `partial` on a prop means it is cut by the frame. Particles and scattered generators (trees, rocks, grass, flowers, clouds) spanning the frame are expected to be `partial`: `check --render` never reports them as `clipped`, and it ignores objects created by scripts at run time.
- Camera shots (`pushIn`, `crane`, `orbit`…) and timelines move the camera: render the frames where it is closest and check nothing is cut (a `pushIn` of 2+ units on a bust cuts the head).
- Phones: the embed keeps `target.aspect` at any width (it is `width: 100%` with an `aspect-ratio`), so a 4:1 banner is ~98 px tall and a 16:9 game 390 × 219 on a 390 px phone. Render the real embed size to judge it: `render --size 390x98` (banner), `--size 390x219` (16:9 game). Keep text big (title size ≥ 0.9 in a banner).
- A taller box happens only when `target.height` is set (e.g. `"70vh"`) or the page's CSS gives the element a height / `aspect-ratio`. The camera then keeps the authored horizontal framing by widening the vertical view (up to 3×, never above ~100°): `render --size 390x700` previews that case, not the default embed.
- Mobile-first games and portrait cards: design for a portrait `target.aspect` (`"9:16"`, `"3:4"`) instead — a portrait frame at the same fov shows far less width, so raise the fov (65–75) or pull the camera back until every lane / target is in frame, and render at `--width 390`. Or ship a second export with the other aspect for phones.

## Lighting

Prefer a **rig** (`environment.rig`, `catalog lightRigs`): tuned lights placed for a subject 1–3 units around the origin, with `intensity`, `rotation` (moves the highlight), `scale` (bigger scenes) and `color` (tint). Add lights to `lights[]` only for accents; give them ids so paths like `lights#key.intensity` can tune them.

Hand-placed studio set (when no rig fits):

```json
[
  { "id": "fill", "type": "hemisphere", "skyColor": "#ffffff", "groundColor": "#8a8f99", "intensity": 0.9 },
  { "id": "key", "type": "directional", "position": [3, 6, 4], "intensity": 2.2, "castShadow": true },
  { "id": "rim", "type": "spot", "position": [-3, 4, -3], "target": [0, 1, 0], "intensity": 40, "angle": 35, "penumbra": 0.6 }
]
```

- **Physical sky**: `preset` sets the sun; `sun.elevation` 3–12 for golden hour, 40+ for noon. `sun.azimuth` is degrees around Y from +Z: with the usual camera on +Z looking at the origin, 0 = the sun behind the camera (front-lit scene), 90 = from the right (+X), 180 = straight ahead in the frame (back light), 270 = from the left. The frame covers about 180 ± half the horizontal fov (± 45 for a 21:9 at fov 40): keep a low sun just outside it (azimuth 50–130 or 230–310) or high above it; a low sun in view with fog or bloom washes the image out. The sky adds its own sun light — no extra directional needed. Every preset is tuned to look rich at the default `exposure` (1, a multiplier of the preset's own value): leave it, or nudge it (0.7 deeper, 1.3 brighter) instead of fighting a washed-out sky with grading.
- **Fog**: linear `{ color, near, far }` to fade the far floor / horizon only (start it beyond the subject); exponential `{ density }` for haze (0.02–0.05 reads; it also dims near objects); height fog `{ density, height, falloff }` for valleys and ground mist. Without `color`, fog takes the sky's horizon.
- **Landscapes**: one `terrain` + scatterers + water at the **same `position`** (scatterers with `onTerrain` sit on it; move the camera, not the terrain). `shape: "basin"` = a lake ringed by mountains (`waterLevel` ≈ 0.1 × `height`), `"valley"` = a flat floor along z closed by a range at the far end (a camera on +z looks down it); `edgeFalloff` sinks the borders so no cut wall shows; `snowHeight` sets an absolute snow altitude (trees stay below it). For a better lake: `waterPlane: false` on the terrain + a `water` object at `y = waterLevel` (`"reflections": true` for a mirror lake — it renders the scene twice). Birds: the `birds` generator (`drift` + `formation: "v"` for geese crossing the sky), never particles. Recipe: golden-hour landscape.
- **Roads** (`road` generator, runners): `color`, `lineColor`, `curbColors` (two alternate, one = solid), `vergeColor` (two stripes, or one colour + a darker stripe), `verge: false` for the road alone (neon runners on black).
- **Rect lights** (`type: "rect"`, `width`, `height`, `panel: true`): visible light strips and softboxes. They face their `target` (default: the origin) — set a target at their own height to keep vertical strips upright.
- **Volumetric spots** (`volumetric: { intensity }`): a glowing cone from the light to its target; reads best on a dark background with a little fog.
- **Night neon**: very dark background, `lighting: "night"` at ~0.4, saturated magenta / cyan rect strips, `neon` material, a glossy dark `ground`, the `neon` look at 0.7.

Too bright? Lower `environment.lightingIntensity` first (IBL adds up with every light), then rig `intensity`. Too flat? A rig with a rim (`studio-3point`, `rim`, `dramatic`) or `rig.rotation` for a side key.

## Palettes

- Build the background from 2–3 tones of the brand colour (gradient from dark to mid, `angle` 0 = bottom → top; or `meshGradient` with 4–5 colours) and make the subject lighter or more saturated. Radial backgrounds (`{ "radial": [centre, edge], "center": [x, y] }`) focus the eye on the subject.
- One accent colour for the smallest elements (sparks, a ring, particles, one word of a headline).
- Bakery / food: `#2a1306 #5c2c0c #a8561b` + cream `#fff4e0` + dough `#d9944a`; pastel shop `#ffe9ef #fff6ea` + plum text `#5a2a3c`.
- Tech / SaaS: `#0b0a24 #2a2470` + white + gold accent `#ffb02e`, or iridescent + `#ff4fd8` `#3ee8ff`.
- Nature: physical sky + greens `#6f8f3c #46703a`, rock `#7a6a6e`, snow `#fdf7f2`.
- Pastel: `#ff9a8b #ff6a88 #a18cd1 #fbc2eb #8fd3f4` + plum outline `#4a1a6e`.
- Gold, chrome and glass need an environment to reflect (`lighting` set) and a background that is not the same colour.

## Materials

- `preset` first, then a few overrides (`color`, `roughness`): 38 presets from `plastic` / `clay` / `chrome` to the photoreal set (`carPaint`, `ceramic`, `marble`, `terrazzo`, `wood`, `brushedAluminium`, `diamond`, `jelly`, `chromeGradient`, `soapBubble`, `mattePastel`…) — `catalog materialPresets`.
- Physical params (`clearcoat`, `sheen`, `iridescence`, `transmission`, `anisotropy`…) with `"type": "physical"`; textures are paths, library ids or **procedural textures** `{ "procedural": "wood" | "marble" | … }` (zero bytes, `catalog textures`); `triplanar` for generators and stretched shapes.
- Clay / matte / `mattePastel` read well small and stay calm (`mattePastel` lightens its colour a lot: give it saturated colours). Chrome, gold and `chromeGradient` look premium but need reflections and contrast.
- `toon` (preset or `"type": "toon"`) is lit like every other surface (environment fill, area lights, shadows) with the direct light quantised into bands: the lit band shows the `color` as written, so give it the brand colour itself (no need to brighten it to compensate).
- Glass (`glass`, `frostedGlass`, `ice`, `water`, `gem`, `diamond`, `jelly`) refracts what is behind it, on dark and light backgrounds alike (bright lights behind a pane no longer flare into a white glare): give it something to bend (props, a gradient, text behind), and set `thickness` to the object's real depth — 0.05–0.2 for panes and bubbles, about the object's size for solid pieces (more = stronger distortion). Tint with `attenuationColor` + `attenuationDistance`. Each transmissive object renders the scene again behind it: count it in the triangles per frame.
- White or near-white surfaces under a softbox blow out: use a tone of the background instead.
- Shaders animate a surface for free (`catalog shaders`: plasma, gradientFlow, aurora, liquidChrome, iridescentFoil, lavaLamp, grainGradient…); dissolve-style shaders animate `material.uniforms.progress` with a timeline track.

## Post-processing

- Start from a **look** (`cinematic`, `product`, `dreamy`, `neon`, `retro`, `clean`) with `intensity` 0.6–1; an effect listed next to it overrides the look's matching entry (`{ "type": "vignette", "darkness": 0.5 }`). Expansions: `catalog postfx look`.
- Bloom only glows what is brighter than its `threshold`: emissive text around 2–2.6 under the `neon` look; above ~3 the whole frame turns into fog. White text on a light background glows too — drop bloom there.
- `dof` with `focusOn: "<id>"`, `godrays` (from the sky sun or a light), `lensflare`, `tiltshift`, `halftone`, `ascii`, `glitch` are effects for a still hero, not for small or busy embeds.

## Typography

- Fonts: `catalog fonts` (13, all kerned). Headlines: `inter-black`, `montserrat-extrabold`, `bebas-neue` / `anton` (condensed, fits more), `serif-bold` (elegant). Small text: `sans` with `depth: 0` and a `basic` material (always readable).
- `outline` (`{ "width": 0.05, "color": … }`) makes light text read on light or busy backgrounds; `maxWidth` wraps long titles.
- `reveal` (rise / fade / scale / spin / drop, `stagger` 0.04–0.06) for entrances; letters become `<id>/<n>` targets for timeline tracks (`children:<id>` = all letters, or a comma list with `stagger`).
- Layout: a text block is centred vertically on its `position` (from the first line's cap height to the last line's baseline) and placed horizontally by `align`: `center` (default) centres every line on x, `left` starts the lines at x (they grow to the right), `right` ends them at x. Extra lines (`\n`, `maxWidth` wrapping, a longer `{data.*}` value) grow the block up **and** down around `position`, so a title that gains a line moves its first line up: leave room above and below, or anchor captions with `align: "left"` at a corner.
- Cost: `reveal` / `splitLetters` make one mesh per letter, and an `outline` adds a second mesh per letter: a 20-letter outlined reveal is ~40 draw calls before shadows. Keep outlines for unsplit titles or short words; `depth: 0` text with a `basic` material is the cheapest.
- `bevel` is a number (the bevel size in scene units, default `min(depth × 0.3, size × 0.035)`), not a boolean; `0` gives sharp edges.

## Motion

- Behaviours are cheap procedural motion: `float`, `rotate`, `sway`, `bob`, `breathe`, `noise`; interaction: `followPointer`, `spring`, `tilt`, `hoverScale`, `hoverLift`, `magnet`; scroll: `scrollRotate`, `scrollMove`, `parallax`; entrance: `appear` — `catalog behaviours`.
- Desync repeated objects with `phase` so they don't move in unison.
- Timelines: per-key eases (`outBack`, `cubicBezier(…)`, `spring(170, 12)`), relative values (`"+=0.3"`), multi-target selectors with `stagger`, `markers` / `segments`. Loops: same value at 0 and `duration`, `inOutSine`.
- Camera: `camera.shots` (`pushIn`, `orbit`, `crane`, `path`, `focus`…) for cinematic moves; `shake` (tiny amounts) for handheld life; `controls: "parallax"` for pointer depth.
- Scroll stories: `timeline.trigger: "scroll"` + `timeline.scroll` maps the timeline (and the shots) to the page scroll.
- No-code interactivity: `scene.interactions` (`hover` / `hoverEnd` / `click` → `set` tweens, `play` / `toggle` segments, `openUrl`, `emit`).
- Banners must not distract from the page: no flashing, no fast spins, loops ≥ 6 s, `blink` and `flicker` only on small elements or subtle. Respect reduced motion (`target.reducedMotion: "static"`, default) and pick a `posterTime` where the composition is complete (after entrances and reveals).

## Performance budgets

`check` warns above these limits (`target.budgetKb` overrides the KB one); the "aim for" column is what keeps a page fast on a mid-range phone — `check` says so above it (a warning with `--render`). Triangles and draw calls are counted **per frame, all passes included**: every shadow-casting light re-draws its casters, `ao` / `dof` add a pre-pass of the scene, contact shadows re-draw what stands on the plane, transmission (glass) and mirror water re-render the scene. A 50 k-triangle scene with one shadow light and the `cinematic` look is ~150 k per frame.

| Target | KB budget (assets + scripts + scene, runtime excluded) | Triangle limit in `check` | Aim for |
|---|---|---|---|
| banner | 600 | 500 k | ≤ 150 k triangles per frame |
| card | 400 | 400 k | ≤ 150 k |
| square / inline | 600 | 500 k | ≤ 250 k |
| hero | 1500 | 1 M | ≤ 400 k |
| fullscreen | 4000 | 2 M | ≤ 600 k |
| game | 4000 | 2 M | ≤ 300 k per frame, draw calls < 150 per frame (`check` warns above 150 and names the causes) |

Why these numbers: a mid-range phone GPU (Adreno 6xx / Mali-G57 class) sustains roughly 1–1.5 M lit triangles per frame at 60 fps in WebGL. An embed takes a fraction of that so the page (and any other scene on it) stays smooth: a strip banner or a card ~10 %, the one hero of a page ~⅓, a fullscreen piece ~½, a game less than a hero (it must hold 60 fps while scripts and physics use the CPU). They are per-frame totals: geometry × passes. A hero with one shadow light and the `cinematic` look draws its geometry ~3× (main + shadow map + AO pre-pass), so ~130 k triangles of geometry is the hero aim. To get under an aim without changing the look, in this order: `castShadow: false` on what casts no visible shadow (water, distant scatter, tiny props, objects far from the ground); drop the AO pre-pass where it adds little (wide landscapes seen from afar, flat UI-like banners): replace the `look` with the effects it expands to minus `ao` (`agent3d catalog postfx look` lists each preset's stack); lower generator detail that is invisible at the framing (terrain `resolution`, scatter `count` beyond the fog, `segments`); split / outlined text costs a mesh (and its triangles) per letter, twice with an outline.

- The shared runtime (`agent3d-runtime/`, loaded lazily in chunks: only what the scene uses is fetched) is not counted: it is downloaded once per site and cached.
- `check` estimates triangles from catalog cost formulas, measured glyph costs (a bevelled serif headline costs far more than a flat sans one) and model counts, then per frame (`budget.estimatedFrameTriangles`, `budget.passes`: each shadow-casting light, `ao` / `dof` / `godrays` / `outline` and `contactShadows` re-draw the scene or its casters); `check --render` and `render` report the real counts (`stats.triangles`, `stats.drawCalls`), which include every pass. The GPU side is `budget.gpu` (post-processing passes per frame).
- Cheap: primitives, `instances`, generators, particles, procedural textures, small library models, `flat` / `basic` materials. Expensive: HDRI files, photoreal library models (0.4–1.8 MB, `assets optimize` helps), high `segments`, transmission, `ao` / `dof`, many shadow casters.
- `target.maxDpr` (default 2) caps the pixel ratio; `target.quality` picks the tier (see Premium defaults).
