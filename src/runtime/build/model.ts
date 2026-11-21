// glTF / GLB models: fit, centre (bottom-centre at origin), animation clips,
// optional material override.

import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { ModelObjectDef } from "../../core/types";
import { num } from "../util";
import type { RuntimeContext } from "./context";
import { overrideMaterials } from "./materials";

const gltfCache = new Map<string, Promise<GLTF>>();

async function loadGltf(url: string): Promise<GLTF> {
  let p = gltfCache.get(url);
  if (!p) {
    p = import("three/addons/loaders/GLTFLoader.js").then((m) => new m.GLTFLoader().loadAsync(url));
    p.catch(() => gltfCache.delete(url));
    gltfCache.set(url, p);
  }
  return p;
}

export interface ModelAnimator {
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  play(clip: string | number, opts?: { loop?: boolean; speed?: number; crossfade?: number }): void;
}

export async function buildModel(def: ModelObjectDef, ctx: RuntimeContext): Promise<{ object: THREE.Object3D; animator?: ModelAnimator }> {
  const gltf = await loadGltf(ctx.resolveAsset(def.src));
  const { clone } = await import("three/addons/utils/SkeletonUtils.js");
  const model = clone(gltf.scene);
  const wrapper = new THREE.Group();
  wrapper.add(model);

  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (!box.isEmpty()) {
    const sizeV = box.getSize(new THREE.Vector3());
    const largest = Math.max(sizeV.x, sizeV.y, sizeV.z);
    const k = def.fit && largest > 0 ? def.fit / largest : 1;
    model.scale.multiplyScalar(k);
    if (def.center !== false) {
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x * k, -box.min.y * k, -c.z * k);
    }
  }
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = def.castShadow ?? true;
      m.receiveShadow = def.receiveShadow ?? false;
    }
  });
  if (def.material) await overrideMaterials(model, def.material, ctx);

  let animator: ModelAnimator | undefined;
  if (gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(model);
    let current: THREE.AnimationAction | null = null;
    const play: ModelAnimator["play"] = (clip, opts = {}) => {
      const c = typeof clip === "number" ? gltf.animations[clip] : gltf.animations.find((a) => a.name === clip) ?? gltf.animations.find((a) => a.name.toLowerCase().includes(String(clip).toLowerCase()));
      if (!c) {
        ctx.issue("asset-load", `Model ${def.id} has no animation clip "${clip}" (clips: ${gltf.animations.map((a) => a.name).join(", ")})`, `objects#${def.id}.animation.clip`);
        return;
      }
      const action = mixer.clipAction(c);
      action.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = opts.loop === false;
      action.timeScale = num(opts.speed, 1);
      if (current && current !== action) {
        action.reset().play();
        current.crossFadeTo(action, num(opts.crossfade, 0.3), false);
      } else action.play();
      current = action;
    };
    animator = { mixer, clips: gltf.animations, play };
    const a = def.animation ?? {};
    if (def.animation !== undefined || gltf.animations.length) play(a.clip ?? 0, a);
  }
  return { object: wrapper, animator };
}
