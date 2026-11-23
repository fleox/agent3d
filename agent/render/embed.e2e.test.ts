import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildExport } from "../../src/ops/export";
import { createProject } from "../../src/ops/project";
import { patchScene } from "../../src/ops/scene";
import { libraryProvider, readRuntimeFiles } from "../host";
import { NodeFs } from "../nodeFs";
import { runtimeBuilt, runtimeDir, templatesDir } from "../paths";
import { findBrowser, launchBrowser } from "./browser";
import { CdpClient, type CdpSession } from "./cdp";
import { startLocalServer } from "./server";
import { tempDir } from "../testing/tmp";

// End-to-end: export real templates with the real runtime (dist/runtime, or
// AGENT3D_DIST), serve the export folder, open index.html in headless Chrome
// and drive the <agent3d-scene> element's public API. Skipped without a
// browser or a runtime build that has the element API (stale dist/).
// A3D_E2E_KEEP=1 keeps the export folders and screenshots (paths on stderr; temp folders are kept too).

const browser = findBrowser();
const runtimeOk = (() => {
  try {
    return runtimeBuilt() && readFileSync(join(runtimeDir(), "agent3d-runtime.js"), "utf8").includes("agent3d:click");
  } catch {
    return false;
  }
})();

function readTemplate(id: string): Record<string, Uint8Array> {
  const root = join(templatesDir(), id);
  const out: Record<string, Uint8Array> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const abs = join(d, e);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(root, abs).split("\\").join("/")] = new Uint8Array(readFileSync(abs));
    }
  };
  walk(root);
  return out;
}

