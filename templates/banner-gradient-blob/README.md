# Gradient blob banner

A minimal 3:1 banner for SaaS / product pages: an iridescent, softly morphing blob on the right, a thin chrome orbit with three beads (glass, pearl, gold), faint dust and a pale gradient background. The left two thirds stay empty on purpose: put your HTML headline and buttons there (absolutely positioned over the `<agent3d-scene>`), so the text stays crisp, translatable and SEO-friendly.

## What to tweak

| Change | Where |
|---|---|
| Blob colours (brand) | `objects#blob.params.colors` (2–5 colours, they flow over the surface) |
| Blob shape / motion | `objects#blob.params.noise` (0.15 calm … 0.5 wild), `.speed`, `.radius` |
| Background | `environment.background.gradient` (or set `target.transparent: true` and let the page background show through) |
| Blob on the left instead | x of `objects#blob`, `objects#orbitRing`, `objects#beads` → `-5.6` |
| Orbit | `objects#orbitRing.rotation`, `objects#beads` rotate `speed`, bead materials |

Keep the background light **without** bloom: post effects tone-map the background too, which greys out pale colours.
