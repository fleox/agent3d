# Photo scroll story

A 16:9 hero where scrolling the page dives into photographs. Two 3D photos (parallax mode, CC0 pictures + depth maps from `agent3d assets depth`) are stacked: the street in front, the lake just behind. The timeline uses `trigger: "scroll"` (range `top top` → `bottom top`, smoothing 0.85), so its time follows the page scroll, and its tracks drive each photo's camera move through `motion.progress`:

| Scroll | What happens | Tracks |
|---|---|---|
| 0–55 % | **Dolly** down the street: the view pushes in, the near houses grow faster than the far end | `street.motion.progress` 0 → 1 (`motion.auto: "dolly"`) |
| 0–32 % | "OLD TOWN" rises and fades | `title1.material.opacity`, `title1.position.y`, `sub1.material.opacity` |
| 42–58 % | The street dissolves into the lake | `street.material.opacity` 1 → 0 |
| 50–100 % | **Dolly zoom** on the lake: the jetties keep their place while the mountains swell | `lake.motion.progress` 0 → 1 (`motion.auto: "vertigo"`) |
| 60–72 % | "THEN, THE LAKE" fades in | `title2.material.opacity`, `title2.position.y` |

The pointer (and the phone gyroscope) still looks around inside each photo (`motion.pointer` 0.6); the moves themselves only follow the scroll. Markers `street` / `lake` emit `agent3d:event` on the element.

## Page setup

To let the visitor scroll through the whole story while the scene stays on screen, put the embed in a tall wrapper with a sticky child: `<section style="height:300vh"><div style="position:sticky;top:0"><agent3d-scene …></agent3d-scene></div></section>`. Without a wrapper, the story plays while the hero scrolls out of view.

## What to tweak

| Change | Where |
|---|---|
| Your photos | replace `assets/textures/*.webp`, run `agent3d assets depth assets/textures/<photo>` and point `objects#street/lake.src` / `.depth` at them; set `focus` to the subject's depth (0 far … 1 near) |
| The moves | `objects#<photo>.motion.auto`: `dolly` (push in), `pan` (truck left → right), `rise` (crane up), `vertigo` (dolly zoom), `zoom`, `sway`, `orbit` |
| Pacing | the keys of the `<photo>.motion.progress` and `street.material.opacity` tracks (timeline seconds = scroll × 10) |
| A third photo | add a photo behind the lake (`position` z -0.1), fade `lake.material.opacity` out and drive the new photo's `motion.progress`, extend `timeline.duration` |
| Headlines | `data.title`, `data.subtitle`, `data.title2` (or `data-title` … attributes on the element) |

Reduced motion: the scene stays on its first frame (`posterTime` 0). Check a scroll position with `agent3d render --scroll 0.6`.
