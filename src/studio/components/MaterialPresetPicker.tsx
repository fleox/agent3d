// Material preset picker: a visual grid. Every preset shows an instant CSS
// swatch, replaced by a real render (one sphere per preset, rendered once by
// the runtime off-screen and cached in the browser) when it is ready.

import clsx from "clsx";
import { Ban, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { MATERIAL_PRESETS, materialPreset } from "../../core/catalog";
import { useI18n } from "../i18n";
import { pretty } from "../lib/labels";
import { SHEET, presetSheetScene, presetSwatch } from "../lib/materialSwatch";
import { useEditor } from "../state/context";
import { renderStill } from "../state/playerController";
import { PickerButton, Popover } from "./ui/Popover";

const KEY = `agent3d.studio.presetSheet.v1.${MATERIAL_PRESETS.map((p) => p.id).join(",").length}`;
let sheetPromise: Promise<string | null> | null = null;

function useSheet(): string | null {
  const { backend } = useEditor();
  const [url, setUrl] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (url) return;
    let live = true;
    if (!sheetPromise)
      sheetPromise = (async () => {
        const { scene, width, height } = presetSheetScene();
        const cfg = await backend.mountConfig();
        const data = await renderStill(scene, { libraryBase: cfg.libraryBase }, 0, width, height);
        try {
          localStorage.setItem(KEY, data);
        } catch {
          /* storage full / blocked: keep it in memory */
        }
        return data;
      })().catch(() => null);
    void sheetPromise.then((d) => live && d && setUrl(d));
    return () => {
      live = false;
    };
  }, [backend, url]);
  return url;
}

export function PresetSwatch({ id, size = 36, sheet, className }: { id: string | undefined; size?: number; sheet?: string | null; className?: string }) {
  const p = id ? materialPreset(id) : undefined;
  const { cells, width, height } = sheetLayout;
  const cell = id ? cells[id] : undefined;
  const k = size / SHEET.cell;
  const style =
    sheet && cell
      ? { backgroundImage: `url(${sheet})`, backgroundSize: `${width * k}px ${height * k}px`, backgroundPosition: `${-cell.x * k}px ${-cell.y * k}px` }
      : { background: presetSwatch(p), borderRadius: 999, transform: "scale(0.8)" };
  return <span className={clsx("block shrink-0 overflow-hidden rounded-md", className)} style={{ width: size, height: size, ...style }} aria-hidden />;
}
const sheetLayout = presetSheetScene();

export function MaterialPresetPicker({ value, onChange }: { value: string | undefined; onChange(id: string | undefined): void }) {
  const { t } = useI18n();
  const sheet = useSheet();
  const current = value ? materialPreset(value) : undefined;
  return (
    <Popover
      width={348}
      trigger={(open, isOpen) => (
        <PickerButton onClick={open} open={isOpen} ariaLabel={t("inspector.preset")}>
          {current ? <PresetSwatch id={value} size={16} sheet={sheet} className="rounded" /> : <Ban size={12} className="text-fg-faint" />}
          <span className={clsx("truncate", !current && "text-fg-faint")}>{current ? pretty(current.id) : t("inspector.noPreset")}</span>
        </PickerButton>
      )}
    >
      {(close) => (
        <div className="p-2">
          <div className="grid grid-cols-5 gap-1">
            <Cell
              active={!value}
              label={t("inspector.noPreset")}
              onPick={() => {
                onChange(undefined);
                close();
              }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-dashed border-line text-fg-faint">
                <Ban size={14} />
              </span>
            </Cell>
            {MATERIAL_PRESETS.map((p) => (
              <Cell
                key={p.id}
                active={value === p.id}
                label={pretty(p.id)}
                hint={p.description}
                onPick={() => {
                  onChange(p.id);
                  close();
                }}
              >
                <PresetSwatch id={p.id} size={44} sheet={sheet} />
              </Cell>
            ))}
          </div>
          {!sheet && <div className="mt-2 text-center text-2xs text-fg-faint">{t("inspector.renderingPresets")}</div>}
        </div>
      )}
    </Popover>
  );
}

function Cell({ active, label, hint, onPick, children }: { active: boolean; label: string; hint?: string; onPick(): void; children: React.ReactNode }) {
  return (
    <button type="button" title={hint ? `${label} — ${hint}` : label} aria-pressed={active} onClick={onPick} className={clsx("relative flex flex-col items-center gap-1 rounded-md p-1 transition-colors", active ? "bg-accent/15 ring-1 ring-accent/70" : "hover:bg-ink-3")}>
      {children}
      <span className={clsx("w-full truncate text-center text-[10px] leading-tight", active ? "text-accent" : "text-fg-muted")}>{label}</span>
      {active && <Check size={10} className="absolute right-1 top-1 text-accent" />}
    </button>
  );
}
