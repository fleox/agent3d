import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import { getAt, mergePatch, parsePath, removeAt, setAt } from "../core/jsonPath";
import type { SceneDoc } from "../core/types";
import { OpsError } from "./context";
import { addObject, getObject, listObjects, moveObject, removeObject, updateObject } from "./objects";
import { createProject, loadProject, saveScene } from "./project";
import { starterScene } from "./starters";
import { walkObjects } from "./tree";
import { TARGET_KINDS } from "../core/validate";
import { applyPatchOps, applyScene, diffScenes, getScene, patchScene, summarizeScene } from "./scene";
import { addTrack, editTimeline, removeTrack, setTimeline } from "./timeline";

async function project(kind: "banner" | "game" = "banner") {
  const fs = new MemoryFs();
  await createProject(fs, { name: "Test Banner", target: { kind } });
  return fs;
}

describe("jsonPath", () => {
  const doc = { objects: [{ id: "a", children: [{ id: "b", position: [0, 1, 2] }] }], lights: [{ id: "key", intensity: 1 }, { type: "x" }] };
  it("parses and resolves ids, indexes and nested children", () => {
    expect(parsePath("objects#b.position[1]")).toEqual([{ key: "objects" }, { ref: "b", tree: true }, { key: "position" }, { index: 1 }]);
    expect(getAt(doc, "objects#b.position[1]")).toBe(1);
    expect(getAt(doc, "lights[1].type")).toBe("x");
    expect(getAt(doc, "lights#key.intensity")).toBe(1);
  });
  it("sets with creation and removes", () => {
    const d = JSON.parse(JSON.stringify(doc));
    setAt(d, "objects#a.material.color", "#fff");
    expect(d.objects[0].material.color).toBe("#fff");
    setAt(d, "camera.position", [0, 0, 5]);
    expect(d.camera.position).toEqual([0, 0, 5]);
    expect(removeAt(d, "objects#b")).toBe(true);
    expect(d.objects[0].children).toEqual([]);
    expect(() => getAt(d, "objects#zz.x")).toThrow(/No element with id "zz"/);
  });
  it("merge patch semantics", () => {
    expect(mergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: null, e: 4 }, f: [1] })).toEqual({ a: 1, b: { d: 3, e: 4 }, f: [1] });
  });
});

describe("project", () => {
  it("creates a valid starter project and refuses to overwrite", async () => {
    const fs = await project();
    const { manifest, scene } = await loadProject(fs);
    expect(manifest.name).toBe("test-banner");
    expect(scene.target).toMatchObject({ kind: "banner", aspect: "4:1" });
    expect(scene.objects.find((o) => o.id === "title")).toMatchObject({ kind: "text", text: "Test Banner" });
    await expect(createProject(fs, { name: "again" })).rejects.toMatchObject({ code: "conflict" });
  });
  it("starter posters show finished entrances (posterTime ≥ appear delay + duration)", () => {
    for (const kind of TARGET_KINDS) {
      const scene = starterScene({ title: "Hello", target: { kind } });
      let end = 0;
      walkObjects(scene.objects, (o) => {
        for (const b of o.behaviours ?? []) if (b.type === "appear") end = Math.max(end, Number(b.delay ?? 0) + Number((b as { duration?: number }).duration ?? 0.8));
      });
      expect(scene.target.posterTime ?? 0, kind).toBeGreaterThanOrEqual(end);
    }
  });
  it("game starter ships a script", async () => {
    const fs = await project("game");
    expect(await fs.exists("scripts/game.js")).toBe(true);
  });
  it("creates from template files", async () => {
    const fs = new MemoryFs();
    const scene = summarizeScene((await loadProject(await project())).scene) && (await loadProject(await project())).scene;
    const r = await createProject(fs, { name: "from-tpl", template: "neon", templateFiles: { "scene.json": JSON.stringify(scene), "template.json": "{}", "scripts/x.js": "export default () => ({})" } });
    expect(r.manifest.template).toBe("neon");
    expect(r.scene.id).toBe("from-tpl");
    expect(await fs.exists("scripts/x.js")).toBe(true);
    expect(await fs.exists("template.json")).toBe(false);
  });
  it("saveScene refuses invalid scenes", async () => {
    const fs = await project();
    const scene = await getScene(fs);
    (scene as unknown as Record<string, unknown>).camera = { type: "perspective" };
    await expect(saveScene(fs, scene)).rejects.toBeInstanceOf(OpsError);
    await expect(saveScene(fs, scene, { allowInvalid: true })).resolves.toBeTruthy();
  });
});

