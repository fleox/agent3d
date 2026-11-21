// Player: renderer, clock, resize, lazy start / off-screen pause, reduced
// motion, deterministic seek, stats / inspect / snapshot, input simulation.
// mountScene(container, scene, options) is the public entry (api.ts).

import * as THREE from "three";
import type { SceneDoc } from "../core/types";
import type { FrameStats, InspectResult, MountOptions, Player, RuntimeIssue } from "./api";
import { createResolver } from "./assets";
import { loadGenerators, loadShaders, type RuntimeContext } from "./build/context";
import { World, type FrameInput } from "./build/index";
import type { GameHost } from "./game/index";
import { bindInput, createInputState, endFrame, scrollProgress, setKey, type InputBinding } from "./input";
import type { PostFxPipeline } from "./postfx/index";
import { createRng } from "./random";
import { timelineTime } from "./timeline/sample";
import { toColor } from "./util";

const TONE_MAPPING: Record<string, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  reinhard: THREE.ReinhardToneMapping,
};

export function needsGame(scene: SceneDoc): boolean {
  if (scene.scripts?.length || scene.ui?.elements?.length || scene.physics || scene.audio) return true;
  const walk = (objs: SceneDoc["objects"] | undefined): boolean => !!objs?.some((o) => !!o.body || walk(o.children));
  return walk(scene.objects);
}

function aspectOf(scene: SceneDoc): number {
  const m = /^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/.exec(scene.target?.aspect ?? "");
  if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
  return 16 / 9;
}

class PlayerImpl implements Player {
  scene: SceneDoc;
  readonly canvas: HTMLCanvasElement;
  ready: Promise<void>;
  readonly issues: RuntimeIssue[] = [];
  readonly input: Player["input"];

  private renderer: THREE.WebGLRenderer | null = null;
  private world: World | null = null;
  private game: GameHost | null = null;
  private postfx: PostFxPipeline | null = null;
  private inputState = createInputState();
  private inputBinding: InputBinding | null = null;
  private resolveAsset: (p: string) => string;
  private deterministic: boolean;
  private t = 0;
  private tlClock = 0;
  private tlClickAt = -1;
  private raf = 0;
  private playing = false;
  private visible = true;
  private started = false;
  private timeScale = 1;
  private staticMotion = false;
  private lastNow = 0;
  private fps = 0;
  private building: Promise<void> | null = null;
  private rebuilding = false;
  private disposed = false;
  private hovered = new Set<string>();
  private resizeObs: ResizeObserver | null = null;
  private interObs: IntersectionObserver | null = null;
  private readyResolve!: () => void;
  private readyReject!: (e: unknown) => void;
  private raycaster = new THREE.Raycaster();
  private width = 1;
  private height = 1;
  private lastStats: FrameStats = { triangles: 0, drawCalls: 0, geometries: 0, textures: 0 };
  private onVisibility = () => this.updateRunning();

  constructor(private container: HTMLElement, scene: SceneDoc, private options: MountOptions) {
    this.scene = scene;
    this.deterministic = !!options.deterministic;
    this.resolveAsset = createResolver(options);
    this.ready = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    this.ready.catch(() => undefined);

    const doc = container.ownerDocument;
    this.canvas = doc.createElement("canvas");
    this.canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;touch-action:manipulation;";
    const pos = doc.defaultView?.getComputedStyle(container).position;
    if (!pos || pos === "static") container.style.position = "relative";

    const self = this;
    this.input = {
      pointer(x, y) {
        self.inputState.pointer.x = x;
        self.inputState.pointer.y = y;
        self.inputState.pointer.inside = true;
      },
      key(code, down) {
        setKey(self.inputState, code, down);
      },
      click(x, y) {
        const px = x ?? self.inputState.pointer.x, py = y ?? self.inputState.pointer.y;
        self.inputState.pointer.x = px;
        self.inputState.pointer.y = py;
        self.inputState.pointer.inside = true;
        self.inputState.pointer.justPressed = true;
        self.inputState.clicks.push({ x: px, y: py });
      },
    };

    try {
      this.renderer = this.createRenderer();
    } catch (err) {
      this.report({ code: "webgl-unavailable", message: `WebGL is not available: ${(err as Error).message}` });
      this.readyReject(new Error("webgl-unavailable"));
      return;
    }
    container.appendChild(this.canvas);
    this.inputBinding = bindInput(container, this.inputState, { game: scene.target?.kind === "game" });
    this.measure();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(container);
    }

