# Recipes: complete scenes per kind

Each scene below passed `scene validate`, `check` (no errors, no warnings) and was rendered and looked at. Use one as a starting point: save it as `scene.json` in a project made with `new`, or apply it:

```bash
python3 <skill dir>/scripts/agent3d.py new my-scene --target hero --json
python3 <skill dir>/scripts/agent3d.py scene apply --project my-scene --file recipe.json --json
python3 <skill dir>/scripts/agent3d.py scene apply --project my-scene --file recipe.json --yes --json
python3 <skill dir>/scripts/agent3d.py render --project my-scene --sheet --json
```

Then change the brand parts (text, colours, ids you need) with `scene patch`, and render again.

## Banner (4:1): brand title with props

A warm bakery banner: serif title centred, two pastries at the far edges, flour dust, a slow sway of the title, vignette. The title rises in during the first second, so `posterTime` is 2.

What makes it work: dark-to-mid gradient in the brand tones, a cream title that contrasts with it, props at abs(x) 8.2 (outside the title), calm float speeds (0.25–0.3), an 8 s loop that ends where it starts.

```json
{
  "version": 1,
  "id": "bakery-banner",
  "title": "Golden Crust Bakery",
  "ariaLabel": "Golden Crust Bakery: a warm 3D title with floating pastries",
  "target": {"kind": "banner", "aspect": "4:1", "posterTime": 2, "reducedMotion": "static"},
  "camera": {
    "type": "perspective",
    "fov": 30,
    "position": [0, 0, 12],
    "target": [0, 0, 0],
    "controls": "parallax",
    "parallax": {"strength": 0.3, "smoothing": 0.92}
  },
  "environment": {
    "background": {"gradient": ["#2a1306", "#5c2c0c", "#a8561b"], "angle": 10},
    "lighting": "studio",
    "lightingIntensity": 0.7
  },
  "lights": [
    {"id": "fill", "type": "hemisphere", "skyColor": "#fff1dc", "groundColor": "#3a1d0b", "intensity": 0.8},
    {"id": "key", "type": "directional", "position": [4, 6, 6], "intensity": 2.4, "color": "#fff3e0"},
    {
      "id": "rim",
      "type": "point",
      "position": [-5, 2, -3],
      "color": "#ffb366",
      "intensity": 30,
      "distance": 20
    }
  ],
  "objects": [
    {
      "id": "title",
      "kind": "text",
      "text": "Golden Crust",
      "font": "serif-bold",
      "size": 1.1,
      "depth": 0.3,
      "bevel": 0.03,
      "material": {"preset": "plastic", "color": "#fff4e0", "roughness": 0.3},
      "behaviours": [
        {"type": "appear", "effect": "rise", "duration": 1},
        {"type": "float", "amplitude": 0.06, "speed": 0.3}
      ]
    },
    {
      "id": "donut",
      "kind": "mesh",
      "geometry": {"type": "torus", "radius": 0.7, "tube": 0.32},
      "material": {"preset": "clay", "color": "#d9944a"},
      "position": [-8.2, 0.3, -1],
      "rotation": [60, 20, 0],
      "behaviours": [
        {"type": "float", "amplitude": 0.2, "speed": 0.25},
        {"type": "rotate", "axis": [0.3, 1, 0.2], "speed": 15}
      ]
    },
    {
      "id": "bun",
      "kind": "mesh",
      "geometry": {"type": "sphere", "radius": 0.75},
      "material": {"preset": "clay", "color": "#c97b3a"},
      "position": [8.2, -0.2, -1],
      "scale": [1, 0.6, 1],
      "behaviours": [{"type": "float", "amplitude": 0.2, "speed": 0.25, "phase": 0.5}, {"type": "rotate", "speed": 12}]
    },
    {
      "id": "flour",
      "kind": "particles",
      "preset": "dust",
      "count": 90,
      "area": [22, 6, 4],
      "size": 0.05,
      "color": "#fff4e0",
      "opacity": 0.5
    }
  ],
  "postfx": [{"type": "vignette", "offset": 1, "darkness": 0.9}],
  "timeline": {
    "duration": 8,
    "loop": true,
    "tracks": [{"target": "title.rotation.y", "keys": [[0, -5], [4, 5], [8, -5]], "ease": "inOutSine"}]
  }
}
```

