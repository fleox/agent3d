import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ObjectDef, SceneDoc } from "../../src/core/types";
import { closest } from "../../src/core/suggest";
import { findObject, walkObjects } from "../../src/ops/tree";
import type { FrameStats, InspectResult, RuntimeIssue } from "../../src/runtime/api";
import { CliError } from "../output";
import { libraryDir, runtimeBuilt, runtimeDir } from "../paths";
import { launchBrowser, requireBrowser, type BrowserInfo, type LaunchedBrowser } from "./browser";
import { CdpClient, type CdpSession } from "./cdp";
import { previewHtml } from "./preview";
import { sendText, startLocalServer, type LocalServer } from "./server";
import { muxWebm, webpToVp8 } from "./webm";

// Headless render pipeline: local server → installed Chrome (headless,
// SwiftShader WebGL) → CDP → preview page (deterministic player) → PNGs.
// Chrome and its temp profile are always cleaned up, on errors and
// timeouts too.

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export function parseAspect(aspect: string | undefined): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/.exec(aspect ?? "");
  if (!m) return 16 / 9;
  const r = Number(m[1]) / Number(m[2]);
  return Number.isFinite(r) && r > 0 ? r : 16 / 9;
}

export function viewportFor(scene: Pick<SceneDoc, "target"> | null, opts: { size?: string; width?: number; scale?: number } = {}): Viewport {
  const deviceScaleFactor = opts.scale ?? 1;
  if (opts.size) {
    const m = /^(\d+)\s*x\s*(\d+)$/i.exec(opts.size.trim());
    if (!m) throw new CliError("usage", `--size must be WIDTHxHEIGHT (e.g. 1200x300), got "${opts.size}".`, undefined, 2);
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (width < 16 || height < 16 || width > 4096 || height > 4096) throw new CliError("usage", "--size must be between 16 and 4096 pixels per side.", undefined, 2);
    return { width, height, deviceScaleFactor };
  }
  const width = Math.round(opts.width ?? 1200);
  const fixed = /^(\d+)px$/.exec(scene?.target?.height ?? "");
  const height = fixed ? Number(fixed[1]) : Math.max(16, Math.round(width / parseAspect(scene?.target?.aspect)));
  return { width, height, deviceScaleFactor };
}

// --frames "0,1.5,3" or --count n (spread over the timeline duration).
export function frameTimes(scene: Pick<SceneDoc, "timeline" | "target"> | null, opts: { frames?: string; count?: number }): number[] {
  if (opts.frames) {
    const ts = opts.frames.split(",").map((s) => Number(s.trim()));
    if (!ts.length || ts.some((t) => !Number.isFinite(t) || t < 0)) throw new CliError("usage", `--frames must be comma-separated times in seconds (e.g. 0,1.5,3), got "${opts.frames}".`, undefined, 2);
    return ts;
  }
  const count = Math.max(1, Math.min(64, Math.round(opts.count ?? 4)));
  if (count === 1) return [scene?.target?.posterTime ?? 0];
  const duration = scene?.timeline?.duration && scene.timeline.duration > 0 ? scene.timeline.duration : 4;
  const loop = scene?.timeline ? !!scene.timeline.loop : true;
  const step = loop ? duration / count : duration / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(i * step * 1000) / 1000);
}

// ─── Simulated input (games) ────────────────────────────────────────────
// `render --input` script: events applied during deterministic seeking, in
// time order. Coordinates are normalised canvas coordinates (-1..1, y up),
// like Player.input.
//   { "t": 0.5, "key": "ArrowRight", "down": true }     key down (down: false = key up)
//   { "t": 0.5, "key": "Space", "hold": 0.3 }            down at t, up at t + hold
//   { "t": 1, "click": [0, 0] }                          click (pointer press + release) at a point
//   { "t": 1, "pointer": [0.5, -0.2] }                   move the pointer (+ "down": true / false = press / release there)
//   { "t": 1, "pointerDown": [0, 0] }                    press the pointer (held until pointerUp)
//   { "t": 2, "pointerUp": [0.4, 0] }                    release it (or "pointerUp": true where it is)
//   { "t": 1, "drag": { "from": [-0.5, 0], "to": [0.5, 0], "duration": 0.4 } }   press, move (30 steps/s), release
//   { "t": 1, "swipe": "left" }                          a swipe gesture: "left" | "right" | "up" | "down"

