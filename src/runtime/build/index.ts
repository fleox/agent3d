// Scene graph builder: SceneDoc → a live THREE.Scene ("World") with object
// entries (rest transforms, behaviours), lights, environment, camera rig and
// timeline. `frame(t, dt, …)` evaluates everything for a scene time.

import * as THREE from "three";
import { expandPostFx } from "../../core/postfx";
import { GENERATORS } from "../../core/catalog";
import type { LightDef, MaterialDef, ObjectDef, SceneDoc } from "../../core/types";
import { BEHAVIOUR_IMPLS } from "../behaviours/index";
import { createRunner, type BehaviourRunner } from "../behaviours/runner";
import { createParticles, type ParticleSystem } from "../particles/index";
import { createRng, hashSeed } from "../random";
import type { BehaviourContext, BuiltObject } from "../registry";
import { createTimeline, selectIds, type TimelineHost, type TimelineRunner } from "../timeline/index";
import { PropertyOverrides } from "../timeline/overrides";
import { evaluateShots, sortShots } from "../timeline/shots";
import { DEG, disposeObject, toColor, withDefaults } from "../util";
import { createCamera, createRig, setCameraAspect, type CameraRig } from "./camera";
import type { RuntimeContext } from "./context";
import { buildEnvironment, type BuiltEnvironment } from "./environment";
import { buildGeometry } from "./geometry";
import { buildInstances } from "./instances";
import { buildLight, fitShadowCamera } from "./lights";
import { createMaterial, fitGradient, resolveMaterialDef } from "./materials";
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
  private cameraRest0 = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45, zoom: 10, focus: undefined as number | undefined };
  // Motion: property overrides from interactions, camera shots, post effect params.
  motionHost!: TimelineHost;
  overrides!: PropertyOverrides;
  private shots: NonNullable<SceneDoc["camera"]["shots"]> = [];
  private focusWritten = false;
  // Set by the player: live post effect params (postfx.<type>.<param> tracks, rack focus).
  postfxParam: ((type: string, param: string, value: unknown) => void) | null = null;
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
      this.cameraRest0.zoom = this.rig.rest.zoom;
      const dof = def.postfx?.find((f) => f.type === "dof");
      this.cameraRest0.focus = dof && typeof dof.focus === "number" ? dof.focus : dof ? 8 : undefined;
      this.rig.rest.focus = this.cameraRest0.focus;

      const envP = buildEnvironment(def.environment ?? { background: "#ffffff" }, this.scene, this.camera, !!def.target?.transparent, ctx);
      const lightsP = Promise.all((def.lights ?? []).map((l, i) => this.addLight(l, i)));
      const siblings = new Map<string, BuiltObject>();
      // Generators first within a parent so "onTerrain" scatterers find their terrain.
      const objs = def.objects ?? [];
      // attach: "camera" → the object is a child of the camera (camera-space
      // transform); the camera then joins the scene graph so it renders.
      const rootFor = (o: ObjectDef): THREE.Object3D => (o.attach === "camera" ? this.camera : this.scene);
      if (objs.some((o) => o.attach === "camera")) this.scene.add(this.camera);
      await Promise.all(objs.filter((o) => o.kind === "generator" && o.generator === "terrain").map((o) => this.addObject(o, rootFor(o), undefined, siblings)));
      declarationOrder(siblings, objs);
      await Promise.all(objs.filter((o) => !(o.kind === "generator" && o.generator === "terrain")).map((o) => this.addObject(o, rootFor(o), undefined, siblings)));
      // Keep declaration order in the scene graph.
      const order = new Map(objs.map((o, i) => [o.id, i]));
      this.scene.children.sort((a, b) => (order.get(a.userData.a3dId) ?? -1) - (order.get(b.userData.a3dId) ?? -1));

      this.env = await envP;
      for (const o of this.env.objects) this.scene.add(o);
      await lightsP;
      this.canonicalOrder(def);
      if (editor) {
        const grid = new THREE.GridHelper(20, 20, 0x888888, 0x444444);
        grid.userData.helper = true;
        this.scene.add(grid, Object.assign(new THREE.AxesHelper(1.5), { userData: { helper: true } }));
      }

      this.motionHost = {
        object: (id) => this.entries.get(id)?.object ?? null,
        select: (sel) => this.select(sel),
        camera: this.rig.rest,
        scene: this.scene,
        renderer: ctx.renderer,
        postfx: {
          set: (type, param, value) => this.postfxParam?.(type, param, value),
          base: (type, param) => {
            // Looks expanded: a track may animate an effect a `look` preset brings.
            const fx = expandPostFx(def.postfx).find((f) => f.type === type);
            const v = fx?.[param];
            return typeof v === "number" || typeof v === "string" ? v : undefined;
          },
        },
        clips: (id) => this.entries.get(id)?.animator?.control,
        issue: ctx.issue,
        seed: def.seed ?? 1,
      };
      this.overrides = new PropertyOverrides(this.motionHost);
      this.shots = sortShots(def.camera?.shots);
      if (def.timeline) {
        this.timeline = createTimeline(def.timeline, this.motionHost);
        for (const id of this.timeline.targets) {
          const e = this.entries.get(id);
          if (e) e.animated = true;
        }
      }
      // Interaction targets are pickable (pointer cursor); `set` targets reset each frame.
      for (const it of def.interactions ?? []) {
        if (it.target && (it.on === "click" || it.on === "hover" || it.on === "hoverEnd")) {
          const e = this.entries.get(it.target);
          if (e) e.interactive = true;
        }
        for (const a of it.do ?? []) {
          const path = (a as { set?: { path?: unknown } }).set?.path;
          if (typeof path !== "string") continue;
          for (const id of this.overrides.idsOf(path)) {
            const e = this.entries.get(id);
            if (e) e.animated = true;
          }
        }
      }
      this.fitShadows();
    }
  }

  // Objects and lights build concurrently (models, fonts, textures load in
  // parallel), so `entries` and nested scene-graph children are first filled in
  // load-completion order — which varies run to run. Everything that iterates
  // them (findByTag, physics body creation and solver order, behaviours, the
  // render list) must see declaration order or deterministic renders diverge
  // (e.g. a script indexing findByTag() results). Reorder both: lights, then
  // objects depth-first as declared (text letters right after their owner);
  // entries not in the document keep their relative order at the end.
  private canonicalOrder(def: SceneDoc): void {
    const old = this.entries;
    const next = new Map<string, WorldEntry>();
    const put = (id: string) => {
      const e = old.get(id);
      if (e && !next.has(id)) next.set(id, e);
    };
    (def.lights ?? []).forEach((l, i) => put(l.id ?? `light${i}`));
    const walk = (objs: ObjectDef[]) => {
      for (const o of objs) {
        put(o.id);
        const prefix = `${o.id}/`;
        for (const id of old.keys()) if (id.startsWith(prefix) && old.get(id)!.parentId === o.id) put(id);
        if (!o.children?.length) continue;
        const parent = old.get(o.id)?.object;
        if (parent) {
          const order = new Map(o.children.map((c, i) => [c.id, i]));
          parent.children.sort((a, b) => (order.get(a.userData.a3dId) ?? -1) - (order.get(b.userData.a3dId) ?? -1));
        }
        walk(o.children);
      }
    };
    walk(def.objects ?? []);
    for (const [id, e] of old) if (!next.has(id)) next.set(id, e);
    this.entries = next;
  }

  // object.material on a generator (catalog entry with `material`): replaces
  // the material of its meshes tagged userData.materialTarget. A lit material
  // without colour / map keeps the generator's vertex colours (palettes, ramps).
  private async overrideGeneratorMaterial(root: THREE.Object3D, def: MaterialDef, ctx: RuntimeContext): Promise<void> {
    const r = resolveMaterialDef(def);
    const keepColors = r.type !== "shader" && r.type !== "normal" && r.type !== "gradient" && !r.color && !r.map;
    const mat = await createMaterial(def, ctx, { vertexColors: keepColors });
    const targets: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.materialTarget) targets.push(o as THREE.Mesh);
    });
    for (const m of targets) {
      (m.material as THREE.Material).dispose();
      m.material = mat;
      fitGradient(mat, m.geometry);
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
      find: (id) => (id === "camera" ? self.camera : self.entries.get(id)?.object ?? null),
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
      if (e.animator?.reset) e.animator.reset();
      else e.animator?.mixer.setTime(0);
    }
    this.overrides?.reset();
  }

  private async addLight(def: LightDef, index: number): Promise<void> {
    const light = await buildLight(def, this.def.environment?.shadows);
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
    let textLetters: import("./text").TextLetter[] = [];
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
          // Single mesh, or a group of letters "<id>/<n>" (splitLetters / reveal), registered below.
          const { buildText } = await import("./text");
          const res = await ctx.track(buildText(def, ctx));
          object = res.object;
          textLetters = res.letters;
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
          const sc = def.scale;
          const placement = { position: [...(def.position ?? [0, 0, 0])] as [number, number, number], scale: (typeof sc === "number" ? [sc, sc, sc] : sc ? [...sc] : [1, 1, 1]) as [number, number, number] };
          const bctx = { ...ctx, siblings, rng: this.rngFor(def.id, def.seed), placement };
          built = await ctx.track(Promise.resolve(impl(params, bctx)));
          object = built.object;
          if (built.update) {
            const up = built.update.bind(built);
            this.updaters.push((t, dt) => up(t, dt));
          }
          siblings.set(def.id, built);
          if (def.material && entry?.material) await this.overrideGeneratorMaterial(object, def.material, ctx);
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
      topLevel: parent === this.scene || (parent === this.camera && !parentId),
      parentId,
      built,
      animator,
      particles,
      interactive: !!def.href,
    };
    this.entries.set(def.id, entry);
    this.attachBehaviours(entry);
    // Text letters: timeline targets "<id>/<n>"; a text `reveal` runs as a per-letter entrance behaviour.
    for (const l of textLetters) {
      const le: WorldEntry = { id: l.id, kind: "text", def: l.def, object: l.object, rest: captureRest(l.object), runners: [], animated: true, topLevel: false, parentId: def.id, interactive: false };
      if (l.reveal) le.runners.push(createRunner(l.reveal.def, l.reveal.impl, this.behaviourContext(le), { settled: () => this.settleEntrances }));
      this.entries.set(l.id, le);
    }
    if (def.children?.length) {
      const sib = new Map<string, BuiltObject>();
      const kids = def.children;
      await Promise.all(kids.filter((k) => k.kind === "generator" && k.generator === "terrain").map((k) => this.addObject(k, object, def.id, sib)));
      declarationOrder(sib, kids);
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

  // Ids for a multi-target selector: "tag:<tag>" (scene order), "children:<id>"
  // (direct children, incl. text letters), "a,b,c".
  select(selector: string): string[] {
    if (selector.startsWith("tag:")) {
      const tag = selector.slice(4);
      const out: string[] = [];
      const walk = (objs: ObjectDef[] | undefined) => {
        for (const o of objs ?? []) {
          if (o.tags?.includes(tag) && this.entries.has(o.id)) out.push(o.id);
          walk(o.children);
        }
      };
      walk(this.def.objects);
      return out;
    }
    if (selector.startsWith("children:")) {
      const id = selector.slice(9);
      return [...this.entries.values()].filter((e) => e.parentId === id).map((e) => e.id);
    }
    return selectIds(selector, { object: () => null, camera: null, issue: () => undefined }).filter((id) => id !== "");
  }

  // World position of an entry (camera lookAt / shots).
  objectPosition(id: string): THREE.Vector3 | null {
    const e = this.entries.get(id);
    return e ? e.object.getWorldPosition(new THREE.Vector3()) : null;
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
      if (!e.topLevel || e.kind === "particles" || (e.def as ObjectDef).attach === "camera") continue;
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
    // 2. Camera shots + timeline (absolute values), interaction overrides, 3. behaviours (offsets).
    const shotT = this.def.timeline ? input.timelineT ?? 0 : t;
    if (this.shots.length || this.timeline?.animatesCamera) {
      const rest = this.rig.rest;
      rest.position.copy(this.cameraRest0.position);
      rest.target.copy(this.cameraRest0.target);
      rest.fov = this.cameraRest0.fov;
      rest.zoom = this.cameraRest0.zoom;
      rest.focus = this.cameraRest0.focus;
      if (this.shots.length) {
        const pose = evaluateShots(this.shots, shotT, rest, { objectPosition: (id) => this.objectPosition(id) });
        rest.position.copy(pose.position);
        rest.target.copy(pose.target);
        rest.fov = pose.fov;
        rest.focus = pose.focus;
      }
    }
    if (this.timeline && input.timelineT !== null) this.timeline.apply(input.timelineT);
    this.overrides?.apply(t);
    if (this.rig.rest.focus !== undefined && (this.focusWritten || this.rig.rest.focus !== this.cameraRest0.focus)) {
      this.postfxParam?.("dof", "focus", this.rig.rest.focus);
      this.focusWritten = true;
    }
    for (const e of this.entries.values()) for (const r of e.runners) if (!r.late) r.step(t, dt);
    // 4. Time-driven content (+ pointer-aware generators: character eyes, waveGrid ripple).
    for (const e of this.entries.values()) {
      const holder = e.object.userData.setPointer ? e.object : e.object.children[0];
      const hook = holder?.userData.setPointer as ((x: number, y: number) => void) | undefined;
      if (!hook) continue;
      hook(input.pointer.x, input.pointer.y);
      // Surfaces (waveGrid) want the point under the cursor: ray ∩ their local y = 0 plane.
      const local = holder.userData.setPointerLocal as ((x: number, z: number) => void) | undefined;
      if (local && this.camera) {
        const hit = this.pointerOnPlane(holder, input.pointer.x, input.pointer.y);
        if (hit) local(hit.x, hit.z);
      }
    }
    for (const u of this.updaters) u(t, dt);
    for (const e of this.entries.values()) e.animator?.mixer.update(dt);
    // 5. Camera.
    const lookAtId = this.def.camera?.lookAt;
    this.rig.update(t, dt, { pointer: input.pointer, scroll: input.scroll, followTarget, lookAt: lookAtId ? this.objectPosition(lookAtId) : null });
    // 6. Camera-facing behaviours (billboard, lookAt) read this frame's camera pose.
    this.camera.updateMatrixWorld();
    for (const e of this.entries.values()) for (const r of e.runners) if (r.late) r.step(t, dt);
  }

  // True when some motion state depends on how time was split into frames
  // (see STATEFUL_BEHAVIOURS; camera follow smoothing): deterministic seeks
  // then advance on a fixed time grid.
  hasStatefulMotion(): boolean {
    if (this.def.camera?.controls === "follow" && this.def.camera.follow) return true;
    for (const e of this.entries.values()) for (const r of e.runners) if (r.stateful) return true;
    return false;
  }

  private pointerRay = new THREE.Raycaster();
  // Pointer (NDC, y up) ray hit on `obj`'s local y = 0 plane, in its local frame.
  private pointerOnPlane(obj: THREE.Object3D, x: number, y: number): THREE.Vector3 | null {
    obj.updateWorldMatrix(true, false);
    this.camera.updateMatrixWorld();
    this.pointerRay.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const inv = obj.matrixWorld.clone().invert();
    const ray = this.pointerRay.ray.clone().applyMatrix4(inv);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const k = -ray.origin.y / ray.direction.y;
    if (k < 0) return null;
    return ray.origin.addScaledVector(ray.direction, k);
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
    // Gradient / HDRI backgrounds are textures too (no leak on player.update / setData).
    const bg = this.scene.background as THREE.Texture | null;
    if (bg && (bg as THREE.Texture).isTexture) bg.dispose();
    // Shadow maps are render targets owned by the lights.
    this.scene.traverse((o) => (o as THREE.DirectionalLight).shadow?.dispose?.());
    this.entries.clear();
  }
}

// Terrains build in parallel: their sibling map (what "onTerrain" scatterers
// search) must not depend on which one finished first.
function declarationOrder(siblings: Map<string, BuiltObject>, defs: ObjectDef[]): void {
  const entries = [...siblings.entries()];
  const order = new Map(defs.map((d, i) => [d.id, i]));
  entries.sort((a, b) => (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity));
  siblings.clear();
  for (const [k, v] of entries) siblings.set(k, v);
}
