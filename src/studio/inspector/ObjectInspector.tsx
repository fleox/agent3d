import { Link2, Link2Off, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { BEHAVIOURS, GENERATORS, GEOMETRIES, MATERIAL_PRESETS, SHADERS, catalogEntry, materialPreset } from "../../core/catalog";
import type { BehaviourDef, MaterialDef, ObjectDef } from "../../core/types";
import { BEHAVIOUR_WHEN } from "../../core/validate";
import { KindIcon } from "../components/icons";
import { NumberField, VecField } from "../components/ui/NumberField";
import { PickMenu } from "../components/ui/Menu";
import { Button, IconButton, Row, Section, Select, TextField, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { behaviourFromEntry, MATERIAL_KINDS, objPath } from "../lib/patches";
import { useEditor, useSnapshot } from "../state/context";
import { JsonField, ParamForm, ParamRow, useBinder } from "./fields";
import { BODY_SPECS, MATERIAL_MAIN, MATERIAL_MORE, MATERIAL_TYPE_SPEC, MODEL_ANIM_SPECS, MODEL_SPECS, OBJECT_FLAGS, PARTICLE_SPECS, SVG_SPECS, TEXT_SPECS } from "./specs";

const pretty = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
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
      return (
        <Section title={t("kinds.text")} id="text">
          <Row label={t("inspector.text")} align="start">
            <TextField multiline value={o.text} onCommit={(v) => bind(objPath(o.id, "text"), v)} ariaLabel={t("inspector.text")} />
          </Row>
          <ParamForm specs={TEXT_SPECS} base={base} values={values} />
        </Section>
      );
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
          <ParamForm specs={SVG_SPECS} base={base} values={values} />
        </Section>
      );
    default:
      return null;
  }
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
  return (
    <Section title={t("inspector.material")} id="material">
      <Row label={t("inspector.preset")}>
        <Select value={m.preset ?? ""} placeholder={t("inspector.noPreset")} options={MATERIAL_PRESETS.map((p) => ({ value: p.id, label: pretty(p.id) }))} onChange={(v) => bind(`${base}.preset`, v || undefined)} ariaLabel={t("inspector.preset")} />
      </Row>
      {preset && <div className="px-3 pb-1 text-2xs text-fg-faint">{preset.description}</div>}
      <ParamRow spec={preset?.props.type ? { ...MATERIAL_TYPE_SPEC, default: preset.props.type } : MATERIAL_TYPE_SPEC} value={m.type} onChange={(v) => bind(`${base}.type`, v)} />
      {m.type === "shader" && (
        <Row label={t("inspector.shader")}>
          <Select value={m.shader ?? ""} placeholder="—" options={SHADERS.map((s) => s.id)} onChange={(v) => bind(`${base}.shader`, v || undefined)} ariaLabel={t("inspector.shader")} />
        </Row>
      )}
      {shader && <ParamForm specs={shader.params} base={`${base}.uniforms`} values={m.uniforms as Record<string, unknown> | undefined} />}
      {m.type !== "shader" && <ParamForm specs={withPreset(MATERIAL_MAIN)} base={base} values={m as Record<string, unknown>} />}
      {m.type === "gradient" && <ParamRow spec={{ name: "gradient", type: "colors", description: "Vertical colour ramp.", default: ["#ff7eb3", "#7afcff"] }} value={m.gradient} onChange={(v) => bind(`${base}.gradient`, v)} />}
      <button type="button" onClick={() => setMore((x) => !x)} className="mx-3 mt-1 text-2xs text-fg-faint hover:text-fg">
        {more ? t("inspector.lessOptions") : t("inspector.moreOptions")}
      </button>
      {more && <ParamForm specs={withPreset(MATERIAL_MORE)} base={base} values={m as Record<string, unknown>} />}
    </Section>
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
  return (
    <Section title={t("inspector.physics")} id="body" defaultOpen={!!o.body}>
      {o.body ? (
        <>
          <ParamForm specs={BODY_SPECS} base={path} values={o.body as unknown as Record<string, unknown>} />
          <div className="px-3 pt-1">
            <Button size="xs" variant="ghost" onClick={() => bind(path, undefined)}>
              <Trash2 size={11} /> {t("inspector.removeBody")}
            </Button>
          </div>
        </>
      ) : (
        <div className="px-3">
          <Button size="xs" onClick={() => bind(path, { type: "static" })}>
            <Plus size={11} /> {t("inspector.addBody")}
          </Button>
        </div>
      )}
    </Section>
  );
}
