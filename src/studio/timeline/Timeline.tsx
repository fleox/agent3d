// Keyframe timeline: one lane per track, keys as amber diamonds on a time
// ruler. Add a key at the playhead from the current value, drag keys
// (snaps to 0.05 s; Alt = free), edit the selected key's value, per-track
// easing, timeline duration / loop / trigger.

import clsx from "clsx";
import { Diamond, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyValue, TrackDef } from "../../core/types";
import { EASES, TIMELINE_TRIGGERS } from "../../core/validate";
import { ColorField } from "../components/ui/ColorField";
import { NumberField, VecField } from "../components/ui/NumberField";
import { Button, IconButton, Select, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { CAMERA_TRACK_PROPS, OBJECT_TRACK_PROPS, currentValue, moveKey, removeKey, rulerStep, snapTime, splitTarget, upsertKey } from "../lib/tracks";
import { useEditor, useSnapshot } from "../state/context";

const LANE_H = 26;
const LABEL_W = 236;

export function Timeline() {
  const { t } = useI18n();
  const { edit, player, store } = useEditor();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const tl = scene.timeline;
  const tracks = tl?.tracks ?? [];
  const duration = tl?.duration || 4;
  const [time, setTime] = useState(0);
  const [selKey, setSelKey] = useState<{ target: string; index: number } | null>(null);
  const [prop, setProp] = useState<string>("position");
  const laneRef = useRef<HTMLDivElement>(null);
  useEffect(() => player.onTime(setTime), [player]);

  const sel = snap.selection;
  const propOptions: readonly string[] = sel ? OBJECT_TRACK_PROPS : CAMERA_TRACK_PROPS;
  useEffect(() => {
    if (!propOptions.includes(prop)) setProp(propOptions[0]);
  }, [propOptions, prop]);
  const newTarget = sel ? `${sel}.${prop}` : prop;

  const commitTrack = (track: TrackDef, coalesce?: string) => edit([{ op: "addTrack", track }], coalesce ? { coalesce } : undefined);

  const addKey = () => {
    const value = currentValue(scene, newTarget);
    if (value === undefined) return;
    const existing = tracks.find((tr) => tr.target === newTarget) ?? { target: newTarget, keys: [], ease: "inOutCubic" as const };
    const at = snapTime(time);
    const ops = [];
    if (!tl) ops.push({ op: "set" as const, path: "timeline", value: { duration: Math.max(4, at), loop: true, tracks: [] } });
    ops.push({ op: "addTrack" as const, track: upsertKey(existing, at, value) });
    edit(ops);
    const after = store.getSnapshot().scene?.timeline?.tracks.find((tr) => tr.target === newTarget);
    if (after) setSelKey({ target: newTarget, index: after.keys.findIndex((k) => Math.abs(k[0] - at) < 1e-3) });
  };

  const xOf = (tt: number, width: number) => (tt / duration) * width;
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 40));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const step = rulerStep(duration);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let x = 0; x <= duration + 1e-6; x += step) out.push(Number(x.toFixed(3)));
    return out;
  }, [duration, step]);

  const timeAt = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left - 8) / width) * duration));
  };

  const selectedTrack = selKey ? tracks.find((tr) => tr.target === selKey.target) : undefined;
  const selectedKeyData = selectedTrack && selKey ? selectedTrack.keys[selKey.index] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2">
        <div className="flex items-center gap-1">
          <Select value={prop} options={propOptions.map((p) => ({ value: p, label: sel ? `${sel}.${p}` : p }))} onChange={setProp} className="w-[170px]" ariaLabel={t("timeline.property")} />
          <Button size="xs" variant="subtle" onClick={addKey} title={t("timeline.addKeyHint")}>
            <Diamond size={11} className="text-key" fill="currentColor" /> {t("timeline.addKey", { t: snapTime(time).toFixed(2) })}
          </Button>
        </div>
        {selectedTrack && selectedKeyData && selKey && (
          <KeyEditor
            track={selectedTrack}
            index={selKey.index}
            onChange={(next, idx, final) => {
              commitTrack(next, final ? undefined : `key:${next.target}`);
              setSelKey({ target: next.target, index: idx });
            }}
            onDelete={() => {
              const next = removeKey(selectedTrack, selKey.index);
              edit(next.keys.length ? [{ op: "addTrack", track: next }] : [{ op: "removeTrack", target: next.target }]);
              setSelKey(null);
            }}
          />
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-fg-muted">
          {tl ? (
            <>
              <label className="flex items-center gap-1">
                {t("timeline.duration")}
                <NumberField value={tl.duration} min={0.1} step={0.1} suffix="s" className="w-[70px] flex-none" onChange={(n, f) => edit([{ op: "set", path: "timeline.duration", value: n }], { coalesce: f ? undefined : "tl:duration" })} ariaLabel={t("timeline.duration")} />
              </label>
              <Select
                value={tl.loop === "pingpong" ? "pingpong" : tl.loop ? "loop" : "once"}
                options={[
                  { value: "once", label: t("timeline.once") },
                  { value: "loop", label: t("timeline.loop") },
                  { value: "pingpong", label: t("timeline.pingpong") },
                ]}
                onChange={(v) => edit([{ op: "set", path: "timeline.loop", value: v === "pingpong" ? "pingpong" : v === "loop" }])}
                className="w-[96px]"
                ariaLabel={t("timeline.loop")}
              />
              <Select value={tl.trigger ?? "visible"} options={TIMELINE_TRIGGERS.map((x) => ({ value: x, label: t(`trigger.${x}`) }))} onChange={(v) => edit([{ op: "set", path: "timeline.trigger", value: v }])} className="w-[124px]" ariaLabel={t("timeline.trigger")} />
              <label className="flex items-center gap-1" title={t("timeline.autoplay")}>
                <Toggle checked={tl.autoplay !== false} onChange={(v) => edit(v ? (tl.autoplay === false ? [{ op: "remove", path: "timeline.autoplay" }] : []) : [{ op: "set", path: "timeline.autoplay", value: false }])} ariaLabel={t("timeline.autoplay")} />
              </label>
              <IconButton label={t("timeline.remove")} onClick={() => edit([{ op: "remove", path: "timeline" }])}>
                <Trash2 size={13} />
              </IconButton>
            </>
          ) : (
            <span className="text-fg-faint">{t("timeline.none")}</span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-ink-1" style={{ width: LABEL_W }}>
          <div className="h-6 border-b border-line" />
          {tracks.map((tr) => {
            const { id, prop: p } = splitTarget(tr.target);
            return (
              <div key={tr.target} className={clsx("group flex items-center gap-1 border-b border-line/60 pl-2 pr-1", sel === id && "bg-accent/5")} style={{ height: LANE_H }}>
                <button type="button" onClick={() => id !== "camera" && store.select(id)} className="min-w-0 flex-1 truncate text-left text-xs">
                  <span className={clsx(sel === id ? "text-accent" : "text-fg")}>{id}</span>
                  <span className="text-fg-faint">.{p}</span>
                </button>
                <select value={tr.ease ?? "linear"} onChange={(e) => commitTrack({ ...tr, ease: e.target.value as TrackDef["ease"] })} aria-label={t("timeline.ease")} className="h-5 w-[78px] rounded bg-transparent text-2xs text-fg-muted outline-none hover:bg-ink-3">
                  {EASES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
                <IconButton label={t("timeline.removeTrack")} className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => edit([{ op: "removeTrack", target: tr.target }])}>
                  <X size={11} />
                </IconButton>
              </div>
            );
          })}
        </div>
        <div ref={laneRef} className="relative min-w-[300px] flex-1">
          {/* Ruler */}
          <div
            className="sticky top-0 z-[5] h-6 cursor-pointer border-b border-line bg-ink-1"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              void player.seek(timeAt(e.clientX));
            }}
            onPointerMove={(e) => e.buttons === 1 && void player.seek(timeAt(e.clientX))}
          >
            {ticks.map((x) => (
              <div key={x} className="absolute top-0 h-full" style={{ left: 8 + xOf(x, width) }}>
                <div className="h-2 w-px bg-fg-faint/60" />
                <div className="absolute left-1 top-1.5 text-2xs tabular-nums text-fg-faint">{x}s</div>
              </div>
            ))}
          </div>
          {tracks.map((tr) => (
            <div key={tr.target} className="relative border-b border-line/60" style={{ height: LANE_H }} onPointerDown={(e) => e.target === e.currentTarget && setSelKey(null)}>
              {tr.keys.length > 1 && <div className="absolute top-1/2 h-px bg-key/30" style={{ left: 8 + xOf(tr.keys[0][0], width), width: xOf(tr.keys[tr.keys.length - 1][0] - tr.keys[0][0], width) }} />}
              {tr.keys.map((k, i) => (
                <KeyDot
                  key={i}
                  x={8 + xOf(k[0], width)}
                  selected={selKey?.target === tr.target && selKey.index === i}
                  title={`${k[0]}s · ${JSON.stringify(k[1])}`}
                  onSelect={() => {
                    setSelKey({ target: tr.target, index: i });
                    void player.seek(k[0]);
                  }}
                  onDrag={(clientX, free, final) => {
                    const cur = store.getSnapshot().scene?.timeline?.tracks.find((x) => x.target === tr.target);
                    if (!cur) return;
                    const idx = selKey?.target === tr.target ? selKey.index : i;
                    const m = moveKey(cur, Math.min(idx, cur.keys.length - 1), snapTime(timeAt(clientX), 0.05, free));
                    commitTrack(m.track, final ? undefined : `key:${tr.target}`);
                    setSelKey({ target: tr.target, index: m.index });
                  }}
                  onDelete={() => {
                    const next = removeKey(tr, i);
                    edit(next.keys.length ? [{ op: "addTrack", track: next }] : [{ op: "removeTrack", target: tr.target }]);
                    setSelKey(null);
                  }}
                />
              ))}
            </div>
          ))}
          {!tracks.length && (
            <div className="flex h-24 items-center justify-center gap-2 text-xs text-fg-faint">
              <Plus size={12} /> {sel ? t("timeline.emptySelected", { id: sel }) : t("timeline.empty")}
            </div>
          )}
          {/* Playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-[6] w-px bg-accent" style={{ left: 8 + xOf(Math.min(time, duration), width) }}>
            <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyDot({ x, selected, title, onSelect, onDrag, onDelete }: { x: number; selected: boolean; title: string; onSelect(): void; onDrag(clientX: number, free: boolean, final: boolean): void; onDelete(): void }) {
  const start = useRef<{ x: number; moved: boolean } | null>(null);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={selected}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, moved: false };
        onSelect();
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || (!s.moved && Math.abs(e.clientX - s.x) < 3)) return;
        s.moved = true;
        onDrag(e.clientX, e.altKey, false);
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (s?.moved) onDrag(e.clientX, e.altKey, true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.stopPropagation();
          e.preventDefault();
          onDelete();
        }
      }}
      className="absolute top-1/2 z-[4] flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center outline-none"
      style={{ left: x }}
    >
      <span className={clsx("block h-2.5 w-2.5 rotate-45 rounded-[2px] border transition-transform", selected ? "scale-125 border-white bg-key" : "border-key/80 bg-key/80 hover:bg-key")} />
    </button>
  );
}

function KeyEditor({ track, index, onChange, onDelete }: { track: TrackDef; index: number; onChange(track: TrackDef, index: number, final: boolean): void; onDelete(): void }) {
  const { t } = useI18n();
  const key = track.keys[index];
  if (!key) return null;
  const [time, value] = key;
  const setValue = (v: KeyValue, final: boolean) => {
    const keys = track.keys.map((k, i) => (i === index ? ([k[0], v] as [number, KeyValue]) : k));
    onChange({ ...track, keys }, index, final);
  };
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-ink-2 py-0.5 pl-2 pr-0.5 text-xs">
      <Diamond size={10} className="text-key" fill="currentColor" />
      <NumberField
        value={time}
        min={0}
        step={0.01}
        suffix="s"
        className="w-[64px] flex-none bg-ink-1"
        onChange={(n, final) => {
          const m = moveKey(track, index, n);
          onChange(m.track, m.index, final);
        }}
        ariaLabel={t("timeline.keyTime")}
      />
      <div className="flex w-[200px] min-w-0 items-center">
        {typeof value === "number" ? (
          <NumberField value={value} onChange={(n, f) => setValue(n, f)} className="bg-ink-1" ariaLabel={t("timeline.keyValue")} />
        ) : typeof value === "boolean" ? (
          <Toggle checked={value} onChange={(v) => setValue(v, true)} ariaLabel={t("timeline.keyValue")} />
        ) : Array.isArray(value) ? (
          <VecField value={value.map((x) => (typeof x === "number" ? x : 0))} onChange={(v, f) => setValue(v as [number, number, number], f)} />
        ) : (
          <ColorField value={String(value)} onChange={(v, f) => setValue(v, f)} />
        )}
      </div>
      <IconButton label={t("timeline.deleteKey")} className="h-6 w-6" onClick={onDelete}>
        <Trash2 size={12} />
      </IconButton>
    </div>
  );
}