Variations: swap the props for the product (library models, `fit: 1.5`); `"font": "display"` for playful brands; a `neon` title on a dark background with bloom for nightlife (template `banner-neon-title`).

## Hero (16:9): abstract shape with room for HTML text

An iridescent morphing blob on the right third, a thin neon ring, faint stars, parallax on the pointer. The left half stays empty for the page's headline and buttons.

What makes it work: radial background (focus), two coloured point lights on opposite sides for iridescent highlights, low `lightingIntensity` (the blob is very reflective), bloom with a high threshold so only the ring glows.

```json
{
  "version": 1,
  "id": "blob-hero",
  "title": "Iridescent blob hero",
  "ariaLabel": "A slowly morphing iridescent shape",
  "target": {"kind": "hero", "aspect": "16:9", "reducedMotion": "static"},
  "camera": {
    "type": "perspective",
    "fov": 35,
    "position": [0, 0, 9],
    "target": [0, 0, 0],
    "controls": "parallax",
    "parallax": {"strength": 0.5, "smoothing": 0.9}
  },
  "environment": {"background": {"radial": ["#2b2d6e", "#0d0e24"]}, "lighting": "studio", "lightingIntensity": 0.35},
  "lights": [
    {"id": "key", "type": "directional", "position": [3, 5, 5], "intensity": 0.8},
    {
      "id": "pink",
      "type": "point",
      "position": [-1, 2, 3],
      "color": "#ff4fd8",
      "intensity": 12,
      "distance": 12
    },
    {
      "id": "cyan",
      "type": "point",
      "position": [5, -2, 2],
      "color": "#3ee8ff",
      "intensity": 12,
      "distance": 12
    }
  ],
  "objects": [
    {
      "id": "blob",
      "kind": "generator",
      "generator": "blob",
      "position": [2.4, 0, 0],
      "params": {"radius": 1.4, "noise": 0.25, "speed": 0.3, "detail": 96},
      "behaviours": [{"type": "followPointer", "strength": 0.3, "mode": "rotate"}]
    },
    {
      "id": "ring",
      "kind": "mesh",
      "geometry": {"type": "torus", "radius": 2, "tube": 0.02, "tubularSegments": 128},
      "material": {"preset": "neon", "color": "#9d8cff", "emissive": "#9d8cff", "emissiveIntensity": 2},
      "position": [2.4, 0, 0],
      "rotation": [75, 0, 0],
      "behaviours": [{"type": "rotate", "axis": [0, 0, 1], "speed": 10}]
    },
    {
      "id": "sparkles",
      "kind": "particles",
      "preset": "stars",
      "count": 150,
      "area": [16, 9, 4],
      "size": 0.04,
      "color": "#cfd6ff"
    }
  ],
  "postfx": [{"type": "bloom", "strength": 0.45, "radius": 0.5, "threshold": 0.95}]
}
```

To put the shape on the left instead: x = -2.4 for the blob and the ring. Transparent over the page's own background: `"target": { …, "transparent": true }`.

## Landscape (21:9): low-poly island

A procedural island (terrain shape `island`) with mixed trees, an opaque sea, drifting clouds, a warm sky with sun and fog, and a very slow camera rotation.

What makes it work: the terrain's own water (`waterLevel` 0.4, same colour as the sea) plus a larger opaque `water` generator just above it, so the horizon has no seam; fog colour = horizon colour; `reducedMotion: "slow"` keeps a gentle motion for people who prefer less.

