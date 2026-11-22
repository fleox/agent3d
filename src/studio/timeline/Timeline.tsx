// Keyframe timeline: one lane per track, keys as amber diamonds on a time
// ruler. Add a key at the playhead from the current value, drag keys
// (snaps to 0.05 s; Alt = free), edit the selected key's value and its
// easing, per-track easing, timeline duration / speed / loop / trigger /
// autoplay. Markers sit on the ruler (double-click to add, drag to move);
// segments show as bars under it and in the side panel (play, rename, bounds).

import clsx from "clsx";
import { Diamond, Flag, Play, Plus, Rewind, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyValue, TrackDef } from "../../core/types";
import type { EaseSpec, SegmentDef, TimelineDef } from "../../core/types";
import { TIMELINE_TRIGGERS } from "../../core/validate";
import { EaseField } from "../components/EaseField";
import { ColorField } from "../components/ui/ColorField";
import { NumberField, VecField } from "../components/ui/NumberField";
import { Button, IconButton, Select, TextField, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { CAMERA_TRACK_PROPS, OBJECT_TRACK_PROPS, currentValue, moveKey, removeKey, rulerStep, snapTime, splitTarget, upsertKey } from "../lib/tracks";
import { useEditor, useSnapshot } from "../state/context";
import { addMarkerOps, addSegmentOps, boundTime, removeMarkerOps, removeSegmentOps, renameMarkerOps, renameSegmentOps, segmentObj, setMarkerOps } from "../lib/timelineEdit";

const SEG_HUES = ["#7c8cff", "#4fd1a5", "#f26d9b", "#6fc3ff", "#c39bff", "#f2b654"];

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
  const [selMarker, setSelMarker] = useState<string | null>(null);
  const markers = tl?.markers ?? {};
  const segments = tl?.segments ?? {};
  const segNames = Object.keys(segments);
  const RULER_H = 24;
  const MARK_H = 16;
  const SEG_H = segNames.length ? 6 + segNames.length * 5 : 0;
  const headerH = RULER_H + (tl ? MARK_H : 0) + SEG_H;
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
  const step = rulerStep(duration, width);
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
              <label className="flex items-center gap-1" title={t("timeline.speedHint")}>
                {t("timeline.speed")}
                <NumberField value={tl.speed ?? 1} min={0.05} max={10} step={0.05} suffix="×" placeholder={tl.speed === undefined} className="w-[58px] flex-none" onChange={(n, f) => edit(n === 1 ? (tl.speed !== undefined ? [{ op: "remove", path: "timeline.speed" }] : []) : [{ op: "set", path: "timeline.speed", value: n }], { coalesce: f ? undefined : "tl:speed" })} ariaLabel={t("timeline.speed")} />
              </label>
              <Select value={tl.trigger ?? "visible"} options={TIMELINE_TRIGGERS.map((x) => ({ value: x, label: t(`trigger.${x}`) }))} onChange={(v) => edit([{ op: "set", path: "timeline.trigger", value: v }])} className="w-[124px]" ariaLabel={t("timeline.trigger")} />
              <Select
                value={tl.autoplay === false ? "__off" : typeof tl.autoplay === "string" ? tl.autoplay : "__on"}
                options={[{ value: "__on", label: t("timeline.autoplayOn") }, { value: "__off", label: t("timeline.autoplayOff") }, ...segNames.map((n) => ({ value: n, label: t("timeline.autoplaySegment", { name: n }) }))]}
                onChange={(v) => edit(v === "__on" ? (tl.autoplay !== undefined ? [{ op: "remove", path: "timeline.autoplay" }] : []) : [{ op: "set", path: "timeline.autoplay", value: v === "__off" ? false : v }])}
                className="w-[112px]"
                ariaLabel={t("timeline.autoplay")}
              />
              <IconButton label={t("timeline.remove")} onClick={() => edit([{ op: "remove", path: "timeline" }])}>
                <Trash2 size={13} />
              </IconButton>
            </>
          ) : (
            <span className="text-fg-faint">{t("timeline.none")}</span>
          )}
        </div>
      </div>

      {selectedTrack && selectedKeyData && selKey && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-ink-0/40 px-2">
          <span className="truncate text-2xs text-fg-faint">
            {selectedTrack.target} · {t("timeline.keyN", { n: selKey.index + 1, total: selectedTrack.keys.length })}
          </span>
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
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-ink-1" style={{ width: LABEL_W }}>
          <div className="flex flex-col justify-end border-b border-line pb-0.5 pl-2 text-2xs text-fg-faint" style={{ height: headerH }}>
            {tl && <span className="flex items-center gap-1" style={{ height: MARK_H }}><Flag size={9} /> {t("timeline.markers")}</span>}
            {SEG_H > 0 && <span style={{ height: SEG_H }}>{t("timeline.segments")}</span>}
          </div>
          {tracks.map((tr) => {
            const { id, prop: p } = splitTarget(tr.target);
            return (
              <div key={tr.target} className={clsx("group flex items-center gap-1 border-b border-line/60 pl-2 pr-1", sel === id && "bg-accent/5")} style={{ height: LANE_H }}>
                <button type="button" onClick={() => id !== "camera" && store.select(id)} className="min-w-0 flex-1 truncate text-left text-xs">
                  <span className={clsx(sel === id ? "text-accent" : "text-fg")}>{id}</span>
                  <span className="text-fg-faint">.{p}</span>
                </button>
                <div className="w-[92px] shrink-0">
                  <EaseField compact value={tr.ease} placeholder="linear" onChange={(v) => commitTrack({ ...tr, ease: v as EaseSpec | undefined })} ariaLabel={t("timeline.ease")} />
                </div>
                <IconButton label={t("timeline.removeTrack")} className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => edit([{ op: "removeTrack", target: tr.target }])}>
                  <X size={11} />
                </IconButton>
              </div>
            );
          })}
        </div>
        <div ref={laneRef} className="relative min-w-[300px] flex-1">
          {/* Ruler */}
          <div className="sticky top-0 z-[5] border-b border-line bg-ink-1" style={{ height: headerH }}>
            <div
              className="relative cursor-pointer"
              style={{ height: RULER_H }}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                void player.seek(timeAt(e.clientX));
              }}
              onPointerMove={(e) => e.buttons === 1 && void player.seek(timeAt(e.clientX))}
            >
              {ticks.map((x) => (
                <div key={x} className="pointer-events-none absolute top-0 h-full" style={{ left: 8 + xOf(x, width) }}>
                  <div className="h-2 w-px bg-fg-faint/60" />
                  <div className="absolute left-1 top-1.5 text-2xs tabular-nums text-fg-faint">{x}s</div>
                </div>
              ))}
            </div>
            {tl && (
              <div
                className="relative border-t border-line/50"
                style={{ height: MARK_H }}
                title={t("timeline.markerLaneHint")}
                onDoubleClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const r = addMarkerOps(scene, snapTime(timeAt(e.clientX)));
                  edit(r.ops);
                  setSelMarker(r.name);
                }}
              >
                {Object.entries(markers).map(([name, at]) => (
                  <MarkerFlag
                    key={name}
                    name={name}
                    x={8 + xOf(at, width)}
                    selected={selMarker === name}
                    onSelect={() => {
                      setSelMarker(name);
                      void player.seek(at);
                    }}
                    onDrag={(clientX, free, final) => edit(setMarkerOps(store.getSnapshot().scene!, name, snapTime(timeAt(clientX), 0.05, free)), final ? undefined : { coalesce: `marker:${name}` })}
                  />
                ))}
              </div>
            )}
            {SEG_H > 0 && tl && (
              <div className="relative border-t border-line/50" style={{ height: SEG_H }}>
                {segNames.map((name, i) => {
                  const seg = segmentObj(segments[name]);
                  const a = boundTime(seg.from, tl);
                  const b = boundTime(seg.to, tl);
                  const lo = Math.min(a, b);
                  return (
                    <button
                      key={name}
                      type="button"
                      title={`${name}: ${a}s → ${b}s`}
                      onClick={() => player.playSegment(name)}
                      className="absolute h-[4px] rounded-full opacity-80 hover:opacity-100"
                      style={{ top: 3 + i * 5, left: 8 + xOf(lo, width), width: Math.max(3, xOf(Math.abs(b - a), width)), background: SEG_HUES[i % SEG_HUES.length] }}
                    />
                  );
                })}
              </div>
            )}
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
          {Object.entries(markers).map(([name, at]) => (
            <div key={name} className={clsx("pointer-events-none absolute bottom-0 z-[3] w-px", selMarker === name ? "bg-key/70" : "bg-key/25")} style={{ left: 8 + xOf(at, width), top: headerH }} />
          ))}
          {/* Playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-[6] w-px bg-accent" style={{ left: 8 + xOf(Math.min(time, duration), width) }}>
            <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
          </div>
        </div>
      </div>
      {tl && <MotionPanel tl={tl} time={time} selMarker={selMarker} onSelectMarker={setSelMarker} />}
      </div>
    </div>
  );
}

function MarkerFlag({ name, x, selected, onSelect, onDrag }: { name: string; x: number; selected: boolean; onSelect(): void; onDrag(clientX: number, free: boolean, final: boolean): void }) {
  const start = useRef<{ x: number; moved: boolean } | null>(null);
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
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
      className="absolute top-0 z-[4] flex h-full cursor-ew-resize items-center outline-none"
      style={{ left: x }}
    >
      <span className={clsx("absolute left-0 top-0 h-full w-px", selected ? "bg-key" : "bg-key/60")} />
      <span className={clsx("ml-px max-w-[90px] truncate rounded-r-sm px-1 text-[9px] font-medium leading-[13px]", selected ? "bg-key text-ink-0" : "bg-key/25 text-key")}>{name}</span>
    </button>
  );
}

// Side panel: markers (rename, time, delete) and segments (play, rename, bounds, loop, speed).
function MotionPanel({ tl, time, selMarker, onSelectMarker }: { tl: TimelineDef; time: number; selMarker: string | null; onSelectMarker(n: string | null): void }) {
  const { t } = useI18n();
  const { edit, player, store } = useEditor();
  const scene = () => store.getSnapshot().scene!;
  const markers = Object.entries(tl.markers ?? {}).sort((a, b) => a[1] - b[1]);
  const segments = Object.entries(tl.segments ?? {});
  const markerNames = markers.map(([n]) => n);
  return (
    <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-ink-1">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line/60 pl-2.5 pr-1 text-2xs font-semibold text-fg-muted">
        <Flag size={10} className="text-key" />
        <span className="flex-1">{t("timeline.markers")}</span>
        <IconButton
          label={t("timeline.addMarker")}
          className="h-5 w-5"
          onClick={() => {
            const r = addMarkerOps(scene(), snapTime(time));
            edit(r.ops);
            onSelectMarker(r.name);
          }}
        >
          <Plus size={11} />
        </IconButton>
      </div>
      {markers.map(([name, at]) => (
        <div key={name} className={clsx("flex items-center gap-1 px-2 py-0.5", selMarker === name && "bg-key/10")} onClick={() => onSelectMarker(name)}>
          <TextField value={name} onCommit={(v) => { const ops = renameMarkerOps(scene(), name, v.trim()); if (ops.length) { edit(ops); onSelectMarker(v.trim()); } }} mono className="text-2xs" ariaLabel={t("timeline.markerName")} />
          <NumberField value={at} min={0} max={tl.duration} step={0.05} suffix="s" className="w-[70px] flex-none" onChange={(n, f) => edit(setMarkerOps(scene(), name, n), f ? undefined : { coalesce: `marker:${name}` })} ariaLabel={t("timeline.markerTime")} />
          <IconButton label={t("timeline.removeMarker")} className="h-5 w-5" onClick={() => edit(removeMarkerOps(scene(), name))}>
            <X size={11} />
          </IconButton>
        </div>
      ))}
      {!markers.length && <div className="px-2.5 py-1 text-2xs leading-snug text-fg-faint">{t("timeline.noMarkers")}</div>}

      <div className="mt-1 flex h-7 shrink-0 items-center gap-1 border-y border-line/60 pl-2.5 pr-1 text-2xs font-semibold text-fg-muted">
        <span className="h-1.5 w-3 rounded-full bg-accent" />
        <span className="flex-1">{t("timeline.segments")}</span>
        <IconButton label={t("timeline.addSegment")} className="h-5 w-5" onClick={() => edit(addSegmentOps(scene(), time).ops)}>
          <Plus size={11} />
        </IconButton>
      </div>
      {segments.map(([name, raw], i) => {
        const seg = segmentObj(raw);
        const path = `timeline.segments.${name}`;
        const set = (patch: Partial<SegmentDef>) => {
          const next: Record<string, unknown> = { ...seg, ...patch };
          for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
          edit([{ op: "set", path, value: next }]);
        };
        const playing = player.segment?.name === name;
        return (
          <div key={name} className="border-b border-line/40 px-2 py-1">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEG_HUES[i % SEG_HUES.length] }} />
              <TextField value={name} onCommit={(v) => { const ops = renameSegmentOps(scene(), name, v.trim()); if (ops.length) edit(ops); }} mono className="text-2xs" ariaLabel={t("timeline.segmentName")} />
              <IconButton label={t("timeline.playSegment")} active={playing} className="h-5 w-5" onClick={() => player.playSegment(name)}>
                <Play size={10} />
              </IconButton>
              <IconButton label={t("timeline.playReverse")} className="h-5 w-5" onClick={() => player.playSegment(name, { reverse: true })}>
                <Rewind size={10} />
              </IconButton>
              <IconButton label={t("timeline.removeSegment")} className="h-5 w-5" onClick={() => edit(removeSegmentOps(scene(), name))}>
                <X size={11} />
              </IconButton>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <BoundField label={t("timeline.from")} value={seg.from} markers={markerNames} max={tl.duration} onChange={(v) => set({ from: v })} />
              <BoundField label={t("timeline.to")} value={seg.to} markers={markerNames} max={tl.duration} onChange={(v) => set({ to: v })} />
            </div>
            <div className="mt-1 flex items-center gap-1">
              <Select
                value={seg.loop === "pingpong" ? "pingpong" : seg.loop ? "loop" : "once"}
                options={[
                  { value: "once", label: t("timeline.once") },
                  { value: "loop", label: t("timeline.loop") },
                  { value: "pingpong", label: t("timeline.pingpong") },
                ]}
                onChange={(v) => set({ loop: v === "once" ? undefined : v === "pingpong" ? "pingpong" : true })}
                className="flex-1"
                ariaLabel={t("timeline.loop")}
              />
              <NumberField label="×" value={seg.speed ?? 1} min={0.05} max={10} step={0.05} placeholder={seg.speed === undefined} className="w-[70px] flex-none" onChange={(n) => set({ speed: n === 1 ? undefined : n })} ariaLabel={t("timeline.speed")} />
            </div>
          </div>
        );
      })}
      {!segments.length && <div className="px-2.5 py-1 text-2xs leading-snug text-fg-faint">{t("timeline.noSegments")}</div>}
    </div>
  );
}

// A segment bound: seconds, or a marker name.
function BoundField({ label, value, markers, max, onChange }: { label: string; value: number | string; markers: string[]; max: number; onChange(v: number | string): void }) {
  const isMarker = typeof value === "string";
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <span className="w-6 shrink-0 text-2xs text-fg-faint">{label}</span>
      {isMarker ? (
        <Select value={value} options={markers.includes(value) ? markers : [value, ...markers]} onChange={onChange} className="text-2xs" ariaLabel={label} />
      ) : (
        <NumberField value={value} min={0} max={max} step={0.05} suffix="s" onChange={(n) => onChange(n)} ariaLabel={label} />
      )}
      {markers.length > 0 && (
        <button type="button" title={isMarker ? "s" : "marker"} onClick={() => onChange(isMarker ? 0 : markers[0])} className={clsx("flex h-5 w-4 shrink-0 items-center justify-center rounded", isMarker ? "text-key" : "text-fg-faint hover:text-fg")}>
          <Flag size={9} />
        </button>
      )}
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
    const keys = track.keys.map((k, i) => (i === index ? (k.length === 3 ? ([k[0], v, k[2]] as TrackDef["keys"][number]) : ([k[0], v] as [number, KeyValue])) : k));
    onChange({ ...track, keys }, index, final);
  };
  const setEase = (e: string | undefined) => {
    const keys = track.keys.map((k, i) => (i === index ? (e ? ([k[0], k[1], e as EaseSpec] as TrackDef["keys"][number]) : ([k[0], k[1]] as [number, KeyValue])) : k));
    onChange({ ...track, keys }, index, true);
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
      <div className="w-[120px] min-w-0" title={t("timeline.keyEaseHint")}>
        {index > 0 && <EaseField compact value={key[2]} placeholder={track.ease ?? "linear"} allowInherit={t("timeline.trackEase", { ease: track.ease ?? "linear" })} onChange={setEase} ariaLabel={t("timeline.keyEase")} />}
      </div>
      <IconButton label={t("timeline.deleteKey")} className="h-6 w-6" onClick={onDelete}>
        <Trash2 size={12} />
      </IconButton>
    </div>
  );
}

