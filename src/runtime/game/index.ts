// Script host (loaded lazily when a scene has scripts, ui, physics or bodies):
// implements ScriptApi (src/runtime/api.ts) over the World, runs scripts at a
// fixed step (scene.physics.step, default 1/60) together with the rigid-body
// physics (physicsHost.ts + cannon-es, its own lazy chunk loaded only when the
// scene has bodies or joints), drives the HUD, audio, storage and events.

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
import type { ContactInfo, V3 } from "./physics";
import type { PhysicsBridge } from "./physicsHost";

let physicsModule: Promise<typeof import("./physicsHost")> | null = null;
const loadPhysics = () => (physicsModule ??= import("./physicsHost"));

type ContactHandler = (a: ScriptObject, b: ScriptObject, info: ContactInfo) => void;
type PairHandler = (a: ScriptObject, b: ScriptObject) => void;

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
  physics: PhysicsBridge | null = null;
  state: Record<string, unknown> = {};
  hud: Hud | null = null;
  audio: AudioBridge;
  private instances: { path: string; inst: ScriptInstance; failed: boolean }[] = [];
  private factories: { path: string; factory: ScriptFactory }[] = [];
  private objCache = new Map<string, ScriptObject>();
  private handlers = new Map<string, ((p?: unknown) => void)[]>();
  private collisionHandlers: ContactHandler[] = [];
  private collisionEndHandlers: PairHandler[] = [];
  private triggerEnterHandlers: PairHandler[] = [];
  private triggerExitHandlers: PairHandler[] = [];
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
    this.physics?.dispose();
    this.physics = null;
    world.scene.updateMatrixWorld(true);
    if (this.needsPhysics(world)) await this.ensurePhysics();
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

  private needsPhysics(world: World): boolean {
    if (this.opts.scene.physics?.joints?.length) return true;
    for (const e of world.entries.values()) if (e.kind !== "light" && ((e.def as ObjectDef).body || Array.isArray(e.object.userData.bodies))) return true;
    return false;
  }

  // Loads the physics chunk (cannon-es) and builds every body + joint.
  private async ensurePhysics(): Promise<PhysicsBridge> {
    if (this.physics) return this.physics;
    const { PhysicsBridge } = await loadPhysics();
    const bridge = new PhysicsBridge(this.opts.scene.physics, this.world, (i) => this.opts.issue(i));
    bridge.engine.onCollision((a, b, info) => this.dispatchContact(a.id, b.id, info));
    bridge.engine.onCollisionEnd((a, b) => this.dispatchContact(a.id, b.id, null));
    this.physics = bridge;
    bridge.attachAll();
    return bridge;
  }

  private dispatchContact(aId: string, bId: string, info: ContactInfo | null): void {
    const oa = this.api.get(aId), ob = this.api.get(bId);
    if (!oa || !ob || !this.physics) return;
    const ta = this.physics.engine.get(aId)?.type === "trigger";
    const tb = this.physics.engine.get(bId)?.type === "trigger";
    if (info) {
      for (const h of this.collisionHandlers) this.safe(() => h(oa, ob, info), "onCollision");
      for (const h of this.triggerEnterHandlers) {
        if (ta) this.safe(() => h(oa, ob), "onTriggerEnter");
        if (tb) this.safe(() => h(ob, oa), "onTriggerEnter");
      }
    } else {
      for (const h of this.collisionEndHandlers) this.safe(() => h(oa, ob), "onCollisionEnd");
      for (const h of this.triggerExitHandlers) {
        if (ta) this.safe(() => h(oa, ob), "onTriggerExit");
        if (tb) this.safe(() => h(ob, oa), "onTriggerExit");
      }
    }
  }

  // Bodies of a freshly added subtree (spawn / clone).
  private async addBodies(e: WorldEntry, def?: BodyDef): Promise<void> {
    const ids: string[] = [];
    e.object.traverse((o) => {
      const id = o.userData.a3dId as string | undefined;
      if (id && !ids.includes(id)) ids.push(id);
    });
    const entries = ids.map((id) => this.world.entries.get(id)).filter((x): x is WorldEntry => !!x);
    const wanted = entries.filter((x) => (x === e && def) || (x.def as ObjectDef).body);
    if (!wanted.length) return;
    const bridge = await this.ensurePhysics();
    for (const x of wanted) if (!bridge.has(x.id)) bridge.addEntry(x, x === e ? def : undefined);
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
    this.collisionEndHandlers = [];
    this.triggerEnterHandlers = [];
    this.triggerExitHandlers = [];
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
    this.physics?.step(dt);
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
    this.physics?.dispose();
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
      host.physics?.moved(id);
    };
    const vel = (): V3 => host.physics?.engine.get(id)?.velocity ?? [0, 0, 0];
    const setVel = (i: number, x: number) => {
      const v = vel();
      v[i] = x;
      host.physics?.engine.setVelocity(id, v);
    };
    const velocity: Vec3Like = {
      get x() { return vel()[0]; },
      set x(v) { setVel(0, v); },
      get y() { return vel()[1]; },
      set y(v) { setVel(1, v); },
      get z() { return vel()[2]; },
      set z(v) { setVel(2, v); },
      set(x, y, z) {
        host.physics?.engine.setVelocity(id, [x, y, z]);
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
        const en = host.world.entries.get(id);
        en?.object.traverse((o) => {
          const cid = o.userData.a3dId as string | undefined;
          if (cid) host.physics?.remove(cid);
        });
        host.physics?.remove(id);
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
        await host.addBodies(e);
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
        if (def.body && host.physics) host.physics.addEntry(entry);
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
          for (const b of host.physics?.engine.bodies ?? []) {
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
        overlaps: (a, b) => host.physics?.engine.overlaps(host.idOf(a), host.idOf(b)) ?? false,
        contacts: (a) => (host.physics?.engine.contactsOf(host.idOf(a)) ?? []).map((b) => api.get(b.id)).filter((x): x is ScriptObject => !!x),
        raycast: (from, dir, maxDistance, options) => {
          const eng = host.physics?.engine;
          if (!eng) return null;
          const ignore = new Set((options?.ignore ?? []).map((x) => host.idOf(x)));
          const hit = eng.raycast(from as V3, dir as V3, maxDistance ?? Infinity, {
            ignore: ignore.size ? (b) => ignore.has(b.id) : undefined,
            mask: options?.layers ? eng.layerMask(options.layers) : undefined,
            triggers: options?.triggers,
          });
          return hit ? { objectId: hit.body.id, distance: hit.distance, point: hit.point, normal: hit.normal } : null;
        },
        applyImpulse: (o, impulse, point) => host.physics?.engine.applyImpulse(host.idOf(o), impulse as V3, point as V3 | undefined),
        applyForce: (o, force, point) => host.physics?.engine.applyForce(host.idOf(o), force as V3, point as V3 | undefined),
        applyTorque: (o, torque) => host.physics?.engine.applyTorque(host.idOf(o), torque as V3),
        setVelocity: (o, v) => host.physics?.engine.setVelocity(host.idOf(o), v as V3),
        getVelocity: (o) => host.physics?.engine.get(host.idOf(o))?.velocity ?? [0, 0, 0],
        setAngularVelocity: (o, w) => host.physics?.engine.setAngularVelocity(host.idOf(o), [w[0] * DEG, w[1] * DEG, w[2] * DEG]),
        getAngularVelocity: (o) => {
          const w = host.physics?.engine.get(host.idOf(o))?.angularVelocity ?? [0, 0, 0];
          return [w[0] / DEG, w[1] / DEG, w[2] / DEG];
        },
        grounded: (o) => host.physics?.engine.grounded(host.idOf(o)) ?? false,
        moveCharacter: (o, move, options) => {
          const m: [number, number] = Array.isArray(move) ? [move[0], move[1]] : [move.x, move.z];
          host.physics?.engine.moveCharacter(host.idOf(o), m, options);
        },
        jump: (o, speed) => host.physics?.engine.jump(host.idOf(o), speed) ?? false,
        wake: (o) => host.physics?.engine.wake(host.idOf(o)),
        setMotorSpeed: (jointId, speed) => host.physics?.engine.setMotorSpeed(jointId, speed * DEG),
        onCollision: (handler) => void host.collisionHandlers.push(handler),
        onCollisionEnd: (handler) => void host.collisionEndHandlers.push(handler),
        onTriggerEnter: (handler) => void host.triggerEnterHandlers.push(handler),
        onTriggerExit: (handler) => void host.triggerExitHandlers.push(handler),
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
