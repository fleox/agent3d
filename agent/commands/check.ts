import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { readLibraryIndex, readRuntimeFiles } from "../host";
import { printResult } from "../output";
import { runtimeBuilt } from "../paths";
import type { Command } from "./types";
import { boolOpt, PROJECT_OPTION, projectFs, strOpt } from "./util";

export const checkCommand: Command = {
  name: "check",
  usage: "check [--project <dir>] [--render [--out <dir>]]",
  summary: "Pre-export checks: validation, missing assets / scripts, script sandbox lint, budget (triangles per frame with every pass — shadow maps, ao / dof pre-pass, contact shadows — against the per-kind aim and limit; KB), licences needing attribution; with --render also framing and runtime stats from a headless render. Exit 1 when not ok.",
  options: [
    PROJECT_OPTION,
    { name: "render", type: "boolean", description: "Also render one frame headless (Chrome) for real triangle counts and framing (objects out of view, camera inside an object). The frame goes to a temporary folder, one per project and emptied on each run (its absolute path is in `render`), unless --out is given." },
    { name: "out", type: "string", description: "--render: folder for the frame, relative to the project folder (e.g. renders)." },
  ],
  async run({ io, options }) {
    const fs = projectFs(options);
    const { checkProject } = await import("../../src/ops/check");
    let extra: Parameters<typeof checkProject>[1] = { library: readLibraryIndex(), ...(runtimeKb() !== undefined ? { runtimeKb: runtimeKb() } : {}) };
    let renderNote: string | undefined;
    if (boolOpt(options, "render")) {
      const { renderProject } = await import("../render/render");
      const out = strOpt(options, "out");
      // A check must not leave files in the project: temp folder unless --out.
      // One folder per project, emptied on each run, so repeated checks don't pile up.
      const outDir = out ? (isAbsolute(out) ? out : resolve(fs.root, out)) : checkRenderDir(fs.root);
      const r = await renderProject({ projectDir: fs.root, count: 1, outDir });
      extra = { ...extra, ...(r.stats ? { runtimeStats: r.stats } : {}), ...(r.inspect ? { inspect: r.inspect } : {}) };
      const f = r.frames[0]?.path;
      renderNote = f ? (out ? f : resolve(r.dir, f)) : undefined;
    }
    const report = await checkProject(fs, extra);
    printResult(io, { ...report, ...(renderNote ? { render: renderNote } : {}) }, () =>
      [
        report.ok ? "Check passed." : "Check failed.",
        ...report.issues.map((i) => `  ${i.severity === "error" ? "✗" : i.severity === "warning" ? "!" : "·"} ${i.code} ${i.path}: ${i.message}${i.hint ? ` (${i.hint})` : ""}`),
        `Budget: ~${report.budget.triangles} triangles per frame (${report.budget.trianglesSource === "runtime" ? `measured, all passes; estimate ~${report.budget.estimatedFrameTriangles}` : `estimate, all passes; geometry ~${report.budget.estimatedTriangles}`}; aim ≤ ${report.budget.triangleAim}), assets ${report.budget.assetsKb} KB, scripts ${report.budget.scriptsKb} KB / ${report.budget.budgetKb} KB (runtime ${report.budget.runtimeKb} KB)`,
        ...(report.licences.length ? ["Attribution needed:", ...report.licences.map((l) => `  ${l.path}: ${l.license} — ${l.attribution}`)] : []),
      ].join("\n"),
    );
    return report.ok ? 0 : 1;
  },
};

// Size of the runtime an embed export ships (entry + chunks, KB) — the same
// number `export` reports as sizes.runtimeKb.
function runtimeKb(): number | undefined {
  if (!runtimeBuilt()) return undefined;
  const bytes = Object.values(readRuntimeFiles("embed")).reduce((a, f) => a + f.byteLength, 0);
  return Math.round((bytes / 1024) * 10) / 10;
}

function checkRenderDir(projectRoot: string): string {
  const id = createHash("sha1").update(resolve(projectRoot)).digest("hex").slice(0, 10);
  const dir = join(tmpdir(), "agent3d-check", `${basename(projectRoot).replace(/[^\w.-]/g, "_") || "project"}-${id}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
