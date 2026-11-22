import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { LibraryAsset, LibraryIndex, LibraryProvider } from "../src/core/library";
import { CliError } from "./output";
import { libraryDir, RUNTIME_SINGLE, runtimeBuilt, runtimeDir, templatesDir } from "./paths";
import { parseTemplateInfo, type TemplateInfo } from "../src/ops/templates";

// What the Node front doors (CLI, MCP, serve/studio API) provide to the
// engine besides the ProjectFs: the built runtime files (export), the
// built-in library, the templates folder, and the headless render.

export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".git") walk(abs);
      } else if (e.isFile()) out.push(relative(root, abs).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

// dist/runtime files for an export format (path relative to it → bytes):
// embed = agent3d-runtime.js + chunks/; single-html = agent3d-runtime.single.js.
export function readRuntimeFiles(format: "embed" | "single-html" | "zip" = "embed"): Record<string, Uint8Array> {
  if (!runtimeBuilt())
    throw new CliError("runtime-missing", `The runtime build is missing (${join(runtimeDir(), "agent3d-runtime.js")}).`, "Use the npm package (it ships dist/runtime), or run `npm run build:runtime` in a clone. AGENT3D_DIST can point at another dist/ folder.");
  const root = runtimeDir();
  const files: Record<string, Uint8Array> = {};
  for (const f of walkFiles(root)) {
    if (f.endsWith(".map")) continue;
    const keep = format === "single-html" ? f === RUNTIME_SINGLE : f !== RUNTIME_SINGLE && f !== "version.json";
    if (keep) files[f] = new Uint8Array(readFileSync(join(root, f)));
  }
  if (format === "single-html" && !files[RUNTIME_SINGLE])
    throw new CliError("runtime-missing", `The single-file runtime is missing (${join(root, RUNTIME_SINGLE)}).`, "Run `npm run build:runtime` (it builds both runtimes), or export --format embed.");
  return files;
}

let libraryCache: { dir: string; index: LibraryIndex } | null = null;

export function readLibraryIndex(): LibraryIndex {
  const dir = libraryDir();
  if (libraryCache?.dir === dir) return libraryCache.index;
  const file = join(dir, "index.json");
  let index: LibraryIndex = { assets: [] };
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<LibraryIndex> | LibraryAsset[];
      index = Array.isArray(raw) ? { assets: raw } : { ...(raw as LibraryIndex), assets: raw.assets ?? [] };
    } catch {
      /* broken index: empty library */
    }
  }
  libraryCache = { dir, index };
  return index;
}

export function libraryProvider(): LibraryProvider {
  const index = readLibraryIndex();
  return {
    index,
    async read(id: string) {
      const asset = index.assets.find((a) => a.id === id);
      if (!asset) throw new CliError("notFound", `Unknown library asset "${id}".`, "`agent3d assets library` lists the built-in assets (reference them as \"library:<id>\").");
      return new Uint8Array(readFileSync(join(libraryDir(), asset.path)));
    },
  };
}

// templates/<folder>/template.json → TemplateInfo (src/ops/templates.ts).
export function readTemplatesIndex(): TemplateInfo[] {
  const dir = templatesDir();
  if (!existsSync(dir)) return [];
  const out: TemplateInfo[] = [];
  for (const name of readdirSync(dir).sort()) {
    const meta = join(dir, name, "template.json");
    if (!existsSync(meta) || !statSync(join(dir, name)).isDirectory()) continue;
    try {
      out.push(parseTemplateInfo(JSON.parse(readFileSync(meta, "utf8")), name));
    } catch {
      /* skip a broken template */
    }
  }
  return out;
}

// Files of a template folder (project-relative path → bytes), template.json excluded.
export function readTemplateFiles(id: string): Record<string, Uint8Array> {
  const index = readTemplatesIndex();
  const t = index.find((x) => x.id === id);
  if (!t) throw new CliError("notFound", `Unknown template "${id}".`, `\`agent3d templates list\` lists them${index.length ? ` (${index.map((x) => x.id).join(", ")})` : ""}.`);
  const root = join(templatesDir(), folderOf(id));
  const files: Record<string, Uint8Array> = {};
  // template.json and the gallery preview image are template metadata, not project files.
  for (const f of walkFiles(root)) if (f !== "template.json" && f !== "preview.png") files[f] = new Uint8Array(readFileSync(join(root, f)));
  return files;
}

// templates/<folder>/preview.png of a template id (gallery thumbnail), or null.
export function templatePreviewFile(id: string): string | null {
  if (!readTemplatesIndex().some((t) => t.id === id)) return null;
  const file = join(templatesDir(), folderOf(id), "preview.png");
  return existsSync(file) ? file : null;
}

function folderOf(id: string): string {
  const dir = templatesDir();
  for (const name of readdirSync(dir)) {
    const meta = join(dir, name, "template.json");
    if (!existsSync(meta)) continue;
    try {
      if ((JSON.parse(readFileSync(meta, "utf8")) as { id?: string }).id === id) return name;
    } catch {
      /* skip */
    }
    if (name === id) return name;
  }
  return id;
}
