// Export: builds the file map of a self-contained embed (pure — the front
// door writes the files). Formats (CLAUDE.md "Export format"):
//
// embed        <out>/agent3d-runtime/…  <name>/scene.json assets/ scripts/ poster  index.html  snippet.html
// single-html  <name>.html — single-file runtime inline, scene inline in the
//              <agent3d-scene> element, assets as data: URIs (<script data-assets>,
//              → MountOptions.assetUrls), scripts inline (<script type="text/agent3d-script">,
//              → MountOptions.scriptSources).
//
// zip          the embed folder as one <name>-embed.zip (deflate when the platform
//              has CompressionStream, stored otherwise).
//
// "library:<id>" references are copied into <name>/assets/library/ and the
// exported scene points at the copies. Exports never hotlink.
//
// Embed extras: <name>/poster.webp (+ .avif when given), <name>/og-image.png,
// EMBED.md (how to publish it), frameworks/ (React / Vue / Svelte wrappers +
// .d.ts), Subresource Integrity on the runtime script, modulepreload hints,
// --base-url (absolute / sub-path URLs) and --cache-bust (versioned runtime folder).

import { substituteData } from "../core/data";
import type { ProjectFs } from "../core/fs";
import { slugify } from "../core/ids";
import { findLibraryAsset, isLibraryRef, libraryId, type LibraryProvider } from "../core/library";
import { clone } from "../core/jsonPath";
import { parseAspect } from "../core/aspect";
import type { AssetEntry, Issue, SceneDoc, TargetKind } from "../core/types";
import { DEFAULT_BUDGET_KB, validateScene } from "../core/validate";
import { dataUri } from "./base64";
import { attributionText } from "./check";
import { KB, OpsError, hasErrors, readJsonOr, validationError } from "./context";
import { MANIFEST_FILE, readSceneFile } from "./project";
import { gltfDependencies, mimeFromPath, visitAssetRefs } from "./refs";
import { readAssetManifest } from "./assets";
import { crc32 } from "./zip";
import { ELEMENT_DTS, embedGuide, reactWrapper, svelteWrapper, vueWrapper, type EmbedDocInput } from "./exportFrameworks";

export type ExportFormat = "embed" | "single-html" | "zip";

// dist/runtime content: for embed the main file "agent3d-runtime.js" + "chunks/…";
// for single-html the single file "agent3d-runtime.single.js".
export interface RuntimeFiles {
  files: Record<string, Uint8Array>;
}

export interface ExportOptions {
  format: ExportFormat;
  name?: string;
  runtime: RuntimeFiles;
  library: LibraryProvider;
  poster?: Uint8Array;
  // Extra encodings of the same poster (served with <picture>-like fallback: avif first).
  posterAvif?: Uint8Array;
  // Pixel size of the poster (width/height attributes → no layout shift before load).
  posterSize?: { width: number; height: number };
  // 1200×630 social preview (embed / zip: <name>/og-image.png).
  ogImage?: Uint8Array;
  // URL of the export folder as seen from the page: "./" (default), "/static/3d/", "https://cdn.example/3d/".
  baseUrl?: string;
  // Subresource Integrity (sha384) on the runtime <script> / modulepreload (default true).
  integrity?: boolean;
  // Versioned runtime folder (agent3d-runtime-<hash>/) + ?v=<hash> on the scene URL: long-term caching.
  cacheBust?: boolean;
  // Framework wrappers + EMBED.md (default true).
  extras?: boolean;
  // Runtime version written in EMBED.md.
  version?: string;
  // zip: raw-deflate function (default CompressionStream("deflate-raw") when available, else stored).
  deflate?: (data: Uint8Array) => Promise<Uint8Array>;
}

export interface ExportCredit {
  path: string;
  license: string;
  author?: string;
  source?: string;
  attribution?: string;
}

export interface ExportResult {
  format: ExportFormat;
  name: string;
  // Relative to the export root.
  files: Record<string, Uint8Array | string>;
  snippet: string;
  entry: string; // the file to open: "index.html" or "<name>.html"
  totalKb: number;
  sizes: { runtimeKb: number; sceneKb: number; assetsKb: number; scriptsKb: number; posterKb: number };
  credits: ExportCredit[];
  issues: Issue[];
  // embed / zip: the folder holding the runtime ("agent3d-runtime" or "agent3d-runtime-<hash>"),
  // the SRI hash of the runtime entry and the <head> hints (modulepreload).
  runtimeDir?: string;
  integrity?: string;
  head?: string;
}

