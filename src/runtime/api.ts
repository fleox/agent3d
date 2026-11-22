// Public contract of the runtime (src/runtime/) — the player that renders a
// SceneDoc with Three.js. It is what `agent3d export` ships to websites, what
// the Studio viewport and `agent3d serve` use, and what `agent3d render`
// drives headless. Types only: implementation in src/runtime/*.

import type { SceneDoc } from "../core/types";

export interface MountOptions {
  // Base URL project-relative asset/script paths resolve against
  // ("./" in an export, "/project/" in serve).
  assetBase?: string;
  // Resolves "library:<id>" asset references to a URL.
  libraryBase?: string;
  // Pre-resolved assets (single-html export): path → data: / blob: URL.
  assetUrls?: Record<string, string>;
  // Script modules already loaded (single-html export / Studio): path → module source text.
  scriptSources?: Record<string, string>;
  // Deterministic mode for screenshots: no real clock, no autoplay; the
  // caller drives time with `seek(t)`. Also disables lazy start.
  deterministic?: boolean;
  // Override pixel ratio (render: 1 or 2).
  pixelRatio?: number;
  // Overrides target.reducedMotion detection (render / Studio).
  reducedMotion?: boolean;
  // Studio: show helpers (grid, axes, light gizmos) and allow object picking.
  editor?: boolean;
  onError?(error: RuntimeIssue): void;
  onReady?(player: Player): void;
  // Script / UI events (api.emit, UI button actions, Player.emit) — the Web
  // Component re-dispatches them as `agent3d:event` DOM events.
  onEvent?(name: string, payload?: unknown): void;
  // A click / tap on the canvas: the id of the object hit (top-level, or the
  // nearest interactive ancestor), or null; point in normalised -1..1 coordinates.
  onClick?(id: string | null, point: { x: number; y: number }): void;
  // Asset loading progress (models, fonts, textures, scripts): loaded / total so far.
  onProgress?(loaded: number, total: number): void;
}

export interface RuntimeIssue {
  code: string; // "asset-load" | "script-error" | "webgl-unavailable" | "unknown-catalog-id" | …
  message: string;
  path?: string; // scene path or asset path
}

export interface FrameStats {
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  fps?: number;
}

export interface Player {
  readonly scene: SceneDoc;
  readonly canvas: HTMLCanvasElement;
  // Resolves when every asset (models, fonts, textures, scripts) is loaded and the first frame rendered.
  ready: Promise<void>;
  play(): void;
  pause(): void;
  // Jump to time t (seconds) and render that exact frame (timeline, behaviours,
  // particles, scripts' update loop with a fixed step are all a pure function
  // of t in deterministic mode).
  seek(t: number): Promise<void>;
  time(): number;
  // Replace the scene (Studio live edit): rebuilds what changed.
  update(scene: SceneDoc): Promise<void>;
  resize(): void;
  stats(): FrameStats;
  // World-space bounding boxes of top-level objects + whether each is inside the camera frustum.
  inspect(): InspectResult;
  // PNG data URL of the current frame.
  snapshot(type?: "image/png" | "image/webp", quality?: number): string;
  // Supersampled still of the current frame: `samples` (1…64, default 16)
  // sub-pixel-jittered renders accumulated through the post-processing
  // pipeline (a bare tone-mapping pipeline when the scene has no postfx) —
  // perfect edges, smooth AO / shadows / dithering. For posters and HQ renders.
  // Note: deterministic snapshot() already supersamples when postfx has `taa`.
  snapshotHighQuality?(samples?: number, type?: "image/png" | "image/webp", quality?: number): Promise<string>;
  // Simulated input for headless tests of games / interactions.
  input: {
    pointer(x: number, y: number): void; // normalised -1..1
    key(code: string, down: boolean): void;
    click(x?: number, y?: number): void;
    // Press / release the pointer (drags: down, pointer moves, up) and swipe gestures.
    down?(x?: number, y?: number): void;
    up?(x?: number, y?: number): void;
    swipe?(direction: "left" | "right" | "up" | "down"): void;
    // Page scroll progress 0..1 (scroll-driven timelines / behaviours); null = real scroll.
    scroll?(progress: number | null): void;
  };
  // Script-visible state (games): read by tests / render.
  state(): Record<string, unknown>;
  // Id of the top-level object under a normalised (-1..1) canvas point, or null (Studio picking).
  pick?(x: number, y: number): string | null;
  // ─── Motion (timeline segments, interactions, events) ───
  // Play a timeline segment (timeline.segments) or "timeline" (all of it from 0).
  playSegment?(name: string, opts?: { reverse?: boolean }): void;
  // Fire the scene's interactions as if `on` happened ("click" | "hover" |
  // "hoverEnd" | "key" | "event"…) on `target` (object id, key code or event name).
  trigger?(on: string, target?: string): void;
  // Emit an event: scripts api.on(name), MountOptions.onEvent (the element's
  // agent3d:event), Player.on listeners and interactions { on: "event" }.
  // Timeline markers are emitted the same way (payload { marker, time }).
  emit?(name: string, payload?: unknown): void;
  // Listen to emitted events / markers. Returns an unsubscribe function.
  on?(name: string, handler: (payload?: unknown) => void): () => void;
  // Force the page scroll progress (0..1) — headless renders of scroll states; null = real scroll.
  setScrollProgress?(progress: number | null): void;
  // Studio only (mounted with `editor: true`): low-level access for the editor
  // overlay (src/runtime/editor/, imported lazily by the Studio, never by websites).
  editor?: EditorBridge;
  dispose(): void;
}

