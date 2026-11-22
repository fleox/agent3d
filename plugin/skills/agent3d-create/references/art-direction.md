# Art direction for 3D web elements

Numbers that work with the Agent3D runtime (ACES tone mapping by default, physically based lights, units ≈ metres). Start from them, render, look, adjust. Exact parameters live in the catalog — never guess them:

```bash
npx -y @fleox/agent3d@0.2.0 catalog lightRigs --json
npx -y @fleox/agent3d@0.2.0 catalog postfx look --json
npx -y @fleox/agent3d@0.2.0 catalog materialPresets --json
```

Complete, rendered scenes for each idea below: [recipes.md](recipes.md).

## Premium defaults

Start every scene from the row of its target kind, render, then deviate on purpose. "Look" = `postfx: [{ "type": "look", "preset": … }]`; "Rig" = `environment.rig`.

| Kind | Environment | Rig | Look / postfx | Quality tier | Recipe |
|---|---|---|---|---|---|
| banner (4:1) | `meshGradient` or 2–3 tone `gradient` / `radial` background, `lighting: "studio"` at 0.6–0.9 | `studio-3point` (or two hand-placed directionals) | `clean`; no bloom on light backgrounds | `auto` | gradient |
| hero (16:9) | `radial` background focused where the subject is, `lighting: "studio"` 0.4–0.8 | `studio-3point`, `dramatic` (moody), `neon` (night) | `cinematic` at 0.6–0.8, or `neon` at 0.7 | `auto` | reveal, scroll, neon |
| product / card / square | light `radial` background in the product's tones, `lighting: "studio"` (zero bytes) or `{ "hdri": "library:hdri/softbox.hdr" }` (richer, +1.5 MB) | `softbox` (soft, any material), `product-top` (glossy, metal) | `product` | `auto` | product |
| landscape (21:9) | physical sky `{ "sky": { "preset": "golden-hour" \| "afternoon" \| … } }` + height fog; the sky adds the sun light | none (the sky's sun) or `golden-hour` / `noon` / `overcast` with a gradient sky | `cinematic` at 0.8 | `auto` | landscape |
| character | soft `radial` background, `lighting: "soft"` | `studio-3point` with a warm `color` tint | `clean` (or none) | `auto` | character |
| game | plain gradient / colour, `lighting: "studio"` or `"soft"` | `studio-3point` | none, or cheap only: `bloom`, `grading`, `vignette`, `fxaa` | `medium` | game |

Always: `contactShadows` under objects that stand on something (products, characters, props) — it needs no shadow-casting light; `ariaLabel`; a `posterTime` where the composition is complete.

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
| game | 16:9 | fov 42–55, behind and above the action | | Keep the HUD corners free of important action |

- The default banner title (`sans-bold`, size 1, "Golden Crust Bakery") is about 10.7 units wide: shorten the text, lower `size`, use `maxWidth` to wrap, or move props further out.
- `inspect.objects[].inView` = `partial` on a prop means it is cut by the frame. Particles and scattered generators (trees, rocks, grass, flowers, clouds) spanning the frame are expected to be `partial`: `check --render` never reports them as `clipped`, and it ignores objects created by scripts at run time.
- Camera shots (`pushIn`, `crane`, `orbit`…) and timelines move the camera: render the frames where it is closest and check nothing is cut (a `pushIn` of 2+ units on a bust cuts the head).
- Phones: the embed keeps the aspect ratio, so a 4:1 banner is only ~95 px tall on a 390 px screen. Keep text big (title size ≥ 0.9 in a banner) or use a taller aspect for mobile (`target.height` or a second export). Render at `--size 390x98` to see it.

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

- **Physical sky**: `preset` sets the sun; `sun.elevation` 3–12 for golden hour, 40+ for noon; `sun.azimuth` 0 = towards a camera on +Z. Keep the sun out of frame (azimuth 50–130 or 230–310 from a +Z camera): a low sun in view with fog or bloom washes the image out. The sky adds its own sun light — no extra directional needed.
- **Fog**: linear `{ color, near, far }` to fade the far floor / horizon only (start it beyond the subject); exponential `{ density }` for haze (0.02–0.05 reads; it also dims near objects); height fog `{ density, height, falloff }` for valleys and ground mist. Without `color`, fog takes the sky's horizon.
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
- Clay / matte / `mattePastel` read well small and stay calm (`mattePastel` lightens its colour a lot: give it saturated colours). Chrome, gold and `chromeGradient` look premium but need reflections and contrast. Glass needs something behind it.
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

## Motion

- Behaviours are cheap procedural motion: `float`, `rotate`, `sway`, `bob`, `breathe`, `noise`; interaction: `followPointer`, `spring`, `tilt`, `hoverScale`, `hoverLift`, `magnet`; scroll: `scrollRotate`, `scrollMove`, `parallax`; entrance: `appear` — `catalog behaviours`.
- Desync repeated objects with `phase` so they don't move in unison.
- Timelines: per-key eases (`outBack`, `cubicBezier(…)`, `spring(170, 12)`), relative values (`"+=0.3"`), multi-target selectors with `stagger`, `markers` / `segments`. Loops: same value at 0 and `duration`, `inOutSine`.
- Camera: `camera.shots` (`pushIn`, `orbit`, `crane`, `path`, `focus`…) for cinematic moves; `shake` (tiny amounts) for handheld life; `controls: "parallax"` for pointer depth.
- Scroll stories: `timeline.trigger: "scroll"` + `timeline.scroll` maps the timeline (and the shots) to the page scroll.
- No-code interactivity: `scene.interactions` (`hover` / `hoverEnd` / `click` → `set` tweens, `play` / `toggle` segments, `openUrl`, `emit`).
- Banners must not distract from the page: no flashing, no fast spins, loops ≥ 6 s, `blink` and `flicker` only on small elements or subtle. Respect reduced motion (`target.reducedMotion: "static"`, default) and pick a `posterTime` where the composition is complete (after entrances and reveals).

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

- The shared runtime (`agent3d-runtime/`, loaded lazily in chunks: only what the scene uses is fetched) is not counted: it is downloaded once per site and cached.
- `check` estimates triangles from catalog cost formulas, measured glyph costs (a bevelled serif headline costs far more than a flat sans one) and model counts; `check --render` and `render` report the real counts (`stats.triangles`, `stats.drawCalls`), which include every pass. The GPU side is `budget.gpu` (post-processing passes per frame).
- Cheap: primitives, `instances`, generators, particles, procedural textures, small library models, `flat` / `basic` materials. Expensive: HDRI files, photoreal library models (0.4–1.8 MB, `assets optimize` helps), high `segments`, transmission, `ao` / `dof`, many shadow casters.
- `target.maxDpr` (default 2) caps the pixel ratio; `target.quality` picks the tier (see Premium defaults).
