import { AddPanel } from "./AddPanel";
import { Outliner } from "./Outliner";

export function LeftPanel() {
  return (
    <aside className="flex w-[268px] shrink-0 flex-col border-r border-line bg-ink-1">
      <Outliner />
      <AddPanel />
    </aside>
  );
}
