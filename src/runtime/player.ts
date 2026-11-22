// Player: renderer, clock, resize, lazy start / off-screen pause, reduced
// motion, deterministic seek, stats / inspect / snapshot, input simulation.
// mountScene(container, scene, options) is the public entry (api.ts).

import * as THREE from "three";
import type { SceneDoc } from "../core/types";
import type { EditorBridge, EditorOverlayHooks, FrameStats, InspectResult, MountOptions, Player, RuntimeIssue } from "./api";
import { createResolver } from "./assets";
import { bindSceneData } from "./data";
import { loadGenerators, loadShaders, type RuntimeContext } from "./build/context";
import { World, type FrameInput } from "./build/index";
import { shadowMapSettings } from "./build/lights";
import type { GameHost } from "./game/index";
import { bindInput, createInputState, endFrame, scrollProgress, setKey, type InputBinding } from "./input";
import type { PostFxPipeline } from "./postfx/index";
import { lowerTier, qualitySettings, resolveQualityTier, type QualitySettings } from "../core/postfx";
import { createRng } from "./random";
import { TimelineController } from "./timeline/controller";
import { InteractionRunner, safeUrl } from "./timeline/interactions";
import { scrollProgressFor } from "./timeline/scroll";
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

// WebGL context budget. Browsers cap live contexts (~16 in Chrome) and drop the
// oldest one, blanking it. Players far off-screen give their context back:
// after OFFSCREEN_RELEASE_MS out of view, or immediately (least recently seen
// first) when a new player needs a context and MAX_LIVE_CONTEXTS are alive.
// A released player shows its last frame as an image and rebuilds on re-entry.
// Games, editors and deterministic (headless) players are never released.
const MAX_LIVE_CONTEXTS = 8;
const OFFSCREEN_RELEASE_MS = 20_000;
const livePlayers = new Set<PlayerImpl>();

function reclaimContexts(except: PlayerImpl): void {
  while (livePlayers.size >= MAX_LIVE_CONTEXTS) {
    let victim: PlayerImpl | null = null;
    for (const p of livePlayers) if (p !== except && p.releasable() && (!victim || p.lastSeen < victim.lastSeen)) victim = p;
    if (!victim) return;
    victim.release();
  }
}

/** Live WebGL contexts held by players on this page (tests / diagnostics). */
export function liveContextCount(): number {
  return livePlayers.size;
}

class PlayerImpl implements Player {
  scene: SceneDoc;
  canvas: HTMLCanvasElement;
  lastSeen = 0;
  private released = false;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private placeholder: HTMLImageElement | null = null;
  private readyCalled = false;
  ready: Promise<void>;
  readonly issues: RuntimeIssue[] = [];
  readonly input: Player["input"];

