# Fonts — sources and licences

three.js typeface JSON fonts used by `kind: "text"` objects (`font: "<id>"`).
Each file is subset to Basic Latin, Latin-1 Supplement and common punctuation
(€ Œ œ Ÿ ‘ ’ “ ” „ – — … • ‹ › ™) with `scripts/convert-font.mjs`, so French,
Spanish, German, Portuguese, Italian… accents render (é è ê à â ç ô ù û ï ë ñ ü ß …).

| Catalog id | File | Source font | Licence | Origin |
|---|---|---|---|---|
| `sans-bold` | `sans-bold.typeface.json` | Droid Sans Bold — © 2008 The Android Open Source Project (Ascender Corp.) | Apache License 2.0 | three.js repository `examples/fonts/droid/droid_sans_bold.typeface.json` |
| `sans` | `sans.typeface.json` | Droid Sans Regular — © 2008 The Android Open Source Project | Apache License 2.0 | three.js `examples/fonts/droid/droid_sans_regular.typeface.json` |
| `serif-bold` | `serif-bold.typeface.json` | Droid Serif Bold — © 2008 The Android Open Source Project | Apache License 2.0 | three.js `examples/fonts/droid/droid_serif_bold.typeface.json` |
| `mono` | `mono.typeface.json` | Droid Sans Mono — © 2008 The Android Open Source Project | Apache License 2.0 | three.js `examples/fonts/droid/droid_sans_mono_regular.typeface.json` |
| `display` | `display.typeface.json` | Fredoka (default instance of the variable font) — © 2016 The Fredoka Project Authors, design Ben Nathan | SIL Open Font License 1.1 | google/fonts `ofl/fredoka/Fredoka[wdth,wght].ttf`, converted with `scripts/convert-font.mjs` (TTFLoader algorithm) |

All licences allow redistribution, modification and embedding in software and
websites, including commercial use.

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0 — the Droid fonts
  are unmodified except for glyph subsetting and JSON trimming (a modification
  notice per §4(b): "subset to Latin-1 by Agent3D").
- SIL Open Font License 1.1: https://openfontlicense.org — the Fredoka subset
  keeps its copyright notice in `original_font_information`; it is not sold
  by itself and is distributed under the OFL (Reserved Font Name: none declared
  for Fredoka). As a converted derivative it is shipped only as part of Agent3D.
