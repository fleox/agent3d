// Centre: the live runtime (mountScene with editor helpers) inside a frame
// with the target's aspect ratio; device widths preview how the embed scales.
// Select mode: the editor overlay (src/runtime/editor/, loaded lazily) adds
// transform gizmos, click picking, light handles, the editor camera (orbit /
// pan / zoom) and drop placement. Interact mode passes the pointer to the
// scene (orbit, hover behaviours, games) through the scene camera.

import clsx from "clsx";
import { Camera, Focus, Globe, Grid2x2, Hand, Lightbulb, Magnet, Monitor, MousePointer2, Move3d, Rotate3d, Scale3d, Smartphone, SwitchCamera, Tablet, TriangleAlert, Video, Box } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { parseAspect } from "../../core/aspect";
import { uniqueId } from "../../core/ids";
import type { FrameStats, RuntimeIssue } from "../../runtime/api";
import type { CameraPose, EditorSelection, SceneEditor } from "../../runtime/editor/index";
import { IconButton } from "../components/ui/controls";
import { toast } from "../components/ui/Toast";
import { useI18n, type MessageKey } from "../i18n";
import { hasDragPayload, placeLight, readDragPayload } from "../lib/dnd";
import { cameraFromViewOps, lightMoveOps, lightPath, objectTransformOps, pickInChain } from "../lib/gizmo";
import { newObject, takenIds } from "../lib/patches";
import { useEditor, useSnapshot, useUi, type Device, type GizmoMode } from "../state/context";

const DEVICE_WIDTH: Record<Device, number> = { desktop: 0, tablet: 820, phone: 390 };
// Editor camera pose per scene, kept across viewport remounts.
const POSES = new Map<string, CameraPose>();
const LIFT_KINDS = new Set(["mesh", "text", "model", "svg"]);

