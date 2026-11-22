// HDRI picker: the library's HDRIs as thumbnails (their .jpg previews), or a project path.

import clsx from "clsx";
import { Check, Mountain } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "../i18n";
import { useEditor } from "../state/context";
import { libraryUrl, useLibraryBase } from "../state/useLibraryBase";
import { TextField } from "./ui/controls";
import { PickerButton, Popover } from "./ui/Popover";

export function useHdris() {
  const { library } = useEditor();
  return useMemo(() => {
    const ids = new Set(library.assets.map((a) => a.id));
    return library.assets
      .filter((a) => a.kind === "hdri" && /\.(hdr|exr)$/i.test(a.id))
      .map((a) => {
        const jpg = a.id.replace(/\.(hdr|exr)$/i, ".jpg");
        return { id: a.id, ref: `library:${a.id}`, name: a.id.replace(/^hdri\//, "").replace(/\.\w+$/, ""), preview: ids.has(jpg) ? jpg : null, description: a.description, tags: a.tags ?? [] };
      });
  }, [library]);
}

export function HdriPicker({ value, onChange }: { value: string; onChange(v: string): void }) {
  const { t } = useI18n();
  const base = useLibraryBase();
  const hdris = useHdris();
  const current = hdris.find((h) => h.ref === value || h.ref.replace(/\.hdr$/, "") === value);
  return (
    <Popover
      width={320}
      trigger={(open, isOpen) => (
        <PickerButton onClick={open} open={isOpen} ariaLabel="HDRI">
          {current?.preview && base ? <img src={libraryUrl(base, current.preview)} alt="" className="h-4 w-7 shrink-0 rounded-sm object-cover" /> : <Mountain size={12} className="text-fg-faint" />}
          <span className="truncate">{current?.name ?? value.split("/").pop()}</span>
        </PickerButton>
      )}
    >
      {(close) => (
        <div className="space-y-2 p-2">
          <div className="grid grid-cols-3 gap-1.5">
            {hdris.map((h) => (
              <button
                key={h.id}
                type="button"
                title={h.description}
                aria-pressed={current?.id === h.id}
                onClick={() => {
                  onChange(h.ref);
                  close();
                }}
                className={clsx("group relative overflow-hidden rounded-md text-left ring-1", current?.id === h.id ? "ring-accent" : "ring-line hover:ring-fg-faint")}
              >
                {h.preview && base ? <img src={libraryUrl(base, h.preview)} alt="" loading="lazy" className="block aspect-[2/1] w-full object-cover" /> : <div className="aspect-[2/1] w-full bg-ink-3" />}
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-0.5 pt-2 text-[10px] text-white">{h.name}</span>
                {current?.id === h.id && <Check size={11} className="absolute right-1 top-1 text-white drop-shadow" />}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1 text-2xs text-fg-faint">{t("env.hdriPath")}</div>
            <TextField value={value} onCommit={(v) => v.trim() && onChange(v.trim())} mono ariaLabel={t("env.hdriPath")} />
          </div>
        </div>
      )}
    </Popover>
  );
}
