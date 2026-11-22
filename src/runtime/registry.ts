// Implementation registries of the runtime. Each catalog id
// (src/core/catalog.ts) has exactly one implementation registered here;
// src/runtime/registry.test.ts checks the two lists match.
//
// Ownership: src/runtime/generators/ registers GENERATOR_IMPLS,
// src/runtime/shaders/ SHADER_IMPLS, src/runtime/audio/ SOUND_IMPLS;
// src/runtime/behaviours/, particles/, postfx/, geometry/, materials/ the rest.

import type * as THREE from "three";
import type { BehaviourDef, Color, SceneDoc } from "../core/types";

// Seeded PRNG + noise shared by every procedural piece (src/runtime/random.ts).
export interface Rng {
  next(): number; // [0, 1)
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

export interface BuildContext {
  scene: SceneDoc;
  rng: Rng;
  // Other generator objects already built under the same parent (trees "onTerrain"
  // query the terrain height): id → built object.
  siblings: Map<string, BuiltObject>;
  // Converts a CSS colour string to a THREE.Color.
  color(c: Color): THREE.Color;
  // Resolve a project asset path / library id to a URL.
  resolveAsset(path: string): string;
  // Where the object being built will be placed in its parent (its def's
  // position / scale): scatterers convert their local points to the terrain's
  // frame with it ("onTerrain"). Absent = at the origin, unscaled.
  placement?: { position: [number, number, number]; scale: [number, number, number] };
  // Quality tier the player started with (absent = "high"): costly optional
  // features (water reflections) scale down or turn off on "low".
  quality?: "low" | "medium" | "high" | "ultra";
}

export interface BuiltObject {
  object: THREE.Object3D;
  // Called every frame with the scene time (deterministic: pure function of t
  // when possible) and the frame delta.
  update?(t: number, dt: number): void;
  // Height of the surface at (x, z) in the object's local space (terrains).
  heightAt?(x: number, z: number): number;
  dispose?(): void;
}

export type GeneratorImpl = (params: Record<string, unknown>, ctx: BuildContext) => BuiltObject | Promise<BuiltObject>;

// Shader material factory: returns a material whose `update(t)` advances uniforms.
export interface ShaderImpl {
  create(params: Record<string, unknown>, ctx: BuildContext): { material: THREE.Material; update?(t: number): void };
}

// WebAudio synth: plays a preset on the given context/destination. Music
// presets loop until stop() is called.
export interface SoundImpl {
  play(ctx: AudioContext, destination: AudioNode, volume: number): { stop(): void };
}

export interface BehaviourContext {
  object: THREE.Object3D;
  // Rest transform captured when the behaviour started (behaviours add offsets to it).
  base: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 };
  pointer: { x: number; y: number; inside: boolean }; // normalised -1..1
  hovered(): boolean;
  // Events since last frame on this object.
  clicked(): boolean;
  scroll(): number; // 0..1 progress of the embed through the viewport
  camera: THREE.Camera;
  rng: Rng;
  // Another object of the scene by id (lookAt), or null.
  find?(id: string): THREE.Object3D | null;
}

export interface BehaviourInstance {
  // Applies the behaviour for time t (seconds since it started). Behaviours
  // compose: the runtime resets the object to its base transform each frame,
  // then applies every behaviour in order as offsets.
  update(t: number, dt: number): void;
  dispose?(): void;
}

export type BehaviourImpl = (def: BehaviourDef, ctx: BehaviourContext) => BehaviourInstance;
