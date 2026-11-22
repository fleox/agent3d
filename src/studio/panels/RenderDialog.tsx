// Render: "Frames" — render_preview (headless Chrome via the CLI) → contact
// sheet; "Media" — MP4 / WebM / GIF / animated WebP through the export tool
// (quality, fps, duration, size, transparent) into renders/.
// In-browser projects: a clean still of the current frame instead.

import clsx from "clsx";
import { Camera, Download, Film, Images, Loader2 } from "lucide-react";
import { useState } from "react";
import { sizeForAspect } from "../../core/aspect";
import { Button } from "../components/ui/controls";
import { Dialog } from "../components/ui/Dialog";
import { useI18n } from "../i18n";
import { dataUrlBytes, downloadBytes } from "../lib/download";
import { useEditor, useSnapshot } from "../state/context";
import { renderStill } from "../state/playerController";
import { IssueList } from "./IssueList";
import { MEDIA_EXT, MediaKindPicker, MediaOptionsForm, defaultMedia, mediaInput, type MediaKind, type MediaSettings } from "./MediaOptions";
import type { Issue } from "../../core/types";

interface RenderOut {
  sheet?: string;
  frames: { t: number; path: string }[];
  stats?: { triangles: number; drawCalls: number };
  issues?: Issue[];
  consoleErrors?: string[];
}
interface MediaOut {
  format: string;
  path: string;
  kb: number;
  size: { width: number; height: number };
  frames?: number;
  fps?: number;
  duration?: number;
  codec?: string;
}

