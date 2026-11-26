// Image picker for asset paths (3D photo image / depth map): the project's
// images (assets_list), the built-in library images, or a typed path.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { imageOptions, type ImageOption } from "../lib/photo";
import { useEditor } from "../state/context";
import { libraryUrl, useLibraryBase } from "../state/useLibraryBase";
import { Row, TextField } from "./ui/controls";

const TYPED = "__path__";

// Project images from the assets_list tool; `reload` re-reads them (after a tool wrote one).
export function useProjectImages(enabled = true): { assets: { path: string; missing?: boolean }[] | undefined; reload(): void } {
  const { backend } = useEditor();
  const [assets, setAssets] = useState<{ path: string; missing?: boolean }[] | undefined>(undefined);
  const reload = useCallback(() => {
    void backend
      .call<{ assets?: { path: string; missing?: boolean }[] }>("assets_list", {})
      .then((r) => setAssets(r.assets ?? []))
      .catch(() => setAssets([]));
  }, [backend]);
  useEffect(() => {
    if (enabled) reload();
  }, [reload, enabled]);
  return { assets, reload };
}

export function ImageAssetField({ label, hint, value, onChange, projectAssets, onOpen, library: withLibrary = true, ariaLabel }: { label: string; hint?: string; value: string | undefined; onChange(v: string | undefined): void; projectAssets: { path: string; missing?: boolean }[] | undefined; onOpen?(): void; library?: boolean; ariaLabel: string }) {
  const { t } = useI18n();
  const { library, backend } = useEditor();
  const base = useLibraryBase();
  const [typing, setTyping] = useState(false);
  const options = useMemo(() => imageOptions(projectAssets, library, value, { library: withLibrary }), [projectAssets, library, value, withLibrary]);
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setThumb(null);
    if (!value) return;
    if (value.startsWith("library:")) setThumb(base ? libraryUrl(base, value) : null);
    else void backend.fileUrl(value).then((u) => live && setThumb(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [value, base, backend]);
  const group = (g: ImageOption["group"]) => options.filter((o) => o.group === g);
  return (
    <Row label={label} hint={hint} overridden={value !== undefined} onReset={() => onChange(undefined)}>
      {thumb && <img src={thumb} alt="" className="h-6 w-6 shrink-0 rounded object-cover" onError={() => setThumb(null)} />}
      {typing ? (
        <TextField
          value={value ?? ""}
          placeholder={t("photo.pathPlaceholder")}
          mono
          onCommit={(v) => {
            setTyping(false);
            onChange(v.trim() || undefined);
          }}
          ariaLabel={ariaLabel}
        />
      ) : (
        <select
          aria-label={ariaLabel}
          value={value ?? ""}
          onFocus={onOpen}
          onChange={(e) => {
            if (e.target.value === TYPED) setTyping(true);
            else onChange(e.target.value || undefined);
          }}
          className="field min-w-0 flex-1"
        >
          <option value="">{t("photo.none")}</option>
          {group("current").map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {group("project").length > 0 && (
            <optgroup label={t("photo.projectImages")}>
              {group("project").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {group("library").length > 0 && (
            <optgroup label={t("photo.libraryImages")}>
              {group("library").map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          <option value={TYPED}>{t("photo.typePath")}</option>
        </select>
      )}
    </Row>
  );
}
