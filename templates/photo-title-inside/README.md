# 3D title inside a photo

A 16:9 hero where the 3D content lives **inside** a 3D photo. The picture is a blue-hour street of Innsbruck's old town (CC0, Wilfredo Rafael Rodriguez Hernandez on Wikimedia Commons) with a depth map estimated locally by `agent3d assets depth` (white = near, black = far). The big 3D title "OLD TOWN" sits between the far houses and the nearest building on the right, so that facade hides the end of the letters, and snow falls both in front of and behind the buildings.

How it works: the photo has `"occlude": true`. Each photo pixel writes its true depth to the depth buffer, so any 3D object (text, mesh, model, particles) placed between the photo's depth planes is hidden where the photo is nearer. The photo's motion (pointer, phone gyroscope, a gentle automatic sway) also moves the real camera, so the title slides exactly like the pixels of the street at the same depth: it never swims over the facade. Visitors who prefer reduced motion get the still frame at 2.5 s.

## Where to put things

`agent3d scene summary --json` gives the photo a `depthRange: [zFar, zNear]`: the world z of its farthest (depth 0) and nearest (depth 1) pixels. Here the focus depth (0.45, the plane that stays still) is at z = 0, the sky at about z = -1.2 and the nearest facade at about z = 1.15. A depth-map value d sits at local z ≈ (d - focus) × strength × width × 0.25 (exactly: see `docs/scene-format.md`, "3D inside the photo"). The title is at z = 0.12, depth ≈ 0.5: the right facade (depth 0.5 to 0.85) covers it, the sky and the far houses (depth 0 to 0.45) stay behind it. Move it to z = 0.4 and less of it hides; to z = -0.2 and the buildings on both sides cut into it.

## What to tweak

| Change | Where |
|---|---|
| Title / subtitle | `data.title`, `data.subtitle` (or `data-title` / `data-subtitle` on the embed) |
| How much the building hides the title | `objects#title.position` (z: higher = nearer, less hidden; x: towards the right facade = more hidden) |
| Snow | `objects#snow`: `count`, `size`, `speed`, `area` (its depth range [z] spans in front of and behind the facades); try the `dust` preset for a summer street |
| Depth amount | `objects#photo.strength` (also scales the depth range the 3D content can live in) |
| Still plane | `objects#photo.focus` (0 = far … 1 = near) |
| Motion | `objects#photo.motion`: `pointer`, `gyro`, `auto` (`sway`, `orbit`, `zoom`, `none`), `speed`, `smoothing` |

## Use your own photo

```bash
agent3d assets add /path/to/photo.jpg --license CC0-1.0 --author "Name" --json
agent3d assets depth assets/textures/photo.jpg --json
```

Point `objects#photo.src` / `depth` to the new files, read the new `depthRange` from `scene summary`, then render with the pointer at the corners (`render --sheet --input '[{"t":0.5,"pointer":[-1,0.7]},{"t":1.5,"pointer":[1,-0.7]}]'`) and move the title until the subject you want in front of it covers it.

`target.toneMapping` is `none` so the photo keeps its original colours. The photo (330 KB) and its depth map (80 KB) are the only assets.
