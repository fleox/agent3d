// Scene inspector: environment — background (colour, gradients, mesh
// gradient, gradient or physical sky, HDRI), image lighting, light rig,
// contact shadows, shadow quality, fog (incl. height fog) and ground.

import clsx from "clsx";
import { LIGHT_RIGS, catalogEntry } from "../../core/catalog";
import type { BackgroundDef, EnvironmentDef, SceneDoc, SkyParams } from "../../core/types";
import { LIGHTING_PRESETS, SKY_PRESETS } from "../../core/validate";
import { HdriPicker } from "../components/HdriPicker";
import { ColorField, ColorsField } from "../components/ui/ColorField";
import { SliderField } from "../components/ui/NumberField";
import { Row, Section, Select, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { pretty } from "../lib/labels";
import { ParamForm, SubForm, useBinder } from "./fields";
import { CONTACT_SHADOW_SPECS, FOG_EXP_SPECS, FOG_LINEAR_SPECS, GROUND_PROJECTION_SPECS, GROUND_SPECS, HDRI_BG_SPECS, MESH_GRADIENT_SPECS, RIG_LIGHTING_SPECS, SHADOW_SETTINGS_SPECS, SKY_GRADIENT_SPECS, SKY_PHYSICAL_SPECS, SKY_SUN_SPECS } from "./specs";

const rec = (v: unknown) => v as Record<string, unknown> | undefined;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export type BgMode = "color" | "gradient" | "radial" | "meshGradient" | "sky" | "physicalSky" | "hdri" | "transparent";
export function bgMode(bg: BackgroundDef): BgMode {
  if (bg === "transparent") return "transparent";
  if (typeof bg === "string") return "color";
  if ("gradient" in bg) return "gradient";
  if ("radial" in bg) return "radial";
  if ("meshGradient" in bg) return "meshGradient";
  if ("sky" in bg) return bg.sky.physical || bg.sky.preset ? "physicalSky" : "sky";
  return "hdri";
}
export const BG_DEFAULTS: Record<BgMode, BackgroundDef> = {
  color: "#15171c",
  gradient: { gradient: ["#141e30", "#243b55"], angle: 0 },
  radial: { radial: ["#2b3350", "#0d0f16"] },
  meshGradient: { meshGradient: ["#ff6ec4", "#7873f5", "#4adede", "#ffd86f"], speed: 0.2 },
  sky: { sky: { top: "#3a7bd5", horizon: "#f6d5a8", bottom: "#d1d7e0" } },
  physicalSky: { sky: { preset: "golden-hour" } },
  hdri: { hdri: "library:hdri/studio.hdr", blur: 0.5 },
  transparent: "transparent",
};

// Chip colours for the physical sky presets (horizon → zenith).
const SKY_CHIPS: Record<string, [string, string]> = {
  sunrise: ["#f8b878", "#8fb6e8"],
  morning: ["#dfeaf5", "#6fa3dc"],
  noon: ["#cfe6ff", "#3d82d6"],
  afternoon: ["#f3e2c4", "#5b93d1"],
  "golden-hour": ["#ffb56b", "#6e8fc9"],
  sunset: ["#ff7a45", "#4b4f8f"],
  dusk: ["#b26a8a", "#1f2550"],
};

export function EnvironmentSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const bind = useBinder();
  const env: EnvironmentDef = scene.environment ?? { background: "#000000" };
  const bg = env.background;
  const mode = bgMode(bg);
  const B = "environment.background";
  const sky = (isObj(bg) && "sky" in bg ? bg.sky : {}) as SkyParams;
  return (
    <>
      <Section title={t("scene.environment")} id="environment">
        <Row label={t("scene.background")}>
          <Select value={mode} options={(Object.keys(BG_DEFAULTS) as BgMode[]).map((m) => ({ value: m, label: t(`bg.${m}`) }))} onChange={(v) => bind(B, BG_DEFAULTS[v as BgMode])} ariaLabel={t("scene.background")} />
        </Row>
        {mode === "color" && (
          <Row label={t("scene.color")}>
            <ColorField value={bg as string} onChange={(v, f) => bind(B, v, f)} />
          </Row>
        )}
        {(mode === "gradient" || mode === "radial" || mode === "meshGradient") && (
          <>
            <Row label={t("scene.colors")}>
              <ColorsField value={(rec(bg)?.[mode] as string[]) ?? []} onChange={(v, f) => bind(`${B}.${mode}`, v, f)} />
            </Row>
            {mode === "gradient" && <ParamForm specs={[{ name: "angle", type: "number", description: "Degrees, 0 = bottom → top.", default: 0, min: -180, max: 180 }, { name: "grain", type: "number", description: "Film grain.", default: 0, min: 0, max: 1 }]} base={B} values={rec(bg)} />}
            {mode === "radial" && <ParamForm specs={[{ name: "center", type: "vec2", description: "0..1 (default centre).", default: [0.5, 0.5] }, { name: "radius", type: "number", description: "", default: 1, min: 0.05, max: 3 }, { name: "grain", type: "number", description: "Film grain.", default: 0, min: 0, max: 1 }]} base={B} values={rec(bg)} />}
            {mode === "meshGradient" && <ParamForm specs={MESH_GRADIENT_SPECS} base={B} values={rec(bg)} />}
          </>
        )}
        {mode === "sky" && <ParamForm specs={SKY_GRADIENT_SPECS} base={`${B}.sky`} values={rec(sky)} />}
        {mode === "physicalSky" && (
          <>
            <div className="grid grid-cols-4 gap-1 px-3 py-1" role="radiogroup" aria-label={t("env.skyPreset")}>
              {SKY_PRESETS.map((p) => {
                const [a, b] = SKY_CHIPS[p] ?? ["#888", "#444"];
                const on = sky.preset === p;
                return (
                  <button key={p} type="button" role="radio" aria-checked={on} title={pretty(p)} onClick={() => bind(`${B}.sky.preset`, p)} className={clsx("overflow-hidden rounded-md text-left ring-1 transition", on ? "ring-accent" : "ring-line hover:ring-fg-faint")}>
                    <span className="block h-6 w-full" style={{ background: `linear-gradient(0deg, ${a}, ${b})` }} />
                    <span className={clsx("block truncate px-1 py-0.5 text-[10px]", on ? "text-accent" : "text-fg-muted")}>{pretty(p)}</span>
                  </button>
                );
              })}
            </div>
            <div className="mx-3 mb-0.5 mt-1.5 text-2xs font-medium uppercase tracking-wide text-fg-faint">{t("env.sun")}</div>
            {sky.sun === false ? (
              <Row label={t("env.sun")}>
                <Toggle checked={false} onChange={() => bind(`${B}.sky.sun`, undefined)} ariaLabel={t("env.sun")} />
              </Row>
            ) : (
              <>
                <SubForm specs={SKY_SUN_SPECS} path={`${B}.sky.sun`} value={sky.sun} collapse={(x) => (Object.keys(x).length ? x : undefined)} />
                <Row label={t("env.noSun")}>
                  <Toggle checked={false} onChange={() => bind(`${B}.sky.sun`, false)} ariaLabel={t("env.noSun")} />
                </Row>
              </>
            )}
            <div className="mx-3 mb-0.5 mt-1.5 text-2xs font-medium uppercase tracking-wide text-fg-faint">{t("env.atmosphere")}</div>
            <ParamForm specs={SKY_PHYSICAL_SPECS} base={`${B}.sky`} values={rec(sky)} skip={["preset"]} />
          </>
        )}
        {mode === "hdri" && isObj(bg) && "hdri" in bg && (
          <>
            <Row label="HDRI">
              <HdriPicker value={bg.hdri} onChange={(v) => bind(`${B}.hdri`, v)} />
            </Row>
            <ParamForm specs={HDRI_BG_SPECS} base={B} values={rec(bg)} />
            <Row label={t("env.groundProjection")} hint={t("env.groundProjectionHint")}>
              <Toggle checked={!!bg.groundProjection} onChange={(v) => bind(`${B}.groundProjection`, v || undefined)} ariaLabel={t("env.groundProjection")} />
            </Row>
            {bg.groundProjection && <SubForm specs={GROUND_PROJECTION_SPECS} path={`${B}.groundProjection`} value={bg.groundProjection} collapse={(x) => (Object.keys(x).length ? x : true)} />}
          </>
        )}
      </Section>
      <LightingSection env={env} />
      <ShadowsSection env={env} />
      <AtmosphereSection env={env} />
    </>
  );
}