export type Point = [number, number];
export type SwipeDirection = "left" | "right" | "up" | "down";
export type InputEvent =
  | { t: number; key: string; down: boolean }
  | { t: number; click: Point }
  | { t: number; pointer: Point; down?: boolean }
  | { t: number; pointerDown: Point }
  | { t: number; pointerUp: Point | null }
  | { t: number; swipe: SwipeDirection };

const pair = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const SWIPES: SwipeDirection[] = ["left", "right", "up", "down"];

export const INPUT_SHAPES =
  'Events: {"t": 0.5, "key": "ArrowRight", "down": true} | {"t": 0.5, "key": "Space", "hold": 0.3} | {"t": 1, "click": [0, 0]} | {"t": 1, "pointer": [0.5, -0.2], "down"?: true} | {"t": 1, "pointerDown": [0, 0]} | {"t": 2, "pointerUp": [0.4, 0]} | {"t": 1, "drag": {"from": [-0.5, 0], "to": [0.5, 0], "duration": 0.4}} | {"t": 1, "swipe": "left"|"right"|"up"|"down"} (coordinates -1..1, y up; key = KeyboardEvent.code).';

// Allowed fields per event kind (anything else is a usage error).
const FIELDS: Record<string, string[]> = {
  key: ["t", "key", "down", "hold"],
  click: ["t", "click"],
  pointer: ["t", "pointer", "down"],
  pointerDown: ["t", "pointerDown"],
  pointerUp: ["t", "pointerUp"],
  drag: ["t", "drag"],
  swipe: ["t", "swipe"],
};

export function parseInputScript(raw: unknown): InputEvent[] {
  const bad = (i: number, why: string) => new CliError("usage", `--input event #${i}: ${why}.`, INPUT_SHAPES, 2);
  if (!Array.isArray(raw)) throw new CliError("usage", "--input must be a JSON array of events.", `e.g. --input '[{"t": 0.5, "key": "ArrowRight", "hold": 1}]' or --input @inputs.json. ${INPUT_SHAPES}`, 2);
  const out: InputEvent[] = [];
  raw.forEach((e, i) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw bad(i, "not an object");
    const ev = e as Record<string, unknown>;
    const t = ev.t;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) throw bad(i, '"t" must be a time in seconds ≥ 0');
    const kind = Object.keys(FIELDS).find((k) => k in ev);
    if (!kind) throw bad(i, `needs one of ${Object.keys(FIELDS).map((k) => `"${k}"`).join(", ")}`);
    const extra = Object.keys(ev).filter((k) => !FIELDS[kind].includes(k));
    if (extra.length) throw bad(i, `unknown field${extra.length > 1 ? "s" : ""} ${extra.map((k) => `"${k}"`).join(", ")} for a "${kind}" event (allowed: ${FIELDS[kind].join(", ")})`);
    if (kind === "key") {
      if (typeof ev.key !== "string" || !ev.key) throw bad(i, '"key" must be a KeyboardEvent.code, e.g. "ArrowLeft", "Space", "KeyA"');
      if (ev.hold !== undefined) {
        if (typeof ev.hold !== "number" || !(ev.hold > 0)) throw bad(i, '"hold" must be a duration in seconds > 0');
        out.push({ t, key: ev.key, down: true }, { t: t + ev.hold, key: ev.key, down: false });
      } else out.push({ t, key: ev.key, down: ev.down !== false });
    } else if (kind === "click") {
      if (!pair(ev.click)) throw bad(i, '"click" must be [x, y] in -1..1');
      out.push({ t, click: ev.click });
    } else if (kind === "pointer") {
      if (!pair(ev.pointer)) throw bad(i, '"pointer" must be [x, y] in -1..1');
      if (ev.down !== undefined && typeof ev.down !== "boolean") throw bad(i, '"down" must be true (press) or false (release)');
      out.push(ev.down === undefined ? { t, pointer: ev.pointer } : { t, pointer: ev.pointer, down: ev.down as boolean });
    } else if (kind === "pointerDown") {
      if (!pair(ev.pointerDown)) throw bad(i, '"pointerDown" must be [x, y] in -1..1');
      out.push({ t, pointerDown: ev.pointerDown });
    } else if (kind === "pointerUp") {
      if (ev.pointerUp !== true && !pair(ev.pointerUp)) throw bad(i, '"pointerUp" must be [x, y] in -1..1 (or true: where the pointer is)');
      out.push({ t, pointerUp: ev.pointerUp === true ? null : (ev.pointerUp as Point) });
    } else if (kind === "drag") {
      const d = ev.drag as Record<string, unknown> | null;
      if (!d || typeof d !== "object" || !pair(d.from) || !pair(d.to)) throw bad(i, '"drag" must be {"from": [x, y], "to": [x, y], "duration"?: seconds}');
      const unknown = Object.keys(d).filter((k) => !["from", "to", "duration"].includes(k));
      if (unknown.length) throw bad(i, `unknown drag field${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")} (allowed: from, to, duration)`);
      const duration = d.duration === undefined ? 0.3 : d.duration;
      if (typeof duration !== "number" || !(duration > 0) || duration > 30) throw bad(i, '"drag.duration" must be seconds in (0, 30]');
      const [from, to] = [d.from, d.to];
      const steps = Math.max(1, Math.round(duration * 30));
      out.push({ t, pointerDown: from });
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        out.push({ t: Math.round((t + duration * f) * 1e6) / 1e6, pointer: [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f] });
      }
      out.push({ t: Math.round((t + duration) * 1e6) / 1e6, pointerUp: to });
    } else {
      if (typeof ev.swipe !== "string" || !SWIPES.includes(ev.swipe as SwipeDirection)) throw bad(i, '"swipe" must be "left", "right", "up" or "down"');
      out.push({ t, swipe: ev.swipe as SwipeDirection });
    }
  });
  // Stable sort by time (same-time events keep their order).
  return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
}

