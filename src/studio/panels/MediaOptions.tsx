// Media render options shared by the render and export dialogs: format
// (MP4 / WebM / GIF / animated WebP / still), quality (supersampling),
// fps, duration, size, transparent background → `export` tool input.

import clsx from "clsx";
import type { ReactNode } from "react";
import type { SceneDoc } from "../../core/types";
import { NumberField } from "../components/ui/NumberField";
import { Select, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";

export type MediaKind = "mp4" | "webm" | "gif" | "webp" | "poster";
export type MediaQuality = "draft" | "standard" | "high" | "ultra";
export interface MediaSettings {
  kind: MediaKind;
  quality: MediaQuality;
  fps?: number;
  duration?: number;
  width?: number;
  height?: number;
  transparent: boolean;
  image: "webp" | "png";
  time?: number;
}

export const DEFAULT_FPS: Record<MediaKind, number> = { mp4: 30, webm: 30, gif: 15, webp: 20, poster: 0 };
export const MEDIA_EXT: Record<MediaKind, string> = { mp4: "mp4", webm: "webm", gif: "gif", webp: "webp", poster: "webp" };

export function defaultMedia(kind: MediaKind = "mp4"): MediaSettings {
  return { kind, quality: "standard", transparent: false, image: "webp" };
}

// The `export` tool input for these settings, written to `out`.
export function mediaInput(m: MediaSettings, out: string): Record<string, unknown> {
  const size = m.width && m.height ? `${Math.round(m.width)}x${Math.round(m.height)}` : undefined;
  const common = { out, ...(m.quality !== "standard" ? { quality: m.quality } : {}), ...(size ? { size } : {}) };
  if (m.kind === "poster") return { format: "poster", image: m.image, ...(m.time !== undefined ? { time: m.time } : {}), ...(m.transparent ? { transparent: true } : {}), ...common };
  const timing = { ...(m.fps ? { fps: m.fps } : {}), ...(m.duration ? { duration: m.duration } : {}) };
  if (m.kind === "mp4" || m.kind === "webm") return { format: "video", codec: m.kind, ...timing, ...common };
  return { format: m.kind === "gif" ? "gif" : "animated-webp", ...timing, ...(m.transparent ? { transparent: true } : {}), ...common };
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1" title={hint}>
      <span className="text-2xs font-medium text-fg-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </label>
  );
}

export function MediaKindPicker({ value, kinds, onChange }: { value: MediaKind; kinds: MediaKind[]; onChange(k: MediaKind): void }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-0.5 rounded-md bg-ink-2 p-0.5" role="radiogroup">
      {kinds.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={clsx("h-7 flex-1 rounded px-2 text-xs font-medium", value === k ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}>
          {t(`media.kind.${k}`)}
        </button>
      ))}
    </div>
  );
}

export function MediaOptionsForm({ value: m, onChange, scene }: { value: MediaSettings; onChange(m: MediaSettings): void; scene: SceneDoc }) {
  const { t } = useI18n();
  const set = (patch: Partial<MediaSettings>) => onChange({ ...m, ...patch });
  const animated = m.kind !== "poster";
  const alpha = m.kind === "gif" || m.kind === "webp" || m.kind === "poster";
  const dur = scene.timeline?.duration && scene.timeline.duration > 0 ? scene.timeline.duration : 5;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
      <Field label={t("media.quality")} hint={t("media.qualityHint")}>
        <Select value={m.quality} options={(["draft", "standard", "high", "ultra"] as const).map((q) => ({ value: q, label: t(`media.q.${q}`) }))} onChange={(v) => set({ quality: v as MediaQuality })} ariaLabel={t("media.quality")} />
      </Field>
      {animated ? (
        <>
          <Field label={t("media.fps")}>
            <NumberField value={m.fps ?? DEFAULT_FPS[m.kind]} placeholder={m.fps === undefined} integer min={1} max={60} onChange={(n) => set({ fps: n === DEFAULT_FPS[m.kind] ? undefined : n })} ariaLabel={t("media.fps")} />
          </Field>
          <Field label={t("media.duration")}>
            <NumberField value={m.duration ?? dur} placeholder={m.duration === undefined} min={0.1} max={120} step={0.1} suffix="s" onChange={(n) => set({ duration: n === dur ? undefined : n })} ariaLabel={t("media.duration")} />
          </Field>
        </>
      ) : (
        <>
          <Field label={t("media.time")}>
            <NumberField value={m.time ?? scene.target.posterTime ?? 0} placeholder={m.time === undefined} min={0} step={0.05} suffix="s" onChange={(n) => set({ time: n })} ariaLabel={t("media.time")} />
          </Field>
          <Field label={t("media.image")}>
            <Select value={m.image} options={["webp", "png"]} onChange={(v) => set({ image: v as "webp" | "png" })} ariaLabel={t("media.image")} />
          </Field>
        </>
      )}
      <Field label={t("media.size")} hint={t("media.sizeHint")}>
        <NumberField label="W" value={m.width ?? 0} placeholder={!m.width} empty={!m.width} integer min={0} max={4096} onChange={(n) => set({ width: n || undefined })} ariaLabel={t("media.width")} />
        <NumberField label="H" value={m.height ?? 0} placeholder={!m.height} empty={!m.height} integer min={0} max={4096} onChange={(n) => set({ height: n || undefined })} ariaLabel={t("media.height")} />
      </Field>
      {alpha && (
        <Field label={t("media.transparent")} hint={t("media.transparentHint")}>
          <Toggle checked={m.transparent} onChange={(v) => set({ transparent: v })} ariaLabel={t("media.transparent")} />
        </Field>
      )}
    </div>
  );
}
