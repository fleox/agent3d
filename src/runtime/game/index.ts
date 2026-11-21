// Script host (loaded lazily when a scene has scripts, ui, physics or bodies):
// implements ScriptApi (src/runtime/api.ts) over the World, runs scripts at a
// fixed step (scene.physics.step, default 1/60) together with the light
// physics engine, drives the HUD, audio, storage and events.

import * as THREE from "three";
import type { BodyDef, ObjectDef, SceneDoc } from "../../core/types";
import type { RuntimeIssue, ScriptApi, ScriptFactory, ScriptInstance, ScriptObject } from "../api";
import type { World, WorldEntry } from "../build/index";
import type { InputState } from "../input";
import { createRng } from "../random";
import type { Rng } from "../registry";
import { DEG, meshMaterials, toColor } from "../util";
import { createAudio, type AudioBridge } from "./audio";
import { createHud, type Hud } from "./hud";
import { PhysicsWorld, type Body, type V3 } from "./physics";

export { PhysicsWorld } from "./physics";

export interface GameHostOptions {
  scene: SceneDoc;
  container: HTMLElement;
  input: InputState;
  resolveAsset(path: string): string;
  scriptSources?: Record<string, string>;
  deterministic: boolean;
  issue(issue: RuntimeIssue): void;
  // Rebuild the World from the initial scene definition (api.restart()).
  rebuild(): Promise<World>;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): void;
}

function vecProxy(get: () => THREE.Vector3 | THREE.Euler, k = 1, onChange?: () => void): Vec3Like {
  return {
    get x() { return get().x / k; },
    set x(v: number) { get().x = v * k; onChange?.(); },
    get y() { return get().y / k; },
    set y(v: number) { get().y = v * k; onChange?.(); },
    get z() { return get().z / k; },
    set z(v: number) { get().z = v * k; onChange?.(); },
    set(x: number, y: number, z: number) {
      get().set(x * k, y * k, z * k);
      onChange?.();
    },
  };
}

const scriptModuleCache = new Map<string, Promise<ScriptFactory | null>>();

export class GameHost implements Pick<ScriptApi, "state"> {
  world!: World;
  physics!: PhysicsWorld;
  state: Record<string, unknown> = {};
  hud: Hud | null = null;
  audio: AudioBridge;
  private instances: { path: string; inst: ScriptInstance; failed: boolean }[] = [];
  private factories: { path: string; factory: ScriptFactory }[] = [];
  private objCache = new Map<string, ScriptObject>();
  private bodyOffsets = new Map<string, THREE.Vector3>();
  private handlers = new Map<string, ((p?: unknown) => void)[]>();
  private collisionHandlers: ((a: ScriptObject, b: ScriptObject) => void)[] = [];
  private rng: Rng;
  private simTime = 0;
  private acc = 0;
  private stepDt: number;
  private pendingPressed = new Set<string>();
  private pendingJust = false;
  private pendingSwipe: InputState["swipe"] = null;
  private stepPressed = new Set<string>();
  private stepJust = false;
  private stepSwipe: InputState["swipe"] = null;
  private shake = { intensity: 0, duration: 0, until: 0 };
  private restartRequested = false;
  private cloneCounter = 0;
  private unlockListeners: (() => void) | null = null;
  readonly api: ScriptApi;

  constructor(private opts: GameHostOptions) {
    this.stepDt = Math.min(Math.max(opts.scene.physics?.step ?? 1 / 60, 1 / 480), 1 / 10);
    this.rng = createRng(opts.scene.seed ?? 1);
    this.audio = createAudio(opts.scene.audio, opts.resolveAsset, (message, path) => opts.issue({ code: "asset-load", message, path }));
    this.api = this.createApi();
  }

