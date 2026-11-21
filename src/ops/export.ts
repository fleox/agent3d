// Export: builds the file map of a self-contained embed (pure — the front
// door writes the files). Formats (CLAUDE.md "Export format"):
//
// embed        <out>/agent3d-runtime/…  <name>/scene.json assets/ scripts/ poster  index.html  snippet.html
// single-html  <name>.html — single-file runtime inline, scene inline in the
//              <agent3d-scene> element, assets as data: URIs (<script data-assets>,
//              → MountOptions.assetUrls), scripts inline (<script type="text/agent3d-script">,
//              → MountOptions.scriptSources).
//
// "library:<id>" references are copied into <name>/assets/library/ and the
// exported scene points at the copies. Exports never hotlink.

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

export type ExportFormat = "embed" | "single-html";

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
}

const enc = new TextEncoder();
const byteLen = (v: Uint8Array | string) => (typeof v === "string" ? enc.encode(v).byteLength : v.byteLength);
const SINGLE_HTML_WARN_BYTES = 5 * 1024 * 1024;

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

export async function buildExport(fs: ProjectFs, opts: ExportOptions): Promise<ExportResult> {
  const format = opts.format ?? "embed";
  if (format !== "embed" && format !== "single-html") throw new OpsError("invalid", `Unknown export format "${String(format)}".`, 'Use "embed" (folder for a static site) or "single-html" (one self-contained file). Poster/video exports are done by the CLI renderer.');
  const source = await readSceneFile(fs);
  const issues = validateScene(source).filter((i) => i.severity !== "info");
  if (hasErrors(issues)) throw validationError("Cannot export an invalid scene:", issues, "Run check / scene_validate and fix the errors first.");
  const projectManifest = await readJsonOr<{ name?: string } | null>(fs, MANIFEST_FILE, null);
  const name = slugify(opts.name ?? projectManifest?.name ?? source.id ?? "scene", "scene");
  const runtimeEntry = pickRuntime(opts.runtime, format);
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
      const rel = `assets/library/${id}${ext}`;
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
  const label = scene.ariaLabel ?? scene.title;
  const aspect = parseAspect(scene.target?.aspect) ?? { width: 16, height: 9, ratio: 16 / 9 };
  const sizeStyle = scene.target?.height ? `height:${scene.target.height}` : `aspect-ratio:${aspect.width} / ${aspect.height}`;
  let snippet: string;
  let entry: string;
  let runtimeBytes = 0;

  if (format === "embed") {
    for (const [k, v] of Object.entries(opts.runtime.files)) {
      if (k.endsWith(".single.js")) continue;
      out[`agent3d-runtime/${k}`] = v;
      runtimeBytes += v.byteLength;
    }
    out[`${name}/scene.json`] = sceneJson;
    for (const [p, b] of assetFiles) out[`${name}/${p}`] = b;
    for (const [p, s] of scriptFiles) out[`${name}/${p}`] = s;
    let posterAttr = "";
    if (opts.poster) {
      const { ext } = posterInfo(opts.poster);
      out[`${name}/poster.${ext}`] = opts.poster;
      posterAttr = ` poster="./${name}/poster.${ext}"`;
    }
    snippet = `<script type="module" src="./agent3d-runtime/${runtimeEntry}"></script>\n<agent3d-scene src="./${name}/scene.json"${posterAttr} aria-label="${escapeHtml(label)}"></agent3d-scene>`;
    out["snippet.html"] = `${snippet}\n`;
    if (credits.length) out[`${name}/CREDITS.txt`] = creditsText(scene.title, credits);
    out["index.html"] = demoPage({ title: scene.title, description: scene.description, snippet, credits, sizeStyle });
    entry = "index.html";
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
      `<agent3d-scene aria-label="${escapeHtml(label)}"${posterAttr} style="display:block;width:100%">`,
      `<script type="application/json">${inlineJson(scene)}</script>`,
      ...(Object.keys(assetUrls).length ? [`<script type="application/json" data-assets>${inlineJson(assetUrls)}</script>`] : []),
      ...Object.entries(scriptSources).map(([p, src]) => `<script type="text/agent3d-script" data-path="${escapeHtml(p)}">${inlineJs(src)}</script>`),
      `</agent3d-scene>`,
      `<script type="module">${inlineJs(runtimeJs)}</script>`,
    ].join("\n");
    entry = `${name}.html`;
    out[entry] = singlePage({ title: scene.title, body: snippet, credits });
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

function demoPage(p: { title: string; description?: string; snippet: string; credits: ExportCredit[]; sizeStyle: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)} — Agent3D embed</title>
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
  h2 { font-size: 1.05rem; margin: 32px 0 8px; }
  pre { background: var(--code); color: #e6e6e6; padding: 16px; border-radius: 10px; overflow-x: auto; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .credits ul { padding-left: 20px; color: var(--muted); font-size: .92rem; }
  footer { margin-top: 40px; color: var(--muted); font-size: .85rem; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(p.title)}</h1>
<p class="lead">${escapeHtml(p.description ?? "A 3D element made with Agent3D. Paste the snippet below into any page of this site.")}</p>
<div class="stage">
${p.snippet}
</div>
<h2>Embed snippet</h2>
<pre><code>${escapeHtml(p.snippet)}</code></pre>
<p>Upload this whole folder to your static site; the paths in the snippet are relative to the page that includes it. Several scenes can share the same <code>agent3d-runtime/</code> folder.</p>
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
