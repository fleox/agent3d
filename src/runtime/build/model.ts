// glTF / GLB models: fit, centre (bottom-centre at origin), animation clips,
// optional material override.

import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { ModelObjectDef } from "../../core/types";
import { num } from "../util";
import type { RuntimeContext } from "./context";
import { overrideMaterials } from "./materials";

const gltfCache = new Map<string, Promise<GLTF>>();

// Extensions a .glb / .gltf declares (from its JSON, before parsing).
export function gltfExtensionsUsed(data: ArrayBuffer): string[] {
  const bytes = new Uint8Array(data);
  let text: string;
  if (bytes.byteLength >= 20 && new DataView(data).getUint32(0, true) === 0x46546c67) {
    const len = new DataView(data).getUint32(12, true);
    text = new TextDecoder().decode(bytes.subarray(20, 20 + len));
  } else text = new TextDecoder().decode(bytes);
  try {
    const json = JSON.parse(text) as { extensionsUsed?: unknown };
    return Array.isArray(json.extensionsUsed) ? json.extensionsUsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

// Loads a model; the meshopt decoder (EXT_meshopt_compression, written by
// `agent3d assets optimize`) is imported only when the file uses it.
async function loadGltf(url: string): Promise<GLTF> {
  let p = gltfCache.get(url);
  if (!p) {
    p = (async () => {
      const [{ GLTFLoader }, res] = await Promise.all([import("three/addons/loaders/GLTFLoader.js"), fetch(url)]);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const data = await res.arrayBuffer();
      const used = gltfExtensionsUsed(data);
      if (used.includes("KHR_draco_mesh_compression")) throw new Error(`${url} uses Draco compression (KHR_draco_mesh_compression), which the Agent3D runtime does not decode. Re-export it without Draco (Blender: uncheck "Compression"), or convert it to meshopt with gltfpack (\`gltfpack -i in.glb -o out.glb -cc\`), then run \`agent3d assets optimize\`.`);
      const loader = new GLTFLoader();
      if (used.includes("EXT_meshopt_compression")) {
        const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
        await MeshoptDecoder.ready;
        loader.setMeshoptDecoder(MeshoptDecoder);
      }
      const base = url.slice(0, url.lastIndexOf("/") + 1);
      return loader.parseAsync(data, /^data:/.test(url) ? "" : base);
    })();
    p.catch(() => gltfCache.delete(url));
    gltfCache.set(url, p);
  }
  return p;
}

export interface ModelAnimator {
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  play(clip: string | number, opts?: { loop?: boolean; speed?: number; crossfade?: number }): void;
  // Timeline hooks: "<id>.animation.<clip>.weight|speed|time".
  control?: { weight(clip: string, w: number): void; speed(clip: string, s: number): void; time(clip: string, t: number): void };
  // Back to the initial clip(s) at their start (deterministic rewind).
  reset?(): void;
}

// Applies morph target influences by name to every mesh that has them.
export function applyMorph(root: THREE.Object3D, morph: Record<string, number>): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.morphTargetDictionary || !m.morphTargetInfluences) return;
    for (const [name, v] of Object.entries(morph)) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined && typeof v === "number") m.morphTargetInfluences[i] = v;
    }
  });
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

  if (def.morph) applyMorph(model, def.morph);

  let animator: ModelAnimator | undefined;
  if (gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(model);
    let current: THREE.AnimationAction | null = null;
    const find = (clip: string | number) =>
      typeof clip === "number" || /^\d+$/.test(String(clip))
        ? gltf.animations[Number(clip)]
        : gltf.animations.find((a) => a.name === clip) ?? gltf.animations.find((a) => a.name.toLowerCase().includes(String(clip).toLowerCase()));
    const missing = new Set<string>();
    const clipOf = (clip: string | number) => {
      const c = find(clip);
      if (!c && !missing.has(String(clip))) {
        missing.add(String(clip));
        ctx.issue("asset-load", `Model ${def.id} has no animation clip "${clip}" (clips: ${gltf.animations.map((a) => a.name).join(", ")})`, `objects#${def.id}.animation.clip`);
      }
      return c;
    };
    const play: ModelAnimator["play"] = (clip, opts = {}) => {
      const c = clipOf(clip);
      if (!c) return;
      const action = mixer.clipAction(c);
      action.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = opts.loop === false;
      action.timeScale = num(opts.speed, 1);
      action.enabled = true;
      if (current && current !== action) {
        action.reset().setEffectiveWeight(1).play();
        current.crossFadeTo(action, num(opts.crossfade, 0.3), false);
      } else action.setEffectiveWeight(1).play();
      current = action;
    };
    // Blend / timeline clips run alongside the main one with their own weight.
    const layer = (clip: string) => {
      const c = clipOf(clip);
      if (!c) return null;
      const action = mixer.clipAction(c);
      if (!action.isRunning()) {
        action.enabled = true;
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
      return action;
    };
    const control: NonNullable<ModelAnimator["control"]> = {
      weight(clip, w) {
        layer(clip)?.setEffectiveWeight(Math.max(0, w));
      },
      speed(clip, sp) {
        const a = layer(clip);
        if (a) a.timeScale = sp;
      },
      time(clip, t) {
        const a = layer(clip);
        if (!a) return;
        a.paused = true;
        a.time = Math.max(0, t);
      },
    };
    const a = def.animation ?? {};
    const start = () => {
      mixer.stopAllAction();
      current = null;
      play(a.clip ?? 0, a);
      if (a.offset && current) (current as THREE.AnimationAction).time = Math.max(0, a.offset);
      for (const [clip, w] of Object.entries(a.blend ?? {})) control.weight(clip, w);
      mixer.update(0);
    };
    animator = { mixer, clips: gltf.animations, play, control, reset: start };
    start();
  }
  return { object: wrapper, animator };
}
