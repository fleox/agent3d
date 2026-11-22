# Gradient blob banner

A minimal 3:1 banner for SaaS / product pages: a softly morphing `blob` whose brand colour ramp flows under a glossy clear-coated, iridescent finish (the object-level physical material keeps the generator's colours), a small companion blob in warmer tones, a thin chrome orbit with three beads (soap bubble, pearl, gold), faint dust and a slowly drifting pastel `meshGradient` background. `dreamy` look (soft bloom, pastel grade). The left two thirds stay empty on purpose: put your HTML headline and buttons there (absolutely positioned over the `<agent3d-scene>`), so the text stays crisp, translatable and SEO-friendly.

## What to tweak

| Change | Where |
|---|---|
| Blob colours (brand) | `objects#blob.params.colors` (2–5 colours), `objects#bubble.params.colors` |
| Blob finish | `objects#blob.material` (`iridescence` 0 = plain gloss; remove the material for the matte original) |
| Blob shape / motion | `objects#blob.params.noise` (0.1 calm … 0.4 wild), `.speed`, `.radius` |
| Background | `environment.background.meshGradient` (or set `target.transparent: true` and let the page show through) |
| Blob on the left instead | x of `objects#blob`, `objects#orbitRing`, `objects#beads` → `-5.6`, `objects#bubble` → `-2.9` |
| Orbit | `objects#orbitRing.rotation`, `objects#beads` rotate `speed`, bead materials |

Reduced motion shows the frame at 2 s.
