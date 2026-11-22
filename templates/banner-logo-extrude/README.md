# Extruded logo banner

A 4:1 brand banner: an SVG logo (`assets/logo.svg`, a sample "N" monogram) extruded into glossy 3D inside a neon halo, next to a wordmark and tagline. The logo spins in on load, tilts toward the pointer, does a full spin each time it is hovered and bounces on click; it links to `href`.

## Use your own logo

1. Replace `assets/logo.svg` (keep the name, or change `objects#logo.src`). Use **filled paths/shapes only** — no `<text>`, strokes or gradients (convert text and strokes to outlines first). Each path keeps its own `fill` colour; separate pieces avoid z-fighting.
2. Update `assets/manifest.json` (bytes, licence) — or run `agent3d assets add`.
3. Adjust `objects#logo.size` (width in units), `.depth` (thickness), `.bevel`.

To force one material on the whole logo (e.g. gold), add `"material": { "preset": "gold" }` to `objects#logo`.

## What to tweak

| Change | Where |
|---|---|
| Wordmark / tagline | `objects#wordmark.text`, `objects#tagline.text` (both left-aligned, starting right of the logo) |
| Link | `objects#logo.href` |
| Halo colour | `objects#halo.material.color` / `.emissive` |
| Background | `environment.background.radial` |
| Rim light colours | `lights#rimPink.color`, `lights#rimBlue.color` |
| Hover spin | the `spinOnClick` behaviour on `objects#logo` (`trigger: "hover"` or `"click"`, `duration`) |

Longer wordmark: lower `objects#wordmark.size`, then re-centre the group by moving the x of `logo`, `halo`, `wordmark`, `tagline` by the same amount. Bloom only catches the halo (threshold 2), so the white text stays crisp.
