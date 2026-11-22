// Inspector when nothing is selected: the scene itself — meta, target,
// camera, environment, lights, post effects, physics, audio, HUD.

import { Plus, X } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { SOUND_PRESETS } from "../../core/catalog";
import type { LightDef, SceneDoc } from "../../core/types";
import { TARGET_KINDS } from "../../core/validate";
import { EnvironmentSection } from "./EnvironmentSection";
import { PhysicsSection } from "./PhysicsSection";
import { PostFxSection } from "./PostFxSection";
import { ShotsSection } from "./ShotsSection";
import { uniqueId } from "../../core/ids";
import { LIGHT_ICONS } from "../components/icons";
import { PickMenu } from "../components/ui/Menu";
import { NumberField } from "../components/ui/NumberField";
import { IconButton, Row, Section, Select, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { takenIds } from "../lib/patches";
import { useEditor, useSnapshot, useUi } from "../state/context";
import { ParamForm, SubForm, useBinder } from "./fields";
import { CAMERA_SPECS, LIGHT_SHADOW_SPECS, LIGHT_SPECS, SCENE_META_SPECS, TARGET_SPECS, UI_ELEMENT_SPECS, UI_THEME_SPECS, VOLUMETRIC_SPECS } from "./specs";
import { DEFAULT_ASPECT } from "../../core/validate";
import { pretty } from "../lib/labels";

const rec = (v: unknown) => v as Record<string, unknown> | undefined;

export function SceneSettings() {
  const { t } = useI18n();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const bind = useBinder();
  return (
    <div>
      <div className="border-b border-line px-3 py-2.5">
        <div className="text-sm font-semibold">{t("scene.title")}</div>
        <div className="text-2xs text-fg-faint">{t("scene.subtitle")}</div>
      </div>
      <Section title={t("scene.meta")} id="meta">
        <ParamForm specs={SCENE_META_SPECS} base="" values={rec(scene)} />
      </Section>
      <Section title={t("scene.target")} id="target">
        <Row label={t("scene.kind")}>
          <Select value={scene.target.kind} options={TARGET_KINDS} onChange={(v) => bind("target", { ...scene.target, kind: v, aspect: DEFAULT_ASPECT[v as keyof typeof DEFAULT_ASPECT] ?? scene.target.aspect })} ariaLabel={t("scene.kind")} />
        </Row>
        <ParamForm specs={TARGET_SPECS} base="target" values={rec(scene.target)} />
      </Section>
      <Section title={t("scene.camera")} id="camera">
        <ParamForm specs={CAMERA_SPECS.filter((s) => (scene.camera.type === "orthographic" ? s.name !== "fov" : s.name !== "zoom"))} base="camera" values={rec(scene.camera)} />
      </Section>
      <ShotsSection scene={scene} />
      <EnvironmentSection scene={scene} />
      <LightsSection scene={scene} />
      <PostFxSection scene={scene} />
      <PhysicsSection scene={scene} />
      <AudioSection scene={scene} />
      <UiSection scene={scene} />
    </div>
  );
}

function LightsSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const { edit, ui } = useEditor();
  const lights = scene.lights ?? [];
  // The light picked in the viewport is highlighted and scrolled into view; clicking a header selects it.
  const lightSel = useUi((s) => s.lightSel);
  const rows = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (lightSel) rows.current.get(lightSel.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [lightSel]);
  return (
    <Section
      title={
        <span>
          {t("scene.lights")} <span className="font-normal text-fg-faint">{lights.length}</span>
        </span>
      }
      id="lights"
      actions={
        <PickMenu
          placeholder={t("scene.lightType")}
          items={Object.keys(LIGHT_SPECS).map((k) => ({ id: k, label: pretty(k) }))}
          onPick={(type) => {
            const id = uniqueId(type, takenIds(scene));
            const def: LightDef = { id, type: type as LightDef["type"], intensity: type === "ambient" || type === "hemisphere" ? 0.6 : 2, ...(type === "ambient" || type === "hemisphere" ? {} : { position: [3, 5, 4] as [number, number, number] }) };
            edit([{ op: "set", path: `lights[${lights.length}]`, value: def }]);
          }}
          trigger={(open) => (
            <IconButton label={t("scene.addLight")} onClick={open} className="h-6 w-6">
              <Plus size={13} />
            </IconButton>
          )}
        />
      }
    >
      <div className="space-y-1.5 px-2">
        {lights.map((l, i) => {
          const I = LIGHT_ICONS[l.type] ?? LIGHT_ICONS.point;
          const path = l.id ? `lights#${l.id}` : `lights[${i}]`;
          const rid = l.id ?? `light${i}`;
          const selected = lightSel?.id === rid;
          const movable = l.type !== "ambient" && l.type !== "hemisphere";
          return (
            <div
              key={`${l.id ?? i}`}
              ref={(el) => {
                if (el) rows.current.set(rid, el);
                else rows.current.delete(rid);
              }}
              className={clsx("rounded-md border bg-ink-0/40 pb-1", selected ? "border-accent/70" : "border-line")}
            >
              <div className={clsx("flex h-7 items-center gap-1.5 pl-2 pr-1", movable && "cursor-pointer")} onClick={movable ? () => ui.set({ lightSel: selected ? null : { id: rid, part: "position" } }) : undefined}>
                <I size={12} className="text-key" />
                <span className="flex-1 truncate text-xs font-medium">{l.id ?? `${l.type} ${i + 1}`}</span>
                <span className="text-2xs text-fg-faint">{l.type}</span>
                <IconButton
                  label={t("scene.removeLight")}
                  className="h-5 w-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    edit([{ op: "remove", path: `lights[${i}]` }]);
                  }}
                >
                  <X size={11} />
                </IconButton>
              </div>
              <ParamForm specs={LIGHT_SPECS[l.type] ?? []} base={path} values={rec(l)} />
              <LightExtras light={l} path={path} />
            </div>
          );
        })}
        {!lights.length && <div className="px-1 text-2xs text-fg-faint">{t("scene.noLights")}</div>}
      </div>
    </Section>
  );
}

