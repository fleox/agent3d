// Inspector when nothing is selected: the scene itself — meta, target,
// camera, environment, lights, post effects, physics, audio, HUD.

import { Plus, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef } from "react";
import { POSTFX, SOUND_PRESETS, catalogEntry } from "../../core/catalog";
import type { BackgroundDef, EnvironmentDef, LightDef, SceneDoc } from "../../core/types";
import { LIGHTING_PRESETS, TARGET_KINDS } from "../../core/validate";
import { uniqueId } from "../../core/ids";
import { LIGHT_ICONS } from "../components/icons";
import { ColorField, ColorsField } from "../components/ui/ColorField";
import { PickMenu } from "../components/ui/Menu";
import { NumberField } from "../components/ui/NumberField";
import { Button, IconButton, Row, Section, Select, TextField, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { takenIds } from "../lib/patches";
import { useEditor, useSnapshot, useUi } from "../state/context";
import { ParamForm, useBinder } from "./fields";
import { CAMERA_SPECS, GROUND_SPECS, LIGHT_SPECS, PHYSICS_SPECS, SCENE_META_SPECS, TARGET_SPECS, UI_ELEMENT_SPECS, UI_THEME_SPECS } from "./specs";
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
      <EnvironmentSection scene={scene} />
      <LightsSection scene={scene} />
      <PostFxSection scene={scene} />
      <Section title={t("scene.physics")} id="physics" defaultOpen={!!scene.physics}>
        {scene.physics ? (
          <>
            <ParamForm specs={PHYSICS_SPECS} base="physics" values={rec(scene.physics)} />
            <div className="px-3">
              <Button size="xs" variant="ghost" onClick={() => bind("physics", undefined)}>
                <Trash2 size={11} /> {t("scene.disable")}
              </Button>
            </div>
          </>
        ) : (
          <div className="px-3">
            <Button size="xs" onClick={() => bind("physics", { gravity: [0, -9.81, 0] })}>
              <Plus size={11} /> {t("scene.enablePhysics")}
            </Button>
          </div>
        )}
      </Section>
      <AudioSection scene={scene} />
      <UiSection scene={scene} />
    </div>
  );
}

type BgMode = "color" | "gradient" | "radial" | "sky" | "hdri" | "transparent";
function bgMode(bg: BackgroundDef): BgMode {
  if (bg === "transparent") return "transparent";
  if (typeof bg === "string") return "color";
  if ("gradient" in bg) return "gradient";
  if ("radial" in bg) return "radial";
  if ("sky" in bg) return "sky";
  return "hdri";
}
const BG_DEFAULTS: Record<BgMode, BackgroundDef> = {
  color: "#15171c",
  gradient: { gradient: ["#141e30", "#243b55"], angle: 0 },
  radial: { radial: ["#2b3350", "#0d0f16"] },
  sky: { sky: { top: "#3a7bd5", horizon: "#f6d5a8", bottom: "#d1d7e0" } },
  hdri: { hdri: "library:hdri/studio", blur: 0.5 },
  transparent: "transparent",
};

function EnvironmentSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const bind = useBinder();
  const env: EnvironmentDef = scene.environment ?? { background: "#000000" };
  const bg = env.background;
  const mode = bgMode(bg);
  const lighting = typeof env.lighting === "object" ? "hdri" : (env.lighting ?? "none");
  const fog = env.fog;
  const fogMode = fog ? ("density" in fog ? "exp" : "linear") : "off";
  return (
    <Section title={t("scene.environment")} id="environment">
      <Row label={t("scene.background")}>
        <Select value={mode} options={(["color", "gradient", "radial", "sky", "hdri", "transparent"] as const).map((m) => ({ value: m, label: t(`bg.${m}`) }))} onChange={(v) => bind("environment.background", BG_DEFAULTS[v as BgMode])} ariaLabel={t("scene.background")} />
      </Row>
      {mode === "color" && (
        <Row label={t("scene.color")}>
          <ColorField value={bg as string} onChange={(v, f) => bind("environment.background", v, f)} />
        </Row>
      )}
      {(mode === "gradient" || mode === "radial") && (
        <>
          <Row label={t("scene.colors")}>
            <ColorsField value={(bg as { gradient?: string[]; radial?: string[] })[mode === "gradient" ? "gradient" : "radial"] ?? []} onChange={(v, f) => bind(`environment.background.${mode}`, v, f)} />
          </Row>
          {mode === "gradient" && (
            <Row label={t("scene.angle")}>
              <NumberField value={(bg as { angle?: number }).angle ?? 0} suffix="°" onChange={(n, f) => bind("environment.background.angle", n, f)} ariaLabel={t("scene.angle")} />
            </Row>
          )}
        </>
      )}
      {mode === "sky" && (
        <>
          {(["top", "horizon", "bottom"] as const).map((k) => (
            <Row key={k} label={pretty(k)}>
              <ColorField value={(bg as { sky: Record<string, string> }).sky[k] ?? "#ffffff"} onChange={(v, f) => bind(`environment.background.sky.${k}`, v, f)} />
            </Row>
          ))}
          <Row label={t("scene.stars")}>
            <NumberField value={(bg as { sky: { stars?: number } }).sky.stars ?? 0} integer min={0} onChange={(n, f) => bind("environment.background.sky.stars", n || undefined, f)} ariaLabel={t("scene.stars")} />
          </Row>
        </>
      )}
      {mode === "hdri" && (
        <>
          <Row label="HDRI">
            <TextField value={(bg as { hdri: string }).hdri} onCommit={(v) => bind("environment.background.hdri", v)} ariaLabel="HDRI" />
          </Row>
          <Row label={t("scene.blur")}>
            <NumberField value={(bg as { blur?: number }).blur ?? 0} min={0} max={1} onChange={(n, f) => bind("environment.background.blur", n, f)} ariaLabel={t("scene.blur")} />
          </Row>
        </>
      )}
      <Row label={t("scene.lighting")} hint={t("scene.lightingHint")}>
        <Select value={lighting} options={[...LIGHTING_PRESETS, ...(lighting === "hdri" ? ["hdri"] : [])]} onChange={(v) => bind("environment.lighting", v === "none" ? "none" : v)} ariaLabel={t("scene.lighting")} />
      </Row>
      <Row label={t("scene.intensity")}>
        <NumberField value={env.lightingIntensity ?? 1} min={0} placeholder={env.lightingIntensity === undefined} onChange={(n, f) => bind("environment.lightingIntensity", n === 1 ? undefined : n, f)} ariaLabel={t("scene.intensity")} />
      </Row>
      <Row label={t("scene.fog")}>
        <Select
          value={fogMode}
          options={[
            { value: "off", label: t("scene.off") },
            { value: "linear", label: t("scene.fogLinear") },
            { value: "exp", label: t("scene.fogDensity") },
          ]}
          onChange={(v) => bind("environment.fog", v === "off" ? undefined : v === "linear" ? { color: fog?.color ?? "#a0b4c8", near: 10, far: 40 } : { color: fog?.color ?? "#a0b4c8", density: 0.03 })}
          ariaLabel={t("scene.fog")}
        />
      </Row>
      {fog && (
        <ParamForm
          specs={[
            { name: "color", type: "color", description: "", default: "#ffffff" },
            ...("density" in fog
              ? [{ name: "density", type: "number" as const, description: "", min: 0, max: 1 }]
              : [
                  { name: "near", type: "number" as const, description: "", min: 0 },
                  { name: "far", type: "number" as const, description: "", min: 0 },
                ]),
          ]}
          base="environment.fog"
          values={rec(fog)}
        />
      )}
      <Row label={t("scene.ground")}>
        <Toggle checked={!!env.ground} onChange={(v) => bind("environment.ground", v ? { y: 0, shadowOnly: true } : undefined)} ariaLabel={t("scene.ground")} />
      </Row>
      {env.ground && <ParamForm specs={GROUND_SPECS} base="environment.ground" values={rec(env.ground)} />}
    </Section>
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
            </div>
          );
        })}
        {!lights.length && <div className="px-1 text-2xs text-fg-faint">{t("scene.noLights")}</div>}
      </div>
    </Section>
  );
}

function PostFxSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const { edit } = useEditor();
  const list = scene.postfx ?? [];
  return (
    <Section
      title={
        <span>
          {t("scene.postfx")} {list.length > 0 && <span className="font-normal text-fg-faint">{list.length}</span>}
        </span>
      }
      id="postfx"
      defaultOpen={list.length > 0}
      actions={
        <PickMenu
          placeholder={t("scene.searchEffects")}
          items={POSTFX.map((p) => ({ id: p.id, label: pretty(p.id), hint: p.description }))}
          onPick={(id) => edit([{ op: "set", path: `postfx[${list.length}]`, value: { type: id } }])}
          trigger={(open) => (
            <IconButton label={t("scene.addEffect")} onClick={open} className="h-6 w-6">
              <Plus size={13} />
            </IconButton>
          )}
        />
      }
    >
      <div className="space-y-1.5 px-2">
        {list.map((fx, i) => {
          const entry = catalogEntry("postfx", fx.type);
          return (
            <div key={`${fx.type}-${i}`} className="rounded-md border border-line bg-ink-0/40 pb-1">
              <div className="flex h-7 items-center gap-1 pl-2 pr-1">
                <span className="flex-1 truncate text-xs font-medium" title={entry?.description}>
                  {pretty(fx.type)}
                </span>
                <IconButton label={t("scene.removeEffect")} className="h-5 w-5" onClick={() => edit(list.length === 1 ? [{ op: "remove", path: "postfx" }] : [{ op: "remove", path: `postfx[${i}]` }])}>
                  <X size={11} />
                </IconButton>
              </div>
              {entry && <ParamForm specs={entry.params} base={`postfx[${i}]`} values={rec(fx)} />}
            </div>
          );
        })}
        {!list.length && <div className="px-1 text-2xs text-fg-faint">{t("scene.noEffects")}</div>}
      </div>
    </Section>
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