  private renderer: THREE.WebGLRenderer | null = null;
  private world: World | null = null;
  private game: GameHost | null = null;
  private postfx: PostFxPipeline | null = null;
  // Quality tier (target.quality) + runtime adaptation state ("auto" only).
  private quality: QualitySettings = qualitySettings("high");
  private qualityAuto = false;
  private perfClock = 0;
  private slowFor = 0;
  private renderSamples = 1;
  private inputState = createInputState();
  private inputBinding: InputBinding | null = null;
  private resolveAsset: (p: string) => string;
  private deterministic: boolean;
  private t = 0;
  // Motion: timeline playback, interactions, event bus, scroll.
  private tl: TimelineController | null = null;
  private interactions: InteractionRunner | null = null;
  private eventListeners = new Map<string, Set<(payload?: unknown) => void>>();
  private scrollOverride: number | null = null;
  private tlScroll: number | null = null;
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
  // Studio editor overlay (options.editor only).
  readonly editor?: EditorBridge;
  private overlay: EditorOverlayHooks | null = null;
  private worldListeners = new Set<() => void>();

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
    if (options.editor) {
      this.editor = {
        world: () => self.world,
        renderer: () => self.renderer,
        setOverlay: (o) => {
          self.overlay = o;
        },
        render: () => self.render(),
        onWorld: (l) => {
          self.worldListeners.add(l);
          return () => self.worldListeners.delete(l);
        },
        running: () => !!self.raf,
      };
    }
    this.input = {
      pointer(x, y) {
        self.inputState.pointer.x = x;
        self.inputState.pointer.y = y;
        self.inputState.pointer.inside = true;
        self.inputInteractions();
      },
      key(code, down) {
        setKey(self.inputState, code, down);
        self.inputInteractions();
      },
      click(x, y) {
        const px = x ?? self.inputState.pointer.x, py = y ?? self.inputState.pointer.y;
        self.inputState.pointer.x = px;
        self.inputState.pointer.y = py;
        self.inputState.pointer.inside = true;
        self.inputState.pointer.justPressed = true;
        self.inputState.clicks.push({ x: px, y: py });
        self.inputInteractions();
      },
      down(x, y) {
        const p = self.inputState.pointer;
        if (x !== undefined && y !== undefined) (p.x = x), (p.y = y);
        p.inside = true;
        p.justPressed = !p.down;
        p.down = true;
      },
      up(x, y) {
        const p = self.inputState.pointer;
        if (x !== undefined && y !== undefined) (p.x = x), (p.y = y);
        p.down = false;
      },
      swipe(direction) {
        self.inputState.swipe = direction;
      },
      scroll(progress) {
        self.setScrollProgress(progress);
        self.inputInteractions();
      },
    };