// Player.input call(s) for one event.
export function inputCall(ev: InputEvent): string {
  const p = (pt: Point) => `${pt[0]}, ${pt[1]}`;
  if ("key" in ev) return `i.key(${JSON.stringify(ev.key)}, ${ev.down})`;
  if ("click" in ev) return `i.click(${p(ev.click)})`;
  if ("pointerDown" in ev) return `(i.pointer(${p(ev.pointerDown)}), i.down?.(${p(ev.pointerDown)}))`;
  if ("pointerUp" in ev) return ev.pointerUp ? `(i.pointer(${p(ev.pointerUp)}), i.up?.(${p(ev.pointerUp)}))` : "i.up?.()";
  if ("swipe" in ev) return `i.swipe?.(${JSON.stringify(ev.swipe)})`;
  return ev.down === undefined ? `i.pointer(${p(ev.pointer)})` : `(i.pointer(${p(ev.pointer)}), ${ev.down ? "i.down?.()" : "i.up?.()"})`;
}

// A project path relative to the project folder when inside it, else absolute.
export function projectPath(projectDir: string, abs: string): string {
  const rel = relative(resolve(projectDir), abs);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split("\\").join("/") : abs;
}

export interface PageInfo {
  stats: FrameStats | null;
  inspect: InspectResult | null;
  issues: RuntimeIssue[];
  state: Record<string, unknown> | null;
}

export interface RenderSession {
  browser: BrowserInfo;
  viewport: Viewport;
  page: CdpSession;
  consoleErrors: string[];
  timings: { launchMs: number; readyMs: number };
  // seek(t) + snapshot of the WebGL canvas.
  frame(t: number, type?: "image/png" | "image/webp", quality?: number): Promise<Uint8Array>;
  // seek(t) + screenshot of the whole page (includes the HUD / DOM overlays).
  screenshot(t: number, format?: "png" | "webp", quality?: number): Promise<Uint8Array>;
  sheet(frames: Uint8Array[], labels: string[], cols?: number, bg?: string): Promise<Uint8Array>;
  // A frame drawn over a background ("checker" or a CSS colour).
  composite(png: Uint8Array, bg: string): Promise<Uint8Array>;
  // Replace the mounted scene (player.update).
  update(scene: SceneDoc): Promise<void>;
  // A PNG scaled down to maxWidth CSS pixels (unchanged when narrower).
  scale(png: Uint8Array, maxWidth: number): Promise<Uint8Array>;
  // seek(t) without capturing (to apply input events in between).
  seek(t: number): Promise<void>;
  input(ev: InputEvent): Promise<void>;
  info(): Promise<PageInfo>;
  close(): Promise<void>;
}

