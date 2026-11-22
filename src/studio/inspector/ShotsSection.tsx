// Camera shots editor (camera.shots): cinematic moves on the timeline clock.
// A mini lane shows when each shot plays; every card scrubs its own shot
// (preview) and plays it from its start.

import clsx from "clsx";
import { Play, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CameraShotDef, SceneDoc } from "../../core/types";
import { EaseField } from "../components/EaseField";
import { PickMenu } from "../components/ui/Menu";
import { NumberField } from "../components/ui/NumberField";
import { IconButton, Row, Section, Select } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { pretty } from "../lib/labels";
import { SHOT_OBJECT_FIELD, SHOT_PARAMS, SHOT_TYPES, newShot, shotsEnd } from "../lib/shots";
import { allObjectIds } from "../../ops/tree";
import { useEditor } from "../state/context";
import { JsonField, ParamForm, useBinder } from "./fields";

const HUES = ["#7c8cff", "#f2b654", "#4fd1a5", "#f26d9b", "#6fc3ff", "#c39bff"];

export function ShotsSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const { edit, player } = useEditor();
  const shots = scene.camera.shots ?? [];
  const [time, setTime] = useState(0);
  useEffect(() => player.onTime(setTime), [player]);
  const span = Math.max(scene.timeline?.duration ?? 0, shotsEnd(shots), 1);
  const write = (next: CameraShotDef[]) => edit(next.length ? [{ op: "set", path: "camera.shots", value: next }] : [{ op: "remove", path: "camera.shots" }]);
  return (
    <Section
      title={
        <span>
          {t("shots.title")} {shots.length > 0 && <span className="font-normal text-fg-faint">{shots.length}</span>}
        </span>
      }
      id="camera-shots"
      defaultOpen={shots.length > 0}
      actions={
        <PickMenu
          placeholder={t("shots.search")}
          items={SHOT_TYPES.map((s) => ({ id: s, label: pretty(s), hint: t(`shots.type.${s}`) }))}
          onPick={(type) => write([...shots, newShot(scene, type as CameraShotDef["type"])])}
          trigger={(open) => (
            <IconButton label={t("shots.add")} onClick={open} className="h-6 w-6">
              <Plus size={13} />
            </IconButton>
          )}
        />
      }
    >
      {shots.length > 0 && (
        <div className="relative mx-3 mb-1.5 h-5 overflow-hidden rounded bg-ink-0" title={t("shots.laneHint")}>
          {shots.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => void player.seek(s.at)}
              className="absolute top-0.5 h-4 rounded-sm text-left text-[9px] leading-4 text-ink-0"
              style={{ left: `${(s.at / span) * 100}%`, width: `${Math.max(1.5, (s.duration / span) * 100)}%`, background: HUES[i % HUES.length], opacity: 0.85 }}
            >
              <span className="block truncate px-1">{pretty(s.type)}</span>
            </button>
          ))}
          <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-white" style={{ left: `${Math.min(1, time / span) * 100}%` }} />
        </div>
      )}
      <div className="space-y-1 px-2">
        {shots.map((s, i) => (
          <ShotCard key={i} scene={scene} shot={s} index={i} hue={HUES[i % HUES.length]} time={time} onRemove={() => write(shots.filter((_, j) => j !== i))} />
        ))}
      </div>
      {!shots.length && <div className="px-3 text-2xs text-fg-faint">{t("shots.empty")}</div>}
    </Section>
  );
}

function ShotCard({ scene, shot: s, index, hue, time, onRemove }: { scene: SceneDoc; shot: CameraShotDef; index: number; hue: string; time: number; onRemove(): void }) {
  const { t } = useI18n();
  const { player } = useEditor();
  const bind = useBinder();
  const path = `camera.shots[${index}]`;
  const objField = SHOT_OBJECT_FIELD[s.type];
  const ids = allObjectIds(scene);
  const inShot = time >= s.at && time <= s.at + s.duration;
  const k = s.duration > 0 ? Math.min(1, Math.max(0, (time - s.at) / s.duration)) : 0;
  const lookAtId = typeof s.lookAt === "string" ? s.lookAt : "";
  return (
    <div className={clsx("rounded-md border bg-ink-0/40 pb-1", inShot ? "border-accent/50" : "border-line")}>
      <div className="flex h-7 items-center gap-1 pl-2 pr-1">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: hue }} />
        <Select value={s.type} options={SHOT_TYPES.map((x) => ({ value: x, label: pretty(x) }))} onChange={(v) => bind(path, { type: v, at: s.at, duration: s.duration, ...(s.ease ? { ease: s.ease } : {}) , ...newShotExtras(scene, v as CameraShotDef["type"]) })} className="w-[96px] flex-none" ariaLabel={t("shots.typeLabel")} />
        <span className="flex-1 truncate text-2xs text-fg-faint">{t(`shots.type.${s.type}`)}</span>
        <IconButton
          label={t("shots.play")}
          className="h-5 w-5"
          onClick={async () => {
            await player.seek(s.at);
            player.play();
          }}
        >
          <Play size={10} />
        </IconButton>
        <IconButton label={t("shots.remove")} className="h-5 w-5" onClick={onRemove}>
          <X size={11} />
        </IconButton>
      </div>
      <Row label={t("shots.timing")}>
        <NumberField label="@" value={s.at} min={0} step={0.05} suffix="s" onChange={(n, f) => bind(`${path}.at`, n, f)} ariaLabel={t("shots.at")} />
        <NumberField label="↔" value={s.duration} min={0.05} step={0.05} suffix="s" onChange={(n, f) => bind(`${path}.duration`, n, f)} ariaLabel={t("shots.duration")} />
      </Row>
      <Row label={t("inspector.ease")} overridden={s.ease !== undefined} onReset={() => bind(`${path}.ease`, undefined)}>
        <EaseField value={s.ease} placeholder="inOutCubic" onChange={(v) => bind(`${path}.ease`, v)} />
      </Row>
      <ParamForm specs={SHOT_PARAMS[s.type].map((sp) => (sp.name === "fov" && s.type !== "zoom" ? { ...sp, default: scene.camera.fov ?? 45 } : sp))} base={path} values={s as unknown as Record<string, unknown>} />
      {objField && (
        <Row label={t("shots.object")} hint={t("shots.objectHint")}>
          <Select value={objField === "object" ? (s.object ?? "") : lookAtId} placeholder="—" options={ids} onChange={(v) => bind(`${path}.${objField}`, v || undefined)} ariaLabel={t("shots.object")} />
        </Row>
      )}
      {s.type === "path" && (
        <Row label={t("shots.points")} align="start">
          <JsonField value={s.points ?? []} rows={3} onCommit={(v) => Array.isArray(v) && bind(`${path}.points`, v)} />
        </Row>
      )}
      <Row label={t("shots.preview")} hint={t("shots.previewHint")}>
        <input type="range" min={0} max={1} step={0.01} value={inShot ? k : 0} onChange={(e) => void player.seek(s.at + Number(e.target.value) * s.duration)} aria-label={t("shots.preview")} className="slider h-5 w-full cursor-pointer appearance-none rounded-full bg-ink-3" />
      </Row>
    </div>
  );
}

function newShotExtras(scene: SceneDoc, type: CameraShotDef["type"]): Partial<CameraShotDef> {
  const { type: _t, at: _a, duration: _d, ...rest } = newShot(scene, type);
  return rest;
}
