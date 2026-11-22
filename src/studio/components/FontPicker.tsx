// Font picker: the 13 bundled fonts, each previewed with its own glyphs
// (typeface JSON → SVG path, loaded lazily from the library).

import clsx from "clsx";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { FONTS } from "../../core/catalog";
import { textPath, type Typeface } from "../lib/typeface";
import { libraryUrl, useLibraryBase } from "../state/useLibraryBase";
import { PickerButton, Popover } from "./ui/Popover";

const cache = new Map<string, Promise<Typeface | null>>();
function loadFont(base: string, id: string): Promise<Typeface | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(libraryUrl(base, `fonts/${id}.typeface.json`))
      .then((r) => (r.ok ? (r.json() as Promise<Typeface>) : null))
      .catch(() => null);
    cache.set(id, p);
  }
  return p;
}

const LABELS: Record<string, string> = {
  "sans-bold": "Inter Bold",
  sans: "Inter",
  "inter-black": "Inter Black",
  "montserrat-extrabold": "Montserrat",
  "space-grotesk-bold": "Space Grotesk",
  "bebas-neue": "BEBAS NEUE",
  anton: "ANTON",
  "serif-bold": "Playfair Bold",
  serif: "Playfair",
  mono: "JetBrains Mono",
  display: "Fredoka",
  pacifico: "Pacifico",
  lobster: "Lobster",
};
export const fontLabel = (id: string) => LABELS[id] ?? id;

export function FontPreview({ id, height = 18, className }: { id: string; height?: number; className?: string }) {
  const base = useLibraryBase();
  const [font, setFont] = useState<Typeface | null>(null);
  useEffect(() => {
    let live = true;
    if (base) void loadFont(base, id).then((f) => live && setFont(f));
    return () => {
      live = false;
    };
  }, [base, id]);
  const label = fontLabel(id);
  if (!font) return <span className={clsx("truncate text-sm text-fg-muted", className)}>{label}</span>;
  const p = textPath(font, label);
  const h = p.ascent + p.descent;
  return (
    <svg viewBox={`0 ${-p.ascent} ${Math.max(1, p.width)} ${h}`} height={height} className={clsx("block max-w-full fill-current", className)} preserveAspectRatio="xMinYMid meet" aria-label={label} role="img">
      <path d={p.d} />
    </svg>
  );
}

export function FontPicker({ value, onChange }: { value: string; onChange(id: string): void }) {
  return (
    <Popover
      width={268}
      trigger={(open, isOpen) => (
        <PickerButton onClick={open} open={isOpen} ariaLabel="font">
          <FontPreview id={value} height={15} className="text-fg" />
        </PickerButton>
      )}
    >
      {(close) => (
        <div className="py-1" role="listbox">
          {FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={f.id === value}
              title={f.description}
              onClick={() => {
                onChange(f.id);
                close();
              }}
              className={clsx("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-ink-3", f.id === value && "bg-accent/10")}
            >
              <div className="min-w-0 flex-1">
                <FontPreview id={f.id} height={20} className={f.id === value ? "text-accent" : "text-fg"} />
                <div className="mt-0.5 truncate text-2xs text-fg-faint">{f.description.split(" — ")[1] ?? f.description}</div>
              </div>
              {f.id === value && <Check size={12} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
