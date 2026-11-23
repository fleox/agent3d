import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CliError, printResult } from "../output";
import { distRoot, isBundled, libraryDir, packageRoot, readVersionInfo, runtimeBuilt, runtimeDir, studioDir, templatesDir } from "../paths";
import type { Command } from "./types";
import { boolOpt } from "./util";

export const versionCommand: Command = {
  name: "version",
  usage: "version",
  summary: "Print the Agent3D version (CLI = runtime = skills version).",
  options: [],
  async run({ io }) {
    const info = readVersionInfo();
    printResult(io, { ...info, bundled: isBundled(), node: process.versions.node }, () => info.version);
  },
};

export interface DoctorCheck {
  id: string;
  ok: boolean;
  message: string;
  hint?: string;
  // Informational checks never fail the doctor.
  optional?: boolean;
  details?: Record<string, unknown>;
}

// The 1-object scene the doctor renders to prove WebGL works headless.
export const DOCTOR_SCENE = {
  version: 1,
  id: "doctor",
  title: "Doctor",
  target: { kind: "square", aspect: "1:1" },
  camera: { type: "perspective", fov: 45, position: [2.5, 2, 3.5], target: [0, 0, 0] },
  environment: { background: "#1d2330" },
  lights: [
    { type: "ambient", intensity: 0.4 },
    { type: "directional", position: [3, 5, 4], intensity: 2 },
  ],
  objects: [{ id: "cube", kind: "mesh", geometry: { type: "box", width: 1.4, height: 1.4, depth: 1.4 }, material: { color: "#ff6a3d", roughness: 0.5 } }],
};

// Only blame the browser when the browser failed: errors with a known code
// keep their own hint; anything else is reported as an Agent3D bug.
const BROWSER_CODES = new Set(["browser-launch", "no-browser", "webgl-unavailable", "cdp-connect"]);
export function renderFailure(e: unknown): DoctorCheck {
  const err = e as Error & { code?: string; hint?: string };
  const code = err instanceof CliError ? err.code : undefined;
  const hint =
    err.hint ??
    (code && BROWSER_CODES.has(code)
      ? "Update Chrome, or point AGENT3D_CHROME at Google Chrome / Chromium (`npx playwright install chromium`)."
      : "The browser started but the test render failed inside Agent3D: retry once, then report it with this output (`agent3d version`).");
  return { id: "render", ok: false, message: `Test render failed${code ? ` (${code})` : ""}: ${err.message}`, hint, ...(code ? { details: { code } } : {}) };
}

