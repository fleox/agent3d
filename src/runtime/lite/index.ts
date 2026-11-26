// Photo-only lite runtime entry (dist/runtime/agent3d-photo.js, one file, no
// Three.js): defines the same <agent3d-scene> element as the full runtime
// (../elementBase.ts — attributes, poster, lazy start, events, ready, …) when
// no other runtime defined it first. `agent3d export` ships it instead of
// agent3d-runtime.js when the scene is a single 3D photo
// (src/ops/liteRuntime.ts). A scene the lite player cannot show (another
// scene of the same page) is handed to the full runtime, imported from the
// same folder on demand — so a page mixing both keeps working.

import { liteRuntimeEligibility } from "../../ops/liteRuntime";
import type { SceneDoc } from "../../core/types";
import type { MountOptions, Player } from "../api";
import { SceneElementBase, defineSceneElement } from "../elementBase";
import { mountPhotoScene } from "./player";

export { mountPhotoScene };

type FullRuntime = { mountScene(container: HTMLElement, scene: SceneDoc, options: MountOptions): Player };

// A Player that forwards to the full runtime's player once it is loaded.
function fullPlayer(container: HTMLElement, scene: SceneDoc, options: MountOptions): Player {
  let inner: Player | null = null;
  let paused = false;
  let disposed = false;
  const url = import.meta.url.replace(/[^/?#]*([?#].*)?$/, "agent3d-runtime.js");
  const ready = (import(/* @vite-ignore */ url) as Promise<FullRuntime>).then(
    (m) => {
      if (disposed) throw new Error("disposed");
      inner = m.mountScene(container, scene, options);
      if (paused) inner.pause();
      return inner.ready;
    },
    (err: Error) => {
      options.onError?.({ code: "runtime-load", message: `This scene needs the full runtime (${url}): ${err.message}` });
      throw err;
    },
  );
  ready.catch(() => undefined);
  const own: Partial<Player> = {
    ready,
    play: () => ((paused = false), inner?.play()),
    pause: () => ((paused = true), inner?.pause()),
    seek: async (t: number) => (await ready, inner!.seek(t)),
    dispose: () => ((disposed = true), inner?.dispose()),
  };
  return new Proxy(own as Player, {
    get(_t, k: string) {
      if (k in own) return own[k as keyof Player];
      const v = inner?.[k as keyof Player];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(inner) : v;
    },
  });
}

export class Agent3DPhotoElement extends SceneElementBase {
  protected mountPlayer(container: HTMLElement, scene: SceneDoc, options: MountOptions): Player {
    return liteRuntimeEligibility(scene).ok ? mountPhotoScene(container, scene, options) : fullPlayer(container, scene, options);
  }
}

defineSceneElement(Agent3DPhotoElement);
