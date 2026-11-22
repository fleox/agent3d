// Scene graph builder: SceneDoc → a live THREE.Scene ("World") with object
// entries (rest transforms, behaviours), lights, environment, camera rig and
// timeline. `frame(t, dt, …)` evaluates everything for a scene time.

import * as THREE from "three";
import { GENERATORS } from "../../core/catalog";
import type { LightDef, ObjectDef, SceneDoc } from "../../core/types";
import { BEHAVIOUR_IMPLS } from "../behaviours/index";
import { createRunner, type BehaviourRunner } from "../behaviours/runner";
import { createParticles, type ParticleSystem } from "../particles/index";
import { createRng, hashSeed } from "../random";
import type { BehaviourContext, BuiltObject } from "../registry";
import { createTimeline, type TimelineRunner } from "../timeline/index";
import { DEG, disposeObject, toColor, withDefaults } from "../util";
import { createCamera, createRig, setCameraAspect, type CameraRig } from "./camera";
import type { RuntimeContext } from "./context";
import { buildEnvironment, type BuiltEnvironment } from "./environment";
import { buildGeometry } from "./geometry";
import { buildInstances } from "./instances";
import { buildLight, fitShadowCamera } from "./lights";
import { createMaterial, fitGradient } from "./materials";
import type { ModelAnimator } from "./model";

export interface Rest {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
  intensity?: number;
  color?: THREE.Color;
}

export interface WorldEntry {
  id: string;
  kind: ObjectDef["kind"] | "light";
  def: ObjectDef | LightDef;
  object: THREE.Object3D;
  rest: Rest;
  runners: BehaviourRunner[];
  animated: boolean;
  topLevel: boolean;
  parentId?: string;
  built?: BuiltObject;
  animator?: ModelAnimator;
  particles?: ParticleSystem;
  interactive: boolean;
}

export interface FrameInput {
  pointer: { x: number; y: number; inside: boolean };
  scroll: number;
  hovered: Set<string>;
  clicked: Set<string>;
  timelineT: number | null;
}

function captureRest(o: THREE.Object3D): Rest {
  const r: Rest = { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone(), visible: o.visible };
  const l = o as THREE.Light;
  if (l.isLight) {
    r.intensity = l.intensity;
    r.color = l.color.clone();
  }
  return r;
}

function applyTransform(o: THREE.Object3D, def: { position?: number[]; rotation?: number[]; scale?: number | number[] }): void {
  if (def.position) o.position.set(def.position[0] ?? 0, def.position[1] ?? 0, def.position[2] ?? 0);
  if (def.rotation) o.rotation.set((def.rotation[0] ?? 0) * DEG, (def.rotation[1] ?? 0) * DEG, (def.rotation[2] ?? 0) * DEG);
  if (def.scale !== undefined) {
    if (typeof def.scale === "number") o.scale.setScalar(def.scale);
    else o.scale.set(def.scale[0] ?? 1, def.scale[1] ?? 1, def.scale[2] ?? 1);
  }
}

const INTERACTIVE_BEHAVIOURS = new Set(["hoverScale", "hoverLift", "clickBounce", "spinOnClick"]);