```json
{
  "version": 1,
  "id": "lowpoly-island",
  "title": "Low-poly island",
  "ariaLabel": "A small low-poly island with trees, surrounded by sea, under a warm sky",
  "target": {"kind": "hero", "aspect": "21:9", "reducedMotion": "slow"},
  "camera": {
    "type": "perspective",
    "fov": 40,
    "position": [0, 11, 30],
    "target": [0, 1.5, 0],
    "controls": "none",
    "autoRotate": 4
  },
  "environment": {
    "background": {
      "sky": {
        "top": "#3a7bd5",
        "horizon": "#ffd8a8",
        "bottom": "#ffd8a8",
        "sun": {"direction": [-0.5, 0.25, -1], "color": "#fff1c1", "size": 1}
      }
    },
    "lighting": "sunset",
    "lightingIntensity": 0.6,
    "fog": {"color": "#ffd8a8", "near": 35, "far": 90}
  },
  "lights": [
    {"id": "fill", "type": "hemisphere", "skyColor": "#cfe8ff", "groundColor": "#6b5a3e", "intensity": 0.9},
    {
      "id": "sun",
      "type": "directional",
      "position": [-10, 14, 8],
      "color": "#ffe0b0",
      "intensity": 2.4,
      "castShadow": true
    }
  ],
  "objects": [
    {
      "id": "island",
      "kind": "generator",
      "generator": "terrain",
      "seed": 4,
      "params": {
        "size": 28,
        "resolution": 72,
        "height": 5,
        "shape": "island",
        "lowpoly": true,
        "waterLevel": 0.4,
        "palette": ["#f2d49b", "#7cb35b", "#4e8a3a", "#8a7560", "#ffffff"],
        "waterColor": "#1d6fa3"
      }
    },
    {
      "id": "sea",
      "kind": "generator",
      "generator": "water",
      "position": [0, 0.45, 0],
      "params": {"size": 140, "color": "#1d6fa3", "shallowColor": "#4fc3d9", "waveHeight": 0.1, "opacity": 1}
    },
    {
      "id": "forest",
      "kind": "generator",
      "generator": "trees",
      "seed": 9,
      "params": {"count": 40, "area": [14, 0, 14], "style": "mixed", "onTerrain": true}
    },
    {
      "id": "sky-clouds",
      "kind": "generator",
      "generator": "clouds",
      "params": {"count": 7, "area": [50, 4, 30], "height": 11, "speed": 0.4}
    }
  ]
}
```

Other shapes: `mountains`, `dunes` (palette of sands, no water: `"waterLevel": null`), `canyon`. Add `grass` and `flowers` generators (`onTerrain: true`) for a close-up meadow; `city` for skylines.

## Character (card 1:1): waving mascot

The built-in procedural character (styles humanoid, robot, blob, cat, bird) waving on a clay pedestal, eyes following the pointer, slight grow on hover, soft shadows on a shadow-only ground.

```json
{
  "version": 1,
  "id": "mascot-card",
  "title": "Waving mascot",
  "ariaLabel": "A friendly 3D mascot waving hello",
  "target": {"kind": "card", "aspect": "1:1", "posterTime": 1},
  "camera": {"type": "perspective", "fov": 32, "position": [0, 1.5, 5.6], "target": [0, 1, 0]},
  "environment": {
    "background": {"gradient": ["#ffe5ec", "#ffc2d1"], "angle": 0},
    "lighting": "soft",
    "ground": {"y": 0, "size": 20, "shadowOnly": true}
  },
  "lights": [
    {"id": "fill", "type": "hemisphere", "skyColor": "#ffffff", "groundColor": "#ffb3c6", "intensity": 1},
    {"id": "key", "type": "directional", "position": [3, 6, 4], "intensity": 2.2, "castShadow": true},
    {"id": "rim", "type": "directional", "position": [-4, 3, -4], "color": "#ffd6a5", "intensity": 1.5}
  ],
  "objects": [
    {
      "id": "pedestal",
      "kind": "mesh",
      "geometry": {"type": "cylinder", "radiusTop": 1.1, "radiusBottom": 1.2, "height": 0.3, "segments": 48},
      "material": {"preset": "clay", "color": "#fb6f92"},
      "position": [0, 0.15, 0],
      "receiveShadow": true
    },
    {
      "id": "mascot",
      "kind": "generator",
      "generator": "character",
      "position": [0, 0.3, 0],
      "params": {
        "style": "humanoid",
        "shirt": "#ff8fab",
        "pants": "#3d2c4e",
        "hair": "#2b1d14",
        "accent": "#ffd166",
        "animation": "wave",
        "height": 1.8,
        "eyesFollowPointer": true
      },
      "behaviours": [{"type": "hoverScale", "scale": 1.06}]
    }
  ]
}
```

