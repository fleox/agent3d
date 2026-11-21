import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeBuilt } from "./paths";
import { findBrowser } from "./render/browser";
import { decodePng, pngVariance } from "./render/png";
import { cli, ok } from "./testing/cli";

// End to end with the REAL runtime (dist/runtime, `npm run build:runtime`)
// and the installed Chrome: new → render --sheet → non-blank PNGs → export.
// Skipped when either is missing.

const ready = !!findBrowser() && !process.env.AGENT3D_DIST && runtimeBuilt();

describe.skipIf(!ready)("e2e: real runtime in headless Chrome", () => {
  it("renders a new banner project to non-blank frames and exports it", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "agent3d-e2e-")), "banner");
    await ok(["new", dir, "--target", "banner", "--title", "E2E"]);
    const r = await ok(["render", "--project", dir, "--count", "2", "--sheet"]);
    expect(r.frames).toHaveLength(2);
    const png = decodePng(readFileSync(r.frames[0].path));
    expect([png.width, png.height]).toEqual([1200, 300]);
    const v = pngVariance(png);
    expect(v.distinct).toBeGreaterThan(20);
    expect(v.stddev).toBeGreaterThan(3);
    expect(existsSync(r.sheet)).toBe(true);
    expect(r.stats.triangles).toBeGreaterThan(0);

    const ex = await cli(["export", "--project", dir]);
    expect({ code: ex.code, err: ex.body.error }).toMatchObject({ code: 0 });
    expect(existsSync(ex.body.data.entry)).toBe(true);
    expect(ex.body.data.snippet).toContain("<agent3d-scene");
    // Exporting again over the folder needs --yes.
    expect((await ok(["export", "--project", dir])).needsConfirmation).toBe(true);
  }, 120_000);
});
