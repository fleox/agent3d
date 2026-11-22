// Texture slot editor: none, a project file, a built-in library texture or a
// procedural texture ({ procedural: <catalog textures id>, …params }).

import clsx from "clsx";
import { useMemo } from "react";
import { TEXTURES, catalogEntry } from "../../core/catalog";
import type { TextureRef } from "../../core/types";
import { useI18n } from "../i18n";
import { pretty } from "../lib/labels";
import { useEditor } from "../state/context";
import { libraryUrl, useLibraryBase } from "../state/useLibraryBase";
import { ParamForm } from "../inspector/fields";
import { Row, Select, TextField } from "./ui/controls";

type Mode = "none" | "file" | "library" | "procedural";
export function textureMode(v: TextureRef | undefined): Mode {
  if (v === undefined) return "none";
  if (typeof v === "object") return "procedural";
  return v.startsWith("library:") ? "library" : "file";
}

export function TextureField({ slot, value, path, onChange }: { slot: string; value: TextureRef | undefined; path: string; onChange(v: TextureRef | undefined): void }) {
  const { t } = useI18n();
  const { library } = useEditor();
  const base = useLibraryBase();
  const mode = textureMode(value);
  const textures = useMemo(() => library.assets.filter((a) => a.kind === "texture"), [library]);
  const role = /normal/i.test(slot) ? "normal" : /rough|metal|ao|bump|displacement|alpha/i.test(slot) ? "roughness" : "color";
  const sorted = useMemo(() => [...textures].sort((a, b) => Number(!a.tags?.includes(role)) - Number(!b.tags?.includes(role)) || a.id.localeCompare(b.id)), [textures, role]);
  const proc = typeof value === "object" ? value : null;
  const entry = proc ? catalogEntry("textures", proc.procedural) : undefined;
  return (
    <div className={clsx("rounded-md", mode !== "none" && "bg-ink-0/40 pb-1")}>
      <Row label={pretty(slot)} overridden={value !== undefined} onReset={() => onChange(undefined)}>
        <Select
          value={mode}
          options={(["none", "file", "library", "procedural"] as const).map((m) => ({ value: m, label: t(`texture.${m}`) }))}
          onChange={(m) => onChange(m === "none" ? undefined : m === "file" ? "assets/textures/" : m === "library" ? `library:${sorted[0]?.id ?? "textures/concrete-color.jpg"}` : { procedural: role === "normal" ? "flakes" : "noise" })}
          className="w-[86px] flex-none"
          ariaLabel={slot}
        />
        {mode === "file" && <TextField value={String(value)} onCommit={(v) => onChange(v.trim() || undefined)} mono ariaLabel={`${slot} path`} />}
        {mode === "library" && (
          <>
            {base && <img src={libraryUrl(base, String(value))} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />}
            <Select value={String(value).replace(/^library:/, "")} options={sorted.map((a) => ({ value: a.id, label: a.id.replace(/^textures\//, "").replace(/\.\w+$/, "") }))} onChange={(id) => onChange(`library:${id}`)} ariaLabel={`${slot} library`} />
          </>
        )}
        {mode === "procedural" && proc && <Select value={proc.procedural} options={TEXTURES.map((x) => ({ value: x.id, label: pretty(x.id) }))} onChange={(id) => onChange({ procedural: id })} ariaLabel={`${slot} procedural`} />}
      </Row>
      {proc && entry && <ParamForm specs={entry.params} base={path} values={proc as Record<string, unknown>} />}
    </div>
  );
}
