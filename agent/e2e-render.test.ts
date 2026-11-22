import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeBuilt } from "./paths";
import { findBrowser } from "./render/browser";
import { decodePng, pngVariance, type DecodedPng } from "./render/png";
import { cli, ok } from "./testing/cli";

// End to end with the REAL runtime (dist/runtime, `npm run build:runtime`)
// and the installed Chrome: new → render --sheet → non-blank PNGs → export.
// Skipped when either is missing.

const ready = !!findBrowser() && !process.env.AGENT3D_DIST && runtimeBuilt();

describe.skipIf(!ready)("e2e: real runtime in headless Chrome", () => {
  it("renders a new banner project to non-blank frames and exports it", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "agent3d-e2e-")), "banner");
    await ok(["new", dir, "--target", "banner", "--title", "E2E"]);
    const r = await ok(["render", "--project", dir, "--count", "2", "--sheet"]);
    expect(r.frames).toHaveLength(2);
    const png = decodePng(readFileSync(resolve(r.dir, r.frames[0].path)));
    expect([png.width, png.height]).toEqual([1200, 300]);
    const v = pngVariance(png);
    expect(v.distinct).toBeGreaterThan(20);
    expect(v.stddev).toBeGreaterThan(3);
    expect(existsSync(resolve(r.dir, r.sheet))).toBe(true);
    expect(r.stats.triangles).toBeGreaterThan(0);

    const ex = await cli(["export", "--project", dir]);
    expect({ code: ex.code, err: ex.body.error }).toMatchObject({ code: 0 });
    expect(existsSync(ex.body.data.entry)).toBe(true);
    expect(ex.body.data.snippet).toContain("<agent3d-scene");
    // Exporting again over the folder needs --yes.
    expect((await ok(["export", "--project", dir])).needsConfirmation).toBe(true);
  }, 120_000);

  it("doctor's test render passes (renders into its own temp folder)", async () => {
    const r = await cli(["doctor"]);
    const checks = r.body.ok ? r.body.data.checks : (r.body.error as { details: { checks: unknown[] } }).details.checks as { id: string; ok: boolean; optional?: boolean; hint?: string }[];
    expect(checks.find((c: { id: string }) => c.id === "render")).toMatchObject({ ok: true });
  }, 120_000);

  it("render --isolate frames one object; --bg paints under transparent frames", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "agent3d-e2e-")), "iso");
    await ok(["new", dir, "--target", "banner", "--title", "Iso"]);
    const r = await ok(["render", "--project", dir, "--isolate", "title", "--size", "200x200"]);
    expect(r.frames).toHaveLength(1);
    expect(r.isolated).toMatchObject({ id: "title", size: expect.any(Array) });
    expect(r.inspect.objects.map((o: { id: string }) => o.id)).toEqual(["title"]);
    expect(r.inspect.objects[0].inView).toBe("full");
    const bg = await ok(["render", "--project", dir, "--frames", "0", "--size", "200x100", "--bg", "#ff0000", "--isolate", "title"]);
    const png = decodePng(readFileSync(resolve(bg.dir, bg.frames[0].path)));
    expect(png.channels === 4 ? png.pixels[3] : 255).toBe(255);
  }, 120_000);

  it("plays a game headlessly with --input and returns its state", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "agent3d-e2e-")), "game");
    await ok(["new", dir, "--target", "game"]);
    // The starter player walks down (+z) to z=3, then right to x=2: the third coin.
    const input = JSON.stringify([{ t: 0.1, key: "ArrowDown", hold: 0.75 }, { t: 1, key: "ArrowRight", hold: 0.5 }]);
    const idle = await ok(["render", "--project", dir, "--frames", "0,2"]);
    expect(idle.state).toMatchObject({ score: 0 });
    const played = await ok(["render", "--project", dir, "--frames", "2,0", "--input", input]);
    expect(played.frames.map((f: { t: number }) => f.t)).toEqual([0, 2]);
    expect(played.inputs).toBe(4);
    expect(played.state).toMatchObject({ score: 1 });
    // Same path with swipes (the starter keeps the swipe heading; a tap stops).
    const swiped = await ok(["render", "--project", dir, "--frames", "2", "--input", JSON.stringify([{ t: 0.1, swipe: "down" }, { t: 0.85, swipe: "right" }, { t: 1.35, click: [0, 0] }])]);
    expect(swiped.state).toMatchObject({ score: 1 });
    // A drag is a press, pointer moves and a release.
    const dragged = await ok(["render", "--project", dir, "--frames", "1", "--input", JSON.stringify([{ t: 0.2, drag: { from: [-0.5, 0], to: [0.5, 0], duration: 0.3 } }])]);
    expect(dragged.inputs).toBe(11);
    const badInput = await cli(["render", "--project", dir, "--frames", "1", "--input", JSON.stringify([{ t: 0.2, tap: [0, 0] }])]);
    expect(badInput.code).toBe(2);
    expect(badInput.body.error?.hint).toContain("swipe");
  }, 120_000);

  it("keeps the exact background colour with post effects (not tone mapped)", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "agent3d-e2e-")), "bg");
    await ok(["new", dir, "--target", "banner"]);
    const pixel = (png: DecodedPng, x: number, y: number) => {
      const i = (y * png.width + x) * png.channels;
      return [png.pixels[i], png.pixels[i + 1], png.pixels[i + 2]];
    };
    const sample = async (background: unknown, postfx: unknown[] | undefined) => {
      const scene = {
        version: 1,
        id: "bg",
        target: { kind: "banner", aspect: "4:1" },
        camera: { type: "perspective", fov: 35, position: [0, 0, 10], target: [0, 0, 0] },
        environment: { background, lighting: "studio" },
        lights: [{ id: "key", type: "directional", position: [2, 4, 5], intensity: 2 }],
        // A bright emissive box at the left edge (bloom has something to do).
        objects: [{ id: "box", kind: "mesh", geometry: { type: "box" }, position: [-12, 0, 0], material: { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 3 } }],
        ...(postfx ? { postfx } : {}),
      };
      writeFileSync(join(dir, "scene.json"), JSON.stringify(scene));
      const r = await ok(["render", "--project", dir, "--frames", "0"]);
      const png = decodePng(readFileSync(resolve(r.dir, r.frames[0].path)));
      return { centre: pixel(png, png.width / 2, png.height / 2), right: pixel(png, png.width - 300, 40) };
    };
    const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(3));
    const light = [0xf6, 0xee, 0xdd];
    const plain = await sample("#f6eedd", undefined);
    close(plain.centre, light);
    close((await sample("#f6eedd", [{ type: "vignette" }])).centre, light);
    close((await sample("#f6eedd", [{ type: "bloom", strength: 1, threshold: 0.5 }])).right, light);
    // Gradients too: same pixels with and without post effects.
    const grad = { gradient: ["#ffe3ee", "#d9ebff"], angle: 90 };
    const g0 = await sample(grad, undefined);
    const g1 = await sample(grad, [{ type: "bloom", strength: 0.6 }, { type: "vignette" }]);
    close(g1.centre, g0.centre);
  }, 180_000);
});
