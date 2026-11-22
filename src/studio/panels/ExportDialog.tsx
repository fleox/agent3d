// Export: embed folder / single HTML (export tool), poster (a rendered
// frame), video (CLI only for now). Shows the snippet + output path.

import clsx from "clsx";
import { Check, Clipboard, Code2, Download, FileCode, Image, Loader2, Upload, Video } from "lucide-react";
import { useState } from "react";
import { sizeForAspect } from "../../core/aspect";
import type { Issue } from "../../core/types";
import type { ExportFormatId } from "../backend/types";
import { Button, TextField, Toggle } from "../components/ui/controls";
import { Dialog } from "../components/ui/Dialog";
import { useI18n, type MessageKey } from "../i18n";
import { copyText, dataUrlBytes, downloadBytes } from "../lib/download";
import { useEditor, useSnapshot } from "../state/context";
import { renderStill } from "../state/playerController";
import { IssueList } from "./IssueList";

interface ExportOut {
  outDir: string;
  entry: string;
  files: number;
  totalKb: number;
  sizes?: Record<string, number>;
  snippet: string;
  credits?: { path: string; license: string; attribution?: string }[];
  issues?: Issue[];
}

const FORMATS: { id: ExportFormatId; icon: typeof Code2; title: MessageKey; body: MessageKey }[] = [
  { id: "embed", icon: Code2, title: "export.embed", body: "export.embedBody" },
  { id: "single-html", icon: FileCode, title: "export.single", body: "export.singleBody" },
  { id: "poster", icon: Image, title: "export.poster", body: "export.posterBody" },
  { id: "video", icon: Video, title: "export.video", body: "export.videoBody" },
];

export function ExportDialog() {
  const { t } = useI18n();
  const { ui, backend, store, player } = useEditor();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const caps = backend.capabilities;
  const [format, setFormat] = useState<ExportFormatId>(caps.exportFormats[0] ?? "poster");
  const [name, setName] = useState(scene.id);
  const [withPoster, setWithPoster] = useState(caps.render);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; issues?: Issue[] } | null>(null);
  const [out, setOut] = useState<ExportOut | null>(null);
  const [poster, setPoster] = useState<{ url: string; path?: string; dataUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const available = (f: ExportFormatId) => caps.exportFormats.includes(f);

  const renderPoster = async (): Promise<string | undefined> => {
    const at = scene.target.posterTime ?? 0;
    if (caps.render) {
      const r = await backend.call<{ frames: { t: number; path: string }[] }>("render_preview", { frames: [at], sheet: false });
      const path = r.frames[0]?.path;
      if (path) setPoster({ url: await backend.fileUrl(path), path });
      return path;
    }
    const size = sizeForAspect(scene.target.aspect, 1200);
    const dataUrl = await renderStill(scene, await backend.mountConfig(), at, size.width, size.height);
    const path = "renders/poster.png";
    await backend.writeFile(path, dataUrlBytes(dataUrl));
    setPoster({ url: dataUrl, dataUrl, path });
    return path;
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setOut(null);
    setPoster(null);
    try {
      await store.flush();
      if (format === "poster") {
        await renderPoster();
      } else {
        const posterPath = format === "embed" && withPoster ? await renderPoster() : undefined;
        const r = await backend.call<ExportOut>("export", { format, ...(name ? { name } : {}), ...(posterPath ? { poster: posterPath } : {}) });
        setOut(r);
      }
    } catch (e) {
      const err = e as Error & { details?: { issues?: Issue[] } };
      setError({ message: err.message, issues: err.details?.issues });
    } finally {
      setBusy(false);
    }
    void player;
  };

  const copy = async (text: string) => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <Dialog
      title={t("export.title")}
      width={640}
      onClose={() => ui.set({ dialog: null })}
      footer={
        <>
          {backend.mode === "local" && out && (
            <Button variant="ghost" onClick={async () => downloadBytes(out.entry.split("/").pop()!, await backend.readFile(out.entry), "text/html")}>
              <Download size={13} /> {t("export.download")}
            </Button>
          )}
          {poster?.dataUrl && (
            <Button variant="ghost" onClick={() => downloadBytes(`${scene.id}-poster.png`, dataUrlBytes(poster.dataUrl!), "image/png")}>
              <Download size={13} /> {t("export.downloadPoster")}
            </Button>
          )}
          <Button variant="primary" onClick={() => void run()} disabled={busy || !available(format)}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {t("export.run")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {FORMATS.map((f) => {
            const I = f.icon;
            const ok = available(f.id);
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={format === f.id}
                disabled={!ok}
                onClick={() => setFormat(f.id)}
                className={clsx("flex gap-2.5 rounded-lg border p-3 text-left transition-colors", format === f.id ? "border-accent bg-accent/10" : "border-line hover:border-fg-faint", !ok && "cursor-not-allowed opacity-45")}
              >
                <I size={16} className={format === f.id ? "text-accent" : "text-fg-muted"} />
                <div>
                  <div className="text-sm font-medium">{t(f.title)}</div>
                  <div className="text-2xs leading-snug text-fg-muted">{ok ? t(f.body) : f.id === "video" ? t("export.videoCli") : t("export.needsCli")}</div>
                </div>
              </button>
            );
          })}
        </div>
        {(format === "embed" || format === "single-html") && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[100px_1fr] items-center gap-2">
              <label className="text-xs text-fg-muted">{t("export.name")}</label>
              <TextField value={name} onCommit={setName} ariaLabel={t("export.name")} />
            </div>
            {format === "embed" && caps.render && (
              <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                <span className="text-xs text-fg-muted">{t("export.withPoster")}</span>
                <Toggle checked={withPoster} onChange={setWithPoster} ariaLabel={t("export.withPoster")} />
              </div>
            )}
          </div>
        )}
        {backend.mode === "local" && <p className="text-2xs text-fg-faint">{t("export.localNote")}</p>}
        {error && (
          <div className="rounded-md bg-danger/10 text-xs text-danger">
            <div className="px-3 py-2">{error.message}</div>
            {error.issues && <IssueList issues={error.issues} dense />}
          </div>
        )}
        {poster && (
          <div>
            <img src={poster.url} alt={t("export.poster")} className="block w-full rounded-md border border-line" />
            {poster.path && <div className="mt-1 font-mono text-2xs text-fg-faint">{poster.path}</div>}
          </div>
        )}
        {out && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Check size={13} className="text-agent" />
              <span>{t("export.done", { files: out.files, kb: Math.round(out.totalKb) })}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 text-xs">
              <span className="text-fg-muted">{t("export.output")}</span>
              <span className="break-all font-mono text-fg">{backend.location && backend.mode === "cli" ? `${backend.location}/${out.entry}` : out.entry}</span>
            </div>
            <div className="relative">
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-ink-0 p-3 pr-20 font-mono text-2xs leading-relaxed text-fg">{out.snippet}</pre>
              <Button size="xs" variant="subtle" className="absolute right-2 top-2" onClick={() => void copy(out.snippet)}>
                {copied ? <Check size={11} /> : <Clipboard size={11} />} {copied ? t("export.copied") : t("export.copy")}
              </Button>
            </div>
            {!!out.credits?.length && <div className="text-2xs text-fg-faint">{out.credits.map((c) => c.attribution ?? `${c.path} (${c.license})`).join(" · ")}</div>}
            {!!out.issues?.length && (
              <div className="rounded-md border border-line">
                <IssueList issues={out.issues} dense />
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
