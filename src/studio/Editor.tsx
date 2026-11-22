// The editor layout + wiring: scene store ↔ backend, external changes (SSE),
// keyboard shortcuts.

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LibraryIndex } from "../core/library";
import type { SceneDoc } from "../core/types";
import { diffScenes } from "../ops/scene";
import type { Backend, MutationResult, ToolInfo } from "./backend/types";
import { Toaster, toast } from "./components/ui/Toast";
import { t } from "./i18n";
import { duplicateObject } from "./lib/patches";
import { urlParam } from "./lib/urlState";
import { AssistantPanel } from "./assistant/AssistantPanel";
import { BottomPanel } from "./panels/BottomPanel";
import { ExportDialog } from "./panels/ExportDialog";
import { RenderDialog } from "./panels/RenderDialog";
import { ShortcutsDialog } from "./panels/ShortcutsDialog";
import { LeftPanel } from "./panels/LeftPanel";
import { TopBar } from "./panels/TopBar";
import { Viewport } from "./panels/Viewport";
import { Inspector } from "./inspector/Inspector";
import { EditorContext, useEditor as useEditorApi, useUi, type BottomTab, type CheckResult, type Device, type EditorApi, type UiState } from "./state/context";
import { EditorStore } from "./state/editorStore";
import { PlayerController } from "./state/playerController";
import { createStore } from "./state/tinyStore";

