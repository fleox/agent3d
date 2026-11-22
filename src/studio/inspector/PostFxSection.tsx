// Post-effect stack editor: a "Look" preset, then the effects in order —
// add, remove, reorder (drag the handle or the arrows), per-effect params
// from the catalog, GPU cost badges and the pipeline cost estimate.

import clsx from "clsx";
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { POSTFX, POSTFX_LOOKS, POSTFX_LOOK_IDS, catalogEntry } from "../../core/catalog";
import { gpuCost, postfxCost } from "../../core/postfx";
import type { PostFxDef, SceneDoc } from "../../core/types";
import { PickMenu } from "../components/ui/Menu";
import { SliderField } from "../components/ui/NumberField";
import { IconButton, Row, Section, Select } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { pretty } from "../lib/labels";
import { addEffect, lookOf, moveEffect, removeEffect, setLook } from "../lib/postfxStack";
import { useEditor } from "../state/context";
import { ParamForm, useBinder } from "./fields";

const COST_CLASS = { low: "bg-agent/15 text-agent", medium: "bg-warn/15 text-warn", high: "bg-danger/15 text-danger" } as const;

export function PostFxSection({ scene }: { scene: SceneDoc }) {
  const { t } = useI18n();
  const { edit } = useEditor();
  const bind = useBinder();
  const list = scene.postfx ?? [];
  const look = lookOf(list);
  const write = (next: PostFxDef[]) => edit(next.length ? [{ op: "set", path: "postfx", value: next }] : list.length ? [{ op: "remove", path: "postfx" }] : []);
  const cost = postfxCost(list);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const effects = list.map((fx, i) => ({ fx, i })).filter((x) => x.fx.type !== "look");
  return (
    <Section
      title={
        <span>
          {t("scene.postfx")} {effects.length > 0 && <span className="font-normal text-fg-faint">{effects.length}</span>}
        </span>
      }
      id="postfx"
      defaultOpen={list.length > 0}
      actions={
        <PickMenu
          placeholder={t("scene.searchEffects")}
          items={POSTFX.filter((p) => p.id !== "look").map((p) => ({ id: p.id, label: pretty(p.id), hint: p.description }))}
          onPick={(id) => write(addEffect(list, id))}
          trigger={(open) => (
            <IconButton label={t("scene.addEffect")} onClick={open} className="h-6 w-6">
              <Plus size={13} />
            </IconButton>
          )}
        />
      }
    >
      <Row label={t("postfx.look")} hint={t("postfx.lookHint")}>
        <Select value={look?.preset ?? ""} placeholder={t("scene.none")} options={POSTFX_LOOK_IDS.map((id) => ({ value: id, label: pretty(id) }))} onChange={(v) => write(setLook(list, v || null))} ariaLabel={t("postfx.look")} />
      </Row>
      {look && (
        <>
          <div className="px-3 pb-1 text-2xs leading-snug text-fg-faint">
            {POSTFX_LOOKS[look.preset as keyof typeof POSTFX_LOOKS]?.description}{" "}
            <span className="text-fg-muted">{POSTFX_LOOKS[look.preset as keyof typeof POSTFX_LOOKS]?.effects.map((e) => e.type).join(" · ")}</span>
          </div>
          <Row label={t("scene.intensity")} overridden={look.intensity !== undefined} onReset={() => bind(`postfx[${look.index}].intensity`, undefined)}>
            <SliderField value={look.intensity ?? 1} min={0} max={1} placeholder={look.intensity === undefined} onChange={(n, f) => bind(`postfx[${look.index}].intensity`, n === 1 ? undefined : n, f)} ariaLabel={t("scene.intensity")} />
          </Row>
        </>
      )}
      <div className="space-y-1 px-2 pt-1" onDragOver={(e) => e.preventDefault()}>
        {effects.map(({ fx, i }) => (
          <EffectCard
            key={`${fx.type}-${i}`}
            fx={fx}
            index={i}
            first={i === effects[0]?.i}
            last={i === effects[effects.length - 1]?.i}
            dropTarget={dropAt === i && dragFrom !== null && dragFrom !== i}
            onMove={(to) => write(moveEffect(list, i, to))}
            onRemove={() => write(removeEffect(list, i))}
            onDragStart={() => setDragFrom(i)}
            onDragEnter={() => setDropAt(i)}
            onDrop={() => {
              if (dragFrom !== null && dragFrom !== i) write(moveEffect(list, dragFrom, i));
              setDragFrom(null);
              setDropAt(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
          />
        ))}
        {!list.length && <div className="px-1 text-2xs text-fg-faint">{t("scene.noEffects")}</div>}
      </div>
      {list.length > 0 && (
        <div className="mx-3 mt-1.5 flex items-center gap-1.5 text-2xs text-fg-faint" title={t("postfx.costHint")}>
          <span className={clsx("rounded px-1 font-medium", cost.level === "heavy" ? COST_CLASS.high : cost.level === "moderate" ? COST_CLASS.medium : COST_CLASS.low)}>{t(`postfx.level.${cost.level}`)}</span>
          {t("postfx.passes", { n: cost.passes })}
          {cost.dropped.low.length > 0 && <span className="truncate">· {t("postfx.droppedLow", { list: cost.dropped.low.join(", ") })}</span>}
        </div>
      )}
    </Section>
  );
}

function EffectCard(props: { fx: PostFxDef; index: number; first: boolean; last: boolean; dropTarget: boolean; onMove(to: number): void; onRemove(): void; onDragStart(): void; onDragEnter(): void; onDrop(): void; onDragEnd(): void }) {
  const { t } = useI18n();
  const { fx, index } = props;
  const entry = catalogEntry("postfx", fx.type);
  const [open, setOpen] = useState(true);
  const handle = useRef(false);
  const gpu = gpuCost(fx.type);
  return (
    <div
      draggable
      onDragStart={(e) => {
        if (!handle.current) return e.preventDefault();
        e.dataTransfer.effectAllowed = "move";
        props.onDragStart();
      }}
      onDragEnter={props.onDragEnter}
      onDrop={props.onDrop}
      onDragEnd={() => {
        handle.current = false;
        props.onDragEnd();
      }}
      className={clsx("rounded-md border bg-ink-0/40 pb-0.5 transition-colors", props.dropTarget ? "border-accent" : "border-line")}
    >
      <div className="flex h-7 items-center gap-0.5 pl-0.5 pr-1">
        <span onPointerDown={() => (handle.current = true)} onPointerUp={() => (handle.current = false)} className="flex h-6 w-4 cursor-grab items-center justify-center text-fg-faint hover:text-fg" title={t("postfx.drag")}>
          <GripVertical size={12} />
        </span>
        <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium" title={entry?.description}>
          {open ? <ChevronDown size={11} className="text-fg-faint" /> : <ChevronRight size={11} className="text-fg-faint" />}
          <span className="truncate">{pretty(fx.type)}</span>
        </button>
        <span className={clsx("rounded px-1 text-[10px]", COST_CLASS[gpu])} title={t("postfx.gpuHint")}>
          {t(`postfx.gpu.${gpu}`)}
        </span>
        <IconButton label={t("postfx.up")} className="h-5 w-5" disabled={props.first} onClick={() => props.onMove(index - 1)}>
          <ChevronUp size={11} />
        </IconButton>
        <IconButton label={t("postfx.down")} className="h-5 w-5" disabled={props.last} onClick={() => props.onMove(index + 1)}>
          <ChevronDown size={11} />
        </IconButton>
        <IconButton label={t("scene.removeEffect")} className="h-5 w-5" onClick={props.onRemove}>
          <X size={11} />
        </IconButton>
      </div>
      {open && entry && entry.params.length > 0 && <ParamForm specs={entry.params} base={`postfx[${index}]`} values={fx as Record<string, unknown>} />}
      {open && entry && !entry.params.length && <div className="px-3 pb-1 text-2xs text-fg-faint">{entry.description}</div>}
      {!entry && <div className="px-3 pb-1 text-2xs text-danger">{t("postfx.unknown")}</div>}
    </div>
  );
}
