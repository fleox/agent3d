// Content test for the starter projects shipped in templates/<id>/: every
// template must load, validate, pass `check` with zero errors and only
// reference library assets that exist. (node:fs is used ONLY in this test to
// read the real template folders from disk.)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { LibraryIndex } from "../core/library";
import { normalizeScene, validateScene } from "../core/validate";
import { checkProject } from "./check";
import { instantiateTemplate, parseTemplateInfo } from "./templates";

const ROOT = join(__dirname, "..", "..");
const TEMPLATES = join(ROOT, "templates");
const library = JSON.parse(readFileSync(join(ROOT, "library", "index.json"), "utf8")) as LibraryIndex;
const libraryIds = new Set(library.assets.map((a) => a.id));
const KINDS = ["banner", "hero", "card", "square", "fullscreen", "inline", "game"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function libraryRefs(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && value.startsWith("library:")) out.push(value.slice("library:".length));
  else if (Array.isArray(value)) value.forEach((v) => libraryRefs(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => libraryRefs(v, out));
  return out;
}

const folders = readdirSync(TEMPLATES).filter((n) => statSync(join(TEMPLATES, n)).isDirectory());

describe("templates/ content", () => {
  it("ships a healthy set of templates", () => {
    expect(folders.length).toBeGreaterThanOrEqual(12);
  });

  for (const folder of folders) {
    describe(folder, () => {
      const dir = join(TEMPLATES, folder);
      const files: Record<string, Uint8Array> = {};
      for (const f of walk(dir)) files[relative(dir, f).split("\\").join("/")] = new Uint8Array(readFileSync(f));
      const text = (p: string) => new TextDecoder().decode(files[p]);

      it("has a complete template.json", () => {
        expect(files["template.json"], "template.json").toBeDefined();
        const raw = JSON.parse(text("template.json"));
        for (const k of ["id", "title", "description", "kind", "tags", "aspect"]) expect(raw[k], k).toBeDefined();
        const info = parseTemplateInfo(raw, folder);
        expect(info.id).toBe(folder);
        expect(KINDS).toContain(info.kind);
        expect(info.aspect).toMatch(/^\d+(\.\d+)?:\d+(\.\d+)?$/);
        expect(info.tags.length).toBeGreaterThan(0);
        expect(info.description.length).toBeGreaterThan(30);
        expect(files["README.md"], "README.md").toBeDefined();
        expect(files["agent3d.json"], "agent3d.json").toBeDefined();
        const scene = JSON.parse(text("scene.json"));
        expect(scene.target.kind).toBe(info.kind);
        expect(scene.target.aspect).toBe(info.aspect);
      });

      it("has a valid scene (zero validation errors)", () => {
        const scene = normalizeScene(JSON.parse(text("scene.json")));
        const errors = validateScene(scene).filter((i) => i.severity === "error");
        expect(errors).toEqual([]);
        expect(scene.ariaLabel, "ariaLabel").toBeTruthy();
      });

      it("only references existing library assets", () => {
        const refs = libraryRefs(JSON.parse(text("scene.json")));
        for (const id of refs) expect(libraryIds.has(id), `library:${id}`).toBe(true);
      });

      it("instantiates and passes check with zero errors", async () => {
        const fs = new MemoryFs();
        const { files: written } = await instantiateTemplate(fs, folder, files, { name: folder });
        expect(written).toContain("scene.json");
        const report = await checkProject(fs, { library });
        const errors = report.issues.filter((i) => i.severity === "error");
        expect(errors).toEqual([]);
        expect(report.budget.totalKb).toBeLessThanOrEqual(report.budget.budgetKb);
      });
    });
  }
});
