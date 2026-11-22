// Easing picker: named curves (with thumbnails), a cubic-bezier editor with
// two draggable handles, spring (stiffness / damping / mass) and steps.

import clsx from "clsx";
import { useRef } from "react";
import { EASE_NAMES, type ParsedEase } from "../../core/ease";
import { useI18n } from "../i18n";
import { BEZIER_PRESETS, DEFAULTS, curvePath, curveRange, formatEase, parsedOf, type EaseKind } from "../lib/easeEdit";
import { NumberField, SliderField } from "./ui/NumberField";
import { PickerButton, Popover } from "./ui/Popover";
import { Toggle } from "./ui/controls";

export function EaseCurve({ spec, size = 14, className }: { spec: string; size?: number; className?: string }) {
  const range = curveRange(spec);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={clsx("shrink-0", className)} aria-hidden>
      <path d={curvePath(spec, size, size, { pad: 1.5, range, samples: 32 })} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}

const FAMILIES = ["Sine", "Quad", "Cubic", "Quart", "Quint", "Expo", "Circ", "Back", "Elastic", "Bounce"];

export function EaseField({ value, onChange, placeholder = "linear", allowInherit, compact, ariaLabel }: { value: string | undefined; onChange(v: string | undefined): void; placeholder?: string; allowInherit?: string; compact?: boolean; ariaLabel?: string }) {
  const { t } = useI18n();
  const shown = value ?? placeholder;
  return (
    <Popover
      width={300}
      align="start"
      trigger={(open, isOpen) =>
        compact ? (
          <button type="button" onClick={open} aria-label={ariaLabel ?? t("ease.title")} title={shown} className={clsx("flex h-5 min-w-0 max-w-full items-center gap-1 rounded px-1 text-2xs hover:bg-ink-3", value ? "text-fg-muted" : "text-fg-faint", isOpen && "bg-ink-3")}>
            <EaseCurve spec={shown} size={12} />
            <span className="truncate">{shown}</span>
          </button>
        ) : (
          <PickerButton onClick={open} open={isOpen} ariaLabel={ariaLabel ?? t("ease.title")}>
            <EaseCurve spec={shown} className="text-key" />
            <span className={clsx("truncate font-mono text-xs", !value && "text-fg-faint")}>{shown}</span>
          </PickerButton>
        )
      }
    >
      {() => <EaseEditor value={value} placeholder={placeholder} onChange={onChange} allowInherit={allowInherit} />}
    </Popover>
  );
}