    // The WebGL context is created lazily in start(): browsers cap live
    // contexts (~16 in Chrome) and drop the oldest, so a page with many lazy
    // embeds (galleries, product grids) must not open one per element upfront.
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
          this.lastSeen = performance.now();
          if (this.releaseTimer) clearTimeout(this.releaseTimer);
          this.releaseTimer = null;
          if (vis) this.start();
          else if (this.releasable()) this.releaseTimer = setTimeout(() => this.release(), OFFSCREEN_RELEASE_MS);
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
    this.quality = qualitySettings(resolveQualityTier(target.quality, this.deviceHints(r)));
    this.qualityAuto = (target.quality ?? "auto") === "auto" && !this.deterministic && !this.options.editor;
    this.perfClock = this.slowFor = 0;
    const dpr = this.options.pixelRatio ?? Math.min(globalThis.devicePixelRatio || 1, target.maxDpr ?? 2, this.quality.dprCap);
    r.setPixelRatio(dpr);
    // Lights, the physical-sky sun and light rigs can cast shadows (build/lights.ts).
    const shadows = shadowMapSettings(this.scene);
    r.shadowMap.enabled = shadows.enabled;
    r.shadowMap.type = shadows.type;
    if (target.transparent) r.setClearColor(0x000000, 0);
    else {
      const bg = this.scene.environment?.background;
      r.setClearColor(typeof bg === "string" && bg !== "transparent" ? toColor(bg) : new THREE.Color(0x000000), 1);
    }
  }

  private start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    reclaimContexts(this);
    if (this.released) {
      // The old canvas' context is lost for good: render into a fresh one,
      // under the last-frame image until the rebuilt scene has drawn.
      const fresh = this.container.ownerDocument.createElement("canvas");
      fresh.style.cssText = this.canvas.style.cssText;
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
      this.released = false;
    }
    try {
      this.renderer = this.createRenderer();
      livePlayers.add(this);
    } catch (err) {
      this.report({ code: "webgl-unavailable", message: `WebGL is not available: ${(err as Error).message}` });
      this.readyReject(new Error("webgl-unavailable"));
      return;
    }
    this.measure();
    this.renderer.setSize(this.width, this.height, false);
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
          this.renderStill();
        } else {
          this.frame(0);
          this.playing = true;
          this.updateRunning();
        }
        this.placeholder?.remove();
        this.placeholder = null;
        this.readyResolve();
        if (!this.readyCalled) this.options.onReady?.(this);
        this.readyCalled = true;
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
        this.trackProgress(p);
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
    const world = await World.create(bindSceneData(this.scene), ctx, this.width / Math.max(this.height, 1), this.canvas, !!this.options.editor);
    await Promise.all(tracked);
    // Second pass for tracked promises registered by late loaders (textures).
    await Promise.all(tracked);
    world.setViewport(this.width, this.height, this.renderer!.getPixelRatio());
    return world;
  }

  private async attachWorld(world: World): Promise<void> {
    this.world = world;
    this.attachMotion(world);
    world.settleEntrances = this.staticMotion;
    await this.buildPostFx(world);
    this.renderer?.shadowMap && (this.renderer.shadowMap.needsUpdate = true);
    for (const l of this.worldListeners) {
      try {
        l();
      } catch {
        /* editor listener */
      }
    }
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
          scene: bindSceneData(this.scene),
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
      // Report script / UI events to the host page (element: `agent3d:event`).
      const game = this.game;
      const emit = game.emit.bind(game);
      // Script api.emit and HUD button actions go through here too: they also
      // reach Player.on listeners and { on: "event" } interactions.
      game.emit = (name: string, payload?: unknown) => {
        emit(name, payload);
        this.notify(name, payload);
        this.dispatchMotionEvent(name, payload);
      };
    }
    // Compile shaders up front so the first visible frame does not hitch.
    try {
      this.renderer?.compile(world.scene, world.camera);
    } catch {
      /* compile is an optimisation */
    }
  }

  private loadTotal = 0;
  private loadDone = 0;

  private trackProgress(p: Promise<unknown>): void {
    if (!this.options.onProgress) return;
    this.loadTotal++;
    const done = () => {
      this.loadDone++;
      try {
        this.options.onProgress?.(this.loadDone, this.loadTotal);
      } catch {
        /* user callback */
      }
    };
    p.then(done, done);
  }

  private notify(name: string, payload?: unknown): void {
    try {
      this.options.onEvent?.(name, payload);
    } catch {
      /* user callback */
    }
  }

  // Player.emit (api.ts): scripts' api.on(name) + MountOptions.onEvent (the
  // element re-dispatches it as `agent3d:event`). Interactions / markers can hook in here.
  emit(name: string, payload?: unknown): void {
    if (this.game) return this.game.emit(name, payload); // the wrapper (attachWorld) dispatches everything
    this.notify(name, payload);
    this.dispatchMotionEvent(name, payload);
  }

  // Motion: Player.on listeners and interactions { on: "event" } (markers, emit actions, script api.emit, HUD buttons).
  private dispatchMotionEvent(name: string, payload?: unknown): void {
    for (const h of this.eventListeners.get(name) ?? []) {
      try {
        h(payload);
      } catch {
        /* user callback */
      }
    }
    this.interactions?.event(name, payload);
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
        // The first rAF timestamp can be earlier than performance.now() at start:
        // never step backwards (time below 0 would keep `appear` hidden).
        const dt = Math.min(Math.max((now - this.lastNow) / 1000, 0), 0.1);
        this.lastNow = now;
        if (dt > 0.002) this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
        if (this.qualityAuto) this.adaptQuality(dt);
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
        this.resetMotion();
      });
      return;
    }
    dt = Math.max(dt, 0);
    this.t = Math.max(this.t + dt, 0);
    this.game?.advance(dt);
    this.frame(dt);
  }

  // ─── Motion ───────────────────────────────────────────────────────────

  private attachMotion(world: World): void {
    this.tl = this.scene.timeline ? new TimelineController(this.scene.timeline) : null;
    this.tlScroll = null;
    world.postfxParam = (type, param, value) => (this.postfx as unknown as { setParam?(t: string, p: string, v: unknown): void } | null)?.setParam?.(type, param, value);
    const defs = this.scene.interactions ?? [];
    this.interactions = defs.length
      ? new InteractionRunner(defs, {
          play: (seg, reverse) => this.playSegment(seg, { reverse }),
          toggle: (seg) => {
            if (!this.tl?.toggle(seg, this.t)) this.unknownSegment(seg);
          },
          seek: (to) => this.tl?.seek(to, this.t),
          set: (path, value, duration, ease) => world.overrides.set(path, value, this.t, duration, ease),
          emit: (name, payload) => this.emit(name, payload),
          openUrl: (url, newTab) => this.openUrl(url, newTab),
          playClip: (target, clip, opts) => {
            const a = world.entries.get(target)?.animator;
            if (a) a.play(clip, opts);
            else this.report({ code: "interaction", message: `playClip: "${target}" is not a model with animation clips`, path: "interactions" });
          },
        })
      : null;
  }

  // Deterministic renders apply simulated input between seeks: fire the
  // interactions it causes at the input's time (not at the next seek), once.
  private handledClicks = 0;
  private handledKeys = new Set<string>();
  private inputInteractions(): void {
    const world = this.world;
    if (!this.deterministic || !this.interactions || !world) return;
    const inp = this.inputState;
    const roots = world.interactiveRoots();
    const hovered = new Set(inp.pointer.inside ? this.pickIds(inp.pointer.x, inp.pointer.y, roots) : []);
    const clicked = new Set<string>();
    for (const c of inp.clicks.slice(this.handledClicks)) for (const id of this.pickIds(c.x, c.y, roots)) clicked.add(id);
    const pressed = new Set([...inp.pressed].filter((k) => !this.handledKeys.has(k)));
    this.interactions.step({ hovered, pointerInside: inp.pointer.inside, clicked, canvasClicked: inp.clicks.length > this.handledClicks, pressed, scroll: this.scrollValue(), visible: true, userGesture: false });
    this.handledClicks = inp.clicks.length;
    for (const k of pressed) this.handledKeys.add(k);
  }

  private resetMotion(): void {
    this.tl?.reset();
    this.interactions?.reset();
    this.tlScroll = null;
  }

  private unknownSegment(name: string): void {
    this.report({ code: "interaction", message: `Unknown timeline segment "${name}"`, path: "timeline.segments" });
  }

  private timelineLocal(dt: number, containerHovered: boolean, clicked: boolean): number | null {
    const tl = this.scene.timeline;
    if (!tl || !this.world?.timeline || !this.tl) return null;
    return this.tl.update({
      t: this.t,
      dt,
      deterministic: this.deterministic,
      staticMotion: this.staticMotion,
      posterTime: this.scene.target?.posterTime,
      hovered: containerHovered,
      clicked,
      scroll: tl.trigger === "scroll" ? this.timelineScroll(dt) : 0,
    });
  }

  // Scroll progress of the timeline (its own start / end + smoothing).
  private timelineScroll(dt: number): number {
    const tl = this.scene.timeline!;
    if (this.scrollOverride !== null) return this.scrollOverride;
    if (this.deterministic || this.staticMotion) return this.scrollValue();
    const win = this.container.ownerDocument.defaultView;
    const r = this.container.getBoundingClientRect();
    const raw = scrollProgressFor(r.top, r.height, win?.innerHeight || 1, tl.scroll?.start, tl.scroll?.end);
    const smoothing = Math.min(Math.max(tl.scroll?.smoothing ?? 0.8, 0), 0.99);
    if (this.tlScroll === null || smoothing <= 0) this.tlScroll = raw;
    else this.tlScroll += (raw - this.tlScroll) * (1 - Math.pow(smoothing, Math.max(dt, 0) * 60));
    if (Math.abs(raw - this.tlScroll) < 1e-4) this.tlScroll = raw;
    return this.tlScroll;
  }

  private scrollValue(): number {
    if (this.scrollOverride !== null) return this.scrollOverride;
    if (this.deterministic || this.staticMotion) {
      const tl = this.scene.timeline;
      const d = tl?.trigger === "scroll" && tl.duration > 0 ? tl.duration : 4;
      return Math.min(Math.max(this.t / d, 0), 1);
    }
    return scrollProgress(this.container);
  }

  private openUrl(url: string, newTab: boolean | undefined): void {
    const win = this.container.ownerDocument.defaultView;
    const href = win ? safeUrl(url, win.location.href) : null;
    this.emit("openUrl", { url: href ?? url, blocked: !href || this.deterministic });
    if (!href || !win || this.deterministic) return;
    const external = new URL(href).origin !== win.location.origin;
    if (newTab ?? external) win.open(href, "_blank", "noopener,noreferrer");
    else win.location.assign(href);
  }

  playSegment(name: string, opts: { reverse?: boolean } = {}): void {
    if (!this.tl?.play(name, this.t, opts)) this.unknownSegment(name);
  }

  trigger(on: string, target?: string): void {
    this.interactions?.fire(on, target, !this.deterministic);
    this.interactions?.flush();
  }

  on(name: string, handler: (payload?: unknown) => void): () => void {
    let set = this.eventListeners.get(name);
    if (!set) this.eventListeners.set(name, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  setScrollProgress(progress: number | null): void {
    this.scrollOverride = progress === null || !Number.isFinite(progress) ? null : Math.min(Math.max(progress, 0), 1);
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
      if (this.options.onClick) {
        const all = [...world.entries.values()].filter((e) => e.topLevel && e.kind !== "light").map((e) => e.object);
        const hit = ids[0] ?? this.pickIds(c.x, c.y, all)[0] ?? null;
        try {
          this.options.onClick(hit, { x: c.x, y: c.y });
        } catch {
          /* user callback */
        }
      }
      const link = ids.map((id) => world.entries.get(id)?.def).find((d) => d && "href" in d && d.href) as { href?: string } | undefined;
      if (link?.href && !this.deterministic) this.navigate(link.href);
    }
    const hasLink = [...this.hovered].some((id) => {
      const d = world.entries.get(id)?.def as { href?: string } | undefined;
      return !!d?.href;
    });
    const wantCursor = hasLink || [...this.hovered].some((id) => world.entries.get(id)?.interactive) ? "pointer" : "";
    if (this.canvas.style.cursor !== wantCursor) this.canvas.style.cursor = wantCursor;

    const scroll = this.scrollValue();
    // Interactions fire before the frame is evaluated so their effect shows now
    // (clicks / keys already handled at input time in deterministic mode are skipped).
    let iClicked = clicked;
    if (this.handledClicks) {
      iClicked = new Set();
      for (const c of inp.clicks.slice(this.handledClicks)) for (const id of this.pickIds(c.x, c.y, roots)) iClicked.add(id);
    }
    this.interactions?.step({
      hovered: this.hovered,
      pointerInside: inp.pointer.inside,
      clicked: iClicked,
      canvasClicked: inp.clicks.length > this.handledClicks,
      pressed: this.handledKeys.size ? new Set([...inp.pressed].filter((k) => !this.handledKeys.has(k))) : inp.pressed,
      scroll,
      visible: true,
      userGesture: !this.deterministic,
    });
    const input: FrameInput = {
      pointer: inp.pointer,
      scroll,
      hovered: this.hovered,
      clicked,
      timelineT: this.timelineLocal(dt, inp.pointer.inside, inp.clicks.length > 0),
    };
    for (const m of this.tl?.drainMarkers() ?? []) this.emit(m.name, { marker: m.name, time: m.time });
    this.interactions?.flush();
    const followId = this.scene.camera?.follow?.target;
    world.frame(this.t, dt, input, followId ? world.entries.get(followId)?.object : null);
    this.game?.afterFrame();
    this.render();
    endFrame(inp);
    this.handledClicks = 0;
    this.handledKeys.clear();
  }

  private navigate(href: string): void {
    const win = this.container.ownerDocument.defaultView;
    if (!win) return;
    // Same rules as the openUrl interaction: http(s) / page-relative only.
    const safe = safeUrl(href, win.location.href);
    if (!safe) return;
    const url = new URL(safe);
    if (url.origin !== win.location.origin) win.open(url.href, "_blank", "noopener,noreferrer");
    else win.location.assign(url.href);
  }

  private render(withOverlay = true): void {
    const r = this.renderer, w = this.world;
    if (!r || !w) return;
    // Studio editor camera: render through its pose / projection (post effects included), then restore.
    const overlay = withOverlay ? this.overlay : null;
    const view = overlay?.viewCamera?.() ?? null;
    const cam = w.camera;
    const saved = view && view !== cam ? { p: cam.position.clone(), q: cam.quaternion.clone(), proj: cam.projectionMatrix.clone(), inv: cam.projectionMatrixInverse.clone(), near: cam.near, far: cam.far } : null;
    if (view && saved) {
      view.updateMatrixWorld();
      view.matrixWorld.decompose(cam.position, cam.quaternion, new THREE.Vector3());
      cam.projectionMatrix.copy(view.projectionMatrix);
      cam.projectionMatrixInverse.copy(view.projectionMatrixInverse);
      const v = view as THREE.PerspectiveCamera;
      if (typeof v.near === "number") (cam.near = v.near), (cam.far = v.far);
      cam.updateMatrixWorld(true);
    }
    r.info.reset();
    if (this.postfx) this.postfx.render(this.t, { samples: this.renderSamples });
    else r.render(w.scene, w.camera);
    // Supersampled stills draw the scene N times: keep the per-frame stats of a normal frame.
    if (this.renderSamples === 1) this.lastStats = {
      triangles: r.info.render.triangles,
      drawCalls: r.info.render.calls,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
    };
    if (overlay) {
      try {
        overlay.draw(r, cam);
      } catch (err) {
        this.report({ code: "editor-overlay", message: (err as Error).message });
        this.overlay = null;
      }
    }
    if (saved) {
      cam.position.copy(saved.p);
      cam.quaternion.copy(saved.q);
      cam.projectionMatrix.copy(saved.proj);
      cam.projectionMatrixInverse.copy(saved.inv);
      cam.near = saved.near;
      cam.far = saved.far;
      cam.updateMatrixWorld(true);
    }
  }

  // ─── Context release ─────────────────────────────────────────────────

  releasable(): boolean {
    return !!this.renderer && !!this.world && !this.game && !this.deterministic && !this.options.editor && !this.visible && !this.disposed && !this.released && !needsGame(this.scene);
  }

  // Give the WebGL context back: keep the last frame as an image, free every
  // GPU resource and lose the context. start() rebuilds on re-entry (time and
  // timeline position carry on; scenes are a function of time).
  release(): void {
    if (!this.releasable()) return;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    let still = "";
    try {
      this.render();
      still = this.canvas.toDataURL("image/webp", 0.85);
    } catch {
      /* tainted / lost: no placeholder */
    }
    if (still && still.length > 32) {
      const img = this.container.ownerDocument.createElement("img");
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
      img.src = still;
      this.placeholder?.remove();
      this.placeholder = img;
      this.canvas.after(img);
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.postfx?.dispose();
    this.postfx = null;
    this.world?.dispose();
    this.world = null;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    livePlayers.delete(this);
    this.released = true;
    this.started = false;
    this.building = null;
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
    if (!this.deterministic) this.renderStill();
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
      this.resetMotion();
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
    if (!this.renderer) return; // not started / released: start() builds the new scene
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
    // Deterministic stills with `taa`: supersampled (jittered accumulation).
    this.renderSamples = this.deterministic ? this.postfx?.stillSamples || 1 : 1;
    try {
      this.render(false);
    } finally {
      this.renderSamples = 1;
    }
    return this.canvas.toDataURL(type, quality);
  }

  async snapshotHighQuality(samples = 16, type: "image/png" | "image/webp" = "image/png", quality?: number): Promise<string> {
    if (!this.started) this.start();
    await this.building;
    const r = this.renderer, w = this.world;
    if (!r || !w) return this.canvas.toDataURL(type, quality);
    const n = Math.max(1, Math.min(64, Math.round(samples)));
    // No post effects: a bare pipeline (scene + tone mapping + sRGB) renders exactly like the direct path.
    let temp: PostFxPipeline | null = null;
    if (!this.postfx) {
      const { createPostFx } = await import("./postfx/index");
      temp = createPostFx([], { renderer: r, scene: w.scene, camera: w.camera, width: this.width, height: this.height, quality: qualitySettings("ultra"), antialias: this.scene.target?.antialias !== false }, () => undefined);
    }
    const pipe = this.postfx ?? temp!;
    try {
      pipe.render(this.t, { samples: n });
      return this.canvas.toDataURL(type, quality);
    } finally {
      temp?.dispose();
    }
  }

  // ─── Quality ──────────────────────────────────────────────────────────

  private deviceHints(r: THREE.WebGLRenderer): Parameters<typeof resolveQualityTier>[1] {
    const nav = (globalThis.navigator ?? {}) as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    let gpu: string | undefined;
    try {
      const gl = r.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    } catch {
      /* not exposed */
    }
    const ua = nav.userAgent ?? "";
    return {
      deterministic: this.deterministic,
      mobile: nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(ua),
      cores: nav.hardwareConcurrency,
      memoryGb: nav.deviceMemory,
      gpu,
    };
  }

  // swap: keep the current pipeline on screen until the new one is ready (quality change).
  private async buildPostFx(world: World, swap = false): Promise<void> {
    if (!swap) {
      this.postfx?.dispose();
      this.postfx = null;
    }
    if (!this.scene.postfx?.length || !this.renderer) return;
    const { createPostFx } = await import("./postfx/index");
    if (this.world !== world || !this.renderer) return;
    const pipe = createPostFx(
      this.scene.postfx,
      { renderer: this.renderer, scene: world.scene, camera: world.camera, width: this.width, height: this.height, quality: this.quality, antialias: this.scene.target?.antialias !== false },
      (id) => this.report({ code: "unknown-catalog-id", message: `Unknown post effect "${id}"`, path: "postfx" }),
    );
    await pipe.ready;
    if (this.world !== world) return pipe.dispose();
    this.postfx?.dispose();
    this.postfx = pipe;
  }

  // Supersampled still (`taa`) for frames that stay on screen: the
  // reduced-motion still and paused frames.
  private renderStill(): void {
    const n = this.postfx?.stillSamples ?? 0;
    if (n < 2 || !this.world) return;
    this.renderSamples = n;
    try {
      this.render();
    } finally {
      this.renderSamples = 1;
    }
  }

  // "auto" quality: when the frame rate stays below 40 fps for 3 s (after a
  // 2 s warm-up), lower the pixel ratio first (×0.75 down to 1), then the
  // tier (drops / downsizes costly effects). Never steps back up (no oscillation).
  private adaptQuality(dt: number): void {
    const r = this.renderer;
    if (!r || !this.world || this.rebuilding) return;
    this.perfClock += dt;
    if (this.perfClock < 2) return;
    if (this.fps < 40) this.slowFor += dt;
    else this.slowFor = Math.max(0, this.slowFor - dt);
    if (this.slowFor < 3) return;
    this.slowFor = 0;
    this.perfClock = 0;
    if (this.options.pixelRatio === undefined && r.getPixelRatio() > 1.01) {
      r.setPixelRatio(Math.max(1, r.getPixelRatio() * 0.75));
      this.resize();
      return;
    }
    const lower = lowerTier(this.quality.tier);
    if (!lower) {
      this.qualityAuto = false;
      return;
    }
    this.quality = qualitySettings(lower);
    if (this.scene.postfx?.length) void this.buildPostFx(this.world, true);
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
    this.overlay = null;
    this.worldListeners.clear();
    this.game?.dispose();
    this.postfx?.dispose();
    this.world?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    livePlayers.delete(this);
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.placeholder?.remove();
    this.canvas.remove();
  }
}

export function mountScene(container: HTMLElement, scene: SceneDoc, options: MountOptions = {}): Player {
  const p = new PlayerImpl(container, scene, options);
  if (p.canvas.isConnected) p.resize();
  return p;
}
