import { Link2, Link2Off, Plus, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { useState } from "react";
import { BEHAVIOURS, GENERATORS, GEOMETRIES, SHADERS, catalogEntry, materialPreset, type ParamSpec } from "../../core/catalog";
import type { BehaviourDef, MaterialDef, ObjectDef } from "../../core/types";
import { BEHAVIOUR_WHEN } from "../../core/validate";
import { KindIcon } from "../components/icons";
import { NumberField, VecField } from "../components/ui/NumberField";
import { PickMenu } from "../components/ui/Menu";
import { Button, IconButton, Row, Section, Select, TextField, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { behaviourFromEntry, MATERIAL_KINDS, objPath } from "../lib/patches";
import { useEditor, useSnapshot } from "../state/context";
import { JsonField, ParamForm, ParamRow, SubForm, useBinder } from "./fields";
import { BODY_FLAG_SPECS, BODY_MOTION_SPECS, BODY_SPECS, COLLIDER_SPECS, MATERIAL_GROUPS, MATERIAL_MAIN, MATERIAL_MORE, MATERIAL_TYPE_SPEC, MODEL_ANIM_SPECS, MODEL_SPECS, OBJECT_FLAGS, PARTICLE_SPECS, SVG_SPECS, TEXT_OUTLINE_SPECS, TEXT_REVEAL_SPECS, TEXT_SPECS, TEXTURE_MAPPING_SPECS, TEXTURE_SLOT_SCALES } from "./specs";
import { FontPicker } from "../components/FontPicker";
import { EaseField } from "../components/EaseField";
import { MaterialPresetPicker } from "../components/MaterialPresetPicker";
import { TextureField } from "../components/TextureField";
import { MATERIAL_TEXTURE_SLOTS } from "../../core/validate";
import type { BodyDef, ColliderDef, TextObjectDef, TextureRef } from "../../core/types";
import { pretty } from "../lib/labels";

const SAMPLE_REQUIRED: Record<string, Record<string, unknown>> = {
  lathe: { points: [[0, 0], [0.4, 0], [0.5, 0.3], [0.3, 0.8], [0.35, 1.2], [0, 1.2]] },
  extrude: { shape: [[0, 0.5], [0.15, 0.15], [0.5, 0.1], [0.2, -0.12], [0.3, -0.5], [0, -0.25], [-0.3, -0.5], [-0.2, -0.12], [-0.5, 0.1], [-0.15, 0.15]] },
  tube: { points: [[-1.5, 0, 0], [-0.5, 0.6, 0.3], [0.5, -0.4, -0.3], [1.5, 0.2, 0]] },
};

export function ObjectInspector({ object: o }: { object: ObjectDef }) {
  const { t } = useI18n();
  const { edit, store } = useEditor();
  const bind = useBinder();
  const p = (f: string) => objPath(o.id, f);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent">
          <KindIcon kind={o.kind} size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs text-fg" title={t("inspector.idHint")}>
            {o.id}
          </div>
          <div className="text-2xs text-fg-faint">{t(`kinds.${o.kind}`)}</div>
        </div>
        <IconButton label={t("outliner.delete")} onClick={() => edit([{ op: "removeObject", id: o.id }])}>
          <Trash2 size={13} />
        </IconButton>
        <IconButton label={t("inspector.deselect")} shortcut="Esc" onClick={() => store.select(null)}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="border-b border-line py-1.5">
        <Row label={t("inspector.name")}>
          <TextField value={o.name ?? ""} placeholder={o.id} onCommit={(v) => bind(p("name"), v.trim() || undefined)} ariaLabel={t("inspector.name")} />
        </Row>
        <Row label={t("inspector.visible")}>
          <Toggle checked={o.visible !== false} onChange={(v) => bind(p("visible"), v ? undefined : false)} ariaLabel={t("inspector.visible")} />
        </Row>
      </div>

      <Section title={t("inspector.transform")} id="transform">
        <Row label={t("inspector.position")}>
          <VecField value={o.position ?? [0, 0, 0]} placeholder={!o.position} step={0.01} onChange={(v, f) => bind(p("position"), v, f)} />
        </Row>
        <Row label={t("inspector.rotation")}>
          <VecField value={o.rotation ?? [0, 0, 0]} placeholder={!o.rotation} step={0.5} suffix="°" onChange={(v, f) => bind(p("rotation"), v, f)} />
        </Row>
        <ScaleRow object={o} />
      </Section>

      <KindSection object={o} />
      {MATERIAL_KINDS.has(o.kind) && <MaterialSection object={o as ObjectDef & { material?: MaterialDef }} />}
      <BehavioursSection object={o} />
      <BodySection object={o} />
      <Section title={t("inspector.advanced")} id="advanced" defaultOpen={false}>
        <ParamForm specs={OBJECT_FLAGS} base={objPath(o.id, "")} values={o as unknown as Record<string, unknown>} />
        <Row label={t("inspector.tags")} hint={t("inspector.tagsHint")}>
          <TextField value={(o.tags ?? []).join(", ")} onCommit={(v) => bind(p("tags"), v.trim() ? v.split(/[\s,]+/).filter(Boolean) : undefined)} ariaLabel={t("inspector.tags")} />
        </Row>
      </Section>
    </div>
  );
}

function ScaleRow({ object: o }: { object: ObjectDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const uniform = o.scale === undefined || typeof o.scale === "number";
  const path = objPath(o.id, "scale");
  const vec = typeof o.scale === "number" ? [o.scale, o.scale, o.scale] : (o.scale ?? [1, 1, 1]);
  return (
    <Row label={t("inspector.scale")}>
      {uniform ? (
        <NumberField label="⇔" value={typeof o.scale === "number" ? o.scale : 1} placeholder={o.scale === undefined} step={0.01} min={0} onChange={(n, f) => bind(path, n === 1 ? undefined : n, f)} ariaLabel={t("inspector.scale")} />
      ) : (
        <VecField value={vec} step={0.01} onChange={(v, f) => bind(path, v, f)} />
      )}
      <IconButton
        label={uniform ? t("inspector.scaleSplit") : t("inspector.scaleUniform")}
        className="h-6 w-6"
        onClick={() => bind(path, uniform ? vec : vec[0] === 1 ? undefined : vec[0])}
      >
        {uniform ? <Link2 size={12} /> : <Link2Off size={12} />}
      </IconButton>
    </Row>
  );
}

function KindSection({ object: o }: { object: ObjectDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const values = o as unknown as Record<string, unknown>;
  const base = objPath(o.id, "");
  switch (o.kind) {
    case "mesh":
    case "instances": {
      const entry = catalogEntry("geometries", o.geometry?.type);
      return (
        <Section title={t("inspector.geometry")} id="geometry">
          <Row label={t("inspector.type")}>
            <Select value={o.geometry?.type ?? ""} options={GEOMETRIES.map((g) => ({ value: g.id, label: pretty(g.id) }))} onChange={(v) => bind(objPath(o.id, "geometry"), { type: v, ...(SAMPLE_REQUIRED[v] ?? {}) })} ariaLabel={t("inspector.type")} />
          </Row>
          {entry && <ParamForm specs={entry.params} base={objPath(o.id, "geometry")} values={o.geometry} />}
          {o.kind === "instances" && (
            <Row label={t("inspector.layout")} align="start">
              <JsonField value={o.layout} rows={4} onCommit={(v) => bind(objPath(o.id, "layout"), v)} />
            </Row>
          )}
        </Section>
      );
    }
    case "text":
      return <TextSections object={o} />;
    case "model":
      return (
        <Section title={t("kinds.model")} id="model">
          <ParamForm specs={MODEL_SPECS} base={base} values={values} />
          <ParamForm specs={MODEL_ANIM_SPECS} base={objPath(o.id, "animation")} values={o.animation as Record<string, unknown> | undefined} />
        </Section>
      );
    case "generator": {
      const entry = catalogEntry("generators", o.generator);
      return (
        <Section title={t("kinds.generator")} id="generator">
          <Row label={t("inspector.type")}>
            <Select value={o.generator} options={GENERATORS.map((g) => ({ value: g.id, label: pretty(g.id) }))} onChange={(v) => bind(objPath(o.id, "generator"), v, true, o.params ? [{ op: "remove", path: objPath(o.id, "params") }] : [])} ariaLabel={t("inspector.type")} />
          </Row>
          {entry && <div className="px-3 pb-1 text-2xs leading-snug text-fg-faint">{entry.description}</div>}
          <Row label={t("inspector.seed")}>
            <NumberField value={o.seed ?? 1} integer placeholder={o.seed === undefined} onChange={(n, f) => bind(objPath(o.id, "seed"), n, f)} ariaLabel={t("inspector.seed")} />
          </Row>
          {entry && <ParamForm specs={entry.params} base={objPath(o.id, "params")} values={o.params} />}
        </Section>
      );
    }
    case "particles":
      return (
        <Section title={t("kinds.particles")} id="particles">
          <ParamForm specs={PARTICLE_SPECS} base={base} values={values} />
        </Section>
      );
    case "svg":
      return (
        <Section title={t("kinds.svg")} id="svg">
          <Row label="SVG" align="start">
            <TextField multiline mono value={o.src} onCommit={(v) => bind(objPath(o.id, "src"), v)} ariaLabel="SVG" />
          </Row>
          <ParamForm specs={SVG_SPECS.map((sp) => (sp.name === "keepColors" ? { ...sp, default: !o.material } : sp))} base={base} values={values} />
        </Section>
      );
    default:
      return null;
  }
}

function TextSections({ object: o }: { object: TextObjectDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const base = objPath(o.id, "");
  const values = o as unknown as Record<string, unknown>;
  const outline = o.outline;
  const reveal = o.reveal;
  return (
    <>
      <Section title={t("kinds.text")} id="text">
        <Row label={t("inspector.text")} align="start">
          <TextField multiline value={o.text} onCommit={(v) => bind(objPath(o.id, "text"), v)} ariaLabel={t("inspector.text")} />
        </Row>
        <Row label={t("inspector.font")} overridden={o.font !== undefined} onReset={() => bind(objPath(o.id, "font"), undefined)}>
          <FontPicker value={o.font ?? "sans-bold"} onChange={(id) => bind(objPath(o.id, "font"), id === "sans-bold" ? undefined : id)} />
        </Row>
        <ParamForm specs={TEXT_SPECS} base={base} values={values} skip={["font", "splitLetters"]} />
      </Section>
      <Section title={t("inspector.outline")} id="text-outline" defaultOpen={!!outline} actions={<Toggle checked={!!outline} onChange={(v) => bind(objPath(o.id, "outline"), v ? true : undefined)} ariaLabel={t("inspector.outline")} />}>
        {outline ? (
          <SubForm specs={TEXT_OUTLINE_SPECS} path={objPath(o.id, "outline")} value={outline} collapse={(x) => (Object.keys(x).length ? x : true)} />
        ) : (
          <div className="px-3 text-2xs text-fg-faint">{t("inspector.outlineHint")}</div>
        )}
      </Section>
      <Section title={t("inspector.reveal")} id="text-reveal" defaultOpen={!!reveal} actions={<Toggle checked={!!reveal} onChange={(v) => bind(objPath(o.id, "reveal"), v ? { effect: "rise" } : undefined)} ariaLabel={t("inspector.reveal")} />}>
        {reveal ? (
          <>
            <ParamForm specs={TEXT_REVEAL_SPECS} base={objPath(o.id, "reveal")} values={reveal as Record<string, unknown>} />
            <Row label={t("inspector.ease")} overridden={reveal.ease !== undefined} onReset={() => bind(objPath(o.id, "reveal.ease"), undefined)}>
              <EaseField value={reveal.ease} placeholder={reveal.effect === "scale" || reveal.effect === "spin" ? "outBack" : "outCubic"} onChange={(v) => bind(objPath(o.id, "reveal.ease"), v)} />
            </Row>
          </>
        ) : (
          <>
            <Row label={pretty("splitLetters")} hint={TEXT_SPECS.find((x) => x.name === "splitLetters")?.description}>
              <Toggle checked={!!o.splitLetters} onChange={(v) => bind(objPath(o.id, "splitLetters"), v || undefined)} ariaLabel="splitLetters" />
            </Row>
            <div className="px-3 text-2xs text-fg-faint">{t("inspector.revealHint")}</div>
          </>
        )}
      </Section>
    </>
  );
}

function MaterialSection({ object: o }: { object: ObjectDef & { material?: MaterialDef } }) {
  const { t } = useI18n();
  const bind = useBinder();
  const [more, setMore] = useState(false);
  const m = o.material ?? {};
  const base = objPath(o.id, "material");
  const preset = m.preset ? materialPreset(m.preset) : undefined;
  // Preset values are the defaults: an override shows as set (with reset).
  const withPreset = (specs: typeof MATERIAL_MAIN) => specs.map((s) => (preset && preset.props[s.name] !== undefined ? { ...s, default: preset.props[s.name] } : s));
  const shader = m.type === "shader" && m.shader ? catalogEntry("shaders", m.shader) : undefined;
  const type = m.type ?? (preset?.props.type as string | undefined) ?? "standard";
  const eff = { ...(preset?.props ?? {}), ...m } as Record<string, unknown>;
  const physical = type === "physical";
  const lit = type !== "shader" && type !== "normal";
  const slots = MATERIAL_TEXTURE_SLOTS.filter((sl) => m[sl] !== undefined || more);
  const hasTextures = MATERIAL_TEXTURE_SLOTS.some((sl) => eff[sl] !== undefined);
  return (
    <>
      <Section title={t("inspector.material")} id="material">
        <Row label={t("inspector.preset")}>
          <MaterialPresetPicker value={m.preset} onChange={(v) => bind(`${base}.preset`, v)} />
        </Row>
        {preset && <div className="px-3 pb-1 text-2xs leading-snug text-fg-faint">{preset.description}</div>}
        <ParamRow spec={preset?.props.type ? { ...MATERIAL_TYPE_SPEC, default: preset.props.type } : MATERIAL_TYPE_SPEC} value={m.type} onChange={(v) => bind(`${base}.type`, v)} />
        {m.type === "shader" && (
          <Row label={t("inspector.shader")}>
            <Select value={m.shader ?? ""} placeholder="—" options={SHADERS.map((s) => ({ value: s.id, label: pretty(s.id) }))} onChange={(v) => bind(`${base}.shader`, v || undefined)} ariaLabel={t("inspector.shader")} />
          </Row>
        )}
        {shader && <ParamForm specs={shader.params} base={`${base}.uniforms`} values={m.uniforms as Record<string, unknown> | undefined} />}
        {m.type !== "shader" && <ParamForm specs={withPreset(MATERIAL_MAIN)} base={base} values={m as Record<string, unknown>} />}
        {type === "gradient" && (
          <>
            <ParamRow spec={{ name: "gradient", type: "colors", description: "Vertical colour ramp.", default: (preset?.props.gradient as string[] | undefined) ?? ["#ff7eb3", "#7afcff"] }} value={m.gradient} onChange={(v) => bind(`${base}.gradient`, v)} />
            <ParamRow spec={{ name: "gradientEmissive", type: "boolean", description: "The ramp drives the emissive glow too.", default: (preset?.props.gradientEmissive as boolean | undefined) ?? false }} value={m.gradientEmissive} onChange={(v) => bind(`${base}.gradientEmissive`, v)} />
          </>
        )}
        <button type="button" onClick={() => setMore((x) => !x)} className="mx-3 mt-1 text-2xs text-fg-faint hover:text-fg">
          {more ? t("inspector.lessOptions") : t("inspector.moreOptions")}
        </button>
        {more && <ParamForm specs={withPreset(MATERIAL_MORE)} base={base} values={m as Record<string, unknown>} />}
      </Section>
      {lit && (physical || more) && (
        <Section title={t("inspector.physicalLayers")} id="material-physical" defaultOpen={physical}>
          {!physical && <div className="px-3 pb-1 text-2xs text-fg-faint">{t("inspector.physicalHint")}</div>}
          {MATERIAL_GROUPS.map((g) => {
            const active = g.specs.some((sp) => typeof eff[sp.name] === "number" && (eff[sp.name] as number) > 0 && sp.default === 0);
            return <MaterialGroup key={g.id} title={t(`matgroup.${g.id}` as "matgroup.clearcoat")} active={active} specs={withPreset(g.specs)} base={base} values={m as Record<string, unknown>} />;
          })}
        </Section>
      )}
      {lit && (
        <Section title={t("inspector.textures")} id="material-textures" defaultOpen={hasTextures}>
          {(more ? MATERIAL_TEXTURE_SLOTS : slots.length ? slots : (["map", "normalMap", "roughnessMap"] as const)).map((slot) => {
            const scale = TEXTURE_SLOT_SCALES[slot];
            const presetValue = preset?.props[slot] as TextureRef | undefined;
            return (
              <div key={slot} className="px-1">
                <TextureField slot={slot} value={m[slot]} path={`${base}.${slot}`} onChange={(v) => bind(`${base}.${slot}`, v)} />
                {m[slot] === undefined && presetValue !== undefined && <div className="px-3 pb-1 text-2xs text-fg-faint">{t("inspector.fromPreset", { v: typeof presetValue === "string" ? presetValue : `procedural ${presetValue.procedural}` })}</div>}
                {scale && eff[slot] !== undefined && <ParamRow spec={withPreset([scale])[0]} value={m[scale.name as keyof MaterialDef]} onChange={(v, f) => bind(`${base}.${scale.name}`, v, f)} />}
              </div>
            );
          })}
          {hasTextures && (
            <>
              <ParamForm specs={withPreset(TEXTURE_MAPPING_SPECS)} base={base} values={m as Record<string, unknown>} />
              <Row label={pretty("triplanar")} hint={t("inspector.triplanarHint")} overridden={m.triplanar !== undefined} onReset={() => bind(`${base}.triplanar`, undefined)}>
                <Toggle checked={!!(m.triplanar ?? preset?.props.triplanar)} onChange={(v) => bind(`${base}.triplanar`, v ? (typeof preset?.props.triplanar === "number" ? preset.props.triplanar : true) : preset?.props.triplanar ? false : undefined)} ariaLabel="triplanar" />
                {typeof (m.triplanar ?? preset?.props.triplanar) === "number" && <NumberField value={Number(m.triplanar ?? preset?.props.triplanar)} min={0.01} onChange={(n, f) => bind(`${base}.triplanar`, n, f)} className="w-[60px] flex-none" ariaLabel="triplanar scale" />}
              </Row>
            </>
          )}
          {!more && <div className="px-3 pt-1 text-2xs text-fg-faint">{t("inspector.moreSlots")}</div>}
        </Section>
      )}
    </>
  );
}

function MaterialGroup({ title, active, specs, base, values }: { title: string; active: boolean; specs: ParamSpec[]; base: string; values: Record<string, unknown> }) {
  const [open, setOpen] = useState(active);
  const set = specs.some((sp) => values[sp.name] !== undefined);
  return (
    <div className="mx-2 mb-1 rounded-md border border-line/70">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex h-6 w-full items-center gap-1.5 px-2 text-left text-2xs font-medium text-fg-muted hover:text-fg">
        <span className={clsx("h-1.5 w-1.5 rounded-full", active || set ? "bg-accent" : "bg-ink-4")} />
        <span className="flex-1">{title}</span>
        <span className="text-fg-faint">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="pb-1">
          <ParamForm specs={specs} base={base} values={values} />
        </div>
      )}
    </div>
  );
}

export function BehavioursSection({ object: o, pathBase }: { object: { id?: string; behaviours?: BehaviourDef[] }; pathBase?: string }) {
  const { t } = useI18n();
  const { edit } = useEditor();
  useSnapshot();
  const list = o.behaviours ?? [];
  const base = pathBase ?? objPath(o.id!, "behaviours");
  return (
    <Section
      title={
        <span>
          {t("inspector.behaviours")} {list.length > 0 && <span className="font-normal text-fg-faint">{list.length}</span>}
        </span>
      }
      id="behaviours"
      actions={
        <PickMenu
          placeholder={t("inspector.searchBehaviours")}
          items={BEHAVIOURS.map((b) => ({ id: b.id, label: pretty(b.id), hint: b.description }))}
          onPick={(id) => {
            const entry = catalogEntry("behaviours", id)!;
            if (o.id) edit([{ op: "addBehaviour", id: o.id, behaviour: behaviourFromEntry(entry) }]);
            else edit([{ op: "set", path: `${base}[${list.length}]`, value: behaviourFromEntry(entry) }]);
          }}
          trigger={(open) => (
            <IconButton label={t("inspector.addBehaviour")} onClick={open} className="h-6 w-6">
              <Plus size={13} />
            </IconButton>
          )}
        />
      }
    >
      {!list.length && <div className="px-3 text-2xs text-fg-faint">{t("inspector.noBehaviours")}</div>}
      <div className="space-y-1.5 px-2">
        {list.map((b, i) => (
          <BehaviourCard key={`${b.type}-${i}`} behaviour={b} path={`${base}[${i}]`} onRemove={() => edit([{ op: "remove", path: `${base}[${i}]` }])} />
        ))}
      </div>
    </Section>
  );
}

function BehaviourCard({ behaviour: b, path, onRemove }: { behaviour: BehaviourDef; path: string; onRemove(): void }) {
  const { t } = useI18n();
  const bind = useBinder();
  const entry = catalogEntry("behaviours", b.type);
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md border border-line bg-ink-0/40">
      <div className="flex h-7 items-center gap-1 pl-2 pr-1">
        <button type="button" onClick={() => setOpen((x) => !x)} className="min-w-0 flex-1 truncate text-left text-xs font-medium" title={entry?.description}>
          {pretty(b.type)}
        </button>
        <select value={b.when ?? "always"} onChange={(e) => bind(`${path}.when`, e.target.value === "always" ? undefined : e.target.value)} aria-label={t("inspector.when")} className="h-5 rounded bg-transparent px-1 text-2xs text-fg-muted outline-none hover:bg-ink-3">
          {BEHAVIOUR_WHEN.map((w) => (
            <option key={w} value={w}>
              {t(`when.${w}`)}
            </option>
          ))}
        </select>
        <IconButton label={t("inspector.removeBehaviour")} onClick={onRemove} className="h-5 w-5">
          <X size={11} />
        </IconButton>
      </div>
      {open && entry && (
        <div className="pb-1.5">
          <ParamForm specs={entry.params} base={path} values={b} />
          <ParamRow spec={{ name: "delay", type: "number", description: "Seconds before it starts.", default: 0, min: 0 }} value={b.delay} onChange={(v, f) => bind(`${path}.delay`, v, f)} />
        </div>
      )}
      {!entry && <div className="px-2 pb-1.5 text-2xs text-danger">{t("inspector.unknownBehaviour")}</div>}
    </div>
  );
}

function BodySection({ object: o }: { object: ObjectDef }) {
  const { t } = useI18n();
  const bind = useBinder();
  const path = objPath(o.id, "body");
  const body = o.body as BodyDef | undefined;
  const vals = body as unknown as Record<string, unknown> | undefined;
  const shape = body?.shape ?? "box";
  const shapeSpecs = BODY_SPECS.filter((sp) => {
    if (sp.name === "size") return shape === "box";
    if (sp.name === "radius") return shape === "sphere" || shape === "cylinder" || shape === "capsule";
    if (sp.name === "height") return shape === "cylinder" || shape === "capsule";
    return true;
  });
  const dynamic = body?.type === "dynamic";
  const surfaces = Object.keys(useSnapshot().scene?.physics?.materials ?? {});
  const motionSpecs = BODY_MOTION_SPECS.map((sp) => (sp.name === "material" && surfaces.length ? { ...sp, type: "enum" as const, options: ["", ...surfaces], default: "" } : sp));
  return (
    <Section title={t("inspector.physics")} id="body" defaultOpen={!!body}>
      {body ? (
        <>
          <ParamForm specs={shapeSpecs} base={path} values={vals} />
          {shape === "compound" && <CollidersEditor list={body.shapes ?? []} path={`${path}.shapes`} />}
          {(shape === "trimesh" || shape === "heightfield") && dynamic && <div className="mx-3 my-1 rounded bg-danger/10 px-2 py-1 text-2xs text-danger">{t("inspector.staticOnlyShape")}</div>}
          <div className="mx-3 mb-1 mt-1.5 text-2xs font-medium uppercase tracking-wide text-fg-faint">{t("inspector.bodyMotion")}</div>
          <ParamForm specs={motionSpecs.filter((sp) => dynamic || !["mass", "linearDamping", "angularDamping", "gravityScale", "velocity", "angularVelocity"].includes(sp.name) || vals?.[sp.name] !== undefined)} base={path} values={vals} />
          <ParamForm specs={BODY_FLAG_SPECS} base={path} values={vals} />
          <Row label={pretty("collidesWith")} hint={t("inspector.collidesWithHint")} overridden={body.collidesWith !== undefined} onReset={() => bind(`${path}.collidesWith`, undefined)}>
            <TextField value={(body.collidesWith ?? []).join(", ")} placeholder={t("inspector.allLayers")} onCommit={(v) => bind(`${path}.collidesWith`, v.trim() ? v.split(/[\s,]+/).filter(Boolean) : undefined)} ariaLabel="collidesWith" />
          </Row>
          <div className="px-3 pt-1">
            <Button size="xs" variant="ghost" onClick={() => bind(path, undefined)}>
              <Trash2 size={11} /> {t("inspector.removeBody")}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex gap-1 px-3">
          <Button size="xs" onClick={() => bind(path, { type: "static" })}>
            <Plus size={11} /> {t("inspector.addStaticBody")}
          </Button>
          <Button size="xs" onClick={() => bind(path, { type: "dynamic", mass: 1 })}>
            <Plus size={11} /> {t("inspector.addDynamicBody")}
          </Button>
        </div>
      )}
    </Section>
  );
}

function CollidersEditor({ list, path }: { list: ColliderDef[]; path: string }) {
  const { t } = useI18n();
  const { edit } = useEditor();
  return (
    <div className="space-y-1 px-2 py-1">
      {list.map((c, i) => {
        const specs = COLLIDER_SPECS.filter((sp) => (sp.name === "size" ? c.shape === "box" : sp.name === "radius" ? c.shape !== "box" : sp.name === "height" ? c.shape === "cylinder" || c.shape === "capsule" : true));
        return (
          <div key={i} className="rounded-md border border-line bg-ink-0/40 pb-1">
            <div className="flex h-6 items-center gap-1 pl-2 pr-1 text-2xs text-fg-muted">
              <span className="flex-1">{t("inspector.collider", { n: i + 1 })}</span>
              <IconButton label={t("inspector.removeCollider")} className="h-5 w-5" onClick={() => edit([{ op: "remove", path: `${path}[${i}]` }])}>
                <X size={11} />
              </IconButton>
            </div>
            <ParamForm specs={specs} base={`${path}[${i}]`} values={c as unknown as Record<string, unknown>} />
          </div>
        );
      })}
      <Button size="xs" variant="ghost" onClick={() => edit([{ op: "set", path: `${path}[${list.length}]`, value: { shape: "box", size: [1, 1, 1] } }])}>
        <Plus size={11} /> {t("inspector.addCollider")}
      </Button>
    </div>
  );
}