Animations: idle, walk, run, wave, jump, dance. For a rigged model instead, use a library character with a clip: `{ "kind": "model", "src": "library:models/characters/robot.glb", "fit": 2, "animation": { "clip": "Wave", "loop": true } }` (the robot's description lists its clips: Idle, Walking, Running, Dance, Jump, Wave…). The knight, mage and skeleton have clips such as `Idle`, `Walking_A`, `Running_A`, `Cheer`, `Jump_Full_Short`; an unknown clip name makes `render` report an `asset-load` issue that lists the model's real clips.

## Product (square 1:1): turntable showcase

A library model fitted to 2.2 units on a light studio backdrop, real studio HDRI reflections, orbit controls (drag to look around, no zoom, limited vertical angle), slow auto-rotation, lift on hover.

```json
{
  "version": 1,
  "id": "bottle-showcase",
  "title": "Water bottle showcase",
  "ariaLabel": "A reusable water bottle turning slowly on a studio backdrop; drag to look around",
  "target": {"kind": "square", "aspect": "1:1"},
  "camera": {
    "type": "perspective",
    "fov": 30,
    "position": [0, 1.4, 6],
    "target": [0, 1, 0],
    "controls": "orbit",
    "orbitZoom": false,
    "autoRotate": 12,
    "orbitLimits": {"minPolar": 50, "maxPolar": 95}
  },
  "environment": {
    "background": {"radial": ["#f4f6f8", "#cfd6de"]},
    "lighting": {"hdri": "library:hdri/studio.hdr", "intensity": 1},
    "ground": {"y": 0, "size": 20, "shadowOnly": true}
  },
  "lights": [
    {"id": "key", "type": "directional", "position": [3, 6, 4], "intensity": 2, "castShadow": true},
    {
      "id": "rim",
      "type": "spot",
      "position": [-3, 4, -3],
      "target": [0, 1, 0],
      "intensity": 40,
      "angle": 35,
      "penumbra": 0.6
    }
  ],
  "objects": [
    {
      "id": "bottle",
      "kind": "model",
      "src": "library:models/products/water-bottle.glb",
      "fit": 2.2,
      "castShadow": true,
      "behaviours": [{"type": "hoverLift", "height": 0.15, "tilt": 6}]
    }
  ]
}
```

With the user's own model: `assets add ./bottle.glb --license proprietary --project …`, then `"src": "assets/models/bottle.glb"`. Keep `fit` so the size is predictable whatever the model's units.

## Game (16:9): lane runner

A complete mini game: three lanes, blocks rush toward the player, switch lanes with the arrow keys or a swipe, score, best score saved, difficulty ramp, synth sounds, and an attract mode (an autopilot plays behind the title) so renders and the poster show action. Details of the patterns: skill `agent3d-game`.

`scene.json`:

```json
{
  "version": 1,
  "id": "runner",
  "title": "Lane Runner",
  "ariaLabel": "Lane Runner, a 3D mini game: switch lanes with the arrow keys or by swiping to dodge the blocks",
  "target": {"kind": "game", "aspect": "16:9", "reducedMotion": "ignore", "posterTime": 3},
  "camera": {"type": "perspective", "fov": 55, "position": [0, 4.5, 7], "target": [0, 0.5, -4]},
  "environment": {
    "background": {"gradient": ["#ffd6a5", "#ff9fb2", "#7b5cff"], "angle": 0},
    "lighting": "soft",
    "fog": {"color": "#ff9fb2", "near": 18, "far": 40}
  },
  "lights": [
    {"id": "fill", "type": "hemisphere", "skyColor": "#ffffff", "groundColor": "#6b4f9e", "intensity": 1.1},
    {"id": "sun", "type": "directional", "position": [5, 10, 6], "intensity": 2, "castShadow": true}
  ],
  "objects": [
    {
      "id": "road",
      "kind": "generator",
      "generator": "road",
      "params": {"width": 6, "length": 60, "lanes": 3, "color": "#3d405b", "speed": 10}
    },
    {
      "id": "player",
      "kind": "mesh",
      "geometry": {"type": "roundedBox", "width": 0.9, "height": 0.9, "depth": 0.9, "radius": 0.15},
      "material": {"preset": "plastic", "color": "#ffd166"},
      "position": [0, 0.45, 2],
      "castShadow": true,
      "body": {"type": "kinematic", "shape": "box"}
    },
    {
      "id": "block",
      "kind": "mesh",
      "geometry": {"type": "box", "width": 1.4, "height": 1, "depth": 1},
      "material": {"preset": "clay", "color": "#ef476f"},
      "position": [0, 0.5, -60],
      "visible": false,
      "castShadow": true,
      "tags": ["template"],
      "body": {"type": "trigger", "shape": "box"}
    }
  ],
  "scripts": ["scripts/game.js"],
  "physics": {"gravity": [0, -9.81, 0]},
  "ui": {
    "elements": [
      {"id": "score", "type": "text", "text": "Score {score}", "anchor": "top-left", "style": "pill"},
      {"id": "best", "type": "text", "text": "Best {best}", "anchor": "top-right", "style": "pill"},
      {
        "id": "title",
        "type": "text",
        "text": "Lane Runner",
        "anchor": "center",
        "style": "title",
        "visible": "phase == 'ready'"
      },
      {
        "id": "hint",
        "type": "text",
        "text": "Arrows or swipe to switch lanes",
        "anchor": "top",
        "style": "subtitle",
        "visible": "phase == 'ready'"
      },
      {
        "id": "start",
        "type": "button",
        "text": "Play",
        "anchor": "bottom",
        "action": "start",
        "visible": "phase == 'ready'"
      },
      {
        "id": "over",
        "type": "text",
        "text": "Game over - {score}",
        "anchor": "center",
        "style": "title",
        "visible": "phase == 'over'"
      },
      {
        "id": "retry",
        "type": "button",
        "text": "Retry",
        "anchor": "bottom",
        "action": "retry",
        "visible": "phase == 'over'"
      }
    ],
    "color": "#ffffff",
    "accent": "#ef476f"
  },
  "audio": {
    "sounds": {
      "move": {"preset": "whoosh", "volume": 0.4},
      "hit": {"preset": "lose"},
      "point": {"preset": "coin", "volume": 0.5}
    }
  },
  "data": {"lanes": [-2, 0, 2], "startSpeed": 9, "maxSpeed": 22, "spawnEvery": 0.9},
  "seed": 7
}
```

`scripts/game.js`:

```js
// Lane Runner: three lanes, blocks rush toward the player.
// phase: "ready" (attract mode: an autopilot plays behind the title) → "play" → "over".
export default function (api) {
  const { lanes, startSpeed, maxSpeed, spawnEvery } = api.data;
  const player = api.get("player");
  let lane = 1;
  let speed = startSpeed;
  let spawnTimer = 0;
  let blocks = [];
  let n = 0;

  function reset(phase) {
    for (const b of blocks) b.remove();
    blocks = [];
    lane = 1;
    speed = startSpeed;
    spawnTimer = 0;
    api.state.phase = phase;
    api.state.score = 0;
    api.state.best = Number(api.storage.get("best") ?? 0);
  }

  function spawn() {
    const x = lanes[Math.floor(api.random() * lanes.length)];
    const b = api.clone("block", { id: `block${n++}`, position: [x, 0.5, -30] });
    b.visible = true;
    blocks.push(b);
  }

  function autopilot() {
    // Attract mode: dodge the nearest block in the player's lane.
    const threat = blocks.find((b) => b.position.z > -8 && b.position.z < player.position.z && Math.abs(b.position.x - lanes[lane]) < 0.5);
    if (!threat) return 0;
    if (lane === 0) return 1;
    if (lane === 2) return -1;
    return api.random() < 0.5 ? -1 : 1;
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
      if (phase === "over") return;
      let move = 0;
      if (phase === "play") {
        const swipe = api.input.swipe();
        if (api.input.pressed("ArrowLeft") || api.input.pressed("KeyA") || swipe === "left") move = -1;
        if (api.input.pressed("ArrowRight") || api.input.pressed("KeyD") || swipe === "right") move = 1;
        speed = Math.min(maxSpeed, speed + dt * 0.4); // difficulty ramp
      } else {
        move = autopilot();
      }
      if (move) {
        const next = Math.max(0, Math.min(2, lane + move));
        if (next !== lane && phase === "play") api.audio.play("move");
        lane = next;
      }
      // Ease toward the lane.
      player.position.x += (lanes[lane] - player.position.x) * Math.min(1, dt * 14);

      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawn();
        spawnTimer = spawnEvery * (startSpeed / speed);
      }
      for (const b of blocks.slice()) {
        b.position.z += speed * dt;
        if (phase === "play" && api.physics.overlaps(player, b)) {
          api.state.phase = "over";
          api.audio.play("hit");
          api.camera.shake(0.3, 0.4);
          const best = Math.max(Number(api.state.best), Number(api.state.score));
          api.state.best = best;
          api.storage.set("best", best);
          return;
        }
        if (b.position.z > 6) {
          b.remove();
          blocks.splice(blocks.indexOf(b), 1);
          if (phase === "play") {
            api.state.score = Number(api.state.score) + 1;
            api.audio.play("point");
          }
        }
      }
    },
  };
}
```
