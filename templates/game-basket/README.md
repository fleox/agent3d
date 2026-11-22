# Hoop shot

A playable 45-second basketball shooting game on real rigid-body physics (cannon-es, deterministic):

- `ball` — a dynamic `sphere` body (`ccd: true`, bouncy) with seam rings; launched on a computed ballistic arc toward the rim (`data.basket.flight` = flight time of a perfect shot), with backspin;
- `rim` — a static `trimesh` torus (the ball really rattles in and out), `board` and `floor` static boxes;
- `scoreZone` — a hidden `trigger` cylinder under the rim: a basket counts only when the ball falls through it (`api.physics.overlaps` + downward velocity);
- after each shot (`data.basket.respawn` s) the ball comes back at a random spot on the court;
- impact sounds from `api.physics.onCollision` (only real hits, `info.impulse > 0.6`), confetti on a basket, x2 / x3 streak multiplier, best score in `api.storage`.

**Controls:** swipe / drag upward anywhere — the length of the drag is the power (a medium drag ≈ the perfect arc), its sideways drift is the aim. Keyboard: hold Space to charge the power bar (release at about half), ← → nudge the aim. The game starts on the first input; attract mode = an autopilot shooting with a small random error.

**Look:** a spotlit night arena — warm spots on the hoop and the court, blue / pink side lights, wooden floor (`library:textures/wood-planks-*`), blurry crowd lights (`bokeh` particles), bloom and a punchy grade (no AO / DOF: games stay light).

## What to tweak

| Change | Where |
|---|---|
| Round length | `data.basket.time` |
| Difficulty | `data.basket.flight` (longer = higher, steeper arcs, easier), spot range in `newSpot()`, power / aim mapping in `input()` |
| Ball bounce | `objects#ball.body.restitution`, rim / board `restitution` |
| Arena colours | `lights#rimL/rimR.color`, `objects#keyPaint.material.color`, `environment.background` |
| Daylight playground | background gradient sky, `environment.lighting: "sky"`, drop the spots for a `directional` sun |

Test headless: `render --frames 1,2.4,3.6 --input '[{"t":0.6,"drag":{"from":[0,-0.6],"to":[0,-0.03],"duration":0.2}}]'` (a perfect shot scores 2), `--frames 46.5 --input '[{"t":0.5,"key":"Space","hold":0.55}]'` (time-up screen).
