import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFs } from "./nodeFs";

describe("NodeFs", () => {
  it("reads, writes, lists recursively and removes inside the root", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent3d-fs-"));
    const fs = new NodeFs(root);
    await fs.writeText("scene.json", "{}");
    await fs.writeBytes("assets/models/a.glb", new Uint8Array([1, 2, 3]));
    await fs.writeText("./scripts/game.js", "export default () => ({})");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "x");
    expect(await fs.list()).toEqual(["assets/models/a.glb", "scene.json", "scripts/game.js"]);
    expect(await fs.list("assets")).toEqual(["assets/models/a.glb"]);
    expect(await fs.list("assets/")).toEqual(["assets/models/a.glb"]);
    expect(await fs.size("assets/models/a.glb")).toBe(3);
    expect(await fs.exists("assets")).toBe(false);
    expect(await fs.exists("scene.json")).toBe(true);
    expect(await fs.readText("scene.json")).toBe("{}");
    await fs.remove("scene.json");
    await fs.remove("scene.json");
    expect(await fs.exists("scene.json")).toBe(false);
    await expect(fs.readText("nope.json")).rejects.toMatchObject({ name: "FsError", code: "notFound" });
  });

  it("refuses paths that leave the project", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent3d-fs-"));
    const outside = mkdtempSync(join(tmpdir(), "agent3d-out-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(root, "link"));
    const fs = new NodeFs(root);
    for (const p of ["../x", "a/../../x", "/etc/passwd", "C:/Windows/x", "..\\x", "link/secret.txt"]) {
      await expect(fs.readText(p), p).rejects.toMatchObject({ code: "invalidPath" });
    }
    await expect(fs.writeText("link/new.txt", "x")).rejects.toMatchObject({ code: "invalidPath" });
    await expect(fs.writeText("../escape.txt", "x")).rejects.toMatchObject({ code: "invalidPath" });
  });
});
