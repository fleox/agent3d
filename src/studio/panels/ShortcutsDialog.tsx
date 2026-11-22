import { Dialog } from "../components/ui/Dialog";
import { Kbd } from "../components/ui/controls";
import { useI18n, type MessageKey } from "../i18n";
import { useEditor } from "../state/context";

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const M = mac ? "⌘" : "Ctrl";
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
    <Dialog title={t("keys.title")} width={420} onClose={() => ui.set({ dialog: null })}>
      <div className="divide-y divide-line px-4 py-2">
        {ROWS.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-fg-muted">{t(label)}</span>
            <span className="flex gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