export class World {
  readonly scene = new THREE.Scene();
  camera!: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  rig!: CameraRig;
  env: BuiltEnvironment | null = null;
  entries = new Map<string, WorldEntry>();
  timeline: TimelineRunner | null = null;
  // Reduced motion "static": entrance behaviours (`appear`) show their final state.
  settleEntrances = false;
  private updaters: ((t: number, dt: number) => void)[] = [];
  private cameraRest0 = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 };
  private viewportH = 600;
  private input: FrameInput = { pointer: { x: 0, y: 0, inside: false }, scroll: 0, hovered: new Set(), clicked: new Set(), timelineT: null };
  private disposed = false;

  constructor(readonly def: SceneDoc, readonly ctx: RuntimeContext) {
    // Every per-frame updater registered while building (or later, by spawned objects) lands here.
    ctx.onUpdate = (fn) => this.updaters.push(fn);
  }

  static async create(def: SceneDoc, ctx: RuntimeContext, aspect: number, dom: HTMLElement | null, editor = false): Promise<World> {
    const w = new World(def, ctx);
    await w.build(aspect, dom, editor);
    return w;
  }

  private async build(aspect: number, dom: HTMLElement | null, editor: boolean): Promise<void> {
    const { def, ctx } = this;
    {
      this.camera = createCamera(def.camera, aspect);
      this.rig = await createRig(def.camera, this.camera, dom, ctx.deterministic);
      this.cameraRest0.position.copy(this.rig.rest.position);
      this.cameraRest0.target.copy(this.rig.rest.target);
      this.cameraRest0.fov = this.rig.rest.fov;

      const envP = buildEnvironment(def.environment ?? { background: "#ffffff" }, this.scene, this.camera, !!def.target?.transparent, ctx);
      const lightsP = Promise.all((def.lights ?? []).map((l, i) => this.addLight(l, i)));
      const siblings = new Map<string, BuiltObject>();
      // Generators first within a parent so "onTerrain" scatterers find their terrain.
      const objs = def.objects ?? [];
      await Promise.all(objs.filter((o) => o.kind === "generator" && o.generator === "terrain").map((o) => this.addObject(o, this.scene, undefined, siblings)));
      await Promise.all(objs.filter((o) => !(o.kind === "generator" && o.generator === "terrain")).map((o) => this.addObject(o, this.scene, undefined, siblings)));
      // Keep declaration order in the scene graph.
      const order = new Map(objs.map((o, i) => [o.id, i]));
      this.scene.children.sort((a, b) => (order.get(a.userData.a3dId) ?? -1) - (order.get(b.userData.a3dId) ?? -1));

      this.env = await envP;
      for (const o of this.env.objects) this.scene.add(o);
      await lightsP;
      if (editor) {
        const grid = new THREE.GridHelper(20, 20, 0x888888, 0x444444);
        grid.userData.helper = true;
        this.scene.add(grid, Object.assign(new THREE.AxesHelper(1.5), { userData: { helper: true } }));
      }

      if (def.timeline && def.timeline.tracks?.length) {
        this.timeline = createTimeline(def.timeline, {
          object: (id) => this.entries.get(id)?.object ?? null,
          camera: this.rig.rest,
          issue: ctx.issue,
        });
        for (const id of this.timeline.targets) {
          const e = this.entries.get(id);
          if (e) e.animated = true;
        }
      }
      this.fitShadows();
    }
  }

  private rngFor(id: string, seed?: number) {
    return createRng(seed ?? hashSeed(this.def.seed ?? 1, id));
  }

  private behaviourContext(entry: WorldEntry): BehaviourContext {
    const self = this;
    return {
      object: entry.object,
      base: { position: entry.rest.position, rotation: new THREE.Euler().setFromQuaternion(entry.rest.quaternion), scale: entry.rest.scale },
      get pointer() {
        return self.input.pointer;
      },
      hovered: () => self.input.hovered.has(entry.id),
      clicked: () => self.input.clicked.has(entry.id),
      scroll: () => self.input.scroll,
      get camera() {
        return self.camera;
      },
      rng: this.rngFor(entry.id + ":behaviours"),
    };
  }

  private attachBehaviours(entry: WorldEntry): void {
    const defs = entry.def.behaviours ?? [];
    entry.runners = [];
    for (const b of defs) {
      const impl = BEHAVIOUR_IMPLS[b.type];
      if (!impl) {
        this.ctx.issue("unknown-catalog-id", `Unknown behaviour "${b.type}"`, `objects#${entry.id}.behaviours`);
        continue;
      }
      entry.runners.push(createRunner(b, impl, this.behaviourContext(entry), { settled: () => this.settleEntrances }));
      if (INTERACTIVE_BEHAVIOURS.has(b.type) || b.when === "hover" || b.when === "click") entry.interactive = true;
    }
    if (entry.runners.length) entry.animated = true;
  }

  // Recreate behaviour state (deterministic rewind).
  resetBehaviours(): void {
    for (const e of this.entries.values()) {
      for (const r of e.runners) r.dispose();
      if (e.def.behaviours?.length) this.attachBehaviours(e);
      e.animator?.mixer.setTime(0);
    }
  }

  private async addLight(def: LightDef, index: number): Promise<void> {
    const light = await buildLight(def);
    const id = def.id ?? `light${index}`;
    this.scene.add(light);
    if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) this.scene.add(light.target);
    light.userData.a3dId = id;
    const entry: WorldEntry = { id, kind: "light", def, object: light, rest: captureRest(light), runners: [], animated: false, topLevel: false, interactive: false };
    this.entries.set(id, entry);
    this.attachBehaviours(entry);
  }

  async addObject(def: ObjectDef, parent: THREE.Object3D, parentId: string | undefined, siblings: Map<string, BuiltObject>): Promise<WorldEntry | null> {
    const ctx = this.ctx;
    let object: THREE.Object3D;
    let built: BuiltObject | undefined;
    let animator: ModelAnimator | undefined;
    let particles: ParticleSystem | undefined;
    const shadowDefault = def.kind !== "particles" && def.kind !== "generator";
    try {
      switch (def.kind) {
        case "mesh": {
          const geo = buildGeometry(def.geometry);
          const mat = await createMaterial(def.material, ctx, { defaultColor: "#dddddd" });
          fitGradient(mat, geo);
          object = new THREE.Mesh(geo, mat);
          break;
        }
        case "text": {
          const { buildTextGeometry } = await import("./text");
          const mat = await createMaterial(def.material, ctx, { defaultColor: "#ffffff" });
          const geo = await ctx.track(buildTextGeometry(def, ctx));
          fitGradient(mat, geo);
          object = new THREE.Mesh(geo, mat);
          break;
        }
        case "svg": {
          const { buildSvg } = await import("./svg");
          object = await ctx.track(buildSvg(def, ctx));
          break;
        }
        case "model": {
          const { buildModel } = await import("./model");
          const res = await ctx.track(buildModel(def, ctx));
          object = res.object;
          animator = res.animator;
          break;
        }
        case "instances": {
          const geo = buildGeometry(def.geometry);
          const mat = await createMaterial(def.material, ctx, { defaultColor: def.colors?.length ? "#ffffff" : "#dddddd" });
          fitGradient(mat, geo);
          object = buildInstances(def, geo, mat, this.rngFor(def.id, (def.layout as { seed?: number }).seed), (c) => toColor(c));
          break;
        }
        case "particles": {
          particles = createParticles(def, this.rngFor(def.id, def.seed));
          particles.setViewport(this.viewportH);
          object = particles.points;
          const ps = particles;
          this.updaters.push((t) => ps.update(t));
          break;
        }
        case "generator": {
          const impls = await ctx.generators();
          const impl = impls[def.generator];
          if (!impl) {
            ctx.issue("unknown-catalog-id", `Unknown generator "${def.generator}"`, `objects#${def.id}.generator`);
            object = new THREE.Group();
            break;
          }
          const entry = GENERATORS.find((g) => g.id === def.generator);
          const params = withDefaults(entry, def.params ?? {});
          const bctx = { ...ctx, siblings, rng: this.rngFor(def.id, def.seed) };
          built = await ctx.track(Promise.resolve(impl(params, bctx)));
          object = built.object;
          if (built.update) {
            const up = built.update.bind(built);
            this.updaters.push((t, dt) => up(t, dt));
          }
          siblings.set(def.id, built);
          break;
        }
        default:
          object = new THREE.Group();
      }
    } catch (err) {
      ctx.issue(def.kind === "model" || def.kind === "text" || def.kind === "svg" ? "asset-load" : "build-error", `${def.id}: ${(err as Error).message}`, `objects#${def.id}`);
      object = new THREE.Group();
    }
    if (this.disposed) return null;

    object.name = def.name ?? def.id;
    object.userData = { ...(def.userData ?? {}), ...object.userData, a3dId: def.id, tags: def.tags ?? [] };
    applyTransform(object, def);
    if (def.visible === false) object.visible = false;
    const cast = def.castShadow ?? (shadowDefault ? true : undefined);
    const receive = def.receiveShadow ?? (shadowDefault ? true : undefined);
    if (cast !== undefined || receive !== undefined) {
      object.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          if (cast !== undefined) o.castShadow = cast;
          if (receive !== undefined) o.receiveShadow = receive;
        }
      });
    }
    parent.add(object);

    const entry: WorldEntry = {
      id: def.id,
      kind: def.kind,
      def,
      object,
      rest: captureRest(object),
      runners: [],
      animated: false,
      topLevel: parent === this.scene,
      parentId,
      built,
      animator,
      particles,
      interactive: !!def.href,
    };
    this.entries.set(def.id, entry);
    this.attachBehaviours(entry);
    if (def.children?.length) {
      const sib = new Map<string, BuiltObject>();
      const kids = def.children;
      await Promise.all(kids.filter((k) => k.kind === "generator" && k.generator === "terrain").map((k) => this.addObject(k, object, def.id, sib)));
      await Promise.all(kids.filter((k) => !(k.kind === "generator" && k.generator === "terrain")).map((k) => this.addObject(k, object, def.id, sib)));
    }
    return entry;
  }

  removeEntry(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.object.traverse((o) => {
      const cid = o.userData.a3dId as string | undefined;
      if (cid && cid !== id) this.entries.delete(cid);
    });
    e.object.removeFromParent();
    for (const r of e.runners) r.dispose();
    this.entries.delete(id);
  }

  // Ids of every entry on the ancestor chain of a hit object.
  idsFor(obj: THREE.Object3D | null): string[] {
    const out: string[] = [];
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      const id = o.userData?.a3dId as string | undefined;
      if (id && this.entries.has(id)) out.push(id);
    }
    return out;
  }

  interactiveRoots(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const e of this.entries.values()) if (e.interactive && e.kind !== "light") out.push(e.object);
    return out;
  }

  fitShadows(): void {
    const lights: THREE.DirectionalLight[] = [];
    this.scene.traverse((o) => {
      if (o instanceof THREE.DirectionalLight && o.castShadow) lights.push(o);
    });
    if (!lights.length) return;
    const bounds = new THREE.Box3();
    const tmp = new THREE.Box3();
    this.scene.updateMatrixWorld(true);
    for (const e of this.entries.values()) {
      if (!e.topLevel || e.kind === "particles") continue;
      tmp.setFromObject(e.object);
      if (tmp.isEmpty()) continue;
      if (tmp.getSize(new THREE.Vector3()).length() > 200) continue;
      bounds.union(tmp);
    }
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-5, -1, -5), new THREE.Vector3(5, 5, 5));
    const gy = this.env?.ground ? this.env.ground.position.y : bounds.min.y;
    bounds.expandByPoint(new THREE.Vector3(bounds.min.x, gy, bounds.min.z));
    bounds.expandByPoint(new THREE.Vector3(bounds.max.x, gy, bounds.max.z));
    bounds.expandByScalar(0.3);
    for (const l of lights) fitShadowCamera(l, bounds);
  }

  setViewport(width: number, height: number, pixelRatio: number): void {
    this.viewportH = height * pixelRatio;
    const m = /^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/.exec(this.def.target?.aspect ?? "");
    const design = m ? Number(m[1]) / Number(m[2]) : undefined;
    setCameraAspect(this.camera, this.def.camera, width / Math.max(height, 1), design && Number.isFinite(design) && design > 0 ? design : undefined);
    for (const e of this.entries.values()) e.particles?.setViewport(this.viewportH);
  }

  frame(t: number, dt: number, input: FrameInput, followTarget?: THREE.Object3D | null): void {
    this.input = input;
    // 1. Reset animated objects to their rest transform.
    for (const e of this.entries.values()) {
      if (!e.animated) continue;
      const o = e.object;
      o.position.copy(e.rest.position);
      o.quaternion.copy(e.rest.quaternion);
      o.scale.copy(e.rest.scale);
      o.visible = e.rest.visible;
      const l = o as THREE.Light;
      if (l.isLight && e.rest.intensity !== undefined) {
        l.intensity = e.rest.intensity;
        if (e.rest.color && !this.timeline?.targets.has(e.id)) l.color.copy(e.rest.color);
      }
    }
    // 2. Timeline (absolute values), 3. behaviours (offsets).
    if (this.timeline && input.timelineT !== null) {
      if (this.timeline.def.tracks.some((tr) => tr.target.startsWith("camera."))) {
        this.rig.rest.position.copy(this.cameraRest0.position);
        this.rig.rest.target.copy(this.cameraRest0.target);
        this.rig.rest.fov = this.cameraRest0.fov;
      }
      this.timeline.apply(input.timelineT);
    }
    for (const e of this.entries.values()) for (const r of e.runners) r.step(t, dt);
    // 4. Time-driven content.
    for (const u of this.updaters) u(t, dt);
    for (const e of this.entries.values()) e.animator?.mixer.update(dt);
    // 5. Camera.
    this.rig.update(t, dt, { pointer: input.pointer, scroll: input.scroll, followTarget });
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) {
      for (const r of e.runners) r.dispose();
      e.built?.dispose?.();
    }
    this.rig?.dispose();
    this.env?.dispose();
    disposeObject(this.scene);
    const env = this.scene.environment;
    if (env) env.dispose();
    this.entries.clear();
  }
}
