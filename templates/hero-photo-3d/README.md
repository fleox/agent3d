# 3D photo hero

A 16:9 hero made from one photograph: a blue-hour street of Innsbruck's old town (CC0, Wilfredo Rafael Rodriguez Hernandez on Wikimedia Commons) turned into a **3D photo**. The `photo` object pairs the picture with a depth map estimated locally by `agent3d assets depth` (white = near, black = far): in `parallax` mode the shader shifts near and far parts of the image differently, so the street opens up in depth as the view moves.

What moves the view: the **pointer** over the scene, the **gyroscope** on phones, and a gentle automatic **sway** (a figure-eight drift that also plays in headless renders, videos and on touch screens; it fades out while the pointer drives the view). A serif headline and a spaced subtitle rise into the sky gap between the roofs. Visitors who prefer reduced motion get the still frame at 2.5 s.

## Use your own photo

```bash
agent3d assets add /path/to/photo.jpg --license CC0-1.0 --author "Name" --json
agent3d assets depth assets/textures/photo.jpg --json
```

Then point `objects#photo.src` to `assets/textures/photo.jpg` and `objects#photo.depth` to `assets/depth/photo-depth.png`, render (`render --count 4 --sheet`) and move the headline to a calm area of the picture. The first `assets depth` run downloads the depth model once (27 MB, no account); later runs work offline.

## What to tweak

| Change | Where |
|---|---|
| Headline / subtitle | `data.title`, `data.subtitle` (or `data-title` / `data-subtitle` on the embed) |
| Headline position | `objects#title.position`, `objects#subtitle.position` (keep them over a quiet part of the photo) |
| Depth amount | `objects#photo.strength` (0.2-0.4 looks natural; higher stretches edges) |
| Still plane | `objects#photo.focus` (0 = far … 1 = near): the depth that does not move — set it to the subject's depth |
| Motion | `objects#photo.motion`: `pointer` amount, `gyro`, `auto` (`sway`, `orbit`, `zoom`, `none`), `speed` (cycles per 10 s), `smoothing` |
| Look | `objects#photo.mode`: `parallax` (default), `mesh` (survives larger camera moves), `layers` (pop-up book) |
| Photo size | `objects#photo.width` (11.9 covers the 16:9 frame; the photo is 3:2, so top and bottom are cropped) |

`target.toneMapping` is `none` so the white headline stays pure white (photos are always shown with their original colours). The photo (552 KB) and its depth map (185 KB) are the only assets; run `assets optimize` to lighten the photo for production.