  static async create(opts: GameHostOptions, world: World): Promise<GameHost> {
    const host = new GameHost(opts);
    host.hud = opts.scene.ui?.elements?.length || opts.scene.audio ? createHud(opts.container, opts.scene.ui, (a) => host.emit(a)) : null;
    if (opts.scene.audio && host.hud) {
      const refresh = () => host.hud!.setMuteButton(host.audio.muted(), () => {
        host.audio.unlock();
        host.audio.setMuted(!host.audio.muted());
        refresh();
      });
      refresh();
    }
    if (!opts.deterministic) {
      const unlock = () => host.audio.unlock();
      opts.container.addEventListener("pointerdown", unlock);
      opts.container.addEventListener("keydown", unlock);
      host.unlockListeners = () => {
        opts.container.removeEventListener("pointerdown", unlock);
        opts.container.removeEventListener("keydown", unlock);
      };
    }
    await host.loadScripts();
    await host.attach(world);
    return host;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  private async loadScripts(): Promise<void> {
    const { scene, scriptSources, resolveAsset, issue } = this.opts;
    for (const path of scene.scripts ?? []) {
      const src = scriptSources?.[path];
      const key = src !== undefined ? `src:${path}:${src.length}:${src.slice(0, 64)}` : resolveAsset(path);
      let p = scriptModuleCache.get(key);
      if (!p) {
        p = (async () => {
          let url: string;
          let revoke: string | null = null;
          if (src !== undefined) {
            url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
            revoke = url;
          } else url = resolveAsset(path);
          try {
            const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
            if (typeof mod.default !== "function") throw new Error("the default export must be a function (api) => ({ start, update })");
            return mod.default as ScriptFactory;
          } finally {
            if (revoke) URL.revokeObjectURL(revoke);
          }
        })();
        p.catch(() => scriptModuleCache.delete(key));
        scriptModuleCache.set(key, p);
      }
      try {
        const f = await p;
        if (f) this.factories.push({ path, factory: f });
      } catch (err) {
        issue({ code: "script-error", message: `${path}: ${(err as Error).message}`, path });
      }
    }
  }

  private async attach(world: World): Promise<void> {
    this.world = world;
    this.objCache.clear();
    this.bodyOffsets.clear();
    const g = this.opts.scene.physics?.gravity ?? [0, -9.81, 0];
    this.physics = new PhysicsWorld([g[0], g[1], g[2]]);
    this.physics.onCollision((a, b) => {
      const oa = this.api.get(a.id), ob = this.api.get(b.id);
      if (!oa || !ob) return;
      for (const h of this.collisionHandlers) this.safe(() => h(oa, ob), "onCollision");
    });
    world.scene.updateMatrixWorld(true);
    for (const e of world.entries.values()) {
      this.addBody(e);
      this.addGeneratorBodies(e);
    }
    this.instances = [];
    for (const { path, factory } of this.factories) {
      try {
        this.instances.push({ path, inst: factory(this.api) ?? {}, failed: false });
      } catch (err) {
        this.opts.issue({ code: "script-error", message: `${path}: ${(err as Error).message}`, path });
      }
    }
    for (const s of this.instances) {
      try {
        await s.inst.start?.();
      } catch (err) {
        s.failed = true;
        this.opts.issue({ code: "script-error", message: `${s.path} start(): ${(err as Error).message}`, path: s.path });
      }
    }
    this.hud?.update(this.state, 0);
  }

  private addBody(e: WorldEntry, def?: BodyDef): Body | null {
    const body = def ?? (e.def as ObjectDef).body;
    if (!body || e.kind === "light") return null;
    const o = e.object;
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    const wp = o.getWorldPosition(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    const center = box.isEmpty() ? wp.clone() : box.getCenter(new THREE.Vector3());
    if (body.size) size.set(body.size[0], body.size[1], body.size[2]);
    const shape = body.shape === "sphere" ? "sphere" : "box";
    this.bodyOffsets.set(e.id, center.clone().sub(wp));
    return this.physics.add({
      id: e.id,
      type: body.type,
      shape,
      position: [center.x, center.y, center.z],
      size: [size.x, size.y, size.z],
      radius: body.radius ?? Math.max(size.x, size.y, size.z) / 2,
      velocity: body.velocity,
      mass: body.mass,
      restitution: body.restitution,
      friction: body.friction,
    });
  }

  // Generators that publish local collision boxes (maze walls: userData.bodies
  // [{ min, max }]) get one static body per box, id "<objectId>:body<i>".
  private addGeneratorBodies(e: WorldEntry): void {
    if (e.kind === "light") return;
    const boxes = e.object.userData.bodies as { min: [number, number, number]; max: [number, number, number] }[] | undefined;
    if (!Array.isArray(boxes) || (e.def as ObjectDef).body) return;
    const m = e.object.matrixWorld;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    boxes.forEach((b, i) => {
      box.set(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).applyMatrix4(m);
      box.getSize(size);
      box.getCenter(center);
      this.physics.add({ id: `${e.id}:body${i}`, type: "static", shape: "box", position: [center.x, center.y, center.z], size: [size.x, size.y, size.z] });
    });
  }

  // Sync a body from its object (scripts moved the object).
  private syncBodyFromObject(id: string): void {
    const b = this.physics.get(id);
    const e = this.world.entries.get(id);
    if (!b || !e) return;
    e.object.updateMatrixWorld(true);
    const wp = e.object.getWorldPosition(new THREE.Vector3()).add(this.bodyOffsets.get(id) ?? new THREE.Vector3());
    b.position[0] = wp.x;
    b.position[1] = wp.y;
    b.position[2] = wp.z;
  }

  private syncObjectsFromBodies(): void {
    const tmp = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const b of this.physics.bodies) {
      if (b.type !== "dynamic" && b.type !== "kinematic") continue;
      const e = this.world.entries.get(b.id);
      if (!e) continue;
      tmp.set(b.position[0], b.position[1], b.position[2]).sub(this.bodyOffsets.get(b.id) ?? new THREE.Vector3());
      if (e.object.parent) e.object.parent.worldToLocal(tmp);
      // Visual rolling of dynamic spheres (the engine itself has no angular state).
      const def = (e.def as ObjectDef).body;
      if (b.shape === "sphere" && b.type === "dynamic" && !def?.fixedRotation) {
        const dx = tmp.x - e.object.position.x, dz = tmp.z - e.object.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1e-6 && b.radius > 0) {
          axis.set(dz, 0, -dx).normalize();
          e.object.quaternion.premultiply(q.setFromAxisAngle(axis, dist / b.radius));
          if (e.animated) e.rest.quaternion.copy(e.object.quaternion);
        }
      }
      e.object.position.copy(tmp);
      if (e.animated) e.rest.position.copy(tmp);
    }
  }

