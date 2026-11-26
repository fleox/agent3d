// Pointer / keyboard / touch input of a player. Listeners are attached to the
// container (pointer) and to window (keyboard) — keys are only captured while
// the container is focused or hovered, or after a first pointer interaction
// with it; page scroll keys are only prevented for `target.kind: "game"`.

import { scrollRect } from "./scrollTarget";

export interface InputState {
  pointer: { x: number; y: number; inside: boolean; down: boolean; justPressed: boolean };
  keys: Set<string>;
  pressed: Set<string>;
  swipe: "left" | "right" | "up" | "down" | null;
  clicks: { x: number; y: number }[]; // pending clicks (normalised) for this frame
  scroll: number;
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "PageUp", "PageDown", "Home", "End"]);

export function createInputState(): InputState {
  return { pointer: { x: 0, y: 0, inside: false, down: false, justPressed: false }, keys: new Set(), pressed: new Set(), swipe: null, clicks: [], scroll: 0 };
}

export function endFrame(s: InputState): void {
  s.pressed.clear();
  s.pointer.justPressed = false;
  s.swipe = null;
  s.clicks.length = 0;
}

export function setKey(s: InputState, code: string, down: boolean): void {
  if (down) {
    if (!s.keys.has(code)) s.pressed.add(code);
    s.keys.add(code);
  } else s.keys.delete(code);
}

export interface InputBinding {
  dispose(): void;
}

export function bindInput(container: HTMLElement, s: InputState, opts: { game: boolean; onPointerMove?(): void }): InputBinding {
  const win = container.ownerDocument.defaultView ?? window;
  let engaged = false;
  let hovered = false;
  let start: { x: number; y: number; t: number; px: number; py: number } | null = null;

  const norm = (e: PointerEvent | MouseEvent) => {
    const r = container.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, y: -(((e.clientY - r.top) / Math.max(r.height, 1)) * 2 - 1) };
  };
  const onMove = (e: PointerEvent) => {
    const p = norm(e);
    s.pointer.x = p.x;
    s.pointer.y = p.y;
    s.pointer.inside = true;
    opts.onPointerMove?.();
  };
  const onEnter = () => {
    hovered = true;
    s.pointer.inside = true;
  };
  const onLeave = () => {
    hovered = false;
    s.pointer.inside = false;
    s.pointer.down = false;
  };
  const onDown = (e: PointerEvent) => {
    engaged = true;
    const p = norm(e);
    s.pointer.x = p.x;
    s.pointer.y = p.y;
    s.pointer.down = true;
    s.pointer.justPressed = true;
    start = { x: p.x, y: p.y, t: performance.now(), px: e.clientX, py: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    s.pointer.down = false;
    if (!start) return;
    const dx = e.clientX - start.px, dy = e.clientY - start.py;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) s.clicks.push(norm(e));
    else if (dist > 30 && performance.now() - start.t < 600) {
      s.swipe = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    }
    start = null;
  };
  const active = () => engaged || hovered || container.contains(container.ownerDocument.activeElement);
  const onKey = (e: KeyboardEvent) => {
    if (!active()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    setKey(s, e.code, e.type === "keydown");
    if (opts.game && SCROLL_KEYS.has(e.code)) e.preventDefault();
  };
  const onBlur = () => s.keys.clear();
  const onDocDown = (e: Event) => {
    if (!container.contains(e.target as Node)) engaged = false;
  };

  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerenter", onEnter);
  container.addEventListener("pointerleave", onLeave);
  container.addEventListener("pointerdown", onDown);
  win.addEventListener("pointerup", onUp);
  win.addEventListener("keydown", onKey, { passive: false });
  win.addEventListener("keyup", onKey);
  win.addEventListener("blur", onBlur);
  win.document.addEventListener("pointerdown", onDocDown, true);
  if (opts.game) {
    container.style.touchAction = "none";
    if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "0");
  }
  return {
    dispose() {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerenter", onEnter);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointerdown", onDown);
      win.removeEventListener("pointerup", onUp);
      win.removeEventListener("keydown", onKey);
      win.removeEventListener("keyup", onKey);
      win.removeEventListener("blur", onBlur);
      win.document.removeEventListener("pointerdown", onDocDown, true);
    },
  };
}

// Scroll progress of an element through the viewport: 0 when its top enters
// at the bottom, 1 when its bottom leaves at the top.
export function scrollProgress(el: HTMLElement): number {
  const win = el.ownerDocument.defaultView;
  if (!win) return 0;
  const r = scrollRect(el);
  const vh = win.innerHeight || 1;
  const p = (vh - r.top) / (vh + r.height);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