async function exportTemplate(base: string, id: string, edit?: (fs: NodeFs) => Promise<void>): Promise<string> {
  const projectDir = join(base, `p-${id}`);
  mkdirSync(projectDir, { recursive: true });
  const fs = new NodeFs(projectDir);
  await createProject(fs, { name: id, template: id, templateFiles: readTemplate(id) });
  await edit?.(fs);
  const r = await buildExport(fs, { format: "embed", runtime: { files: readRuntimeFiles("embed") }, library: libraryProvider() });
  const out = join(base, `out-${id}`);
  for (const [rel, data] of Object.entries(r.files)) {
    const abs = join(out, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  }
  return out;
}

async function waitFor<T>(page: CdpSession, expr: string, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await page.evaluate<T>(expr).catch(() => undefined as T);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${expr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!browser || !runtimeOk)("exported embed in a real browser", () => {
  it("loads three exported templates, exposes the element API and frees WebGL on removal", async () => {
    const base = tempDir("agent3d-embed-");
    const keep = !!process.env.A3D_E2E_KEEP;
    const ids = ["banner-neon-title", "hero-product-turntable", "game-coin-collector"];
    const outs: string[] = [];
    for (const id of ids)
      outs.push(
        await exportTemplate(base, id, async (fs) => {
          // A data binding: the first text object shows {data.title}.
          const scene = JSON.parse(await fs.readText("scene.json")) as { objects: { id: string; kind: string; children?: unknown[] }[] };
          const text = scene.objects.find((o) => o.kind === "text");
          const r = await patchScene(fs, [
            { op: "set", path: "data", value: { title: "Hello" } },
            text ? { op: "updateObject", id: text.id, set: { text: "{data.title}" } } : { op: "addObject", object: { id: "dataText", kind: "text", text: "{data.title}", size: 0.2, position: [0, 0, 0] } },
          ]);
          expect(r.applied).toBe(true);
        }),
      );
    const b = await launchBrowser(browser!);
    const client = await CdpClient.connect(b.wsUrl);
    try {
      for (let i = 0; i < ids.length; i++) {
        const server = await startLocalServer({ mounts: { "/": outs[i] } });
        try {
          const page = await client.newPage();
          const errors: string[] = [];
          page.on("Runtime.exceptionThrown", (p) => errors.push(JSON.stringify(p).slice(0, 400)));
          page.on("Runtime.consoleAPICalled", (p) => p.type === "error" && errors.push(JSON.stringify(p.args).slice(0, 400)));
          page.on("Log.entryAdded", (p) => (p.entry as { level?: string }).level === "error" && errors.push(JSON.stringify(p.entry).slice(0, 400)));
          await page.send("Runtime.enable");
          await page.send("Log.enable");
          await page.send("Page.enable");
          await page.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
          // Record the element's events from the start.
          await page.send("Page.addScriptToEvaluateOnNewDocument", {
            source: `window.__ev = []; ["agent3d:ready","agent3d:error","agent3d:event","agent3d:click","agent3d:progress"].forEach((t) => document.addEventListener(t, (e) => window.__ev.push({ type: t, detail: t === "agent3d:ready" ? null : e.detail }), true));`,
          });
          await page.send("Page.navigate", { url: `${server.url}/index.html` });
          await waitFor(page, `document.querySelector("agent3d-scene")?.getAttribute("status") === "ready"`);
          const r = await page.evaluate<Record<string, unknown>>(`(async () => {
            const el = document.querySelector("agent3d-scene");
            const out = { status: el.getAttribute("status"), hasShadow: !!el.shadowRoot, aspect: getComputedStyle(el).aspectRatio, w: el.clientWidth, h: el.clientHeight };
            out.posterHidden = getComputedStyle(el.shadowRoot.querySelector(".poster")).opacity;
            out.events = window.__ev.map((e) => e.type);
            out.progress = window.__ev.filter((e) => e.type === "agent3d:progress").length;
            el.pause();
            await el.seek(1);
            out.t = el.player.time();
            out.data = el.data;
            await el.setData({ title: "Summer sale" });
            out.dataAfter = el.data.title;
            out.boundText = JSON.stringify(el.player.scene.objects).includes("Summer sale");
            el.player.input.click(0, 0);
            await el.seek(1.1);
            out.click = window.__ev.find((e) => e.type === "agent3d:click")?.detail ?? null;
            el.trigger("agent3d-test", { a: 1 });
            out.triggered = window.__ev.some((e) => e.type === "agent3d:event" && e.detail.name === "agent3d-test");
            out.liveBefore = window.Agent3D.liveContexts();
            return out;
          })()`);
          expect(r.status).toBe("ready");
          expect(r.hasShadow).toBe(true);
          expect(r.events).toContain("agent3d:ready");
          expect(r.posterHidden).toBe("0");
          expect(r.t).toBe(1);
          expect(r.dataAfter).toBe("Summer sale");
          expect(r.boundText).toBe(true);
          expect(r.click).toMatchObject({ x: 0, y: 0 });
          expect(r.triggered).toBe(true);
          expect(r.liveBefore).toBe(1);
          const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
          if (keep) writeFileSync(join(base, `shot-${ids[i]}.png`), Buffer.from(shot.data, "base64"));
          // SPA removal: the player is disposed and its WebGL context released; re-adding remounts.
          const after = await page.evaluate<Record<string, unknown>>(`(async () => {
            const el = document.querySelector("agent3d-scene");
            const parent = el.parentNode;
            const geos = [];
            for (let k = 0; k < 10; k++) { await el.setData({ title: "x" + k }); geos.push(el.player.stats().geometries + ":" + el.player.stats().textures); }
            el.remove();
            const live = window.Agent3D.liveContexts();
            const canvases = el.querySelectorAll("canvas").length;
            parent.appendChild(el);
            await el.ready;
            await new Promise((r) => setTimeout(r, 50));
            return { live, canvases, geos, remounted: el.getAttribute("status"), liveAgain: window.Agent3D.liveContexts() };
          })()`);
          expect(after.live).toBe(0);
          expect(after.canvases).toBe(0);
          // Rebuilding does not leak GPU resources (the first rebuild may warm shared caches).
          const geos = after.geos as string[];
          expect(geos[9]).toBe(geos[1]);
          expect(after.remounted).toBe("ready");
          expect(after.liveAgain).toBe(1);
          expect(errors).toEqual([]);
        } finally {
          await server.close();
        }
      }
      if (keep) process.stderr.write(`[embed e2e] kept ${base}\n`);
    } finally {
      client.close();
      await b.close();
    }
    expect(existsSync(join(outs[0], "EMBED.md"))).toBe(true);
  }, 240_000);

  it("starts reliably: 20 consecutive page loads all reach ready (lazy start race)", async () => {
    const base = tempDir("agent3d-embed-loop-");
    const out = await exportTemplate(base, "banner-neon-title");
    const server = await startLocalServer({ mounts: { "/": out } });
    const b = await launchBrowser(browser!);
    const client = await CdpClient.connect(b.wsUrl);
    try {
      const page = await client.newPage();
      await page.send("Runtime.enable");
      await page.send("Page.enable");
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
      const statuses: string[] = [];
      for (let i = 0; i < 20; i++) {
        await page.send("Page.navigate", { url: `${server.url}/index.html?load=${i}` });
        const s = await waitFor<string>(page, `(() => { const s = document.querySelector("agent3d-scene")?.getAttribute("status"); return s === "ready" || s === "error" || s === "unsupported" ? s : ""; })()`, 20_000).catch(
          async () => `stuck:${await page.evaluate<string>(`String(document.querySelector("agent3d-scene")?.getAttribute("status"))`)}`,
        );
        statuses.push(s);
      }
      expect(statuses).toEqual(Array(20).fill("ready"));
    } finally {
      client.close();
      await b.close();
      await server.close();
    }
  }, 600_000);

  it("shares one runtime between scenes, pauses off-screen, honours reduced motion and print, falls back without WebGL", async () => {
    const base = tempDir("agent3d-embed-multi-");
    const banner = await exportTemplate(base, "banner-neon-title");
    await exportTemplate(base, "hero-product-turntable");
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<script type="module" src="/out-banner-neon-title/agent3d-runtime/agent3d-runtime.js"></script>
<agent3d-scene id="a" src="/out-banner-neon-title/banner-neon-title/scene.json" aspect="4:1"><img slot="poster" src="/out-banner-neon-title/banner-neon-title/poster.webp" alt="poster a"></agent3d-scene>
<div style="height:4000px"></div>
<agent3d-scene id="b" src="/out-hero-product-turntable/hero-product-turntable/scene.json" aspect="16:9"></agent3d-scene>
<script type="module" src="/out-banner-neon-title/agent3d-runtime/agent3d-runtime.js"></script>
</body></html>`;
    writeFileSync(join(base, "multi.html"), html);
    expect(existsSync(join(banner, "agent3d-runtime", "agent3d-runtime.js"))).toBe(true);
    const server = await startLocalServer({ mounts: { "/": base } });
    const b = await launchBrowser(browser!);
    const client = await CdpClient.connect(b.wsUrl);
    try {
      const page = await client.newPage();
      await page.send("Runtime.enable");
      await page.send("Page.enable");
      await page.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
      await page.send("Page.navigate", { url: `${server.url}/multi.html` });
      await waitFor(page, `document.querySelector("#a")?.getAttribute("status") === "ready"`);
      const first = await page.evaluate<Record<string, unknown>>(`(async () => {
        await new Promise((r) => setTimeout(r, 300));
        return {
          runtimeLoads: performance.getEntriesByType("resource").filter((e) => e.name.endsWith("/agent3d-runtime.js")).length,
          bStatus: document.querySelector("#b").getAttribute("status"),
          live: window.Agent3D.liveContexts(),
          aTime: document.querySelector("#a").player.time(),
        };
      })()`);
      expect(first.runtimeLoads).toBe(1);
      expect(first.bStatus).toBe("loading"); // lazy: not started below the fold
      expect(first.live).toBe(1);
      expect(first.aTime as number).toBeGreaterThan(0);
      await page.evaluate(`document.querySelector("#b").scrollIntoView()`);
      await waitFor(page, `document.querySelector("#b").getAttribute("status") === "ready"`);
      const second = await page.evaluate<Record<string, number>>(`(async () => {
        const a = document.querySelector("#a").player;
        await new Promise((r) => setTimeout(r, 200));
        const t0 = a.time();
        await new Promise((r) => setTimeout(r, 600));
        return { live: window.Agent3D.liveContexts(), aDelta: a.time() - t0, bTime: document.querySelector("#b").player.time() };
      })()`);
      expect(second.live).toBe(2);
      expect(second.aDelta).toBe(0); // paused off-screen
      // GPU context loss → "context-lost" error, then restored and ready again.
      const lost = await page.evaluate<Record<string, unknown>>(`(async () => {
        const el = document.querySelector("#b");
        const codes = [];
        el.addEventListener("agent3d:error", (e) => codes.push(e.detail.code));
        const ext = el.player.canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
        ext.loseContext();
        await new Promise((r) => setTimeout(r, 300));
        const during = el.getAttribute("status");
        ext.restoreContext();
        for (let i = 0; i < 100 && el.getAttribute("status") !== "ready"; i++) await new Promise((r) => setTimeout(r, 100));
        await el.seek(1);
        return { codes, during, after: el.getAttribute("status"), tris: el.player.stats().triangles };
      })()`);
      expect(lost.codes).toContain("context-lost");
      expect(lost.during).toBe("loading");
      expect(lost.after).toBe("ready");
      expect(lost.tris as number).toBeGreaterThan(0);
      // Print: the current frame replaces the canvas.
      const printed = await page.evaluate<string>(`(() => { window.dispatchEvent(new Event("beforeprint")); return document.querySelector("#b").shadowRoot.querySelector(".print").getAttribute("src") || ""; })()`);
      expect(printed.startsWith("data:image/png")).toBe(true);

      // Reduced motion: a still frame (time does not advance).
      const rm = await client.newPage();
      await rm.send("Runtime.enable");
      await rm.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await rm.send("Page.navigate", { url: `${server.url}/out-banner-neon-title/index.html` });
      await waitFor(rm, `document.querySelector("agent3d-scene")?.getAttribute("status") === "ready"`);
      const still = await rm.evaluate<number>(`(async () => { const p = document.querySelector("agent3d-scene").player; const t0 = p.time(); await new Promise((r) => setTimeout(r, 500)); return p.time() - t0; })()`);
      expect(still).toBe(0);
    } finally {
      client.close();
      await b.close();
    }
    // No WebGL: the poster stays, status "unsupported", agent3d:error webgl-unavailable.
    const noGl = await launchBrowser(browser!, { extraArgs: ["--disable-3d-apis", "--disable-webgl"] });
    const c2 = await CdpClient.connect(noGl.wsUrl);
    try {
      const page = await c2.newPage();
      await page.send("Runtime.enable");
      await page.send("Page.enable");
      await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__codes = []; document.addEventListener("agent3d:error", (e) => window.__codes.push(e.detail.code), true);` });
      await page.send("Page.navigate", { url: `${server.url}/out-banner-neon-title/index.html` });
      const r = await waitFor<{ status: string; codes: string[]; posterOpacity: string }>(
        page,
        `(() => { const el = document.querySelector("agent3d-scene"); const s = el?.getAttribute("status"); return s && s !== "loading" ? { status: s, codes: window.__codes, posterOpacity: getComputedStyle(el.shadowRoot.querySelector(".poster")).opacity } : null; })()`,
      );
      expect(r.status).toBe("unsupported");
      expect(r.codes).toContain("webgl-unavailable");
      expect(r.posterOpacity).toBe("1");
    } finally {
      c2.close();
      await noGl.close();
      await server.close();
    }
  }, 240_000);
});