  requestRestart(): void {
    this.restartRequested = true;
  }

  get pendingRestart(): boolean {
    return this.restartRequested;
  }

  // Full reset from the initial definition (api.restart() / backwards seek).
  async restart(): Promise<World> {
    this.restartRequested = false;
    for (const s of this.instances) this.safe(() => s.inst.dispose?.(), "dispose");
    for (const k of Object.keys(this.state)) delete this.state[k];
    this.handlers.clear();
    this.collisionHandlers = [];
    this.rng = createRng(this.opts.scene.seed ?? 1);
    this.simTime = 0;
    this.acc = 0;
    this.shake = { intensity: 0, duration: 0, until: 0 };
    const world = await this.opts.rebuild();
    await this.attach(world);
    return world;
  }

  time(): number {
    return this.simTime;
  }

  // Advance the simulation by `dt` of real time (fixed sub-steps).
  advance(dt: number): void {
    const inp = this.opts.input;
    for (const k of inp.pressed) this.pendingPressed.add(k);
    if (inp.pointer.justPressed) this.pendingJust = true;
    if (inp.swipe) this.pendingSwipe = inp.swipe;
    this.acc += Math.min(dt, 0.25);
    let steps = 0;
    while (this.acc >= this.stepDt - 1e-9 && steps < 30) {
      this.fixedStep();
      this.acc -= this.stepDt;
      steps++;
    }
  }

