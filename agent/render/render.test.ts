import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng, pngVariance } from "./png";
import { MINIMAL_SCENE, writeFakeDist } from "../testing/fakeRuntime";
import { findBrowser } from "./browser";
import { frameTimes, renderPoster, renderProject, renderVideo, viewportFor } from "./render";

// The render pipeline (server → Chrome → CDP → page → PNG files) against a
// stand-in runtime. Runs only when a Chromium-family browser is installed.

const browser = findBrowser();
const prevDist = process.env.AGENT3D_DIST;
let project = "";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "agent3d-render-"));
  process.env.AGENT3D_DIST = writeFakeDist(dir);
  project = join(dir, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "scene.json"), JSON.stringify(MINIMAL_SCENE));
});
afterAll(() => {
  if (prevDist === undefined) delete process.env.AGENT3D_DIST;
  else process.env.AGENT3D_DIST = prevDist;
});

describe("viewport and frame times", () => {
  it("derives the viewport from the target aspect or --size", () => {
    expect(viewportFor({ target: { kind: "banner", aspect: "4:1" } })).toEqual({ width: 1200, height: 300, deviceScaleFactor: 1 });
    expect(viewportFor({ target: { kind: "hero", aspect: "16:9" } }, { width: 800, scale: 2 })).toEqual({ width: 800, height: 450, deviceScaleFactor: 2 });
    expect(viewportFor(null, { size: "640x480" })).toMatchObject({ width: 640, height: 480 });
    expect(() => viewportFor(null, { size: "big" })).toThrow(/WIDTHxHEIGHT/);
  });
  it("spreads --count over the timeline and parses --frames", () => {
    expect(frameTimes({ target: { kind: "banner", aspect: "4:1" }, timeline: { duration: 4, loop: true, tracks: [] } }, { count: 4 })).toEqual([0, 1, 2, 3]);
    expect(frameTimes({ target: { kind: "banner", aspect: "4:1" }, timeline: { duration: 3, tracks: [] } }, { count: 4 })).toEqual([0, 1, 2, 3]);
    expect(frameTimes(null, { frames: "0, 1.5,3" })).toEqual([0, 1.5, 3]);
    expect(() => frameTimes(null, { frames: "a" })).toThrow();
  });
});

describe.skipIf(!browser)("headless render (stand-in runtime)", () => {
  it("renders frames + a contact sheet that are not blank", async () => {
    const r = await renderProject({ projectDir: project, count: 4, sheet: true });
    expect(r.frames).toHaveLength(4);
    expect(r.stats).toMatchObject({ triangles: 2 });
    expect(r.inspect?.objects[0].id).toBe("box");
    const png = decodePng(readFileSync(r.frames[1].path));
    expect([png.width, png.height]).toEqual([1200, 300]);
    expect(pngVariance(png).distinct).toBeGreaterThan(1);
    // Frames differ over time (the square moves).
    expect(readFileSync(r.frames[0].path).equals(readFileSync(r.frames[2].path))).toBe(false);
    const sheet = decodePng(readFileSync(r.sheet!));
    expect(sheet.height).toBeGreaterThan(4 * 300 * (sheet.width / 1216) * 0.9);
    expect(pngVariance(sheet).stddev).toBeGreaterThan(5);
    expect(r.timings.totalMs).toBeGreaterThan(0);
  }, 90_000);

  it("captures the page and renders a poster and a WebM video", async () => {
    const page = await renderProject({ projectDir: project, frames: "1", capture: "page", size: "400x200" });
    expect(decodePng(readFileSync(page.frames[0].path))).toMatchObject({ width: 400, height: 200 });
    const poster = await renderPoster({ projectDir: project, format: "webp" });
    expect(Buffer.from(poster.bytes).toString("ascii", 8, 12)).toBe("WEBP");
    const video = await renderVideo({ projectDir: project, duration: 1, fps: 10, size: "320x80" });
    expect(video.frames).toBe(10);
    expect(Buffer.from(video.bytes).readUInt32BE(0)).toBe(0x1a45dfa3);
  }, 90_000);
});
