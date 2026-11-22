// <agent3d-scene> Web Component — the public face of the runtime on a web page.
//
//   <script type="module" src="./agent3d-runtime/agent3d-runtime.js"></script>
//   <agent3d-scene src="./banner/scene.json" poster="./banner/poster.webp" aspect="4:1"
//                  data-title="Summer sale"></agent3d-scene>
//
// Attributes (all optional but src / inline scene):
//   src           scene.json URL; project-relative asset paths resolve against its directory.
//   poster        image shown until the first frame; the fallback without WebGL, when printing
//                 and on errors.
//   aspect        "W:H" reserved before scene.json is loaded (no layout shift); the scene's
//                 target.aspect wins once loaded unless the page CSS sets aspect-ratio / height.
//   alt           text alternative of the poster fallback (default: aria-label / scene title).
//   autoplay      "false" → loads and shows the first frame, plays on play() / when `paused` is removed.
//   paused        boolean: paused while present (removing it resumes).
//   loop          "true" | "false" | "pingpong": overrides timeline.loop.
//   quality       "low" | "medium" | "high" | "auto": caps the pixel ratio (1 / 1.5 / 2),
//                 low also drops antialiasing, shadows and post effects; auto picks from the device.
//   interactive   "false" → the canvas ignores the pointer (page scroll / clicks pass through).
//   library-base  base URL of "library:" assets (default `<scene dir>/assets/library/`).
//   data-*        scene data bindings: `data-title="Summer sale"` fills `{data.title}` placeholders
//                 (see ./data.ts); `data-json='{"price": 9}'` merges an object. Live: changing a
//                 data-* attribute rebuilds the scene.
// Children (single-html exports):
//   <script type="application/json">{ …SceneDoc… }</script>                   inline scene (instead of src)
//   <script type="application/json" data-assets>{ "assets/x.glb": "data:…" }</script>   pre-resolved assets
//   <script type="text/agent3d-script" data-path="scripts/game.js">…</script>   inline script modules
//   <img slot="poster" src="poster.webp" alt="…" width="1200" height="300">   the poster as markup:
//              shown before the runtime loads (and without JavaScript), no layout shift — what exports emit
//   <… slot="fallback">…</…>   custom content shown when WebGL is unavailable (default: the poster)
// JS API: el.player, el.ready (Promise<Player>), el.play(), el.pause(), el.seek(t), el.setData(obj),
//   el.data, el.trigger(name, payload?), el.reload().
// DOM events (bubbling, composed): agent3d:ready { player }, agent3d:error RuntimeIssue,
//   agent3d:event { name, payload }, agent3d:click { id, x, y }, agent3d:progress { loaded, total }.
//   Legacy aliases agent3d-ready / agent3d-error are still dispatched.
// Styling: ::part(poster), ::part(loading), ::part(loading-bar), ::part(fallback);
//   --agent3d-background, --agent3d-loading-color, --agent3d-poster-fit, --agent3d-fade.
//   The host carries status="loading" | "ready" | "error" | "unsupported".
// Sizing: display:block, width 100%, aspect-ratio from target.aspect (or target.height) —
//   page CSS on the element wins (these are :host styles).

import type { SceneDoc } from "../core/types";
import type { Player, RuntimeIssue } from "./api";
import { bindSceneData, datasetToData } from "./data";
import { mountScene } from "./player";

const BaseElement: typeof HTMLElement = typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);

export type Quality = "low" | "medium" | "high" | "auto";
export type ElementStatus = "idle" | "loading" | "ready" | "error" | "unsupported";

