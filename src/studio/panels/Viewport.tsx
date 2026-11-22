// Centre: the live runtime (mountScene, editor helpers) inside a frame with
// the target's aspect ratio; device widths preview how the embed scales.
// Select mode: click picks an object (player.pick); Interact mode passes
// the pointer to the scene (orbit, hover behaviours, games).

import clsx from "clsx";
import { Grid2x2, Hand, Monitor, MousePointer2, Smartphone, Tablet, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseAspect } from "../../core/aspect";
import { IconButton } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { useEditor, useSnapshot, useUi, type Device } from "../state/context";
import type { FrameStats, RuntimeIssue } from "../../runtime/api";

const DEVICE_WIDTH: Record<Device, number> = { desktop: 0, tablet: 820, phone: 390 };

export function Viewport() {
  const { t } = useI18n();
  const { player, backend, ui, store } = useEditor();
  const snap = useSnapshot();
  const scene = snap.scene!;
  const device = useUi((s) => s.device);
  const helpers = useUi((s) => s.helpers);
  const interact = useUi((s) => s.interact);
  const pulse = useUi((s) => s.agentPulse);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 500 });
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [issues, setIssues] = useState<RuntimeIssue[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const mountedRev = useRef(-1);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Mount (again when helpers toggle or assets change on disk).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    void (async () => {
      const cfg = await backend.mountConfig();
      if (cancelled) return;
      const s = store.getSnapshot();
      mountedRev.current = s.revision;
      await player.mount(host, s.scene!, cfg, { editor: helpers });
      const latest = store.getSnapshot();
      if (!cancelled && latest.revision !== mountedRev.current) player.update(latest.scene!);
    })();
    const off = player.onState(() => setIssues([...player.issues]));
    return () => {
      cancelled = true;
      off();
      player.dispose();
      host.replaceChildren();
    };
  }, [backend, player, store, helpers]);

  useEffect(() => {
    if (snap.revision === mountedRev.current) return;
    player.update(scene);
  }, [snap.revision, scene, player]);

  useEffect(() => {
    const id = setInterval(() => setStats(player.stats()), 1000);
    return () => clearInterval(id);
  }, [player]);

  // Frame size: the target aspect inside the stage (and the device width).
  const aspect = parseAspect(scene.target?.aspect) ?? { width: 16, height: 9 };
  const ratio = aspect.width / aspect.height;
  const pad = 28;
  const maxW = Math.max(50, stage.w - pad * 2);
  const maxH = Math.max(50, stage.h - pad * 2);
  const devW = DEVICE_WIDTH[device];
  // Desktop: fit the stage. Device: lay out at the device width, scale down to fit.
  let w = devW || maxW;
  let h = w / ratio;
  let scale = 1;
  if (devW) scale = Math.min(1, maxW / w, maxH / h);
  else if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }

  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => (down.current = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    store.select(player.pick(x, y));
  };

  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const selected = snap.selection;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-ink-1 px-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <span className="rounded bg-ink-3 px-1.5 py-0.5 font-medium text-fg">{scene.target?.kind}</span>
          <span className="tabular-nums">{scene.target?.aspect}</span>
          <span className="text-fg-faint tabular-nums">
            {Math.round(w)}×{Math.round(h)}
          </span>
        </div>
        <div className="mx-auto flex items-center rounded-md bg-ink-2 p-0.5" role="radiogroup" aria-label={t("viewport.device")}>
          {(
            [
              ["desktop", Monitor],
              ["tablet", Tablet],
              ["phone", Smartphone],
            ] as const
          ).map(([d, I]) => (
            <button key={d} type="button" role="radio" aria-checked={device === d} title={t(`viewport.${d}`)} onClick={() => ui.set({ device: d })} className={clsx("flex h-6 w-8 items-center justify-center rounded", device === d ? "bg-ink-4 text-fg" : "text-fg-faint hover:text-fg")}>
              <I size={13} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label={t("viewport.select")} active={!interact} onClick={() => ui.set({ interact: false })}>
            <MousePointer2 size={14} />
          </IconButton>
          <IconButton label={t("viewport.interact")} shortcut="I" active={interact} onClick={() => ui.set({ interact: true })}>
            <Hand size={14} />
          </IconButton>
          <div className="mx-1 h-4 w-px bg-line" />
          <IconButton label={t("viewport.helpers")} active={helpers} onClick={() => ui.set({ helpers: !helpers })}>
            <Grid2x2 size={14} />
          </IconButton>
        </div>
      </div>
      <div ref={stageRef} className="viewport-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div style={{ width: w, height: h, transform: scale !== 1 ? `scale(${scale})` : undefined }} className="relative shrink-0">
          <div key={pulse} className={clsx("absolute inset-0 overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_20px_60px_-20px_rgb(0_0_0/0.8)]", pulse > 0 && "agent-pulse")}>
            <div ref={hostRef} className="absolute inset-0" />
            {!interact && <div className="absolute inset-0 cursor-crosshair" onPointerDown={onPointerDown} onPointerUp={onPointerUp} aria-label={t("viewport.clickToSelect")} />}
          </div>
          {selected && (
            <div className="pointer-events-none absolute -top-6 left-0 flex items-center gap-1 text-2xs text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {selected}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 flex gap-2 rounded-md bg-ink-0/70 px-2 py-1 text-2xs tabular-nums text-fg-muted backdrop-blur">
          {stats ? (
            <>
              <span>
                <b className="font-semibold text-fg">{k(stats.triangles)}</b> {t("viewport.tris")}
              </span>
              <span>
                <b className="font-semibold text-fg">{stats.drawCalls}</b> {t("viewport.calls")}
              </span>
              {stats.fps ? (
                <span>
                  <b className="font-semibold text-fg">{stats.fps}</b> fps
                </span>
              ) : null}
            </>
          ) : (
            <span>{t("viewport.starting")}</span>
          )}
        </div>
        {issues.length > 0 && (
          <div className="absolute bottom-2 right-2">
            <button type="button" onClick={() => setShowIssues((v) => !v)} className="flex items-center gap-1 rounded-md bg-warn/15 px-2 py-1 text-2xs font-medium text-warn backdrop-blur hover:bg-warn/25">
              <TriangleAlert size={11} /> {t("viewport.runtimeIssues", { n: issues.length })}
            </button>
            {showIssues && (
              <div className="absolute bottom-8 right-0 max-h-60 w-80 overflow-auto rounded-lg border border-line bg-ink-1 p-2 text-xs shadow-xl">
                {issues.map((i, n) => (
                  <div key={n} className="border-b border-line py-1 last:border-0">
                    <div className="font-mono text-2xs text-warn">{i.code}</div>
                    <div className="text-fg-muted">{i.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