function LightingSection({ env }: { env: EnvironmentDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const lighting = isObj(env.lighting) ? "hdri" : (env.lighting ?? "none");
  const rig = env.rig;
  const rigId = typeof rig === "string" ? rig : rig?.preset;
  const rigEntry = rigId ? catalogEntry("lightRigs", rigId) : undefined;
  return (
    <Section title={t("env.lighting")} id="env-lighting">
      <Row label={t("scene.lighting")} hint={t("scene.lightingHint")}>
        <Select
          value={lighting}
          options={[...LIGHTING_PRESETS.map((p) => ({ value: p, label: t(`lighting.${p}`) })), { value: "hdri", label: t("lighting.hdri") }]}
          onChange={(v) => bind("environment.lighting", v === "hdri" ? { hdri: "library:hdri/studio.hdr" } : v)}
          ariaLabel={t("scene.lighting")}
        />
      </Row>
      {isObj(env.lighting) && (
        <>
          <Row label="HDRI">
            <HdriPicker value={env.lighting.hdri} onChange={(v) => bind("environment.lighting.hdri", v)} />
          </Row>
          <ParamForm specs={RIG_LIGHTING_SPECS} base="environment.lighting" values={rec(env.lighting)} />
        </>
      )}
      <Row label={t("env.lightingIntensity")} hint={t("scene.lightingHint")} overridden={env.lightingIntensity !== undefined} onReset={() => bind("environment.lightingIntensity", undefined)}>
        <SliderField value={env.lightingIntensity ?? 1} min={0} max={4} placeholder={env.lightingIntensity === undefined} onChange={(n, f) => bind("environment.lightingIntensity", n === 1 ? undefined : n, f)} ariaLabel={t("scene.intensity")} />
      </Row>
      <Row label={t("env.rig")} hint={t("env.rigHint")}>
        <Select value={rigId ?? ""} placeholder={t("scene.none")} options={LIGHT_RIGS.map((r) => ({ value: r.id, label: pretty(r.id) }))} onChange={(v) => bind("environment.rig", v ? (isObj(rig) ? { ...(rig as Record<string, unknown>), preset: v } : v) : undefined)} ariaLabel={t("env.rig")} />
      </Row>
      {rigEntry && (
        <>
          <div className="px-3 pb-1 text-2xs leading-snug text-fg-faint">{rigEntry.description}</div>
          <SubForm specs={rigEntry.params} path="environment.rig" value={rig} expand={(v) => ({ preset: v })} collapse={(x) => (Object.keys(x).length === 1 ? x.preset : x)} />
        </>
      )}
    </Section>
  );
}

function ShadowsSection({ env }: { env: EnvironmentDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const cs = env.contactShadows;
  return (
    <Section title={t("env.shadows")} id="env-shadows" defaultOpen={!!cs || !!env.shadows}>
      <Row label={t("env.contactShadows")} hint={t("env.contactShadowsHint")}>
        <Toggle checked={!!cs} onChange={(v) => bind("environment.contactShadows", v || undefined)} ariaLabel={t("env.contactShadows")} />
      </Row>
      {cs && <SubForm specs={CONTACT_SHADOW_SPECS} path="environment.contactShadows" value={cs} collapse={(x) => (Object.keys(x).length ? x : true)} />}
      <Row label={t("env.shadowQuality")} hint={t("env.shadowQualityHint")}>
        <Toggle checked={!!env.shadows} onChange={(v) => bind("environment.shadows", v ? { type: "vsm", softness: 4 } : undefined)} ariaLabel={t("env.shadowQuality")} />
      </Row>
      {env.shadows && <ParamForm specs={SHADOW_SETTINGS_SPECS} base="environment.shadows" values={rec(env.shadows)} />}
    </Section>
  );
}

function AtmosphereSection({ env }: { env: EnvironmentDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const fog = env.fog;
  const fogMode = fog ? ("density" in fog ? ("height" in fog && fog.height !== undefined ? "height" : "exp") : "linear") : "off";
  return (
    <Section title={t("env.atmosphereGround")} id="env-fog" defaultOpen={!!fog || !!env.ground}>
      <Row label={t("scene.fog")}>
        <Select
          value={fogMode}
          options={[
            { value: "off", label: t("scene.off") },
            { value: "linear", label: t("scene.fogLinear") },
            { value: "exp", label: t("scene.fogDensity") },
            { value: "height", label: t("env.fogHeight") },
          ]}
          onChange={(v) =>
            bind(
              "environment.fog",
              v === "off" ? undefined : v === "linear" ? { color: fog?.color ?? "#a0b4c8", near: 10, far: 40 } : v === "exp" ? { color: fog?.color ?? "#a0b4c8", density: 0.03 } : { color: fog?.color ?? "#c8d2dc", density: 0.06, height: 0.5, falloff: 0.6 },
            )
          }
          ariaLabel={t("scene.fog")}
        />
      </Row>
      {fog && <ParamForm specs={"density" in fog ? FOG_EXP_SPECS.filter((s) => fogMode === "height" || (s.name !== "height" && s.name !== "falloff")) : FOG_LINEAR_SPECS} base="environment.fog" values={rec(fog)} />}
      <Row label={t("scene.ground")}>
        <Toggle checked={!!env.ground} onChange={(v) => bind("environment.ground", v ? { y: 0, shadowOnly: true } : undefined)} ariaLabel={t("scene.ground")} />
      </Row>
      {env.ground && <ParamForm specs={GROUND_SPECS} base="environment.ground" values={rec(env.ground)} />}
    </Section>
  );
}