const SHADOW_CSS = `
:host{display:block;position:relative;width:100%;overflow:hidden;background:var(--agent3d-background,transparent);contain:layout paint;-webkit-tap-highlight-color:transparent}
:host([hidden]){display:none}
:host([interactive="false"]) ::slotted(*){pointer-events:none}
::slotted(script){display:none}
.poster,.print{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;transition:opacity var(--agent3d-fade,.4s) ease;border:0;overflow:hidden}
.poster img,::slotted([slot="poster"]),.print{object-fit:var(--agent3d-poster-fit,cover);display:block;width:100%;height:100%}
.poster[hidden],.print{display:none}
:host([status="ready"]) .poster{opacity:0}
.loading{position:absolute;left:0;right:0;bottom:0;height:3px;z-index:2;pointer-events:none;opacity:0;transition:opacity .3s ease .4s;overflow:hidden}
:host([status="loading"]) .loading{opacity:1}
.bar{height:100%;width:30%;background:var(--agent3d-loading-color,currentColor);opacity:.55;border-radius:0 2px 2px 0;transition:width .25s ease}
.loading.indeterminate .bar{animation:a3d-slide 1.2s ease-in-out infinite}
@keyframes a3d-slide{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}
.fallback{position:absolute;inset:0;z-index:1;display:none;align-items:center;justify-content:center;text-align:center;padding:12px;font:14px/1.4 system-ui,sans-serif;color:inherit;opacity:.75}
:host([status="unsupported"]) .fallback.show,:host([status="error"]) .fallback.show{display:flex}
:host([status="unsupported"]) .poster,:host([status="error"]) .poster{opacity:1}
@media (prefers-reduced-motion:reduce){.loading.indeterminate .bar{animation:none;width:100%;opacity:.3}.poster{transition:none}}
@media print{::slotted(canvas),::slotted(img){visibility:hidden}.print{display:block}.loading{display:none}.poster{opacity:1}}
`;

let sharedSheet: CSSStyleSheet | null = null;

function canAdopt(root: ShadowRoot): boolean {
  try {
    return "adoptedStyleSheets" in root && typeof CSSStyleSheet !== "undefined" && typeof CSSStyleSheet.prototype.replaceSync === "function";
  } catch {
    return false;
  }
}

export function parseAspectRatio(aspect: string | null | undefined): string | null {
  const m = /^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/.exec(aspect ?? "");
  if (!m || !(Number(m[1]) > 0) || !(Number(m[2]) > 0)) return null;
  return `${m[1]} / ${m[2]}`;
}

function autoQuality(): Exclude<Quality, "auto"> {
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return "low";
  const cores = nav.hardwareConcurrency ?? 8;
  const mem = nav.deviceMemory ?? 8;
  if (cores <= 2 || mem <= 2) return "low";
  if (cores <= 4 || mem <= 4) return "medium";
  return "high";
}

// The scene as this element will show it: data bindings, loop and quality overrides.
export function prepareScene(scene: SceneDoc, opts: { data?: Record<string, unknown>; loop?: string | null; quality?: string | null }): SceneDoc {
  let s: SceneDoc = scene;
  if (opts.data && Object.keys(opts.data).length) s = { ...s, data: { ...(s.data ?? {}), ...opts.data } };
  if (opts.loop != null && s.timeline) {
    const v = opts.loop.trim().toLowerCase();
    const loop = v === "pingpong" ? "pingpong" : v !== "false" && v !== "0" && v !== "no";
    s = { ...s, timeline: { ...s.timeline, loop } };
  }
  const q = opts.quality ? (opts.quality === "auto" ? autoQuality() : opts.quality) : null;
  if (opts.quality === "low" || opts.quality === "medium" || opts.quality === "high" || opts.quality === "ultra") {
    // An explicit attribute picks the postfx quality tier (target.quality).
    s = { ...s, target: { ...s.target, quality: opts.quality } };
  }
  if (q === "low" || q === "medium" || q === "high") {
    const cap = q === "low" ? 1 : q === "medium" ? 1.5 : 2;
    const target = { ...s.target, maxDpr: Math.min(s.target?.maxDpr ?? 2, cap) };
    if (q === "low") Object.assign(target, { antialias: false, shadows: false });
    s = { ...s, target, ...(q === "low" ? { postfx: undefined } : {}) };
  }
  return bindSceneData(s);
}

export class Agent3DSceneElement extends BaseElement {
  static get observedAttributes(): string[] {
    return ["src", "poster", "aspect", "alt", "paused", "loop", "quality", "library-base"];
  }

