// Render: render_preview (headless Chrome via the CLI) → contact sheet.
// In-browser projects: a clean still of the current frame instead.

import { Camera, Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { sizeForAspect } from "../../core/aspect";
import { Button } from "../components/ui/controls";
import { Dialog } from "../components/ui/Dialog";
import { useI18n } from "../i18n";
import { dataUrlBytes, downloadBytes } from "../lib/download";
import { useEditor, useSnapshot } from "../state/context";
import { renderStill } from "../state/playerController";
import { IssueList } from "./IssueList";
import type { Issue } from "../../core/types";

interface RenderOut {
  sheet?: string;
  frames: { t: number; path: string }[];
  stats?: { triangles: number; drawCalls: number };
  issues?: Issue[];
  consoleErrors?: string[];
}

export function RenderDialog() {
  const { t } = useI18n();
  const { ui, backend, store, player } = useEditor();
  const snap = useSnapshot();
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ img: string; out?: RenderOut; path?: string } | null>(null);
  const can = backend.capabilities.render;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (can) {
        await store.flush();
        const out = await backend.call<RenderOut>("render_preview", { count, sheet: true });
        const path = out.sheet ?? out.frames[0]?.path;
        setResult({ img: path ? await backend.fileUrl(path) : "", out, path });
      } else {
        const scene = snap.scene!;
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

  return (
    <Dialog
      title={t("render.title")}
      width={880}
      onClose={() => ui.set({ dialog: null })}
      footer={
        <>
          {can && (
            <label className="mr-auto flex items-center gap-2 text-xs text-fg-muted">
              {t("render.frames")}
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="field w-16">
                {[1, 2, 4, 6, 8, 12].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          {result && !can && (
            <Button variant="ghost" onClick={() => downloadBytes(`${snap.scene!.id}.png`, dataUrlBytes(result.img), "image/png")}>
              <Download size={13} /> {t("render.download")}
            </Button>
          )}
          <Button variant="primary" onClick={() => void run()} disabled={busy}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} {busy ? t("render.rendering") : result ? t("render.again") : t("render.run")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-xs text-fg-muted">{can ? t("render.intro") : t("render.localIntro")}</p>
        {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        {result ? (
          <>
            <div className="overflow-hidden rounded-lg border border-line bg-black">{result.img && <img src={result.img} alt={t("render.sheetAlt")} className="block w-full" />}</div>
            {result.path && <div className="font-mono text-2xs text-fg-faint">{result.path}</div>}
            {result.out?.stats && (
              <div className="text-xs text-fg-muted">
                {t("render.stats", { tris: result.out.stats.triangles.toLocaleString(), calls: result.out.stats.drawCalls })}
              </div>
            )}
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
      </div>
    </Dialog>
  );
}
