import clsx from "clsx";
import { Braces, ChevronDown, ChevronUp, ListChecks, MousePointerClick, ShieldCheck } from "lucide-react";
import { useRef } from "react";
import { IconButton } from "../components/ui/controls";
import { useI18n, type MessageKey } from "../i18n";
import { useEditor, useSnapshot, useUi, type BottomTab } from "../state/context";
import { Timeline } from "../timeline/Timeline";
import { CheckPanel } from "./CheckPanel";
import { InteractionsPanel } from "./InteractionsPanel";
import { JsonPanel } from "./JsonPanel";

const TABS: { id: BottomTab; label: MessageKey; icon: typeof Braces; key: string }[] = [
  { id: "timeline", label: "bottom.timeline", icon: ListChecks, key: "T" },
  { id: "interactions", label: "bottom.interactions", icon: MousePointerClick, key: "" },
  { id: "json", label: "bottom.json", icon: Braces, key: "J" },
  { id: "check", label: "bottom.check", icon: ShieldCheck, key: "" },
];

export function BottomPanel() {
  const { t } = useI18n();
  const { ui } = useEditor();
  const snap = useSnapshot();
  const bottom = useUi((s) => s.bottom);
  const height = useUi((s) => s.bottomHeight);
  const check = useUi((s) => s.check);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const tracks = snap.scene?.timeline?.tracks.length ?? 0;
  const errors = snap.issues.filter((i) => i.severity === "error").length;

  return (
    <div className="flex shrink-0 flex-col border-t border-line bg-ink-1" style={{ height: bottom ? height : 34 }}>
      {bottom && (
        <div
          className="h-1 shrink-0 cursor-ns-resize hover:bg-accent/40"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, h: height };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            ui.set({ bottomHeight: Math.max(140, Math.min(window.innerHeight * 0.7, drag.current.h - (e.clientY - drag.current.y))) });
          }}
          onPointerUp={() => (drag.current = null)}
        />
      )}
      <div className="flex h-[33px] shrink-0 items-center gap-0.5 border-b border-line px-1.5" role="tablist">
        {TABS.map((tb) => {
          const I = tb.icon;
          const badge = tb.id === "timeline" ? tracks : tb.id === "interactions" ? (snap.scene?.interactions?.length ?? 0) : tb.id === "json" ? errors : check ? (check.counts?.errors ?? 0) + (check.counts?.warnings ?? 0) : 0;
          return (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={bottom === tb.id}
              title={tb.key ? `${t(tb.label)} (${tb.key})` : t(tb.label)}
              onClick={() => ui.set({ bottom: bottom === tb.id ? null : tb.id })}
              className={clsx("flex h-6 items-center gap-1.5 rounded-md px-2 text-xs", bottom === tb.id ? "bg-ink-3 text-fg" : "text-fg-muted hover:text-fg")}
            >
              <I size={12} />
              {t(tb.label)}
              {badge > 0 && <span className={clsx("rounded px-1 text-2xs", tb.id === "json" ? "bg-danger/20 text-danger" : tb.id === "check" ? "bg-warn/20 text-warn" : "bg-ink-4 text-fg-muted")}>{badge}</span>}
            </button>
          );
        })}
        <div className="ml-auto">
          <IconButton label={bottom ? t("bottom.collapse") : t("bottom.expand")} onClick={() => ui.set({ bottom: bottom ? null : "timeline" })} className="h-6 w-6">
            {bottom ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </IconButton>
        </div>
      </div>
      {bottom && (
        <div className="min-h-0 flex-1">
          {bottom === "timeline" && <Timeline />}
          {bottom === "interactions" && <InteractionsPanel />}
          {bottom === "json" && <JsonPanel />}
          {bottom === "check" && <CheckPanel />}
        </div>
      )}
    </div>
  );
}
