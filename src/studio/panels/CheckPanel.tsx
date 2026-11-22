// `check` tool report: budget meters, issues (click → select the object), licences.

import clsx from "clsx";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, Empty } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { useEditor, useUi } from "../state/context";
import { IssueList } from "./IssueList";

function Meter({ label, value, max, unit }: { label: string; value: number; max?: number; unit: string }) {
  const pct = max ? Math.min(1, value / max) : 0;
  const over = max !== undefined && value > max;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-2xs text-fg-muted">
        <span>{label}</span>
        <span className={clsx("tabular-nums", over ? "text-danger" : "text-fg")}>
          {value.toLocaleString()} {unit}
          {max ? <span className="text-fg-faint"> / {max.toLocaleString()}</span> : null}
        </span>
      </div>
      {max ? (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-3">
          <div className={clsx("h-full rounded-full", over ? "bg-danger" : pct > 0.8 ? "bg-warn" : "bg-agent")} style={{ width: `${pct * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function CheckPanel() {
  const { t } = useI18n();
  const { runCheck } = useEditor();
  const check = useUi((s) => s.check);
  const running = useUi((s) => s.checkRunning);
  if (!check)
    return (
      <Empty icon={<ShieldCheck size={22} />} title={t("check.emptyTitle")}>
        <p className="mb-3 max-w-sm">{t("check.emptyBody")}</p>
        <Button variant="primary" size="xs" onClick={() => void runCheck()} disabled={running}>
          {running ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} {t("check.run")}
        </Button>
      </Empty>
    );
  const b = check.budget;
  return (
    <div className="flex h-full min-h-0">
      <div className="w-[300px] shrink-0 space-y-3 overflow-auto border-r border-line p-3">
        <div className="flex items-center gap-2">
          <div className={clsx("rounded-md px-2 py-0.5 text-xs font-semibold", check.ok ? "bg-agent/15 text-agent" : "bg-danger/15 text-danger")}>{check.ok ? t("check.ready") : t("check.notReady")}</div>
          <span className="text-2xs text-fg-faint">{new Date(check.at).toLocaleTimeString()}</span>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void runCheck()} disabled={running}>
            {running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} {t("check.rerun")}
          </Button>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="text-danger">{t("check.errors", { n: check.counts?.errors ?? 0 })}</span>
          <span className="text-warn">{t("check.warnings", { n: check.counts?.warnings ?? 0 })}</span>
          <span className="text-fg-muted">{t("check.infos", { n: check.counts?.infos ?? 0 })}</span>
        </div>
        {b && (
          <div className="space-y-2.5">
            <Meter label={t("check.triangles")} value={b.estimatedTriangles ?? 0} unit="" />
            <Meter label={t("check.weight")} value={Math.round(b.totalKb ?? 0)} max={b.budgetKb} unit="KB" />
            {b.runtimeKb ? <Meter label={t("check.runtime")} value={Math.round(b.runtimeKb)} unit="KB" /> : null}
          </div>
        )}
        {b?.heaviestObjects?.length ? (
          <div>
            <div className="mb-1 text-2xs text-fg-muted">{t("check.heaviest")}</div>
            {b.heaviestObjects.slice(0, 5).map((o) => (
              <div key={o.id} className="flex justify-between text-2xs">
                <span className="font-mono text-fg">{o.id}</span>
                <span className="tabular-nums text-fg-faint">{o.triangles.toLocaleString()}</span>
              </div>
            ))}
          </div>
        ) : null}
        {check.licences?.length ? (
          <div>
            <div className="mb-1 text-2xs text-fg-muted">{t("check.licences")}</div>
            {check.licences.map((l) => (
              <div key={l.path} className="text-2xs text-fg-faint">
                {l.attribution}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{check.issues.length ? <IssueList issues={check.issues} /> : <div className="p-4 text-xs text-agent">{t("check.clean")}</div>}</div>
    </div>
  );
}