const enc = new TextEncoder();
const byteLen = (v: Uint8Array | string) => (typeof v === "string" ? enc.encode(v).byteLength : v.byteLength);
const SINGLE_HTML_WARN_BYTES = 5 * 1024 * 1024;
const PRELOAD_MIN_BYTES = 100 * 1024;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// JSON safe to inline in <script type="application/json">.
export function inlineJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// JS safe to inline in <script>.
export function inlineJs(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function posterInfo(bytes: Uint8Array): { ext: string; mime: string } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { ext: "png", mime: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { ext: "jpg", mime: "image/jpeg" };
  return { ext: "webp", mime: "image/webp" };
}

function pickRuntime(runtime: RuntimeFiles, format: ExportFormat): string {
  const keys = Object.keys(runtime?.files ?? {});
  const js = keys.filter((k) => /\.m?js$/.test(k));
  const found =
    format === "single-html"
      ? (js.find((k) => k.endsWith(".single.js")) ?? (js.length === 1 ? js[0] : undefined))
      : (js.find((k) => k === "agent3d-runtime.js") ?? js.find((k) => !k.includes("/") && !k.endsWith(".single.js")));
  if (!found) {
    throw new OpsError(
      "invalid",
      `No ${format === "single-html" ? "single-file runtime (agent3d-runtime.single.js)" : "runtime entry (agent3d-runtime.js)"} in the runtime files (${keys.slice(0, 5).join(", ") || "none"}).`,
      "Build the runtime first (npm run build:runtime) — the front door passes dist/runtime/.",
    );
  }
  return found;
}

// "./" | "/static/3d/" | "https://cdn.example/3d/" — always ends with "/".
export function normalizeBaseUrl(base: string | undefined): string {
  const b = (base ?? "").trim();
  if (!b || b === "." || b === "./") return "./";
  if (/^(javascript|data|vbscript):/i.test(b) || /["'<>\s]/.test(b)) throw new OpsError("invalid", `Invalid base URL "${base}".`, 'Use a path ("/static/3d/"), a relative path ("../3d/") or an https URL ("https://cdn.example.com/3d/").');
  return b.endsWith("/") ? b : `${b}/`;
}

async function digest(algo: "SHA-256" | "SHA-384", parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((a, p) => a + p.byteLength, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.byteLength;
  }
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw new OpsError("invalid", "WebCrypto is not available to hash the runtime.", "Use Node ≥ 20 or a modern browser, or export with integrity: false.");
  return new Uint8Array(await subtle.digest(algo, buf));
}

// Subresource Integrity value of a file ("sha384-<base64>").
export async function sri(bytes: Uint8Array): Promise<string> {
  const h = await digest("SHA-384", [bytes]);
  let bin = "";
  for (const b of h) bin += String.fromCharCode(b);
  return `sha384-${btoa(bin)}`;
}

async function shortHash(parts: Uint8Array[]): Promise<string> {
  const h = await digest("SHA-256", parts);
  return [...h.slice(0, 5)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Static (non-dynamic) imports of a runtime file, transitively: what the browser
// fetches before the entry runs → modulepreload hints (no request waterfall).
export function staticImports(files: Record<string, Uint8Array>, entry: string): string[] {
  const dec = new TextDecoder();
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (file: string) => {
    const bytes = files[file];
    if (!bytes) return;
    const src = dec.decode(bytes);
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
    const re = /\b(?:import|export)\s*(?:[^'"();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g;
    for (const m of src.matchAll(re)) {
      const target = resolveRel(dir, m[1]);
      if (seen.has(target) || !files[target]) continue;
      seen.add(target);
      order.push(target);
      visit(target);
    }
  };
  visit(entry);
  return order;
}

function resolveRel(dir: string, rel: string): string {
  const parts = (dir + rel).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

// The poster as markup inside the element (slot="poster"): visible before the
// runtime loads, without JavaScript / WebGL, and when printing.
export function posterMarkup(p: { src: string; avif?: string; alt: string; size?: { width: number; height: number } }): string {
  const dims = p.size ? ` width="${Math.round(p.size.width)}" height="${Math.round(p.size.height)}"` : "";
  const img = (slot: boolean) => `<img${slot ? ' slot="poster"' : ""} src="${escapeHtml(p.src)}" alt="${escapeHtml(p.alt)}"${dims} decoding="async" style="display:block;width:100%;height:auto">`;
  if (!p.avif) return img(true);
  return `<picture slot="poster"><source type="image/avif" srcset="${escapeHtml(p.avif)}">${img(false)}</picture>`;
}

// ZIP writer (deflate when CompressionStream exists, stored otherwise).
export async function writeZip(files: Record<string, Uint8Array | string>, deflate?: (d: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const defl =
    deflate ??
    (typeof CompressionStream !== "undefined"
      ? async (d: Uint8Array) => new Uint8Array(await new Response(new Blob([d as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer())
      : undefined);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const le = (n: number, bytes: number) => {
    const b = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) b[i] = (n >>> (8 * i)) & 0xff;
    return b;
  };
  const cat = (...a: Uint8Array[]) => {
    const out = new Uint8Array(a.reduce((x, y) => x + y.byteLength, 0));
    let o = 0;
    for (const p of a) (out.set(p, o), (o += p.byteLength));
    return out;
  };
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (defl && data.byteLength > 64) {
      const z = await defl(data);
      if (z.byteLength < data.byteLength) {
        method = 8;
        body = z;
      }
    }
    const common = cat(le(20, 2), le(0x0800, 2), le(method, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(body.byteLength, 4), le(data.byteLength, 4), le(nameBytes.byteLength, 2), le(0, 2));
    const local = cat(le(0x04034b50, 4), common, nameBytes);
    central.push(cat(le(0x02014b50, 4), le(20, 2), common, le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), nameBytes));
    parts.push(local, body);
    offset += local.byteLength + body.byteLength;
  }
  const cd = cat(...central);
  const eocd = cat(le(0x06054b50, 4), le(0, 2), le(0, 2), le(central.length, 2), le(central.length, 2), le(cd.byteLength, 4), le(offset, 4), le(0, 2));
  return cat(...parts, cd, eocd);
}

export async function buildExport(fs: ProjectFs, opts: ExportOptions): Promise<ExportResult> {
  const format = opts.format ?? "embed";
  if (format !== "embed" && format !== "single-html" && format !== "zip") throw new OpsError("invalid", `Unknown export format "${String(format)}".`, 'Use "embed" (folder for a static site), "zip" (the same folder as one .zip) or "single-html" (one self-contained file). Poster/video exports are done by the CLI renderer.');
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const source = await readSceneFile(fs);
  const issues = validateScene(source).filter((i) => i.severity !== "info");
  if (hasErrors(issues)) throw validationError("Cannot export an invalid scene:", issues, "Run check / scene_validate and fix the errors first.");
  const projectManifest = await readJsonOr<{ name?: string } | null>(fs, MANIFEST_FILE, null);
  const name = slugify(opts.name ?? projectManifest?.name ?? source.id ?? "scene", "scene");
  const runtimeEntry = pickRuntime(opts.runtime, format === "single-html" ? "single-html" : "embed");
  const manifest = await readAssetManifest(fs);
  const entries = new Map<string, AssetEntry>(manifest.assets.map((a) => [a.path, a]));

  // ── Assets: rewrite library refs, collect files to copy ──
  const scene: SceneDoc = clone(source);
  const assetFiles = new Map<string, Uint8Array>(); // exported relative path (inside <name>/) → bytes
  const credits: ExportCredit[] = [];
  const pending: Promise<void>[] = [];
  const libCopies = new Map<string, string>();
  const missing: string[] = [];
  const seenPaths = new Set<string>();
  visitAssetRefs(scene, (path, at) => {
    if (isLibraryRef(path)) {
      const id = libraryId(path);
      const asset = findLibraryAsset(opts.library?.index, id);
      if (!asset) {
        missing.push(`${at}: unknown library asset "${id}"`);
        return;
      }
      const ext = asset.path.includes(".") ? asset.path.slice(asset.path.lastIndexOf(".")) : "";
      const rel = `assets/library/${id.endsWith(ext) ? id : id + ext}`;
      if (!libCopies.has(id)) {
        libCopies.set(id, rel);
        pending.push(
          (async () => {
            assetFiles.set(rel, await opts.library.read(id));
          })(),
        );
        credits.push({ path: rel, license: asset.license, author: asset.author, source: "Agent3D library", ...(asset.attribution ? { attribution: asset.attribution } : {}) });
      }
      return rel;
    }
    if (!seenPaths.has(path)) {
      seenPaths.add(path);
      pending.push(
        (async () => {
          if (!(await fs.exists(path))) {
            missing.push(`${at}: "${path}" does not exist`);
            return;
          }
          const bytes = await fs.readBytes(path);
          assetFiles.set(path, bytes);
          if (path.toLowerCase().endsWith(".gltf")) {
            for (const dep of gltfDependencies(path, new TextDecoder().decode(bytes))) {
              if (await fs.exists(dep)) assetFiles.set(dep, await fs.readBytes(dep));
              else missing.push(`${at}: "${path}" needs "${dep}"`);
            }
          }
        })(),
      );
      const e = entries.get(path);
      credits.push(e ? { path, license: e.license, author: e.author, source: e.sourceUrl ?? e.source, ...(e.attribution ? { attribution: e.attribution } : {}) } : { path, license: "unknown" });
    }
  });
  await Promise.all(pending);
  if (missing.length) throw new OpsError("notFound", `Missing assets: ${missing.slice(0, 5).join("; ")}${missing.length > 5 ? "; …" : ""}`, "Run check to list missing files, add them (assets_add) or fix the paths.", { missing });

  // ── Scripts ──
  const scriptFiles = new Map<string, string>();
  for (const p of scene.scripts ?? []) {
    if (!(await fs.exists(p))) throw new OpsError("notFound", `Script "${p}" does not exist.`, "Create it or remove it from scene.scripts.");
    scriptFiles.set(p, await fs.readText(p));
  }

  const kind = (scene.target?.kind as TargetKind) ?? "banner";
  const budgetKb = scene.target?.budgetKb ?? DEFAULT_BUDGET_KB[kind] ?? 600;
  const sceneJson = `${JSON.stringify(scene, null, 2)}\n`;
  const assetsBytes = [...assetFiles.values()].reduce((a, b) => a + b.byteLength, 0);
  const scriptsBytes = [...scriptFiles.values()].reduce((a, b) => a + byteLen(b), 0);
  const posterBytes = opts.poster?.byteLength ?? 0;
  const out: Record<string, Uint8Array | string> = {};
  const outIssues: Issue[] = [...issues];
  // {data.*} placeholders in title / ariaLabel are resolved with scene.data (and
  // their `|fallback`) for the generated markup: screen readers, <title>, og:title.
  const title = substituteData(scene.title ?? "", scene.data).trim() || name;
  const label = scene.ariaLabel !== undefined ? substituteData(scene.ariaLabel, scene.data).trim() || title : title;
  const aspect = parseAspect(scene.target?.aspect) ?? { width: 16, height: 9, ratio: 16 / 9 };
  const sizeStyle = scene.target?.height ? `height:${scene.target.height}` : `aspect-ratio:${aspect.width} / ${aspect.height}`;
  let snippet: string;
  let entry: string;
  let runtimeBytes = 0;

  let runtimeDirName: string | undefined;
  let integrity: string | undefined;
  let head: string | undefined;
  if (format === "embed" || format === "zip") {
    const runtimeFiles = Object.entries(opts.runtime.files).filter(([k]) => !k.endsWith(".single.js"));
    runtimeDirName = opts.cacheBust ? `agent3d-runtime-${await shortHash(runtimeFiles.map(([k, v]) => [enc.encode(k), v]).flat())}` : "agent3d-runtime";
    for (const [k, v] of runtimeFiles) {
      out[`${runtimeDirName}/${k}`] = v;
      runtimeBytes += v.byteLength;
    }
    out[`${name}/scene.json`] = sceneJson;
    for (const [p, b] of assetFiles) out[`${name}/${p}`] = b;
    for (const [p, s] of scriptFiles) out[`${name}/${p}`] = s;
    const url = (rel: string) => `${baseUrl}${rel}`;
    let posterRel: string | undefined;
    if (opts.poster) {
      const { ext } = posterInfo(opts.poster);
      posterRel = `${name}/poster.${ext}`;
      out[posterRel] = opts.poster;
      if (opts.posterAvif) out[`${name}/poster.avif`] = opts.posterAvif;
    }
    let ogRel: string | undefined;
    if (opts.ogImage) {
      ogRel = `${name}/og-image.png`;
      out[ogRel] = opts.ogImage;
    }
    // Snippet: preload hints + runtime (SRI) + the element with a markup poster.
    const entryBytes = opts.runtime.files[runtimeEntry];
    const wantSri = opts.integrity !== false;
    integrity = wantSri ? await sri(entryBytes) : undefined;
    const sriAttr = (b: Uint8Array) => (wantSri ? sri(b).then((h) => ` integrity="${h}"`) : Promise.resolve(""));
    // modulepreload: every static dependency in head.html; the snippet keeps the
    // big ones (three.js) — fetched in parallel with the entry instead of after it.
    const preloads: string[] = [];
    const allPreloads: string[] = [];
    for (const dep of staticImports(opts.runtime.files, runtimeEntry)) {
      const link = `<link rel="modulepreload" href="${url(`${runtimeDirName}/${dep}`)}"${await sriAttr(opts.runtime.files[dep])}>`;
      allPreloads.push(link);
      if (opts.runtime.files[dep].byteLength >= PRELOAD_MIN_BYTES) preloads.push(link);
    }
    head = allPreloads.join("\n");
    const cacheQ = opts.cacheBust ? `?v=${await shortHash([enc.encode(sceneJson), ...assetFiles.values()])}` : "";
    const aspectAttr = scene.target?.height ? "" : ` aspect="${aspect.width}:${aspect.height}"`;
    // --cache-bust versions the poster too (its name never changes).
    const posterQ = opts.cacheBust && opts.poster ? `?v=${await shortHash([opts.poster, ...(opts.posterAvif ? [opts.posterAvif] : [])])}` : "";
    const posterImg = posterRel ? posterMarkup({ src: url(posterRel) + posterQ, avif: opts.posterAvif ? url(`${name}/poster.avif`) + posterQ : undefined, alt: label, size: opts.posterSize }) : "";
    snippet = [
      ...preloads,
      `<script type="module" src="${url(`${runtimeDirName}/${runtimeEntry}`)}"${integrity ? ` integrity="${integrity}"` : ""}></script>`,
      `<agent3d-scene src="${url(`${name}/scene.json`)}${cacheQ}"${aspectAttr} role="${kind === "game" ? "application" : "img"}" aria-label="${escapeHtml(label)}">${posterImg ? `\n  ${posterImg}\n` : ""}</agent3d-scene>`,
    ].join("\n");
    out["snippet.html"] = `${snippet}\n`;
    if (head) out["head.html"] = `<!-- Optional: in the <head> of pages showing Agent3D scenes (preloads the runtime's modules). -->\n${head}\n`;
    if (credits.length) out[`${name}/CREDITS.txt`] = creditsText(title, credits);
    out["index.html"] = demoPage({ title, description: scene.description === undefined ? undefined : substituteData(scene.description, scene.data), snippet, credits, sizeStyle, poster: posterRel ? url(posterRel) : undefined, ogImage: ogRel ? (baseUrl === "./" ? `./${ogRel}` : url(ogRel)) : undefined }); // og:image absolute with an https --base-url
    if (opts.extras !== false) {
      const doc: EmbedDocInput = {
        name,
        title,
        runtimeSrc: url(`${runtimeDirName}/${runtimeEntry}`),
        sceneSrc: url(`${name}/scene.json`),
        posterSrc: posterRel ? url(posterRel) + posterQ : undefined,
        aspect: `${aspect.width}:${aspect.height}`,
        snippet,
        dataKeys: Object.keys(scene.data ?? {}).filter((k) => /^[a-zA-Z][\w]*$/.test(k)),
        integrity,
        ogImage: ogRel,
        hasScripts: scriptFiles.size > 0,
        credits: credits.filter((c) => !/^(cc0|public)/i.test(c.license)).map(creditLine),
        version: opts.version,
      };
      out["EMBED.md"] = embedGuide(doc);
      out["frameworks/react/Agent3DScene.tsx"] = reactWrapper(doc);
      out["frameworks/vue/Agent3DScene.vue"] = vueWrapper(doc);
      out["frameworks/svelte/Agent3DScene.svelte"] = svelteWrapper(doc);
      out["frameworks/agent3d-scene.d.ts"] = ELEMENT_DTS;
    }
    entry = "index.html";
    if (format === "zip") {
      const zipName = `${name}-embed.zip`;
      const zip = await writeZip(out, opts.deflate);
      for (const k of Object.keys(out)) delete out[k];
      out[zipName] = zip;
      entry = zipName;
    }
  } else {
    const runtimeJs = new TextDecoder().decode(opts.runtime.files[runtimeEntry]);
    runtimeBytes = opts.runtime.files[runtimeEntry].byteLength;
    const assetUrls: Record<string, string> = {};
    for (const [p, b] of assetFiles) assetUrls[p] = dataUri(b, mimeFromPath(p));
    const scriptSources = Object.fromEntries(scriptFiles);
    const posterAttr = opts.poster ? ` poster="${dataUri(opts.poster, posterInfo(opts.poster).mime)}"` : "";
    // Children contract of <agent3d-scene> (src/runtime/element.ts): inline scene JSON,
    // `data-assets` path → data: URI map, `text/agent3d-script` modules by data-path.
    snippet = [
      `<agent3d-scene aria-label="${escapeHtml(label)}"${scene.target?.height ? "" : ` aspect="${aspect.width}:${aspect.height}"`}${posterAttr} style="display:block;width:100%">`,
      `<script type="application/json">${inlineJson(scene)}</script>`,
      ...(Object.keys(assetUrls).length ? [`<script type="application/json" data-assets>${inlineJson(assetUrls)}</script>`] : []),
      ...Object.entries(scriptSources).map(([p, src]) => `<script type="text/agent3d-script" data-path="${escapeHtml(p)}">${inlineJs(src)}</script>`),
      `</agent3d-scene>`,
      `<script type="module">${inlineJs(runtimeJs)}</script>`,
    ].join("\n");
    entry = `${name}.html`;
    out[entry] = singlePage({ title, body: snippet, credits });
    const size = byteLen(out[entry]);
    if (size > SINGLE_HTML_WARN_BYTES) {
      outIssues.push({ severity: "warning", code: "single-html-size", path: entry, message: `${entry} weighs ${(size / 1048576).toFixed(1)} MB (data: URIs inflate assets by ~33%).`, hint: 'Use the "embed" format for heavy scenes, or shrink textures / models.' });
    }
  }

  const contentKb = KB(byteLen(sceneJson) + assetsBytes + scriptsBytes);
  if (contentKb > budgetKb) {
    outIssues.push({ severity: "warning", code: "budget", path: "target.budgetKb", message: `The export weighs ${contentKb} KB (runtime excluded), above the ${budgetKb} KB budget for a ${kind}.`, hint: "Shrink textures (1k, .jpg/.webp), compress or replace models, or raise target.budgetKb." });
  }
  for (const c of credits) {
    if (c.license === "unknown") outIssues.push({ severity: "warning", code: "unknown-licence", path: c.path, message: `${c.path} has no licence in assets/manifest.json.`, hint: "Register it with assets_add (license + author) before publishing." });
  }
  const totalBytes = Object.values(out).reduce((a, v) => a + byteLen(v), 0);
  return {
    format,
    name,
    files: out,
    snippet,
    entry,
    totalKb: KB(totalBytes),
    sizes: { runtimeKb: KB(runtimeBytes), sceneKb: KB(byteLen(sceneJson)), assetsKb: KB(assetsBytes), scriptsKb: KB(scriptsBytes), posterKb: KB(posterBytes) },
    credits,
    issues: outIssues,
    ...(runtimeDirName ? { runtimeDir: runtimeDirName } : {}),
    ...(integrity ? { integrity } : {}),
    ...(head ? { head } : {}),
  };
}

function creditLine(c: ExportCredit): string {
  const needs = !/^(cc0|public)/i.test(c.license);
  return needs ? attributionText({ path: c.path, license: c.license, author: c.author, attribution: c.attribution, sourceUrl: c.source }) : `${c.path.split("/").pop()} — ${c.license}${c.author ? ` (${c.author})` : ""}`;
}

function creditsText(title: string, credits: ExportCredit[]): string {
  return [`Credits — ${title}`, "", ...credits.map((c) => `- ${creditLine(c)}`), "", "Made with Agent3D."].join("\n") + "\n";
}

function creditsHtml(credits: ExportCredit[]): string {
  if (!credits.length) return "";
  return `<section class="credits"><h2>Credits &amp; licences</h2><ul>${credits.map((c) => `<li>${escapeHtml(creditLine(c))}</li>`).join("")}</ul></section>`;
}

// Opened from file://, browsers block module scripts: the element is never
// upgraded and shows its markup poster; the demo page says to use a web server
// (classic inline script, so it runs from file:// too).
export const FILE_PROTOCOL_NOTE = "Open this page through a web server (file:// blocks module scripts) — e.g. npx serve";

function fileProtocolScript(): string {
  return `<script>
if (location.protocol === "file:") {
  var note = document.getElementById("a3d-file-note");
  if (note) note.hidden = false;
}
</script>`;
}

function demoPage(p: { title: string; description?: string; snippet: string; credits: ExportCredit[]; sizeStyle: string; poster?: string; ogImage?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)} — Agent3D embed</title>${p.description ? `\n<meta name="description" content="${escapeHtml(p.description)}">` : ""}${p.ogImage ? `\n<meta property="og:title" content="${escapeHtml(p.title)}">\n<meta property="og:image" content="${escapeHtml(p.ogImage)}">\n<meta name="twitter:card" content="summary_large_image">` : ""}
<style>
  :root { color-scheme: light dark; --fg: #1d1d22; --muted: #666; --bg: #f6f6f8; --card: #fff; --code: #0f1117; }
  @media (prefers-color-scheme: dark) { :root { --fg: #ececf1; --muted: #9a9aa5; --bg: #111216; --card: #1a1b21; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  .stage { border-radius: 14px; overflow: hidden; background: var(--card); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  agent3d-scene { display: block; width: 100%; ${p.sizeStyle}; }
  agent3d-scene:not(:defined) > img, agent3d-scene:not(:defined) > picture img { width: 100%; height: 100%; object-fit: cover; }
  h2 { font-size: 1.05rem; margin: 32px 0 8px; }
  pre { background: var(--code); color: #e6e6e6; padding: 16px; border-radius: 10px; overflow-x: auto; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .credits ul { padding-left: 20px; color: var(--muted); font-size: .92rem; }
  footer { margin-top: 40px; color: var(--muted); font-size: .85rem; }
  .file-note { margin: 0 0 16px; padding: 12px 16px; border-radius: 10px; background: #fff3cd; color: #5c4400; font-weight: 600; }
  .file-note code { font-weight: 700; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(p.title)}</h1>
<p class="lead">${escapeHtml(p.description ?? "A 3D element made with Agent3D. Paste the snippet below into any page of this site.")}</p>
<p class="file-note" id="a3d-file-note" role="status" hidden>Open this page through a web server (file:// blocks module scripts) — e.g. <code>npx serve</code> in this folder, then open the address it prints.${p.poster ? " Showing the poster image meanwhile." : ""}</p>
<div class="stage">
${p.snippet}
</div>
${fileProtocolScript()}
<h2>Embed snippet</h2>
<pre><code>${escapeHtml(p.snippet)}</code></pre>
<p>Upload this whole folder to your static site; the paths in the snippet are relative to the page that includes it. Several scenes can share the same runtime folder. <code>EMBED.md</code> explains WordPress, Webflow, Shopify, React / Next.js, Vue, Svelte, data bindings, the JavaScript API and the Content-Security-Policy; <code>frameworks/</code> holds ready-made wrapper components.</p>
${creditsHtml(p.credits)}
<footer>Made with Agent3D — no server, no tracking, no third-party requests.</footer>
</main>
</body>
</html>
`;
}

function singlePage(p: { title: string; body: string; credits: ExportCredit[] }): string {
  const credits = p.credits.filter((c) => !/^(cc0|public)/i.test(c.license));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<style>html,body{margin:0;background:transparent}body{font:14px system-ui,sans-serif}.agent3d-credits{font-size:12px;opacity:.7;padding:4px 8px}</style>
</head>
<body>
${p.body}
${credits.length ? `<div class="agent3d-credits">${credits.map((c) => escapeHtml(creditLine(c))).join(" · ")}</div>` : ""}
</body>
</html>
`;
}

// Files to write for an export under a folder of the project (AI tool / Studio).
export function prefixFiles(files: Record<string, Uint8Array | string>, dir: string): Record<string, Uint8Array | string> {
  const d = dir.replace(/\/+$/, "");
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [`${d}/${k}`, v]));
}
