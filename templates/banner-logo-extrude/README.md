# Extruded logo banner

A 4:1 brand banner: an SVG logo (`assets/logo.svg`, a sample "N" monogram) extruded into clear-coated 3D (each path keeps its SVG colour) inside a neon halo, next to a Space Grotesk wordmark that rises letter by letter and a tagline. A rect light (`lights#sweep`) sweeps across the logo at 1.4–3.3 s for a glossy highlight pass; cinematic grade, grain, vignette. The logo spins in on load, tilts toward the pointer, does a full spin each time it is hovered and bounces on click; it links to `{data.url}`.

## Use your own logo

1. Replace `assets/logo.svg` (keep the name, or change `objects#logo.src`). Use **filled paths/shapes only** — no `<text>`, strokes or gradients (convert text and strokes to outlines first). Each path keeps its own `fill` colour; separate pieces avoid z-fighting.
2. Update `assets/manifest.json` (bytes, licence) — or run `agent3d assets add`.
3. Adjust `objects#logo.size` (width in units), `.depth` (thickness), `.bevel`.

To force one material on the whole logo (e.g. gold), add `"material": { "preset": "gold" }` to `objects#logo`.

## What to tweak

| Change | Where |
|---|---|
| Wordmark / tagline / link | `data.name`, `data.tagline`, `data.url` (or `data-name`… on the embed); both texts are left-aligned, starting right of the logo |
| Light sweep | timeline tracks `sweep.position.x` / `sweep.intensity` (delete them and `lights#sweep` to remove it) |
| Halo colour | `objects#halo.material.color` / `.emissive` |
| Background | `environment.background.radial` |
| Rim light colours | `lights#rimPink.color`, `lights#rimBlue.color` |
| Hover spin | the `spinOnClick` behaviour on `objects#logo` (`trigger: "hover"` or `"click"`, `duration`) |

Longer wordmark: lower `objects#wordmark.size`, then re-centre the group by moving the x of `logo`, `halo`, `wordmark`, `tagline` by the same amount. Bloom only catches the halo (threshold 1.6), so the white text stays crisp.
