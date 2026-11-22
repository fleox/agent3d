# Mascot hero

A 16:9 hero with a brand mascot, 100 % procedural (0 KB of assets): a `character` generator (style `fox`, `wave` animation, `eyesFollowPointer`) on a pastel pedestal, a 3D speech bubble whose lines come from `scene.data` (`greeting`, `cheer` — overridable per embed with `data-greeting` / `data-cheer`), magic sparkles, a drifting mesh-gradient background, soft studio lighting and contact shadows. The left half stays calm for your HTML headline.

**Click / tap the mascot** (or its pedestal): the `celebrate` timeline segment (manual trigger) swaps the waving fox for a second, hidden copy playing `celebrate` with a laughing face, shows confetti, pops the bubble with the cheer line and tints the pedestal; after 4 s everything returns to the waving state. The interaction also emits `mascot-click` (an `agent3d:event` on the element) for your analytics or CTA logic.

## What to tweak

| Change | Where |
|---|---|
| Lines | `data.greeting`, `data.cheer` (or `data-greeting="…"` on the element). Long lines: widen `objects#bubbleBody.geometry.width` |
| Mascot | `objects#foxWave.params` **and** `objects#foxParty.params` (keep them in sync): `style` (`astronaut`, `robot`, `cat`, `bird`, `blob`, `ghost`, `humanoid`), `skin`, `shirt`, `accent`, `accessories` (humanoid / astronaut: `cap`, `glasses`, `headphones`, `scarf`…), `height` |
| Idle animation | `objects#foxWave.params.animation` (`wave`, `idle`, `talk`, `point`, `dance`) and `expression` |
| Celebration | `objects#foxParty.params.animation` (`celebrate`, `cheer`, `jump`, `dance`), the `timeline` (4.2 s) |
| Colours | `environment.background.meshGradient`, `objects#disc.material.color` (and its track in the timeline) |
| Mascot on the left | x of `objects#mascot`, `objects#disc`, `objects#confetti`, `objects#sparkles` → `-2.4`, bubble x → `-0.15`, `objects#mascot.rotation[1]` → `14`, tail `objects#bubbleTail.position[0]` → `-0.95` and `rotation[2]` → `150` |
| Click action | `interactions` — add `{ "openUrl": "/signup" }` after `play` to make the mascot a CTA |

Reduced motion: the scene freezes on the waving pose at `posterTime` (1.5 s, after the bubble's entrance).
