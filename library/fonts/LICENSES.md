# Fonts — sources and licences

three.js typeface JSON fonts used by `kind: "text"` objects (`font: "<id>"`).
Each file is built by `scripts/build-fonts.mjs` (→ `scripts/convert-font.mjs`)
from the original font file: outlines subset to Basic Latin, Latin-1 Supplement
and common punctuation (€ Œ œ Ÿ Š š Ž ž ‘ ’ “ ” „ – — … • ‹ › ™), so French,
Spanish, German, Portuguese, Italian… accents render (é è ê à â ç ô ù û ï ë ñ ü ß …),
plus the font's **kerning pairs** (GPOS `kern` feature / `kern` table) between
unaccented characters (`kerning` field; accented letters are kerned like their
base letter), and the OS/2 cap height / x-height.

| Catalog id | File | Source font | Licence | Origin |
|---|---|---|---|---|
| `sans-bold` | `sans-bold.typeface.json` | Inter Bold — © 2016 The Inter Project Authors (Rasmus Andersson) | SIL Open Font License 1.1 | https://github.com/rsms/inter (static instance via Fontsource `@fontsource/inter@5.1.0`, latin + latin-ext) |
| `sans` | `sans.typeface.json` | Inter Regular — © 2016 The Inter Project Authors (Rasmus Andersson) | SIL Open Font License 1.1 | https://github.com/rsms/inter (Fontsource `@fontsource/inter@5.1.0`) |
| `inter-black` | `inter-black.typeface.json` | Inter Black — © 2016 The Inter Project Authors (Rasmus Andersson) | SIL Open Font License 1.1 | https://github.com/rsms/inter (Fontsource `@fontsource/inter@5.1.0`) |
| `montserrat-extrabold` | `montserrat-extrabold.typeface.json` | Montserrat ExtraBold — © 2011 The Montserrat Project Authors (Julieta Ulanovsky) | SIL Open Font License 1.1 | https://github.com/JulietaUla/Montserrat (Fontsource `@fontsource/montserrat@5.1.0`) |
| `space-grotesk-bold` | `space-grotesk-bold.typeface.json` | Space Grotesk Bold — © 2020 The Space Grotesk Project Authors (Florian Karsten) | SIL Open Font License 1.1 | https://github.com/floriankarsten/space-grotesk (Fontsource `@fontsource/space-grotesk@5.1.0`) |
| `bebas-neue` | `bebas-neue.typeface.json` | Bebas Neue — © 2019 The Bebas Neue Project Authors (Ryoichi Tsunekawa, Dharma Type) | SIL Open Font License 1.1 | google/fonts `ofl/bebasneue/BebasNeue-Regular.ttf` |
| `anton` | `anton.typeface.json` | Anton — © 2020 The Anton Project Authors (Vernon Adams) | SIL Open Font License 1.1 | google/fonts `ofl/anton/Anton-Regular.ttf` |
| `serif-bold` | `serif-bold.typeface.json` | Playfair Display Bold — © 2017 The Playfair Display Project Authors (Claus Eggers Sørensen) | SIL Open Font License 1.1 | https://github.com/clauseggers/Playfair (Fontsource `@fontsource/playfair-display@5.1.0`) |
| `serif` | `serif.typeface.json` | Playfair Display Regular — © 2017 The Playfair Display Project Authors (Claus Eggers Sørensen) | SIL Open Font License 1.1 | https://github.com/clauseggers/Playfair (Fontsource `@fontsource/playfair-display@5.1.0`) |
| `mono` | `mono.typeface.json` | JetBrains Mono Bold — © 2020 The JetBrains Mono Project Authors (JetBrains) | SIL Open Font License 1.1 | https://github.com/JetBrains/JetBrainsMono (Fontsource `@fontsource/jetbrains-mono@5.1.0`) |
| `display` | `display.typeface.json` | Fredoka SemiBold — © 2016 The Fredoka Project Authors (Milena Brandão, Ben Nathan) | SIL Open Font License 1.1 | https://github.com/hafontia-zz/Fredoka (Fontsource `@fontsource/fredoka@5.1.0`) |
| `pacifico` | `pacifico.typeface.json` | Pacifico — © 2018 The Pacifico Project Authors (Vernon Adams, Jacques Le Bailly, Botjo Nikoltchev, Ani Petrova) | SIL Open Font License 1.1 | google/fonts `ofl/pacifico/Pacifico-Regular.ttf` |
| `lobster` | `lobster.typeface.json` | Lobster — © 2010 The Lobster Project Authors (Pablo Impallari) | SIL Open Font License 1.1 | google/fonts `ofl/lobster/Lobster-Regular.ttf` |

The Fontsource packages (https://fontsource.org, npm `@fontsource/<family>`)
redistribute the Google Fonts builds of these families as static instances,
split into `latin` and `latin-ext` subsets; both are merged by the converter.

All licences allow redistribution, modification and embedding in software and
websites, including commercial use.

- SIL Open Font License 1.1: https://openfontlicense.org — every file keeps its
  copyright notice in `original_font_information`. These subsets are converted
  derivatives (glyph subsetting + format conversion to three.js typeface JSON);
  they are distributed under the OFL as part of Agent3D and never sold by
  themselves. Playfair Display and Lobster declare a Reserved Font Name, so
  their converted files are renamed ("A3D Serif Bold", "A3D Serif",
  "A3D Script Bold" in `familyName`); the original notice, including the
  Reserved Font Name statement, is kept in `original_font_information`.