export interface OpenOptions {
  projectDir: string;
  scene?: SceneDoc; // default: <projectDir>/scene.json
  viewport: Viewport;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

function dataUrlBytes(url: unknown, what: string): Uint8Array {
  if (typeof url !== "string" || !url.startsWith("data:")) throw new CliError("render-failed", `The page returned no image for ${what}.`, "The runtime's snapshot() failed — see consoleErrors; `agent3d doctor` runs a test render.");
  const comma = url.indexOf(",");
  return new Uint8Array(Buffer.from(url.slice(comma + 1), "base64"));
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function readScene(projectDir: string): SceneDoc {
  try {
    return JSON.parse(readFileSync(join(projectDir, "scene.json"), "utf8")) as SceneDoc;
  } catch (e) {
    throw new CliError("no-project", `Cannot read ${join(projectDir, "scene.json")}: ${(e as Error).message}`, "Pass --project <dir> (a folder with scene.json), or create one with `agent3d new <dir>`.");
  }
}

export async function openRenderSession(opts: OpenOptions): Promise<RenderSession> {
  if (!runtimeBuilt())
    throw new CliError("runtime-missing", `The runtime build is missing (${join(runtimeDir(), "agent3d-runtime.js")}).`, "Use the npm package (it ships dist/runtime), or run `npm run build:runtime` in a clone. AGENT3D_DIST can point at another dist/ folder.");
  const browserInfo = requireBrowser();
  const scene = opts.scene ?? readScene(opts.projectDir);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const log = opts.log ?? (() => undefined);
  const t0 = Date.now();
  const html = previewHtml({ pixelRatio: opts.viewport.deviceScaleFactor, transparent: !!scene.target?.transparent });
  let server: LocalServer | null = null;
  let browser: LaunchedBrowser | null = null;
  let client: CdpClient | null = null;
  const cleanup = async () => {
    try {
      client?.close();
    } catch {
      /* ignore */
    }
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  };
  try {
    server = await startLocalServer({
      mounts: { "/__runtime/": runtimeDir(), "/__library/": libraryDir(), "/project/": resolve(opts.projectDir) },
      routes: [
        (_req, res, url) => {
          if (url.pathname === "/__preview.html") return sendText(res, 200, html, "text/html; charset=utf-8"), true;
          if (url.pathname === "/__scene.json") return sendText(res, 200, JSON.stringify(scene), "application/json; charset=utf-8"), true;
          return false;
        },
      ],
    });
    log(`[agent3d render] ${browserInfo.name}: ${browserInfo.path}`);
    browser = await launchBrowser(browserInfo);
    client = await CdpClient.connect(browser.wsUrl);
    const page = await client.newPage();
    const launchMs = Date.now() - t0;
    const consoleErrors: string[] = [];
    const pushErr = (s: string) => {
      if (consoleErrors.length < 50) consoleErrors.push(s.slice(0, 2000));
    };
    page.on("Runtime.consoleAPICalled", (p) => {
      if (p.type !== "error" && p.type !== "assert") return;
      const args = (p.args as { value?: unknown; description?: string }[] | undefined) ?? [];
      pushErr(args.map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? ""))).join(" "));
    });
    page.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
      pushErr(d?.exception?.description ?? d?.text ?? "Uncaught exception");
    });
    page.on("Log.entryAdded", (p) => {
      const e = p.entry as { level?: string; text?: string; url?: string } | undefined;
      if (e?.level === "error") pushErr(`${e.text ?? ""}${e.url ? ` (${e.url})` : ""}`);
    });
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    await page.send("Log.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: opts.viewport.width, height: opts.viewport.height, deviceScaleFactor: opts.viewport.deviceScaleFactor, mobile: false });
    if (scene.target?.transparent) await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await page.send("Page.navigate", { url: `${server.url}/__preview.html` });

    // Wait until the player is ready (or failed).
    const deadline = Date.now() + timeoutMs;
    type MountState = { ready: boolean; error: string | null; webgl: boolean; issues: RuntimeIssue[] } | null;
    let state = null as MountState;
    for (;;) {
      state = await page
        .evaluate<MountState>("window.__agent3d ? { ready: window.__agent3d.ready, error: window.__agent3d.error, webgl: window.__agent3d.webgl, issues: window.__agent3d.issues } : null", 10_000)
        .catch(() => null);
      if (state?.ready || state?.error) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!state?.ready) {
      const webglIssue = state?.issues?.find((i) => i.code === "webgl-unavailable");
      if (state && (!state.webgl || webglIssue))
        throw new CliError(
          "webgl-unavailable",
          `WebGL is not available in headless ${browserInfo.name}${webglIssue ? `: ${webglIssue.message}` : ""}.`,
          "The render uses SwiftShader (software WebGL): update the browser, or point AGENT3D_CHROME at Google Chrome / Chromium (`npx playwright install chromium`). `agent3d doctor` tests it.",
          1,
          { consoleErrors, issues: state?.issues ?? [] },
        );
      if (state?.error)
        throw new CliError(
          "render-failed",
          `The scene failed to mount: ${state.error.split("\n")[0]}`,
          /import|module|Failed to fetch/i.test(state.error) ? "The runtime could not be loaded: rebuild it (`npm run build:runtime`) or check AGENT3D_DIST." : "Run `agent3d scene validate` and `agent3d check`, fix the reported issues, then render again.",
          1,
          { error: state.error, consoleErrors, issues: state.issues },
        );
      throw new CliError(
        "render-timeout",
        `The scene was not ready after ${Math.round(timeoutMs / 1000)} s.`,
        "Something is still loading (large models / textures?) or a script never resolves. See details.consoleErrors / issues; raise --timeout <s>, or simplify the scene.",
        1,
        { consoleErrors, issues: state?.issues ?? [] },
      );
    }
    const readyMs = Date.now() - t0 - launchMs;
    log(`[agent3d render] ready in ${readyMs} ms`);
    const session: RenderSession = {
      browser: browserInfo,
      viewport: opts.viewport,
      page,
      consoleErrors,
      timings: { launchMs, readyMs },
      async frame(t, type = "image/png", quality) {
        return dataUrlBytes(await page.evaluate(`window.__agent3dFrame(${JSON.stringify(t)}, ${JSON.stringify(type)}, ${quality === undefined ? "undefined" : JSON.stringify(quality)})`, timeoutMs), `t=${t}`);
      },
      async screenshot(t, format = "png", quality) {
        await page.evaluate(`window.__agent3d.player.seek(${JSON.stringify(t)}).then(() => new Promise((r) => requestAnimationFrame(() => r(true))))`, timeoutMs);
        const r = await page.send<{ data: string }>("Page.captureScreenshot", { format, ...(quality !== undefined && format !== "png" ? { quality: Math.round(quality * 100) } : {}), fromSurface: true, captureBeyondViewport: false }, timeoutMs);
        return new Uint8Array(Buffer.from(r.data, "base64"));
      },
      async sheet(frames, labels, cols, bg) {
        const urls = frames.map((f) => `data:image/png;base64,${b64(f)}`);
        const r = await page.send<{ result: { value?: unknown }; exceptionDetails?: unknown }>(
          "Runtime.callFunctionOn",
          {
            functionDeclaration: "function (u, l, c, b) { return window.__agent3dSheet(u, l, c, b); }",
            executionContextId: undefined,
            objectId: await globalObjectId(page),
            arguments: [{ value: urls }, { value: labels }, { value: cols ?? 0 }, { value: bg ?? null }],
            awaitPromise: true,
            returnByValue: true,
          },
          timeoutMs,
        );
        if (r.exceptionDetails) throw new CliError("render-failed", "Could not compose the contact sheet.", "Render without --sheet, or with fewer frames.");
        return dataUrlBytes(r.result.value, "the contact sheet");
      },
      async composite(png, bg) {
        const r = await page.send<{ result: { value?: unknown }; exceptionDetails?: unknown }>(
          "Runtime.callFunctionOn",
          { functionDeclaration: "function (u, b) { return window.__agent3dComposite(u, b); }", objectId: await globalObjectId(page), arguments: [{ value: `data:image/png;base64,${b64(png)}` }, { value: bg }], awaitPromise: true, returnByValue: true },
          timeoutMs,
        );
        if (r.exceptionDetails) throw new CliError("render-failed", "Could not draw the frame over the background.", "Render without --bg.");
        return dataUrlBytes(r.result.value, "the composited frame");
      },
      async update(next) {
        await page.evaluate(`window.__agent3d.player.update(${JSON.stringify(next)}).then(() => true)`, timeoutMs);
      },
      async scale(png, maxWidth) {
        const r = await page.send<{ result: { value?: unknown }; exceptionDetails?: unknown }>(
          "Runtime.callFunctionOn",
          {
            functionDeclaration: `async function (u, w) {
              const img = new Image(); img.src = u; await img.decode();
              if (img.naturalWidth <= w) return null;
              const h = Math.max(1, Math.round(img.naturalHeight * w / img.naturalWidth));
              const c = document.createElement("canvas"); c.width = w; c.height = h;
              const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, w, h);
              return c.toDataURL("image/png");
            }`,
            objectId: await globalObjectId(page),
            arguments: [{ value: `data:image/png;base64,${b64(png)}` }, { value: Math.round(maxWidth) }],
            awaitPromise: true,
            returnByValue: true,
          },
          timeoutMs,
        );
        if (r.exceptionDetails || !r.result.value) return png;
        return dataUrlBytes(r.result.value, "the preview");
      },
      async seek(t) {
        await page.evaluate(`window.__agent3d.player.seek(${JSON.stringify(t)}).then(() => true)`, timeoutMs);
      },
      async input(ev) {
        await page.evaluate(`((i) => (${inputCall(ev)}, true))(window.__agent3d.player.input)`, timeoutMs);
      },
      async info() {
        return (await page.evaluate<PageInfo>("window.__agent3dInfo()", timeoutMs)) ?? { stats: null, inspect: null, issues: [], state: null };
      },
      close: cleanup,
    };
    return session;
  } catch (e) {
    await cleanup();
    throw e;
  }
}