  player: Player | null = null;
  /** Resolves with the player once the scene is loaded and its first frame drawn. */
  ready!: Promise<Player>;
  private resolveReady!: (p: Player) => void;
  private root: ShadowRoot | null = null;
  private posterEl: HTMLImageElement | null = null;
  private posterBox: HTMLElement | null = null;
  private printEl: HTMLImageElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private fallbackEl: HTMLElement | null = null;
  private sizeStyle: HTMLStyleElement | null = null;
  private sizeSheet: CSSStyleSheet | null = null;
  private sizeCssText = "";
  private loadToken = 0;
  private connected = false;
  private source: SceneDoc | null = null; // scene as loaded (before bindings)
  private dataOverrides: Record<string, unknown> = {};
  private dataObserver: MutationObserver | null = null;
  private interObs: IntersectionObserver | null = null;
  private inView = true;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private wantPlay: boolean | null = null; // explicit play() / pause() before ready
  private autoAriaLabel: string | null = null;

  constructor() {
    super();
    this.resetReady();
  }

  private readySettled = false;

  private resetReady(): void {
    this.readySettled = false;
    this.ready = new Promise<Player>((res) => (this.resolveReady = res));
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  connectedCallback(): void {
    this.connected = true;
    this.ensureShadow();
    this.updatePoster();
    this.applyAspect(null);
    const win = this.ownerDocument.defaultView;
    win?.addEventListener("beforeprint", this.onBeforePrint);
    this.addEventListener("webglcontextlost", this.onContextLost, true);
    this.addEventListener("webglcontextrestored", this.onContextRestored, true);
    if (typeof MutationObserver !== "undefined") {
      this.dataObserver = new MutationObserver((records) => {
        if (records.some((r) => r.attributeName?.startsWith("data-"))) this.refreshData();
      });
      this.dataObserver.observe(this, { attributes: true });
    }
    if (typeof IntersectionObserver !== "undefined") {
      this.interObs = new IntersectionObserver((entries) => (this.inView = entries.some((e) => e.isIntersecting)));
      this.interObs.observe(this);
    }
    void this.load();
  }

  disconnectedCallback(): void {
    this.connected = false;
    this.loadToken++;
    this.ownerDocument.defaultView?.removeEventListener("beforeprint", this.onBeforePrint);
    this.removeEventListener("webglcontextlost", this.onContextLost, true);
    this.removeEventListener("webglcontextrestored", this.onContextRestored, true);
    this.dataObserver?.disconnect();
    this.dataObserver = null;
    this.interObs?.disconnect();
    this.interObs = null;
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.lostTimer = null;
    this.player?.dispose();
    this.player = null;
    this.setStatus("idle");
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (!this.connected || oldValue === value) return;
    if (name === "poster" || name === "alt") this.updatePoster();
    else if (name === "aspect") this.applyAspect(this.source);
    else if (name === "paused") {
      if (value !== null) this.player?.pause();
      else if (this.getAttribute("status") === "ready") this.player?.play();
    } else if (name === "src") {
      this.source = null;
      void this.load();
    } else void this.rebuild(); // loop, quality, library-base
  }

  // ─── Public API ───────────────────────────────────────────────────────

  play(): void {
    this.wantPlay = true;
    if (this.hasAttribute("paused")) this.removeAttribute("paused");
    this.player?.play();
  }

  pause(): void {
    this.wantPlay = false;
    this.player?.pause();
  }

  async seek(t: number): Promise<void> {
    const p = this.player ?? (await this.ready);
    await p.seek(t);
  }

  /** Scene data as currently bound (scene.data + data-* attributes + setData). */
  get data(): Record<string, unknown> {
    return { ...(this.source?.data ?? {}), ...this.attrData(), ...this.dataOverrides };
  }

  /** Merge values into the scene data and rebuild what is bound to them ({data.key} placeholders, api.data). */
  async setData(values: Record<string, unknown>, opts: { replace?: boolean } = {}): Promise<void> {
    this.dataOverrides = opts.replace ? { ...values } : { ...this.dataOverrides, ...values };
    await this.rebuild();
  }

  /** Send an event to the scene's scripts (api.on(name)); also reported as agent3d:event. */
  trigger(name: string, payload?: unknown): void {
    if (this.player?.emit) this.player.emit(name, payload);
    else void this.ready.then((p) => p.emit?.(name, payload));
  }

  /** Re-fetch and remount the scene. */
  reload(): Promise<void> {
    this.source = null;
    return this.load();
  }

  // ─── Shadow DOM: poster, loading bar, fallback ────────────────────────

  private ensureShadow(): void {
    if (this.root || typeof this.attachShadow !== "function") return;
    const doc = this.ownerDocument;
    this.root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    // Constructable stylesheets when available: not subject to CSP style-src
    // 'unsafe-inline' (a <style> element is the fallback).
    let styles: HTMLStyleElement[] = [];
    if (canAdopt(this.root)) {
      if (!sharedSheet) {
        sharedSheet = new CSSStyleSheet();
        sharedSheet.replaceSync(SHADOW_CSS);
      }
      this.sizeSheet = new CSSStyleSheet();
      this.root.adoptedStyleSheets = [sharedSheet, this.sizeSheet];
    } else {
      const style = doc.createElement("style");
      style.textContent = SHADOW_CSS;
      this.sizeStyle = doc.createElement("style");
      styles = [style, this.sizeStyle];
    }
    const slot = doc.createElement("slot");
    // Poster: a slotted <img slot="poster"> (exports) or the `poster` attribute.
    this.posterBox = doc.createElement("div");
    this.posterBox.className = "poster";
    this.posterBox.setAttribute("part", "poster");
    const posterSlot = doc.createElement("slot");
    posterSlot.name = "poster";
    this.posterEl = doc.createElement("img");
    this.posterEl.setAttribute("part", "poster-image");
    this.posterEl.decoding = "async";
    posterSlot.appendChild(this.posterEl);
    this.posterBox.appendChild(posterSlot);
    this.printEl = doc.createElement("img");
    this.printEl.className = "print";
    this.printEl.alt = "";
    this.loadingEl = doc.createElement("div");
    this.loadingEl.className = "loading indeterminate";
    this.loadingEl.setAttribute("part", "loading");
    this.loadingEl.setAttribute("aria-hidden", "true");
    this.barEl = doc.createElement("div");
    this.barEl.className = "bar";
    this.barEl.setAttribute("part", "loading-bar");
    this.loadingEl.appendChild(this.barEl);
    this.fallbackEl = doc.createElement("div");
    this.fallbackEl.className = "fallback";
    this.fallbackEl.setAttribute("part", "fallback");
    const fbSlot = doc.createElement("slot");
    fbSlot.name = "fallback";
    this.fallbackEl.appendChild(fbSlot);
    this.root.append(...styles, slot, this.posterBox, this.printEl, this.loadingEl, this.fallbackEl);
  }

  private updatePoster(): void {
    const el = this.posterEl;
    if (!el) return;
    const src = this.getAttribute("poster");
    el.alt = this.getAttribute("alt") ?? this.getAttribute("aria-label") ?? "";
    if (!src) el.removeAttribute("src");
    else if (el.getAttribute("src") !== src) el.src = src;
    if (this.posterBox) this.posterBox.hidden = !this.posterSrc();
    this.updateFallbackText();
  }

  // The poster URL: the slotted <img slot="poster"> or the `poster` attribute.
  private posterSrc(): string | null {
    const el = this.querySelector('[slot="poster"]');
    const slotted = (el?.tagName === "IMG" ? el : el?.querySelector("img")) as HTMLImageElement | null;
    return slotted?.currentSrc || slotted?.getAttribute("src") || this.getAttribute("poster");
  }

  private updateFallbackText(): void {
    const fb = this.fallbackEl;
    if (!fb) return;
    const slot = fb.querySelector("slot");
    const hasCustom = !!this.querySelector('[slot="fallback"]');
    const hasPoster = !!this.posterSrc();
    fb.classList.toggle("show", hasCustom || !hasPoster);
    if (slot && !hasCustom) slot.textContent = this.getAttribute("alt") ?? this.getAttribute("aria-label") ?? "";
  }

  private setStatus(s: ElementStatus): void {
    if (s === "idle") this.removeAttribute("status");
    else this.setAttribute("status", s);
    if (s === "unsupported" || s === "error") this.updateFallbackText();
  }

  private progress(loaded: number, total: number): void {
    if (this.loadingEl && this.barEl && total > 0) {
      this.loadingEl.classList.remove("indeterminate");
      this.barEl.style.width = `${Math.round((Math.min(loaded, total) / total) * 100)}%`;
    }
    this.emit("agent3d:progress", { loaded, total });
  }

  // ─── Events ───────────────────────────────────────────────────────────

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private fail(issue: RuntimeIssue): void {
    this.emit("agent3d:error", issue);
    this.emit("agent3d-error", issue);
  }

  private onBeforePrint = (): void => {
    const img = this.printEl;
    if (!img) return;
    let src = "";
    try {
      if (this.player && this.getAttribute("status") === "ready") src = this.player.snapshot("image/png");
    } catch {
      /* lost context / tainted */
    }
    if (!src || src.length < 32) src = this.posterSrc() ?? "";
    if (src) img.src = src;
    else img.removeAttribute("src");
  };

  // Real context losses (GPU reset, driver crash, too many contexts) — not the
  // player giving its context back while far off-screen (player.release()).
  private onContextLost = (e: Event): void => {
    if (!this.player || !this.inView || this.getAttribute("status") !== "ready") return;
    e.preventDefault();
    this.fail({ code: "context-lost", message: "The WebGL context was lost; restoring." });
    this.setStatus("loading");
    if (this.lostTimer) clearTimeout(this.lostTimer);
    // No restore within 3 s: remount on a fresh canvas / context.
    this.lostTimer = setTimeout(() => {
      this.lostTimer = null;
      void this.rebuild(true);
    }, 3000);
  };

  private onContextRestored = (): void => {
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.lostTimer = null;
    const p = this.player;
    if (!p) return;
    // three.js re-creates its GL state on restore; GPU resources upload again on the next render.
    void p.update(p.scene).then(
      () => this.setStatus("ready"),
      () => void this.rebuild(true),
    );
  };

  // ─── Loading ──────────────────────────────────────────────────────────

  private childJson(selector: string): unknown {
    const el = this.querySelector(selector);
    if (!el?.textContent) return undefined;
    try {
      return JSON.parse(el.textContent);
    } catch (err) {
      this.fail({ code: "invalid-scene", message: `Invalid inline JSON: ${(err as Error).message}` });
      return undefined;
    }
  }

  private attrData(): Record<string, unknown> {
    return datasetToData(this.dataset ?? {});
  }

  private refreshData(): void {
    if (this.source) void this.rebuild();
  }

  private base(): string {
    const srcAttr = this.getAttribute("src");
    return srcAttr ? new URL(".", new URL(srcAttr, this.ownerDocument.baseURI)).href : this.ownerDocument.baseURI;
  }

  private async fetchScene(): Promise<SceneDoc | undefined> {
    const inline = this.childJson('script[type="application/json"]:not([data-assets])') as SceneDoc | undefined;
    if (inline) return inline;
    const srcAttr = this.getAttribute("src");
    if (!srcAttr) return undefined;
    const url = new URL(srcAttr, this.ownerDocument.baseURI).href;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as SceneDoc;
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    if (!this.source) {
      this.setStatus("loading");
      let scene: SceneDoc | undefined;
      try {
        scene = await this.fetchScene();
      } catch (err) {
        if (token !== this.loadToken) return;
        this.setStatus("error");
        this.fail({ code: "scene-load", message: `Cannot load ${this.getAttribute("src")}: ${(err as Error).message}`, path: this.getAttribute("src") ?? undefined });
        return;
      }
      if (token !== this.loadToken) return;
      if (!scene) {
        this.setStatus("idle");
        return;
      }
      this.source = scene;
    }
    await this.mount(token);
  }

  private async rebuild(remount = false): Promise<void> {
    if (!this.connected || !this.source) return;
    const p = this.player;
    if (p && !remount && this.getAttribute("status") === "ready" && this.getAttribute("library-base") === this.mountedLibraryBase) {
      // Same player, new scene (data / loop / quality changes).
      const next = this.sceneForMount();
      this.applySizing(next);
      await p.update(next);
      return;
    }
    await this.mount(++this.loadToken);
  }

  private sceneForMount(): SceneDoc {
    return prepareScene(this.source!, { data: { ...this.attrData(), ...this.dataOverrides }, loop: this.getAttribute("loop"), quality: this.getAttribute("quality") });
  }

  private mountedLibraryBase: string | null = null;

  private async mount(token: number): Promise<void> {
    this.player?.dispose();
    this.player = null;
    if (this.readySettled) this.resetReady();
    this.setStatus("loading");
    const scene = this.sceneForMount();
    this.applySizing(scene);
    const assetUrls = this.childJson("script[data-assets]") as Record<string, string> | undefined;
    const scriptSources: Record<string, string> = {};
    this.querySelectorAll('script[type="text/agent3d-script"][data-path]').forEach((el) => {
      scriptSources[el.getAttribute("data-path")!] = el.textContent ?? "";
    });
    const libAttr = this.getAttribute("library-base");
    this.mountedLibraryBase = libAttr;
    const player = mountScene(this, scene, {
      assetBase: this.base(),
      libraryBase: libAttr ? new URL(libAttr, this.ownerDocument.baseURI).href : undefined,
      assetUrls,
      scriptSources: Object.keys(scriptSources).length ? scriptSources : undefined,
      onError: (issue) => {
        if (token !== this.loadToken) return;
        if (issue.code === "webgl-unavailable") this.setStatus("unsupported");
        this.fail(issue);
      },
      onEvent: (name, payload) => token === this.loadToken && this.emit("agent3d:event", { name, payload }),
      onClick: (id, pt) => token === this.loadToken && this.emit("agent3d:click", { id, x: pt.x, y: pt.y }),
      onProgress: (loaded, total) => token === this.loadToken && this.progress(loaded, total),
    });
    this.player = player;
    try {
      await player.ready;
    } catch {
      if (token === this.loadToken && this.getAttribute("status") !== "unsupported") this.setStatus("error");
      return;
    }
    if (token !== this.loadToken) return;
    const autoplay = (this.getAttribute("autoplay") ?? "").toLowerCase();
    const paused = this.hasAttribute("paused") || this.wantPlay === false || (this.wantPlay !== true && (autoplay === "false" || autoplay === "0" || autoplay === "no"));
    if (paused) player.pause();
    this.setStatus("ready");
    this.readySettled = true;
    this.resolveReady(player);
    this.emit("agent3d:ready", { player });
    this.emit("agent3d-ready", { player });
  }

  // ─── Sizing & accessibility ───────────────────────────────────────────

  private applyAspect(scene: SceneDoc | null): void {
    if (!this.sizeStyle && !this.sizeSheet) return;
    const t = scene?.target;
    let css: string;
    if (t?.height) css = `:host{height:${t.height}}`;
    else if (t?.kind === "fullscreen") css = ":host{height:100vh;height:100dvh}";
    else {
      const ratio = parseAspectRatio(scene ? (t?.aspect ?? this.getAttribute("aspect")) : (this.getAttribute("aspect") ?? "16:9")) ?? "16 / 9";
      css = `:host{aspect-ratio:${ratio}}`;
    }
    if (this.sizeCssText === css) return;
    this.sizeCssText = css;
    if (this.sizeSheet) this.sizeSheet.replaceSync(css);
    else if (this.sizeStyle) this.sizeStyle.textContent = css;
  }

  private applySizing(scene: SceneDoc): void {
    if (this.sizeStyle || this.sizeSheet) this.applyAspect(scene);
    else {
      // No shadow DOM (very old browsers / tests): inline styles.
      if (!this.style.display) this.style.display = "block";
      if (!this.style.width) this.style.width = "100%";
      if (!this.style.position) this.style.position = "relative";
      const ratio = parseAspectRatio(scene.target?.aspect) ?? "16 / 9";
      if (scene.target?.height) this.style.height = scene.target.height;
      else this.style.aspectRatio = ratio;
    }
    const t = scene.target;
    const game = t?.kind === "game";
    this.setAttribute("role", game ? "application" : "img");
    // An author-provided aria-label wins; ours follows scene reloads.
    const current = this.getAttribute("aria-label");
    if (current === null || current === this.autoAriaLabel) {
      this.autoAriaLabel = scene.ariaLabel || scene.title || "3D scene";
      this.setAttribute("aria-label", this.autoAriaLabel);
    }
    if (game && !this.hasAttribute("tabindex")) this.tabIndex = 0;
    this.updatePoster();
  }
}

export function defineElement(name = "agent3d-scene"): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(name)) customElements.define(name, Agent3DSceneElement);
}
