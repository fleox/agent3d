// Asset, library, export and render tools.

import type { AssetEntry } from "../core/types";
import { downloadAsset, importAssetZip, listAssets, listLibrary, parseResolution, searchAssetsDetailed, addAsset, type AssetHit } from "../ops/assets";
import { modelFileBounds } from "../ops/gltf";
import { DEFAULT_MAX_SIZE, optimizeAssets } from "../ops/optimize";
import { OpsError } from "../ops/context";
import { buildExport, prefixFiles, type ExportFormat } from "../ops/export";
import { SOURCE_IDS, type SourceId } from "../ops/sources";
import { compactIssues, num, optStr, str } from "./shared";
import { lastRender } from "./sceneTools";
import type { AiTool } from "./types";

const KINDS: AssetEntry["kind"][] = ["model", "texture", "hdri", "audio", "font", "svg", "other"];

export const ASSET_TOOLS: AiTool[] = [
  {
    name: "assets_list",
    description: "List the project's assets (assets/manifest.json + unregistered files): path, kind, size on disk, source, licence, author, and which scene paths use each one (stale manifest sizes are refreshed).",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    async handler(ctx) {
      const r = await listAssets(ctx.fs);
      return { count: r.assets.length, totalKb: r.totalKb, ...(r.refreshed ? { refreshed: r.refreshed } : {}), assets: r.assets.map((a) => ({ path: a.path, kind: a.kind, kb: Math.round(a.bytes / 102.4) / 10, source: a.source, license: a.license, ...(a.author ? { author: a.author } : {}), ...(a.exists ? {} : { missing: true }), usedBy: a.usedBy })) };
    },
  },
  {
    name: "library_list",
    description:
      'Search the built-in asset library (shipped with Agent3D, works offline): models, textures, HDRIs. Use an asset directly in the scene as "library:<id>" (e.g. model src "library:models/nature/pine-tree.glb") — no download, the export copies it. Models list their animation clip names (`animations`, play one with the model object animation { clip }) and triangles. 50 results per page: when `more` is true, call again with `offset`, or `limit: 0` for all. Prefer catalog generators / geometries (zero bytes) and the library before downloading assets.',
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words, e.g. \"tree\", \"rock moss\"." }, kind: { type: "string", enum: KINDS }, limit: { type: "integer", minimum: 0, maximum: 500, description: "Results per page (default 50; 0 = all)." }, offset: { type: "integer", minimum: 0, description: "Skip the first N results (when the previous page returned more: true)." } } },
    mutating: false,
    handler(ctx, input) {
      const index = ctx.host?.library?.index;
      if (!index) return { total: 0, assets: [], hint: "The built-in library is not available in this host." };
      return listLibrary(index, { query: optStr(input, "query"), kind: optStr(input, "kind") as AssetEntry["kind"] | undefined, limit: num(input, "limit"), offset: num(input, "offset") });
    },
  },
  {
    name: "assets_search",
    description:
      `Search free, account-less sources for CC0 / CC-BY assets: polyhaven (HDRIs, PBR textures, models), ambientcg (PBR materials, HDRIs), khronos (glTF sample models; CC0 / CC-BY only), kenney and quaternius (curated CC0 3D packs — no direct download: the user downloads the zip and assets_add imports it with { file }). Returns hits { source, id, title, kind, license, author, previewUrl, downloads }. Pass a hit to assets_add to download it into the project. Needs network.`,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: 'Words, e.g. "sunset sky", "wood planks", "fox".' }, kind: { type: "string", enum: KINDS }, source: { type: "string", enum: SOURCE_IDS }, limit: { type: "integer", minimum: 1, maximum: 50 } },
      required: ["query"],
    },
    mutating: false,
    async handler(ctx, input) {
      if (!ctx.fetch) throw new OpsError("io", "Network access is not available to this tool host.", "Use library_list (offline) or catalog generators instead.");
      const r = await searchAssetsDetailed({ query: str(input, "query"), kind: optStr(input, "kind") as AssetEntry["kind"] | undefined, source: optStr(input, "source") as SourceId | undefined, limit: num(input, "limit") ?? 8 }, ctx.fetch);
      return {
        count: r.hits.length,
        hits: r.hits,
        ...(r.errors.length ? { sourceErrors: r.errors } : {}),
        hint: 'Download with assets_add { "hit": <hit>, "resolution": "1k" } (pass the hit object as returned; resolutions are the keys of `downloads`). 1k is plenty for web embeds; "512" downloads 1k and downscales it. Models come back with `bounds` (size + up-axis guess).',
      };
    },
  },
  {
    name: "assets_add",
    description:
      'Add an asset to the project (written under assets/, licence recorded in assets/manifest.json). Either { "hit": <an assets_search hit>, "resolution": "1k", "name"?: "wood" } to download it, or { "file": "/path/on/disk/pack.zip" | "/path/model.glb", "source": "kenney", "license": "CC0-1.0", "author"?, "filter"?: ["tree"] } to import a local file / pack zip (extracts .glb/.gltf + textures). Returns the project path(s) to use in the scene, plus a ready-made `suggestion` (e.g. a material using a texture set).',
    inputSchema: {
      type: "object",
      properties: {
        hit: { type: "object", description: "A hit from assets_search (source, id, kind, license, downloads…).", additionalProperties: true },
        resolution: { type: "string", description: 'Download key, e.g. "1k", "2k", "1K-JPG", "glb" (default 1k). Below the source minimum ("512", "256"): downloads 1k, then downscales (needs a host with headless Chrome).' },
        maxSize: { type: "integer", minimum: 16, maximum: 8192, description: "Downscale the downloaded textures (also inside .glb) to this longest side in pixels." },
        name: { type: "string", description: "File / folder name in the project (default: the asset id)." },
        file: { type: "string", description: "Local file to import (needs a CLI/MCP host)." },
        source: { type: "string", description: 'Where the local file comes from: "kenney", "quaternius", "local", a URL…' },
        license: { type: "string", description: '"CC0-1.0", "CC-BY-4.0", …' },
        author: { type: "string" },
        filter: { type: "array", items: { type: "string" }, description: "Zip import: only models whose path contains one of these words." },
      },
    },
    mutating: true,
    async handler(ctx, input) {
      if (input.hit) {
        if (!ctx.fetch) throw new OpsError("io", "Network access is not available to this tool host.");
        const hit = input.hit as AssetHit;
        const resolution = optStr(input, "resolution");
        const maxSize = num(input, "maxSize") ?? parseResolution(resolution).maxSize;
        const dl = (codec?: Parameters<typeof optimizeAssets>[2]) => downloadAsset(ctx.fs, hit, ctx.fetch!, { resolution, maxSize, codec, name: optStr(input, "name"), inflate: ctx.host?.inflate });
        const r = maxSize && ctx.host?.withImageCodec ? await ctx.host.withImageCodec((codec) => dl(codec)) : await dl();
        return { path: r.path, files: r.files, kind: r.kind, license: r.license, kb: Math.round(r.bytes / 102.4) / 10, ...(r.bounds ? { bounds: r.bounds } : {}), ...(r.optimized ? { optimized: { maxSize: r.optimized.maxSize, savedKb: r.optimized.savedKb, afterKb: r.optimized.afterKb } } : {}), ...(r.note ? { note: r.note } : {}), ...(r.attribution ? { attribution: r.attribution } : {}), ...(r.suggestion ? { suggestion: r.suggestion } : {}), hint: r.kind === "model" ? `Use it: object_add { "object": { "id": "…", "kind": "model", "src": "${r.path}", "fit": 2 } }.` : "Reference the path(s) in the scene (see suggestion)." };
      }
      const file = optStr(input, "file");
      if (!file) throw new OpsError("invalid", 'assets_add needs "hit" (from assets_search) or "file" (a local file to import).');
      if (!ctx.host?.readLocalFile) throw new OpsError("invalid", "This host cannot read local files.", "Use the CLI: agent3d assets add <file> --license CC0-1.0.");
      const license = str(input, "license");
      const source = optStr(input, "source") ?? "local";
      const bytes = await ctx.host.readLocalFile(file);
      const base = file.split(/[\\/]/).pop() ?? "asset";
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        const r = await importAssetZip(ctx.fs, bytes, { name: optStr(input, "name") ?? base.replace(/\.zip$/i, ""), source, license, author: optStr(input, "author"), filter: Array.isArray(input.filter) ? (input.filter as string[]) : undefined, inflate: ctx.host?.inflate });
        return { imported: r.assets.length, models: r.models.slice(0, 60), ...(r.models.length > 60 ? { moreModels: r.models.length - 60 } : {}), skipped: r.skipped, hint: 'Use a model: object_add { "object": { "id": "…", "kind": "model", "src": "<one of models>", "fit": 2 } }.' };
      }
      const entry = await addAsset(ctx.fs, { path: optStr(input, "name") ?? base, bytes, source, license, author: optStr(input, "author") });
      const bounds = entry.kind === "model" ? await modelFileBounds(ctx.fs, entry.path) : null;
      return { path: entry.path, kind: entry.kind, license: entry.license, ...(bounds ? { bounds } : {}) };
    },
  },
  {
    name: "assets_optimize",
    description:
      'Shrink project textures in place when `check` reports the KB budget is exceeded: downscales .jpg / .png / .webp files to `maxSize` px (format and path kept) and the images embedded in .glb models (opaque PNGs become JPEG), re-encoding at `quality`. A file only changes when it gets smaller; assets/manifest.json sizes are refreshed. Lossy — pass `paths` (files or folders) or `all: true`. Needs a host with headless Chrome (CLI / MCP).',
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: 'Project paths, e.g. ["assets/textures/wood/wood_diff_1k.jpg", "assets/models/fox.glb"] (folders: every image / .glb inside).' },
        all: { type: "boolean", description: "Every texture and .glb under assets/." },
        maxSize: { type: "integer", minimum: 16, maximum: 8192, description: `Longest side in pixels (default ${DEFAULT_MAX_SIZE}; 512 suits banners and small props). Never upscales.` },
        quality: { type: "integer", minimum: 1, maximum: 100, description: "JPEG / WebP quality (default 80)." },
      },
    },
    mutating: true,
    async handler(ctx, input) {
      if (!ctx.host?.withImageCodec) throw new OpsError("invalid", "This host cannot re-encode images (it needs headless Chrome).", "Use the CLI: agent3d assets optimize <path>… --max-size 512 --yes.");
      const raw = Array.isArray(input.paths) ? (input.paths as string[]) : [];
      const paths: string[] = [];
      for (const p of raw) {
        const clean = p.replace(/^\.\//, "").replace(/\/+$/, "");
        if (await ctx.fs.exists(clean)) paths.push(clean);
        else {
          const inside = (await ctx.fs.list(`${clean}/`)).filter((f) => /\.(png|jpe?g|webp|glb)$/i.test(f));
          paths.push(...(inside.length ? inside : [clean]));
        }
      }
      const r = await ctx.host.withImageCodec((codec) => optimizeAssets(ctx.fs, { paths, all: input.all === true, maxSize: num(input, "maxSize"), quality: num(input, "quality") }, codec));
      return { ...r, hint: "Run check again to see the new budget." };
    },
  },
  {
    name: "export",
    description:
      'Build the self-contained embed and write it into the project (default dist/<format>/). "embed": a folder for any static site — agent3d-runtime/ (shared), <name>/scene.json + assets + scripts, index.html (demo page) and snippet.html (paste into the page). "single-html": one <name>.html with everything inline. Library assets are copied; nothing is hotlinked. Run check first; returns the snippet, sizes and budget warnings. When the host can render (CLI / MCP / Studio with Chrome): "poster" writes a still image (dist/poster.webp; `time`, `image`) and "video" a WebM (dist/video.webm; `duration`, `fps`, `size`), returning { path }.',
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["embed", "single-html", "poster", "video"], description: "Default embed. poster / video need a host that can render (Chrome)." },
        name: { type: "string", description: "Folder / file name of the scene in the export (default: project name)." },
        outDir: { type: "string", description: 'Project-relative output folder (default "dist/<format>").' },
        poster: { type: "string", description: "Project path of a PNG/WebP still to use as poster (e.g. a frame from renders/)." },
        out: { type: "string", description: 'poster / video: project-relative output file under dist/ (default "dist/poster.webp" / "dist/video.webm").' },
        time: { type: "number", minimum: 0, description: "poster: time in seconds (default target.posterTime)." },
        image: { type: "string", enum: ["webp", "png"], description: "poster: image format (default webp)." },
        duration: { type: "number", minimum: 0.1, maximum: 120, description: "video: seconds (default the timeline duration, else 5)." },
        fps: { type: "integer", minimum: 1, maximum: 60, description: "video: frames per second (default 30)." },
        size: { type: "string", description: 'poster / video: pixel size "WxH" (default from the target aspect).' },
      },
    },
    mutating: true,
    async handler(ctx, input) {
      const requested = optStr(input, "format") ?? "embed";
      if (requested === "poster" || requested === "video") {
        if (!ctx.host?.media) throw new OpsError("invalid", `This host cannot render a ${requested}.`, `Export it with the CLI: agent3d export --format ${requested} (needs Chrome / Chromium).`);
        const image = (optStr(input, "image") ?? (optStr(input, "out")?.endsWith(".png") ? "png" : "webp")) as "webp" | "png";
        const out = (optStr(input, "out") ?? (requested === "poster" ? `dist/poster.${image}` : "dist/video.webm")).replace(/^\.?\//, "");
        if (!out.startsWith("dist/")) throw new OpsError("invalid", `out must be under dist/ (got "${out}").`, `Use e.g. "dist/${requested === "poster" ? "poster.webp" : "video.webm"}".`);
        const r = await ctx.host.media({ format: requested, image, time: num(input, "time"), duration: num(input, "duration"), fps: num(input, "fps"), size: optStr(input, "size") });
        await ctx.fs.writeBytes(out, r.bytes);
        return { format: requested, path: out, kb: Math.round(r.bytes.byteLength / 102.4) / 10, size: r.size, ...(r.t !== undefined ? { t: r.t } : {}), ...(r.frames !== undefined ? { frames: r.frames, fps: r.fps, duration: r.duration } : {}) };
      }
      const format = requested as ExportFormat;
      if (format !== "embed" && format !== "single-html") throw new OpsError("invalid", `Unknown export format "${requested}".`, "Use embed, single-html, poster or video.");
      if (!ctx.host?.runtimeFiles) throw new OpsError("invalid", "This host cannot provide the runtime files.", "Export with the CLI: agent3d export --format " + format);
      const runtime = { files: await ctx.host.runtimeFiles(format) };
      const library = ctx.host.library ?? { index: { assets: [] }, read: async (id: string) => Promise.reject(new OpsError("notFound", `Library asset ${id} unavailable`)) };
      const posterPath = optStr(input, "poster");
      const poster = posterPath ? await ctx.fs.readBytes(posterPath) : undefined;
      const r = await buildExport(ctx.fs, { format, name: optStr(input, "name"), runtime, library, poster });
      const outDir = (optStr(input, "outDir") ?? `dist/${format}`).replace(/^\.?\//, "");
      if (!outDir.startsWith("dist/") && outDir !== "dist") throw new OpsError("invalid", `outDir must be under dist/ (got "${outDir}").`, 'Use e.g. "dist/embed".');
      for (const [path, content] of Object.entries(prefixFiles(r.files, outDir))) {
        if (typeof content === "string") await ctx.fs.writeText(path, content);
        else await ctx.fs.writeBytes(path, content);
      }
      return { outDir, entry: `${outDir}/${r.entry}`, files: Object.keys(r.files).length, totalKb: r.totalKb, sizes: r.sizes, snippet: r.format === "embed" ? r.snippet : `(single file) ${outDir}/${r.entry}`, credits: r.credits, ...compactIssues(r.issues) };
    },
  },
];

