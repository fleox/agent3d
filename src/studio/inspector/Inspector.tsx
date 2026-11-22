import { findObject } from "../../ops/tree";
import { useSnapshot } from "../state/context";
import { ObjectInspector } from "./ObjectInspector";
import { SceneSettings } from "./SceneSettings";

export function Inspector() {
  const snap = useSnapshot();
  const loc = snap.selection && snap.scene ? findObject(snap.scene.objects, snap.selection) : null;
  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-ink-1">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{loc ? <ObjectInspector key={loc.object.id} object={loc.object} /> : <SceneSettings />}</div>
    </aside>
  );
}