  // Deterministic: run fixed steps until simTime reaches t.
  advanceTo(t: number): void {
    const inp = this.opts.input;
    for (const k of inp.pressed) this.pendingPressed.add(k);
    if (inp.pointer.justPressed) this.pendingJust = true;
    if (inp.swipe) this.pendingSwipe = inp.swipe;
    while (this.simTime + this.stepDt <= t + 1e-9) this.fixedStep();
  }

  private fixedStep(): void {
    this.stepPressed = this.pendingPressed;
    this.pendingPressed = new Set();
    this.stepJust = this.pendingJust;
    this.pendingJust = false;
    this.stepSwipe = this.pendingSwipe;
    this.pendingSwipe = null;
    const dt = this.stepDt;
    this.simTime += dt;
    for (const s of this.instances) {
      if (s.failed || !s.inst.update) continue;
      try {
        s.inst.update(dt, this.simTime);
      } catch (err) {
        s.failed = true;
        this.opts.issue({ code: "script-error", message: `${s.path} update(): ${(err as Error).message}`, path: s.path });
      }
    }
    if (this.physics.bodies.length) {
      this.physics.step(dt);
      this.syncObjectsFromBodies();
    }
    this.stepPressed = new Set();
    this.stepJust = false;
    this.stepSwipe = null;
  }

  // Per rendered frame: camera shake + HUD.
  afterFrame(): void {
    const rig = this.world.rig;
    const now = this.simTime;
    if (now < this.shake.until && this.shake.duration > 0) {
      const k = ((this.shake.until - now) / this.shake.duration) * this.shake.intensity;
      rig.shake.set((this.rng.next() - 0.5) * 2 * k, (this.rng.next() - 0.5) * 2 * k, (this.rng.next() - 0.5) * k);
    } else rig.shake.set(0, 0, 0);
    this.hud?.update(this.state, now);
  }

  emit(event: string, payload?: unknown): void {
    for (const h of this.handlers.get(event) ?? []) this.safe(() => h(payload), `on(${event})`);
    for (const s of this.instances) if (!s.failed && s.inst.onEvent) this.safe(() => s.inst.onEvent!(event, payload), "onEvent");
  }

  private safe(fn: () => void, where: string): void {
    try {
      fn();
    } catch (err) {
      this.opts.issue({ code: "script-error", message: `${where}: ${(err as Error).message}` });
    }
  }

  dispose(): void {
    for (const s of this.instances) this.safe(() => s.inst.dispose?.(), "dispose");
    this.instances = [];
    this.hud?.dispose();
    this.audio.dispose();
    this.unlockListeners?.();
  }

  // ─── ScriptApi ────────────────────────────────────────────────────────