async function globalObjectId(page: CdpSession): Promise<string> {
  const r = await page.send<{ result: { objectId: string } }>("Runtime.evaluate", { expression: "window" });
  return r.result.objectId;
}

// ─── render ─────────────────────────────────────────────────────────────

export interface RenderOptions {
  projectDir: string;
  scene?: SceneDoc;
  frames?: string;
  count?: number;
  size?: string;
  width?: number;
  scale?: number;
  sheet?: boolean;
  cols?: number;
  outDir?: string; // default <project>/renders
  capture?: "auto" | "canvas" | "page";
  // Simulated input applied while seeking (frames are then rendered in time order).
  input?: InputEvent[];
  // Also write `<stamp>-preview.png`: the sheet (or first frame) at most this wide (MCP image block).
  previewWidth?: number;
  // Background drawn under the frames: "checker", a CSS colour or "none".
  // Default: "checker" under the contact sheet of transparent scenes.
  bg?: string;
  // Render only this object, auto-framed, on a neutral background.
  isolate?: string;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export interface RenderResult {
  // Paths relative to the project folder (`dir`), absolute when --out is outside it.
  dir: string;
  frames: { t: number; path: string }[];
  sheet?: string;
  // render --isolate: the object and the bounding box the camera framed.
  isolated?: { id: string; size: [number, number, number]; center: [number, number, number]; note: string };
  // Down-scaled copy of the sheet / first frame (previewWidth), when it was wider.
  preview?: string;
  size: { width: number; height: number; deviceScaleFactor: number };
  capture: "canvas" | "page";
  stats: FrameStats | null;
  inspect: InspectResult | null;
  // Script-visible game state (api.state) after the last frame — e.g. { score: 3 }.
  state: Record<string, unknown> | null;
  // Input events applied (render --input).
  inputs?: number;
  issues: RuntimeIssue[];
  consoleErrors: string[];
  browser: { name: string; path: string };
  timings: { launchMs: number; readyMs: number; framesMs: number; totalMs: number };
}

export function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ─── render --isolate / --bg ────────────────────────────────────────────

export function parseBg(bg: string | undefined): string | undefined {
  if (bg === undefined) return undefined;
  const v = bg.trim();
  if (v === "checker" || v === "none") return v;
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || /^(rgb|rgba|hsl|hsla)\([^)]*\)$/i.test(v) || /^[a-z]{3,20}$/i.test(v)) return v;
  throw new CliError("usage", `--bg must be "checker", "none" or a CSS colour, got "${bg}".`, 'e.g. --bg checker, --bg "#ffffff", --bg "rgb(20, 20, 30)", --bg white.', 2);
}

