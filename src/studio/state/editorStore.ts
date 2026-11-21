// The editor's scene state (framework-free, tested): current scene,
// selection, undo/redo stack of scenes, live validation issues and
// persistence. Every edit is a list of PatchOps applied locally right away
// (applyPatchOps, so the viewport updates instantly) and sent to the project
// as one scene_patch after a short debounce; undo/redo and full-document
// edits are sent as scene_apply. External changes (an agent editing
// scene.json in a terminal) come in through `external()` and are undoable.

import { deepEqual } from "../../core/jsonPath";
import type { Issue, SceneDoc } from "../../core/types";
import { validateScene } from "../../core/validate";
import { applyPatchOps, type PatchOp } from "../../ops/scene";
import { findObject } from "../../ops/tree";
import type { MutationResult } from "../backend/types";

export type PersistRequest = { kind: "patch"; ops: PatchOp[] } | { kind: "apply"; scene: SceneDoc };
export type Persist = (req: PersistRequest) => Promise<MutationResult>;

export type SaveState = { state: "saved" | "pending" | "saving" | "error"; message?: string; issues?: Issue[] };
export type ChangeSource = "load" | "edit" | "history" | "external" | "replace";

export interface EditorSnapshot {
  scene: SceneDoc | null;
  selection: string | null;
  issues: Issue[];
  save: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
  source: ChangeSource;
}

export interface EditorStoreOptions {
  debounceMs?: number;
  historyLimit?: number;
  coalesceMs?: number;
  now?: () => number;
  validate?: (scene: SceneDoc) => Issue[];
}

export class EditorStore {
  private snap: EditorSnapshot = { scene: null, selection: null, issues: [], save: { state: "saved" }, canUndo: false, canRedo: false, revision: 0, source: "load" };
  private listeners = new Set<() => void>();
  private past: SceneDoc[] = [];
  private future: SceneDoc[] = [];
  private pendingOps: PatchOp[] = [];
  private needsFull = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private lastCoalesce: { key: string; at: number } | null = null;
  private readonly opts: Required<EditorStoreOptions>;

  constructor(
    private persist: Persist,
    opts: EditorStoreOptions = {},
  ) {
    this.opts = { debounceMs: 300, historyLimit: 100, coalesceMs: 1000, now: () => Date.now(), validate: validateScene, ...opts };
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): EditorSnapshot => this.snap;

  private emit(patch: Partial<EditorSnapshot>): void {
    this.snap = { ...this.snap, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
    this.listeners.forEach((l) => l());
  }

  private setScene(scene: SceneDoc, source: ChangeSource, extra: Partial<EditorSnapshot> = {}): void {
    const sel = this.snap.selection && findObject(scene.objects, this.snap.selection) ? this.snap.selection : null;
    this.emit({ scene, source, selection: sel, issues: this.opts.validate(scene), revision: this.snap.revision + 1, ...extra });
  }

  private pushHistory(prev: SceneDoc): void {
    this.past.push(prev);
    if (this.past.length > this.opts.historyLimit) this.past.shift();
    this.future = [];
  }

  load(scene: SceneDoc): void {
    this.past = [];
    this.future = [];
    this.pendingOps = [];
    this.needsFull = false;
    this.lastCoalesce = null;
    this.setScene(scene, "load", { save: { state: "saved" } });
  }

  select(id: string | null): void {
    if (id === this.snap.selection) return;
    this.emit({ selection: id });
  }

  // Applies ops locally and schedules persistence. Returns an error message
  // when an op can't apply (nothing changes then).
  edit(ops: PatchOp[], opts: { coalesce?: string; select?: string | null } = {}): string | null {
    const cur = this.snap.scene;
    if (!cur || !ops.length) return null;
    let next: SceneDoc;
    try {
      next = applyPatchOps(cur, ops);
    } catch (e) {
      return (e as Error).message;
    }
    const now = this.opts.now();
    const coalesce = opts.coalesce && this.lastCoalesce?.key === opts.coalesce && now - this.lastCoalesce.at < this.opts.coalesceMs;
    if (!coalesce) this.pushHistory(cur);
    this.lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
    this.pendingOps.push(...ops);
    this.setScene(next, "edit", { save: { state: "pending" }, ...(opts.select !== undefined ? { selection: opts.select } : {}) });
    this.schedule();
    return null;
  }

  // Full document replacement (JSON editor): persisted with scene_apply.
  replace(scene: SceneDoc): void {
    const cur = this.snap.scene;
    if (cur && deepEqual(cur, scene)) return;
    if (cur) this.pushHistory(cur);
    this.lastCoalesce = null;
    this.needsFull = true;
    this.pendingOps = [];
    this.setScene(scene, "replace", { save: { state: "pending" } });
    this.schedule(0);
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev || !this.snap.scene) return;
    this.future.push(this.snap.scene);
    this.historyMove(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next || !this.snap.scene) return;
    this.past.push(this.snap.scene);
    this.historyMove(next);
  }

  private historyMove(scene: SceneDoc): void {
    this.lastCoalesce = null;
    this.needsFull = true;
    this.pendingOps = [];
    this.setScene(scene, "history", { save: { state: "pending" } });
    this.schedule(0);
  }

  // scene.json changed on disk (another agent / editor). Local edits not
  // sent yet are replayed on top when they still apply.
  external(scene: SceneDoc): boolean {
    const cur = this.snap.scene;
    if (cur && deepEqual(cur, scene)) return false;
    let next = scene;
    if (this.pendingOps.length && !this.needsFull) {
      try {
        next = applyPatchOps(scene, this.pendingOps);
      } catch {
        this.pendingOps = [];
      }
    } else {
      this.pendingOps = [];
      this.needsFull = false;
    }
    if (cur) this.pushHistory(cur);
    this.lastCoalesce = null;
    this.setScene(next, "external", { save: this.pendingOps.length ? this.snap.save : { state: "saved" } });
    return true;
  }

  private schedule(ms = this.opts.debounceMs): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  get dirty(): boolean {
    return this.needsFull || this.pendingOps.length > 0;
  }

  // Sends pending changes now (serialised: one request at a time).
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chain = this.chain.then(() => this.sendOnce());
    return this.chain;
  }

  private async sendOnce(): Promise<void> {
    const scene = this.snap.scene;
    if (!scene || !this.dirty) return;
    const req: PersistRequest = this.needsFull ? { kind: "apply", scene } : { kind: "patch", ops: this.pendingOps };
    this.pendingOps = [];
    this.needsFull = false;
    this.emit({ save: { state: "saving" } });
    try {
      const r = await this.persist(req);
      if (r.status === "refused") {
        // Keep the local state; the next save sends the whole document.
        this.needsFull = true;
        const errors = (r.issues ?? []).filter((i) => i.severity === "error");
        this.emit({ save: { state: "error", message: errors[0]?.message ?? r.hint, issues: errors } });
      } else if (!this.dirty) this.emit({ save: { state: "saved" } });
      else this.emit({ save: { state: "pending" } });
    } catch (e) {
      this.needsFull = true;
      this.emit({ save: { state: "error", message: (e as Error).message } });
    }
  }
}