  private wrap(e: WorldEntry): ScriptObject {
    const cached = this.objCache.get(e.id);
    if (cached) return cached;
    const host = this;
    const id = e.id;
    const entry = () => host.world.entries.get(id) ?? e;
    const moved = () => {
      const en = entry();
      if (en.animated) {
        en.rest.position.copy(en.object.position);
        en.rest.quaternion.copy(en.object.quaternion);
        en.rest.scale.copy(en.object.scale);
      }
      host.syncBodyFromObject(id);
    };
    const bodyVel = (): THREE.Vector3 => {
      const b = host.physics.get(id);
      const v = new THREE.Vector3();
      if (b) v.set(b.velocity[0], b.velocity[1], b.velocity[2]);
      return v;
    };
    const velocity: Vec3Like = {
      get x() { return bodyVel().x; },
      set x(v) { const b = host.physics.get(id); if (b) b.velocity[0] = v; },
      get y() { return bodyVel().y; },
      set y(v) { const b = host.physics.get(id); if (b) b.velocity[1] = v; },
      get z() { return bodyVel().z; },
      set z(v) { const b = host.physics.get(id); if (b) b.velocity[2] = v; },
      set(x, y, z) {
        const b = host.physics.get(id);
        if (b) b.velocity = [x, y, z];
      },
    };
    const obj: ScriptObject = {
      id,
      position: vecProxy(() => entry().object.position, 1, moved),
      rotation: vecProxy(() => entry().object.rotation, DEG, moved),
      scale: vecProxy(() => entry().object.scale, 1, moved),
      get visible() {
        return entry().object.visible;
      },
      set visible(v: boolean) {
        const en = entry();
        en.object.visible = v;
        en.rest.visible = v;
      },
      velocity,
      get userData() {
        return entry().object.userData as Record<string, unknown>;
      },
      get tags() {
        return (entry().object.userData.tags as string[]) ?? [];
      },
      setColor(c) {
        const col = toColor(c);
        for (const m of meshMaterials(entry().object)) (m as THREE.MeshStandardMaterial).color?.copy(col);
      },
      setOpacity(o) {
        for (const m of meshMaterials(entry().object)) {
          m.opacity = o;
          if (o < 1 && !m.transparent) {
            m.transparent = true;
            m.needsUpdate = true;
          }
        }
      },
      playAnimation(clip, options) {
        entry().animator?.play(clip, options);
      },
      distanceTo(other) {
        const a = entry().object.getWorldPosition(new THREE.Vector3());
        const oe = host.world.entries.get(other.id);
        if (!oe) return Infinity;
        return a.distanceTo(oe.object.getWorldPosition(new THREE.Vector3()));
      },
      remove() {
        host.physics.remove(id);
        host.world.removeEntry(id);
        host.objCache.delete(id);
      },
    };
    this.objCache.set(id, obj);
    return obj;
  }

  private idOf(x: string | ScriptObject): string {
    return typeof x === "string" ? x : x.id;
  }