function initialUi(): UiState {
  const panel = urlParam("panel");
  const dialog = urlParam("dialog");
  const device = urlParam("device");
  return {
    bottom: panel === "timeline" || panel === "json" || panel === "check" ? (panel as BottomTab) : null,
    bottomHeight: 248,
    assistant: urlParam("assistant") === "1",
    device: device === "tablet" || device === "phone" ? (device as Device) : "desktop",
    helpers: true,
    interact: false,
    dialog: dialog === "export" || dialog === "render" || dialog === "shortcuts" ? dialog : null,
    flash: null,
    agentPulse: 0,
    check: null,
    checkRunning: false,
    addTab: urlParam("add") ?? "primitives",
  };
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function Editor({ backend, onClose }: { backend: Backend; onClose(): void }) {
  const [api, setApi] = useState<EditorApi | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const store = new EditorStore((req) => backend.call<MutationResult>(req.kind === "patch" ? "scene_patch" : "scene_apply", req.kind === "patch" ? { ops: req.ops } : { scene: req.scene }));
    const player = new PlayerController();
    const ui = createStore<UiState>(initialUi());
    let reloadRef: (opts?: { toast?: boolean }) => Promise<void> = async () => undefined;
    void (async () => {
      try {
        const [scene, tools, library] = await Promise.all([backend.loadScene(), backend.tools().catch(() => [] as ToolInfo[]), backend.library().catch(() => ({ assets: [] }) as LibraryIndex)]);
        if (cancelled) return;
        store.load(scene);
        const sel = urlParam("select");
        if (sel) store.select(sel);
        const editorApi: EditorApi = {
          backend,
          store,
          player,
          ui,
          tools,
          library,
          edit(ops, opts) {
            const err = store.edit(ops, opts);
            if (err) toast({ tone: "error", title: t("edit.failed"), detail: err });
          },
          async runCheck() {
            ui.set({ checkRunning: true, bottom: "check" });
            try {
              await store.flush();
              const r = await backend.call<Omit<CheckResult, "at">>("check", {});
              ui.set({ check: { ...r, at: Date.now() } });
            } catch (e) {
              toast({ tone: "error", title: t("check.failed"), detail: (e as Error).message });
            } finally {
              ui.set({ checkRunning: false });
            }
          },
          reloadScene: (opts) => reloadRef(opts),
          closeProject() {
            void store.flush().then(onClose);
          },
        };
        setApi(editorApi);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    // Someone else changed the folder (an agent in a terminal): reload and show it.
    const reloadScene = async (opts: { toast?: boolean } = {}) => {
      const scene: SceneDoc = await backend.loadScene();
      const before = store.getSnapshot().scene;
      if (!store.external(scene)) return;
      const plan = diffScenes(before, scene);
      const ids = [...plan.objects.added, ...plan.objects.changed.map((c) => c.id), ...plan.objects.moved.map((m) => m.id)];
      ui.set((s) => ({ flash: { ids, at: Date.now() }, agentPulse: s.agentPulse + 1 }));
      if (opts.toast !== false) toast({ tone: "agent", title: t("external.title"), detail: plan.summary, action: { label: t("external.undo"), run: () => store.undo() } }, 6000);
    };
    reloadRef = reloadScene;
    const off = backend.onChange((paths) => {
      if (paths.includes("scene.json")) {
        void reloadScene().catch(() => undefined);
      } else if (paths.some((p) => p.startsWith("assets/") || p.startsWith("scripts/"))) {
        ui.set((s) => ({ agentPulse: s.agentPulse + 1 }));
        toast({ tone: "agent", title: t("external.files"), detail: paths.slice(0, 4).join(", ") });
      }
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (store.dirty) {
        void store.flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      cancelled = true;
      off();
      window.removeEventListener("beforeunload", beforeUnload);
      void store.flush();
      player.dispose();
    };
  }, [backend, onClose]);

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="text-base font-medium">{t("app.loadFailed")}</div>
        <div className="max-w-md text-sm text-fg-muted">{error}</div>
      </div>
    );
  if (!api)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-fg-muted">
        <Loader2 size={16} className="animate-spin" /> {t("app.loadingScene")}
      </div>
    );
  return (
    <EditorContext.Provider value={api}>
      <Shell />
    </EditorContext.Provider>
  );
}

function Shell() {
  const assistant = useUi((s) => s.assistant);
  const dialog = useUi((s) => s.dialog);
  useShortcuts();
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Viewport />
          <BottomPanel />
          <Toaster />
        </div>
        <Inspector />
        {assistant && <AssistantPanel />}
      </div>
      {dialog === "export" && <ExportDialog />}
      {dialog === "render" && <RenderDialog />}
      {dialog === "shortcuts" && <ShortcutsDialog />}
    </div>
  );
}

function useShortcutsImpl(api: EditorApi) {
  return useMemo(
    () => (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const { store, ui, player } = api;
      if (mod && e.key.toLowerCase() === "z") {
        if (isTyping(e)) return;
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        if (isTyping(e)) return;
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void store.flush();
        return;
      }
      if (isTyping(e)) return;
      const snap = store.getSnapshot();
      const sel = snap.selection;
      if (mod && e.key.toLowerCase() === "d" && sel && snap.scene) {
        e.preventDefault();
        const d = duplicateObject(snap.scene, sel);
        if (d) api.edit(d.ops, { select: d.newId });
        return;
      }
      if (mod) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          player.toggle();
          ui.set({});
          break;
        case "Escape":
          store.select(null);
          break;
        case "Delete":
        case "Backspace":
          if (sel) {
            e.preventDefault();
            api.edit([{ op: "removeObject", id: sel }]);
          }
          break;
        case "h":
          if (sel && snap.scene) {
            const o = snap.scene.objects && findVisible(snap.scene, sel);
            api.edit(o === false ? [{ op: "remove", path: `objects#${sel}.visible` }] : [{ op: "set", path: `objects#${sel}.visible`, value: false }]);
          }
          break;
        case "t":
          ui.set((s) => ({ bottom: s.bottom === "timeline" ? null : "timeline" }));
          break;
        case "j":
          ui.set((s) => ({ bottom: s.bottom === "json" ? null : "json" }));
          break;
        case "a":
          ui.set((s) => ({ assistant: !s.assistant }));
          break;
        case "i":
          ui.set((s) => ({ interact: !s.interact }));
          break;
        case "?":
          ui.set({ dialog: "shortcuts" });
          break;
      }
    },
    [api],
  );
}

function findVisible(scene: SceneDoc, id: string): boolean {
  let v = true;
  const walk = (list: SceneDoc["objects"]) => {
    for (const o of list) {
      if (o.id === id) v = o.visible !== false;
      if (o.children) walk(o.children);
    }
  };
  walk(scene.objects);
  return v;
}

function useShortcuts() {
  const api = useEditorApi();
  const handler = useShortcutsImpl(api);
  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}

