import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { deflateSync, inflateRawSync } from "node:zlib";
import { buildExport, type ExportResult } from "../../src/ops/export";
import { buildPlate } from "../../src/ops/plate";
import { decodePng as decodeRgba } from "../../src/ops/pngDecode";
import { encodePng } from "../../src/ops/pngEncode";
import { createProject } from "../../src/ops/project";
import { patchScene, type PatchOp } from "../../src/ops/scene";
import { libraryProvider, readRuntimeFiles } from "../host";
import { NodeFs } from "../nodeFs";
import { runtimeBuilt, runtimeDir, templatesDir } from "../paths";
import { findBrowser, launchBrowser } from "./browser";
import { CdpClient, type CdpSession } from "./cdp";
import { decodePng } from "./png";
import { startLocalServer } from "./server";
import { tempDir } from "../testing/tmp";
import { e2eTimeout } from "../testing/e2e";

// End-to-end: the photo-only lite runtime (dist/runtime/agent3d-photo.js)
// renders an eligible 3D-photo scene like the full Three.js runtime. The same
// scene is exported twice (runtime auto → lite, full), both pages are opened
// in headless Chrome, driven to the same state through the element API
// (pause, player.input.pointer, seek) and their pixels compared. Skipped
// without a browser or a runtime build that has the lite file.
// A3D_E2E_KEEP=1 keeps the export folders and screenshots (path on stderr).

