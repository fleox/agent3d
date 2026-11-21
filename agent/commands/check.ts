import { statSync } from "node:fs";
import { join } from "node:path";
import { readLibraryIndex } from "../host";
import { printResult } from "../output";
import { RUNTIME_ENTRY, runtimeBuilt, runtimeDir } from "../paths";
import type { Command } from "./types";
import { boolOpt, PROJECT_OPTION, projectFs } from "./util";

export const checkCommand: Command = {
  name: "check",
  usage: "check [--project <dir>] [--render]",
  summary: "Pre-export checks: validation, missing assets / scripts, script sandbox lint, budget (triangles, KB), licences needing attribution; with --render also framing and runtime stats from a headless render. Exit 1 when not ok.",
  options: [PROJECT_OPTION, { name: "render", type: "boolean", description: "Also render one frame headless (Chrome) for real triangle counts and framing (objects out of view, camera inside an object)." }],
  async run({ io, options }) {
    const fs = projectFs(options);
    const { checkProject } = await import("../../src/ops/check");
    let extra: Parameters<typeof checkProject>[1] = { library: readLibraryIndex(), ...(runtimeKb() !== undefined ? { runtimeKb: runtimeKb() } : {}) };
    let renderNote: string | undefined;
    if (boolOpt(options, "render")) {
      const { renderProject } = await import("../render/render");
      const r = await renderProject({ projectDir: fs.root, count: 1, outDir: `${fs.root}/renders` });
      extra = { ...extra, ...(r.stats ? { runtimeStats: r.stats } : {}), ...(r.inspect ? { inspect: r.inspect } : {}) };
      renderNote = r.frames[0]?.path;
    }
    const report = await checkProject(fs, extra);
    printResult(io, { ...report, ...(renderNote ? { render: renderNote } : {}) }, () =>
      [
        report.ok ? "Check passed." : "Check failed.",
        ...report.issues.map((i) => `  ${i.severity === "error" ? "✗" : i.severity === "warning" ? "!" : "·"} ${i.code} ${i.path}: ${i.message}${i.hint ? ` (${i.hint})` : ""}`),
        `Budget: ~${report.budget.estimatedTriangles} triangles, assets ${report.budget.assetsKb} KB, scripts ${report.budget.scriptsKb} KB / ${report.budget.budgetKb} KB (runtime ${report.budget.runtimeKb} KB)`,
        ...(report.licences.length ? ["Attribution needed:", ...report.licences.map((l) => `  ${l.path}: ${l.license} — ${l.attribution}`)] : []),
      ].join("\n"),
    );
    return report.ok ? 0 : 1;
  },
};

// Size of the runtime entry the export ships (KB); lazy chunks load on demand.
function runtimeKb(): number | undefined {
  if (!runtimeBuilt()) return undefined;
  return Math.round((statSync(join(runtimeDir(), RUNTIME_ENTRY)).size / 1024) * 10) / 10;
}