// Bridge between the Player and the Studio's editor overlay (gizmos, editor camera).
export interface EditorBridge {
  // The live scene graph (src/runtime/build/index.ts World). Replaced on every
  // update(): listen with onWorld and re-resolve objects by id.
  world(): import("./build/index").World | null;
  renderer(): import("three").WebGLRenderer | null;
  // Draws after each rendered frame (gizmos on top) and may replace the view camera.
  setOverlay(overlay: EditorOverlayHooks | null): void;
  // Re-render the current frame now (paused player: gizmo hover / drag, editor camera moves).
  render(): void;
  onWorld(listener: () => void): () => void;
  // Whether the player's own loop is running (it then renders every frame anyway).
  running(): boolean;
}

export interface EditorOverlayHooks {
  // Free editor camera: its pose and projection are used for rendering instead of the scene camera's (null → scene camera).
  viewCamera?(): import("three").Camera | null;
  // Called after the scene (and post effects) rendered, with the camera used.
  draw(renderer: import("three").WebGLRenderer, camera: import("three").Camera): void;
}

export interface InspectResult {
  objects: {
    id: string;
    min: [number, number, number];
    max: [number, number, number];
    inView: "full" | "partial" | "none";
    screenCoverage: number; // 0..1 of the canvas area covered by its projected bounding box
  }[];
  camera: { position: [number, number, number]; target: [number, number, number]; insideObject?: string };
}

// mountScene(container, scene, options) → Player. The container gets a
// <canvas> sized to it (the embed sizes the container from target.aspect).
export type MountScene = (container: HTMLElement, scene: SceneDoc, options?: MountOptions) => Player;

// Headless hook used by `agent3d render` / tests: the preview page sets
// window.__agent3d = { player, issues } once mounted.
export interface HeadlessHandle {
  player: Player | null;
  issues: RuntimeIssue[];
  ready: boolean;
}

// ─── Script API (scene.scripts) ─────────────────────────────────────────
//
// A script is an ES module whose default export is a factory:
//
//   export default function (api) {
//     return { start() {}, update(dt, t) {}, onEvent(name, payload) {} };
//   }
//
// Scripts get ONLY this API (no fetch, no DOM outside the HUD, no storage
// but api.storage): `agent3d check` rejects scripts using fetch, XMLHttpRequest,
// WebSocket, eval, Function, import(), document, window, globalThis, localStorage,
// cookies, parent/top, postMessage.

export interface ScriptObject {
  readonly id: string;
  position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
  rotation: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }; // degrees
  scale: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
  visible: boolean;
  velocity: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }; // physics bodies
  userData: Record<string, unknown>;
  tags: string[];
  setColor(color: string): void;
  setOpacity(opacity: number): void;
  playAnimation(clip: string | number, options?: { loop?: boolean; speed?: number; crossfade?: number }): void;
  distanceTo(other: ScriptObject): number;
  remove(): void;
}

