import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import type { AssetEntry } from "../../src/core/types";
import { readLibraryIndex } from "../host";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { confirmOrPlan, jsonObjectOpt, positional, PROJECT_OPTION, projectFs, strOpt, table, usage, YES_OPTION } from "./util";

const KIND_BY_EXT: Record<string, AssetEntry["kind"]> = {
  ".glb": "model",
  ".gltf": "model",
  ".png": "texture",
  ".jpg": "texture",
  ".jpeg": "texture",
  ".webp": "texture",
  ".ktx2": "texture",
  ".hdr": "hdri",
  ".exr": "hdri",
  ".mp3": "audio",
  ".ogg": "audio",
  ".wav": "audio",
  ".m4a": "audio",
  ".ttf": "font",
  ".otf": "font",
  ".woff": "font",
  ".woff2": "font",
  ".json": "font",
  ".svg": "svg",
};

const DIR_BY_KIND: Record<AssetEntry["kind"], string> = { model: "models", texture: "textures", hdri: "hdri", audio: "audio", font: "fonts", svg: "svg", other: "other" };

export const assetsCommand: Command = {
  name: "assets",
  usage: "assets <list|search|add|remove|library> [--project <dir>]",
  summary: "Project assets (assets/ + manifest with licences): list, search free CC0 sources (Poly Haven, ambientCG, Kenney, Quaternius, Khronos), add (local file or a search hit — downloaded once into the project), remove, and browse the built-in library.",
  subcommands: [
    { name: "list", usage: "assets list", summary: "The project's assets (path, kind, size, source, licence)." },
    { name: "search", usage: "assets search <query> [--kind model|texture|hdri] [--source polyhaven|ambientcg|kenney|quaternius|khronos]", summary: "Search free, account-less CC0 sources (network). Hits can be added with `assets add --hit '<json>'`." },
    { name: "add", usage: "assets add <file> [--kind <k>] [--path assets/…] [--license CC0-1.0] [--author <name>] | assets add --hit <json|@file> [--resolution 1k]", summary: "Copy a local file into assets/, or download a search hit (licence recorded in assets/manifest.json).", writes: true },
    { name: "remove", usage: "assets remove <path> [--yes]", summary: "Delete an asset and its manifest entry (plan + needsConfirmation unless --yes).", writes: true, destructive: true },
    { name: "library", usage: "assets library [--query <text>] [--kind <k>]", summary: 'Built-in CC0 assets shipped with Agent3D — reference them as "library:<id>" (no download).' },
  ],
  options: [
    PROJECT_OPTION,
    { name: "kind", type: "string", description: "model, texture, hdri, audio, font, svg or other." },
    { name: "source", type: "string", description: "search: one source only." },
    { name: "query", type: "string", description: "search / library: text to look for." },
    { name: "hit", type: "string", description: "add: a hit from `assets search` (JSON, @file or -)." },
    { name: "resolution", type: "string", description: "add --hit: texture / HDRI resolution (1k, 2k…; default 1k)." },
    { name: "path", type: "string", description: "add: destination path in the project (default assets/<kind>/<file name>)." },
    { name: "license", type: "string", description: "add: the file's licence (SPDX id, e.g. CC0-1.0, CC-BY-4.0)." },
    { name: "author", type: "string", description: "add: author / attribution name." },
    { name: "source-url", type: "string", description: "add: where the file comes from." },
    YES_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action = "list", ...rest] = positionals;
    if (action === "library") {
      const { listLibrary } = await import("../../src/ops/assets");
      const assets = listLibrary(readLibraryIndex(), { query: strOpt(options, "query") ?? rest[0], kind: strOpt(options, "kind") as AssetEntry["kind"] | undefined });
      return printResult(io, { assets }, () => table((assets as unknown as Record<string, unknown>[]).map((a) => ({ ...a, ref: `library:${a.id}` })), ["ref", "kind", "license", "description"]));
    }
    if (action === "search") {
      const query = strOpt(options, "query") ?? rest.join(" ");
      if (!query.trim()) usage("assets search needs a query.", 'e.g. agent3d assets search "pine tree" --kind model');
      const { searchAssets } = await import("../../src/ops/assets");
      const hits = await searchAssets({ query, kind: strOpt(options, "kind") as never, source: strOpt(options, "source") as never }, fetch);
      return printResult(io, { query, hits }, () => table(hits as unknown as Record<string, unknown>[], ["source", "id", "kind", "license", "title"]));
    }
    const fs = projectFs(options);
    if (action === "list") {
      const { listAssets } = await import("../../src/ops/assets");
      const assets = await listAssets(fs);
      return printResult(io, { assets }, () => table(assets as unknown as Record<string, unknown>[], ["path", "kind", "bytes", "source", "license"]));
    }
    if (action === "add") {
      const hit = jsonObjectOpt(options, "hit");
      const ops = await import("../../src/ops/assets");
      if (hit) {
        const entry = await ops.downloadAsset(fs, hit as never, fetch, { resolution: strOpt(options, "resolution") });
        return printResult(io, { asset: entry }, () => `Downloaded ${entry.path} (${entry.license}${entry.author ? `, ${entry.author}` : ""}).`);
      }
      const file = positional(rest, 0, "file to add (or --hit)", "assets add <file> --license CC0-1.0");
      if (!existsSync(file) || !statSync(file).isFile()) throw new CliError("notFound", `${file} does not exist.`, "Give the path of a local file, or add a search hit with --hit.");
      const license = strOpt(options, "license");
      if (!license) usage("--license is required for a local file (the export lists licences).", "e.g. --license CC0-1.0 (your own work: --license proprietary).");
      const kind = (strOpt(options, "kind") as AssetEntry["kind"] | undefined) ?? KIND_BY_EXT[extname(file).toLowerCase()] ?? "other";
      const path = strOpt(options, "path") ?? `assets/${DIR_BY_KIND[kind] ?? "other"}/${basename(file)}`;
      const entry = await ops.addAsset(fs, { path, bytes: new Uint8Array(readFileSync(file)), kind, source: "local", license, author: strOpt(options, "author"), sourceUrl: strOpt(options, "source-url") });
      return printResult(io, { asset: entry }, () => `Added ${(entry as AssetEntry).path ?? path}.`);
    }
    if (action === "remove") {
      const path = positional(rest, 0, "asset path", "assets remove <path>");
      const { listAssets, removeAsset } = await import("../../src/ops/assets");
      const assets = await listAssets(fs);
      const entry = (assets as AssetEntry[]).find((a) => a.path === path);
      if (!entry && !(await fs.exists(path))) throw new CliError("notFound", `No asset "${path}".`, "`agent3d assets list` lists them.");
      if (!confirmOrPlan(io, options, { remove: [path], entry: entry ?? null }, () => `Delete ${path}${entry ? ` (${entry.kind}, ${entry.license})` : ""}`)) return;
      const r = await removeAsset(fs, path);
      return printResult(io, { removed: path, result: r ?? null }, () => `Removed ${path}.`);
    }
    usage(`Unknown assets action "${action}".`, "Use list, search, add, remove or library.");
  },
};
