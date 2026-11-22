// Start screen: templates gallery, starters per target kind, recent projects.

import clsx from "clsx";
import { Cloud, FolderOpen, HardDrive, Loader2, Plus, Terminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { TargetKind } from "../../core/types";
import { DEFAULT_ASPECT } from "../../core/validate";
import type { TemplateInfo } from "../../ops/templates";
import type { Backend, ProjectRef } from "../backend/types";
import { useI18n, type MessageKey } from "../i18n";
import { Logo } from "./TopBar";

const KIND_GRADIENT: Record<string, string> = {
  banner: "linear-gradient(120deg,#1d2b64,#7c8cff 60%,#f8cdda)",
  hero: "radial-gradient(circle at 30% 40%,#ff7eb3,#7a5cff 45%,#141629 80%)",
  card: "linear-gradient(160deg,#2b2e3a,#545a6e 50%,#e9dccb)",
  square: "conic-gradient(from 210deg at 50% 50%,#38f9ff,#7c8cff,#ff7eb3,#38f9ff)",
  fullscreen: "linear-gradient(180deg,#5aa9e6 0%,#f6d5a8 55%,#4f8a4b 56%,#2d5a2a 100%)",
  inline: "linear-gradient(135deg,#232526,#414345)",
  game: "linear-gradient(135deg,#0f2027,#2c5364 60%,#f2b654)",
};
const STARTER_KINDS: TargetKind[] = ["banner", "hero", "card", "square", "fullscreen", "game"];

function Preview({ src, kind, aspect }: { src: string | null; kind: string; aspect: string }) {
  const [failed, setFailed] = useState(!src);
  const [w, h] = aspect.split(":").map(Number);
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-ink-2">
      {!failed && src ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: KIND_GRADIENT[kind] ?? KIND_GRADIENT.inline }}>
          <div className="rounded-[3px] border border-white/40 bg-white/10 shadow-lg backdrop-blur-sm" style={{ width: w >= h ? "70%" : `${(70 * w) / h / 1.6}%`, aspectRatio: `${w} / ${h}` }} />
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-2xs font-medium text-white/90 backdrop-blur">
        {kind} · {aspect}
      </span>
    </div>
  );
}

