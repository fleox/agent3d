// HUD: DOM overlay inside the player container. Elements are anchored
// (top-left … bottom-right), styled (plain / pill / title / subtitle), their
// text interpolates {placeholders} from the script state, `visible` is a
// boolean / state key / safe expression, buttons emit their `action`.

import type { UiDef, UiElementDef } from "../../core/types";
import { formatText, isVisible, lookup } from "./expr";

// The HUD is a 3 × 3 grid (rows top / middle / bottom, columns left /
// centre / right): anchors sharing a row never overlap — on a narrow phone
// the centre column takes at most 56 % of the width (the whole row when the
// row has no side anchor) and texts wrap instead of running under each
// other. Sizes follow the container (CSS container query units, with
// px fallbacks): fonts, paddings and buttons shrink down to a readable
// minimum (11–12 px) on small embeds and never grow past their desktop size.
const ANCHORS: Record<NonNullable<UiElementDef["anchor"]>, string> = {
  "top-left": "grid-row:1;grid-column:1;align-items:flex-start;align-self:start;",
  top: "grid-row:1;grid-column:2;align-items:center;align-self:start;text-align:center;",
  "top-right": "grid-row:1;grid-column:3;align-items:flex-end;align-self:start;text-align:right;",
  left: "grid-row:2;grid-column:1;align-items:flex-start;align-self:center;",
  center: "grid-row:2;grid-column:2;align-items:center;align-self:center;text-align:center;",
  right: "grid-row:2;grid-column:3;align-items:flex-end;align-self:center;text-align:right;",
  "bottom-left": "grid-row:3;grid-column:1;align-items:flex-start;align-self:end;",
  bottom: "grid-row:3;grid-column:2;align-items:center;align-self:end;text-align:center;",
  "bottom-right": "grid-row:3;grid-column:3;align-items:flex-end;align-self:end;text-align:right;",
};

// Font size that follows the container width (and height, for short wide
// embeds) between a minimum and the desktop size.
const fit = (min: number, cqw: number, max: number) => `font-size:${max}px;font-size:clamp(${min}px,min(${cqw}cqw,${(cqw * 1.6).toFixed(1)}cqh),${max}px)`;

const CSS = (font: string, color: string, accent: string) => `
.a3d-hud{position:absolute;inset:0;pointer-events:none;font-family:${font};color:${color};z-index:2;overflow:hidden;user-select:none;-webkit-user-select:none;container-type:size;display:grid;grid-template-columns:minmax(0,1fr) fit-content(56%) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto}
.a3d-zone{display:flex;flex-direction:column;gap:8px;gap:clamp(4px,1.6cqw,8px);padding:14px;padding:clamp(8px,2.6cqw,14px);min-width:0;max-width:100%;box-sizing:border-box}
.a3d-el{line-height:1.2;text-shadow:0 1px 3px rgba(0,0,0,.45);white-space:pre-line;overflow-wrap:break-word}
.a3d-plain{${fit(11, 3.2, 15)};font-weight:600}
.a3d-pill{${fit(11, 3, 14)};font-weight:700;padding:.43em 1em;border-radius:999px;background:rgba(0,0,0,.42);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);text-shadow:none}
.a3d-title{${fit(20, 7, 44)};font-weight:800;letter-spacing:-.01em}
.a3d-subtitle{${fit(12, 3.6, 18)};font-weight:500;opacity:.9}
.a3d-btn{pointer-events:auto;cursor:pointer;border:0;font:inherit;${fit(12, 3.4, 15)};font-weight:700;color:#fff;background:${accent};padding:.67em 1.47em;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.25);transition:transform .12s ease,filter .12s ease;text-shadow:none;min-height:36px}
.a3d-btn:hover{transform:translateY(-1px);filter:brightness(1.08)}.a3d-btn:active{transform:translateY(1px)}
.a3d-bar{width:160px;width:clamp(80px,30cqw,160px);height:10px;height:clamp(7px,2cqw,10px);border-radius:999px;background:rgba(0,0,0,.35);overflow:hidden}
.a3d-bar>i{display:block;height:100%;width:0;background:${accent};border-radius:inherit}
.a3d-toast{position:absolute;left:50%;bottom:18%;transform:translateX(-50%);max-width:86%;box-sizing:border-box;text-align:center;padding:.53em 1.2em;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-weight:700;${fit(12, 3.4, 15)};transition:opacity .25s ease;text-shadow:none}
.a3d-mute{pointer-events:auto;width:34px;height:34px;width:clamp(28px,8cqw,34px);height:clamp(28px,8cqw,34px);border-radius:50%;border:0;background:rgba(0,0,0,.4);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex:none}
.a3d-mute svg{width:55%;height:55%}
`;

const ICON_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>`;
const ICON_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/></svg>`;

