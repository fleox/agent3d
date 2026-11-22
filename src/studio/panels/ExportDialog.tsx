// Export: embed folder / zip / single HTML (export tool, with base URL,
// cache-bust, integrity, optimised asset copies, og image), poster, video
// (MP4 / WebM) and GIF (rendered by the CLI host). Shows the snippet + output.

import clsx from "clsx";
import { Archive, Check, Clipboard, Code2, Download, FileCode, Film, Image, Loader2, Upload, Video } from "lucide-react";
import { useState, type ReactNode } from "react";
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
import { MediaKindPicker, MediaOptionsForm, defaultMedia, mediaInput, type MediaSettings } from "./MediaOptions";

interface ExportOut {
  outDir: string;
  entry: string;
  files: number;
  totalKb: number;
  sizes?: Record<string, number>;
  snippet: string;
  credits?: { path: string; license: string; attribution?: string }[];
  issues?: Issue[];
  optimized?: { beforeKb: number; afterKb: number; savedKb: number };
  ogImage?: boolean;
  hint?: string;
}
interface MediaOut {
  format: string;
  path: string;
  kb: number;
  size: { width: number; height: number };
}

const FORMATS: { id: ExportFormatId; icon: typeof Code2; title: MessageKey; body: MessageKey }[] = [
  { id: "embed", icon: Code2, title: "export.embed", body: "export.embedBody" },
  { id: "zip", icon: Archive, title: "export.zip", body: "export.zipBody" },
  { id: "single-html", icon: FileCode, title: "export.single", body: "export.singleBody" },
  { id: "poster", icon: Image, title: "export.poster", body: "export.posterBody" },
  { id: "video", icon: Video, title: "export.video", body: "export.videoBody" },
  { id: "gif", icon: Film, title: "export.gif", body: "export.gifBody" },
];

function Opt({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-2">
      <span className="text-xs text-fg-muted" title={hint}>
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        {children}
        {hint && <span className="truncate text-2xs text-fg-faint">{hint}</span>}
      </div>
    </div>
  );
}

