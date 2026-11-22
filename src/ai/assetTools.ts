// Asset, library, export and render tools.

import type { AssetEntry } from "../core/types";
import { downloadAsset, importAssetZip, listAssets, listLibrary, parseResolution, searchAssetsDetailed, addAsset, type AssetHit } from "../ops/assets";
import { modelFileBounds } from "../ops/gltf";
import { optimizeAssets, optimizedExportSources, type ImageCodec, type TextureFormat } from "../ops/optimize";
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
    description: "List the project's assets (assets/manifest.json + unregistered files): path, kind, size on disk, source, licence, author, and which scene paths use each one (read-only; `stale` lists entries whose manifest size differs from the file — assets_optimize / assets_add rewrite it).",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    async handler(ctx) {
      const r = await listAssets(ctx.fs);
      return { count: r.assets.length, totalKb: r.totalKb, ...(r.stale ? { stale: r.stale } : {}), assets: r.assets.map((a) => ({ path: a.path, kind: a.kind, kb: Math.round(a.bytes / 102.4) / 10, source: a.source, license: a.license, ...(a.author ? { author: a.author } : {}), ...(a.exists ? {} : { missing: true }), usedBy: a.usedBy })) };
    },
  },
  {
    name: "library_list",
    description:
      'Search the built-in asset library (shipped with Agent3D, works offline): models, textures, HDRIs. Use an asset directly in the scene as "library:<id>" (e.g. model src "library:models/nature/pine-tree.glb") — no download, the export copies it. Returns { assets: [{ id, ref, kind, license, tags, description, kb, triangles?, animations?, size? (w × h × d, Y-up) }], total, offset, more } (the list is `assets`, not `hits` as in assets_search). Models list their animation clip names (`animations`, play one with the model object animation { clip }) and triangles. 50 results per page: when `more` is true, call again with `offset`, or `limit: 0` for all. Prefer catalog generators / geometries (zero bytes) and the library before downloading assets.',
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
      'Make project textures and .glb models lighter (run it when `check` reports the KB budget is exceeded, or before export). Textures (.jpg / .png / .webp files and images inside .glb) get the size the scene needs — a smart per-texture size from the target kind, the object\'s size on screen, the camera distance and the role (colour / normal / roughness, background) unless `maxSize` forces one — and are re-encoded as WebP by default (`format`; standalone files are renamed and scene references rewritten; models use EXT_texture_webp). .glb geometry is welded, reordered and meshopt-compressed (`compress`, default true; the runtime decodes it), optionally simplified (`simplify` ratio). A file only changes when it gets smaller; each file reports the size chosen and why. Lossy: call with `dryRun: true` first to show the user the savings, then without it once they agree. Pass `paths` (files or folders) or `all: true`. Textures need a host with headless Chrome (CLI / MCP); geometry does not.',
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: 'Project paths, e.g. ["assets/textures/wood/wood_diff_1k.jpg", "assets/models/fox.glb"] (folders: every image / .glb inside).' },
        all: { type: "boolean", description: "Every texture and .glb under assets/." },
        maxSize: { type: "integer", minimum: 16, maximum: 8192, description: "Force this longest side in pixels for every texture (default: smart size per texture from the scene; never upscales)." },
        quality: { type: "integer", minimum: 1, maximum: 100, description: "WebP / JPEG quality (default 80; normal maps use at least 90)." },
        format: { type: "string", enum: ["auto", "webp", "jpeg", "png", "keep"], description: "Texture output format (default auto = WebP; jpeg keeps images with alpha in their format)." },
        compress: { type: "boolean", description: "Meshopt-compress .glb geometry (default true)." },
        simplify: { type: "number", minimum: 0.01, maximum: 1, description: "Keep this fraction of each .glb mesh's triangles (e.g. 0.5), within simplifyError." },
        simplifyError: { type: "number", minimum: 0.0001, maximum: 1, description: "Max deviation for simplify, as a fraction of the mesh size (default 0.01)." },
        dryRun: { type: "boolean", description: "Encode everything and report the savings, write nothing." },
      },
    },
    mutating: true,
    async handler(ctx, input) {
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
      const opts = { paths, all: input.all === true, maxSize: num(input, "maxSize"), quality: num(input, "quality"), format: optStr(input, "format") as TextureFormat | undefined, compress: input.compress !== false, simplify: num(input, "simplify"), simplifyError: num(input, "simplifyError"), dryRun: input.dryRun === true, library: ctx.host?.library?.index };
      const r = ctx.host?.withImageCodec ? await ctx.host.withImageCodec((codec) => optimizeAssets(ctx.fs, opts, codec)) : await optimizeAssets(ctx.fs, opts);
      return { ...r, hint: r.dryRun ? "Nothing written: show the user the savings, then call again without dryRun." : `Run check again to see the new budget.${ctx.host?.withImageCodec ? "" : " Textures were skipped (this host has no headless Chrome): use the CLI `agent3d assets optimize` for them."}` };
    },
  },
  {
    name: "export",
    description:
      'Build the self-contained embed and write it into the project (default dist/<format>/). "embed": a folder for any static site — agent3d-runtime/ (shared), <name>/scene.json + assets + scripts, index.html (demo page), snippet.html (paste into the page), EMBED.md and frameworks/ (React / Vue / Svelte wrappers). "zip": the same folder as one <name>-embed.zip. "single-html": one <name>.html with everything inline. Library assets are copied; nothing is hotlinked. Options: `baseUrl` (where the folder is served, so the snippet works from any page), `cacheBust` (versioned runtime folder + ?v= hash for long-term caching), `integrity` (SRI hash on the runtime script, default true), `optimize` (export lighter copies of the assets — the project is not modified), `og` (render a 1200×630 og-image.png social preview). Run check first; returns the snippet, sizes and budget warnings. When the host can render (CLI / MCP / Studio with Chrome): "poster" writes a still image (dist/poster.webp; `time`, `image`), "video" an MP4 / WebM (dist/video.webm; `codec`, `duration`, `fps`, `size`), "gif" / "animated-webp" an animated image (dist/animation.gif / .webp), returning { path } — `quality` supersamples, `transparent` keeps the alpha (poster, gif, animated-webp).',
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["embed", "zip", "single-html", "poster", "video", "gif", "animated-webp"], description: "Default embed. poster / video / gif / animated-webp need a host that can render (Chrome)." },
        name: { type: "string", description: "Folder / file name of the scene in the export (default: project name)." },
        outDir: { type: "string", description: 'embed / zip / single-html: project-relative output folder (default "dist/<format>").' },
        poster: { type: "string", description: "Project path of a PNG/WebP still to use as poster (e.g. a frame from renders/)." },
        baseUrl: { type: "string", description: 'embed / zip: URL of the export folder as seen from the pages (default "./"), e.g. "/static/3d/" or "https://cdn.example.com/3d/".' },
        cacheBust: { type: "boolean", description: "embed / zip: versioned runtime folder (agent3d-runtime-<hash>/) and ?v=<hash> on the scene URL, for year-long caching (default false)." },
        integrity: { type: "boolean", description: 'embed / zip: Subresource Integrity (sha384) on the runtime <script> (default true).' },
        extras: { type: "boolean", description: "embed / zip: EMBED.md and framework wrappers (default true)." },
        optimize: { type: "boolean", description: "embed / zip / single-html: export optimised copies of the assets — textures at the size the scene needs, .glb geometry meshopt-compressed (textures need a host with headless Chrome). The project is not modified (default false)." },
        og: { type: "boolean", description: "embed / zip: render a 1200×630 og-image.png social preview (needs a host that can render; default false)." },
        out: { type: "string", description: 'poster / video / gif / animated-webp: project-relative output file under dist/ or renders/ (default "dist/poster.webp", "dist/video.webm" (.mp4 with codec mp4), "dist/animation.gif", "dist/animation.webp").' },
        time: { type: "number", minimum: 0, description: "poster: time in seconds (default target.posterTime)." },
        image: { type: "string", enum: ["webp", "png"], description: "poster: image format (default webp)." },
        codec: { type: "string", enum: ["webm", "mp4"], description: "video: WebM VP9 (default) or MP4 H.264 (needs Google Chrome); an .mp4 `out` implies mp4." },
        duration: { type: "number", minimum: 0.1, maximum: 120, description: "video / gif / animated-webp: seconds (default the timeline duration, else 5)." },
        fps: { type: "integer", minimum: 1, maximum: 60, description: "video / gif / animated-webp: frames per second (default 30 / 15 / 20)." },
        size: { type: "string", description: 'poster / video / gif / animated-webp: pixel size "WxH" (default from the target aspect).' },
        quality: { type: "string", enum: ["draft", "standard", "high", "ultra"], description: "poster / video / gif / animated-webp: supersampling — draft / standard (1×, default), high (2×), ultra (3×)." },
        transparent: { type: "boolean", description: "poster / gif / animated-webp: transparent background (alpha)." },
      },
    },
    mutating: true,
    async handler(ctx, input) {
      const requested = optStr(input, "format") ?? "embed";
      if ((MEDIA_FORMATS as readonly string[]).includes(requested)) return mediaExport(ctx, requested as (typeof MEDIA_FORMATS)[number], input);
      const format = requested as ExportFormat;
      if (format !== "embed" && format !== "single-html" && format !== "zip") throw new OpsError("invalid", `Unknown export format "${requested}".`, `Use ${["embed", "zip", "single-html", ...MEDIA_FORMATS].join(", ")}.`);
      if (!ctx.host?.runtimeFiles) throw new OpsError("invalid", "This host cannot provide the runtime files.", "Export with the CLI: agent3d export --format " + format);
      const quality = optStr(input, "quality");
      if (quality !== undefined && !QUALITIES.includes(quality)) throw new OpsError("invalid", `Unknown quality "${quality}".`, `Use ${QUALITIES.join(", ")}.`);
      const outDir = (optStr(input, "outDir") ?? `dist/${format}`).replace(/^\.?\//, "");
      if (!outDir.startsWith("dist/") && outDir !== "dist") throw new OpsError("invalid", `outDir must be under dist/ (got "${outDir}").`, 'Use e.g. "dist/embed".');
      const wantsOg = input.og === true && format !== "single-html";
      if (wantsOg && !ctx.host.media) throw new OpsError("invalid", "This host cannot render the og image.", "Export without og, or with the CLI: agent3d export (renders the poster and og-image.png with Chrome).");
      const runtime = { files: await ctx.host.runtimeFiles(format) };
      let library = ctx.host.library ?? { index: { assets: [] }, read: async (id: string) => Promise.reject(new OpsError("notFound", `Library asset ${id} unavailable`)) };
      const posterPath = optStr(input, "poster");
      const poster = posterPath ? await ctx.fs.readBytes(posterPath) : undefined;
      const ogImage = wantsOg ? (await ctx.host.media!({ format: "og" })).bytes : undefined;
      const build = async (fs: typeof ctx.fs, lib: typeof library) =>
        buildExport(fs, {
          format,
          name: optStr(input, "name"),
          runtime,
          library: lib,
          poster,
          ogImage,
          baseUrl: optStr(input, "baseUrl"),
          cacheBust: input.cacheBust === true,
          integrity: input.integrity !== false,
          extras: input.extras !== false,
        });
      let optimized: unknown;
      let r: Awaited<ReturnType<typeof buildExport>>;
      if (input.optimize === true) {
        const run = async (codec?: ImageCodec) => {
          const o = await optimizedExportSources(ctx.fs, library, { codec });
          library = o.library;
          const res = await build(o.fs, o.library);
          optimized = o.report();
          return res;
        };
        r = ctx.host.withImageCodec ? await ctx.host.withImageCodec((codec) => run(codec)) : await run();
      } else r = await build(ctx.fs, library);
      for (const [path, content] of Object.entries(prefixFiles(r.files, outDir))) {
        if (typeof content === "string") await ctx.fs.writeText(path, content);
        else await ctx.fs.writeBytes(path, content);
      }
      return {
        format,
        outDir,
        entry: `${outDir}/${r.entry}`,
        files: Object.keys(r.files).length,
        totalKb: r.totalKb,
        sizes: r.sizes,
        snippet: format === "single-html" ? `(single file) ${outDir}/${r.entry}` : r.snippet,
        ...(r.head ? { head: r.head } : {}),
        ...(r.runtimeDir ? { runtimeDir: r.runtimeDir } : {}),
        ...(ogImage ? { ogImage: true } : {}),
        ...(optimized ? { optimized } : {}),
        credits: r.credits,
        ...compactIssues(r.issues),
        ...(input.optimize === true && !ctx.host.withImageCodec ? { hint: "Textures were not resized (this host has no headless Chrome); geometry was compressed." } : {}),
      };
    },
  },
];

