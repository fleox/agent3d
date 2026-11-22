# Character showcase

A 16:9 cartoon line-up for mascots, games or kids' products: a rigged library knight (`library:models/characters/knight.glb`, clip `Cheer`) on a central pedestal, flanked by two procedural `character` generators — a robot waving and a cat dancing, both with eyes that follow the pointer. Toon pedestals, a soft contact shadow, falling confetti and an `outline` post effect give a comic-book look. Drag to orbit (zoom off).

## What to tweak

| Change | Where |
|---|---|
| Hero character | `objects#knight.src`: `library:models/characters/mage.glb`, `skeleton.glb`, `robot.glb` (clips `Dance`, `Wave`, `ThumbsUp`…), `platformer-hero.glb`, `mini-soldier.glb` |
| Its animation | `objects#knight.animation.clip` — clip names are listed by `agent3d assets library --query characters` (knight: `Idle`, `Cheer`, `Running_A`, `1H_Melee_Attack_Chop`…) |
| Side characters | `objects#robot.params` / `objects#cat.params`: `style` (`humanoid`, `robot`, `blob`, `cat`, `bird`), colours (`skin`, `shirt`, `pants`, `hair`, `accent`), `animation` (`idle`, `walk`, `run`, `wave`, `jump`, `dance`) |
| Pedestal colours | `objects#pedCenter/pedLeft/pedRight.material.color` |
| Outline | `postfx[0]` (`color`, `thickness`), remove it for a softer look |
| Background | `environment.background.radial` |

~180 draw calls (the procedural characters are built from many parts): fine on desktop; for low-end mobiles keep only the knight.
