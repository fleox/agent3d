import clsx from "clsx";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { Issue } from "../../core/types";
import { findObject } from "../../ops/tree";
import { useEditor } from "../state/context";

export function issueObjectId(path: string): string | null {
  return /objects#([A-Za-z][\w-]*)/.exec(path)?.[1] ?? null;
}

export function IssueList({ issues, dense }: { issues: Issue[]; dense?: boolean }) {
  const { store } = useEditor();
  return (
    <ul className="divide-y divide-line/70">
      {issues.map((i, n) => {
        const id = issueObjectId(i.path);
        const exists = id && store.getSnapshot().scene && findObject(store.getSnapshot().scene!.objects, id);
        const Icon = i.severity === "error" ? CircleAlert : i.severity === "warning" ? TriangleAlert : Info;
        return (
          <li key={n}>
            <button
              type="button"
              disabled={!exists}
              onClick={() => exists && store.select(id)}
              className={clsx("flex w-full items-start gap-2 px-3 text-left enabled:hover:bg-ink-2", dense ? "py-1" : "py-1.5")}
            >
              <Icon size={13} className={clsx("mt-0.5 shrink-0", i.severity === "error" ? "text-danger" : i.severity === "warning" ? "text-warn" : "text-accent")} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-fg">{i.message}</div>
                {i.hint && <div className="text-2xs text-fg-muted">{i.hint}</div>}
                <div className="font-mono text-2xs text-fg-faint">
                  {i.code} · {i.path || "scene"}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