interface ElState {
  def: UiElementDef;
  node: HTMLElement;
  fill?: HTMLElement;
  override: { text?: string; visible?: boolean; value?: number };
  last: string;
}

export interface Hud {
  root: HTMLElement;
  set(id: string, props: { text?: string; visible?: boolean; value?: number }): void;
  toast(text: string, seconds?: number, now?: number): void;
  update(state: Record<string, unknown>, now: number): void;
  setMuteButton(muted: boolean | null, onToggle?: () => void): void;
  dispose(): void;
}

export function createHud(container: HTMLElement, ui: UiDef | undefined, emit: (action: string) => void): Hud {
  const doc = container.ownerDocument;
  const root = doc.createElement("div");
  root.className = "a3d-hud";
  root.setAttribute("aria-live", "polite");
  const style = doc.createElement("style");
  style.textContent = CSS(ui?.font ?? "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", ui?.color ?? "#ffffff", ui?.accent ?? "#ff006e");
  root.appendChild(style);
  const zones = new Map<string, HTMLElement>();
  const zone = (anchor: string) => {
    let z = zones.get(anchor);
    if (!z) {
      z = doc.createElement("div");
      z.className = "a3d-zone";
      z.style.cssText = ANCHORS[anchor as keyof typeof ANCHORS] ?? ANCHORS["top-left"];
      z.dataset.anchor = anchor;
      root.appendChild(z);
      zones.set(anchor, z);
    }
    return z;
  };
  // A centre anchor spans its whole row when the row has no side anchor.
  const ROWS: [string, string, string][] = [
    ["top-left", "top", "top-right"],
    ["left", "center", "right"],
    ["bottom-left", "bottom", "bottom-right"],
  ];
  const layout = () => {
    for (const [l, c, r] of ROWS) {
      const z = zones.get(c);
      if (z) z.style.gridColumn = zones.has(l) || zones.has(r) ? "2" : "1 / -1";
    }
  };
  const els = new Map<string, ElState>();
  for (const def of ui?.elements ?? []) {
    let node: HTMLElement;
    let fill: HTMLElement | undefined;
    if (def.type === "button") {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "a3d-btn";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (def.action) emit(def.action);
      });
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      node = b;
    } else if (def.type === "bar") {
      node = doc.createElement("div");
      node.className = "a3d-bar";
      fill = doc.createElement("i");
      node.appendChild(fill);
    } else {
      node = doc.createElement("div");
      node.className = `a3d-el a3d-${def.style ?? "plain"}`;
    }
    node.dataset.id = def.id;
    zone(def.anchor ?? "top-left").appendChild(node);
    els.set(def.id, { def, node, fill, override: {}, last: "" });
  }
  layout();
  container.appendChild(root);

  let toastEl: HTMLElement | null = null;
  let toastUntil = 0;
  let toastPending: { text: string; seconds: number } | null = null;
  let muteBtn: HTMLButtonElement | null = null;

  return {
    root,
    set(id, props) {
      const el = els.get(id);
      if (el) Object.assign(el.override, props);
    },
    toast(text, seconds = 2) {
      toastPending = { text, seconds };
    },
    update(state, now) {
      for (const el of els.values()) {
        const visible = el.override.visible ?? isVisible(el.def.visible, state);
        el.node.style.display = visible ? "" : "none";
        if (!visible) continue;
        if (el.def.type === "bar") {
          const raw = el.override.value ?? Number(el.def.value ? lookup(state, el.def.value) : 0);
          const v = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
          el.fill!.style.width = `${(v * 100).toFixed(1)}%`;
          continue;
        }
        const text = el.override.text ?? formatText(el.def.text ?? "", state);
        if (text !== el.last) {
          el.node.textContent = text;
          el.last = text;
        }
      }
      if (toastPending) {
        if (!toastEl) {
          toastEl = doc.createElement("div");
          toastEl.className = "a3d-toast";
          root.appendChild(toastEl);
        }
        toastEl.textContent = toastPending.text;
        toastEl.style.opacity = "1";
        toastUntil = now + toastPending.seconds;
        toastPending = null;
      }
      if (toastEl && now > toastUntil) toastEl.style.opacity = "0";
    },
    setMuteButton(muted, onToggle) {
      if (muted === null) {
        muteBtn?.remove();
        muteBtn = null;
        return;
      }
      if (!muteBtn) {
        muteBtn = doc.createElement("button");
        muteBtn.type = "button";
        muteBtn.className = "a3d-mute";
        muteBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        muteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          onToggle?.();
        });
        // Last item of the bottom-right zone: stacked under (never over) its elements.
        zone("bottom-right").appendChild(muteBtn);
        layout();
      }
      muteBtn.innerHTML = muted ? ICON_OFF : ICON_ON;
      muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    },
    dispose() {
      root.remove();
    },
  };
}