  private createApi(): ScriptApi {
    const host = this;
    const inp = () => host.opts.input;
    const cameraObj = {
      id: "camera",
      position: vecProxy(() => host.world.rig.rest.position),
      rotation: vecProxy(() => host.world.camera.rotation, DEG),
      scale: vecProxy(() => host.world.camera.scale),
      visible: true,
      velocity: vecProxy(() => new THREE.Vector3()),
      userData: {},
      tags: [],
      setColor() {},
      setOpacity() {},
      playAnimation() {},
      distanceTo(other: ScriptObject) {
        const oe = host.world.entries.get(other.id);
        return oe ? host.world.camera.position.distanceTo(oe.object.getWorldPosition(new THREE.Vector3())) : Infinity;
      },
      remove() {},
      lookAt(x: number, y: number, z: number) {
        host.world.rig.rest.target.set(x, y, z);
      },
      shake(intensity: number, duration: number) {
        host.shake = { intensity, duration, until: host.simTime + duration };
      },
    };
    const raycaster = new THREE.Raycaster();
    const api: ScriptApi = {
      get: (id) => {
        const e = host.world.entries.get(id);
        return e && e.kind !== "light" ? host.wrap(e) : null;
      },
      findByTag: (tag) => {
        const out: ScriptObject[] = [];
        for (const e of host.world.entries.values()) if (e.kind !== "light" && ((e.object.userData.tags as string[]) ?? []).includes(tag)) out.push(host.wrap(e));
        return out;
      },
      spawn: async (def, parentId) => {
        const parentEntry = parentId ? host.world.entries.get(parentId) : undefined;
        const e = await host.world.addObject(def, parentEntry?.object ?? host.world.scene, parentEntry?.id, new Map());
        if (!e) throw new Error(`spawn(${def.id}) failed`);
        host.world.scene.updateMatrixWorld(true);
        host.addBody(e);
        return host.wrap(e);
      },
      clone: (id, overrides) => {
        const src = host.world.entries.get(id);
        if (!src || src.kind === "light") throw new Error(`clone: unknown object "${id}"`);
        let newId = overrides?.id;
        while (!newId || host.world.entries.has(newId)) newId = `${id}_${++host.cloneCounter}`;
        const object = src.object.clone(true);
        object.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.material) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
          if (o.userData.a3dId) o.userData = { ...o.userData };
        });
        object.userData.a3dId = newId;
        if (overrides?.position) object.position.set(...overrides.position);
        (src.object.parent ?? host.world.scene).add(object);
        const def = { ...(src.def as ObjectDef), id: newId, children: undefined } as ObjectDef;
        const entry: WorldEntry = {
          ...src,
          id: newId,
          def,
          object,
          rest: { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible },
          runners: [],
          animator: undefined,
        };
        host.world.entries.set(newId, entry);
        host.world.scene.updateMatrixWorld(true);
        if (def.body) host.addBody(entry);
        return host.wrap(entry);
      },
      camera: cameraObj as unknown as ScriptApi["camera"],
      time: () => host.simTime,
      random: () => host.rng.next(),
      randomRange: (min, max) => host.rng.range(min, max),
      input: {
        isDown: (code) => inp().keys.has(code),
        pressed: (code) => host.stepPressed.has(code),
        get pointer() {
          const p = inp().pointer;
          return { x: p.x, y: p.y, down: p.down, justPressed: host.stepJust };
        },
        swipe: () => host.stepSwipe,
        pointerWorld: () => {
          const p = inp().pointer;
          raycaster.setFromCamera(new THREE.Vector2(p.x, p.y), host.world.camera);
          const targets: THREE.Object3D[] = [];
          for (const b of host.physics.bodies) {
            const e = host.world.entries.get(b.id);
            if (e) targets.push(e.object);
          }
          const hit = targets.length ? raycaster.intersectObjects(targets, true)[0] : undefined;
          if (hit) {
            const ids = host.world.idsFor(hit.object);
            return { x: hit.point.x, y: hit.point.y, z: hit.point.z, objectId: ids[0] };
          }
          const pt = new THREE.Vector3();
          return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt) ? { x: pt.x, y: pt.y, z: pt.z } : null;
        },
      },
      physics: {
        overlaps: (a, b) => host.physics.overlaps(host.idOf(a), host.idOf(b)),
        contacts: (a) => host.physics.contactsOf(host.idOf(a)).map((b) => api.get(b.id)).filter((x): x is ScriptObject => !!x),
        raycast: (from, dir, maxDistance) => {
          const hit = host.physics.raycast(from as V3, dir as V3, maxDistance ?? Infinity);
          return hit ? { objectId: hit.body.id, distance: hit.distance, point: hit.point } : null;
        },
        applyImpulse: (o, impulse) => host.physics.applyImpulse(host.idOf(o), impulse as V3),
        onCollision: (handler) => void host.collisionHandlers.push(handler),
      },
      state: host.state,
      ui: {
        set: (id, props) => host.hud?.set(id, props),
        toast: (text, seconds) => host.hud?.toast(text, seconds),
      },
      audio: {
        play: (name) => host.audio.play(name),
        music: (on) => host.audio.music(on),
      },
      on: (event, handler) => {
        const list = host.handlers.get(event) ?? [];
        list.push(handler);
        host.handlers.set(event, list);
      },
      emit: (event, payload) => host.emit(event, payload),
      storage: {
        get(key) {
          try {
            const raw = globalThis.localStorage?.getItem(`agent3d:${host.opts.scene.id}:${key}`);
            return raw == null ? undefined : JSON.parse(raw);
          } catch {
            return undefined;
          }
        },
        set(key, value) {
          try {
            globalThis.localStorage?.setItem(`agent3d:${host.opts.scene.id}:${key}`, JSON.stringify(value));
          } catch {
            /* storage unavailable (private mode, sandbox) */
          }
        },
      },
      data: (host.opts.scene.data ?? {}) as Record<string, unknown>,
      restart: () => host.requestRestart(),
      log: (...args) => console.log("[agent3d]", ...args),
    };
    return api;
  }
}