describe("applyScene", () => {
  it("plans, applies, and is idempotent", async () => {
    const fs = await project();
    const scene = await getScene(fs);
    const next: SceneDoc = JSON.parse(JSON.stringify(scene));
    next.objects = next.objects.filter((o) => o.id !== "torus");
    next.objects.push({ id: "cube", kind: "mesh", geometry: { type: "box" } });
    (next.objects.find((o) => o.id === "gem") as { position: number[] }).position = [1, 1, 1];
    next.camera.fov = 40;
    const dry = await applyScene(fs, next, { dryRun: true });
    expect(dry.applied).toBe(false);
    expect(dry.plan.objects).toMatchObject({ added: ["cube"], removed: ["torus"], changed: [{ id: "gem", fields: ["position"] }] });
    expect(dry.plan.sections).toEqual(["camera"]);
    const r1 = await applyScene(fs, next);
    expect(r1.applied).toBe(true);
    const r2 = await applyScene(fs, next);
    expect(r2.plan.empty).toBe(true);
    expect(r2.applied).toBe(false);
  });
  it("refuses a scene with errors without writing", async () => {
    const fs = await project();
    const before = await fs.readText("scene.json");
    const bad = { ...(await getScene(fs)), objects: [{ id: "x", kind: "mesh", geometry: { type: "cube" } }] } as unknown as SceneDoc;
    const r = await applyScene(fs, bad);
    expect(r.applied).toBe(false);
    expect(r.issues.some((i) => i.severity === "error" && i.hint?.includes("box"))).toBe(true);
    expect(await fs.readText("scene.json")).toBe(before);
  });
});

describe("patchScene", () => {
  it("applies every op kind", async () => {
    const fs = await project();
    const r = await patchScene(fs, [
      { op: "set", path: "camera.position", value: [0, 1, 10] },
      { op: "merge", path: "objects#title.material", value: { color: "#ff3366", roughness: null } },
      { op: "addObject", object: { id: "group", kind: "group", children: [{ id: "ball", kind: "mesh", geometry: { type: "sphere" } }] } },
      { op: "addObject", object: { id: "ball2", kind: "mesh", geometry: { type: "sphere" } }, parent: "group", index: 0 },
      { op: "updateObject", id: "ball", set: { position: [1, 0, 0], material: { preset: "chrome" } } },
      { op: "moveObject", id: "gem", parent: "group" },
      { op: "addBehaviour", id: "ball", behaviour: { type: "pulse" } },
      { op: "addBehaviour", id: "key", behaviour: { type: "flicker" } },
      { op: "addTrack", track: { target: "ball.position.y", keys: [[2, 1], [0, 0]] } },
      { op: "removeTrack", target: "title.rotation.y" },
      { op: "removeObject", id: "pill" },
      { op: "remove", path: "postfx" },
      { op: "set", path: "lights[0].intensity", value: 1.2 },
    ]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.applied).toBe(true);
    const s = await getScene(fs);
    expect(s.camera.position).toEqual([0, 1, 10]);
    const title = s.objects.find((o) => o.id === "title") as unknown as { material: Record<string, unknown> };
    expect(title.material.color).toBe("#ff3366");
    expect("roughness" in title.material).toBe(false);
    const group = s.objects.find((o) => o.id === "group")!;
    expect(group.children!.map((c) => c.id)).toEqual(["ball2", "ball", "gem"]);
    expect(group.children![1]).toMatchObject({ position: [1, 0, 0], material: { preset: "chrome" }, behaviours: [{ type: "pulse" }] });
    expect(s.lights[1].behaviours).toEqual([{ type: "flicker" }]);
    expect(s.timeline!.tracks).toEqual([{ target: "ball.position.y", keys: [[0, 0], [2, 1]] }]);
    expect(s.objects.some((o) => o.id === "pill")).toBe(false);
    expect(s.postfx).toBeUndefined();
    expect(s.lights[0].intensity).toBe(1.2);
    expect(r.plan.objects.moved).toEqual([{ id: "gem", from: null, to: "group" }]);
  });

  it("is atomic: a failing op or invalid result writes nothing", async () => {
    const fs = await project();
    const before = await fs.readText("scene.json");
    await expect(patchScene(fs, [{ op: "set", path: "camera.fov", value: 50 }, { op: "updateObject", id: "nope", set: {} }])).rejects.toMatchObject({ code: "invalid" });
    const r = await patchScene(fs, [{ op: "set", path: "objects#title.material.roughness", value: 4 }]);
    expect(r.applied).toBe(false);
    expect(r.issues.find((i) => i.path === "objects#title.material.roughness")?.severity).toBe("error");
    expect(await fs.readText("scene.json")).toBe(before);
  });

  it("is idempotent and reports conflicts and typos", async () => {
    const fs = await project();
    const ops = [{ op: "set" as const, path: "camera.fov", value: 33 }];
    expect((await patchScene(fs, ops)).applied).toBe(true);
    expect((await patchScene(fs, ops)).plan.empty).toBe(true);
    await expect(patchScene(fs, [{ op: "addObject", object: { id: "title", kind: "group" } }])).rejects.toMatchObject({ code: "conflict" });
    await expect(patchScene(fs, [{ op: "sett", path: "x", value: 1 } as never])).rejects.toMatchObject({ hint: expect.stringContaining('"set"') });
    await expect(patchScene(fs, [{ op: "updateObject", id: "titel", set: {} }])).rejects.toMatchObject({ hint: expect.stringContaining('"title"') });
    await expect(patchScene(fs, [{ op: "moveObject", id: "title", parent: "title" }])).rejects.toBeInstanceOf(OpsError);
  });

  it("dry run returns the previewed scene", async () => {
    const fs = await project();
    const r = await patchScene(fs, [{ op: "set", path: "title", value: "New" }], { dryRun: true });
    expect(r.scene.title).toBe("New");
    expect((await getScene(fs)).title).not.toBe("New");
  });

  it("applyPatchOps is pure", () => {
    const s = { objects: [{ id: "a", kind: "group" }] } as unknown as SceneDoc;
    const out = applyPatchOps(s, [{ op: "removeObject", id: "a" }]);
    expect(out.objects).toEqual([]);
    expect(s.objects.length).toBe(1);
  });
});