export function Viewport() {
  const { t } = useI18n();
  const api = useEditor();
  const { player, backend, ui, store, edit } = api;
  const snap = useSnapshot();
  const scene = snap.scene!;
  const device = useUi((s) => s.device);
  const helpers = useUi((s) => s.helpers);
  const interact = useUi((s) => s.interact);
  const pulse = useUi((s) => s.agentPulse);
  const gizmo = useUi((s) => s.gizmo);
  const space = useUi((s) => s.space);
  const snapOn = useUi((s) => s.snap);
  const view = useUi((s) => s.view);
  const lightSel = useUi((s) => s.lightSel);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 800, h: 500 });
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [issues, setIssues] = useState<RuntimeIssue[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [se, setSe] = useState<SceneEditor | null>(null);
  const [dropping, setDropping] = useState(false);
  const mountedRev = useRef(-1);
  const pendingLift = useRef<{ id: string; y: number; key: string; at: number } | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // A finished gizmo drag → one edit (one undo step).
  const onTransformEnd = useCallback(
    (sel: EditorSelection, r: { transform?: import("../../runtime/editor/index").LocalTransform; point?: [number, number, number] }) => {
      const s = store.getSnapshot().scene;
      if (!s) return;
      const ops = sel.kind === "object" && r.transform ? objectTransformOps(s, sel.id, r.transform) : sel.kind === "light" && r.point ? lightMoveOps(s, sel.id, sel.part, r.point) : [];
      if (ops.length) edit(ops);
      else player.update(s); // nothing to save: drop the live preview
    },
    [store, edit, player],
  );

  // Mount (again when assets change on disk). The editor overlay attaches once the player is up.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let editor: SceneEditor | null = null;
    let offLift = () => {};
    void (async () => {
      const cfg = await backend.mountConfig();
      if (cancelled) return;
      const s = store.getSnapshot();
      mountedRev.current = s.revision;
      await player.mount(host, s.scene!, cfg, { editor: true });
      if (cancelled) return;
      const latest = store.getSnapshot();
      if (latest.revision !== mountedRev.current) player.update(latest.scene!);
      const bridge = player.player?.editor;
      const surface = surfaceRef.current;
      if (!bridge || !surface) return;
      const { SceneEditor } = await import("../../runtime/editor/index");
      if (cancelled) return;
      const key = latest.scene?.id ?? "scene";
      editor = new SceneEditor({
        bridge,
        dom: surface,
        initialPose: POSES.get(key) ?? null,
        onCameraChange: (p) => POSES.set(key, p),
        onPick: (hit) => {
          if (!hit) {
            store.select(null);
            ui.set({ lightSel: null });
          } else if ("light" in hit) {
            store.select(null);
            ui.set({ lightSel: { id: hit.light, part: hit.part } });
          } else {
            ui.set({ lightSel: null });
            store.select(pickInChain(hit.chain, store.getSnapshot().selection));
          }
        },
        onTransformEnd: (sel, r) => onTransformEnd(sel, r),
      });
      // Dropped objects rest on the surface they were dropped on (same undo step).
      offLift = bridge.onWorld(() => {
        const lift = pendingLift.current;
        if (!lift || !editor) return;
        pendingLift.current = null;
        if (Date.now() - lift.at > 5000) return;
        const box = editor.objectBox(lift.id);
        const cur = store.getSnapshot().scene;
        if (!box || !cur) return;
        const dy = lift.y - box.min[1];
        if (dy < 0.005 || dy > 50) return;
        const loc = cur.objects.find((o) => o.id === lift.id);
        if (!loc) return;
        const p = loc.position ?? [0, 0, 0];
        edit([{ op: "set", path: `objects#${lift.id}.position`, value: [p[0], Math.round((p[1] + dy) * 1000) / 1000, p[2]] }], { coalesce: lift.key });
      });
      player.sceneEditor = editor;
      setSe(editor);
    })();
    const off = player.onState(() => setIssues([...player.issues]));
    return () => {
      cancelled = true;
      off();
      offLift();
      editor?.dispose();
      if (player.sceneEditor === editor) player.sceneEditor = null;
      setSe(null);
      player.dispose();
      host.replaceChildren();
    };
  }, [backend, player, store, ui, edit, onTransformEnd]);

  useEffect(() => {
    if (snap.revision === mountedRev.current) return;
    player.update(scene);
  }, [snap.revision, scene, player]);

  useEffect(() => {
    const id = setInterval(() => setStats(player.stats()), 1000);
    return () => clearInterval(id);
  }, [player]);

  // Selection / tool state → editor overlay.
  const selId = snap.selection;
  useEffect(() => {
    if (selId && lightSel) ui.set({ lightSel: null });
  }, [selId, lightSel, ui]);
  useEffect(() => {
    se?.setSelection(lightSel && !selId ? { kind: "light", ...lightSel } : selId ? { kind: "object", id: selId } : null);
  }, [se, selId, lightSel, snap.revision]);
  useEffect(() => se?.setMode(gizmo), [se, gizmo]);
  useEffect(() => se?.setSpace(space), [se, space]);
  useEffect(() => se?.setSnap(snapOn), [se, snapOn]);
  useEffect(() => se?.setHelpers(helpers), [se, helpers]);
  // Interact mode looks through the scene camera, like the website.
  useEffect(() => se?.setView(interact ? "camera" : view), [se, view, interact]);
  useEffect(() => se?.setEnabled(!interact), [se, interact]);

  // Frame size: the target aspect inside the stage (and the device width).
  const aspect = parseAspect(scene.target?.aspect) ?? { width: 16, height: 9 };
  const ratio = aspect.width / aspect.height;
  const pad = 28;
  // Wider side margins leave room for the floating tool palette.
  const maxW = Math.max(50, stage.w - 52 * 2);
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

  const ndc = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const el = surfaceRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!hasDragPayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dropping) setDropping(true);
  };
  const onDrop = (e: React.DragEvent) => {
    setDropping(false);
    const payload = readDragPayload(e);
    const p = ndc(e);
    const cur = store.getSnapshot().scene;
    if (!payload || !p || !cur) return;
    e.preventDefault();
    const at = se ? se.dropPoint(p[0], p[1]) : ([0, 0, 0] as [number, number, number]);
    const step = 0.25;
    const pos = at.map((v, i) => (snapOn && i !== 1 ? Math.round(v / step) * step : Math.round(v * 100) / 100) || 0) as [number, number, number];
    if ("light" in payload) {
      const id = uniqueId(payload.light.type, takenIds(cur));
      edit([{ op: "set", path: `lights[${(cur.lights ?? []).length}]`, value: { id, ...placeLight(payload.light, pos) } }], { select: null });
      ui.set({ lightSel: { id, part: "position" }, interact: false });
      return;
    }
    const obj = newObject(cur, payload.object, pos);
    const key = `drop:${obj.id}`;
    if (LIFT_KINDS.has(obj.kind)) pendingLift.current = { id: obj.id, y: pos[1], key, at: Date.now() };
    edit([{ op: "addObject", object: obj }], { select: obj.id, coalesce: key });
    ui.set({ lightSel: null, interact: false });
  };

  const setCameraFromView = () => {
    const cur = store.getSnapshot().scene;
    if (!se || !cur) return;
    const pose = se.pose();
    const ops = cameraFromViewOps(cur, pose.position, pose.target);
    if (!ops.length) return;
    edit(ops);
    toast({ tone: "success", title: t("viewport.cameraSet"), detail: t("viewport.cameraSetDetail") });
  };

  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const lightOk = lightSel && !selId && lightPath(scene, lightSel.id) !== null;
  const selLabel = selId ?? (lightOk ? `${lightSel!.id}${lightSel!.part === "target" ? " · target" : ""}` : null);
  const effView = interact ? "camera" : view;
  const tool = (mode: GizmoMode, label: MessageKey, key: string, icon: ReactNode) => (
    <ToolButton label={t(label)} shortcut={key} active={!interact && gizmo === mode} disabled={interact} onClick={() => ui.set({ gizmo: mode, interact: false })}>
      {icon}
    </ToolButton>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-ink-1 px-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <span className="rounded bg-ink-3 px-1.5 py-0.5 font-medium text-fg">{scene.target?.kind}</span>
          <span className="tabular-nums">{scene.target?.aspect}</span>
          <span className="hidden text-fg-faint tabular-nums lg:inline">
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
          <div className="flex items-center rounded-md bg-ink-2 p-0.5" role="radiogroup" aria-label={t("viewport.view")}>
            <button type="button" role="radio" aria-checked={effView === "editor"} disabled={interact} title={`${t("viewport.editorCamera")} (C)`} onClick={() => ui.set({ view: "editor" })} className={clsx("flex h-6 items-center gap-1 rounded px-1.5 text-2xs font-medium disabled:opacity-40", effView === "editor" ? "bg-ink-4 text-fg" : "text-fg-faint hover:text-fg")}>
              <Video size={12} /> <span className="hidden xl:inline">{t("viewport.editorShort")}</span>
            </button>
            <button type="button" role="radio" aria-checked={effView === "camera"} title={`${t("viewport.sceneCamera")} (C)`} onClick={() => ui.set({ view: "camera" })} className={clsx("flex h-6 items-center gap-1 rounded px-1.5 text-2xs font-medium", effView === "camera" ? "bg-ink-4 text-fg" : "text-fg-faint hover:text-fg")}>
              <Camera size={12} /> <span className="hidden xl:inline">{t("viewport.cameraShort")}</span>
            </button>
          </div>
          <IconButton label={t("viewport.setCamera")} disabled={effView !== "editor" || !se} onClick={setCameraFromView}>
            <SwitchCamera size={14} />
          </IconButton>
          <IconButton
            label={t("viewport.frame")}
            shortcut="F"
            disabled={!se}
            onClick={() => {
              if (view === "camera") ui.set({ view: "editor", interact: false });
              se?.frameSelection();
            }}
          >
            <Focus size={14} />
          </IconButton>
          <div className="mx-1 h-4 w-px bg-line" />
          <IconButton label={t("viewport.helpers")} shortcut="G" active={helpers} onClick={() => ui.set({ helpers: !helpers })}>
            <Grid2x2 size={14} />
          </IconButton>
        </div>
      </div>
      <div ref={stageRef} className="viewport-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div style={{ width: w, height: h, transform: scale !== 1 ? `scale(${scale})` : undefined }} className="relative shrink-0" onDragOver={onDragOver} onDragLeave={() => setDropping(false)} onDrop={onDrop}>
          {/* Agent activity ring: keyed so the animation replays; never key the canvas host. */}
          {pulse > 0 && <div key={pulse} className="agent-pulse pointer-events-none absolute inset-0 rounded-[3px]" />}
          <div className={clsx("absolute inset-0 overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_20px_60px_-20px_rgb(0_0_0/0.8)]", dropping && "ring-2 ring-accent")}>
            <div ref={hostRef} className="absolute inset-0" />
            {effView === "camera" && !interact && helpers && <SafeFrame />}
            <div ref={surfaceRef} data-testid="viewport-surface" className={clsx("absolute inset-0 select-none", interact && "pointer-events-none")} style={{ touchAction: "none" }} aria-label={t("viewport.clickToSelect")} />
            {selLabel && !interact && (
              <div className="pointer-events-none absolute left-2 top-2 flex max-w-[60%] items-center gap-1 truncate rounded-[4px] bg-ink-0/75 px-1.5 py-0.5 text-2xs font-medium text-accent backdrop-blur">
                {lightOk ? <Lightbulb size={10} /> : <Box size={10} />}
                <span className="truncate">{selLabel}</span>
              </div>
            )}
            {!interact && (
              <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-[4px] bg-ink-0/60 px-1.5 py-0.5 text-2xs text-fg-muted backdrop-blur">
                {effView === "camera" ? <Camera size={10} /> : <Video size={10} />}
                {effView === "camera" ? t("viewport.sceneCamera") : t("viewport.editorCamera")}
              </div>
            )}
            {dropping && <div className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-md bg-accent px-2 py-1 text-2xs font-medium text-ink-0">{t("viewport.dropHere")}</div>}
          </div>
        </div>

        {/* Tool palette */}
        <div className="absolute left-2 top-2 flex flex-col gap-0.5 rounded-lg border border-line bg-ink-1/90 p-0.5 shadow-lg shadow-black/30 backdrop-blur" role="toolbar" aria-label={t("viewport.tools")}>
          <ToolButton label={t("viewport.select")} shortcut="Q" active={!interact} onClick={() => ui.set({ interact: false })}>
            <MousePointer2 size={14} />
          </ToolButton>
          <ToolButton label={t("viewport.interact")} shortcut="I" active={interact} onClick={() => ui.set({ interact: true })}>
            <Hand size={14} />
          </ToolButton>
          <div className="mx-1 my-0.5 h-px bg-line" />
          {tool("translate", "viewport.move", "W", <Move3d size={14} />)}
          {tool("rotate", "viewport.rotate", "E", <Rotate3d size={14} />)}
          {tool("scale", "viewport.scale", "R", <Scale3d size={14} />)}
          <div className="mx-1 my-0.5 h-px bg-line" />
          <ToolButton label={space === "world" ? t("viewport.world") : t("viewport.local")} shortcut="X" active={false} disabled={interact} onClick={() => ui.set({ space: space === "world" ? "local" : "world" })}>
            {space === "world" ? <Globe size={14} /> : <Box size={14} />}
          </ToolButton>
          <ToolButton label={t("viewport.snap")} shortcut="⇧" active={snapOn} disabled={interact} onClick={() => ui.set({ snap: !snapOn })}>
            <Magnet size={14} />
          </ToolButton>
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
          {!interact && <span className="hidden border-l border-line pl-2 text-fg-faint md:inline">{effView === "editor" ? t("viewport.navHint") : t("viewport.cameraHint")}</span>}
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

function ToolButton({ label, shortcut, active, disabled, onClick, children }: { label: string; shortcut?: string; active: boolean; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
      className={clsx("flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35", active ? "bg-accent/20 text-accent" : "text-fg-muted hover:bg-ink-3 hover:text-fg")}
    >
      {children}
    </button>
  );
}

// Scene camera guides: rule of thirds + the title-safe area (90 %).
function SafeFrame() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-[5%] rounded-[2px] border border-dashed border-white/25" />
      {[33.333, 66.666].map((p) => (
        <div key={`v${p}`} className="absolute inset-y-0 w-px bg-white/10" style={{ left: `${p}%` }} />
      ))}
      {[33.333, 66.666].map((p) => (
        <div key={`h${p}`} className="absolute inset-x-0 h-px bg-white/10" style={{ top: `${p}%` }} />
      ))}
      <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-white/30" />
      <div className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-white/30" />
    </div>
  );
}