// The scene reduced to one object (scripts, UI, timeline, behaviours and
// post effects dropped), at the origin, under neutral studio lights.
export function isolateScene(scene: SceneDoc, id: string): SceneDoc {
  const found = findObject(scene.objects, id);
  if (!found) {
    const ids: string[] = [];
    walkObjects(scene.objects, (o) => void ids.push(o.id));
    const s = closest(id, ids);
    throw new CliError("notFound", `No object "${id}" to isolate.`, `${s ? `Did you mean "${s}"? ` : ""}\`agent3d object list\` lists the ids.`, 1);
  }
  const strip = (o: ObjectDef): ObjectDef => {
    const { behaviours: _b, ...rest } = o as ObjectDef & { behaviours?: unknown };
    const children = (rest as { children?: ObjectDef[] }).children;
    return { ...(rest as ObjectDef), ...(children ? { children: children.map(strip) } : {}) } as ObjectDef;
  };
  const obj = { ...strip(found.object), position: [0, 0, 0], visible: true } as ObjectDef;
  return {
    version: scene.version,
    id: `${scene.id ?? "scene"}-isolate`,
    title: `${id} (isolated)`,
    target: { kind: "square", aspect: "1:1" },
    camera: { type: "perspective", fov: 35, position: [3, 2.5, 5], target: [0, 0.5, 0] },
    environment: { background: "#dfe2e8", lighting: "studio" },
    lights: [
      { id: "fill", type: "hemisphere", skyColor: "#ffffff", groundColor: "#8c8f99", intensity: 1.1 },
      { id: "key", type: "directional", position: [4, 8, 6], intensity: 2.2 },
    ],
    objects: [obj],
  } as SceneDoc;
}

