# Luxury perfume hero

A 16:9 dark luxury hero built entirely from primitives: a perfume bottle made with a `lathe` profile in physical glass (transmission + `attenuationColor` = amber juice, plus a low amber `emissive` so the juice glows against the dark backdrop the glass now refracts), a gold collar and an octagonal faceted gold cap, on a black marble pedestal (procedural marble with gold veins) with a gold trim. Two diamonds (`diamond` preset) and a ruby (`gem`) sit on the pedestal. The studio HDRI + `product-top` rig give long highlights; a back spot fades in with the exposure for a "lights up" intro.

Camera: a 6 s `pushIn` and a **rack focus** (`focus` shots) from the front diamond to the bottle, through the `dof` post effect. The serif title fades in letter by letter in gold, with a spaced "EAU DE PARFUM" line.

## What to tweak

| Change | Where |
|---|---|
| Name / line | `data.title`, `data.subtitle` (or `data-title` / `data-subtitle` on the embed) |
| Juice colour | `objects#bottle.material.attenuationColor` + `.emissive` (rose `#e0587a` / `#b03050`, blue `#3a7bd5` / `#2050a0`); lighter juice = higher `attenuationDistance`, more glow = higher `emissiveIntensity` |
| Bottle shape | `objects#bottle.geometry.points` (radius, height from the bottom); keep `collar` / `cap` on top of it |
| Cap | `objects#cap` (`segments` 8 = faceted; 64 = round) |
| Pedestal stone | `objects#pedestal.material.map.colors` (base → veins) |
| Focus pull | `camera.shots` (`focus` on `gemFront` at 0, on `bottle` at 1.2 s), blur amount `postfx[0].aperture` |

The timeline plays once (6 s); reduced motion shows the frame at 3.5 s. Uses `library:hdri/studio.hdr` (≈ 400 KB) for the reflections — diamonds need a contrasty environment to sparkle.
