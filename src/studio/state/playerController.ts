// Owns the viewport Player: mounts the runtime (bundled in the Studio,
// loaded lazily), applies scene updates latest-wins (a rebuild in flight is
// never interrupted; only the newest pending scene is applied after it),
// play / pause / seek and a time signal for the scrubber.

import type { SceneDoc } from "../../core/types";
import type { FrameStats, MountOptions, Player, RuntimeIssue } from "../../runtime/api";
import type { MountConfig } from "../backend/types";

type RuntimeModule = { mountScene(container: HTMLElement, scene: SceneDoc, options?: MountOptions): Player };
let runtimePromise: Promise<RuntimeModule> | null = null;
export function loadRuntime(): Promise<RuntimeModule> {
  if (!runtimePromise) runtimePromise = import("../../runtime/index") as Promise<RuntimeModule>;
  return runtimePromise;
}

export function timelineTime(t: number, scene: SceneDoc | null): number {
  const tl = scene?.timeline;
  if (!tl || !(tl.duration > 0)) return t;
  const d = tl.duration;
  if (!tl.loop) return Math.min(t, d);
  if (tl.loop === "pingpong") {
    const c = t % (2 * d);
    return c > d ? 2 * d - c : c;
  }
  return t % d;
}

export class PlayerController {
  player: Player | null = null;
  issues: RuntimeIssue[] = [];
  playing = true;
  private latest: SceneDoc | null = null;
  private updating = false;
  private raf = 0;
  private timeListeners = new Set<(t: number) => void>();
  private stateListeners = new Set<() => void>();
  private scene: SceneDoc | null = null;
  private disposed = false;
  ready = false;

  async mount(container: HTMLElement, scene: SceneDoc, cfg: MountConfig, opts: { editor: boolean }): Promise<void> {
    this.dispose();
    this.disposed = false;
    this.issues = [];
    this.ready = false;
    this.scene = scene;
    const rt = await loadRuntime();
    if (this.disposed) return;
    this.player = rt.mountScene(container, scene, {
      ...cfg,
      editor: opts.editor,
      reducedMotion: false,
      onError: (issue) => {
        this.issues = [...this.issues.slice(-30), issue];
        this.notify();
      },
    });
    try {
      await this.player.ready;
    } catch {
      /* reported through onError */
    }
    this.ready = true;
    if (this.playing) this.player?.play();
    else this.player?.pause();
    this.loop();
    this.notify();
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.player) return;
      const raw = this.player.time();
      // Runtime clock can drift below 0 when its RAF loop restarts (first dt < 0): snap back.
      if (raw < 0 && !this.updating) void this.player.seek(0);
      const t = timelineTime(Math.max(0, raw), this.scene);
      this.timeListeners.forEach((l) => l(t));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  };

  update(scene: SceneDoc): void {
    this.scene = scene;
    this.latest = scene;
    if (this.updating || !this.player) return;
    void this.drain();
  }

  private async drain(): Promise<void> {
    this.updating = true;
    while (this.latest && this.player) {
      const next = this.latest;
      this.latest = null;
      const t = this.player.time();
      try {
        await this.player.update(next);
        if (!this.playing) await this.player.seek(t);
      } catch {
        /* runtime reports through onError */
      }
    }
    this.updating = false;
  }

  play(): void {
    this.playing = true;
    this.player?.play();
    this.notify();
  }
  pause(): void {
    this.playing = false;
    this.player?.pause();
    this.notify();
  }
  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }
  async seek(t: number): Promise<void> {
    if (this.playing) this.pause();
    await this.player?.seek(t);
    this.timeListeners.forEach((l) => l(timelineTime(t, this.scene)));
  }
  stats(): FrameStats | null {
    try {
      return this.player?.stats() ?? null;
    } catch {
      return null;
    }
  }
  pick(x: number, y: number): string | null {
    try {
      return this.player?.pick?.(x, y) ?? null;
    } catch {
      return null;
    }
  }
  snapshot(): string | null {
    try {
      return this.player?.snapshot("image/png") ?? null;
    } catch {
      return null;
    }
  }

  onTime(l: (t: number) => void): () => void {
    this.timeListeners.add(l);
    return () => this.timeListeners.delete(l);
  }
  onState(l: () => void): () => void {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }
  private notify(): void {
    this.stateListeners.forEach((l) => l());
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.player?.dispose();
    this.player = null;
  }
}

// A clean still (no editor helpers) at the target size — local poster export.
export async function renderStill(scene: SceneDoc, cfg: MountConfig, t: number, width: number, height: number): Promise<string> {
  const rt = await loadRuntime();
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(host);
  const p = rt.mountScene(host, scene, { ...cfg, deterministic: true, pixelRatio: 1 });
  try {
    await p.ready;
    await p.seek(t);
    return p.snapshot("image/png");
  } finally {
    p.dispose();
    host.remove();
  }
}
