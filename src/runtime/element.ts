// <agent3d-scene> Web Component.
//
//   <agent3d-scene src="./banner/scene.json" poster="./banner/poster.webp"></agent3d-scene>
//
// Attributes:
//   src           scene.json URL; project-relative asset paths resolve against its directory.
//   poster        image shown until the first frame, and kept as the fallback without WebGL.
//   library-base  optional base URL of "library:" assets (default `<scene dir>/assets/library/`).
// Children (single-html exports):
//   <script type="application/json">{ …SceneDoc… }</script>                   inline scene (instead of src)
//   <script type="application/json" data-assets>{ "assets/x.glb": "data:…" }</script>   pre-resolved assets
//   <script type="text/agent3d-script" data-path="scripts/game.js">…</script>   inline script modules
// Sizing: display:block, width 100%, CSS aspect-ratio from target.aspect (or target.height).
// Events: `agent3d-ready` (detail: { player }), `agent3d-error` (detail: RuntimeIssue).

import type { SceneDoc } from "../core/types";
import type { Player, RuntimeIssue } from "./api";
import { mountScene } from "./player";

const BaseElement: typeof HTMLElement = typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);

export class Agent3DSceneElement extends BaseElement {
  static get observedAttributes(): string[] {
    return ["src", "poster"];
  }

  player: Player | null = null;
  private posterEl: HTMLImageElement | null = null;
  private loadToken = 0;
  private connected = false;

  connectedCallback(): void {
    this.connected = true;
    if (!this.style.display) this.style.display = "block";
    if (!this.style.width) this.style.width = "100%";
    if (!this.style.position) this.style.position = "relative";
    this.style.overflow = "hidden";
    this.updatePoster();
    void this.load();
  }

  disconnectedCallback(): void {
    this.connected = false;
    this.loadToken++;
    this.player?.dispose();
    this.player = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (!this.connected || oldValue === value) return;
    if (name === "poster") this.updatePoster();
    if (name === "src") void this.load();
  }

  private updatePoster(): void {
    const src = this.getAttribute("poster");
    if (!src) {
      this.posterEl?.remove();
      this.posterEl = null;
      return;
    }
    if (!this.posterEl) {
      this.posterEl = this.ownerDocument.createElement("img");
      this.posterEl.alt = "";
      this.posterEl.setAttribute("aria-hidden", "true");
      this.posterEl.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;pointer-events:none;transition:opacity .4s ease;";
      this.appendChild(this.posterEl);
    }
    this.posterEl.src = src;
  }

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

  private fail(issue: RuntimeIssue): void {
    this.dispatchEvent(new CustomEvent("agent3d-error", { detail: issue, bubbles: true }));
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.player?.dispose();
    this.player = null;
    const srcAttr = this.getAttribute("src");
    let scene = this.childJson('script[type="application/json"]:not([data-assets])') as SceneDoc | undefined;
    let base = this.ownerDocument.baseURI;
    if (srcAttr) {
      const url = new URL(srcAttr, this.ownerDocument.baseURI).href;
      base = new URL(".", url).href;
      if (!scene) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          scene = (await res.json()) as SceneDoc;
        } catch (err) {
          if (token === this.loadToken) this.fail({ code: "scene-load", message: `Cannot load ${srcAttr}: ${(err as Error).message}`, path: srcAttr });
          return;
        }
      }
    }
    if (token !== this.loadToken || !scene) return;
    this.applySizing(scene);
    const assetUrls = this.childJson("script[data-assets]") as Record<string, string> | undefined;
    const scriptSources: Record<string, string> = {};
    this.querySelectorAll('script[type="text/agent3d-script"][data-path]').forEach((el) => {
      scriptSources[el.getAttribute("data-path")!] = el.textContent ?? "";
    });
    const libAttr = this.getAttribute("library-base");
    this.player = mountScene(this, scene, {
      assetBase: base,
      libraryBase: libAttr ? new URL(libAttr, this.ownerDocument.baseURI).href : undefined,
      assetUrls,
      scriptSources: Object.keys(scriptSources).length ? scriptSources : undefined,
      onError: (issue) => {
        this.fail(issue);
        if (issue.code === "webgl-unavailable" && this.posterEl) this.posterEl.style.opacity = "1";
      },
    });
    const player = this.player;
    player.ready.then(
      () => {
        if (token !== this.loadToken) return;
        if (this.posterEl) this.posterEl.style.opacity = "0";
        this.dispatchEvent(new CustomEvent("agent3d-ready", { detail: { player }, bubbles: true }));
      },
      () => undefined,
    );
  }

  private autoAriaLabel: string | null = null;

  private applySizing(scene: SceneDoc): void {
    const t = scene.target;
    if (t?.height) {
      this.style.height = t.height;
      this.style.aspectRatio = "";
    } else if (t?.kind === "fullscreen") {
      this.style.height = this.style.height || "100vh";
    } else {
      const m = /^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/.exec(t?.aspect ?? "16:9");
      this.style.aspectRatio = m ? `${m[1]} / ${m[2]}` : "16 / 9";
    }
    const game = t?.kind === "game";
    this.setAttribute("role", game ? "application" : "img");
    // An author-provided aria-label wins; ours follows scene reloads.
    const current = this.getAttribute("aria-label");
    if (current === null || current === this.autoAriaLabel) {
      this.autoAriaLabel = scene.ariaLabel || scene.title || "3D scene";
      this.setAttribute("aria-label", this.autoAriaLabel);
    }
    if (game && !this.hasAttribute("tabindex")) this.tabIndex = 0;
  }
}

export function defineElement(name = "agent3d-scene"): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(name)) customElements.define(name, Agent3DSceneElement);
}