    // Reduced motion
    const target = scene.target ?? ({} as SceneDoc["target"]);
    const prefers = options.reducedMotion ?? (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const mode = target.reducedMotion ?? (target.kind === "game" ? "ignore" : "static");
    if (prefers && !this.deterministic) {
      if (mode === "static") this.staticMotion = true;
      else if (mode === "slow") this.timeScale = 0.5;
    }

    if (this.deterministic || target.lazy === false || typeof IntersectionObserver === "undefined") this.start();
    else {
      this.visible = false;
      this.interObs = new IntersectionObserver(
        (entries) => {
          const vis = entries.some((e) => e.isIntersecting);
          this.visible = vis;
          if (vis) this.start();
          this.updateRunning();
        },
        { rootMargin: "200px 0px" },
      );
      this.interObs.observe(container);
    }
    doc.addEventListener("visibilitychange", this.onVisibility);
  }

  // ─── Setup ────────────────────────────────────────────────────────────

  private createRenderer(): THREE.WebGLRenderer {
    const target = this.scene.target ?? ({} as SceneDoc["target"]);
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: target.antialias !== false,
      alpha: !!target.transparent,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: this.deterministic,
    });
    if (!r.getContext()) throw new Error("no context");
    this.configureRenderer(r);
    r.info.autoReset = false;
    return r;
  }

  private configureRenderer(r: THREE.WebGLRenderer): void {
    const target = this.scene.target ?? ({} as SceneDoc["target"]);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = TONE_MAPPING[target.toneMapping ?? "aces"] ?? THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = target.exposure ?? 1;
    const dpr = this.options.pixelRatio ?? Math.min(globalThis.devicePixelRatio || 1, target.maxDpr ?? 2);
    r.setPixelRatio(dpr);
    const anyShadow = (this.scene.lights ?? []).some((l) => l.castShadow);
    r.shadowMap.enabled = target.shadows !== false && anyShadow;
    r.shadowMap.type = THREE.PCFShadowMap;
    if (target.transparent) r.setClearColor(0x000000, 0);
    else {
      const bg = this.scene.environment?.background;
      r.setClearColor(typeof bg === "string" && bg !== "transparent" ? toColor(bg) : new THREE.Color(0x000000), 1);
    }
  }

  private start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.building = this.buildAll()
      .then(() => {
        if (this.disposed) return;
        if (this.deterministic) {
          this.t = 0;
          this.frame(0);
        } else if (this.staticMotion) {
          this.t = this.scene.target?.posterTime ?? 0;
          this.game?.advanceTo(this.t);
          this.frame(0);
        } else {
          this.frame(0);
          this.playing = true;
          this.updateRunning();
        }
        this.readyResolve();
        this.options.onReady?.(this);
      })
      .catch((err: Error) => {
        this.report({ code: "build-error", message: err.message });
        this.readyReject(err);
      });
  }

  private makeContext(tracked: Promise<unknown>[]): RuntimeContext {
    return {
      scene: this.scene,
      rng: createRng(this.scene.seed ?? 1),
      siblings: new Map(),
      color: (c) => toColor(c),
      resolveAsset: this.resolveAsset,
      renderer: this.renderer,
      deterministic: this.deterministic,
      track: (p) => {
        tracked.push(p.catch(() => undefined));
        return p;
      },
      onUpdate: () => undefined,
      issue: (code, message, path) => this.report({ code, message, path }),
      shaders: loadShaders,
      generators: loadGenerators,
    };
  }

  private async buildWorld(): Promise<World> {
    const tracked: Promise<unknown>[] = [];
    const ctx = this.makeContext(tracked);
    const world = await World.create(this.scene, ctx, this.width / Math.max(this.height, 1), this.canvas, !!this.options.editor);
    await Promise.all(tracked);
    // Second pass for tracked promises registered by late loaders (textures).
    await Promise.all(tracked);
    world.setViewport(this.width, this.height, this.renderer!.getPixelRatio());
    return world;
  }

  private async attachWorld(world: World): Promise<void> {
    this.world = world;
    this.postfx?.dispose();
    this.postfx = null;
    if (this.scene.postfx?.length && this.renderer) {
      const { createPostFx } = await import("./postfx/index");
      this.postfx = createPostFx(this.scene.postfx, { renderer: this.renderer, scene: world.scene, camera: world.camera, width: this.width, height: this.height }, (id) =>
        this.report({ code: "unknown-catalog-id", message: `Unknown post effect "${id}"`, path: "postfx" }),
      );
    }
    this.renderer?.shadowMap && (this.renderer.shadowMap.needsUpdate = true);
  }

  private async buildAll(): Promise<void> {
    const world = await this.buildWorld();
    if (this.disposed) {
      world.dispose();
      return;
    }
    await this.attachWorld(world);
    if (needsGame(this.scene)) {
      const { GameHost } = await import("./game/index");
      this.game = await GameHost.create(
        {
          scene: this.scene,
          container: this.container,
          input: this.inputState,
          resolveAsset: this.resolveAsset,
          scriptSources: this.options.scriptSources,
          deterministic: this.deterministic,
          issue: (i) => this.report(i),
          rebuild: async () => {
            const old = this.world;
            const w = await this.buildWorld();
            old?.dispose();
            await this.attachWorld(w);
            return w;
          },
        },
        world,
      );
    }
    // Compile shaders up front so the first visible frame does not hitch.
    try {
      this.renderer?.compile(world.scene, world.camera);
    } catch {
      /* compile is an optimisation */
    }
  }

  private report(issue: RuntimeIssue): void {
    this.issues.push(issue);
    try {
      this.options.onError?.(issue);
    } catch {
      /* user callback */
    }
    if (!this.options.onError) console.warn(`[agent3d] ${issue.code}: ${issue.message}`);
  }

  // ─── Loop ─────────────────────────────────────────────────────────────

  private updateRunning(): void {
    const hidden = this.container.ownerDocument.visibilityState === "hidden";
    const pauseOff = this.scene.target?.pauseOffscreen !== false;
    const shouldRun = this.playing && !this.disposed && !hidden && (this.visible || !pauseOff) && !!this.world;
    if (shouldRun && !this.raf) {
      this.lastNow = performance.now();
      const loop = (now: number) => {
        this.raf = requestAnimationFrame(loop);
        const dt = Math.min((now - this.lastNow) / 1000, 0.1);
        this.lastNow = now;
        if (dt > 0) this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
        this.tick(dt * this.timeScale);
      };
      this.raf = requestAnimationFrame(loop);
    } else if (!shouldRun && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private tick(dt: number): void {
    if (!this.world || this.rebuilding) return;
    if (this.game?.pendingRestart) {
      this.rebuilding = true;
      void this.game.restart().then(() => {
        this.rebuilding = false;
        this.t = 0;
        this.tlClock = 0;
        this.tlClickAt = -1;
      });
      return;
    }
    this.t += dt;
    this.game?.advance(dt);
    this.frame(dt);
  }

  private timelineLocal(dt: number, containerHovered: boolean, clicked: boolean): number | null {
    const tl = this.scene.timeline;
    if (!tl || !this.world?.timeline) return null;
    const dur = Math.max(tl.duration || 0, 1e-3);
    if (this.deterministic || this.staticMotion) return timelineTime(this.t, dur, tl.loop);
    if (tl.autoplay === false) return 0;
    switch (tl.trigger ?? "visible") {
      case "hover":
        this.tlClock += containerHovered || tl.loop ? (containerHovered ? dt : 0) : -dt;
        if (!tl.loop) this.tlClock = Math.min(Math.max(this.tlClock, 0), dur);
        return timelineTime(this.tlClock, dur, tl.loop);
      case "click":
        if (clicked) this.tlClickAt = this.t;
        return this.tlClickAt < 0 ? 0 : timelineTime(this.t - this.tlClickAt, dur, tl.loop);
      case "scroll":
        return this.scrollValue() * dur;
      default:
        return timelineTime(this.t, dur, tl.loop);
    }
  }

  private scrollValue(): number {
    if (this.deterministic || this.staticMotion) {
      const tl = this.scene.timeline;
      const d = tl?.trigger === "scroll" && tl.duration > 0 ? tl.duration : 4;
      return Math.min(Math.max(this.t / d, 0), 1);
    }
    return scrollProgress(this.container);
  }

  private pickIds(x: number, y: number, roots: THREE.Object3D[]): string[] {
    if (!this.world || !roots.length) return [];
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.world.camera);
    const hit = this.raycaster.intersectObjects(roots, true).find((h) => h.object.visible && !(h.object as THREE.Points).isPoints);
    return hit ? this.world.idsFor(hit.object) : [];
  }

  // Evaluate everything for the current time and render.
  private frame(dt: number): void {
    const world = this.world;
    if (!world) return;
    const inp = this.inputState;
    const roots = world.interactiveRoots();
    this.hovered = new Set(inp.pointer.inside ? this.pickIds(inp.pointer.x, inp.pointer.y, roots) : []);
    const clicked = new Set<string>();
    for (const c of inp.clicks) {
      const ids = this.pickIds(c.x, c.y, roots);
      for (const id of ids) clicked.add(id);
      const link = ids.map((id) => world.entries.get(id)?.def).find((d) => d && "href" in d && d.href) as { href?: string } | undefined;
      if (link?.href && !this.deterministic) this.navigate(link.href);
    }
    const hasLink = [...this.hovered].some((id) => {
      const d = world.entries.get(id)?.def as { href?: string } | undefined;
      return !!d?.href;
    });
    const wantCursor = hasLink || [...this.hovered].some((id) => world.entries.get(id)?.interactive) ? "pointer" : "";
    if (this.canvas.style.cursor !== wantCursor) this.canvas.style.cursor = wantCursor;

    const input: FrameInput = {
      pointer: inp.pointer,
      scroll: this.scrollValue(),
      hovered: this.hovered,
      clicked,
      timelineT: this.timelineLocal(dt, inp.pointer.inside, inp.clicks.length > 0),
    };
    const followId = this.scene.camera?.follow?.target;
    world.frame(this.t, dt, input, followId ? world.entries.get(followId)?.object : null);
    this.game?.afterFrame();
    this.render();
    endFrame(inp);
  }

  private navigate(href: string): void {
    const win = this.container.ownerDocument.defaultView;
    if (!win) return;
    try {
      const url = new URL(href, win.location.href);
      if (url.protocol === "javascript:") return;
      if (url.origin !== win.location.origin) win.open(url.href, "_blank", "noopener");
      else win.location.assign(url.href);
    } catch {
      /* invalid URL */
    }
  }

  private render(): void {
    const r = this.renderer, w = this.world;
    if (!r || !w) return;
    r.info.reset();
    if (this.postfx) this.postfx.render(this.t);
    else r.render(w.scene, w.camera);
    this.lastStats = {
      triangles: r.info.render.triangles,
      drawCalls: r.info.render.calls,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────

  play(): void {
    this.playing = true;
    this.start();
    this.updateRunning();
  }

  pause(): void {
    this.playing = false;
    this.updateRunning();
  }

  async seek(t: number): Promise<void> {
    if (!this.started) this.start();
    await this.building;
    if (!this.world) return;
    const target = Math.max(0, t);
    if (target < this.t - 1e-9) {
      if (this.game) await this.game.restart();
      else this.world.resetBehaviours();
      this.t = 0;
      this.tlClock = 0;
      this.tlClickAt = -1;
      this.world.frame(0, 0, { pointer: this.inputState.pointer, scroll: 0, hovered: new Set(), clicked: new Set(), timelineT: this.world.timeline ? 0 : null });
    }
    const dt = target - this.t;
    this.t = target;
    this.game?.advanceTo(target);
    this.frame(dt);
  }

  time(): number {
    return this.t;
  }

  async update(scene: SceneDoc): Promise<void> {
    await this.building;
    this.scene = scene;
    if (this.renderer) this.configureRenderer(this.renderer);
    this.game?.dispose();
    this.game = null;
    const old = this.world;
    this.world = null;
    old?.dispose();
    this.postfx?.dispose();
    this.postfx = null;
    this.building = this.buildAll();
    await this.building;
    this.frame(0);
  }

  private measure(): void {
    const w = Math.max(1, this.container.clientWidth || this.canvas.clientWidth || 300);
    let h = this.container.clientHeight;
    if (!h) h = Math.round(w / aspectOf(this.scene));
    this.width = w;
    this.height = Math.max(1, h);
  }

  resize(): void {
    if (!this.renderer) return;
    this.measure();
    this.renderer.setSize(this.width, this.height, false);
    this.world?.setViewport(this.width, this.height, this.renderer.getPixelRatio());
    this.postfx?.setSize(this.width, this.height);
    if (this.world && (!this.raf || this.deterministic)) this.render();
  }

  stats(): FrameStats {
    return { ...this.lastStats, fps: this.deterministic ? undefined : Math.round(this.fps) || undefined };
  }

  inspect(): InspectResult {
    const w = this.world;
    const cam = w?.camera;
    const out: InspectResult = { objects: [], camera: { position: [0, 0, 0], target: [0, 0, 0] } };
    if (!w || !cam) return out;
    w.scene.updateMatrixWorld(true);
    cam.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    let insideObject: string | undefined;
    for (const e of w.entries.values()) {
      if (!e.topLevel) continue;
      box.setFromObject(e.object);
      if (e.particles) {
        const g = (e.object as THREE.Points).geometry;
        if (g.boundingBox) box.copy(g.boundingBox).applyMatrix4(e.object.matrixWorld);
      }
      if (box.isEmpty()) continue;
      let inside = 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        if (frustum.containsPoint(p)) inside++;
        p.project(cam);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const inView: "full" | "partial" | "none" = inside === 8 ? "full" : frustum.intersectsBox(box) ? "partial" : "none";
      const cx0 = Math.max(-1, minX), cx1 = Math.min(1, maxX), cy0 = Math.max(-1, minY), cy1 = Math.min(1, maxY);
      const coverage = inView === "none" || box.containsPoint(camPos) ? (box.containsPoint(camPos) ? 1 : 0) : Math.max(0, cx1 - cx0) * Math.max(0, cy1 - cy0) / 4;
      if (!insideObject && e.kind !== "particles" && box.containsPoint(camPos)) insideObject = e.id;
      out.objects.push({
        id: e.id,
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
        inView,
        screenCoverage: Math.round(Math.min(1, coverage) * 1000) / 1000,
      });
    }
    const tgt = w.rig.orbit ? (w.rig.orbit as unknown as { target: THREE.Vector3 }).target : w.rig.rest.target;
    out.camera = { position: [camPos.x, camPos.y, camPos.z], target: [tgt.x, tgt.y, tgt.z] };
    if (insideObject) out.camera.insideObject = insideObject;
    return out;
  }

  snapshot(type: "image/png" | "image/webp" = "image/png", quality?: number): string {
    this.render();
    return this.canvas.toDataURL(type, quality);
  }

  // Id of the object under a normalised canvas point (Studio picking).
  pick(x: number, y: number): string | null {
    const w = this.world;
    if (!w) return null;
    const roots = [...w.entries.values()].filter((e) => e.topLevel && e.kind !== "light").map((e) => e.object);
    return this.pickIds(x, y, roots)[0] ?? null;
  }

  state(): Record<string, unknown> {
    return this.game?.state ?? {};
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObs?.disconnect();
    this.interObs?.disconnect();
    this.container.ownerDocument.removeEventListener("visibilitychange", this.onVisibility);
    this.inputBinding?.dispose();
    this.game?.dispose();
    this.postfx?.dispose();
    this.world?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.canvas.remove();
  }
}

export function mountScene(container: HTMLElement, scene: SceneDoc, options: MountOptions = {}): Player {
  const p = new PlayerImpl(container, scene, options);
  if (p.canvas.isConnected) p.resize();
  return p;
}