export function StartScreen({ backend, onOpened }: { backend: Backend; onOpened(): void }) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [recent, setRecent] = useState<ProjectRef[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    void backend.templates().then(setTemplates);
    void backend.recent().then(setRecent);
  }, [backend]);

  const create = async (key: string, opts: { template?: string; kind?: TargetKind; title: string }) => {
    setBusy(key);
    setError(null);
    try {
      await backend.createProject({ name: opts.title, title: opts.title, template: opts.template, kind: opts.kind });
      onOpened();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const kinds = ["all", ...new Set((templates ?? []).map((tp) => tp.kind))];
  const shown = (templates ?? []).filter((tp) => filter === "all" || tp.kind === filter);
  const canCreate = backend.canCreate();

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1180px] px-8 py-10">
        <header className="mb-10 flex items-end justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo size={34} />
            <div>
              <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Agent3D Studio</h1>
              <p className="mt-0.5 max-w-xl text-sm text-fg-muted">{t("start.tagline")}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-muted">
            {backend.mode === "cli" ? <HardDrive size={12} /> : <Cloud size={12} />}
            {backend.mode === "cli" ? t("start.cliMode", { v: backend.version ?? "" }) : t("start.localMode")}
          </div>
        </header>

        {!canCreate && (
          <div className="mb-8 flex gap-3 rounded-lg border border-line bg-ink-1 p-4">
            <Terminal size={16} className="mt-0.5 shrink-0 text-accent" />
            <div className="text-sm">
              <div className="font-medium">{t("start.noFolderTitle")}</div>
              <div className="mt-1 text-xs text-fg-muted">{t("start.noFolderBody")}</div>
              <pre className="mt-2 rounded bg-ink-0 px-2 py-1.5 font-mono text-2xs text-fg">agent3d new my-banner --template {templates?.[0]?.id ?? "<id>"}{"\n"}agent3d studio --project my-banner</pre>
            </div>
          </div>
        )}
        {error && <div className="mb-6 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

        <div className="grid grid-cols-[1fr_260px] gap-10">
          <div className="min-w-0 space-y-10">
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-base font-semibold">{t("start.starters")}</h2>
                <span className="text-xs text-fg-faint">{t("start.startersHint")}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
                {STARTER_KINDS.map((k) => (
                  <button key={k} type="button" disabled={!canCreate || !!busy} onClick={() => void create(`kind:${k}`, { kind: k, title: t(`start.untitled.${k}` as MessageKey) })} className="group rounded-lg p-1.5 text-left transition-colors hover:bg-ink-2 disabled:opacity-50">
                    <div className="relative">
                      <Preview src={null} kind={k} aspect={DEFAULT_ASPECT[k]} />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-0/80 text-fg">{busy === `kind:${k}` ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}</span>
                      </div>
                    </div>
                    <div className="mt-1.5 text-sm font-medium capitalize">{k}</div>
                    <div className="text-2xs text-fg-faint">{t(`start.kinds.${k}` as MessageKey)}</div>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold">{t("start.templates")}</h2>
                {kinds.length > 2 && (
                  <div className="flex gap-1">
                    {kinds.map((k) => (
                      <button key={k} type="button" onClick={() => setFilter(k)} className={clsx("rounded-md px-2 py-0.5 text-xs capitalize", filter === k ? "bg-ink-3 text-fg" : "text-fg-muted hover:text-fg")}>
                        {k === "all" ? t("start.all") : k}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {templates === null ? (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <Loader2 size={14} className="animate-spin" /> {t("app.loading")}
                </div>
              ) : shown.length ? (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                  {shown.map((tp) => (
                    <button key={tp.id} type="button" disabled={!canCreate || !!busy} onClick={() => void create(tp.id, { template: tp.id, title: tp.title })} className="group rounded-lg p-2 text-left transition-colors hover:bg-ink-2 disabled:opacity-60">
                      <div className="relative">
                        <Preview src={backend.templatePreview(tp.id)} kind={tp.kind} aspect={tp.aspect ?? DEFAULT_ASPECT[tp.kind] ?? "16:9"} />
                        {busy === tp.id && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <Loader2 size={18} className="animate-spin" />
                          </div>
                        )}
                      </div>
                      <div className="mt-2 text-sm font-medium">{tp.title}</div>
                      <div className="line-clamp-2 text-xs text-fg-muted">{tp.description}</div>
                      {!!tp.tags?.length && <div className="mt-1 truncate text-2xs text-fg-faint">{tp.tags.join(", ")}</div>}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-fg-faint">{backend.mode === "cli" ? t("start.noTemplates") : t("start.noTemplatesLocal")}</div>
              )}
            </section>
          </div>

          <aside>
            <h2 className="mb-3 text-base font-semibold">{t("start.recent")}</h2>
            {recent.length ? (
              <ul className="space-y-0.5">
                {recent.map((r) => (
                  <li key={r.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={async () => {
                        if (backend.mode === "cli") {
                          if (r.id === backend.location && backend.hasProject()) onOpened();
                          return;
                        }
                        await backend.open(r.id);
                        onOpened();
                      }}
                      className={clsx("flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-2", backend.mode === "cli" && r.id !== backend.location && "cursor-default opacity-60")}
                      title={backend.mode === "cli" && r.id !== backend.location ? t("start.otherFolder", { dir: r.id }) : r.id}
                    >
                      <FolderOpen size={13} className="shrink-0 text-fg-faint" />
                      <div className="min-w-0">
                        <div className="truncate text-sm">{r.title}</div>
                        <div className="truncate text-2xs text-fg-faint">{backend.mode === "cli" ? r.id : r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ""}</div>
                      </div>
                    </button>
                    {backend.remove && (
                      <button type="button" aria-label={t("start.remove")} title={t("start.remove")} onClick={async () => (await backend.remove!(r.id), setRecent(await backend.recent()))} className="rounded p-1 text-fg-faint opacity-0 hover:text-danger group-hover:opacity-100">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-faint">{t("start.noRecent")}</p>
            )}
            <div className="mt-8 rounded-lg border border-line p-3 text-xs leading-relaxed text-fg-muted">
              <div className="mb-1 font-medium text-fg">{t("start.agentTitle")}</div>
              {t("start.agentBody")}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
