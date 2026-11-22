// Interactions (scene.interactions): no-code triggers → actions. One card per
// interaction: when (click / hover / key / scroll / event…, target picker)
// → do (play / toggle a segment, seek, set a property, emit, open a URL,
// play a model clip). "Test" fires it in the viewport.

import clsx from "clsx";
import { AlertTriangle, MousePointerClick, Plus, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { InteractionAction, InteractionDef, KeyValue } from "../../core/types";
import { EaseField } from "../components/EaseField";
import { NumberField, SliderField } from "../components/ui/NumberField";
import { Button, IconButton, Select, TextField, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { JsonField } from "../inspector/fields";
import { INTERACTION_ACTIONS, INTERACTION_ON, TARGETED, actionKind, isAllowedUrl, actionProblem, defaultAction, defaultInteraction, modelIds, segmentNames, setPathSuggestions, withTrigger, type ActionKind, type OnKind } from "../lib/interactions";
import { allObjectIds } from "../../ops/tree";
import { useEditor, useSnapshot } from "../state/context";

export function InteractionsPanel() {
  const { t } = useI18n();
  const { edit } = useEditor();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const list = scene.interactions ?? [];
  const write = (next: InteractionDef[], coalesce?: string) => edit(next.length ? [{ op: "set", path: "interactions", value: next }] : list.length ? [{ op: "remove", path: "interactions" }] : [], coalesce ? { coalesce } : undefined);
  const update = (i: number, it: InteractionDef, coalesce?: string) => write(list.map((x, j) => (j === i ? it : x)), coalesce);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <Zap size={12} className="text-accent" />
        <span className="text-xs text-fg-muted">{t("interactions.intro")}</span>
        <Button size="xs" variant="subtle" className="ml-auto" onClick={() => write([...list, defaultInteraction(scene)])}>
          <Plus size={11} /> {t("interactions.add")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!list.length && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-xs text-fg-faint">
            <MousePointerClick size={18} />
            <div>{t("interactions.empty")}</div>
            <div className="max-w-md text-2xs">{t("interactions.emptyHint")}</div>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-2">
          {list.map((it, i) => (
            <InteractionCard key={i} it={it} index={i} onChange={(next, c) => update(i, next, c)} onRemove={() => write(list.filter((_, j) => j !== i))} />
          ))}
        </div>
      </div>
    </div>
  );
}

function InteractionCard({ it, index, onChange, onRemove }: { it: InteractionDef; index: number; onChange(it: InteractionDef, coalesce?: string): void; onRemove(): void }) {
  const { t } = useI18n();
  const { player } = useEditor();
  const scene = useSnapshot().scene!;
  const ids = allObjectIds(scene);
  const markers = Object.keys(scene.timeline?.markers ?? {});
  const on = it.on as OnKind;
  const setAction = (j: number, a: InteractionAction, coalesce?: string) => onChange({ ...it, do: it.do.map((x, k) => (k === j ? a : x)) }, coalesce);
  return (
    <div className="rounded-lg border border-line bg-ink-0/40">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 px-2 py-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-fg-faint">{t("interactions.when")}</span>
        <Select value={on} options={INTERACTION_ON.map((o) => ({ value: o, label: t(`interactions.on.${o}`) }))} onChange={(v) => onChange(withTrigger(it, v as OnKind, scene))} className="w-[118px] flex-none" ariaLabel={t("interactions.when")} />
        {TARGETED.includes(on) && <Select value={it.target ?? ""} placeholder={t("interactions.anywhere")} options={ids} onChange={(v) => onChange({ ...it, target: v || undefined })} className="w-[130px] flex-none" ariaLabel={t("interactions.target")} />}
        {on === "key" && <TextField value={it.key ?? ""} placeholder="Space, KeyE, ArrowRight" onCommit={(v) => onChange({ ...it, key: v.trim() })} mono className="w-[130px] flex-none" ariaLabel={t("interactions.key")} />}
        {on === "event" && (
          <>
            <TextField value={it.event ?? ""} placeholder={t("interactions.eventName")} onCommit={(v) => onChange({ ...it, event: v.trim() })} mono className="w-[110px] flex-none" ariaLabel={t("interactions.eventName")} />
            {markers.length > 0 && <Select value="" placeholder={t("interactions.marker")} options={markers} onChange={(v) => v && onChange({ ...it, event: v })} className="w-[90px] flex-none" ariaLabel={t("interactions.marker")} />}
          </>
        )}
        {on === "scroll" && (
          <div className="flex w-[150px] items-center">
            <SliderField value={it.at ?? 0.5} min={0} max={1} onChange={(n, f) => onChange({ ...it, at: n }, f ? undefined : `ix:${index}:at`)} ariaLabel={t("interactions.at")} />
          </div>
        )}
        <label className="ml-auto flex items-center gap-1 text-2xs text-fg-muted" title={t("interactions.onceHint")}>
          {t("interactions.once")}
          <Toggle checked={!!it.once} onChange={(v) => onChange({ ...it, once: v || undefined })} ariaLabel={t("interactions.once")} />
        </label>
        <Button size="xs" variant="ghost" title={t("interactions.testHint")} onClick={() => player.player?.trigger?.(on, on === "key" ? it.key : on === "event" ? it.event : it.target)}>
          <Zap size={11} /> {t("interactions.test")}
        </Button>
        <IconButton label={t("interactions.remove")} className="h-6 w-6" onClick={onRemove}>
          <X size={12} />
        </IconButton>
      </div>
      <div className="space-y-1 p-2">
        {it.do.map((a, j) => (
          <ActionRow key={j} action={a} on={on} index={index} j={j} onChange={(next, c) => setAction(j, next, c)} onRemove={it.do.length > 1 ? () => onChange({ ...it, do: it.do.filter((_, k) => k !== j) }) : undefined} />
        ))}
        <Button size="xs" variant="ghost" onClick={() => onChange({ ...it, do: [...it.do, defaultAction("emit", scene)] })}>
          <Plus size={11} /> {t("interactions.addAction")}
        </Button>
      </div>
    </div>
  );
}

function ActionRow({ action: a, on, index, j, onChange, onRemove }: { action: InteractionAction; on: OnKind; index: number; j: number; onChange(a: InteractionAction, coalesce?: string): void; onRemove?: () => void }) {
  const { t } = useI18n();
  const scene = useSnapshot().scene!;
  const kind = actionKind(a);
  const segs = segmentNames(scene);
  const markers = Object.keys(scene.timeline?.markers ?? {});
  const problem = actionProblem(a, on);
  const key = `ix:${index}:${j}`;
  return (
    <div className={clsx("rounded-md border px-1.5 py-1", problem ? "border-danger/50 bg-danger/5" : "border-line/70")}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-5 text-center text-2xs text-fg-faint">{j === 0 ? "→" : "+"}</span>
        <Select value={kind ?? ""} options={INTERACTION_ACTIONS.map((k) => ({ value: k, label: t(`interactions.do.${k}`) }))} onChange={(v) => onChange(defaultAction(v as ActionKind, scene))} className="w-[128px] flex-none" ariaLabel={t("interactions.action")} />
        {"play" in a && (
          <>
            <Select value={a.play} options={segs} onChange={(v) => onChange({ ...a, play: v })} className="w-[120px] flex-none" ariaLabel={t("interactions.segment")} />
            <label className="flex items-center gap-1 text-2xs text-fg-muted">
              {t("interactions.reverse")}
              <Toggle checked={!!a.reverse} onChange={(v) => onChange({ play: a.play, ...(v ? { reverse: true } : {}) })} ariaLabel={t("interactions.reverse")} />
            </label>
          </>
        )}
        {"toggle" in a && <Select value={a.toggle} options={segs} onChange={(v) => onChange({ toggle: v })} className="w-[120px] flex-none" ariaLabel={t("interactions.segment")} />}
        {"seek" in a && (
          <>
            {typeof a.seek === "number" ? (
              <NumberField value={a.seek} min={0} step={0.05} suffix="s" className="w-[80px] flex-none" onChange={(n) => onChange({ seek: n })} ariaLabel={t("interactions.seek")} />
            ) : (
              <Select value={a.seek} options={markers.includes(a.seek) ? markers : [a.seek, ...markers]} onChange={(v) => onChange({ seek: v })} className="w-[110px] flex-none" ariaLabel={t("interactions.seek")} />
            )}
            {markers.length > 0 && (
              <Button size="xs" variant="ghost" onClick={() => onChange({ seek: typeof a.seek === "number" ? markers[0] : 0 })}>
                {typeof a.seek === "number" ? t("interactions.useMarker") : t("interactions.useSeconds")}
              </Button>
            )}
          </>
        )}
        {"emit" in a && <TextField value={a.emit} onCommit={(v) => onChange({ ...a, emit: v.trim() })} mono className="w-[140px] flex-none" ariaLabel={t("interactions.eventName")} />}
        {"openUrl" in a && (
          <>
            <UrlField value={a.openUrl} onCommit={(v) => onChange({ ...a, openUrl: v })} />
            <label className="flex items-center gap-1 text-2xs text-fg-muted">
              {t("interactions.newTab")}
              <Toggle checked={a.newTab !== false && a.newTab !== undefined} onChange={(v) => onChange({ openUrl: a.openUrl, ...(v ? { newTab: true } : {}) })} ariaLabel={t("interactions.newTab")} />
            </label>
          </>
        )}
        {"playClip" in a && (
          <>
            <Select value={a.target} placeholder="—" options={modelIds(scene)} onChange={(v) => onChange({ ...a, target: v })} className="w-[110px] flex-none" ariaLabel={t("interactions.model")} />
            <TextField value={String(a.playClip)} onCommit={(v) => onChange({ ...a, playClip: /^\d+$/.test(v.trim()) ? Number(v.trim()) : v.trim() })} mono className="w-[90px] flex-none" ariaLabel={t("interactions.clip")} placeholder="clip" />
            <label className="flex items-center gap-1 text-2xs text-fg-muted">
              {t("timeline.loop")}
              <Toggle checked={a.loop !== false} onChange={(v) => onChange({ ...a, loop: v ? undefined : false })} ariaLabel={t("timeline.loop")} />
            </label>
          </>
        )}
        {onRemove && (
          <IconButton label={t("interactions.removeAction")} className="ml-auto h-5 w-5" onClick={onRemove}>
            <X size={11} />
          </IconButton>
        )}
      </div>
      {"set" in a && <SetFields action={a} onChange={onChange} coalesce={key} />}
      {"emit" in a && (
        <div className="mt-1 flex items-start gap-1 pl-6">
          <span className="w-14 pt-1 text-2xs text-fg-faint">{t("interactions.payload")}</span>
          <JsonField value={a.payload ?? null} rows={1} onCommit={(v) => onChange(v === null ? { emit: a.emit } : { emit: a.emit, payload: v })} />
        </div>
      )}
      {problem && (
        <div className="mt-1 flex items-center gap-1 pl-6 text-2xs text-danger">
          <AlertTriangle size={10} /> {t(problem === "url" ? "interactions.badUrl" : "interactions.needsGesture")}
        </div>
      )}
    </div>
  );
}

// URL input: refuses (and flags) anything but http(s) or page-relative URLs before it reaches the scene.
function UrlField({ value, onCommit }: { value: string; onCommit(v: string): void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setDraft(value);
    setBad(false);
  }, [value]);
  const commit = () => {
    const v = draft.trim();
    if (v === value) return setBad(false);
    if (!isAllowedUrl(v)) return setBad(true);
    setBad(false);
    onCommit(v);
  };
  return (
    <div className="flex min-w-[160px] flex-1 flex-col">
      <input
        value={draft}
        spellCheck={false}
        aria-label="URL"
        aria-invalid={bad}
        placeholder="https://… or /page"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(value);
        }}
        className={clsx("field font-mono text-xs", bad && "!border-danger/70")}
      />
      {bad && <span className="mt-0.5 text-2xs text-danger">{t("interactions.badUrl")}</span>}
    </div>
  );
}

