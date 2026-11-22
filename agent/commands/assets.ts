import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { AssetEntry } from "../../src/core/types";
import type { ImageCodec } from "../../src/ops/optimize";
import { readLibraryIndex } from "../host";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { boolOpt, confirmOrPlan, jsonObjectOpt, numOpt, positional, PROJECT_OPTION, projectFs, strOpt, table, usage, YES_OPTION } from "./util";

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
  usage: "assets <list|search|add|optimize|remove|library> [--project <dir>]",
  summary: "Project assets (assets/ + manifest with licences): list, search free CC0 sources (Poly Haven, ambientCG, Kenney, Quaternius, Khronos), add (local file or a search hit — downloaded once into the project), optimize (downscale textures, also inside .glb), remove, and browse the built-in library.",
  subcommands: [
    { name: "list", usage: "assets list", summary: "The project's assets (path, kind, size on disk, source, licence). Stale manifest sizes are refreshed (`refreshed` lists them)." },
    { name: "search", usage: "assets search <query> [--kind model|texture|hdri] [--source polyhaven|ambientcg|kenney|quaternius|khronos]", summary: "Search free, account-less CC0 sources (network). Hits can be added with `assets add --hit '<json>'`." },
    { name: "add", usage: "assets add <file> [--kind <k>] [--path assets/…] [--license CC0-1.0] [--author <name>] | assets add <pack.zip> --source kenney|quaternius|local --license CC0-1.0 [--filter <word>]… [--name <pack>] | assets add --hit <json|@file> [--resolution 1k|512] [--max-size <px>]", summary: "Copy a local file into assets/, import a Kenney / Quaternius pack zip (only .glb/.gltf + textures, --filter keeps models whose path contains a word), or download a search hit (licence recorded in assets/manifest.json). Models return `bounds` (size w × h × d in model units + up-axis guess). --resolution below 1k (e.g. 512) downloads 1k and downscales (headless Chrome).", writes: true },
    { name: "optimize", usage: "assets optimize [<path>…] [--all] [--max-size 1024] [--quality 80] [--yes]", summary: "Downscale / re-encode textures to cut the bundle size: .jpg / .png / .webp files (format and path kept) and the images embedded in .glb models (opaque PNGs become JPEG). Files only change when they get smaller; manifest sizes are refreshed. Lossy: prints a plan unless --yes. Needs headless Chrome.", writes: true, destructive: true },
    { name: "remove", usage: "assets remove <path> [--yes]", summary: "Delete an asset and its manifest entry (plan + needsConfirmation unless --yes).", writes: true, destructive: true },
    { name: "library", usage: "assets library [--query <text>] [--kind <k>] [--limit 50] [--offset 0] [--all]", summary: 'Built-in CC0 assets shipped with Agent3D — reference them as "library:<id>" (no download). Shows animation clips and triangles of models; 50 results per page (`more: true` → next page with --offset, or --all).' },
  ],
  options: [
    PROJECT_OPTION,
    { name: "kind", type: "string", description: "model, texture, hdri, audio, font, svg or other." },
    { name: "source", type: "string", description: "search: one source only. add: where the file / pack comes from (kenney, quaternius, local — default local)." },
    { name: "filter", type: "string", multiple: true, description: "add <pack.zip>: only import models whose path contains this word (repeatable: --filter coin --filter flag)." },
    { name: "name", type: "string", description: "add <pack.zip>: folder name under assets/models/ (default: the zip name)." },
    { name: "query", type: "string", description: "search / library: text to look for." },
    { name: "limit", type: "string", description: "library: results per page (default 50)." },
    { name: "offset", type: "string", description: "library: skip the first N results (paging)." },
    { name: "all", type: "boolean", description: "library: every match, no limit. optimize: every texture and .glb under assets/." },
    { name: "hit", type: "string", description: "add: a hit from `assets search` (JSON, @file or -)." },
    { name: "resolution", type: "string", description: "add --hit: texture / HDRI resolution (1k, 2k…; default 1k). Lower values (512, 256) download 1k and downscale to that size." },
    { name: "max-size", type: "string", description: "optimize / add --hit: longest texture side in pixels (optimize default 1024; never upscales)." },
    { name: "quality", type: "string", description: "optimize / add --hit: JPEG / WebP quality 1-100 (default 80)." },
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
      const r = listLibrary(readLibraryIndex(), { query: strOpt(options, "query") ?? rest[0], kind: strOpt(options, "kind") as AssetEntry["kind"] | undefined, limit: boolOpt(options, "all") ? 0 : numOpt(options, "limit"), offset: numOpt(options, "offset") });
      const rows = r.assets.map((a) => ({ ...a, clips: a.animations?.join(", ") ?? "" }));
      return printResult(io, r, () => `${table(rows as unknown as Record<string, unknown>[], ["ref", "kind", "kb", "triangles", "clips", "description"])}\n${r.offset + 1}–${r.offset + r.assets.length} of ${r.total}${r.more ? ` (next page: --offset ${r.offset + r.assets.length}, or --all)` : ""}`);
    }
    if (action === "search") {
      const query = strOpt(options, "query") ?? rest.join(" ");
      if (!query.trim()) usage("assets search needs a query.", 'e.g. agent3d assets search "pine tree" --kind model');
      const { searchAssetsDetailed } = await import("../../src/ops/assets");
      const r = await searchAssetsDetailed({ query, kind: strOpt(options, "kind") as never, source: strOpt(options, "source") as never }, fetch as never);
      return printResult(io, { query, ...r }, () => [table(r.hits as unknown as Record<string, unknown>[], ["source", "id", "kind", "license", "title"]), ...r.errors.map((e) => `! ${e.source}: ${e.message}`)].join("\n"));
    }
    const fs = projectFs(options);
    if (action === "list") {
      const { listAssets } = await import("../../src/ops/assets");
      const r = await listAssets(fs);
      return printResult(io, r, () => `${table(r.assets as unknown as Record<string, unknown>[], ["path", "kind", "bytes", "source", "license"])}\nTotal ${r.totalKb} KB`);
    }
    if (action === "add") {
      const hit = jsonObjectOpt(options, "hit");
      const ops = await import("../../src/ops/assets");
      if (hit) {
        const resolution = strOpt(options, "resolution");
        const maxSize = numOpt(options, "max-size") ?? ops.parseResolution(resolution).maxSize;
        const dl = (codec?: ImageCodec) => ops.downloadAsset(fs, hit as never, fetch as never, { resolution, maxSize, quality: numOpt(options, "quality"), codec, inflate: (d) => new Uint8Array(inflateRawSync(d)) });
        let entry;
        if (maxSize && (await import("../render/browser")).findBrowser()) {
          const { withImageCodec } = await import("../render/imageCodec");
          entry = await withImageCodec((codec) => dl(codec), { log });
        } else entry = await dl();
        return printResult(io, { asset: entry }, () =>
          [`Downloaded ${entry.path} (${entry.license}${entry.author ? `, ${entry.author}` : ""}, ${Math.round(entry.bytes / 1024)} KB).`, ...(entry.bounds ? [`Bounds ${entry.bounds.size.join(" × ")} (w × h × d), up axis ${entry.bounds.upAxis}`] : []), ...(entry.optimized ? [`Downscaled to ${entry.optimized.maxSize} px: saved ${entry.optimized.savedKb} KB`] : []), ...(entry.note ? [entry.note] : [])].join("\n"),
        );
      }
      const file = positional(rest, 0, "file to add (or --hit)", "assets add <file> --license CC0-1.0");
      if (!existsSync(file) || !statSync(file).isFile()) throw new CliError("notFound", `${file} does not exist.`, "Give the path of a local file, or add a search hit with --hit.");
      const license = strOpt(options, "license");
      if (!license) usage("--license is required for a local file (the export lists licences).", "e.g. --license CC0-1.0 (your own work: --license proprietary).");
      const bytes = new Uint8Array(readFileSync(file));
      const source = strOpt(options, "source") ?? "local";
      if (extname(file).toLowerCase() === ".zip" || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03)) {
        const raw = options.filter;
        const filter = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).flatMap((w) => w.split(",")).map((w) => w.trim()).filter(Boolean);
        const name = strOpt(options, "name") ?? basename(file).replace(/\.zip$/i, "");
        const r = await ops.importAssetZip(fs, bytes, { name, source, license, author: strOpt(options, "author") ?? (source === "kenney" ? "Kenney" : source === "quaternius" ? "Quaternius" : undefined), sourceUrl: strOpt(options, "source-url"), filter: filter.length ? filter : undefined, inflate: (d) => new Uint8Array(inflateRawSync(d)) });
        const data = { imported: r.assets.length, models: r.models, skipped: r.skipped, totalKb: Math.round(r.assets.reduce((n, a) => n + a.bytes, 0) / 102.4) / 10, hint: "Use a model: agent3d object add --id <id> --kind model --src <one of models> --set fit=2" };
        return printResult(io, data, () => `Imported ${r.assets.length} files (${data.totalKb} KB):\n${r.models.map((m) => `  ${m}`).join("\n")}${r.skipped ? `\n${r.skipped} files skipped (too many): use --filter.` : ""}`);
      }
      const kind = (strOpt(options, "kind") as AssetEntry["kind"] | undefined) ?? KIND_BY_EXT[extname(file).toLowerCase()] ?? "other";
      const path = strOpt(options, "path") ?? `assets/${DIR_BY_KIND[kind] ?? "other"}/${basename(file)}`;
      const entry = await ops.addAsset(fs, { path, bytes, kind, source, license, author: strOpt(options, "author"), sourceUrl: strOpt(options, "source-url") });
      const { modelFileBounds } = await import("../../src/ops/gltf");
      const bounds = kind === "model" ? await modelFileBounds(fs, entry.path) : null;
      return printResult(io, { asset: { ...entry, ...(bounds ? { bounds } : {}) } }, () => `Added ${entry.path}.${bounds ? ` Bounds ${bounds.size.join(" × ")} (w × h × d), up axis ${bounds.upAxis}.` : ""}`);
    }
    if (action === "optimize") {
      const { optimizeAssets, optimizeTargets, DEFAULT_MAX_SIZE, DEFAULT_QUALITY } = await import("../../src/ops/optimize");
      const all = boolOpt(options, "all");
      if (!rest.length && !all) usage("assets optimize needs paths or --all.", "e.g. agent3d assets optimize assets/textures/wood --max-size 512 --yes, or --all (`agent3d assets list` shows sizes).");
      const paths = await expandPaths(fs, rest);
      const maxSize = numOpt(options, "max-size") ?? DEFAULT_MAX_SIZE;
      const quality = numOpt(options, "quality") ?? DEFAULT_QUALITY;
      const { targets, skipped } = await optimizeTargets(fs, { paths, all });
      if (!targets.length) return printResult(io, { files: [], skipped, beforeKb: 0, afterKb: 0, savedKb: 0, maxSize, quality }, () => `Nothing to optimise.${skipped.map((s) => `\n  ${s.path}: ${s.reason}`).join("")}`);
      const sizes = await Promise.all(targets.map(async (t) => ({ path: t, kb: Math.round((await fs.size(t)) / 102.4) / 10 })));
      if (!confirmOrPlan(io, options, { optimize: sizes, maxSize, quality, lossy: true }, () => `Re-encode ${targets.length} file(s) in place (max ${maxSize} px, quality ${quality}, lossy):\n${sizes.map((s) => `  ${s.path} (${s.kb} KB)`).join("\n")}`)) return;
      const { withImageCodec } = await import("../render/imageCodec");
      const r = await withImageCodec((codec) => optimizeAssets(fs, { paths: targets, maxSize, quality }, codec), { log });
      r.skipped.unshift(...skipped);
      return printResult(io, r, () =>
        [...r.files.map((f) => `${f.changed ? "✓" : "·"} ${f.path}  ${Math.round(f.beforeBytes / 1024)} KB → ${Math.round(f.afterBytes / 1024)} KB${f.images.length ? `\n${f.images.map((i) => `    ${i.name}: ${i.from} → ${i.to}${i.replaced ? "" : " (kept)"}`).join("\n")}` : ""}${f.note ? `  (${f.note})` : ""}`), ...r.skipped.map((s) => `! ${s.path}: ${s.reason}`), `Saved ${r.savedKb} KB (${r.beforeKb} → ${r.afterKb} KB).`].join("\n"),
      );
    }
    if (action === "remove") {
      const path = positional(rest, 0, "asset path", "assets remove <path>");
      const { listAssets, removeAsset } = await import("../../src/ops/assets");
      const { assets } = await listAssets(fs);
      const entry = assets.find((a) => a.path === path);
      if (!entry && !(await fs.exists(path))) throw new CliError("notFound", `No asset "${path}".`, "`agent3d assets list` lists them.");
      if (!confirmOrPlan(io, options, { remove: [path], entry: entry ?? null, usedBy: entry?.usedBy ?? [] }, () => `Delete ${path}${entry ? ` (${entry.kind}, ${entry.license})` : ""}`)) return;
      const r = await removeAsset(fs, path);
      return printResult(io, { path, ...r }, () => `Removed ${path}.${r.usedBy.length ? ` Still referenced by: ${r.usedBy.join(", ")} — fix those references.` : ""}`);
    }
    usage(`Unknown assets action "${action}".`, "Use list, search, add, optimize, remove or library.");
  },
};

const log = (m: string) => void process.stderr.write(`${m}\n`);

// Folders → the optimisable files inside them.
async function expandPaths(fs: { exists(p: string): Promise<boolean>; list(prefix?: string): Promise<string[]> }, paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of paths) {
    const p = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    if (await fs.exists(p)) out.push(p);
    else {
      const inside = (await fs.list(`${p}/`)).filter((f) => /\.(png|jpe?g|webp|glb)$/i.test(f));
      out.push(...(inside.length ? inside : [p]));
    }
  }
  return out;
}