const browser = findBrowser();
const runtimeOk = (() => {
  try {
    return runtimeBuilt() && statSync(join(runtimeDir(), "agent3d-photo.js")).size > 0 && readFileSync(join(runtimeDir(), "agent3d-runtime.js"), "utf8").includes("agent3d:click");
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

async function waitFor<T>(page: CdpSession, expr: string, ms = 60_000): Promise<T> {
  const end = Date.now() + e2eTimeout(ms);
  for (;;) {
    const v = await page.evaluate<T>(expr).catch(() => undefined as T);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${expr}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Mean absolute difference (0..255) over RGB, and the share of pixels off by more than 24.
function compare(a: Uint8Array, b: Uint8Array): { mean: number; bad: number; w: number; h: number } {
  const pa = decodePng(a), pb = decodePng(b);
  expect([pa.width, pa.height]).toEqual([pb.width, pb.height]);
  let sum = 0, bad = 0;
  const n = pa.width * pa.height;
  for (let i = 0; i < n; i++) {
    let px = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(pa.pixels[i * pa.channels + c] - pb.pixels[i * pb.channels + c]);
      sum += d;
      px = Math.max(px, d);
    }
    if (px > 24) bad++;
  }
  return { mean: sum / (n * 3), bad: bad / n, w: pa.width, h: pa.height };
}

describe.skipIf(!browser || !runtimeOk)("photo-only lite runtime vs full runtime", () => {
  it("renders the same pixels for the same pointer / time state, without downloading three.js", async () => {
    const base = tempDir("agent3d-photolite-");
    const keep = !!process.env.A3D_E2E_KEEP;
    // Two eligible variants of the photo hero template: the photo filling the
    // frame (as authored), and pulled back so the edges and the background show.
    // A third one has a background plate (src/ops/plate.ts from the template's
    // depth map, with a synthetic colour image so plate texels are easy to tell).
    const variants: { id: string; ops: PatchOp[]; plate?: boolean }[] = [
      { id: "fill", ops: [] },
      { id: "framed", ops: [{ op: "set", path: "camera.position", value: [0.6, -0.3, 16] }, { op: "set", path: "camera.target", value: [0.2, 0, 0] }] },
      // depth-driven effects (build/photoFx.ts, shared GLSL): fog wisps, auto light path, partial reveal
      { id: "effects", ops: [{ op: "set", path: "objects#photo.effects", value: { fog: { color: "#c9d6ea", amount: 0.5 }, light: { follow: "auto", ambient: 0.6, color: "#ffe2b0" }, reveal: { progress: 0.85 } } }] },
      { id: "plate", ops: [{ op: "merge", path: "objects#photo", value: { strength: 1, plate: "assets/depth/street-plate.png", plateDepth: "assets/depth/street-plate-depth.png" } }], plate: true },
      // A cinematic move (push + dolly zoom through the UV inset: photoCore parallaxView).
      { id: "vertigo", ops: [{ op: "set", path: "objects#photo.motion.auto", value: "vertigo" }] },
    ];
    const exports: { id: string; lite: string; full: string; liteResult: ExportResult; fullResult: ExportResult }[] = [];
    for (const v of variants) {
      const projectDir = join(base, `p-${v.id}`);
      mkdirSync(projectDir, { recursive: true });
      const fs = new NodeFs(projectDir);
      await createProject(fs, { name: "photo", template: "hero-photo-3d", templateFiles: readTemplate("hero-photo-3d") });
      if (v.plate) {
        const inflate = (d: Uint8Array) => new Uint8Array(inflateRawSync(d));
        const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(d));
        const depth = await decodeRgba(await fs.readBytes("assets/depth/street-depth.png"), { inflate });
        const colour = new Uint8Array(depth.data.length);
        for (let i = 0; i < depth.width * depth.height; i++) colour.set([255, (i % depth.width) % 256, 40, 255], i * 4);
        const plate = buildPlate({ data: colour, width: depth.width, height: depth.height }, depth);
        await fs.writeBytes("assets/depth/street-plate.png", await encodePng(plate.color.data, depth.width, depth.height, { deflate }));
        await fs.writeBytes("assets/depth/street-plate-depth.png", await encodePng(plate.depth.data, depth.width, depth.height, { deflate }));
      }
      const r = await patchScene(fs, [{ op: "removeObject", id: "title" }, { op: "removeObject", id: "subtitle" }, { op: "remove", path: "postfx" }, { op: "remove", path: "data" }, ...v.ops]);
      expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(r.applied).toBe(true);
      const write = async (mode: "auto" | "full") => {
        const res = await buildExport(fs, { format: "embed", runtime: { files: readRuntimeFiles("embed") }, library: libraryProvider(), runtimeChoice: mode });
        const out = join(base, `out-${v.id}-${mode}`);
        for (const [rel, data] of Object.entries(res.files)) {
          const abs = join(out, rel);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, data);
        }
        return { out, res };
      };
      const lite = await write("auto");
      const full = await write("full");
      exports.push({ id: v.id, lite: lite.out, full: full.out, liteResult: lite.res, fullResult: full.res });
    }
    for (const e of exports) {
      expect(e.liteResult.runtime).toBe("photo-lite");
      expect(e.liteResult.snippet).toContain("agent3d-photo.js");
      expect(e.liteResult.snippet).not.toContain("modulepreload");
      expect(e.fullResult.runtime).toBe("full");
      expect(e.liteResult.page.runtimeKb).toBeLessThan(e.fullResult.page.runtimeKb / 10);
    }

    const server = await startLocalServer({ mounts: { "/": base } });
    const b = await launchBrowser(browser!);
    const client = await CdpClient.connect(b.wsUrl);
    // [variant, state] → { lite, full } screenshots
    const states = [
      { name: "drift", js: `el.pause(); await el.seek(2.5);` },
      { name: "pointer", js: `el.pause(); el.player.input.pointer(0.7, -0.45); await el.seek(3.1);` },
      { name: "zoom-pointer", js: `el.pause(); el.player.input.pointer(-0.9, 0.8); await el.seek(4.2);` },
    ];
    try {
      const shots = new Map<string, Uint8Array>();
      for (const e of exports) {
        for (const kind of ["lite", "full"] as const) {
          const dir = relative(base, kind === "lite" ? e.lite : e.full);
          const page = await client.newPage();
          const errors: string[] = [];
          page.on("Runtime.exceptionThrown", (p) => errors.push(JSON.stringify(p).slice(0, 400)));
          await page.send("Runtime.enable");
          await page.send("Page.enable");
          await page.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
          await page.send("Page.navigate", { url: `${server.url}/${dir}/index.html` });
          await waitFor(page, `document.querySelector("agent3d-scene")?.getAttribute("status") === "ready"`);
          const info = await page.evaluate<{ three: number; photoJs: number; poster: string }>(`(async () => {
            // the loading bar fades out 0.4 s + 0.3 s after ready: wait it out
            await new Promise((r) => setTimeout(r, 1000));
            const res = performance.getEntriesByType("resource").map((r) => r.name);
            const el = document.querySelector("agent3d-scene");
            return { three: res.filter((n) => /three\\.module|agent3d-runtime\\.js/.test(n)).length, photoJs: res.filter((n) => n.endsWith("/agent3d-photo.js")).length, poster: getComputedStyle(el.shadowRoot.querySelector(".poster")).opacity };
          })()`);
          if (kind === "lite") {
            expect(info.three).toBe(0);
            expect(info.photoJs).toBe(1);
          } else expect(info.three).toBeGreaterThan(0);
          expect(info.poster).toBe("0");
          for (const s of states) {
            const rect = await page.evaluate<{ x: number; y: number; width: number; height: number }>(`(async () => {
              const el = document.querySelector("agent3d-scene");
              ${s.js}
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
              const b = el.getBoundingClientRect();
              return { x: b.x, y: b.y, width: b.width, height: b.height };
            })()`);
            const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 1 } });
            const bytes = new Uint8Array(Buffer.from(shot.data, "base64"));
            shots.set(`${e.id}/${s.name}/${kind}`, bytes);
            if (keep) writeFileSync(join(base, `shot-${e.id}-${s.name}-${kind}.png`), bytes);
          }
          expect(errors).toEqual([]);
          await page.send("Page.close").catch(() => undefined);
        }
      }
      const report: Record<string, { mean: number; bad: number }> = {};
      for (const e of exports)
        for (const s of states) {
          const c = compare(shots.get(`${e.id}/${s.name}/lite`)!, shots.get(`${e.id}/${s.name}/full`)!);
          report[`${e.id}/${s.name}`] = { mean: Math.round(c.mean * 1000) / 1000, bad: Math.round(c.bad * 10000) / 10000 };
        }
      if (keep) process.stderr.write(`[photo-lite e2e] kept ${base}\n${JSON.stringify(report, null, 1)}\n`);
      for (const [k, c] of Object.entries(report)) {
        expect(c.mean, k).toBeLessThan(2);
        expect(c.bad, k).toBeLessThan(0.005);
      }
      // The states differ from each other (the motion really moved the view).
      const d = compare(shots.get("fill/drift/lite")!, shots.get("fill/pointer/lite")!);
      expect(d.mean).toBeGreaterThan(1);
      // The plate shows where the view uncovers the background (both runtimes, compared above).
      const pl = compare(shots.get("plate/zoom-pointer/lite")!, shots.get("fill/zoom-pointer/lite")!);
      expect(pl.bad).toBeGreaterThan(0.002);
    } finally {
      client.close();
      await b.close();
      await server.close();
    }
  }, e2eTimeout(240_000));
  it("a page loading only the lite runtime hands other scenes to the full runtime (same folder)", async () => {
    const base = tempDir("agent3d-photolite-mixed-");
    const exportTemplate = async (id: string, ops: PatchOp[]) => {
      const projectDir = join(base, `p-${id}`);
      mkdirSync(projectDir, { recursive: true });
      const fs = new NodeFs(projectDir);
      await createProject(fs, { name: id, template: "hero-photo-3d", templateFiles: readTemplate("hero-photo-3d") });
      if (ops.length) expect((await patchScene(fs, ops)).applied).toBe(true);
      const res = await buildExport(fs, { format: "embed", runtime: { files: readRuntimeFiles("embed") }, library: libraryProvider(), extras: false });
      for (const [rel, data] of Object.entries(res.files)) {
        const abs = join(base, `out-${id}`, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, data);
      }
      return res;
    };
    const lite = await exportTemplate("lite", [{ op: "removeObject", id: "title" }, { op: "removeObject", id: "subtitle" }, { op: "remove", path: "postfx" }]);
    const full = await exportTemplate("full", []);
    expect(lite.runtime).toBe("photo-lite");
    expect(full.runtime).toBe("full");
    expect(full.runtimeReasons).toEqual(expect.arrayContaining(["post effects (postfx)", "3 objects (the lite runtime shows exactly one photo)"]));
    writeFileSync(
      join(base, "mixed.html"),
      `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<script type="module" src="/out-lite/agent3d-runtime/agent3d-photo.js"></script>
<agent3d-scene id="a" src="/out-lite/lite/scene.json" aspect="16:9"></agent3d-scene>
<agent3d-scene id="b" src="/out-full/full/scene.json" aspect="16:9"></agent3d-scene>
</body></html>`,
    );
    const server = await startLocalServer({ mounts: { "/": base } });
    const b = await launchBrowser(browser!);
    const client = await CdpClient.connect(b.wsUrl);
    try {
      const page = await client.newPage();
      const errors: string[] = [];
      page.on("Runtime.exceptionThrown", (p) => errors.push(JSON.stringify(p).slice(0, 400)));
      await page.send("Runtime.enable");
      await page.send("Page.enable");
      await page.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 1000, deviceScaleFactor: 1, mobile: false });
      await page.send("Page.navigate", { url: `${server.url}/mixed.html` });
      await waitFor(page, `["a", "b"].every((id) => document.getElementById(id)?.getAttribute("status") === "ready")`);
      const r = await page.evaluate<Record<string, unknown>>(`(() => ({
        full: !!window.Agent3D,
        aTris: document.getElementById("a").player.stats().triangles,
        bTris: document.getElementById("b").player.stats().triangles,
        runtimes: performance.getEntriesByType("resource").map((e) => e.name.split("/").pop()).filter((n) => /^agent3d-/.test(n)),
      }))()`);
      expect(r.full).toBe(true); // the full runtime was imported for #b
      expect(r.aTris).toBe(1); // #a: one full-screen triangle (lite)
      expect(r.bTris as number).toBeGreaterThan(2); // #b: photo quad + text (full)
      expect(r.runtimes).toEqual(expect.arrayContaining(["agent3d-photo.js", "agent3d-runtime.js"]));
      expect(errors).toEqual([]);
    } finally {
      client.close();
      await b.close();
      await server.close();
    }
  }, e2eTimeout(240_000));
});