// A camera in front (+Z), slightly right and above, framing a box.
export function frameBox(min: number[], max: number[], fov = 35, aspect = 1): { position: [number, number, number]; target: [number, number, number] } {
  const c = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const r = Math.max(0.01, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const half = ((fov / 2) * Math.PI) / 180;
  const fit = Math.min(half, Math.atan(Math.tan(half) * aspect));
  const d = (r / Math.sin(fit)) * 1.0; // bounding sphere: the object fills ~70-90 % of the frame
  const dir = [0.45, 0.35, 1];
  const n = Math.hypot(...dir);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { position: [0, 1, 2].map((i) => round(c[i] + (dir[i] / n) * d)) as [number, number, number], target: c.map(round) as [number, number, number] };
}

export async function renderProject(opts: RenderOptions): Promise<RenderResult> {
  const t0 = Date.now();
  const original = opts.scene ?? readScene(opts.projectDir);
  const scene = opts.isolate ? isolateScene(original, opts.isolate) : original;
  const bgOpt = parseBg(opts.bg);
  const transparent = !!scene.target?.transparent;
  const frameBg = bgOpt && bgOpt !== "none" ? bgOpt : undefined;
  const sheetBg = bgOpt === "none" ? undefined : (bgOpt ?? (transparent ? "checker" : undefined));
  const viewport = viewportFor(scene, { size: opts.size ?? (opts.isolate ? "800x800" : undefined), width: opts.width, scale: opts.scale });
  const inputs = opts.input ?? [];
  let times = frameTimes(scene, { frames: opts.frames, count: opts.count ?? (opts.isolate ? 1 : undefined) });
  // Seeking backwards restarts the game: with inputs, render in time order.
  if (inputs.length) times = [...times].sort((a, b) => a - b);
  const capture = !opts.capture || opts.capture === "auto" ? (scene.ui?.elements?.length ? "page" : "canvas") : opts.capture;
  const outDir = resolve(opts.outDir ?? join(opts.projectDir, "renders"));
  const session = await openRenderSession({ projectDir: opts.projectDir, scene, viewport, timeoutMs: opts.timeoutMs, log: opts.log });
  try {
    let isolated: RenderResult["isolated"];
    if (opts.isolate) {
      // Frame the object's real bounds, then re-mount with that camera.
      const first = (await session.info()).inspect?.objects.find((o) => o.id === opts.isolate);
      if (first) {
        const cam = frameBox(first.min, first.max, 35, viewport.width / viewport.height);
        await session.update({ ...scene, camera: { ...scene.camera, ...cam } } as SceneDoc);
        const r = (v: number) => Math.round(v * 1000) / 1000;
        isolated = {
          id: opts.isolate,
          size: first.max.map((v, i) => r(v - first.min[i])) as [number, number, number],
          center: first.max.map((v, i) => r((v + first.min[i]) / 2)) as [number, number, number],
          note: "Front three-quarter view with the object's scene rotation and scale: the camera looks from +Z (front), slightly right (+X) and above (+Y). A model facing the camera faces +Z.",
        };
      }
    }
    const tf = Date.now();
    const shots: Uint8Array[] = [];
    let next = 0;
    for (const t of times) {
      for (; next < inputs.length && inputs[next].t <= t + 1e-9; next++) {
        await session.seek(inputs[next].t);
        await session.input(inputs[next]);
      }
      const shot = capture === "page" ? await session.screenshot(t) : await session.frame(t);
      shots.push(frameBg ? await session.composite(shot, frameBg) : shot);
    }
    const framesMs = Date.now() - tf;
    const info = await session.info();
    mkdirSync(outDir, { recursive: true });
    const stamp = timestamp();
    const frames = times.map((t, i) => {
      const path = join(outDir, `${stamp}-t${String(t).replace(/\./g, "_")}.png`);
      writeFileSync(path, shots[i]);
      return { t, path };
    });
    let sheet: string | undefined;
    if (opts.sheet) {
      const bytes = await session.sheet(shots, times.map((t) => `t = ${t.toFixed(2)} s`), opts.cols, frameBg ? undefined : sheetBg);
      sheet = join(outDir, `${stamp}-sheet.png`);
      writeFileSync(sheet, bytes);
    }
    let preview: string | undefined;
    if (opts.previewWidth && opts.previewWidth > 0) {
      const src = sheet ? readFileSync(sheet) : shots[0];
      const small = await session.scale(src, opts.previewWidth);
      if (small !== src) {
        preview = join(outDir, `${stamp}-preview.png`);
        writeFileSync(preview, small);
      }
    }
    const projectDir = resolve(opts.projectDir);
    return {
      dir: projectDir,
      frames: frames.map((f) => ({ t: f.t, path: projectPath(projectDir, f.path) })),
      ...(sheet ? { sheet: projectPath(projectDir, sheet) } : {}),
      ...(preview ? { preview: projectPath(projectDir, preview) } : {}),
      ...(isolated ? { isolated } : {}),
      size: viewport,
      capture,
      stats: info.stats,
      inspect: info.inspect,
      state: info.state ?? null,
      ...(inputs.length ? { inputs: inputs.length } : {}),
      issues: info.issues ?? [],
      consoleErrors: session.consoleErrors,
      browser: { name: session.browser.name, path: session.browser.path },
      timings: { ...session.timings, framesMs, totalMs: Date.now() - t0 },
    };
  } finally {
    await session.close();
  }
}

// ─── poster & video ─────────────────────────────────────────────────────

export async function renderPoster(opts: { projectDir: string; scene?: SceneDoc; format?: "webp" | "png"; size?: string; width?: number; scale?: number; time?: number; timeoutMs?: number; log?: (m: string) => void }): Promise<{ bytes: Uint8Array; t: number; format: "webp" | "png"; size: Viewport }> {
  const scene = opts.scene ?? readScene(opts.projectDir);
  const viewport = viewportFor(scene, { size: opts.size, width: opts.width, scale: opts.scale });
  const t = opts.time ?? scene.target?.posterTime ?? 0;
  const format = opts.format ?? "webp";
  const session = await openRenderSession({ projectDir: opts.projectDir, scene, viewport, timeoutMs: opts.timeoutMs, log: opts.log });
  try {
    const bytes = await session.frame(t, format === "webp" ? "image/webp" : "image/png", format === "webp" ? 0.85 : undefined);
    return { bytes, t, format, size: viewport };
  } finally {
    await session.close();
  }
}

export async function renderVideo(opts: { projectDir: string; scene?: SceneDoc; size?: string; width?: number; duration?: number; fps?: number; timeoutMs?: number; log?: (m: string) => void }): Promise<{ bytes: Uint8Array; frames: number; fps: number; duration: number; size: Viewport; ms: number }> {
  const t0 = Date.now();
  const scene = opts.scene ?? readScene(opts.projectDir);
  // VP8 needs even dimensions on some players.
  const vp = viewportFor(scene, { size: opts.size, width: opts.width ?? 960, scale: 1 });
  const viewport = { ...vp, width: vp.width - (vp.width % 2), height: vp.height - (vp.height % 2) };
  const fps = Math.max(1, Math.min(60, Math.round(opts.fps ?? 30)));
  const duration = opts.duration ?? (scene.timeline?.duration && scene.timeline.duration > 0 ? scene.timeline.duration : 5);
  if (!(duration > 0) || duration > 120) throw new CliError("usage", "--duration must be between 0 and 120 seconds.", undefined, 2);
  const count = Math.max(1, Math.round(duration * fps));
  const session = await openRenderSession({ projectDir: opts.projectDir, scene, viewport, timeoutMs: opts.timeoutMs, log: opts.log });
  try {
    const frames = [];
    for (let i = 0; i < count; i++) {
      const webp = await session.frame(i / fps, "image/webp", 0.9);
      frames.push(webpToVp8(webp));
      if (i % fps === 0) opts.log?.(`[agent3d export] video frame ${i + 1}/${count}`);
    }
    return { bytes: muxWebm(frames, fps), frames: count, fps, duration, size: viewport, ms: Date.now() - t0 };
  } finally {
    await session.close();
  }
}
