import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng, pngVariance } from "./png";
import { MINIMAL_SCENE, writeFakeDist } from "../testing/fakeRuntime";
import { findBrowser } from "./browser";
import { CliError } from "../output";
import { frameBox, frameTimes, inputCall, isolateScene, parseBg, parseInputScript, projectPath, renderExportImages, renderMedia, renderPoster, renderProject, renderVideo, viewportFor } from "./render";
import { decodeGifInfo } from "./gif";
import { readMp4Boxes } from "./mp4";

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

describe("render --input scripts and paths", () => {
  it("parses, expands hold and sorts events by time", () => {
    expect(parseInputScript([{ t: 1, click: [0, 0] }, { t: 0.5, key: "Space", hold: 0.3 }, { t: 0.2, pointer: [0.5, -0.2] }, { t: 0.5, key: "KeyA", down: false }])).toEqual([
      { t: 0.2, pointer: [0.5, -0.2] },
      { t: 0.5, key: "Space", down: true },
      { t: 0.5, key: "KeyA", down: false },
      { t: 0.8, key: "Space", down: false },
      { t: 1, click: [0, 0] },
    ]);
    expect(() => parseInputScript({})).toThrow(/JSON array/);
    expect(() => parseInputScript([{ t: -1, key: "A" }])).toThrow(/#0/);
    expect(() => parseInputScript([{ t: 1, click: [0] }])).toThrow(/click/);
    expect(() => parseInputScript([{ t: 1 }])).toThrow(/key/);
  });
  it("parses pointer presses, drags and swipes; rejects unknown fields with the valid shapes", () => {
    expect(parseInputScript([{ t: 1, pointerDown: [0, 0] }, { t: 2, pointerUp: true }, { t: 3, pointerUp: [0.5, 0] }, { t: 4, pointer: [0.1, 0.2], down: true }, { t: 5, swipe: "left" }])).toEqual([
      { t: 1, pointerDown: [0, 0] },
      { t: 2, pointerUp: null },
      { t: 3, pointerUp: [0.5, 0] },
      { t: 4, pointer: [0.1, 0.2], down: true },
      { t: 5, swipe: "left" },
    ]);
    const drag = parseInputScript([{ t: 1, drag: { from: [-0.5, 0], to: [0.5, 0], duration: 0.1 } }]);
    expect(drag[0]).toEqual({ t: 1, pointerDown: [-0.5, 0] });
    expect(drag.at(-1)).toEqual({ t: 1.1, pointerUp: [0.5, 0] });
    expect(drag.filter((e) => "pointer" in e)).toHaveLength(3);
    expect(drag.at(-2)).toEqual({ t: 1.1, pointer: [0.5, 0] });
    const err = (raw: unknown) => {
      try {
        parseInputScript(raw);
      } catch (e) {
        return e as CliError;
      }
      throw new Error("no error");
    };
    const unknown = err([{ t: 1, tap: [0, 0] }]);
    expect(unknown.message).toMatch(/needs one of/);
    expect(unknown.hint).toMatch(/swipe/);
    expect(unknown.exitCode).toBe(2);
    expect(err([{ t: 1, click: [0, 0], hold: 1 }]).message).toMatch(/unknown field "hold" for a "click" event/);
    expect(err([{ t: 1, swipe: "diagonal" }]).message).toMatch(/swipe/);
    expect(err([{ t: 1, drag: { from: [0, 0], to: [1, 0], speed: 2 } }]).message).toMatch(/unknown drag field "speed"/);
  });
  it("isolates one object and frames a box from the front", () => {
    const scene = { version: 1, id: "s", title: "S", target: { kind: "banner", aspect: "4:1" }, camera: { type: "perspective", fov: 50, position: [0, 0, 9], target: [0, 0, 0] }, lights: [], scripts: ["scripts/game.js"], ui: { elements: [] }, objects: [{ id: "g", kind: "group", children: [{ id: "fox", kind: "model", src: "a.glb", position: [5, 1, 2], rotation: [0, 90, 0], behaviours: [{ type: "float" }] }] }] } as never;
    const iso = isolateScene(scene, "fox");
    expect(iso.objects).toEqual([{ id: "fox", kind: "model", src: "a.glb", position: [0, 0, 0], rotation: [0, 90, 0], visible: true }]);
    expect(iso.scripts).toBeUndefined();
    expect(iso.ui).toBeUndefined();
    expect(() => isolateScene(scene, "fx")).toThrow(/No object "fx"/);
    const cam = frameBox([-1, 0, -1], [1, 2, 1]);
    expect(cam.target).toEqual([0, 1, 0]);
    expect(cam.position[2]).toBeGreaterThan(cam.position[0]);
    expect(cam.position[1]).toBeGreaterThan(1);
  });
  it("validates --bg", () => {
    expect(parseBg("checker")).toBe("checker");
    expect(parseBg("#fff")).toBe("#fff");
    expect(parseBg("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(parseBg(undefined)).toBeUndefined();
    expect(() => parseBg("url(x)")).toThrow(/--bg/);
  });
  it("maps events to Player.input calls", () => {
    expect(inputCall({ t: 0, swipe: "up" })).toBe('i.swipe?.("up")');
    expect(inputCall({ t: 0, scroll: 0.5 })).toBe("i.scroll?.(0.5)");
    expect(parseInputScript([{ t: 1, scroll: 0.25 }])).toEqual([{ t: 1, scroll: 0.25 }]);
    expect(() => parseInputScript([{ t: 1, scroll: 2 }])).toThrow(/progress/);
    expect(inputCall({ t: 0, pointerDown: [0.5, 0] })).toBe("(i.pointer(0.5, 0), i.down?.(0.5, 0))");
    expect(inputCall({ t: 0, pointerUp: null })).toBe("i.up?.()");
    expect(inputCall({ t: 0, pointer: [0, 0], down: false })).toBe("(i.pointer(0, 0), i.up?.())");
  });
  it("returns project-relative paths when inside the project", () => {
    expect(projectPath("/p/proj", "/p/proj/renders/a.png")).toBe("renders/a.png");
    expect(projectPath("/p/proj", "/tmp/out/a.png")).toBe("/tmp/out/a.png");
  });
});

describe.skipIf(!browser)("headless render (stand-in runtime)", () => {
  it("renders frames + a contact sheet that are not blank", async () => {
    const r = await renderProject({ projectDir: project, count: 4, sheet: true });
    expect(r.frames).toHaveLength(4);
    expect(r.frames[0].path.startsWith("renders/")).toBe(true);
    expect(r.stats).toMatchObject({ triangles: 2 });
    expect(r.inspect?.objects[0].id).toBe("box");
    const png = decodePng(readFileSync(resolve(r.dir, r.frames[1].path)));
    expect([png.width, png.height]).toEqual([1200, 300]);
    expect(pngVariance(png).distinct).toBeGreaterThan(1);
    // Frames differ over time (the square moves).
    expect(readFileSync(resolve(r.dir, r.frames[0].path)).equals(readFileSync(resolve(r.dir, r.frames[2].path)))).toBe(false);
    const sheet = decodePng(readFileSync(resolve(r.dir, r.sheet!)));
    expect(sheet.height).toBeGreaterThan(4 * 300 * (sheet.width / 1216) * 0.9);
    expect(pngVariance(sheet).stddev).toBeGreaterThan(5);
    expect(r.timings.totalMs).toBeGreaterThan(0);
  }, 90_000);

  it("captures the page and renders a poster and a WebM video", async () => {
    const page = await renderProject({ projectDir: project, frames: "1", capture: "page", size: "400x200" });
    expect(decodePng(readFileSync(resolve(page.dir, page.frames[0].path)))).toMatchObject({ width: 400, height: 200 });
    const poster = await renderPoster({ projectDir: project, format: "webp" });
    expect(Buffer.from(poster.bytes).toString("ascii", 8, 12)).toBe("WEBP");
    const video = await renderVideo({ projectDir: project, duration: 1, fps: 10, size: "320x80" });
    expect(video.frames).toBe(10);
    expect(Buffer.from(video.bytes).readUInt32BE(0)).toBe(0x1a45dfa3);
  }, 90_000);

  it("renders supersampled stills, GIF, animated WebP, MP4 and export images", async () => {
    const hq = await renderProject({ projectDir: project, frames: "1", size: "400x100", quality: "high" });
    expect(hq.supersampling).toBe(2);
    expect(decodePng(readFileSync(resolve(hq.dir, hq.frames[0].path)))).toMatchObject({ width: 400, height: 100 });
    const gifPath = join(project, "renders", "a.gif");
    const gif = await renderMedia({ projectDir: project, out: gifPath, duration: 1, fps: 10, size: "160x40" });
    expect(gif.frames).toBe(10);
    expect(decodeGifInfo(readFileSync(gifPath))).toMatchObject({ width: 160, height: 40, frames: 10, loop: true });
    const webp = await renderMedia({ projectDir: project, out: join(project, "renders", "a.webp"), duration: 0.5, fps: 10, size: "160x40", write: false });
    expect(Buffer.from(webp.data).toString("latin1")).toContain("ANMF");
    try {
      const mp4 = await renderMedia({ projectDir: project, out: join(project, "renders", "a.mp4"), duration: 1, fps: 10, size: "320x80", write: false });
      expect(mp4.codec).toMatch(/^avc1/);
      expect(readMp4Boxes(mp4.data).map((x) => x.type)).toEqual(["ftyp", "moov", "mdat"]);
    } catch (e) {
      expect((e as CliError).code).toBe("video-unsupported"); // Chromium builds without H.264
    }
    const images = await renderExportImages({ projectDir: project });
    expect(decodePng(images.og!)).toMatchObject({ width: 1200, height: 630 });
    expect(images.posterSize).toEqual({ width: 1200, height: 300 });
    expect(Buffer.from(images.poster).toString("ascii", 8, 12)).toBe("WEBP");
  }, 120_000);
});
