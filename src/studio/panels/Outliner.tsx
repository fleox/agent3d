// Object tree: select, drag to reorder / reparent, visibility, add group,
// duplicate, delete. Rows changed by an external agent flash mint.

import clsx from "clsx";
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, FolderPlus, Globe2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ObjectDef } from "../../core/types";
import { objectDetail } from "../../ops/tree";
import { KindIcon, LIGHT_ICONS } from "../components/icons";
import { IconButton } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { duplicateObject, moveOps, newObject } from "../lib/patches";
import { useEditor, useSnapshot, useUi } from "../state/context";

type DropWhere = "before" | "after" | "inside";

export function Outliner() {
  const { t } = useI18n();
  const { store, edit } = useEditor();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const flash = useUi((s) => s.flash);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: DropWhere } | null>(null);
  const sel = snap.selection;
  const issuesById = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of snap.issues) {
      const id = /objects#([\w-]+)/.exec(i.path)?.[1];
      if (id && i.severity !== "info" && m.get(id) !== "error") m.set(id, i.severity as "error" | "warning");
    }
    return m;
  }, [snap.issues]);

  const rows: { o: ObjectDef; depth: number }[] = [];
  const walk = (list: ObjectDef[], depth: number) => {
    for (const o of list) {
      rows.push({ o, depth });
      if (o.children?.length && !collapsed.has(o.id)) walk(o.children, depth + 1);
    }
  };
  walk(scene.objects ?? [], 0);

  const addGroup = () => {
    const g = newObject(scene, { kind: "group" });
    edit([{ op: "addObject", object: g }], { select: g.id });
  };
  const duplicate = () => {
    if (!sel) return;
    const d = duplicateObject(scene, sel);
    if (d) edit(d.ops, { select: d.newId });
  };

  return (
    <div className="flex min-h-[140px] flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line pl-3 pr-1.5">
        <span className="text-xs font-semibold">{t("outliner.title")}</span>
        <div className="flex">
          <IconButton label={t("outliner.addGroup")} onClick={addGroup}>
            <FolderPlus size={14} />
          </IconButton>
          <IconButton label={t("outliner.duplicate")} shortcut="⌘D" disabled={!sel} onClick={duplicate}>
            <Copy size={13} />
          </IconButton>
          <IconButton label={t("outliner.delete")} shortcut="Del" disabled={!sel} onClick={() => sel && edit([{ op: "removeObject", id: sel }])}>
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label={t("outliner.title")}>
        <button
          type="button"
          onClick={() => store.select(null)}
          className={clsx("flex h-7 w-full items-center gap-2 px-3 text-left text-sm", sel === null ? "bg-accent/15 text-fg" : "text-fg-muted hover:bg-ink-2")}
        >
          <Globe2 size={13} className="text-fg-faint" />
          <span className="flex-1 truncate">{t("outliner.scene")}</span>
          <span className="flex gap-0.5 text-fg-faint">
            {(scene.lights ?? []).slice(0, 4).map((l, i) => {
              const I = LIGHT_ICONS[l.type] ?? LIGHT_ICONS.point;
              return <I key={i} size={11} aria-label={l.type} />;
            })}
          </span>
        </button>
        {rows.map(({ o, depth }) => {
          const hasKids = !!o.children?.length;
          const isSel = o.id === sel;
          const hidden = o.visible === false;
          const issue = issuesById.get(o.id);
          const dropHere = drop?.id === o.id ? drop.where : null;
          return (
            <div
              key={`${o.id}-${flash?.ids.includes(o.id) ? flash.at : 0}`}
              role="treeitem"
              aria-selected={isSel}
              aria-expanded={hasKids ? !collapsed.has(o.id) : undefined}
              draggable
              onDragStart={(e) => {
                setDrag(o.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", o.id);
              }}
              onDragEnd={() => {
                setDrag(null);
                setDrop(null);
              }}
              onDragOver={(e) => {
                if (!drag || drag === o.id) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const y = (e.clientY - r.top) / r.height;
                setDrop({ id: o.id, where: y < 0.28 ? "before" : y > 0.72 ? "after" : "inside" });
              }}
              onDragLeave={() => setDrop((d) => (d?.id === o.id ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && drop) {
                  const ops = moveOps(scene, drag, drop.id, drop.where);
                  if (ops.length) edit(ops);
                  if (drop.where === "inside") setCollapsed((c) => new Set([...c].filter((x) => x !== drop.id)));
                }
                setDrag(null);
                setDrop(null);
              }}
              onClick={() => store.select(o.id)}
              className={clsx(
                "group relative flex h-7 cursor-default items-center gap-1.5 pr-1 text-sm",
                flash?.ids.includes(o.id) && "row-flash",
                isSel ? "bg-accent/15 text-fg" : "text-fg-muted hover:bg-ink-2 hover:text-fg",
                drag === o.id && "opacity-40",
                dropHere === "inside" && "ring-1 ring-inset ring-accent",
              )}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {dropHere === "before" && <div className="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded bg-accent" />}
              {dropHere === "after" && <div className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded bg-accent" />}
              <button
                type="button"
                tabIndex={-1}
                aria-label={collapsed.has(o.id) ? t("outliner.expand") : t("outliner.collapse")}
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed((c) => {
                    const n = new Set(c);
                    if (n.has(o.id)) n.delete(o.id);
                    else n.add(o.id);
                    return n;
                  });
                }}
                className={clsx("flex h-4 w-4 items-center justify-center text-fg-faint", !hasKids && "invisible")}
              >
                {collapsed.has(o.id) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              </button>
              <KindIcon kind={o.kind} className={isSel ? "text-accent" : "text-fg-faint"} />
              <span className={clsx("truncate", hidden && "opacity-50")}>{o.name || o.id}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-fg-faint">{o.kind === "group" ? "" : objectDetail(o).replace(/^"|"$/g, "")}</span>
              {issue && <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", issue === "error" ? "bg-danger" : "bg-warn")} title={issue} />}
              <button
                type="button"
                aria-label={hidden ? t("outliner.show") : t("outliner.hide")}
                title={`${hidden ? t("outliner.show") : t("outliner.hide")} (H)`}
                onClick={(e) => {
                  e.stopPropagation();
                  edit(hidden ? [{ op: "remove", path: `objects#${o.id}.visible` }] : [{ op: "set", path: `objects#${o.id}.visible`, value: false }]);
                }}
                className={clsx("flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-faint hover:text-fg", hidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
              >
                {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
          );
        })}
        {!rows.length && <div className="px-3 py-4 text-xs text-fg-faint">{t("outliner.empty")}</div>}
      </div>
    </div>
  );
}