function SetFields({ action: a, onChange, coalesce }: { action: Extract<InteractionAction, { set: unknown }>; onChange(a: InteractionAction, coalesce?: string): void; coalesce: string }) {
  const { t } = useI18n();
  const scene = useSnapshot().scene!;
  const listId = `set-paths-${coalesce}`;
  const v = a.set.value;
  return (
    <div className="mt-1 space-y-1 pl-6">
      <div className="flex items-center gap-1">
        <span className="w-14 text-2xs text-fg-faint">{t("interactions.path")}</span>
        <input list={listId} defaultValue={a.set.path} key={a.set.path} onBlur={(e) => e.target.value.trim() !== a.set.path && onChange({ ...a, set: { ...a.set, path: e.target.value.trim() } })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} spellCheck={false} className="field font-mono text-xs" aria-label={t("interactions.path")} />
        <datalist id={listId}>
          {setPathSuggestions(scene).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-14 text-2xs text-fg-faint">{t("interactions.value")}</span>
        <div className="min-w-0 flex-1">
          <JsonField value={v} rows={1} onCommit={(nv) => onChange({ ...a, set: { ...a.set, value: nv as KeyValue } })} />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-14 text-2xs text-fg-faint">{t("interactions.tween")}</span>
        <NumberField value={a.duration ?? 0} min={0} step={0.05} suffix="s" className="w-[72px] flex-none" placeholder={a.duration === undefined} onChange={(n, f) => onChange({ ...a, duration: n || undefined }, f ? undefined : coalesce)} ariaLabel={t("interactions.tween")} />
        <div className="w-[150px]">
          <EaseField value={a.ease} placeholder="linear" onChange={(e) => onChange({ ...a, ease: e as typeof a.ease })} />
        </div>
      </div>
    </div>
  );
}