export function RenderDialog() {
  const { t } = useI18n();
  const { ui, backend, store, player } = useEditor();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const [tab, setTab] = useState<"frames" | "media">("frames");
  const [count, setCount] = useState(4);
  const [media, setMedia] = useState<MediaSettings>(defaultMedia("mp4"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ img: string; out?: RenderOut; path?: string } | null>(null);
  const [mediaOut, setMediaOut] = useState<{ url: string; out: MediaOut } | null>(null);
  const can = backend.capabilities.render;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (tab === "media") {
        await store.flush();
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
        const out = await backend.call<MediaOut>("export", mediaInput(media, `renders/${scene.id}-${stamp}.${MEDIA_EXT[media.kind]}`));
        setMediaOut({ url: await backend.fileUrl(out.path), out });
      } else if (can) {
        await store.flush();
        const out = await backend.call<RenderOut>("render_preview", { count, sheet: true });
        const path = out.sheet ?? out.frames[0]?.path;
        setResult({ img: path ? await backend.fileUrl(path) : "", out, path });
      } else {
        const size = sizeForAspect(scene.target.aspect, 1200);
        const img = await renderStill(scene, await backend.mountConfig(), player.player?.time() ?? 0, size.width, size.height);
        setResult({ img });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const kinds: MediaKind[] = ["mp4", "webm", "gif", "webp"];
  return (
    <Dialog
      title={t("render.title")}
      width={880}
      onClose={() => ui.set({ dialog: null })}
      footer={
        <>
          {tab === "frames" && can && (
            <label className="mr-auto flex items-center gap-2 text-xs text-fg-muted">
              {t("render.frames")}
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="field w-16">
                {[1, 2, 4, 6, 8, 12].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          {tab === "media" && mediaOut && (
            <Button variant="ghost" className="mr-auto" onClick={async () => downloadBytes(mediaOut.out.path.split("/").pop()!, await backend.readFile(mediaOut.out.path), mediaOut.out.format === "video" ? `video/${mediaOut.out.path.endsWith(".mp4") ? "mp4" : "webm"}` : `image/${mediaOut.out.path.split(".").pop()}`)}>
              <Download size={13} /> {t("export.download")}
            </Button>
          )}
          {result && !can && tab === "frames" && (
            <Button variant="ghost" onClick={() => downloadBytes(`${scene.id}.png`, dataUrlBytes(result.img), "image/png")}>
              <Download size={13} /> {t("render.download")}
            </Button>
          )}
          <Button variant="primary" onClick={() => void run()} disabled={busy || (tab === "media" && !can)}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : tab === "media" ? <Film size={13} /> : <Camera size={13} />} {busy ? t("render.rendering") : tab === "media" ? t("render.renderMedia", { kind: t(`media.kind.${media.kind}`) }) : result ? t("render.again") : t("render.run")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-4">
        <div className="flex gap-1 border-b border-line" role="tablist">
          {(
            [
              { id: "frames", icon: Images, label: t("render.tabFrames") },
              { id: "media", icon: Film, label: t("render.tabMedia") },
            ] as const
          ).map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={clsx("-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 text-sm", tab === x.id ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg")}>
              <x.icon size={13} /> {x.label}
            </button>
          ))}
        </div>
        {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        {tab === "frames" && (
          <>
            <p className="text-xs text-fg-muted">{can ? t("render.intro") : t("render.localIntro")}</p>
            {result ? (
              <>
                <div className="overflow-hidden rounded-lg border border-line bg-black">{result.img && <img src={result.img} alt={t("render.sheetAlt")} className="block w-full" />}</div>
                {result.path && <div className="font-mono text-2xs text-fg-faint">{result.path}</div>}
                {result.out?.stats && <div className="text-xs text-fg-muted">{t("render.stats", { tris: result.out.stats.triangles.toLocaleString(), calls: result.out.stats.drawCalls })}</div>}
                {!!result.out?.issues?.length && (
                  <div className="rounded-md border border-line">
                    <IssueList issues={result.out.issues} dense />
                  </div>
                )}
                {!!result.out?.consoleErrors?.length && <pre className="max-h-32 overflow-auto rounded-md bg-ink-0 p-2 text-2xs text-danger">{result.out.consoleErrors.join("\n")}</pre>}
              </>
            ) : (
              <div className="flex aspect-[3/1] items-center justify-center rounded-lg border border-dashed border-line text-xs text-fg-faint">{busy ? t("render.rendering") : t("render.placeholder")}</div>
            )}
          </>
        )}
        {tab === "media" && (
          <>
            <p className="text-xs text-fg-muted">{can ? t("render.mediaIntro") : t("render.mediaNeedsCli")}</p>
            <MediaKindPicker value={media.kind} kinds={kinds} onChange={(k) => setMedia({ ...media, kind: k, fps: undefined, transparent: k === "gif" || k === "webp" ? media.transparent : false })} />
            <div className="text-2xs text-fg-faint">{t(`media.about.${media.kind}`)}</div>
            <MediaOptionsForm value={media} onChange={setMedia} scene={scene} />
            {mediaOut ? (
              <div className="space-y-1.5">
                <div className="overflow-hidden rounded-lg border border-line" style={{ background: "repeating-conic-gradient(#2a2e38 0 25%, #1f222a 0 50%) 0 0 / 16px 16px" }}>
                  {mediaOut.out.format === "video" ? <video src={mediaOut.url} controls autoPlay loop muted className="block w-full" /> : <img src={mediaOut.url} alt={mediaOut.out.path} className="block w-full" />}
                </div>
                <div className="flex flex-wrap gap-x-3 font-mono text-2xs text-fg-faint">
                  <span>{mediaOut.out.path}</span>
                  <span>
                    {mediaOut.out.size.width}×{mediaOut.out.size.height}
                  </span>
                  {mediaOut.out.frames !== undefined && (
                    <span>
                      {mediaOut.out.frames} {t("render.framesUnit")} @ {mediaOut.out.fps} fps · {mediaOut.out.duration}s
                    </span>
                  )}
                  {mediaOut.out.codec && <span>{mediaOut.out.codec}</span>}
                  <span>{mediaOut.out.kb} KB</span>
                </div>
              </div>
            ) : (
              <div className="flex aspect-[3/1] items-center justify-center rounded-lg border border-dashed border-line text-xs text-fg-faint">{busy ? t("render.renderingMedia") : t("render.mediaPlaceholder")}</div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
