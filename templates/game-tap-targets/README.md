# Tap the targets

A playable 16:9 reflex game ("Tap Tap Targets"), perfect for touch screens: 30-second rounds in which targets (`library:models/platformer/target.glb`) pop out of nine holes. Tap / click them before they hide; hits within 1.2 s of each other build a combo multiplier (up to ×8), golden targets are worth 5×, tapping nothing or letting a target escape breaks the combo. Targets come faster and stay up shorter as the round goes. Best score saved with `api.storage`, end screen + **Play again**, synth sounds, and an **attract mode** whose autopilot taps targets so the embed is alive.

## Controls

| | Touch / mouse | Keyboard |
|---|---|---|
| Hit a target | tap / click it (`api.input.pointerWorld()` → trigger body id) | keys 1–9, numpad layout (7 8 9 = back row) |
| Start / retry | tap, or **Play again** | Space, Enter, 1–9 |

## What to tweak

| Change | Where |
|---|---|
| Round length & pace | `data.targets`: `round`, `upTime` → `minUpTime`, `spawnEvery` → `minSpawnEvery` (start → end of the round), `comboWindow`, `goldChance` |
| Target look | `objects#target0…8.src` (any model; keep ids and the trigger `body`) — e.g. `library:models/nature/pumpkin.glb` for Halloween |
| Board / holes | `objects#board.material.color`, `objects#hole0…8` |
| Texts / colours | `ui.elements`, `ui.accent`, `environment.background` |

`api.state`: `phase` (`attract` | `play` | `over`), `score`, `combo` ("x3"), `hits`, `time`, `timeBar`, `best`.
