// Interactions (scene.interactions): no-code triggers → actions.
//   on: click | hover | hoverEnd (on `target` or the whole canvas), visible,
//       scroll (progress crosses `at` downward), key (KeyboardEvent.code),
//       event (a marker or an emitted event name)
//   do: play / toggle / seek a timeline segment, set a property (tweened),
//       emit an event, open a URL (click / key only, user gesture only),
//       play a model clip.
// The runner is fed one frame of input at a time; every action goes through
// the host (the player), so the runner itself is pure and testable.

import type { InteractionAction, InteractionDef, KeyValue } from "../../core/types";

export interface InteractionHost {
  play(segment: string, reverse: boolean): void;
  toggle(segment: string): void;
  seek(to: number | string): void;
  set(path: string, value: KeyValue, duration: number, ease?: string): void;
  emit(name: string, payload?: unknown): void;
  openUrl(url: string, newTab: boolean | undefined): void;
  playClip(target: string, clip: string | number, opts: { loop?: boolean; speed?: number; crossfade?: number }): void;
}

export interface InteractionFrame {
  hovered: Set<string>; // object ids under the pointer (with ancestors)
  pointerInside: boolean;
  clicked: Set<string>; // object ids clicked this frame
  canvasClicked: boolean;
  pressed: Set<string>; // KeyboardEvent.code pressed this frame
  scroll: number; // page scroll progress 0..1
  visible: boolean; // the embed is on screen and running
  // Real user gesture (navigation allowed): false in deterministic renders.
  userGesture: boolean;
}

// Only http(s) (absolute, or relative to the page) can be opened.
export function safeUrl(url: string, base: string): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const GESTURES = new Set(["click", "key"]);

export class InteractionRunner {
  private hoverPrev = new Set<string>();
  private insidePrev = false;
  private scrollPrev: number | null = null;
  private visibleFired = false;
  private fired = new Set<number>();
  private queue: { name: string; payload?: unknown }[] = [];

  constructor(readonly defs: InteractionDef[], private host: InteractionHost) {}

  // Object ids interactions listen to (pickable + pointer cursor).
  targets(): Set<string> {
    const out = new Set<string>();
    for (const d of this.defs) if (d.target && (d.on === "click" || d.on === "hover" || d.on === "hoverEnd")) out.add(d.target);
    return out;
  }

  reset(): void {
    this.hoverPrev.clear();
    this.insidePrev = false;
    this.scrollPrev = null;
    this.visibleFired = false;
    this.fired.clear();
    this.queue = [];
  }

  // Queue an event (markers, emit actions, player.emit) for { on: "event" }.
  event(name: string, payload?: unknown): void {
    if (this.queue.length < 64) this.queue.push({ name, payload });
  }

  // Run matching interactions; `gesture` allows openUrl.
  fire(on: string, target: string | undefined, gesture: boolean): number {
    let n = 0;
    this.defs.forEach((d, i) => {
      if (d.on !== on) return;
      if (on === "key" ? d.key !== target : on === "event" ? d.event !== target : (d.target ?? undefined) !== target) return;
      if (d.once && this.fired.has(i)) return;
      this.fired.add(i);
      n++;
      for (const a of d.do ?? []) this.run(a, gesture && GESTURES.has(on));
    });
    return n;
  }

  step(f: InteractionFrame): void {
    // Hover enter / leave on objects.
    for (const id of this.targets()) {
      const now = f.hovered.has(id), before = this.hoverPrev.has(id);
      if (now && !before) this.fire("hover", id, false);
      if (!now && before) this.fire("hoverEnd", id, false);
    }
    this.hoverPrev = new Set([...f.hovered].filter((id) => this.isTarget(id)));
    // Canvas hover.
    if (f.pointerInside !== this.insidePrev) this.fire(f.pointerInside ? "hover" : "hoverEnd", undefined, false);
    this.insidePrev = f.pointerInside;
    // Clicks: the clicked objects, then the canvas.
    for (const id of f.clicked) this.fire("click", id, f.userGesture);
    if (f.canvasClicked) this.fire("click", undefined, f.userGesture);
    for (const code of f.pressed) this.fire("key", code, f.userGesture);
    if (f.visible && !this.visibleFired) {
      this.visibleFired = true;
      this.fire("visible", undefined, false);
    }
    // Scroll thresholds (downward crossings).
    if (this.scrollPrev !== null && f.scroll !== this.scrollPrev) {
      this.defs.forEach((d, i) => {
        if (d.on !== "scroll" || typeof d.at !== "number") return;
        const down = this.scrollPrev! < d.at && f.scroll >= d.at;
        if (!down || (d.once && this.fired.has(i))) return;
        this.fired.add(i);
        for (const a of d.do ?? []) this.run(a, false);
      });
    }
    this.scrollPrev = f.scroll;
    this.flush();
  }

  // Deliver queued events (chains are bounded).
  flush(): void {
    for (let guard = 0; this.queue.length && guard < 16; guard++) {
      const q = this.queue;
      this.queue = [];
      for (const e of q) this.fire("event", e.name, false);
    }
    this.queue = [];
  }

  private isTarget(id: string): boolean {
    return this.defs.some((d) => d.target === id);
  }

  private run(a: InteractionAction, gesture: boolean): void {
    const r = a as Record<string, unknown>;
    if (typeof r.play === "string") this.host.play(r.play, r.reverse === true);
    else if (typeof r.toggle === "string") this.host.toggle(r.toggle);
    else if (typeof r.seek === "number" || typeof r.seek === "string") this.host.seek(r.seek);
    else if (r.set && typeof r.set === "object") {
      const s = r.set as { path?: unknown; value?: unknown };
      if (typeof s.path === "string" && s.value !== undefined) this.host.set(s.path, s.value as KeyValue, typeof r.duration === "number" ? r.duration : 0, typeof r.ease === "string" ? r.ease : undefined);
    } else if (typeof r.emit === "string") this.host.emit(r.emit, r.payload);
    else if (typeof r.openUrl === "string") {
      if (gesture) this.host.openUrl(r.openUrl, typeof r.newTab === "boolean" ? r.newTab : undefined);
      else this.host.emit("openUrl", { url: r.openUrl, blocked: true });
    } else if (r.playClip !== undefined && typeof r.target === "string") {
      this.host.playClip(r.target, r.playClip as string | number, { loop: r.loop as boolean | undefined, speed: r.speed as number | undefined, crossfade: r.crossfade as number | undefined });
    }
  }
}
