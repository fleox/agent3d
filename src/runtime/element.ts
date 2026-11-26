// <agent3d-scene> Web Component — the public face of the runtime on a web page.
//
//   <script type="module" src="./agent3d-runtime/agent3d-runtime.js"></script>
//   <agent3d-scene src="./banner/scene.json" poster="./banner/poster.webp" aspect="4:1"
//                  data-title="Summer sale"></agent3d-scene>
//
// Attributes (all optional but src / inline scene):
//   src           scene.json URL; project-relative asset paths resolve against its directory.
//   poster        image shown until the first frame; the fallback without WebGL, when printing
//                 and on errors.
//   aspect        "W:H" reserved before scene.json is loaded (no layout shift); the scene's
//                 target.aspect wins once loaded unless the page CSS sets aspect-ratio / height.
//   alt           text alternative of the poster fallback (default: aria-label / scene title).
//   autoplay      "false" → loads and shows the first frame, plays on play() / when `paused` is removed.
//   paused        boolean: paused while present (removing it resumes).
//   loop          "true" | "false" | "pingpong": overrides timeline.loop.
//   quality       "low" | "medium" | "high" | "auto": caps the pixel ratio (1 / 1.5 / 2),
//                 low also drops antialiasing, shadows and post effects; auto picks from the device.
//   interactive   "false" → the canvas ignores the pointer (page scroll / clicks pass through).
//   library-base  base URL of "library:" assets (default `<scene dir>/assets/library/`).
//   data-*        scene data bindings: `data-title="Summer sale"` fills `{data.title}` placeholders
//                 (see ./data.ts); `data-json='{"price": 9}'` merges an object. Live: changing a
//                 data-* attribute rebuilds the scene.
// Children (single-html exports):
//   <script type="application/json">{ …SceneDoc… }</script>                   inline scene (instead of src)
//   <script type="application/json" data-assets>{ "assets/x.glb": "data:…" }</script>   pre-resolved assets
//   <script type="text/agent3d-script" data-path="scripts/game.js">…</script>   inline script modules
//   <img slot="poster" src="poster.webp" alt="…" width="1200" height="300">   the poster as markup:
//              shown before the runtime loads (and without JavaScript), no layout shift — what exports emit
//   <… slot="fallback">…</…>   custom content shown when WebGL is unavailable (default: the poster)
// JS API: el.player, el.ready (Promise<Player>), el.play(), el.pause(), el.seek(t), el.setData(obj),
//   el.data, el.trigger(name, payload?), el.reload().
// DOM events (bubbling, composed): agent3d:ready { player }, agent3d:error RuntimeIssue,
//   agent3d:event { name, payload }, agent3d:click { id, x, y }, agent3d:progress { loaded, total }.
//   Legacy aliases agent3d-ready / agent3d-error are still dispatched.
// Styling: ::part(poster), ::part(loading), ::part(loading-bar), ::part(fallback);
//   --agent3d-background, --agent3d-loading-color, --agent3d-poster-fit, --agent3d-fade.
//   The host carries status="loading" | "ready" | "error" | "unsupported".
// Sizing: display:block, width 100%, aspect-ratio from target.aspect (or target.height) —
//   page CSS on the element wins (these are :host styles).

import type { SceneDoc } from "../core/types";
import type { MountOptions, Player } from "./api";
import { SceneElementBase, defineSceneElement } from "./elementBase";
import { mountScene } from "./player";

export { parseAspectRatio, prepareScene, type ElementStatus, type Quality } from "./elementBase";

export class Agent3DSceneElement extends SceneElementBase {
  protected mountPlayer(container: HTMLElement, scene: SceneDoc, options: MountOptions): Player {
    return mountScene(container, scene, options);
  }
}

export function defineElement(name = "agent3d-scene"): void {
  defineSceneElement(Agent3DSceneElement, name);
}