function EaseEditor({ value, placeholder, onChange, allowInherit }: { value: string | undefined; placeholder: string; onChange(v: string | undefined): void; allowInherit?: string }) {
  const { t } = useI18n();
  const parsed = parsedOf(value, placeholder);
  const set = (p: ParsedEase) => onChange(formatEase(p));
  const tabs: EaseKind[] = ["named", "cubicBezier", "spring", "steps"];
  return (
    <div className="p-2">
      <div className="mb-2 flex gap-0.5 rounded-md bg-ink-2 p-0.5" role="tablist">
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={parsed.kind === k} onClick={() => parsed.kind !== k && set(DEFAULTS[k])} className={clsx("h-6 flex-1 rounded text-2xs font-medium", parsed.kind === k ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}>
            {t(`ease.${k}`)}
          </button>
        ))}
      </div>
      {allowInherit !== undefined && (
        <button type="button" onClick={() => onChange(undefined)} className={clsx("mb-2 w-full rounded-md border px-2 py-1 text-left text-2xs", value === undefined ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-fg-muted hover:text-fg")}>
          {allowInherit}
        </button>
      )}
      {parsed.kind === "named" && (
        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-1">
            {["linear", "step"].map((n) => (
              <NamedCell key={n} name={n} active={parsed.name === n} onPick={() => set({ kind: "named", name: n })} />
            ))}
          </div>
          <div className="grid grid-cols-[52px_repeat(3,1fr)] items-center gap-1">
            <span />
            {["in", "out", "inOut"].map((d) => (
              <span key={d} className="text-center text-2xs text-fg-faint">
                {d}
              </span>
            ))}
            {FAMILIES.map((f) => (
              <FamilyRow key={f} family={f} current={parsed.name} onPick={(name) => set({ kind: "named", name })} />
            ))}
          </div>
        </div>
      )}
      {parsed.kind === "cubicBezier" && (
        <div className="space-y-2">
          <BezierEditor value={[parsed.x1, parsed.y1, parsed.x2, parsed.y2]} onChange={([x1, y1, x2, y2]) => set({ kind: "cubicBezier", x1, y1, x2, y2 })} />
          <div className="grid grid-cols-4 gap-1">
            {(["x1", "y1", "x2", "y2"] as const).map((k, i) => (
              <NumberField key={k} label={k[0].toUpperCase()} value={[parsed.x1, parsed.y1, parsed.x2, parsed.y2][i]} min={i % 2 === 0 ? 0 : -2} max={i % 2 === 0 ? 1 : 3} step={0.01} onChange={(n) => set({ ...parsed, [k]: n })} ariaLabel={k} />
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {BEZIER_PRESETS.map((p) => (
              <button key={p.name} type="button" onClick={() => set({ kind: "cubicBezier", x1: p.v[0], y1: p.v[1], x2: p.v[2], y2: p.v[3] })} className="flex h-5 items-center gap-1 rounded border border-line px-1.5 text-2xs text-fg-muted hover:border-fg-faint hover:text-fg">
                <EaseCurve spec={`cubicBezier(${p.v.join(", ")})`} size={10} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {parsed.kind === "spring" && (
        <div className="space-y-1.5">
          <CurvePreview spec={formatEase(parsed)} />
          <Labeled label={t("ease.stiffness")}>
            <SliderField value={parsed.stiffness} min={10} max={600} step={1} onChange={(n) => set({ ...parsed, stiffness: n })} ariaLabel={t("ease.stiffness")} />
          </Labeled>
          <Labeled label={t("ease.damping")}>
            <SliderField value={parsed.damping} min={1} max={60} step={0.5} onChange={(n) => set({ ...parsed, damping: n })} ariaLabel={t("ease.damping")} />
          </Labeled>
          <Labeled label={t("ease.mass")}>
            <SliderField value={parsed.mass} min={0.1} max={5} step={0.1} onChange={(n) => set({ ...parsed, mass: n })} ariaLabel={t("ease.mass")} />
          </Labeled>
          <p className="text-2xs leading-snug text-fg-faint">{t("ease.springHint")}</p>
        </div>
      )}
      {parsed.kind === "steps" && (
        <div className="space-y-1.5">
          <CurvePreview spec={formatEase(parsed)} />
          <Labeled label={t("ease.count")}>
            <SliderField value={parsed.count} min={1} max={24} integer onChange={(n) => set({ ...parsed, count: Math.max(1, Math.round(n)) })} ariaLabel={t("ease.count")} />
          </Labeled>
          <Labeled label={t("ease.jumpStart")}>
            <Toggle checked={parsed.jumpStart} onChange={(v) => set({ ...parsed, jumpStart: v })} ariaLabel={t("ease.jumpStart")} />
          </Labeled>
        </div>
      )}
      <div className="mt-2 truncate rounded bg-ink-0 px-2 py-1 font-mono text-2xs text-fg-muted">{value ?? placeholder}</div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[70px_1fr] items-center gap-2">
      <span className="text-2xs text-fg-muted">{label}</span>
      <div className="flex min-w-0">{children}</div>
    </div>
  );
}

function NamedCell({ name, active, onPick, label }: { name: string; active: boolean; onPick(): void; label?: string }) {
  return (
    <button type="button" title={name} aria-pressed={active} onClick={onPick} className={clsx("flex h-6 items-center justify-center gap-1 rounded border text-2xs", active ? "border-accent/70 bg-accent/15 text-accent" : "border-line text-fg-muted hover:border-fg-faint hover:text-fg")}>
      <EaseCurve spec={name} size={14} />
      {label ?? name}
    </button>
  );
}

function FamilyRow({ family, current, onPick }: { family: string; current: string; onPick(name: string): void }) {
  return (
    <>
      <span className="text-2xs text-fg-muted">{family}</span>
      {["in", "out", "inOut"].map((d) => {
        const name = `${d}${family}`;
        if (!EASE_NAMES.includes(name)) return <span key={d} />;
        return (
          <button key={d} type="button" title={name} aria-label={name} aria-pressed={current === name} onClick={() => onPick(name)} className={clsx("flex h-6 items-center justify-center rounded border", current === name ? "border-accent/70 bg-accent/15 text-accent" : "border-line text-fg-muted hover:border-fg-faint hover:text-fg")}>
            <EaseCurve spec={name} size={16} />
          </button>
        );
      })}
    </>
  );
}

function CurvePreview({ spec }: { spec: string }) {
  const range = curveRange(spec);
  const W = 284;
  const H = 70;
  const y = (v: number) => H - 4 - ((v - range[0]) / (range[1] - range[0] || 1)) * (H - 8);
  return (
    <svg width={W} height={H} className="block rounded-md bg-ink-0" aria-hidden>
      <line style={{ stroke: "rgb(var(--line))" }} x1={4} x2={W - 4} y1={y(1)} y2={y(1)} strokeDasharray="3 3" />
      <line style={{ stroke: "rgb(var(--line))" }} x1={4} x2={W - 4} y1={y(0)} y2={y(0)} />
      <path style={{ stroke: "rgb(var(--key))" }} d={curvePath(spec, W, H, { pad: 4, range, samples: 96 })} fill="none" strokeWidth={1.6} />
    </svg>
  );
}

// Cubic-bezier curve editor: drag the two handles (x clamped to 0..1, y may overshoot).
export function BezierEditor({ value, onChange }: { value: [number, number, number, number]; onChange(v: [number, number, number, number]): void }) {
  const S = 180; // unit square size in px
  const PAD_Y = 50; // room for overshoot above / below
  const PAD_X = 12;
  const W = S + PAD_X * 2;
  const H = S + PAD_Y * 2;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  const px = (x: number) => PAD_X + x * S;
  const py = (y: number) => PAD_Y + (1 - y) * S;
  const [x1, y1, x2, y2] = value;
  const fromEvent = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left - PAD_X) / S));
    const y = Math.max(-PAD_Y / S, Math.min(1 + PAD_Y / S, 1 - (e.clientY - r.top - PAD_Y) / S));
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as const;
  };
  const move = (e: React.PointerEvent) => {
    if (drag.current === null) return;
    const [x, y] = fromEvent(e);
    onChange(drag.current === 0 ? [x, y, x2, y2] : [x1, y1, x, y]);
  };
  const handle = (i: 0 | 1, hx: number, hy: number, ox: number, oy: number) => (
    <g>
      <line style={{ stroke: "rgb(var(--accent))" }} x1={px(ox)} y1={py(oy)} x2={px(hx)} y2={py(hy)} strokeWidth={1} opacity={0.7} />
      <circle style={{ fill: "rgb(var(--ink-1))", stroke: "rgb(var(--accent))" }}
        cx={px(hx)}
        cy={py(hy)}
        r={6}
       
       
        strokeWidth={2}
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = i;
        }}
        role="slider"
        aria-label={`handle ${i + 1}`}
        aria-valuenow={hx}
      />
    </g>
  );
  return (
    <svg ref={svg} width={W} height={H} className="mx-auto block touch-none select-none rounded-md bg-ink-0" onPointerMove={move} onPointerUp={() => (drag.current = null)}>
      <rect style={{ stroke: "rgb(var(--line))" }} x={PAD_X} y={PAD_Y} width={S} height={S} fill="none" />
      {[0.25, 0.5, 0.75].map((g) => (
        <g style={{ stroke: "rgb(var(--line))" }} key={g} strokeDasharray="2 4">
          <line x1={px(g)} x2={px(g)} y1={PAD_Y} y2={PAD_Y + S} />
          <line y1={py(g)} y2={py(g)} x1={PAD_X} x2={PAD_X + S} />
        </g>
      ))}
      <line style={{ stroke: "rgb(var(--fg-faint))" }} x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} strokeDasharray="3 3" opacity={0.5} />
      <path style={{ stroke: "rgb(var(--key))" }} d={`M${px(0)} ${py(0)} C${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${px(1)} ${py(1)}`} fill="none" strokeWidth={2} />
      {handle(0, x1, y1, 0, 0)}
      {handle(1, x2, y2, 1, 1)}
    </svg>
  );
}
