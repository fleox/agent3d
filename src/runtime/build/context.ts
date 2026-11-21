// Internal build context shared by every builder of the runtime core. It
// extends the public BuildContext (registry.ts) handed to generators/shaders.

import type * as THREE from "three";
import type { BuildContext, GeneratorImpl, ShaderImpl } from "../registry";

export interface RuntimeContext extends BuildContext {
  renderer: THREE.WebGLRenderer | null;
  deterministic: boolean;
  // Register a promise the `ready` promise must wait for.
  track<T>(p: Promise<T>): Promise<T>;
  // Per-frame updater (t = scene time, dt = delta).
  onUpdate(fn: (t: number, dt: number) => void): void;
  issue(code: string, message: string, path?: string): void;
  shaders(): Promise<Record<string, ShaderImpl>>;
  generators(): Promise<Record<string, GeneratorImpl>>;
}

// Lazy registries of the procedural-content area (separate chunks).
let shaderMod: Promise<Record<string, ShaderImpl>> | null = null;
let generatorMod: Promise<Record<string, GeneratorImpl>> | null = null;

export function loadShaders(): Promise<Record<string, ShaderImpl>> {
  shaderMod ??= import("../shaders/index").then((m) => m.SHADER_IMPLS);
  return shaderMod;
}

export function loadGenerators(): Promise<Record<string, GeneratorImpl>> {
  generatorMod ??= import("../generators/index").then((m) => m.GENERATOR_IMPLS);
  return generatorMod;
}
