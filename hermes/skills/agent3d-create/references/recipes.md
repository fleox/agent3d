# Recipes: showcase scenes

Each scene below passed `scene validate` (no errors, no warnings) and `check --render`, and was rendered and looked at (the README images in `docs/images/recipe-*.jpg` come from them). Start from the closest one, then change the brand parts (text, colours, model, URLs) with `scene patch` and render again:

```bash
python3 <skill dir>/scripts/agent3d.py new my-scene --target hero --json
python3 <skill dir>/scripts/agent3d.py scene validate --project my-scene --file recipe.json --json
python3 <skill dir>/scripts/agent3d.py scene apply --project my-scene --file recipe.json --yes --json
python3 <skill dir>/scripts/agent3d.py check --render --project my-scene --json
python3 <skill dir>/scripts/agent3d.py render --project my-scene --sheet --count 4 --json
```

Exact parameters of every rig, look, material, shader, generator and behaviour: `python3 <skill dir>/scripts/agent3d.py catalog <section> [id] --json`. Premium starting points per target kind: [art-direction.md](art-direction.md#premium-defaults).

## Product shot (1:1): softbox packshot

A library bottle on a ceramic pedestal, soft studio light, blurred contact shadow, slow turntable that the visitor can drag.

```json
{
  "version": 1,
  "id": "bottle-packshot",
  "title": "Water bottle packshot",
  "ariaLabel": "A reusable water bottle turning slowly on a ceramic pedestal in a soft studio; drag to look around",
  "target": {"kind": "square", "aspect": "1:1", "reducedMotion": "static", "posterTime": 1.5},
  "camera": {
    "type": "perspective",
    "fov": 28,
    "position": [0, 1.2, 6.3],
    "target": [0, 0.95, 0],
    "controls": "orbit",
    "orbitZoom": false,
    "autoRotate": 10,
    "orbitLimits": {"minPolar": 60, "maxPolar": 92}
  },
  "environment": {
    "background": {"radial": ["#f3e4d4", "#c9ad94"], "center": [0.5, 0.62], "radius": 0.95, "grain": 0.02},
    "lighting": "studio",
    "rig": {"preset": "softbox", "intensity": 0.85, "rotation": -25},
    "contactShadows": {"opacity": 0.6, "blur": 2.5},
    "lightingIntensity": 0.8
  },
  "lights": [],
  "objects": [
    {
      "id": "pedestal",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 1.1, "radiusBottom": 1.1, "height": 0.3, "segments": 96},
      "position": [0, 0.15, 0],
      "material": {"preset": "ceramic", "color": "#b8876a", "roughness": 0.35}
    },
    {
      "id": "bottle",
      "kind": "model",
      "src": "library:models/products/water-bottle.glb",
      "fit": 1.75,
      "position": [0, 0.3, 0],
      "castShadow": true,
      "behaviours": [{"type": "hoverLift", "height": 0.12, "tilt": 5}]
    }
  ],
  "postfx": [{"type": "look", "preset": "product"}]
}
```

- The `softbox` rig gives long soft highlights; `"lighting": "studio"` adds reflections for zero bytes (`{ "hdri": "library:hdri/softbox.hdr" }` looks a bit richer but adds ~1.5 MB: over the 600 KB square budget).
- `contactShadows` grounds the object without a shadow-casting light; `look: product` adds AO, a crisp grade and supersampled stills (AO is dropped on the `low` tier).
- Knobs: `fit` (size), the pedestal `color` (keep it a tone of the background, not white: white ceramic blows out under a softbox), `rig.rotation` to move the highlight.
- Your own model: `assets add ./bottle.glb --license proprietary`, then `"src": "assets/models/bottle.glb"`; keep `fit`.

## Golden-hour landscape (21:9): physical sky, valley terrain, lake, birds

A low-poly valley at golden hour: a mirror lake on the valley floor, pine forests below a snow line, warm side light from a low physical sun just out of frame, haze in the valley, a V of birds crossing the sky, a slow camera sway.

```json
{
  "version": 1,
  "id": "golden-valley",
  "title": "Golden-hour valley",
  "ariaLabel": "A low-poly mountain valley at golden hour: a lake on the valley floor, pine forests, snowy peaks, haze and a flock of birds",
  "seed": 8,
  "target": {"kind": "hero", "aspect": "21:9", "reducedMotion": "slow", "posterTime": 0},
  "camera": {
    "type": "perspective",
    "fov": 40,
    "position": [0, 16, 68],
    "target": [0, 7, -30],
    "controls": "parallax",
    "parallax": {"strength": 1, "smoothing": 0.95}
  },
  "environment": {
    "background": {
      "sky": {"preset": "golden-hour", "sun": {"elevation": 6, "azimuth": 125}, "clouds": 0.2}
    },
    "fog": {"density": 0.007, "height": 5, "falloff": 0.35}
  },
  "lights": [],
  "objects": [
    {
      "id": "valley",
      "kind": "generator",
      "generator": "terrain",
      "seed": 14,
      "receiveShadow": true,
      "params": {
        "size": 130,
        "resolution": 88,
        "height": 30,
        "scale": 1.3,
        "shape": "valley",
        "lowpoly": true,
        "palette": ["#c9b48a", "#6b8f45", "#3f6b37", "#7a6c70", "#fbf6f1"],
        "waterLevel": 2.6,
        "waterPlane": false,
        "snowHeight": 17
      }
    },
    {
      "id": "lake",
      "kind": "generator",
      "generator": "water",
      "position": [0, 2.6, 0],
      "params": {
        "size": 130,
        "color": "#2a4a6e",
        "shallowColor": "#9fc0d4",
        "foamColor": "#fff1e0",
        "waveHeight": 0.03,
        "waveSpeed": 0.6,
        "ripples": 0.8,
        "reflections": true
      }
    },
    {
      "id": "pines",
      "kind": "generator",
      "generator": "trees",
      "seed": 3,
      "castShadow": true,
      "params": {
        "count": 180,
        "area": [120, 0, 120],
        "style": "pine",
        "minScale": 0.7,
        "maxScale": 1.35,
        "leafColors": ["#26492c", "#2f5a33", "#3c6b3a"],
        "onTerrain": true,
        "sway": true
      }
    },
    {
      "id": "flock",
      "kind": "generator",
      "generator": "birds",
      "position": [0, 20, -10],
      "params": {
        "count": 9,
        "mode": "drift",
        "formation": "v",
        "area": [90, 2, 0],
        "heading": 10,
        "speed": 5,
        "size": 1.2
      }
    }
  ],
  "timeline": {
    "duration": 14,
    "loop": true,
    "tracks": [
      {
        "target": "camera.position",
        "keys": [[0, [-3, 16, 68]], [7, [3, 17, 66]], [14, [-3, 16, 68]]],
        "ease": "inOutSine"
      }
    ]
  },
  "postfx": [
    {"type": "bloom", "strength": 0.25, "threshold": 0.9, "radius": 0.5},
    {"type": "grading", "look": "warm", "intensity": 0.2, "saturation": 1.12, "contrast": 1.06},
    {"type": "vignette", "darkness": 0.35},
    {"type": "fxaa"}
  ]
}
```

- The `golden-hour` sky preset adds its own sun light (no `lights` needed) and lights the scene through `lighting: "sky"`. `sun.azimuth` is measured around Y from +Z: 0 = behind a camera on +Z (front light), 90 = from +X (the right), 180 = straight ahead in the frame (back light), 270 = from the left. A 21:9 frame at fov 40 shows about 180 ± 45: keep a low sun just outside it (here 125, light from the right) or above it; a low sun in frame with fog or bloom washes the image out.
- `shape: "valley"` gives a flat floor along z between mountain walls, closed by a range at the far end (a camera on +z looks down it); `basin` rings a central lake with mountains. `edgeFalloff` (default per shape) sinks the borders so no cut wall shows at the edge.
- The lake: `waterPlane: false` drops the terrain's own plane while `waterLevel` still shapes the shore and keeps trees out of it; the `water` object sits at `y = waterLevel`. `"reflections": true` makes it a mirror (keep `waveHeight` / `ripples` low); it renders the scene a second time each frame (half resolution on the `medium` tier, off on `low`), so the forest is 180 pines and the terrain 88 cells to stay at ~140 k triangles per frame, under the hero aim.
- `snowHeight` caps everything above an absolute altitude with the last palette colour; trees stay below it. Terrain, water and scatter generators (`trees`, `rocks`, `grass`, `flowers` with `onTerrain`) share one `position`: keep them at the origin and move the camera instead.
- `birds` is one instanced draw call: `drift` with `formation: "v"` crosses the sky along `heading` (keep `area` x wider than the view); `orbit` circles, `path` follows `points`. Dark birds read against a bright sky. (Particle presets such as `fireflies` are glowing dots, not birds.)
- Height fog (`height`, `falloff`) fills the valley while peaks stay crisp; density 0.005–0.02 for a hero, more reads as smog. No `look` here: `cinematic` adds an AO pre-pass (one more geometry pass per frame plus a costly GPU pass) that a wide view from afar barely shows; bloom + grading + vignette cost no geometry pass.
- Knobs: `sun.elevation` (3–12 for golden hour), terrain `seed` / `height` / `palette`, tree `count`, the flock `heading` and `count`.

## Neon title (16:9): rect panel lights, volumetric spot, bloom

Two glowing light strips framing a neon headline on a glossy floor, a haze beam from above.

```json
{
  "version": 1,
  "id": "neon-club",
  "title": "Night Shift neon",
  "ariaLabel": "The words NIGHT SHIFT in glowing neon between two light strips on a wet reflective floor",
  "target": {"kind": "hero", "aspect": "16:9", "reducedMotion": "static", "posterTime": 2},
  "camera": {
    "type": "perspective",
    "fov": 35,
    "position": [0, 1.2, 10],
    "target": [0, 1, 0],
    "controls": "parallax",
    "parallax": {"strength": 0.35, "smoothing": 0.92}
  },
  "environment": {
    "background": "#05040d",
    "lighting": "night",
    "lightingIntensity": 0.4,
    "fog": {"color": "#0b0820", "density": 0.04},
    "ground": {"y": 0, "size": 40, "color": "#0a0912", "roughness": 0.25}
  },
  "lights": [
    {
      "id": "stripL",
      "type": "rect",
      "position": [-4.6, 1.7, -0.5],
      "width": 0.12,
      "height": 3.2,
      "color": "#ff2fd6",
      "intensity": 18,
      "panel": true,
      "target": [0, 1.6, 4]
    },
    {
      "id": "stripR",
      "type": "rect",
      "position": [4.6, 1.7, -0.5],
      "width": 0.12,
      "height": 3.2,
      "color": "#3ee8ff",
      "intensity": 18,
      "panel": true,
      "target": [0, 1.6, 4]
    },
    {
      "id": "beam",
      "type": "spot",
      "position": [0, 6, -1.5],
      "target": [0, 0, 0],
      "angle": 22,
      "penumbra": 0.7,
      "color": "#b9a8ff",
      "intensity": 60,
      "volumetric": {"intensity": 0.8}
    }
  ],
  "objects": [
    {
      "id": "title",
      "kind": "text",
      "text": "NIGHT SHIFT",
      "font": "bebas-neue",
      "size": 1.1,
      "depth": 0.12,
      "letterSpacing": 0.08,
      "position": [0, 1.35, 0],
      "material": {"preset": "neon", "color": "#ff4fdc", "emissive": "#ff2fd6", "emissiveIntensity": 2.6},
      "behaviours": [{"type": "flicker", "amount": 0.12, "speed": 0.6}]
    },
    {
      "id": "tagline",
      "kind": "text",
      "text": "OPEN TILL DAWN",
      "font": "space-grotesk-bold",
      "size": 0.26,
      "depth": 0,
      "letterSpacing": 0.25,
      "position": [0, 0.35, 0.2],
      "material": {"preset": "neon", "color": "#9ff3ff", "emissive": "#3ee8ff", "emissiveIntensity": 1.6}
    },
    {
      "id": "haze",
      "kind": "particles",
      "preset": "dust",
      "count": 120,
      "area": [10, 4, 4],
      "position": [0, 2, 0],
      "size": 0.03,
      "color": "#c9b8ff",
      "opacity": 0.4
    }
  ],
  "postfx": [{"type": "look", "preset": "neon", "intensity": 0.7}]
}
```

- `rect` lights with `"panel": true` are both the light and the visible strip; aim them with `target` (they face their target, so a target at the origin tilts them).
- The `neon` look is strong: emissive text above ~3 blows out into a pink fog, below ~1.5 has no halo. 2–2.6 with `intensity` 0.7 is the sweet spot; re-render after every change.
- A dark glossy `ground` (roughness 0.2–0.3) doubles every light as a reflection; exponential fog makes the volumetric cone read.
- Knobs: strip colours, `flicker` amount (keep it subtle), `beam.volumetric.intensity`.

## Mesh gradient banner (4:1)

A soft drifting gradient with glossy shapes on the sides and an outlined headline.

```json
{
  "version": 1,
  "id": "gradient-banner",
  "title": "Mesh gradient banner",
  "ariaLabel": "Soft drifting colour gradient with glossy floating shapes around the words Spring drop",
  "target": {"kind": "banner", "aspect": "4:1", "reducedMotion": "static"},
  "camera": {
    "type": "perspective",
    "fov": 30,
    "position": [0, 0, 12],
    "target": [0, 0, 0],
    "controls": "parallax",
    "parallax": {"strength": 0.3, "smoothing": 0.92}
  },
  "environment": {
    "background": {
      "meshGradient": ["#ff9a8b", "#ff6a88", "#a18cd1", "#fbc2eb", "#8fd3f4"],
      "speed": 0.12,
      "scale": 1.1,
      "seed": 4,
      "grain": 0.04
    },
    "lighting": "studio",
    "lightingIntensity": 0.6
  },
  "lights": [
    {"id": "key", "type": "directional", "position": [3, 5, 6], "intensity": 1.2},
    {"id": "rim", "type": "directional", "position": [-4, 2, -4], "color": "#ffd6f0", "intensity": 1.2}
  ],
  "objects": [
    {
      "id": "title",
      "kind": "text",
      "text": "Spring drop",
      "font": "montserrat-extrabold",
      "size": 1.25,
      "depth": 0.25,
      "letterSpacing": -0.02,
      "material": {"type": "physical", "color": "#fff4fa", "roughness": 0.35, "clearcoat": 0.6},
      "behaviours": [{"type": "float", "amplitude": 0.05, "speed": 0.3}],
      "outline": {"width": 0.07, "color": "#4a1a6e", "depth": 0.12}
    },
    {
      "id": "ring",
      "kind": "mesh",
      "geometry": {"type": "torus", "radius": 1, "tube": 0.36, "tubularSegments": 96},
      "material": {"preset": "chromeGradient", "gradient": ["#7f5cff", "#ff5ca8", "#ffd36e"]},
      "position": [-8.8, 0.3, -0.5],
      "rotation": [55, 25, 0],
      "behaviours": [
        {"type": "float", "amplitude": 0.18, "speed": 0.25},
        {"type": "rotate", "axis": [0.3, 1, 0.2], "speed": 14}
      ]
    },
    {
      "id": "pearl",
      "kind": "mesh",
      "geometry": {"type": "sphere", "radius": 1.05, "segments": 64, "heightSegments": 32},
      "material": {"preset": "pearl", "color": "#ffd9ef"},
      "position": [8.8, -0.2, -0.5],
      "behaviours": [{"type": "float", "amplitude": 0.2, "speed": 0.25, "phase": 0.5}]
    },
    {
      "id": "halo",
      "kind": "mesh",
      "geometry": {"type": "torus", "radius": 0.35, "tube": 0.1, "tubularSegments": 64},
      "material": {"preset": "mattePastel", "color": "#fff3c4"},
      "position": [6.6, 1.7, -1.5],
      "rotation": [70, 0, 20],
      "behaviours": [
        {"type": "float", "amplitude": 0.15, "speed": 0.3, "phase": 0.2},
        {"type": "rotate", "axis": [0, 1, 0], "speed": 10}
      ]
    },
    {
      "id": "dot",
      "kind": "mesh",
      "geometry": {"type": "sphere", "radius": 0.32},
      "material": {"preset": "chromeGradient", "gradient": ["#8fd3f4", "#a18cd1"]},
      "position": [-6.4, -1.7, -1],
      "behaviours": [{"type": "float", "amplitude": 0.15, "speed": 0.35, "phase": 0.7}]
    }
  ],
  "postfx": [{"type": "look", "preset": "clean"}]
}
```

- `meshGradient` gives the Stripe-like background for zero bytes; `grain` hides banding.
- Light text on a light gradient needs an `outline` (or a dark text colour) to read; avoid bloom here: white text glows into the background.
- Props at abs(x) 7.6–8.8 stay outside the title (visible width ≈ 25.8 at z 0 with this camera).
- Transmission presets (`soapBubble`, `glass`, `jelly`, `diamond`) render the scene a second time behind them: a soap bubble here doubled the triangles per frame for a sphere that reads the same, so it is `pearl`.
- Knobs: the 5 gradient colours, `speed` (0 = still), `chromeGradient` ramps, `pearl` / `mattePastel` presets.

## Letter-reveal headline (16:9)

The title rises in letter by letter, a wave runs through it, then the last word turns gold.

```json
{
  "version": 1,
  "id": "launch-reveal",
  "title": "Launch day headline",
  "ariaLabel": "The headline LAUNCH DAY rises in letter by letter, then a wave runs through it and DAY turns gold",
  "target": {"kind": "hero", "aspect": "16:9", "reducedMotion": "static", "posterTime": 3.2},
  "camera": {
    "type": "perspective",
    "fov": 35,
    "position": [0, 0.3, 10],
    "target": [0, 0.2, 0],
    "controls": "parallax",
    "parallax": {"strength": 0.3, "smoothing": 0.92}
  },
  "environment": {
    "background": {"radial": ["#2a2470", "#0b0a24"], "center": [0.5, 0.55], "radius": 0.9, "grain": 0.03},
    "rig": {"preset": "studio-3point", "intensity": 1},
    "lighting": "studio",
    "lightingIntensity": 0.5
  },
  "lights": [],
  "objects": [
    {
      "id": "title",
      "kind": "text",
      "text": "LAUNCH DAY",
      "font": "inter-black",
      "size": 0.85,
      "depth": 0.3,
      "letterSpacing": 0.02,
      "position": [0, 0.25, 0],
      "outline": {"width": 0.05, "color": "#120d2b"},
      "material": {"type": "physical", "color": "#f4f1ff", "roughness": 0.3, "clearcoat": 1},
      "reveal": {"effect": "rise", "stagger": 0.06, "duration": 0.8, "delay": 0.2, "order": "forward"}
    },
    {
      "id": "sub",
      "kind": "text",
      "text": "March 14 - live at 9:00",
      "font": "sans",
      "size": 0.22,
      "depth": 0,
      "position": [0, -0.75, 0],
      "material": {"type": "basic", "color": "#b9b3ff"},
      "behaviours": [{"type": "appear", "effect": "fade", "duration": 0.8, "delay": 1.3}]
    },
    {
      "id": "sparks",
      "kind": "particles",
      "preset": "stars",
      "count": 120,
      "area": [16, 9, 4],
      "position": [0, 0, -3],
      "size": 0.04,
      "color": "#cfd6ff"
    }
  ],
  "timeline": {
    "duration": 4,
    "loop": false,
    "tracks": [
      {
        "target": "children:title.position.y",
        "keys": [[1.8, "+=0"], [2.05, "+=0.3", "outCubic"], [2.5, "+=0", "outBounce"]],
        "stagger": 0.05
      },
      {
        "target": "title/6,title/7,title/8.material.color",
        "keys": [[2.4, "#f4f1ff"], [2.9, "#ffb02e", "outCubic"]],
        "stagger": 0.1
      }
    ]
  },
  "postfx": [{"type": "look", "preset": "cinematic", "intensity": 0.6}]
}
```

- `reveal` (implies `splitLetters`) makes each glyph an object `title/<n>` (non-space characters, from 0); a timeline can then target `children:title` (all letters) or a list like `title/6,title/7,title/8` with `stagger`.
- Relative keys (`"+=0.3"`) move letters from where the reveal left them; `outBounce` on the settle key gives the wave its snap.
- Colour keys blend in OKLCh by default (track `colorSpace`: `oklch`, `oklab`, `rgb`, `hsl`): white → amber stays clean and saturated instead of passing through a muddy mix.
- Pick a `posterTime` after the last animation (here 3.2) so the poster and reduced-motion still show the final state.
- Knobs: `reveal.effect` (rise, fade, scale, spin, drop), `order` (`center`, `random`), the accent colour and which letters get it.

## Scroll story (16:9): camera shots driven by scroll

A marble bust on a plinth; scrolling the page orbits the camera, pushes in on the face and cranes up, with a caption that rides with the camera and a HUD pill per chapter.

```json
{
  "version": 1,
  "id": "museum-scroll",
  "title": "Marble bust scroll story",
  "ariaLabel": "A classical marble bust on a plinth; scrolling the page orbits the camera around it, pushes in on the face and cranes up",
  "target": {"kind": "hero", "aspect": "16:9", "reducedMotion": "static", "posterTime": 0},
  "camera": {
    "type": "perspective",
    "fov": 32,
    "position": [1.8, 1.75, 4.6],
    "target": [0, 1.45, 0],
    "shots": [
      {"type": "orbit", "at": 0, "duration": 3, "angle": -50, "elevation": 4},
      {"type": "pushIn", "at": 3, "duration": 3, "distance": 1.5},
      {"type": "crane", "at": 6.5, "duration": 3.5, "height": 0.9, "distance": -1.2}
    ]
  },
  "environment": {
    "background": {
      "radial": ["#3a3430", "#121012"],
      "center": [0.5, 0.6],
      "radius": 0.85,
      "grain": 0.03
    },
    "lighting": "studio",
    "lightingIntensity": 0.35,
    "rig": {"preset": "dramatic", "intensity": 1.3},
    "contactShadows": {"opacity": 0.75, "blur": 2.5, "y": 0}
  },
  "lights": [],
  "objects": [
    {
      "id": "plinth",
      "kind": "mesh",
      "geometry": {"type": "box", "width": 1, "height": 1, "depth": 1},
      "position": [0, 0.5, 0],
      "material": {"preset": "marble", "color": "#3a3632"},
      "receiveShadow": true
    },
    {
      "id": "bust",
      "kind": "model",
      "src": "library:models/props/marble-bust.glb",
      "fit": 1.25,
      "position": [0, 1, 0],
      "castShadow": true
    },
    {
      "id": "dust",
      "kind": "particles",
      "preset": "dust",
      "count": 60,
      "area": [5, 3, 3],
      "position": [0, 1.8, 0],
      "size": 0.02,
      "color": "#ffe8cc",
      "opacity": 0.35
    },
    {
      "id": "caption",
      "kind": "text",
      "attach": "camera",
      "text": "THE COLLECTION",
      "font": "sans",
      "size": 0.05,
      "depth": 0,
      "align": "left",
      "letterSpacing": 0.015,
      "position": [-0.75, -0.39, -2],
      "material": {"type": "basic", "color": "#e8dccb"}
    }
  ],
  "timeline": {
    "duration": 10,
    "trigger": "scroll",
    "loop": false,
    "scroll": {"start": "top top", "end": "bottom top", "smoothing": 0.85},
    "tracks": [],
    "segments": {"overview": [0, 3], "portrait": [3, 6.5], "details": [6.5, 10]}
  },
  "postfx": [{"type": "look", "preset": "cinematic", "intensity": 0.8}],
  "ui": {
    "color": "#f4ede4",
    "accent": "#c9a46a",
    "elements": [
      {
        "id": "ch1",
        "type": "text",
        "style": "pill",
        "anchor": "top-left",
        "text": "01 · The piece",
        "visible": "timeline.segment == 'overview'"
      },
      {
        "id": "ch2",
        "type": "text",
        "style": "pill",
        "anchor": "top-left",
        "text": "02 · The face",
        "visible": "timeline.segment == 'portrait'"
      },
      {
        "id": "ch3",
        "type": "text",
        "style": "pill",
        "anchor": "top-left",
        "text": "03 · The marble",
        "visible": "timeline.segment == 'details'",
        "background": "#c9a46a",
        "color": "#1a1410"
      }
    ]
  }
}
```

- With `trigger: "scroll"`, the timeline time is the scroll progress, and `camera.shots` run on that clock (no tracks needed). Shots chain: each starts from the pose the previous one left.
- In renders, the progress is `t / duration`: `render --count 4` shows the story at 0, 33, 67 and 100 % of the scroll.
- `"attach": "camera"` keeps the caption on screen while the shots move the camera: its `position` is in camera space (x right, y up, -z forward; `[-0.75, -0.39, -2]` = 2 units in front of the lens, lower left). Keep it closer to the lens than the subject, or the subject hides it during a push-in. `letterSpacing` is in scene units: scale it with `size`.
- HUD expressions read the timeline: `timeline.segment` (the chapter being scrolled through), `timeline.progress` (0..1), `timeline.time`, `timeline.marker`, so the pills need no script. Per-element `background` / `color` highlight one pill.
- `contactShadows.y` pins the shadow plane: without it the plane fits all objects, particles included, and may float below the subject.
- Knobs: shot `angle` / `distance` / `height`, `scroll.start` / `end` (ScrollTrigger-like), `smoothing`.

## Click-to-shop shelf (16:9): hover + openUrl interactions

Three pastries on stands; hovering one grows it, clicking opens its product page.

```json
{
  "version": 1,
  "id": "bakery-shelf",
  "title": "Bakery shelf",
  "ariaLabel": "Three pastries on pastel stands: a cupcake, a donut and a croissant with their prices; click one to open its shop page",
  "target": {"kind": "hero", "aspect": "16:9", "reducedMotion": "static", "posterTime": 1},
  "camera": {
    "type": "perspective",
    "fov": 30,
    "position": [0, 2.5, 9.2],
    "target": [0, 0.85, 0],
    "controls": "parallax",
    "parallax": {"strength": 0.25, "smoothing": 0.92}
  },
  "environment": {
    "background": {"gradient": ["#ffe9ef", "#fff6ea"], "angle": 0, "grain": 0.02},
    "lighting": "soft",
    "lightingIntensity": 0.8,
    "rig": {"preset": "softbox", "intensity": 0.9, "rotation": -15},
    "contactShadows": {"opacity": 0.45, "blur": 2.5, "color": "#7a3a4c", "y": 0}
  },
  "lights": [],
  "objects": [
    {
      "id": "headline",
      "kind": "text",
      "text": "Fresh this morning",
      "font": "serif-bold",
      "size": 0.5,
      "depth": 0.08,
      "position": [0, 2.35, -0.6],
      "material": {"type": "standard", "color": "#7a2944", "roughness": 0.5}
    },
    {
      "id": "cupcakeStand",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.9, "radiusBottom": 0.9, "height": 0.25, "segments": 64},
      "position": [-2.6, 0.125, 0],
      "material": {"preset": "clay", "color": "#f59ab5"}
    },
    {
      "id": "cupcake",
      "kind": "model",
      "src": "library:models/food/cupcake.glb",
      "fit": 1.3,
      "position": [-2.6, 0.25, 0],
      "castShadow": true,
      "behaviours": [{"type": "float", "amplitude": 0.04, "speed": 0.4, "phase": -2.6}]
    },
    {
      "id": "cupcakeLabel",
      "kind": "text",
      "text": "Cupcake  $4",
      "font": "display",
      "size": 0.18,
      "depth": 0,
      "position": [-2.6, -0.25, 0.9],
      "material": {"type": "basic", "color": "#5a2a3c"}
    },
    {
      "id": "donutStand",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.9, "radiusBottom": 0.9, "height": 0.25, "segments": 64},
      "position": [0, 0.125, 0],
      "material": {"preset": "clay", "color": "#ffc46b"}
    },
    {
      "id": "donut",
      "kind": "model",
      "src": "library:models/food/donut.glb",
      "fit": 1.3,
      "position": [0, 0.25, 0],
      "castShadow": true,
      "behaviours": [{"type": "float", "amplitude": 0.04, "speed": 0.4, "phase": 0}]
    },
    {
      "id": "donutLabel",
      "kind": "text",
      "text": "Donut  $3",
      "font": "display",
      "size": 0.18,
      "depth": 0,
      "position": [0, -0.25, 0.9],
      "material": {"type": "basic", "color": "#5a2a3c"}
    },
    {
      "id": "croissantStand",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.9, "radiusBottom": 0.9, "height": 0.25, "segments": 64},
      "position": [2.6, 0.125, 0],
      "material": {"preset": "clay", "color": "#8cc8f5"}
    },
    {
      "id": "croissant",
      "kind": "model",
      "src": "library:models/food/croissant.glb",
      "fit": 1.3,
      "position": [2.6, 0.25, 0],
      "castShadow": true,
      "behaviours": [{"type": "float", "amplitude": 0.04, "speed": 0.4, "phase": 2.6}],
      "rotation": [0, -60, 0]
    },
    {
      "id": "croissantLabel",
      "kind": "text",
      "text": "Croissant  $3",
      "font": "display",
      "size": 0.18,
      "depth": 0,
      "position": [2.6, -0.25, 0.9],
      "material": {"type": "basic", "color": "#5a2a3c"}
    }
  ],
  "interactions": [
    {
      "on": "hover",
      "target": "cupcake",
      "do": [{"set": {"path": "cupcake.scale", "value": 1.15}, "duration": 0.3, "ease": "outBack"}]
    },
    {
      "on": "hoverEnd",
      "target": "cupcake",
      "do": [{"set": {"path": "cupcake.scale", "value": 1}, "duration": 0.3, "ease": "outCubic"}]
    },
    {
      "on": "click",
      "target": "cupcake",
      "do": [
        {"openUrl": "https://shop.example.com/shop/cupcake"},
        {"emit": "product-click", "payload": {"id": "cupcake"}}
      ]
    },
    {
      "on": "hover",
      "target": "donut",
      "do": [{"set": {"path": "donut.scale", "value": 1.15}, "duration": 0.3, "ease": "outBack"}]
    },
    {
      "on": "hoverEnd",
      "target": "donut",
      "do": [{"set": {"path": "donut.scale", "value": 1}, "duration": 0.3, "ease": "outCubic"}]
    },
    {
      "on": "click",
      "target": "donut",
      "do": [
        {"openUrl": "https://shop.example.com/shop/donut"},
        {"emit": "product-click", "payload": {"id": "donut"}}
      ]
    },
    {
      "on": "hover",
      "target": "croissant",
      "do": [{"set": {"path": "croissant.scale", "value": 1.15}, "duration": 0.3, "ease": "outBack"}]
    },
    {
      "on": "hoverEnd",
      "target": "croissant",
      "do": [{"set": {"path": "croissant.scale", "value": 1}, "duration": 0.3, "ease": "outCubic"}]
    },
    {
      "on": "click",
      "target": "croissant",
      "do": [
        {"openUrl": "https://shop.example.com/shop/croissant"},
        {"emit": "product-click", "payload": {"id": "croissant"}}
      ]
    }
  ],
  "postfx": [{"type": "look", "preset": "clean"}]
}
```

- `interactions` need no script: `hover` / `hoverEnd` tween `scale` with `set`, `click` runs `openUrl` (http(s) or page-relative, user gesture only; renders emit an `openUrl` event instead of navigating) and `emit`s an event the page can track.
- Check hover in a render: `render --frames 1.2 --input '[{"t": 0.5, "pointer": [0, 0.05]}]'` (coordinates -1..1, y up) shows the hovered state.
- Labels are flat text (`depth: 0`) with `basic` material: always readable, cheap.
- Knobs: `value` of the hover scale (1.1–1.2), ease `outBack` for a playful pop, the URLs.

## Physics toss game (16:9)

Click or tap to throw a ball and knock the can pyramid off the table; an autopilot plays until the first click so the poster shows action. Save the script below as `scripts/game.js`.

```json
{
  "version": 1,
  "id": "can-toss",
  "title": "Can Toss",
  "ariaLabel": "Can Toss, a physics mini game: click or tap to throw a ball and knock the stacked cans off the table",
  "target": {"kind": "game", "aspect": "16:9", "reducedMotion": "ignore", "posterTime": 1.5, "quality": "medium"},
  "camera": {"type": "perspective", "fov": 42, "position": [0, 3, 8.5], "target": [0, 1.8, 0]},
  "environment": {
    "background": {"gradient": ["#2a2550", "#5a4fa8"], "angle": 0},
    "lighting": "studio",
    "lightingIntensity": 0.6,
    "rig": {"preset": "studio-3point", "intensity": 1.1},
    "shadows": {"type": "pcf", "softness": 3},
    "fog": {"color": "#2a2550", "near": 12, "far": 26}
  },
  "lights": [],
  "objects": [
    {
      "id": "table",
      "kind": "mesh",
      "geometry": {"type": "roundedBox", "width": 5, "height": 1, "depth": 2.4, "radius": 0.08},
      "position": [0, 0.5, 0],
      "material": {"preset": "plastic", "color": "#f6d7b0", "roughness": 0.5},
      "receiveShadow": true,
      "body": {"type": "static"}
    },
    {
      "id": "floor",
      "kind": "mesh",
      "geometry": {"type": "box", "width": 40, "height": 0.2, "depth": 40},
      "position": [0, -0.1, 0],
      "material": {"preset": "matte", "color": "#3a3470"},
      "receiveShadow": true,
      "body": {"type": "static"}
    },
    {
      "id": "can0",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.8, "segments": 32},
      "position": [-0.7, 1.4, 0],
      "material": {"preset": "carPaint", "color": "#ef476f"},
      "castShadow": true,
      "tags": ["can"],
      "body": {"type": "dynamic", "shape": "cylinder", "mass": 0.4, "friction": 0.4, "restitution": 0.1}
    },
    {
      "id": "can1",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.8, "segments": 32},
      "position": [0, 1.4, 0],
      "material": {"preset": "carPaint", "color": "#ef476f"},
      "castShadow": true,
      "tags": ["can"],
      "body": {"type": "dynamic", "shape": "cylinder", "mass": 0.4, "friction": 0.4, "restitution": 0.1}
    },
    {
      "id": "can2",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.8, "segments": 32},
      "position": [0.7, 1.4, 0],
      "material": {"preset": "carPaint", "color": "#ef476f"},
      "castShadow": true,
      "tags": ["can"],
      "body": {"type": "dynamic", "shape": "cylinder", "mass": 0.4, "friction": 0.4, "restitution": 0.1}
    },
    {
      "id": "can3",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.8, "segments": 32},
      "position": [-0.35, 2.2, 0],
      "material": {"preset": "carPaint", "color": "#ffd166"},
      "castShadow": true,
      "tags": ["can"],
      "body": {"type": "dynamic", "shape": "cylinder", "mass": 0.4, "friction": 0.4, "restitution": 0.1}
    },
    {
      "id": "can4",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.8, "segments": 32},
      "position": [0.35, 2.2, 0],
      "material": {"preset": "carPaint", "color": "#ffd166"},
      "castShadow": true,
      "tags": ["can"],
      "body": {"type": "dynamic", "shape": "cylinder", "mass": 0.4, "friction": 0.4, "restitution": 0.1}
    },
    {
      "id": "can5",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.3, "radiusBottom": 0.3, "height": 0.8, "segments": 32},
      "position": [0, 3, 0],
      "material": {"preset": "carPaint", "color": "#06d6a0"},
      "castShadow": true,
      "tags": ["can"],
      "body": {"type": "dynamic", "shape": "cylinder", "mass": 0.4, "friction": 0.4, "restitution": 0.1}
    },
    {
      "id": "ballProto",
      "kind": "mesh",
      "geometry": {"type": "sphere", "radius": 0.26},
      "position": [0, -5, 8],
      "visible": false,
      "material": {"preset": "rubber", "color": "#ff7b54"},
      "castShadow": true,
      "body": {"type": "dynamic", "shape": "sphere", "mass": 1.2, "restitution": 0.4, "ccd": true, "sleep": false}
    }
  ],
  "scripts": ["scripts/game.js"],
  "physics": {"gravity": [0, -9.81, 0], "substeps": 2, "iterations": 12},
  "ui": {
    "elements": [
      {"id": "score", "type": "text", "text": "Down {down}/{total}", "anchor": "top-left", "style": "pill"},
      {"id": "throws", "type": "text", "text": "Throws {throws}", "anchor": "top-right", "style": "pill"},
      {
        "id": "hint",
        "type": "text",
        "text": "Click or tap to throw",
        "anchor": "bottom",
        "style": "subtitle",
        "visible": "phase == 'attract'"
      }
    ],
    "color": "#ffffff",
    "accent": "#ef476f"
  },
  "audio": {
    "sounds": {
      "throw": {"preset": "whoosh", "volume": 0.4},
      "hit": {"preset": "hit", "volume": 0.5},
      "win": {"preset": "win"}
    }
  },
  "data": {"launch": [0, 1.6, 8], "flight": 0.6},
  "seed": 11
}
```

```js
// Can Toss: click / tap to throw a ball at the point under the pointer and knock
// every can off the table. Attract mode (no input yet): an autopilot throws, so
// renders and the poster show action. phase: "attract" -> "play" -> "cleared".
export default function (api) {
  const { launch, flight } = api.data;
  const cans = api.findByTag("can").map((o) => ({ o, p: [o.position.x, o.position.y, o.position.z] }));
  let balls = [];
  let n = 0;
  let phase = "attract";
  let throws = 0;
  let nextAuto = 0.6;
  let lastHit = -1;

  const isDown = (c) => c.o.position.y < 1.2; // fell off the table top
  function publish() {
    api.state.phase = phase;
    api.state.down = cans.filter(isDown).length;
    api.state.total = cans.length;
    api.state.throws = throws;
  }

  function reset() {
    for (const c of cans) {
      c.o.position.set(c.p[0], c.p[1], c.p[2]);
      c.o.rotation.set(0, 0, 0);
      api.physics.setVelocity(c.o, [0, 0, 0]);
      api.physics.setAngularVelocity(c.o, [0, 0, 0]);
    }
    for (const b of balls) b.remove();
    balls = [];
    throws = 0;
  }

  // Ballistic throw from `launch` that reaches `target` after `flight` seconds.
  function throwAt(target) {
    const ball = api.clone("ballProto", { id: "ball" + n++, position: launch });
    ball.visible = true;
    const T = flight;
    api.physics.setVelocity(ball, [(target[0] - launch[0]) / T, (target[1] - launch[1]) / T + 4.905 * T, (target[2] - launch[2]) / T]);
    balls.push(ball);
    if (balls.length > 6) balls.shift().remove();
    throws++;
    if (phase !== "attract") api.audio.play("throw");
  }

  function aim() {
    const hit = api.input.pointerWorld();
    if (hit && hit.objectId && hit.objectId !== "floor") return [hit.x, hit.y, hit.z];
    return [api.input.pointer.x * 4, 2.2 + api.input.pointer.y * 2, 0];
  }

  return {
    start() {
      api.physics.onCollision((a, b, info) => {
        if (phase === "attract" || info.impulse < 1 || api.time() - lastHit < 0.08) return;
        lastHit = api.time();
        api.audio.play("hit");
      });
      publish();
    },
    update() {
      const t = api.time();
      const pressed = api.input.pointer.justPressed || api.input.pressed("Space");
      if (phase === "attract") {
        if (pressed) {
          phase = "play";
          reset();
          throwAt(aim());
        } else if (t >= nextAuto) {
          const standing = cans.filter((c) => !isDown(c));
          if (!standing.length || throws >= 5) {
            reset();
            nextAuto = t + 1;
          } else {
            const c = standing[Math.floor(api.random() * standing.length)];
            throwAt([c.o.position.x, c.o.position.y, c.o.position.z]);
            nextAuto = t + 1.4;
          }
        }
      } else if (phase === "play") {
        if (pressed) throwAt(aim());
        if (cans.every(isDown)) {
          phase = "cleared";
          api.audio.play("win");
          api.ui.toast("Cleared in " + throws + " throws!", 2.5);
        }
      } else if (pressed) {
        reset();
        phase = "play";
      }
      publish();
    },
  };
}
```

- Cans are `dynamic` rigid bodies (they topple and roll); the table and floor are `static`. The floor is a thin **box**, not a rotated plane: a `body` box is measured in the object's rotated frame, so a plane rotated -90° with a custom `size` becomes a wall.
- Throws set a ballistic velocity once (`api.physics.setVelocity`); `ccd: true` on the ball prevents tunnelling. Clones of a hidden prototype are the cheap way to spawn.
- `target.quality: "medium"` and no postfx keep it light (`check` warns about heavy effects in games).
- Test a real throw: `render --frames 2 --input '[{"t": 0.5, "click": [0, 0.1]}]'` returns `state` (`phase: "play"`, `down`, `throws`).
- Scoring pitfalls: a can counts as down by its height (`position.y` below the table top), not by its rotation: `rotation` is Euler XYZ in degrees, so a can lying on its side can read x = 90 or z = 90 and a toppled-then-turned one other combinations. Restacking (`reset`) zeroes velocities and removes the balls still in flight (they would knock the fresh stack over), and the autopilot waits before the next throw so the cans settle first.

## Lane runner game (16:9)

Three lanes, rows of blocks rushing at the runner, speed ramping up, score and best score, Play / Play again buttons, and an attract mode: until the visitor plays, an autopilot dodges behind the title, so renders and the poster show action. Save the script below as `scripts/game.js`.

```json
{
  "version": 1,
  "id": "lane-runner",
  "title": "Lane Runner",
  "ariaLabel": "Lane Runner, a mini game: change lanes with the arrow keys, A / D, a swipe or a tap on either side to dodge the blocks",
  "seed": 4,
  "target": {
    "kind": "game",
    "aspect": "16:9",
    "reducedMotion": "ignore",
    "posterTime": 4,
    "quality": "medium"
  },
  "camera": {"type": "perspective", "fov": 50, "position": [0, 3.4, 7], "target": [0, 0.9, -8]},
  "environment": {
    "background": {"gradient": ["#ffd9b0", "#ffd9b0", "#ffd9b0", "#9cc8ff", "#4f86d9"], "angle": 0},
    "lighting": "soft",
    "lightingIntensity": 0.7,
    "rig": {"preset": "golden-hour", "intensity": 1.1, "castShadow": true},
    "fog": {"color": "#ffd9b0", "near": 18, "far": 44}
  },
  "lights": [],
  "objects": [
    {
      "id": "road",
      "kind": "generator",
      "generator": "road",
      "params": {
        "width": 6,
        "length": 80,
        "lanes": 3,
        "color": "#3d405b",
        "lineColor": "#f4f1de",
        "speed": 12,
        "vergeColor": ["#8fd16a", "#7cc45a"]
      },
      "receiveShadow": true
    },
    {
      "id": "player",
      "kind": "generator",
      "generator": "character",
      "params": {
        "style": "humanoid",
        "shirt": "#ffd166",
        "pants": "#26547c",
        "hair": "#3b2a20",
        "animation": "run",
        "animationSpeed": 1.4,
        "height": 1.4
      },
      "rotation": [0, 180, 0],
      "castShadow": true
    },
    {
      "id": "block",
      "kind": "mesh",
      "geometry": {"type": "roundedBox", "width": 1.6, "height": 1.2, "depth": 0.8, "radius": 0.12},
      "material": {"preset": "plastic", "color": "#ef476f"},
      "position": [0, 0.6, -44],
      "visible": false,
      "castShadow": true,
      "tags": ["template"]
    }
  ],
  "scripts": ["scripts/game.js"],
  "data": {
    "lanes": [-2, 0, 2],
    "startSpeed": 12,
    "maxSpeed": 26,
    "accel": 0.4,
    "rowEvery": 14,
    "spawnZ": -44
  },
  "ui": {
    "color": "#ffffff",
    "accent": "#ffd166",
    "elements": [
      {
        "id": "score",
        "type": "text",
        "text": "Score {score}",
        "anchor": "top-left",
        "style": "pill"
      },
      {"id": "best", "type": "text", "text": "Best {best}", "anchor": "top-right", "style": "pill"},
      {
        "id": "title",
        "type": "text",
        "text": "Lane Runner",
        "anchor": "top",
        "style": "title",
        "visible": "phase == 'ready'"
      },
      {
        "id": "play",
        "type": "button",
        "text": "Play",
        "anchor": "bottom",
        "action": "start",
        "visible": "phase == 'ready'"
      },
      {
        "id": "over",
        "type": "text",
        "text": "Game over\nScore {score} · Best {best}",
        "anchor": "center",
        "style": "panel",
        "visible": "phase == 'over'"
      },
      {
        "id": "retry",
        "type": "button",
        "text": "Play again",
        "anchor": "bottom",
        "action": "retry",
        "visible": "phase == 'over'"
      }
    ]
  },
  "audio": {
    "sounds": {
      "move": {"preset": "whoosh", "volume": 0.3},
      "point": {"preset": "coin", "volume": 0.4},
      "lose": {"preset": "lose", "volume": 0.5}
    }
  }
}
```

```js
// Lane Runner: dodge the blocks by changing lanes (arrows / A D, swipes, or a tap
// on the left / right half). phase: "ready" (an autopilot plays behind the title,
// so renders and the poster show action) -> "play" -> "over".
export default function (api) {
  const { lanes, startSpeed, maxSpeed, accel, rowEvery, spawnZ } = api.data;
  const player = api.get("player");
  const road = api.get("road");
  let blocks = [];
  let n = 0;
  let lane = 1;
  let speed = startSpeed;
  let nextRow = 0;
  let distance = 0;
  let overAt = 0;

  function reset(phase) {
    for (const b of blocks) b.remove();
    blocks = [];
    lane = 1;
    speed = startSpeed;
    nextRow = 0; // the first row reaches the player after ~3.5 s
    distance = 0;
    player.position.x = lanes[1];
    api.state.phase = phase;
    api.state.score = 0;
    api.state.best = Number(api.storage.get("best") ?? 0);
  }

  // A row of 1-2 blocks at spawnZ (hidden in the fog); one lane always stays open.
  function spawnRow() {
    const open = Math.floor(api.random() * 3);
    for (let i = 0; i < 3; i++) {
      if (i === open || (i !== (open + 1) % 3 && api.random() < 0.5)) continue;
      const b = api.clone("block", { id: "block" + n++, position: [lanes[i], 0.6, spawnZ] });
      b.visible = true;
      blocks.push(b);
    }
  }

  // Distance to the nearest block ahead in a lane (Infinity when clear).
  function clearance(i) {
    let d = Infinity;
    for (const b of blocks) if (Math.abs(b.position.x - lanes[i]) < 0.5 && b.position.z < 0.8) d = Math.min(d, -b.position.z);
    return d;
  }

  function autopilot() {
    if (clearance(lane) > 12) return 0;
    const left = lane > 0 ? clearance(lane - 1) : -1;
    const right = lane < 2 ? clearance(lane + 1) : -1;
    return left >= right ? -1 : 1;
  }

  function readInput() {
    const swipe = api.input.swipe();
    const tap = api.input.pointer.justPressed ? Math.sign(api.input.pointer.x) : 0;
    if (api.input.pressed("ArrowLeft") || api.input.pressed("KeyA") || swipe === "left" || tap < 0) return -1;
    if (api.input.pressed("ArrowRight") || api.input.pressed("KeyD") || swipe === "right" || tap > 0) return 1;
    return 0;
  }

  function gameOver() {
    api.state.phase = "over";
    overAt = api.time();
    api.audio.play("lose");
    api.camera.shake(0.3, 0.4);
    const best = Math.max(Number(api.state.best), Number(api.state.score));
    api.state.best = best;
    api.storage.set("best", best);
  }

  return {
    start() {
      reset("ready");
    },
    onEvent(name) {
      if (name === "start" || name === "retry") reset("play");
    },
    update(dt) {
      const phase = api.state.phase;
      if (phase === "over") {
        if (api.time() - overAt > 0.6 && (api.input.pressed("Space") || api.input.pressed("Enter"))) reset("play");
        return;
      }
      if (phase === "ready" && (api.input.pressed("Space") || api.input.pressed("Enter") || api.input.pointer.justPressed)) return reset("play");

      // Difficulty ramp: faster over time, rows closer together in time.
      speed = Math.min(maxSpeed, speed + accel * dt);
      road.userData.speed = speed;
      distance += speed * dt;
      nextRow -= speed * dt;
      if (nextRow <= 0) {
        spawnRow();
        nextRow = rowEvery;
      }

      const move = phase === "play" ? readInput() : autopilot();
      if (move && lane + move >= 0 && lane + move <= 2) {
        lane += move;
        if (phase === "play") api.audio.play("move");
      }
      player.position.x += (lanes[lane] - player.position.x) * Math.min(1, dt * 14);

      for (const b of blocks.slice()) {
        b.position.z += speed * dt;
        if (b.position.z > 8) {
          b.remove();
          blocks.splice(blocks.indexOf(b), 1);
        } else if (phase === "play" && Math.abs(b.position.z) < 0.6 && Math.abs(b.position.x - player.position.x) < 1.1) {
          return gameOver();
        }
      }
      if (phase === "play") api.state.score = Math.floor(distance / 4);
    },
  };
}
```

- Spawning by cloning: `block` is a hidden template; `api.clone` copies it synchronously (deterministic), the script keeps its own array of live clones and `remove()`s them once they pass the camera. Rows spawn at `spawnZ`, inside the fog (`far` 44), so they fade in instead of popping.
- Collisions are lane + z checks: no physics body, no physics chunk to download. One lane per row always stays open.
- The `road` generator scrolls its own stripes; the script sets `road.userData.speed` so they match the ramping speed. Restyle it with `color`, `lineColor`, `curbColors` (one colour = a solid curb), `vergeColor`, or `verge: false` (road only).
- The game-over screen is a `panel` (a backdrop card; `\n` breaks lines, the first line is the heading). Buttons get an auto-contrast label from `ui.accent` (`ui.buttonText` overrides it); `color` / `background` on an element restyle it alone. Patch one element by id: `ui.elements#retry.text`.
- Tested: `render --sheet --frames 1,4,7,10` (attract mode dodging), then played headlessly: `render --frames 2,5,8 --input '[{"t": 0.5, "ui": "play"}, {"t": 2, "swipe": "left"}, {"t": 6, "ui": "retry"}]'` returns `state` (`phase`, `score`, `best`) — the swipe runs into a row (`phase: "over"`), `ui: "retry"` presses the HUD button and restarts. Posters and videos show the canvas only, without the HUD.
- Phones: the embed keeps 16:9, so a 390 px wide phone shows it 390 × 219 (`render --size 390x219`): the corner pills and the button cover a lot. For a mobile-first game use a portrait aspect (`"9:16"` or `"3:4"`) and widen the camera (here fov 75 from `[0, 4.2, 7.5]` keeps the three lanes in a 9:16 frame).
- Knobs: `data` (`startSpeed`, `maxSpeed`, `accel`, `rowEvery`), the runner's `params` (`catalog generators character`), block colour and shape, the sky gradient + fog colour (keep the fog the colour of the horizon).

## Character card (1:1): waving mascot

The built-in procedural character waving on a pedestal, eyes following the pointer, a small grow on hover.

```json
{
  "version": 1,
  "id": "mascot-card",
  "title": "Waving mascot",
  "ariaLabel": "A friendly 3D mascot waving hello",
  "target": {"kind": "card", "aspect": "1:1", "posterTime": 1},
  "camera": {"type": "perspective", "fov": 30, "position": [0, 1.5, 5.4], "target": [0, 1.05, 0]},
  "environment": {
    "background": {"radial": ["#fff0f4", "#ffc2d1"], "center": [0.5, 0.6], "radius": 0.9},
    "lighting": "soft",
    "rig": {"preset": "studio-3point", "intensity": 1, "color": "#fff1f4"},
    "contactShadows": {"opacity": 0.5, "blur": 2.5, "color": "#8a3a5c"}
  },
  "lights": [],
  "objects": [
    {
      "id": "pedestal",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 0.75, "radiusBottom": 0.82, "height": 0.3, "segments": 64},
      "material": {"preset": "mattePastel", "color": "#9b8cff"},
      "position": [0, 0.15, 0]
    },
    {
      "id": "mascot",
      "kind": "generator",
      "generator": "character",
      "position": [0, 0.3, 0],
      "params": {
        "style": "humanoid",
        "shirt": "#5fc9b5",
        "pants": "#3d2c4e",
        "hair": "#2b1d14",
        "accent": "#ffd166",
        "animation": "wave",
        "height": 1.8,
        "eyesFollowPointer": true
      },
      "behaviours": [{"type": "hoverScale", "scale": 1.06}],
      "castShadow": true
    }
  ],
  "postfx": [{"type": "look", "preset": "clean"}]
}
```

- `studio-3point` with a warm `color` tint + `contactShadows` replaces hand-placed lights and a shadow ground.
- `mattePastel` lightens its colour a lot: pick a saturated `color` for it.
- Animations: idle, walk, run, wave, jump, dance; styles: humanoid, robot, blob, cat, bird (`catalog generators character`).
- A rigged library model instead: `{ "kind": "model", "src": "library:models/characters/robot.glb", "fit": 2, "animation": { "clip": "Wave", "loop": true } }` (the model's description lists its clips; an unknown clip makes `render` report an `asset-load` issue listing the real ones).
