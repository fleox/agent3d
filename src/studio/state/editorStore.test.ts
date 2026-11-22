import { describe, expect, it, vi } from "vitest";
import { defaultScene } from "../../core/validate";
import type { SceneDoc } from "../../core/types";
import { EditorStore, type PersistRequest } from "./editorStore";
import type { MutationResult } from "../backend/types";

const ok: MutationResult = { status: "applied", applied: true };

function setup(result: MutationResult = ok) {
  const calls: PersistRequest[] = [];
  let t = 0;
  const store = new EditorStore(
    async (req) => {
      calls.push(JSON.parse(JSON.stringify(req)));
      return result;
    },
    { debounceMs: 10_000, now: () => t },
  );
  const scene: SceneDoc = { ...defaultScene(), objects: [{ id: "box", kind: "mesh", geometry: { type: "box" } }] };
  store.load(scene);
  return { store, calls, scene, tick: (ms: number) => (t += ms) };
}

describe("EditorStore", () => {
  it("applies edits locally and batches them into one scene_patch", async () => {
    const { store, calls } = setup();
    store.edit([{ op: "set", path: "objects#box.position", value: [1, 0, 0] }]);
    store.edit([{ op: "set", path: "objects#box.material.color", value: "#ff0000" }]);
    const s = store.getSnapshot();
    expect(s.scene!.objects[0].position).toEqual([1, 0, 0]);
    expect(s.save.state).toBe("pending");
    await store.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "patch", ops: [{ path: "objects#box.position" }, { path: "objects#box.material.color" }] });
    expect(store.getSnapshot().save.state).toBe("saved");
  });

  it("undo / redo restore whole scenes and persist with scene_apply", async () => {
    const { store, calls } = setup();
    store.edit([{ op: "set", path: "title", value: "A" }]);
    store.edit([{ op: "set", path: "title", value: "B" }]);
    await store.flush();
    store.undo();
    expect(store.getSnapshot().scene!.title).toBe("A");
    expect(store.getSnapshot().canRedo).toBe(true);
    await store.flush();
    expect(calls.at(-1)).toMatchObject({ kind: "apply", scene: { title: "A" } });
    store.redo();
    expect(store.getSnapshot().scene!.title).toBe("B");
    store.undo();
    store.undo();
    expect(store.getSnapshot().scene!.title).toBe("Untitled scene");
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("coalesces rapid edits with the same key into one undo step", () => {
    const { store, tick } = setup();
    for (let i = 1; i <= 5; i++) {
      store.edit([{ op: "set", path: "objects#box.position[0]", value: i }], { coalesce: "drag:box.position" });
      tick(50);
    }
    expect(store.getSnapshot().scene!.objects[0].position?.[0]).toBe(5);
    store.undo();
    expect(store.getSnapshot().scene!.objects[0].position).toBeUndefined();
    tick(5000);
  });

  it("reports an op that can't apply and changes nothing", () => {
    const { store } = setup();
    const err = store.edit([{ op: "updateObject", id: "nope", set: { visible: false } }]);
    expect(err).toMatch(/nope/);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("marks refused saves as errors and resends the full scene next time", async () => {
    const { store, calls } = setup({ status: "refused", applied: false, issues: [{ severity: "error", code: "x", path: "objects#box", message: "Bad box" }] });
    store.edit([{ op: "set", path: "objects#box.geometry.width", value: -1 }]);
    await store.flush();
    expect(store.getSnapshot().save).toMatchObject({ state: "error", message: "Bad box" });
    store.edit([{ op: "set", path: "title", value: "x" }]);
    await store.flush();
    expect(calls.at(-1)!.kind).toBe("apply");
  });

  it("takes external changes (undoable) and replays unsent local edits on top", () => {
    const { store, scene } = setup();
    store.edit([{ op: "set", path: "objects#box.position", value: [2, 0, 0] }]);
    const fromAgent = { ...scene, title: "Agent title" };
    expect(store.external(fromAgent)).toBe(true);
    const s = store.getSnapshot();
    expect(s.source).toBe("external");
    expect(s.scene!.title).toBe("Agent title");
    expect(s.scene!.objects[0].position).toEqual([2, 0, 0]);
    expect(store.external(s.scene!)).toBe(false);
    store.undo();
    expect(store.getSnapshot().scene!.title).toBe("Untitled scene");
  });

  it("keeps the selection only while the object exists", () => {
    const { store } = setup();
    store.select("box");
    store.edit([{ op: "removeObject", id: "box" }]);
    expect(store.getSnapshot().selection).toBeNull();
  });

  it("debounces persistence", async () => {
    vi.useFakeTimers();
    const calls: PersistRequest[] = [];
    const store = new EditorStore(async (r) => (calls.push(r), ok), { debounceMs: 300 });
    store.load(defaultScene());
    store.edit([{ op: "set", path: "title", value: "1" }]);
    vi.advanceTimersByTime(200);
    store.edit([{ op: "set", path: "title", value: "2" }]);
    vi.advanceTimersByTime(200);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(calls).toHaveLength(1);
    vi.useRealTimers();
  });

  it("validates live", () => {
    const { store } = setup();
    store.edit([{ op: "set", path: "objects#box.geometry.type", value: "boxx" }]);
    expect(store.getSnapshot().issues.some((i) => i.severity === "error")).toBe(true);
  });
});

describe("EditorStore op compaction", () => {
  it("keeps only the last set on the same path while dragging", async () => {
    const { store, calls } = setup();
    for (let i = 0; i < 20; i++) store.edit([{ op: "set", path: "objects#box.position", value: [i, 0, 0] }], { coalesce: "drag" });
    await store.flush();
    expect(calls[0]).toMatchObject({ kind: "patch", ops: [{ op: "set", value: [19, 0, 0] }] });
    expect((calls[0] as { ops: unknown[] }).ops).toHaveLength(1);
  });
});
