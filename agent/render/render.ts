import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SceneDoc } from "../../src/core/types";
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
  sheet(frames: Uint8Array[], labels: string[], cols?: number): Promise<Uint8Array>;
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
    let state: { ready: boolean; error: string | null; webgl: boolean; issues: RuntimeIssue[] } | null = null;
    for (;;) {
      state = await page
        .evaluate<typeof state>("window.__agent3d ? { ready: window.__agent3d.ready, error: window.__agent3d.error, webgl: window.__agent3d.webgl, issues: window.__agent3d.issues } : null", 10_000)
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
      async sheet(frames, labels, cols) {
        const urls = frames.map((f) => `data:image/png;base64,${b64(f)}`);
        const r = await page.send<{ result: { value?: unknown }; exceptionDetails?: unknown }>(
          "Runtime.callFunctionOn",
          {
            functionDeclaration: "function (u, l, c) { return window.__agent3dSheet(u, l, c); }",
            executionContextId: undefined,
            objectId: await globalObjectId(page),
            arguments: [{ value: urls }, { value: labels }, { value: cols ?? 0 }],
            awaitPromise: true,
            returnByValue: true,
          },
          timeoutMs,
        );
        if (r.exceptionDetails) throw new CliError("render-failed", "Could not compose the contact sheet.", "Render without --sheet, or with fewer frames.");
        return dataUrlBytes(r.result.value, "the contact sheet");
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
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export interface RenderResult {
  frames: { t: number; path: string }[];
  sheet?: string;
  size: { width: number; height: number; deviceScaleFactor: number };
  capture: "canvas" | "page";
  stats: FrameStats | null;
  inspect: InspectResult | null;
  issues: RuntimeIssue[];
  consoleErrors: string[];
  browser: { name: string; path: string };
  timings: { launchMs: number; readyMs: number; framesMs: number; totalMs: number };
}

export function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function renderProject(opts: RenderOptions): Promise<RenderResult> {
  const t0 = Date.now();
  const scene = opts.scene ?? readScene(opts.projectDir);
  const viewport = viewportFor(scene, { size: opts.size, width: opts.width, scale: opts.scale });
  const times = frameTimes(scene, { frames: opts.frames, count: opts.count });
  const capture = !opts.capture || opts.capture === "auto" ? (scene.ui?.elements?.length ? "page" : "canvas") : opts.capture;
  const outDir = resolve(opts.outDir ?? join(opts.projectDir, "renders"));
  const session = await openRenderSession({ projectDir: opts.projectDir, scene, viewport, timeoutMs: opts.timeoutMs, log: opts.log });
  try {
    const tf = Date.now();
    const shots: Uint8Array[] = [];
    for (const t of times) shots.push(capture === "page" ? await session.screenshot(t) : await session.frame(t));
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
      const bytes = await session.sheet(shots, times.map((t) => `t = ${t.toFixed(2)} s`), opts.cols);
      sheet = join(outDir, `${stamp}-sheet.png`);
      writeFileSync(sheet, bytes);
    }
    return {
      frames,
      ...(sheet ? { sheet } : {}),
      size: viewport,
      capture,
      stats: info.stats,
      inspect: info.inspect,
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