function LightExtras({ light: l, path }: { light: LightDef; path: string }) {
  const { t } = useI18n();
  const bind = useBinder();
  const [shadowOpen, setShadowOpen] = useState(!!l.shadow);
  const shadows = l.castShadow && (l.type === "directional" || l.type === "spot" || l.type === "point");
  return (
    <>
      {l.type === "spot" && (
        <>
          <Row label={t("lights.volumetric")} hint={t("lights.volumetricHint")}>
            <Toggle checked={!!l.volumetric} onChange={(v) => bind(`${path}.volumetric`, v || undefined)} ariaLabel={t("lights.volumetric")} />
          </Row>
          {l.volumetric && <SubForm specs={VOLUMETRIC_SPECS} path={`${path}.volumetric`} value={l.volumetric} collapse={(x) => (Object.keys(x).length ? x : true)} />}
        </>
      )}
      {shadows && (
        <>
          <button type="button" onClick={() => setShadowOpen((x) => !x)} className="mx-3 mt-0.5 text-2xs text-fg-faint hover:text-fg">
            {shadowOpen ? "−" : "+"} {t("lights.shadow")}
            {l.shadow && <span className="ml-1 text-accent">•</span>}
          </button>
          {shadowOpen && <SubForm specs={LIGHT_SHADOW_SPECS} path={`${path}.shadow`} value={l.shadow} collapse={(x) => (Object.keys(x).length ? x : undefined)} />}
        </>
      )}
    </>
  );
}

function AudioSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const bind = useBinder();
  const audio = scene.audio;
  const music = audio?.music;
  const musicPresets = SOUND_PRESETS.filter((s) => /music|loop|pad/.test(s.description.toLowerCase()) || s.id.includes("loop") || s.id.includes("pad"));
  return (
    <Section title={t("scene.audio")} id="audio" defaultOpen={!!audio}>
      <Row label={t("scene.music")}>
        <Select value={music?.preset ?? ""} placeholder={t("scene.none")} options={musicPresets.map((s) => s.id)} onChange={(v) => bind("audio.music", v ? { preset: v, volume: music?.volume ?? 0.5, loop: true } : undefined)} ariaLabel={t("scene.music")} />
      </Row>
      {music && (
        <Row label={t("scene.volume")}>
          <NumberField value={music.volume ?? 1} min={0} max={1} onChange={(n, f) => bind("audio.music.volume", n, f)} ariaLabel={t("scene.volume")} />
        </Row>
      )}
      <Row label={t("scene.muted")}>
        <Toggle checked={audio?.muted ?? true} onChange={(v) => bind("audio.muted", v)} ariaLabel={t("scene.muted")} />
      </Row>
      {audio?.sounds && <div className="px-3 text-2xs text-fg-faint">{t("scene.sounds", { list: Object.keys(audio.sounds).join(", ") })}</div>}
    </Section>
  );
}

function UiSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const { edit } = useEditor();
  const els = scene.ui?.elements ?? [];
  return (
    <Section
      title={
        <span>
          {t("scene.hud")} {els.length > 0 && <span className="font-normal text-fg-faint">{els.length}</span>}
        </span>
      }
      id="ui"
      defaultOpen={els.length > 0}
      actions={
        <IconButton
          label={t("scene.addHud")}
          className="h-6 w-6"
          onClick={() => {
            const id = uniqueId("label", takenIds(scene));
            edit(scene.ui ? [{ op: "set", path: `ui.elements[${els.length}]`, value: { id, type: "text", text: "Hello", anchor: "top-left" } }] : [{ op: "set", path: "ui", value: { elements: [{ id, type: "text", text: "Hello", anchor: "top-left" }] } }]);
          }}
        >
          <Plus size={13} />
        </IconButton>
      }
    >
      {scene.ui && <ParamForm specs={UI_THEME_SPECS} base="ui" values={rec(scene.ui)} />}
      <div className="space-y-1.5 px-2 pt-1">
        {els.map((el, i) => (
          <div key={el.id} className="rounded-md border border-line bg-ink-0/40 pb-1">
            <div className="flex h-7 items-center gap-1 pl-2 pr-1">
              <span className="flex-1 truncate font-mono text-2xs">{el.id}</span>
              <IconButton label={t("scene.removeHud")} className="h-5 w-5" onClick={() => edit([{ op: "remove", path: `ui.elements[${i}]` }])}>
                <X size={11} />
              </IconButton>
            </div>
            <ParamForm specs={UI_ELEMENT_SPECS} base={`ui.elements[${i}]`} values={rec(el)} />
          </div>
        ))}
      </div>
    </Section>
  );
}
