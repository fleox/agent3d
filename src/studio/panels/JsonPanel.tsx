// scene.json editor: live validation (validateScene), Apply = scene_apply.

import clsx from "clsx";
import { Check, RotateCcw, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Issue, SceneDoc } from "../../core/types";
import { validateScene } from "../../core/validate";
import { Button } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { useEditor, useSnapshot } from "../state/context";
import { IssueList } from "./IssueList";

export function JsonPanel() {
  const { t } = useI18n();
  const { store } = useEditor();
  const snap = useSnapshot();
  const sceneText = useMemo(() => JSON.stringify(snap.scene, null, 2), [snap.scene]);
  const [draft, setDraft] = useState(sceneText);
  const [dirty, setDirty] = useState(false);
  const [parsed, setParsed] = useState<{ scene?: SceneDoc; error?: string; issues: Issue[] }>({ issues: snap.issues, scene: snap.scene! });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirty) {
      setDraft(sceneText);
      setParsed({ issues: snap.issues, scene: snap.scene! });
    }
  }, [sceneText, dirty, snap.issues, snap.scene]);

  const onChange = (v: string) => {
    setDraft(v);
    setDirty(v !== sceneText);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const s = JSON.parse(v) as SceneDoc;
        setParsed({ scene: s, issues: validateScene(s) });
      } catch (e) {
        setParsed({ error: (e as Error).message, issues: [] });
      }
    }, 250);
  };

  const errors = parsed.issues.filter((i) => i.severity === "error").length;
  const lines = draft.split("\n").length;

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1">
        <div aria-hidden className="w-10 shrink-0 select-none overflow-hidden border-r border-line bg-ink-0/40 pt-2 text-right font-mono text-2xs leading-[18px] text-fg-faint">
          {Array.from({ length: Math.min(lines, 5000) }, (_, i) => (
            <div key={i} className="pr-2">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          value={draft}
          spellCheck={false}
          aria-label="scene.json"
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            const gutter = e.currentTarget.previousElementSibling as HTMLElement;
            gutter.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = el;
              const v = draft.slice(0, a) + "  " + draft.slice(b);
              onChange(v);
              requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
            }
          }}
          className="min-w-0 flex-1 resize-none bg-transparent p-2 font-mono text-xs leading-[18px] text-fg outline-none"
        />
      </div>
      <div className="flex w-[340px] shrink-0 flex-col border-l border-line">
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-2">
          <span className={clsx("text-xs", parsed.error || errors ? "text-danger" : "text-agent")}>
            {parsed.error ? t("json.invalidJson") : errors ? t("json.errors", { n: errors }) : t("json.valid")}
          </span>
          <div className="ml-auto flex gap-1">
            <Button size="xs" variant="ghost" disabled={!!parsed.error} title={t("json.format")} onClick={() => parsed.scene && onChange(JSON.stringify(parsed.scene, null, 2))}>
              <WandSparkles size={11} />
            </Button>
            <Button size="xs" variant="ghost" disabled={!dirty} onClick={() => (setDirty(false), setDraft(sceneText))}>
              <RotateCcw size={11} /> {t("json.revert")}
            </Button>
            <Button
              size="xs"
              variant="primary"
              disabled={!dirty || !!parsed.error || errors > 0}
              title={errors ? t("json.fixFirst") : undefined}
              onClick={() => {
                if (!parsed.scene) return;
                store.replace(parsed.scene);
                setDirty(false);
              }}
            >
              <Check size={11} /> {t("json.apply")}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {parsed.error ? <div className="p-3 font-mono text-xs text-danger">{parsed.error}</div> : parsed.issues.length ? <IssueList issues={parsed.issues} dense /> : <div className="p-3 text-xs text-fg-faint">{t("json.noIssues")}</div>}
        </div>
        {dirty && <div className="border-t border-line px-3 py-1.5 text-2xs text-key">{t("json.unapplied")}</div>}
      </div>
    </div>
  );
}
