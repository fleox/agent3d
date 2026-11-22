import clsx from "clsx";
import { Bot, Camera, ChevronLeft, CircleAlert, Cloud, HardDrive, Keyboard, Loader2, Pause, Play, Redo2, ShieldCheck, Undo2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button, IconButton } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { useEditor, useSnapshot, useUi } from "../state/context";

export function TopBar() {
  const { t, lang, setLang } = useI18n();
  const { store, ui, backend, closeProject, runCheck } = useEditor();
  const snap = useSnapshot();
  const assistant = useUi((s) => s.assistant);
  const check = useUi((s) => s.check);
  const checkRunning = useUi((s) => s.checkRunning);
  const errors = snap.issues.filter((i) => i.severity === "error").length;
  const checkCount = check ? (check.counts?.errors ?? 0) + (check.counts?.warnings ?? 0) : errors;
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const mod = mac ? "⌘" : "Ctrl+";

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-ink-1 px-2">
      <div className="flex min-w-0 items-center gap-1.5" style={{ width: 268 }}>
        <IconButton label={t("top.projects")} onClick={closeProject}>
          <ChevronLeft size={15} />
        </IconButton>
        <Logo />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{snap.scene?.title || backend.projectTitle()}</div>
          <div className="flex items-center gap-1 truncate text-2xs text-fg-faint" title={backend.location ?? ""}>
            {backend.mode === "cli" ? <HardDrive size={10} /> : <Cloud size={10} />}
            <span className="truncate">{backend.mode === "cli" ? shortPath(backend.location) : t("top.inBrowser")}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        <IconButton label={t("top.undo")} shortcut={`${mod}Z`} disabled={!snap.canUndo} onClick={() => store.undo()}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label={t("top.redo")} shortcut={`${mod}⇧Z`} disabled={!snap.canRedo} onClick={() => store.redo()}>
          <Redo2 size={15} />
        </IconButton>
        <SaveChip />
      </div>

      <Transport />

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" onClick={() => void runCheck()} title={t("top.checkHint")}>
          {checkRunning ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {t("top.check")}
          {checkCount > 0 && <span className={clsx("rounded px-1 text-2xs font-semibold", (check?.counts?.errors ?? errors) > 0 ? "bg-danger/20 text-danger" : "bg-warn/20 text-warn")}>{checkCount}</span>}
        </Button>
        <Button variant="ghost" onClick={() => ui.set({ dialog: "render" })} title={t("top.renderHint")}>
          <Camera size={14} />
          {t("top.render")}
        </Button>
        <Button variant="primary" onClick={() => ui.set({ dialog: "export" })}>
          <Upload size={14} />
          {t("top.export")}
        </Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton label={t("top.assistant")} shortcut="A" active={assistant} onClick={() => ui.set({ assistant: !assistant })}>
          <Bot size={16} />
        </IconButton>
        <IconButton label={t("top.shortcuts")} shortcut="?" onClick={() => ui.set({ dialog: "shortcuts" })}>
          <Keyboard size={15} />
        </IconButton>
        <button type="button" onClick={() => setLang(lang === "en" ? "fr" : "en")} title={t("top.language")} className="h-7 rounded-md px-1.5 text-2xs font-semibold text-fg-muted hover:bg-ink-3 hover:text-fg">
          {lang.toUpperCase()}
        </button>
      </div>
    </header>
  );
}

function shortPath(p: string | null): string {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p;
}

// The Agent3D mark (.github/assets/logo.svg, simplified for small sizes — same
// drawing as index.html's favicon): dark rounded tile, white isometric cube, blue dot.
export function Logo({ size = 20 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2a30" />
          <stop offset="1" stopColor="#0c0c0f" />
        </linearGradient>
        <linearGradient id={`${id}dot`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7aa5ff" />
          <stop offset="1" stopColor="#3d6bff" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#598bff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#598bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${id}bg)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="none" stroke="#ffffff" strokeOpacity="0.12" />
      <circle cx="16" cy="16.6" r="5" fill={`url(#${id}glow)`} />
      <path
        d="M16 8L23.45 12.3L23.45 20.9L16 25.2L8.55 20.9L8.55 12.3ZM12.62 14.65L8.55 12.3M19.38 14.65L23.45 12.3M16 20.5L16 25.2"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16.6" r="2.2" fill={`url(#${id}dot)`} />
    </svg>
  );
}

function SaveChip() {
  const { t } = useI18n();
  const snap = useSnapshot();
  const s = snap.save;
  const label = s.state === "saved" ? t("save.saved") : s.state === "saving" ? t("save.saving") : s.state === "pending" ? t("save.pending") : t("save.error");
  return (
    <div
      className={clsx("ml-1 flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs", s.state === "error" ? "bg-danger/15 text-danger" : "text-fg-faint")}
      title={s.state === "error" ? `${s.message ?? ""}\n${t("save.errorHint")}` : label}
    >
      {s.state === "error" ? <CircleAlert size={11} /> : <span className={clsx("h-1.5 w-1.5 rounded-full", s.state === "saved" ? "bg-agent/70" : "bg-key animate-pulse")} />}
      {label}
    </div>
  );
}

function Transport() {
  const { t } = useI18n();
  const { player } = useEditor();
  const snap = useSnapshot();
  const playing = useSyncExternalStore(
    (cb) => player.onState(cb),
    () => player.playing,
  );
  const [time, setTime] = useState(0);
  const last = useRef(0);
  useEffect(
    () =>
      player.onTime((tt) => {
        if (Math.abs(tt - last.current) > 0.015) {
          last.current = tt;
          setTime(tt);
        }
      }),
    [player],
  );
  const duration = snap.scene?.timeline?.duration || 10;
  return (
    <div className="mx-auto flex min-w-0 max-w-[460px] flex-1 items-center gap-2">
      <IconButton label={playing ? t("top.pause") : t("top.play")} shortcut="Space" onClick={() => player.toggle()} className="text-fg">
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
      </IconButton>
      <div className="w-[86px] shrink-0 text-xs tabular-nums text-fg-muted">
        <span className="text-fg">{time.toFixed(2)}</span>
        <span className="text-fg-faint"> / {duration.toFixed(2)}s</span>
      </div>
      <Scrubber value={time} max={duration} onSeek={(v) => void player.seek(v)} ariaLabel={t("top.scrub")} />
    </div>
  );
}

export function Scrubber({ value, max, onSeek, ariaLabel }: { value: number; max: number; onSeek(v: number): void; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seekAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max);
  };
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(2))}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        seekAt(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && seekAt(e.clientX)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onSeek(Math.max(0, value - (e.shiftKey ? 1 : 0.1)));
        if (e.key === "ArrowRight") onSeek(Math.min(max, value + (e.shiftKey ? 1 : 0.1)));
      }}
      className="group relative h-6 min-w-[80px] flex-1 cursor-pointer"
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink-3" />
      <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent/60" style={{ width: `${pct}%` }} />
      <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-1 bg-fg shadow" style={{ left: `${pct}%` }} />
    </div>
  );
}
