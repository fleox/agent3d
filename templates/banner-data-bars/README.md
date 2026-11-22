# Data bars banner

A light, clean 4:1 banner: the `bars3d` generator (two rows × 12 rounded bars, coloured by row, staggered grow entrance) angled on the right, a crisp flat headline that rises letter by letter, a caption and an indigo accent line. Soft IBL + 3-point rig, contact shadows, `clean` look + light AO. Zero asset bytes besides the fonts.

## What to tweak

| Change | Where |
|---|---|
| Headline / caption | `data.headline`, `data.caption` (or `data-headline` / `data-caption` on the embed) |
| Values | `objects#chart.params.data` — one row `[3, 5, 8]` or rows `[[…], […]]` (row 0 at the back). The tallest value is drawn `maxHeight` units high |
| Colours | `objects#chart.params.colors` (one per row with `colorBy: "row"`; or `colorBy: "value"` for a ramp), accent `objects#accent.material.color` |
| Animation | `params.animation` (`grow` once, `wave` loop, `none`), `params.duration` |
| Dark version | `environment.background` → `{ "gradient": ["#0b1020", "#141a33"] }`, headline colour `#ffffff`, `baseColor` `#1e2540` |

Note: generator params are not data bindings — the page cannot change the bar values with `data-*`; edit `params.data` (or `scene patch`) instead. Reduced motion shows the frame at 3 s (bars grown).
