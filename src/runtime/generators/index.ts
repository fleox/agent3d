// Generator registry: one implementation per GENERATORS catalog id.

import type { GeneratorImpl } from "../registry";
import { abstractShapes } from "./abstractShapes";
import { bars3d } from "./bars3d";
import { birds } from "./birds";
import { blob } from "./blob";
import { character } from "./character";
import { city } from "./city";
import { clouds } from "./clouds";
import { crystals } from "./crystals";
import { floatingIsland } from "./floatingIsland";
import { flowers } from "./flowers";
import { galaxy } from "./galaxy";
import { globe } from "./globe";
import { grass } from "./grass";
import { maze } from "./maze";
import { planet } from "./planet";
import { road } from "./road";
import { rocks } from "./rocks";
import { starfield } from "./starfield";
import { terrain } from "./terrain";
import { trees } from "./trees";
import { water } from "./water";
import { waveGrid } from "./waveGrid";

export const GENERATOR_IMPLS: Record<string, GeneratorImpl> = {
  terrain,
  trees,
  rocks,
  grass,
  flowers,
  water,
  clouds,
  city,
  character,
  planet,
  starfield,
  blob,
  waveGrid,
  maze,
  road,
  floatingIsland,
  globe,
  crystals,
  galaxy,
  bars3d,
  abstractShapes,
  birds,
};
