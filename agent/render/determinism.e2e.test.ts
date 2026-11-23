import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject } from "../../src/ops/project";
import { NodeFs } from "../nodeFs";
import { runtimeBuilt, templatesDir } from "../paths";
import { findBrowser } from "./browser";
import { renderProject } from "./render";
import { tempDir } from "../testing/tmp";
import { e2eTimeout } from "../testing/e2e";

// Deterministic seeks: the same frames rendered several times from fresh page
// loads must give the same game state. Regression for game-platformer, whose
// coins came back from findByTag() in model-load-completion order (the coin
// bob phase depends on the index, so a borderline pickup differed between
// runs). Real runtime (dist/runtime) + a Chromium-family browser, else skipped.

const browser = findBrowser();

function templateFiles(id: string): Record<string, Uint8Array> {
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

describe.skipIf(!browser || !runtimeBuilt())("deterministic game state across renders", () => {
  for (const [id, n] of [["game-platformer", 3], ["game-basket", 2], ["game-physics-playground", 2]] as const) {
    it(`${id}: ${n} renders of the same frames give the same state`, async () => {
      const base = tempDir("agent3d-determinism-");
      try {
        const dir = join(base, id);
        mkdirSync(dir, { recursive: true });
        await createProject(new NodeFs(dir), { name: id, template: id, templateFiles: templateFiles(id) });
        const runs: string[] = [];
        for (let i = 0; i < n; i++) {
          const r = await renderProject({ projectDir: dir, frames: "5,12,20", size: "320x180", capture: "canvas" });
          runs.push(JSON.stringify(r.state));
        }
        expect(runs[0]).not.toBe("null");
        for (const r of runs) expect(r).toBe(runs[0]);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }, e2eTimeout(240_000));
  }
});
