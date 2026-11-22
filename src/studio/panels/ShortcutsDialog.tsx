import { Dialog } from "../components/ui/Dialog";
import { Kbd } from "../components/ui/controls";
import { useI18n, type MessageKey } from "../i18n";
import { useEditor } from "../state/context";

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const M = mac ? "⌘" : "Ctrl";
const VIEWPORT: [string[], MessageKey][] = [
  [["Q"], "keys.selectTool"],
  [["W"], "keys.move"],
  [["E"], "keys.rotate"],
  [["R"], "keys.scale"],
  [["X"], "keys.space"],
  [["Shift", "drag"], "keys.snapHold"],
  [["F"], "keys.frame"],
  [["C"], "keys.cameraView"],
  [["G"], "keys.grid"],
  [["drag", "right-drag"], "keys.orbit"],
  [["wheel"], "keys.zoom"],
];

const ROWS: [string[], MessageKey][] = [
  [[M, "Z"], "keys.undo"],
  [[M, "⇧", "Z"], "keys.redo"],
  [[M, "S"], "keys.save"],
  [[M, "D"], "keys.duplicate"],
  [["Del"], "keys.delete"],
  [["H"], "keys.hide"],
  [["Esc"], "keys.deselect"],
  [["Space"], "keys.play"],
  [["T"], "keys.timeline"],
  [["J"], "keys.json"],
  [["I"], "keys.interact"],
  [["A"], "keys.assistant"],
  [["Shift", "drag"], "keys.dragFast"],
  [["Alt", "drag"], "keys.dragFine"],
];

export function ShortcutsDialog() {
  const { t } = useI18n();
  const { ui } = useEditor();
  return (
    <Dialog title={t("keys.title")} width={680} onClose={() => ui.set({ dialog: null })}>
      <div className="grid grid-cols-1 gap-x-6 px-4 py-2 sm:grid-cols-2">
        <div>
          <div className="pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-faint">{t("keys.general")}</div>
          <Rows rows={ROWS} />
        </div>
        <div>
          <div className="pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-faint">{t("viewport.tools")}</div>
          <Rows rows={VIEWPORT} />
        </div>
      </div>
    </Dialog>
  );
}

function Rows({ rows }: { rows: [string[], MessageKey][] }) {
  const { t } = useI18n();
  return (
    <div className="divide-y divide-line">
      {rows.map(([keys, label]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="text-fg-muted">{t(label)}</span>
          <span className="flex shrink-0 gap-1">
            {keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