const MEDIA_FORMATS = ["poster", "video", "gif", "animated-webp"] as const;
const QUALITIES = ["draft", "standard", "high", "ultra"];

async function mediaExport(ctx: Parameters<AiTool["handler"]>[0], requested: (typeof MEDIA_FORMATS)[number], input: Record<string, unknown>) {
  if (!ctx.host?.media) throw new OpsError("invalid", `This host cannot render a ${requested}.`, `Export it with the CLI: agent3d export --format ${requested === "animated-webp" ? "gif" : requested} (needs Chrome / Chromium).`);
  const quality = optStr(input, "quality");
  if (quality !== undefined && !QUALITIES.includes(quality)) throw new OpsError("invalid", `Unknown quality "${quality}".`, `Use ${QUALITIES.join(", ")}.`);
  const outIn = optStr(input, "out")?.replace(/^\.?\//, "");
  const image = (optStr(input, "image") ?? (outIn?.endsWith(".png") ? "png" : "webp")) as "webp" | "png";
  const codec = (optStr(input, "codec") ?? (outIn?.toLowerCase().endsWith(".mp4") ? "mp4" : "webm")) as "webm" | "mp4";
  if (codec !== "webm" && codec !== "mp4") throw new OpsError("invalid", `Unknown codec "${codec}".`, "Use webm or mp4.");
  const def = requested === "poster" ? `dist/poster.${image}` : requested === "video" ? `dist/video.${codec}` : requested === "gif" ? "dist/animation.gif" : "dist/animation.webp";
  const out = outIn ?? def;
  if (!out.startsWith("dist/") && !out.startsWith("renders/")) throw new OpsError("invalid", `out must be under dist/ or renders/ (got "${out}").`, `Use e.g. "${def}".`);
  const ext = out.split(".").pop()?.toLowerCase();
  const wantExt = requested === "poster" ? ["webp", "png"] : requested === "video" ? [codec] : requested === "gif" ? ["gif"] : ["webp"];
  if (!ext || !wantExt.includes(ext)) throw new OpsError("invalid", `out "${out}" does not match the ${requested} format (expected .${wantExt.join(" / .")}).`, `Use e.g. "${def}".`);
  const r = await ctx.host.media({
    format: requested === "animated-webp" ? "webp" : requested,
    image,
    time: num(input, "time"),
    duration: num(input, "duration"),
    fps: num(input, "fps"),
    size: optStr(input, "size"),
    ...(requested === "video" ? { video: codec } : {}),
    ...(quality ? { quality: quality as "draft" } : {}),
    ...(input.transparent === true ? { transparent: true } : {}),
  });
  await ctx.fs.writeBytes(out, r.bytes);
  return { format: requested, path: out, kb: Math.round(r.bytes.byteLength / 102.4) / 10, size: r.size, ...(r.codec ? { codec: r.codec } : {}), ...(r.t !== undefined ? { t: r.t } : {}), ...(r.frames !== undefined ? { frames: r.frames, fps: r.fps, duration: r.duration } : {}) };
}

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
      isolate: { type: "string", description: "Render only this object id, auto-framed from the front (+Z) three-quarter view on a neutral background — check a model's orientation / size after assets_add." },
      bg: { type: "string", description: 'Background under the frames: "checker", a CSS colour or "none" (default: checkerboard under the sheet of transparent scenes).' },
      maxWidth: { type: "integer", minimum: 0, maximum: 4096, description: "Width in pixels of the image returned to the client (MCP image block): the sheet / first frame is scaled down to it to save context (default 800; 0 = full size). Full-size PNGs stay on disk (sheet, frames)." },
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
      previewWidth: num(input, "maxWidth") ?? 800,
      ...(optStr(input, "isolate") ? { isolate: optStr(input, "isolate") } : {}),
      ...(optStr(input, "bg") ? { bg: optStr(input, "bg") } : {}),
      ...(Array.isArray(input.input) ? { input: input.input as Record<string, unknown>[] } : {}),
    });
    lastRender.set(ctx.fs, { stats: r.stats, inspect: r.inspect });
    return {
      ...(r.dir ? { dir: r.dir } : {}),
      sheet: r.sheet,
      ...(r.preview ? { preview: r.preview } : {}),
      ...(r.isolated ? { isolated: r.isolated } : {}),
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