export const doctorCommand: Command = {
  name: "doctor",
  usage: "doctor [--no-render]",
  summary: "Check the setup: Node version, installed Chrome (+ version), the runtime / Studio builds, library and templates, and a headless WebGL test render of a 1-object scene (in a temp folder). A failed required check makes the command fail (exit 1, error code doctor-failed, one hint per failed check, every check in error.details.checks).",
  options: [{ name: "no-render", type: "boolean", description: "Skip the test render." }],
  async run({ io, options }) {
    const checks: DoctorCheck[] = [];
    const major = Number(process.versions.node.split(".")[0]);
    checks.push({
      id: "node",
      ok: major >= 22,
      message: `Node ${process.versions.node}${major >= 22 ? "" : " (Agent3D needs Node 22+)"}`,
      ...(major < 22 ? { hint: "Install Node 22 or newer (https://nodejs.org)." } : {}),
    });
    const { findBrowser, browserVersion, noBrowserError } = await import("../render/browser");
    const browser = findBrowser();
    if (browser) {
      const version = await browserVersion(browser.path);
      checks.push({ id: "browser", ok: true, message: `${browser.name}${version ? ` — ${version}` : ""}`, details: { path: browser.path, source: browser.source, version } });
    } else {
      const e = noBrowserError();
      checks.push({ id: "browser", ok: false, message: e.message, hint: e.hint });
    }
    checks.push(
      runtimeBuilt()
        ? { id: "runtime", ok: true, message: `Runtime build found (${runtimeDir()})` }
        : { id: "runtime", ok: false, message: `Runtime build missing (${runtimeDir()})`, hint: "Use the npm package, or run `npm run build:runtime` in a clone (AGENT3D_DIST overrides the dist folder)." },
    );
    const studio = existsSync(join(studioDir(), "index.html"));
    checks.push({ id: "studio", ok: studio, optional: true, message: studio ? `Studio build found (${studioDir()})` : `Studio build missing (${studioDir()}) — \`agent3d studio\` needs it`, ...(studio ? {} : { hint: "Run `npm run build:studio` in a clone (the npm package ships it)." }) });
    const lib = existsSync(join(libraryDir(), "index.json"));
    checks.push({ id: "library", ok: lib, optional: true, message: lib ? `Library found (${libraryDir()})` : `Library index missing (${join(libraryDir(), "index.json")})` });
    const tpl = existsSync(templatesDir());
    checks.push({ id: "templates", ok: tpl, optional: true, message: tpl ? `Templates found (${templatesDir()})` : `Templates folder missing (${templatesDir()})` });

    if (!boolOpt(options, "no-render")) {
      if (!browser || !runtimeBuilt() || major < 22) {
        checks.push({ id: "render", ok: false, message: "Test render skipped (needs Chrome, the runtime build and Node 22+).", hint: "Fix the checks above, then run `agent3d doctor` again." });
      } else {
        // Everything (scene + renders) lives in a fresh temp folder; the
        // result's frame paths are relative to it (`r.dir`).
        const dir = mkdtempSync(join(tmpdir(), "agent3d-doctor-"));
        try {
          writeFileSync(join(dir, "scene.json"), JSON.stringify(DOCTOR_SCENE));
          const { renderProject } = await import("../render/render");
          const { decodePng, pngVariance } = await import("../render/png");
          const t0 = Date.now();
          const r = await renderProject({ projectDir: dir, frames: "0", size: "256x256", outDir: join(dir, "renders"), timeoutMs: 45_000 });
          const v = pngVariance(decodePng(readFileSync(resolve(r.dir, r.frames[0].path))));
          const ok = v.distinct > 1 && v.stddev > 1;
          checks.push({
            id: "render",
            ok,
            message: ok ? `Headless WebGL render OK in ${Date.now() - t0} ms (${v.distinct} colours, ${r.stats?.triangles ?? "?"} triangles)` : "The test render is blank (one flat colour): WebGL draws nothing.",
            ...(ok ? {} : { hint: "Update Chrome, or point AGENT3D_CHROME at Google Chrome / Chromium (`npx playwright install chromium`)." }),
            details: { timings: r.timings, issues: r.issues, consoleErrors: r.consoleErrors },
          });
        } catch (e) {
          checks.push(renderFailure(e));
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    const ok = checks.every((c) => c.ok || c.optional);
    const info = readVersionInfo();
    const human = () =>
      [`agent3d ${info.version} doctor`, ...checks.map((c) => `  ${c.ok ? "✓" : c.optional ? "·" : "✗"} ${c.id.padEnd(9)} ${c.message}${c.hint && !c.ok ? `\n              → ${c.hint}` : ""}`), "", ok ? "All good." : "Some checks failed."].join("\n");
    if (!ok) {
      // A failed required check is a failure of the command: { ok: false,
      // error } with exit 1 (the checks are in error.details).
      const failed = checks.filter((c) => !c.ok && !c.optional);
      if (!io.json) {
        io.out(human());
        return 1;
      }
      throw new CliError(
        "doctor-failed",
        `${failed.length} required check(s) failed: ${failed.map((c) => `${c.id} (${c.message})`).join("; ")}`,
        failed.map((c) => `${c.id}: ${c.hint ?? "see details.checks"}`).join(" | "),
        1,
        { version: info.version, packageRoot: packageRoot(), dist: distRoot(), failed: failed.map((c) => c.id), checks },
      );
    }
    printResult(io, { ok, version: info.version, packageRoot: packageRoot(), dist: distRoot(), checks }, human);
    return 0;
  },
};
