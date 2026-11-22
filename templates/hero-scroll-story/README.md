# Scroll story hero

A 16:9 scroll-driven story. The timeline uses `trigger: "scroll"`: its time follows the scroll progress of the embed through the viewport (0 when it enters at the bottom, 1 when it leaves at the top). The camera glides across three chapters laid out along X; each chapter title (Inter Black, `splitLetters`) pops in letter by letter with a staggered `children:<id>.scale` track as its chapter arrives, the knot turns with the scroll, and markers `design` / `build` / `launch` emit events (`agent3d:event` on the element) your page can listen to. Scroll smoothing 0.85, pastel / jelly / chrome-gradient finishes, soft contact shadows, `clean` look + light AO.

| Scroll | Chapter | Objects |
|---|---|---|
| 0–20 % | **Design** (x = 0) | stacked rounded blocks `design` + titles `t1` / `s1` |
| 40–60 % | **Build** (x = 14) | brushed-metal torus knot `build` + `t2` / `s2` |
| 80–100 % | **Launch** (x = 28) | library lander `rocket` on `launchPad` (takes off at the end), embers + `t3` / `s3` |

## Page setup

To let the visitor scroll through the whole story while the scene stays on screen, put the embed in a tall wrapper with a sticky child, e.g. `<section style="height:300vh"><div style="position:sticky;top:0"><agent3d-scene …></agent3d-scene></div></section>`. Without a wrapper, the story plays while the hero scrolls past.

## What to tweak

| Change | Where |
|---|---|
| Chapter titles | `objects#t1/t2/t3.text` (entrances: tracks `children:t2.scale`, `children:t3.scale`), subtitles `objects#s1/s2/s3.text`, colours in `.material.color` |
| Chapter objects | replace `design`, `build`, `rocket` (keep their x ≈ chapter x + 1.6) |
| Page hooks | `timeline.markers` (seconds → event names) |
| Pacing | `timeline.tracks` `camera.position` / `camera.target` keys (hold = two keys with the same value) |
| Add a chapter | add objects at x = 42, extend `timeline.duration` and the camera keys |
| Colours | `environment.background`, `environment.fog.color`, `objects#floor.material.color` |

Reduced motion: the scene stays on chapter 1 (`posterTime` 0).
