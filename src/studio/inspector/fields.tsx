// Catalog-driven fields: one ParamSpec → one control. Values equal to the
// catalog default are dropped from the scene (kept small and readable).

import { useEffect, useState } from "react";
import type { ParamSpec } from "../../core/catalog";
import { ColorField, ColorsField } from "../components/ui/ColorField";
import { NumberField, SliderField, VecField } from "../components/ui/NumberField";
import { Row, Select, TextField, Toggle } from "../components/ui/controls";
import { paramUpdate, paramValue } from "../lib/params";
import type { PatchOp } from "../../ops/scene";
import { fieldOps } from "../lib/patches";
import { useEditor, useSnapshot } from "../state/context";
import { fieldLabel } from "../lib/labels";
import { useI18n } from "../i18n";

export type OnValue = (value: unknown, final: boolean) => void;


export function ParamControl({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: OnValue }) {
  const shown = paramValue(spec, value);
  const isDefault = value === undefined;
  const empty = isDefault && spec.default === undefined;
  const set = (raw: unknown, final: boolean) => {
    const u = paramUpdate(spec, raw);
    if (!u.ok) return;
    onChange(u.drop ? undefined : u.value, final);
  };
  switch (spec.type) {
    case "number":
    case "integer":
      if (spec.min !== undefined && spec.max !== undefined && spec.max - spec.min <= 10000)
        return <SliderField value={Number(shown) || 0} min={spec.min} max={spec.max} integer={spec.type === "integer"} placeholder={isDefault} empty={empty} onChange={(n, f) => set(n, f)} ariaLabel={spec.name} />;
      return <NumberField value={Number(shown) || 0} min={spec.min} max={spec.max} integer={spec.type === "integer"} placeholder={isDefault} empty={empty} onChange={(n, f) => set(n, f)} ariaLabel={spec.name} />;
    case "boolean":
      return <Toggle checked={!!shown} onChange={(v) => set(v, true)} ariaLabel={spec.name} />;
    case "color":
      return <ColorField value={String(shown)} placeholder={isDefault} onChange={(v, f) => set(v, f)} />;
    case "colors":
      return <ColorsField value={Array.isArray(shown) ? (shown as string[]) : []} onChange={(v, f) => set(v, f)} />;
    case "vec2":
    case "vec3":
      return <VecField value={Array.isArray(shown) ? (shown as number[]) : spec.type === "vec2" ? [0, 0] : [0, 0, 0]} labels={spec.type === "vec2" ? ["X", "Y"] : undefined} placeholder={isDefault} onChange={(v, f) => set(v, f)} />;
    case "enum":
      return <Select value={String(shown ?? "")} options={spec.options ?? []} onChange={(v) => set(v, true)} ariaLabel={spec.name} />;
    case "array":
      if (spec.options?.length) return <ChipsField value={Array.isArray(shown) ? (shown as string[]) : []} options={spec.options} onChange={(v) => set(v, true)} />;
      return (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <JsonField value={shown} onCommit={(v) => set(v, true)} />
          {spec.description && <span className="text-[10px] leading-snug text-fg-faint">{spec.description}</span>}
        </div>
      );
    case "string":
      return <TextField value={String(shown ?? "")} onCommit={(v) => onChange(v === "" ? undefined : v, true)} ariaLabel={spec.name} />;
    default:
      return <JsonField value={shown} onCommit={(v) => set(v, true)} />;
  }
}

// Multi-select of catalog options (array params with `options`, e.g. character accessories).
export function ChipsField({ value, options, onChange }: { value: string[]; options: readonly string[]; onChange(v: string[]): void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap gap-1 py-0.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`h-5 rounded-full border px-2 text-2xs transition-colors ${on ? "border-accent/60 bg-accent/15 text-accent" : "border-line text-fg-muted hover:border-fg-faint hover:text-fg"}`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function JsonField({ value, onCommit, rows = 3 }: { value: unknown; onCommit(v: unknown): void; rows?: number }) {
  const text = JSON.stringify(value ?? null);
  const [draft, setDraft] = useState(text);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setDraft(text);
    setBad(false);
  }, [text]);
  return (
    <textarea
      value={draft}
      rows={rows}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        try {
          const v = JSON.parse(draft);
          setBad(false);
          if (JSON.stringify(v) !== text) onCommit(v);
        } catch {
          setBad(true);
        }
      }}
      className={`field h-auto resize-y py-1 font-mono text-2xs leading-snug ${bad ? "border-danger/70" : ""}`}
    />
  );
}

export function ParamRow({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: OnValue }) {
  useI18n(); // re-render on language change
  return (
    <Row label={fieldLabel(spec.name)} hint={spec.description} overridden={value !== undefined} onReset={() => onChange(undefined, true)} align={(spec.type === "array" && !spec.options?.length) || spec.type === "object" ? "start" : "center"}>
      <ParamControl spec={spec} value={value} onChange={onChange} />
    </Row>
  );
}

// Fields of one object in the scene (`base` path, e.g. "objects#logo.geometry").
export function ParamForm({ specs, base, values, skip }: { specs: readonly ParamSpec[]; base: string; values: Record<string, unknown> | undefined; skip?: string[] }) {
  const bind = useBinder();
  return (
    <>
      {specs
        .filter((p) => !skip?.includes(p.name))
        .map((p) => (
          <ParamRow key={p.name} spec={p} value={values?.[p.name]} onChange={(v, f) => bind(base ? `${base}.${p.name}` : p.name, v, f)} />
        ))}
    </>
  );
}

// Returns set(path, value | undefined, final): one scene_patch op (coalesced per path while dragging).
export function useBinder(): (path: string, value: unknown, final?: boolean, extra?: PatchOp[]) => void {
  const { edit, store } = useEditor();
  useSnapshot();
  return (path, value, _final = true, extra = []) => {
    const scene = store.getSnapshot().scene;
    if (!scene) return;
    const ops = [...fieldOps(scene, path, value), ...extra];
    if (ops.length) edit(ops, { coalesce: `field:${path}` });
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// Fields of a value that may be a shorthand (true, a preset id, false) or an
// object: editing a field writes the whole object back, and `collapse` turns
// an object with nothing left into its shorthand again (e.g. {} → true).
export function SubForm({ specs, path, value, expand, collapse, skip }: { specs: readonly ParamSpec[]; path: string; value: unknown; expand?(v: unknown): Record<string, unknown>; collapse?(obj: Record<string, unknown>): unknown; skip?: string[] }) {
  const bind = useBinder();
  const obj = isRecord(value) ? value : expand ? expand(value) : {};
  return (
    <>
      {specs
        .filter((p) => !skip?.includes(p.name))
        .map((p) => (
          <ParamRow
            key={p.name}
            spec={p}
            value={obj[p.name]}
            onChange={(v, f) => {
              const next: Record<string, unknown> = { ...obj };
              if (v === undefined) delete next[p.name];
              else next[p.name] = v;
              bind(path, collapse ? collapse(next) : next, f);
            }}
          />
        ))}
    </>
  );
}
