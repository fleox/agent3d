// Colour: swatch (native picker) + CSS text. Non-hex CSS colours are kept
// as typed; the swatch converts them for the picker.

import clsx from "clsx";
import { Plus, X } from "lucide-react";
import { useRef } from "react";
import { isValidColor, parseColor, toHex } from "../../../core/color";
import { TextField } from "./controls";

export function hexOf(c: string | undefined): string {
  const p = c ? parseColor(c) : null;
  return p ? toHex(p) : "#000000";
}

export function Swatch({ value, onChange, final, className, ariaLabel }: { value: string; onChange(v: string, final: boolean): void; final?: boolean; className?: string; ariaLabel?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className={clsx("relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-[5px] border border-white/10", className)} style={{ background: isValidColor(value) ? value : "transparent" }} title={value}>
      <input
        ref={ref}
        type="color"
        aria-label={ariaLabel ?? "Colour"}
        value={hexOf(value)}
        onInput={(e) => onChange((e.target as HTMLInputElement).value, !!final)}
        onChange={(e) => onChange(e.target.value, true)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

export function ColorField({ value, onChange, placeholder }: { value: string; onChange(v: string, final: boolean): void; placeholder?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Swatch value={value} onChange={onChange} />
      <TextField value={value} onCommit={(v) => isValidColor(v.trim()) && onChange(v.trim(), true)} className={clsx("font-mono text-xs", placeholder && "text-fg-faint")} ariaLabel="Colour value" />
    </div>
  );
}

export function ColorsField({ value, onChange }: { value: string[]; onChange(v: string[], final: boolean): void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      {value.map((c, i) => (
        <div key={i} className="group/sw relative">
          <Swatch
            value={c}
            onChange={(v, final) => {
              const next = [...value];
              next[i] = v;
              onChange(next, final);
            }}
          />
          {value.length > 1 && (
            <button type="button" aria-label="Remove colour" onClick={() => onChange(value.filter((_, j) => j !== i), true)} className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-ink-4 text-fg group-hover/sw:flex">
              <X size={9} />
            </button>
          )}
        </div>
      ))}
      <button type="button" aria-label="Add colour" onClick={() => onChange([...value, value[value.length - 1] ?? "#ffffff"], true)} className="flex h-6 w-6 items-center justify-center rounded-[5px] border border-dashed border-line text-fg-faint hover:border-fg-faint hover:text-fg">
        <Plus size={11} />
      </button>
    </div>
  );
}
