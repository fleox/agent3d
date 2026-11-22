import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fileToBase64, toast, uploadFile, withStorageBatch, type PluginSettingsPageProps, type SettingsSchema } from "@agent-cms/runtime";
import { DEFAULT_CONFIG, PLUGIN_ID, relativeToExport, scenesInExport, shouldUpload, type PluginConfig, type UploadedScene } from "./render";

// Settings → Agent3D scenes: upload an Agent3D export folder (the `dist/embed`
// folder written by `agent3d export`) to <folder>/ on the site's hosting and
// remember the scenes it contains, so the editor block can list them.

const TEXT = /\.(json|js|mjs|html|txt|svg|gltf|css)$/i;

export function SettingsPage({ config, save }: PluginSettingsPageProps<PluginConfig>) {
  const { t } = useTranslation(PLUGIN_ID);
  const cfg: PluginConfig = { ...DEFAULT_CONFIG, ...config, scenes: Array.isArray(config.scenes) ? config.scenes : [] };
  const [folder, setFolder] = useState(cfg.folder);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setFolder(cfg.folder), [cfg.folder]);
  useEffect(() => {
    // Folder picking (non-standard attribute, supported by every evergreen browser).
    input.current?.setAttribute("webkitdirectory", "");
  }, []);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const target = (folder || DEFAULT_CONFIG.folder).replace(/^\/+|\/+$/g, "");
    const list = Array.from(files).map((f) => ({ file: f, rel: relativeToExport((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name) }));
    const found = scenesInExport(list.map((x) => x.rel), target);
    if (!found.length) {
      toast.error(t("settings.noScene"));
      return;
    }
    setBusy(true);
    try {
      const todo = list.filter((x) => shouldUpload(x.rel));
      let done = 0;
      await withStorageBatch(async () => {
        for (const { file, rel } of todo) {
          setStatus(t("settings.uploading", { done, total: todo.length }));
          const path = `${target}/${rel}`;
          if (TEXT.test(rel)) await uploadFile({ path, content: await file.text() });
          else await uploadFile({ path, content: await fileToBase64(file), encoding: "base64" });
          done++;
        }
      });
      const byName = new Map<string, UploadedScene>(cfg.scenes.map((s) => [s.name, s]));
      for (const s of found) byName.set(s.name, { ...s, label: byName.get(s.name)?.label ?? "" });
      await save({ ...cfg, folder: target, scenes: [...byName.values()] });
      setStatus(t("settings.done", { count: found.length, files: todo.length }));
      toast.success(t("settings.done", { count: found.length, files: todo.length }));
    } catch (err) {
      setStatus("");
      toast.error(`${t("settings.failed")} ${(err as Error).message}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function forget(name: string) {
    await save({ ...cfg, scenes: cfg.scenes.filter((s) => s.name !== name) });
  }

  return (
    <form data-form-type="other" className="max-w-2xl space-y-4" onSubmit={(e) => e.preventDefault()}>
      <p className="text-sm text-surface-500">{t("settings.intro")}</p>
      <label className="block space-y-1">
        <span className="label">{t("settings.folder")}</span>
        <input className="input w-full" value={folder} onChange={(e) => setFolder(e.target.value)} onBlur={() => folder !== cfg.folder && save({ ...cfg, folder })} />
      </label>
      <label className="block space-y-1">
        <span className="label">{t("settings.pick")}</span>
        <input ref={input} type="file" multiple disabled={busy} className="input w-full" onChange={(e) => upload(e.target.files)} />
      </label>
      <p className="text-sm" aria-live="polite">{status}</p>
      <div className="card p-4 space-y-2">
        <span className="font-medium">{t("settings.scenes")}</span>
        {cfg.scenes.length === 0 ? (
          <p className="text-sm text-surface-500">{t("settings.empty")}</p>
        ) : (
          cfg.scenes.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                <strong>{s.name}</strong> <code style={{ opacity: 0.7 }}>{s.src}</code>
              </span>
              <button type="button" className="btn-ghost" onClick={() => forget(s.name)}>
                <span>{t("settings.forget")}</span>
              </button>
            </div>
          ))
        )}
      </div>
      <p className="text-xs text-surface-500">{t("settings.regenerate")}</p>
    </form>
  );
}

export const SETTINGS_SCHEMA: SettingsSchema = {
  folder: { description: "Site folder (no leading slash) where the settings page uploads Agent3D export folders. Default: agent3d." },
  scenes: { description: "Scenes uploaded through the settings page (name, src, poster, runtime, label). Managed by the plugin — don't set.", format: "array of objects" },
};
