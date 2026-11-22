import { createContext, useContext, useSyncExternalStore } from "react";
import type { LibraryIndex } from "../../core/library";
import type { PatchOp } from "../../ops/scene";
import type { Backend, ToolInfo } from "../backend/types";
import type { EditorSnapshot, EditorStore } from "./editorStore";
import type { PlayerController } from "./playerController";
import { useStore, type TinyStore } from "./tinyStore";

export type BottomTab = "timeline" | "interactions" | "json" | "check";
export type Device = "desktop" | "tablet" | "phone";
export type GizmoMode = "translate" | "rotate" | "scale";
export type ViewMode = "editor" | "camera";
export interface LightSelection {
  id: string;
  part: "position" | "target";
}

export interface CheckIssue {
  severity: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
  hint?: string;
}
export interface CheckResult {
  ok: boolean;
  counts?: { errors: number; warnings: number; infos: number };
  budget?: { estimatedTriangles?: number; totalKb?: number; budgetKb?: number; runtimeKb?: number; heaviestObjects?: { id: string; triangles: number }[] };
  licences?: { path: string; license: string; author?: string; attribution: string }[];
  issues: CheckIssue[];
  at: number;
}

export interface UiState {
  bottom: BottomTab | null;
  bottomHeight: number;
  assistant: boolean;
  device: Device;
  helpers: boolean;
  interact: boolean;
  // Viewport editing: gizmo mode / space, snapping, editor camera vs scene camera, selected light handle.
  gizmo: GizmoMode;
  space: "local" | "world";
  snap: boolean;
  view: ViewMode;
  lightSel: LightSelection | null;
  dialog: null | "export" | "render" | "shortcuts";
  flash: { ids: string[]; at: number } | null;
  agentPulse: number;
  check: CheckResult | null;
  checkRunning: boolean;
  addTab: string;
}

export interface EditorApi {
  backend: Backend;
  store: EditorStore;
  player: PlayerController;
  ui: TinyStore<UiState>;
  tools: ToolInfo[];
  library: LibraryIndex;
  // Applies ops (local + debounced save); shows a toast when an op fails.
  edit(ops: PatchOp[], opts?: { coalesce?: string; select?: string | null }): void;
  runCheck(): Promise<void>;
  // Re-reads scene.json after a tool changed it (assistant), with the agent highlight.
  reloadScene(opts?: { toast?: boolean }): Promise<void>;
  closeProject(): void;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditor(): EditorApi {
  const v = useContext(EditorContext);
  if (!v) throw new Error("useEditor outside EditorContext");
  return v;
}

export function useSnapshot(): EditorSnapshot {
  const { store } = useEditor();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useUi<U>(select: (s: UiState) => U): U {
  return useStore(useEditor().ui, select);
}