export function ExportDialog() {
  const { t } = useI18n();
  const { ui, backend, store } = useEditor();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const caps = backend.capabilities;
  const [format, setFormat] = useState<ExportFormatId>(caps.exportFormats[0] ?? "poster");
  const [name, setName] = useState(scene.id);
  const [withPoster, setWithPoster] = useState(caps.render);
  const [og, setOg] = useState(caps.render);
  const [baseUrl, setBaseUrl] = useState("");
  const [cacheBust, setCacheBust] = useState(false);
  const [integrity, setIntegrity] = useState(true);
  const [optimize, setOptimize] = useState(false);
  const [media, setMedia] = useState<MediaSettings>(defaultMedia("mp4"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; issues?: Issue[] } | null>(null);
  const [out, setOut] = useState<ExportOut | null>(null);
  const [mediaOut, setMediaOut] = useState<{ url: string; out: MediaOut } | null>(null);
  const [poster, setPoster] = useState<{ url: string; path?: string; dataUrl?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const available = (f: ExportFormatId) => caps.exportFormats.includes(f);
  const site = format === "embed" || format === "zip";
  const bundle = site || format === "single-html";
  const isMedia = format === "video" || format === "gif" || (format === "poster" && caps.render);

  // Local (in-browser) poster: a still rendered in the page.
  const localPoster = async (): Promise<string> => {
    const size = sizeForAspect(scene.target.aspect, 1200);
    const dataUrl = await renderStill(scene, await backend.mountConfig(), scene.target.posterTime ?? 0, size.width, size.height);
    const path = "renders/poster.png";
    await backend.writeFile(path, dataUrlBytes(dataUrl));
    setPoster({ url: dataUrl, dataUrl, path });
    return path;
  };
  const embedPoster = async (): Promise<string | undefined> => {
    if (!caps.render) return localPoster();
    const r = await backend.call<{ frames: { t: number; path: string }[] }>("render_preview", { frames: [scene.target.posterTime ?? 0], sheet: false });
    const path = r.frames[0]?.path;
    if (path) setPoster({ url: await backend.fileUrl(path), path });
    return path;
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setOut(null);
    setMediaOut(null);
    setPoster(null);
    try {
      await store.flush();
      if (format === "poster" && !caps.render) await localPoster();
      else if (isMedia) {
        const m: MediaSettings = format === "gif" ? { ...media, kind: "gif" } : format === "poster" ? { ...media, kind: "poster" } : media.kind === "mp4" || media.kind === "webm" ? media : { ...media, kind: "mp4" };
        const ext = m.kind === "poster" ? m.image : m.kind === "gif" ? "gif" : m.kind;
        const file = m.kind === "poster" ? `dist/poster.${ext}` : m.kind === "gif" ? "dist/animation.gif" : `dist/video.${ext}`;
        const r = await backend.call<MediaOut>("export", mediaInput(m, file));
        setMediaOut({ url: await backend.fileUrl(r.path), out: r });
      } else {
        const posterPath = bundle && withPoster ? await embedPoster() : undefined;
        const r = await backend.call<ExportOut>("export", {
          format,
          ...(name ? { name } : {}),
          ...(posterPath ? { poster: posterPath } : {}),
          ...(site && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          ...(site && cacheBust ? { cacheBust: true } : {}),
          ...(site && !integrity ? { integrity: false } : {}),
          ...(optimize ? { optimize: true } : {}),
          ...(site && og && caps.render ? { og: true } : {}),
        });
        setOut(r);
      }
    } catch (e) {
      const err = e as Error & { details?: { issues?: Issue[] } };
      setError({ message: err.message, issues: err.details?.issues });
    } finally {
      setBusy(false);
    }
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
      width={700}
      onClose={() => ui.set({ dialog: null })}
      footer={
        <>
          {backend.mode === "local" && out && (
            <Button variant="ghost" onClick={async () => downloadBytes(out.entry.split("/").pop()!, await backend.readFile(out.entry), "text/html")}>
              <Download size={13} /> {t("export.download")}
            </Button>
          )}
          {backend.mode === "cli" && out && format === "zip" && (
            <Button variant="ghost" onClick={async () => downloadBytes(out.entry.split("/").pop()!, await backend.readFile(out.entry), "application/zip")}>
              <Download size={13} /> {t("export.download")}
            </Button>
          )}
          {mediaOut && (
            <Button variant="ghost" onClick={async () => downloadBytes(mediaOut.out.path.split("/").pop()!, await backend.readFile(mediaOut.out.path), "application/octet-stream")}>
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
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
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
                onClick={() => {
                  setFormat(f.id);
                  setOut(null);
                  setMediaOut(null);
                  setPoster(null);
                  setError(null);
                }}
                className={clsx("flex gap-2.5 rounded-lg border p-3 text-left transition-colors", format === f.id ? "border-accent bg-accent/10" : "border-line hover:border-fg-faint", !ok && "cursor-not-allowed opacity-45")}
              >
                <I size={16} className={clsx("shrink-0", format === f.id ? "text-accent" : "text-fg-muted")} />
                <div>
                  <div className="text-sm font-medium">{t(f.title)}</div>
                  <div className="text-2xs leading-snug text-fg-muted">{ok ? t(f.body) : t("export.needsCli")}</div>
                </div>
              </button>
            );
          })}
        </div>

        {bundle && (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <Opt label={t("export.name")}>
              <TextField value={name} onCommit={setName} ariaLabel={t("export.name")} className="max-w-[220px]" />
            </Opt>
            {site && (
              <>
                <Opt label={t("export.baseUrl")} hint={t("export.baseUrlHint")}>
                  <TextField value={baseUrl} placeholder="./" onCommit={setBaseUrl} mono ariaLabel={t("export.baseUrl")} className="max-w-[220px]" />
                </Opt>
                <Opt label={t("export.cacheBust")} hint={t("export.cacheBustHint")}>
                  <Toggle checked={cacheBust} onChange={setCacheBust} ariaLabel={t("export.cacheBust")} />
                </Opt>
                <Opt label={t("export.integrity")} hint={t("export.integrityHint")}>
                  <Toggle checked={integrity} onChange={setIntegrity} ariaLabel={t("export.integrity")} />
                </Opt>
              </>
            )}
            {caps.render && (
              <Opt label={t("export.optimize")} hint={t("export.optimizeHint")}>
                <Toggle checked={optimize} onChange={setOptimize} ariaLabel={t("export.optimize")} />
              </Opt>
            )}
            <Opt label={t("export.withPoster")} hint={t("export.withPosterHint")}>
              <Toggle checked={withPoster} onChange={setWithPoster} ariaLabel={t("export.withPoster")} />
            </Opt>
            {site && caps.render && (
              <Opt label={t("export.og")} hint={t("export.ogHint")}>
                <Toggle checked={og} onChange={setOg} ariaLabel={t("export.og")} />
              </Opt>
            )}
          </div>
        )}
        {isMedia && (
          <div className="space-y-3 rounded-lg border border-line p-3">
            {format === "video" && <MediaKindPicker value={media.kind === "webm" ? "webm" : "mp4"} kinds={["mp4", "webm"]} onChange={(k) => setMedia({ ...media, kind: k })} />}
            <MediaOptionsForm value={{ ...media, kind: format === "gif" ? "gif" : format === "poster" ? "poster" : media.kind === "webm" ? "webm" : "mp4" }} onChange={(m) => setMedia({ ...m, kind: format === "video" ? m.kind : media.kind })} scene={scene} />
          </div>
        )}
        {backend.mode === "local" && <p className="text-2xs text-fg-faint">{t("export.localNote")}</p>}
        {error && (
          <div className="rounded-md bg-danger/10 text-xs text-danger">
            <div className="px-3 py-2">{error.message}</div>
            {error.issues && <IssueList issues={error.issues} dense />}
          </div>
        )}
        {poster && !out && (
          <div>
            <img src={poster.url} alt={t("export.poster")} className="block w-full rounded-md border border-line" />
            {poster.path && <div className="mt-1 font-mono text-2xs text-fg-faint">{poster.path}</div>}
          </div>
        )}
        {mediaOut && (
          <div className="space-y-1">
            {mediaOut.out.format === "video" ? <video src={mediaOut.url} controls autoPlay loop muted className="block w-full rounded-md border border-line" /> : <img src={mediaOut.url} alt={mediaOut.out.path} className="block w-full rounded-md border border-line" />}
            <div className="flex items-center gap-2 text-xs">
              <Check size={13} className="text-agent" />
              <span className="font-mono text-2xs text-fg">{backend.location && backend.mode === "cli" ? `${backend.location}/${mediaOut.out.path}` : mediaOut.out.path}</span>
              <span className="text-2xs text-fg-faint">
                {mediaOut.out.size.width}×{mediaOut.out.size.height} · {mediaOut.out.kb} KB
              </span>
            </div>
          </div>
        )}
        {out && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Check size={13} className="text-agent" />
              <span>{t("export.done", { files: out.files, kb: Math.round(out.totalKb) })}</span>
              {out.optimized && <span className="text-2xs text-fg-faint">{t("export.optimized", { before: out.optimized.beforeKb, after: out.optimized.afterKb })}</span>}
              {out.ogImage && <span className="rounded bg-ink-3 px-1.5 text-2xs text-fg-muted">og-image.png</span>}
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 text-xs">
              <span className="text-fg-muted">{t("export.output")}</span>
              <span className="break-all font-mono text-fg">{backend.location && backend.mode === "cli" ? `${backend.location}/${out.entry}` : out.entry}</span>
            </div>
            {format !== "zip" && (
              <div className="relative">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-ink-0 p-3 pr-20 font-mono text-2xs leading-relaxed text-fg">{out.snippet}</pre>
                <Button size="xs" variant="subtle" className="absolute right-2 top-2" onClick={() => void copy(out.snippet)}>
                  {copied ? <Check size={11} /> : <Clipboard size={11} />} {copied ? t("export.copied") : t("export.copy")}
                </Button>
              </div>
            )}
            {out.hint && <div className="text-2xs text-warn">{out.hint}</div>}
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