describe("objects & timeline ops", () => {
  it("wraps patchScene", async () => {
    const fs = await project();
    await addObject(fs, { id: "cube", kind: "mesh", geometry: { type: "box" } });
    await updateObject(fs, "cube", { position: [0, 2, 0] });
    await moveObject(fs, "cube", { parent: "title" });
    expect((await getObject(fs, "cube")).parent).toBe("title");
    expect((await listObjects(fs)).find((o) => o.id === "cube")).toMatchObject({ parent: "title", depth: 1, detail: "box" });
    await removeObject(fs, "cube");
    await expect(getObject(fs, "cube")).rejects.toMatchObject({ code: "notFound" });
  });
  it("edits the timeline", async () => {
    const fs = await project();
    await addTrack(fs, { target: "gem.rotation", keys: [[0, [0, 0, 0]], [12, [0, 360, 0]]] });
    let s = await getScene(fs);
    expect(s.timeline!.duration).toBe(12);
    await removeTrack(fs, "gem.rotation");
    await editTimeline(fs, { settings: { loop: "pingpong" } });
    s = await getScene(fs);
    expect(s.timeline!.loop).toBe("pingpong");
    await setTimeline(fs, null);
    expect((await getScene(fs)).timeline).toBeUndefined();
    expect((await setTimeline(fs, null)).plan.empty).toBe(true);
    await setTimeline(fs, { duration: 2, tracks: [{ target: "camera.fov", keys: [[2, 30], [0, 40]] }] });
    expect((await getScene(fs)).timeline!.tracks[0].keys[0][0]).toBe(0);
  });
});

describe("summary & diff", () => {
  it("summarises compactly", async () => {
    const s = await getScene(await project());
    const sum = summarizeScene(s);
    expect(sum.target).toEqual({ kind: "banner", aspect: "4:1" });
    expect(sum.objects.find((o) => o.id === "title")).toMatchObject({ kind: "text", detail: '"Test Banner"' });
    expect(sum.counts.lights).toBe(3);
    expect(sum.background).toContain("gradient");
  });
  it("diff of identical scenes is empty", async () => {
    const s = await getScene(await project());
    expect(diffScenes(s, JSON.parse(JSON.stringify(s))).empty).toBe(true);
    expect(diffScenes(null, s).objects.added.length).toBeGreaterThan(0);
  });
});
