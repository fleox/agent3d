// Scene inspector: physics world (gravity, step, solver, layers, surface
// materials, contacts) and the joints list (hinge / point / distance / lock / spring).

import { Plus, Trash2, X } from "lucide-react";
import type { JointDef, PhysicsMaterialDef, SceneDoc } from "../../core/types";
import { NumberField } from "../components/ui/NumberField";
import { Button, IconButton, Row, Section, Select, TextField } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { fieldLabel, pretty } from "../lib/labels";
import { walkObjects } from "../../ops/tree";
import { useEditor } from "../state/context";
import { JsonField, ParamForm, useBinder } from "./fields";
import { JOINT_SPECS, PHYSICS_SPECS } from "./specs";

const rec = (v: unknown) => v as Record<string, unknown> | undefined;
const ONLY: Record<string, string[]> = { axis: ["hinge"], distance: ["distance"], restLength: ["spring"], stiffness: ["spring"], damping: ["spring"] };

export function PhysicsSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const bind = useBinder();
  const { edit } = useEditor();
  const ph = scene.physics;
  const bodies: string[] = [];
  walkObjects(scene.objects, (o) => void (o.body && bodies.push(o.id)));
  const joints = ph?.joints ?? [];
  const materials = ph?.materials ?? {};
  return (
    <Section title={t("scene.physics")} id="physics" defaultOpen={!!ph}>
      {ph ? (
        <>
          <ParamForm specs={PHYSICS_SPECS} base="physics" values={rec(ph)} />
          <Row label={t("physics.layers")} hint={t("physics.layersHint")} overridden={ph.layers !== undefined} onReset={() => bind("physics.layers", undefined)}>
            <TextField value={(ph.layers ?? []).join(", ")} placeholder="default, player, enemies" onCommit={(v) => bind("physics.layers", v.trim() ? v.split(/[\s,]+/).filter(Boolean) : undefined)} ariaLabel={t("physics.layers")} />
          </Row>

          <div className="mx-3 mb-0.5 mt-2 flex items-center text-2xs font-medium uppercase tracking-wide text-fg-faint">
            <span className="flex-1">{t("physics.materials")}</span>
            <IconButton
              label={t("physics.addMaterial")}
              className="h-5 w-5"
              onClick={() => {
                let n = 1;
                while (materials[`surface${n}`]) n++;
                bind(`physics.materials`, { ...materials, [`surface${n}`]: { friction: 0.5, restitution: 0 } });
              }}
            >
              <Plus size={11} />
            </IconButton>
          </div>
          {Object.entries(materials).map(([name, m]) => (
            <MaterialRow key={name} name={name} m={m} onRename={(to) => to && to !== name && !materials[to] && bind("physics.materials", Object.fromEntries(Object.entries(materials).map(([k, v]) => [k === name ? to : k, v])))} onRemove={() => {
              const next = { ...materials };
              delete next[name];
              bind("physics.materials", Object.keys(next).length ? next : undefined);
            }} />
          ))}
          {!Object.keys(materials).length && <div className="px-3 text-2xs text-fg-faint">{t("physics.noMaterials")}</div>}
          {(ph.contacts !== undefined || Object.keys(materials).length > 1) && (
            <Row label={t("physics.contacts")} hint={t("physics.contactsHint")} align="start">
              <JsonField value={ph.contacts ?? []} rows={2} onCommit={(v) => bind("physics.contacts", Array.isArray(v) && v.length ? v : undefined)} />
            </Row>
          )}

          <div className="mx-3 mb-0.5 mt-2 flex items-center text-2xs font-medium uppercase tracking-wide text-fg-faint">
            <span className="flex-1">
              {t("physics.joints")} {joints.length > 0 && <span className="font-normal">{joints.length}</span>}
            </span>
            <IconButton label={t("physics.addJoint")} className="h-5 w-5" disabled={!bodies.length} onClick={() => edit([{ op: "set", path: `physics.joints[${joints.length}]`, value: { type: "hinge", a: bodies[0], ...(bodies[1] ? { b: bodies[1] } : {}) } }])}>
              <Plus size={11} />
            </IconButton>
          </div>
          <div className="space-y-1 px-2">
            {joints.map((j, i) => (
              <JointCard key={i} joint={j} index={i} bodies={bodies} onRemove={() => edit(joints.length === 1 ? [{ op: "remove", path: "physics.joints" }] : [{ op: "remove", path: `physics.joints[${i}]` }])} />
            ))}
          </div>
          {!joints.length && <div className="px-3 text-2xs text-fg-faint">{bodies.length ? t("physics.noJoints") : t("physics.noBodies")}</div>}
          <div className="px-3 pt-2">
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
  );
}

function MaterialRow({ name, m, onRename, onRemove }: { name: string; m: PhysicsMaterialDef; onRename(to: string): void; onRemove(): void }) {
  const { t } = useI18n();
  const bind = useBinder();
  const path = `physics.materials.${name}`;
  return (
    <div className="flex items-center gap-1 px-3 py-[3px]">
      <TextField value={name} onCommit={(v) => onRename(v.trim())} className="w-[84px] flex-none font-mono text-xs" ariaLabel={t("physics.materialName")} />
      <NumberField label="μ" value={m.friction ?? 0.5} min={0} max={2} placeholder={m.friction === undefined} onChange={(n, f) => bind(`${path}.friction`, n, f)} ariaLabel={fieldLabel("friction")} />
      <NumberField label="e" value={m.restitution ?? 0} min={0} max={1} placeholder={m.restitution === undefined} onChange={(n, f) => bind(`${path}.restitution`, n, f)} ariaLabel={fieldLabel("restitution")} />
      <IconButton label={t("physics.removeMaterial")} className="h-5 w-5" onClick={onRemove}>
        <X size={11} />
      </IconButton>
    </div>
  );
}

function JointCard({ joint: j, index, bodies, onRemove }: { joint: JointDef; index: number; bodies: string[]; onRemove(): void }) {
  const { t } = useI18n();
  const bind = useBinder();
  const path = `physics.joints[${index}]`;
  const specs = JOINT_SPECS.filter((s) => s.name !== "type" && (!ONLY[s.name] || ONLY[s.name].includes(j.type)));
  return (
    <div className="rounded-md border border-line bg-ink-0/40 pb-1">
      <div className="flex h-7 items-center gap-1 pl-2 pr-1">
        <Select value={j.type} options={JOINT_SPECS[0].options!.map((o) => ({ value: o, label: pretty(o) }))} onChange={(v) => bind(`${path}.type`, v)} className="w-[92px] flex-none" ariaLabel={t("physics.jointType")} />
        <span className="flex-1 truncate font-mono text-2xs text-fg-faint">
          {j.a} ↔ {j.b ?? t("physics.world")}
        </span>
        <IconButton label={t("physics.removeJoint")} className="h-5 w-5" onClick={onRemove}>
          <X size={11} />
        </IconButton>
      </div>
      <Row label="A">
        <Select value={j.a} options={bodies} onChange={(v) => bind(`${path}.a`, v)} ariaLabel="a" />
      </Row>
      <Row label="B">
        <Select value={j.b ?? ""} placeholder={t("physics.world")} options={bodies.filter((b) => b !== j.a)} onChange={(v) => bind(`${path}.b`, v || undefined)} ariaLabel="b" />
      </Row>
      <ParamForm specs={specs} base={path} values={rec(j)} />
      {j.type === "hinge" && (
        <Row label={t("physics.motor")} hint={t("physics.motorHint")} overridden={j.motor !== undefined} onReset={() => bind(`${path}.motor`, undefined)}>
          <NumberField label="°/s" value={j.motor?.speed ?? 0} placeholder={!j.motor} onChange={(n, f) => bind(`${path}.motor`, n ? { ...(j.motor ?? {}), speed: n } : undefined, f)} ariaLabel={t("physics.motor")} />
          <NumberField label="F" value={j.motor?.maxForce ?? 1e6} min={0} placeholder={j.motor?.maxForce === undefined} onChange={(n, f) => j.motor && bind(`${path}.motor.maxForce`, n, f)} ariaLabel={fieldLabel("maxForce")} />
        </Row>
      )}
    </div>
  );
}