export const RENDER_TOOL: AiTool = {
  name: "render_preview",
  description:
    "Render the scene headless (deterministic) and save PNG frames + a contact sheet into renders/. ALWAYS look at the returned image (sheet) after changes: check composition, framing (nothing cut at the edges of a wide banner), readability of text, colours and lighting, then fix with scene_patch and render again. Returns frame paths (relative to the project folder `dir`), render stats (triangles, draw calls), per-object inspect data (in view / clipped / screen coverage), the game `state` (api.state, e.g. the score), runtime issues and console errors. Games: `input` plays simulated keys / clicks / drags / swipes while seeking, to test them headlessly. check reuses this data for framing / performance issues.",
  inputSchema: {
    type: "object",
    properties: {
      frames: { type: "array", items: { type: "number" }, description: "Times in seconds, e.g. [0, 1.5, 3]." },
      count: { type: "integer", minimum: 1, maximum: 16, description: "Or N evenly spaced frames over the timeline." },
      size: { type: "string", description: 'Pixel size "WxH" (default 1200 wide at the target aspect).' },
      sheet: { type: "boolean", description: "Compose a contact sheet (default true)." },
      input: {
        type: "array",
        description: 'Games: simulated input applied while seeking (frames render in time order). Events: {"t": 0.5, "key": "ArrowRight", "down": true} (down false = release), {"t": 0.5, "key": "Space", "hold": 0.3}, {"t": 1, "click": [0, 0]}, {"t": 1, "pointer": [0.5, -0.2], "down"?: true|false}, {"t": 1, "pointerDown": [0, 0]}, {"t": 2, "pointerUp": [0.4, 0] | true}, {"t": 1, "drag": {"from": [-0.5, 0], "to": [0.5, 0], "duration": 0.4}}, {"t": 1, "swipe": "left"|"right"|"up"|"down"}. key = KeyboardEvent.code; coordinates are -1..1 (y up). Unknown fields are rejected.',
        items: { type: "object", additionalProperties: true },
      },
    },
  },
  mutating: false,
  async handler(ctx, input) {
    if (!ctx.host?.render) throw new OpsError("invalid", "Rendering is not available in this host.", "Use the CLI (agent3d render) — it needs Chrome / Chromium installed.");
    const r = await ctx.host.render({
      frames: Array.isArray(input.frames) ? (input.frames as number[]) : undefined,
      count: num(input, "count"),
      size: optStr(input, "size"),
      sheet: typeof input.sheet === "boolean" ? input.sheet : true,
      ...(Array.isArray(input.input) ? { input: input.input as Record<string, unknown>[] } : {}),
    });
    lastRender.set(ctx.fs, { stats: r.stats, inspect: r.inspect });
    return {
      ...(r.dir ? { dir: r.dir } : {}),
      sheet: r.sheet,
      frames: r.frames,
      ...(r.state && Object.keys(r.state).length ? { state: r.state } : {}),
      stats: r.stats,
      ...(r.inspect ? { inspect: { camera: r.inspect.camera, objects: r.inspect.objects.map((o) => ({ id: o.id, inView: o.inView, coverage: Math.round(o.screenCoverage * 1000) / 1000 })) } } : {}),
      ...compactIssues(r.issues, 30),
      consoleErrors: r.consoleErrors.slice(0, 20),
      hint: r.sheet ? `Open ${r.sheet} and look at it before the next change.` : "Open the frame images and look at them before the next change.",
    };
  },
};