export interface ScriptApi {
  // Scene graph
  get(id: string): ScriptObject | null;
  findByTag(tag: string): ScriptObject[];
  spawn(def: import("../core/types").ObjectDef, parentId?: string): Promise<ScriptObject>;
  // Clone an existing object (fast, synchronous), new id auto-generated unless given.
  clone(id: string, overrides?: { id?: string; position?: [number, number, number] }): ScriptObject;
  camera: ScriptObject & { lookAt(x: number, y: number, z: number): void; shake(intensity: number, duration: number): void };
  // Time
  time(): number;
  // Seeded RNG (deterministic per scene.seed)
  random(): number;
  randomRange(min: number, max: number): number;
  // Input
  input: {
    isDown(code: string): boolean; // KeyboardEvent.code: "ArrowLeft", "Space", "KeyA"…
    pressed(code: string): boolean; // went down this frame
    pointer: { x: number; y: number; down: boolean; justPressed: boolean }; // normalised -1..1
    // Swipes on touch / arrow-like gestures: "left" | "right" | "up" | "down" | null this frame
    swipe(): "left" | "right" | "up" | "down" | null;
    // World point under the pointer on the y=0 plane (or on objects with a body)
    pointerWorld(): { x: number; y: number; z: number; objectId?: string } | null;
  };
  // Physics / collisions (rigid bodies: cannon-es, fixed step, deterministic).
  // Angles / angular velocities in degrees (/ s), like rotations everywhere.
  physics: {
    // Exact shape overlap right now (any body types, no step needed).
    overlaps(a: string | ScriptObject, b: string | ScriptObject): boolean;
    // Objects with a body touching `a` during the last step
    contacts(a: string | ScriptObject): ScriptObject[];
    // Nearest hit on the real collider shapes. options: ignore objects, only
    // some collision layers, skip triggers (included by default).
    raycast(
      from: [number, number, number],
      dir: [number, number, number],
      maxDistance?: number,
      options?: { ignore?: (string | ScriptObject)[]; layers?: string[]; triggers?: boolean },
    ): { objectId: string; distance: number; point: [number, number, number]; normal: [number, number, number] } | null;
    // point: world point where it is applied (default: centre of mass → no spin)
    applyImpulse(obj: string | ScriptObject, impulse: [number, number, number], point?: [number, number, number]): void;
    // Continuous force for the next fixed step (call it every update to keep pushing).
    applyForce(obj: string | ScriptObject, force: [number, number, number], point?: [number, number, number]): void;
    applyTorque(obj: string | ScriptObject, torque: [number, number, number]): void;
    setVelocity(obj: string | ScriptObject, v: [number, number, number]): void;
    getVelocity(obj: string | ScriptObject): [number, number, number];
    setAngularVelocity(obj: string | ScriptObject, degreesPerSecond: [number, number, number]): void;
    getAngularVelocity(obj: string | ScriptObject): [number, number, number];
    // Character controller: standing on something (contact normal pointing up).
    grounded(obj: string | ScriptObject): boolean;
    // Steer horizontally toward move * speed (|move| ≤ 1, x / z), keeping the vertical
    // velocity; call once per update. Makes the body a character (no rotation, no friction).
    moveCharacter(obj: string | ScriptObject, move: { x: number; z: number } | [number, number], options?: { speed?: number; acceleration?: number; airControl?: number }): void;
    // Jump when grounded (0.12 s coyote time, no double jump). Returns true when it jumped.
    jump(obj: string | ScriptObject, speed?: number): boolean;
    wake(obj: string | ScriptObject): void;
    // Hinge motor speed of a physics.joints entry (by its id).
    setMotorSpeed(jointId: string, degreesPerSecond: number): void;
    // Contact began (also fires for triggers). info: world point, normal (a → b),
    // impulse (N·s) and approach speed (m/s) — e.g. play a sound when impulse > 1.
    onCollision(handler: (a: ScriptObject, b: ScriptObject, info: { point: [number, number, number]; normal: [number, number, number]; impulse: number; speed: number }) => void): void;
    onCollisionEnd(handler: (a: ScriptObject, b: ScriptObject) => void): void;
    // Something entered / left a trigger body.
    onTriggerEnter(handler: (trigger: ScriptObject, other: ScriptObject) => void): void;
    onTriggerExit(handler: (trigger: ScriptObject, other: ScriptObject) => void): void;
  };
  // Shared state: HUD placeholders {key} read from here; tests read it too.
  state: Record<string, unknown>;
  ui: {
    set(id: string, props: { text?: string; visible?: boolean; value?: number }): void;
    toast(text: string, seconds?: number): void;
  };
  audio: {
    play(name: string): void;
    music(on: boolean): void;
  };
  // Events: UI buttons emit their `action`; scripts can emit their own.
  on(event: string, handler: (payload?: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
  // Persist small values (best score) in a namespaced localStorage key, wrapped in try/catch.
  storage: { get(key: string): unknown; set(key: string, value: unknown): void };
  data: Record<string, unknown>; // scene.data
  // Restart the scene from its initial definition (game over → retry).
  restart(): void;
  log(...args: unknown[]): void;
}

export interface ScriptInstance {
  start?(): void | Promise<void>;
  update?(dt: number, t: number): void;
  onEvent?(name: string, payload?: unknown): void;
  dispose?(): void;
}

export type ScriptFactory = (api: ScriptApi) => ScriptInstance;
