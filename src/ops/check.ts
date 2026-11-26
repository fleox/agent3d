// `agent3d check`: everything that can be verified before publishing —
// validation, missing files, script sandbox lint, budget estimate, framing
// (with an `inspect` result from a render), runtime performance (with
// `runtimeStats`), licences needing attribution and web-friendliness.
// Every issue carries an actionable hint.

import type { ProjectFs } from "../core/fs";
import { findLibraryAsset, isLibraryRef, libraryId, type LibraryIndex } from "../core/library";
import { closest } from "../core/suggest";
import type { AssetEntry, AssetManifest, Issue, SceneDoc, TargetKind } from "../core/types";
import { DEFAULT_BUDGET_KB, validateScene } from "../core/validate";
import type { FrameStats, InspectResult } from "../runtime/api";
import { GENERATORS } from "../core/catalog";
import { DRAW_CALL_LIMIT, estimateTriangles, frameTriangles, TRIANGLE_AIM, TRIANGLE_LIMIT, type FrameTriangleEstimate } from "./budget";
import { expandPostFx } from "../core/postfx";
import { modelInfo } from "./gltf";
import { imageHeader, optimizeSuggestions } from "./optimizeSizing";
import { KB, readJsonOr } from "./context";
import { ASSET_MANIFEST_FILE, readSceneFile, SCENE_FILE } from "./project";
import { collectAssetRefs, gltfDependencies } from "./refs";
import { postfxReport, type GpuReport } from "./postfxCheck";
import { lintScript } from "./scriptLint";
import { walkObjects } from "./tree";

export interface CheckOptions {
  runtimeStats?: FrameStats;
  inspect?: InspectResult;
  // Built-in library index (verifies "library:" ids and counts their bytes).
  library?: LibraryIndex;
  // Size of the runtime the export will ship (KB), reported as-is.
  runtimeKb?: number;
}

export interface LicenceInfo {
  path: string;
  license: string;
  author?: string;
  attribution: string;
}

export interface CheckReport {
  ok: boolean;
  issues: Issue[];
  counts: { errors: number; warnings: number; infos: number };
  budget: {
    // Geometry triangles drawn once (catalog cost formulas, measured glyph costs,
    // model triangle counts from the library index / the GLB). The runtime
    // counts every pass (shadow maps, post effects): with a render, `triangles`
    // is the measured number and `trianglesSource` "runtime".
    estimatedTriangles: number;
    // Every pass estimated (main + shadow maps + normal / depth pre-pass + contact
    // shadows): what the runtime would measure. `triangles` without a render.
    estimatedFrameTriangles: number;
    passes: FrameTriangleEstimate["passes"];
    // "Aim for" of the target kind (art-direction table), per frame.
    triangleAim: number;
    runtimeTriangles?: number;
    triangles: number;
    trianglesSource: "estimate" | "runtime";
    heaviestObjects: { id: string; triangles: number }[];
    assetsKb: number;
    scriptsKb: number;
    sceneKb: number;
    totalKb: number; // scene + assets + scripts (runtime excluded)
    budgetKb: number;
    runtimeKb: number;
    // Post-processing GPU cost estimate (look presets expanded): fullscreen-pass
    // equivalents per frame, whether the scene is re-drawn for a normal / depth
    // pre-pass, the effects the "low" tier drops, the target quality.
    gpu: GpuReport;
  };
  licences: LicenceInfo[];
}

const isCc0 = (l: string) => /^(cc0|cc-?0|public ?domain)/i.test(l.trim());

export function attributionText(a: { path?: string; license: string; author?: string; attribution?: string; sourceUrl?: string; title?: string }): string {
  if (a.attribution) return a.attribution;
  const what = a.title ?? a.path?.split("/").pop() ?? "Asset";
  return `"${what}"${a.author ? ` by ${a.author}` : ""}${a.sourceUrl ? ` (${a.sourceUrl})` : ""}, licensed under ${a.license}.`;
}

export async function checkProject(fs: ProjectFs, opts: CheckOptions = {}): Promise<CheckReport> {
  const issues: Issue[] = [];
  const scene: SceneDoc = await readSceneFile(fs);
  issues.push(...validateScene(scene));

  const kind: TargetKind = (scene.target?.kind as TargetKind) ?? "banner";
  const manifest = await readJsonOr<AssetManifest>(fs, ASSET_MANIFEST_FILE, { assets: [] });
  const entries = new Map<string, AssetEntry>((manifest.assets ?? []).map((a) => [a.path, a]));

  // ── Assets ──
  let assetBytes = 0;
  const counted = new Set<string>();
  const licences: LicenceInfo[] = [];
  const projectFiles = await fs.list("assets/");
  const addLicence = (l: LicenceInfo) => {
    if (!licences.some((x) => x.path === l.path)) licences.push(l);
  };
  const fileBytes = new Map<string, number>();
  const countFile = async (path: string) => {
    if (counted.has(path)) return;
    counted.add(path);
    // Size on disk (the manifest's bytes may be stale).
    const n = await fs.size(path);
    fileBytes.set(path, n);
    assetBytes += n;
  };

  for (const ref of collectAssetRefs(scene)) {
    if (isLibraryRef(ref.path)) {
      const id = libraryId(ref.path);
      if (!opts.library) continue;
      const asset = findLibraryAsset(opts.library, id);
      if (!asset) {
        const s = closest(id, opts.library.assets.map((a) => a.id));
        issues.push({ severity: "error", code: "unknown-library-id", path: ref.at, message: `Library asset "${id}" does not exist.`, hint: `${s ? `Did you mean "library:${s}"? ` : ""}List the library with library_list (CLI: agent3d assets library --query <word>).` });
        continue;
      }
      if (!counted.has(ref.path)) {
        counted.add(ref.path);
        assetBytes += asset.bytes;
        fileBytes.set(ref.path, asset.bytes);
      }
      if (!isCc0(asset.license)) addLicence({ path: ref.path, license: asset.license, author: asset.author, attribution: attributionText({ ...asset, title: asset.id }) });
      continue;
    }
    if (!ref.path || /^[a-z]+:/i.test(ref.path)) continue; // invalid syntax already reported by validation
    if (!(await fs.exists(ref.path))) {
      const s = closest(ref.path, projectFiles);
      issues.push({ severity: "error", code: "missing-asset", path: ref.at, message: `Asset file "${ref.path}" does not exist in the project.`, hint: `${s ? `Did you mean "${s}"? ` : ""}Add it with assets_add / \`agent3d assets add\`, or point ${ref.at} at an existing file (assets_list).` });
      continue;
    }
    await countFile(ref.path);
    if (ref.path.toLowerCase().endsWith(".gltf")) {
      for (const dep of gltfDependencies(ref.path, await fs.readText(ref.path))) {
        if (await fs.exists(dep)) await countFile(dep);
        else issues.push({ severity: "error", code: "missing-asset", path: ref.at, message: `"${ref.path}" references "${dep}", which is missing.`, hint: "Copy the .bin / texture files next to the .gltf, or convert it to a single .glb." });
      }
    }
    const entry = entries.get(ref.path);
    if (!entry) {
      issues.push({ severity: "info", code: "unregistered-asset", path: ref.at, message: `"${ref.path}" is not listed in assets/manifest.json (licence unknown).`, hint: "Register it with assets_add (CLI: agent3d assets add <file> --license CC0-1.0 --author …) so the export can credit it." });
    } else if (!isCc0(entry.license)) {
      addLicence({ path: entry.path, license: entry.license, author: entry.author, attribution: attributionText(entry) });
    }
  }
  for (const l of licences) {
    issues.push({ severity: "info", code: "attribution", path: l.path, message: `${l.path} is ${l.license}: it requires attribution.`, hint: `Show this credit near the embed (the export's index.html lists it): ${l.attribution}` });
  }

  // ── 3D photos ──
  issues.push(...(await photoIssues(fs, scene)));

  // ── Scripts ──
  let scriptBytes = 0;
  for (const [i, path] of (scene.scripts ?? []).entries()) {
    if (typeof path !== "string" || !path.startsWith("scripts/")) continue;
    if (!(await fs.exists(path))) {
      const s = closest(path, await fs.list("scripts/"));
      issues.push({ severity: "error", code: "missing-script", path: `scripts[${i}]`, message: `Script "${path}" does not exist.`, hint: `${s ? `Did you mean "${s}"? ` : ""}Create ${path} with \`export default function (api) { return { update(dt, t) {} }; }\`, or remove it from scene.scripts.` });
      continue;
    }
    const src = await fs.readText(path);
    scriptBytes += new TextEncoder().encode(src).byteLength;
    issues.push(...lintScript(src, path));
  }
  const listed = new Set(scene.scripts ?? []);
  for (const file of await fs.list("scripts/")) {
    if (/\.m?js$/.test(file) && !listed.has(file)) issues.push({ severity: "info", code: "unused-script", path: file, message: `${file} is not listed in scene.scripts (it will not run or be exported).`, hint: `Add "${file}" to scene.scripts, or delete it.` });
  }

  // ── Budget ──
  const modelTris = new Map<string, number>();
  for (const ref of collectAssetRefs(scene)) {
    if (ref.kind !== "model" || modelTris.has(ref.path)) continue;
    if (isLibraryRef(ref.path)) {
      const t = opts.library ? findLibraryAsset(opts.library, libraryId(ref.path))?.triangles : undefined;
      if (typeof t === "number") modelTris.set(ref.path, t);
    } else if (/\.(glb|gltf)$/i.test(ref.path) && (await fs.exists(ref.path))) {
      const info = modelInfo(ref.path, await fs.readBytes(ref.path));
      if (info) modelTris.set(ref.path, info.triangles);
    }
  }
  const tris = estimateTriangles(scene, { models: (src) => modelTris.get(src) });
  const frame = frameTriangles(scene, tris, { expandPostFx: (d) => expandPostFx(d) });
  const sceneBytes = (await fs.exists(SCENE_FILE)) ? await fs.size(SCENE_FILE) : 0;
  const budgetKb = scene.target?.budgetKb ?? DEFAULT_BUDGET_KB[kind] ?? 600;
  const totalKb = KB(assetBytes + scriptBytes + sceneBytes);
  if (totalKb > budgetKb) {
    const heaviest = [...fileBytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    budgetIssue: {
      // HDRIs are never optimised (`assets optimize` skips .hdr / .exr): say what actually helps.
      const hdris = heaviest.filter(([p]) => /\.(hdr|exr)$/i.test(p)).map(([p]) => p);
      if (hdris.length) {
        const others = heaviest.filter(([p]) => !hdris.includes(p));
        issues.push({
          severity: "warning",
          code: "budget",
          path: "target.budgetKb",
          message: `The bundle weighs ~${totalKb} KB (runtime excluded), above the ${budgetKb} KB budget for a ${kind}.`,
          hint: `Heaviest files: ${heaviest.map(([p, n]) => `${p} (${KB(n)} KB)`).join(", ")}. ${hdris.join(", ")} ${hdris.length > 1 ? "are HDRIs" : "is an HDRI"}: \`assets optimize\` never shrinks .hdr files. Use a lighter HDRI (a smaller download: \`assets add --hit … --resolution 1k\`; library sizes: \`agent3d assets library --kind hdri\`), or light without one — \`environment.lighting: "studio"\` (or "soft" / "sunset" / "night", built in, 0 KB), \`"sky"\` with a sky background, or a light rig (\`environment.rig\`, see \`agent3d catalog lightRigs\`) — and drop the background HDRI (\`environment.background\`: a colour, gradient or sky).${others.length ? ` For ${others.map(([p]) => p).join(", ")}: \`agent3d assets optimize --all\` (plan, then --yes).` : ""} Raise target.budgetKb only if the page can afford it.`,
        });
        break budgetIssue;
      }
      issues.push({
      severity: "warning",
      code: "budget",
      path: "target.budgetKb",
      message: `The bundle weighs ~${totalKb} KB (runtime excluded), above the ${budgetKb} KB budget for a ${kind}.`,
      hint: `${heaviest.length ? `Heaviest files: ${heaviest.map(([p, n]) => `${p} (${KB(n)} KB)`).join(", ")}. ` : ""}Run \`agent3d assets optimize --all\` (shows the plan: a size per texture from how the scene uses it, WebP, meshopt geometry; then add --yes; --dry-run reports the real savings), download smaller resolutions (\`assets add --hit … --resolution 512\`), or replace heavy models with catalog geometries / generators (zero bytes). Raise target.budgetKb only if the page can afford it.`,
      });
    }
  }
  // Assets `assets optimize` would clearly shrink (under budget too).
  const optimizable = await optimizeSuggestions(fs, scene, { library: opts.library }).catch(() => null);
  if (optimizable && (optimizable.models.length || optimizable.textures.length)) {
    const list = [...optimizable.textures.map((t) => `${t.path} (${t.size} px, the scene needs ~${t.maxSize})`), ...optimizable.models.map((m) => `${m.path} (${m.kb} KB, geometry not compressed)`)];
    issues.push({
      severity: "info",
      code: "optimizable",
      path: list.length === 1 ? (optimizable.textures[0]?.path ?? optimizable.models[0].path) : "assets/",
      message: `${list.length} asset(s) are heavier than this scene needs: ${list.slice(0, 4).join(", ")}${list.length > 4 ? ", …" : ""}.`,
      hint: "Run `agent3d assets optimize --all` to see the plan (per-texture size + reason, WebP, meshopt geometry), then add --yes (assets_optimize { all: true, dryRun: true } first from an agent).",
    });
  }
  const triLimit = TRIANGLE_LIMIT[kind] ?? 500_000;
  const triAim = TRIANGLE_AIM[kind] ?? 150_000;
  const heaviestLine = tris.byObject.slice(0, 3).map((o) => `${o.id} (~${o.triangles.toLocaleString("en-US")})`).join(", ") || "n/a";
  const passLine = passesLine(frame);
  // A render measured the real number (all passes): it supersedes the estimate.
  if (frame.perFrame > triLimit && !opts.runtimeStats) {
    issues.push({
      severity: "warning",
      code: "triangles",
      path: tris.byObject[0] ? `objects#${tris.byObject[0].id}` : "objects",
      message: `Estimated ${frame.perFrame.toLocaleString("en-US")} triangles per frame (${passLine}), above ${triLimit.toLocaleString("en-US")} for a ${kind}.`,
      hint: `Heaviest: ${heaviestLine}. Lower segments / resolution / detail / count params, use "instances" for repeated meshes, or simplify project models (\`agent3d assets optimize <model.glb> --simplify 0.5\`).${passHint(frame)}`,
    });
  } else if (frame.perFrame > triAim && !opts.runtimeStats) {
    issues.push({
      severity: "info",
      code: "triangles-aim",
      path: tris.byObject[0] ? `objects#${tris.byObject[0].id}` : "objects",
      message: `Estimated ${frame.perFrame.toLocaleString("en-US")} triangles per frame (${passLine}), above the ~${triAim.toLocaleString("en-US")} to aim for on a ${kind} (fast on a mid-range phone; limit ${triLimit.toLocaleString("en-US")}).`,
      hint: `Heaviest: ${heaviestLine}.${passHint(frame)} \`check --render\` measures the real number.`,
    });
  }

  // ── Framing (from a render's inspect()) ──
  if (opts.inspect) issues.push(...framingIssues(scene, opts.inspect));

  // ── Runtime performance ──
  if (opts.runtimeStats) {
    const st = opts.runtimeStats;
    if (st.drawCalls > DRAW_CALL_LIMIT) {
      const causes = drawCallCauses(scene, frame.shadowLights, !!frame.passes.prepass);
      issues.push({
        severity: "warning",
        code: "draw-calls",
        path: causes[0] ? `objects#${causes[0].id}` : "objects",
        message: `${st.drawCalls} draw calls per frame (limit ${DRAW_CALL_LIMIT}).${causes.length ? ` Most draw calls: ${causes.slice(0, 5).map((c) => `${c.id} (~${c.drawCalls}: ${c.why})`).join(", ")}.` : ""}`,
        hint: `${causes.some((c) => /splitLetters|per-letter/.test(c.why)) ? "Per-letter text (splitLetters / a per-letter reveal) draws every glyph separately — and twice with an outline: reveal by word or line, or drop the outline on split text. " : ""}${causes.some((c) => /copies/.test(c.why)) ? 'Repeated copies of the same object: use one "instances" object (or a generator) instead. ' : ""}Merge repeated meshes into an "instances" object, group static decoration into fewer meshes, reduce particle systems and post effects${frame.shadowLights ? "; every shadow-casting light re-draws each caster (castShadow: false on small / distant objects)" : ""}.`,
      });
    }
    if (st.triangles > triLimit)
      issues.push({
        severity: "warning",
        code: "triangles",
        path: tris.byObject[0] ? `objects#${tris.byObject[0].id}` : "objects",
        message: `The runtime renders ${st.triangles.toLocaleString("en-US")} triangles per frame, all passes included (limit ${triLimit.toLocaleString("en-US")} for a ${kind}; geometry estimate ~${tris.total.toLocaleString("en-US")}).`,
        hint: `Heaviest: ${heaviestLine}. Lower geometry segments / generator resolution or counts, use lighter models (decimate them); shadow-casting lights re-draw every caster (castShadow only where it shows).${passHint(frame)}`,
      });
    else if (st.triangles > triAim)
      issues.push({
        severity: "warning",
        code: "triangles-aim",
        path: tris.byObject[0] ? `objects#${tris.byObject[0].id}` : "objects",
        message: `The runtime renders ${st.triangles.toLocaleString("en-US")} triangles per frame (all passes), above the ~${triAim.toLocaleString("en-US")} to aim for on a ${kind} (limit ${triLimit.toLocaleString("en-US")}; estimate ${frame.perFrame.toLocaleString("en-US")}: ${passLine}).`,
        hint: `It works, but mid-range phones will struggle. Heaviest: ${heaviestLine}.${passHint(frame)}`,
      });
    // GPU texture count includes render targets, shadow maps, font / gradient / procedural canvases:
    // only image files cost downloads and memory worth flagging.
    const files = textureFiles(scene);
    if (files.length > 12)
      issues.push({ severity: "info", code: "textures", path: "objects", message: `${files.length} texture files used by materials / the environment (${st.textures} GPU textures in all, including generated ones).`, hint: "Share textures between materials and prefer 1k maps for web embeds (`agent3d assets optimize --all`)." });
    else if (st.textures > 24 && !files.length)
      issues.push({ severity: "info", code: "textures", path: "objects", message: `${st.textures} GPU textures, none from image files: they are generated (procedural textures, gradients, text / HUD canvases, shadow maps, post-processing targets) — no download.`, hint: "Nothing to do unless memory is tight: fewer procedural maps / post effects lower it." });
    if (st.fps !== undefined && st.fps < 30) issues.push({ severity: "warning", code: "fps", path: "target", message: `Measured ${Math.round(st.fps)} fps in the headless render.`, hint: "Headless rendering is slower than a real GPU, but simplify if it drops below ~20: fewer post effects, lower maxDpr, fewer shadows." });
  }

  // ── Post-processing GPU cost ──
  const pfx = postfxReport(scene);
  issues.push(...pfx.issues);

  // ── Web friendliness ──
  if (!scene.ariaLabel) issues.push({ severity: "info", code: "aria-label", path: "ariaLabel", message: `No ariaLabel: screen readers will announce the title "${scene.title ?? ""}".`, hint: 'Set "ariaLabel" to a one-sentence description of what the animation shows.' });
  const animated = !!scene.timeline?.loop || hasBehaviours(scene) || !!scene.camera?.autoRotate;
  if (scene.target?.reducedMotion === "ignore" && animated && kind !== "game") {
    issues.push({ severity: "warning", code: "reduced-motion", path: "target.reducedMotion", message: `reducedMotion "ignore" on a looping ${kind}: visitors who asked for less motion will still see it move.`, hint: 'Use "static" (freeze at posterTime) or "slow".' });
  }
  if (scene.target?.lazy === false && kind !== "fullscreen" && kind !== "game") issues.push({ severity: "info", code: "lazy", path: "target.lazy", message: "lazy is off: the scene starts rendering before it is visible.", hint: "Keep lazy: true (default) for embeds below the fold." });
  if ((scene.target?.maxDpr ?? 2) > 2) issues.push({ severity: "info", code: "dpr", path: "target.maxDpr", message: `maxDpr ${scene.target?.maxDpr} renders up to ${(scene.target?.maxDpr ?? 2) ** 2}× the pixels on retina screens.`, hint: "2 is plenty for web embeds; 1.5 for heavy scenes." });

  const counts = { errors: 0, warnings: 0, infos: 0 };
  for (const i of issues) counts[i.severity === "error" ? "errors" : i.severity === "warning" ? "warnings" : "infos"]++;
  const order = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    ok: counts.errors === 0,
    issues,
    counts,
    budget: {
      estimatedTriangles: tris.total,
      estimatedFrameTriangles: frame.perFrame,
      passes: frame.passes,
      triangleAim: triAim,
      ...(opts.runtimeStats ? { runtimeTriangles: opts.runtimeStats.triangles } : {}),
      triangles: opts.runtimeStats ? opts.runtimeStats.triangles : frame.perFrame,
      trianglesSource: opts.runtimeStats ? "runtime" : "estimate",
      heaviestObjects: tris.byObject.slice(0, 5),
      assetsKb: KB(assetBytes),
      scriptsKb: KB(scriptBytes),
      sceneKb: KB(sceneBytes),
      totalKb,
      budgetKb,
      runtimeKb: opts.runtimeKb ?? 0,
      gpu: pfx.gpu,
    },
    licences,
  };
}

function passesLine(f: FrameTriangleEstimate): string {
  const p = f.passes;
  return [`geometry ${p.main.toLocaleString("en-US")}`, ...(p.shadowMaps ? [`shadow maps ${p.shadowMaps.toLocaleString("en-US")} (${f.shadowLights} light${f.shadowLights > 1 ? "s" : ""})`] : []), ...(p.prepass ? [`ao / dof depth-normal pre-pass ${p.prepass.toLocaleString("en-US")}`] : []), ...(p.contactShadows ? [`contact shadows ${p.contactShadows.toLocaleString("en-US")}`] : [])].join(" + ");
}

function passHint(f: FrameTriangleEstimate): string {
  const p = f.passes;
  const parts: string[] = [];
  if (p.prepass) parts.push("the ao / dof / godrays / outline post effect re-draws the whole scene once more (drop it, or keep it for heroes)");
  if (p.shadowMaps) parts.push("each shadow-casting light re-draws every caster (castShadow: false on text and small objects)");
  if (p.contactShadows) parts.push("contactShadows re-draws the casters from below");
  return parts.length ? ` Passes: ${parts.join("; ")}.` : "";
}

export const PHOTO_HEAVY_BYTES = 1.5 * 1024 * 1024;

// 3D photos: the depth map must match the image (same aspect, else the relief
// slides off the picture), and a photo heavier than ~1.5 MB is a slow embed.
// Missing files are reported with the other asset refs.
async function photoIssues(fs: ProjectFs, scene: SceneDoc): Promise<Issue[]> {
  const out: Issue[] = [];
  const photos: { id: string; src?: unknown; depth?: unknown }[] = [];
  walkObjects(scene.objects, (o) => void (o.kind === "photo" && photos.push(o)));
  const header = async (path: unknown) => {
    if (typeof path !== "string" || !path || isLibraryRef(path) || !(await fs.exists(path))) return null;
    const bytes = await fs.readBytes(path);
    return { bytes: bytes.byteLength, h: imageHeader(bytes) };
  };
  for (const o of photos) {
    const at = `objects#${o.id}`;
    const src = await header(o.src).catch(() => null);
    if (src && src.bytes > PHOTO_HEAVY_BYTES) {
      out.push({ severity: "warning", code: "photo-heavy", path: `${at}.src`, message: `Photo "${String(o.src)}" weighs ${KB(src.bytes)} KB${src.h ? ` (${src.h.width}x${src.h.height})` : ""}: slow to load on phones.`, hint: `Run \`agent3d assets optimize ${String(o.src)}\` (sized from how big the photo shows on screen, WebP; plan first, then --yes).` });
    }
    const depth = await header(o.depth).catch(() => null);
    if (src?.h && depth?.h && src.h.height > 0 && depth.h.height > 0) {
      const a = src.h.width / src.h.height;
      const b = depth.h.width / depth.h.height;
      if (Math.abs(a - b) / a > 0.02) {
        out.push({ severity: "warning", code: "photo-depth-aspect", path: `${at}.depth`, message: `Depth map "${String(o.depth)}" is ${depth.h.width}x${depth.h.height} but the photo is ${src.h.width}x${src.h.height}: different aspect ratios, the relief will not line up with the picture.`, hint: `Regenerate it from this image: \`agent3d assets depth ${String(o.src)}\` (or crop both the same way).` });
      }
    }
    if (depth?.h && depth.h.mimeType === "image/jpeg") {
      out.push({ severity: "info", code: "photo-depth-lossy", path: `${at}.depth`, message: `Depth map "${String(o.depth)}" is a JPEG: lossy compression adds steps and noise to the relief and drops the alpha cut-edge mask.`, hint: `Use a PNG depth map (\`agent3d assets depth ${String(o.src)}\` writes one).` });
    }
  }
  return out;
}

// Image files the scene's materials / environment use (what "textures" should count).
function textureFiles(scene: SceneDoc): string[] {
  return [...new Set(collectAssetRefs(scene).filter((r) => r.kind === "texture" || r.kind === "hdri").map((r) => r.path))];
}

// Rough draw calls per top-level object, to name the causes of a high count:
// text drawn per letter (splitLetters / per-letter reveal), × 2 with an outline;
// groups of many meshes; the same model / geometry repeated (copies); shadow /
// pre-pass passes multiply every mesh.
export function drawCallCauses(scene: SceneDoc, shadowLights = 0, prepass = false): { id: string; drawCalls: number; why: string }[] {
  const passes = 1 + shadowLights + (prepass ? 1 : 0);
  const perLetter = new Set<string>();
  for (const tr of scene.timeline?.tracks ?? []) {
    const t = String(tr?.target ?? "");
    // Tracks on glyph children ("title/0.position.y", "title/3,title/4.scale").
    for (const part of t.split(".")[0].split(",")) {
      const m = /^(.+)\/\d+$/.exec(part.trim());
      if (m) perLetter.add(m[1]);
    }
  }
  const repeated = new Map<string, string[]>();
  const out: { id: string; drawCalls: number; why: string }[] = [];
  for (const top of scene.objects ?? []) {
    let calls = 0;
    const why: string[] = [];
    walkObjects([top], (o) => {
      const d = o as unknown as Record<string, unknown> & { kind?: string; text?: string };
      if (d.kind === "text") {
        const glyphs = String(d.text ?? "").replace(/\s/g, "").length;
        const split = d.splitLetters === true || !!d.reveal || perLetter.has(o.id);
        const layers = d.outline ? 2 : 1;
        if (split) {
          calls += glyphs * layers;
          why.push(`"${o.id}" per-letter text (splitLetters / reveal), ${glyphs} glyphs${layers > 1 ? " × outline" : ""}`);
        } else calls += layers;
      } else if (d.kind === "mesh" || d.kind === "instances" || d.kind === "particles" || d.kind === "svg") calls += 1;
      else if (d.kind === "photo") calls += d.mode === "layers" && d.depth ? (typeof d.layers === "number" ? d.layers : 6) : 1;
      else if (d.kind === "model" || d.kind === "generator") {
        calls += d.kind === "model" ? 4 : 2;
        const key = d.kind === "model" ? `model:${String(d.src)}` : `generator:${String(d.generator)}:${JSON.stringify(d.params ?? {})}`;
        repeated.set(key, [...(repeated.get(key) ?? []), o.id]);
      }
    });
    if (calls) out.push({ id: top.id, drawCalls: calls * passes, why: why.join(", ") || "meshes" });
  }
  for (const [key, ids] of repeated) {
    if (ids.length < 3) continue;
    const top = out.find((o) => o.id === ids[0]);
    const label = `${ids.length} copies of ${key.split(":").slice(0, 2).join(" ")} (${ids.slice(0, 4).join(", ")}${ids.length > 4 ? ", …" : ""})`;
    out.push({ id: ids[0], drawCalls: ids.length * (key.startsWith("model") ? 4 : 2) * passes, why: label });
    if (top && top.why === "meshes") top.why = label;
  }
  return out.sort((a, b) => b.drawCalls - a.drawCalls);
}

function hasBehaviours(scene: SceneDoc): boolean {
  let found = false;
  walkObjects(scene.objects, (o) => {
    if (o.behaviours?.length) found = true;
  });
  return found || (scene.lights ?? []).some((l) => l.behaviours?.length);
}

// Framing analysis of a render's inspect() result.
export function framingIssues(scene: SceneDoc, inspect: InspectResult): Issue[] {
  const issues: Issue[] = [];
  const hidden = new Set<string>();
  walkObjects(scene.objects, (o) => {
    if (o.visible === false) hidden.add(o.id);
  });
  // Only objects declared in scene.json: runtime clones (api.clone / spawn
  // in scripts) come and go by design.
  const declared = new Set<string>();
  // Scattered content (generators with an `area`: trees, rocks, grass,
  // flowers, clouds…; particle systems) and 3D photos (a full-bleed photo
  // overscans the frame so its parallax never shows an edge) spread past the
  // frame edges by design: never "clipped".
  const spread = new Set<string>();
  const scatter = new Set(GENERATORS.filter((g) => g.params.some((p) => p.name === "area")).map((g) => g.id));
  walkObjects(scene.objects, (o) => {
    declared.add(o.id);
    const def = o as { kind?: string; generator?: string };
    if (def.kind === "particles" || def.kind === "photo" || (def.kind === "generator" && def.generator && scatter.has(def.generator))) spread.add(o.id);
  });
  // In a scroll-driven story, objects the timeline moves / scales / reveals
  // (or everything, when the camera moves) can be out of view at the checked
  // frame by design — they come in later in the scroll: info, not a warning.
  const animated = new Set<string>();
  let cameraMoves = (scene.camera?.shots?.length ?? 0) > 0;
  const tagged = (tag: string) => {
    walkObjects(scene.objects, (o) => {
      if ((o as { tags?: string[] }).tags?.includes(tag)) animated.add(o.id);
    });
  };
  // Objects the timeline hides at t = 0 (opacity 0, visible false, scale 0 at
  // the first key) and reveals later: not visible at the checked frame even
  // when they are inside the view — reported like the out-of-view ones.
  const hiddenAtStart = new Set<string>();
  const startsHidden = (prop: string, keys: unknown): boolean => {
    const first = Array.isArray(keys) ? (keys as unknown[]).find((k) => Array.isArray(k)) : undefined;
    if (!Array.isArray(first) || typeof first[0] !== "number" || first[0] > 1e-6) return false;
    const v = first[1];
    if (/^(material\.)?opacity$/.test(prop)) return v === 0;
    if (prop === "visible") return v === false || v === 0;
    if (/^scale$/.test(prop)) return v === 0 || (Array.isArray(v) && v.every((x) => x === 0));
    return false;
  };
  for (const tr of scene.timeline?.tracks ?? []) {
    const target = typeof tr?.target === "string" ? tr.target : "";
    const dot = target.indexOf(".");
    if (dot < 1) continue;
    const head = target.slice(0, dot), prop = target.slice(dot + 1);
    if (head === "camera") {
      cameraMoves = true;
      continue;
    }
    if (!/^(position|scale|rotation|visible|material\.opacity|opacity)/.test(prop)) continue;
    const ids: string[] = [];
    if (head.startsWith("tag:")) {
      const before = new Set(animated);
      tagged(head.slice(4));
      for (const id of animated) if (!before.has(id)) ids.push(id);
    } else if (head.startsWith("children:")) {
      // children:<id>.prop animates every child: the parent is hidden when all of them start hidden.
      const id = head.slice(9);
      ids.push(id);
      walkObjects(scene.objects, (o) => {
        if (o.id === id) for (const c of o.children ?? []) ids.push(c.id);
      });
    } else for (const h of head.split(",")) ids.push(h.trim().replace(/\/\d+$/, ""));
    for (const id of ids) animated.add(id);
    if (startsHidden(prop, (tr as { keys?: unknown }).keys)) for (const id of ids) hiddenAtStart.add(id);
  }
  // Camera-attached objects (attach: "camera") live in screen space: their framing is the
  // camera's own (positioned relative to the lens), never "out of view" / "clipped" like world objects.
  const attached = new Set((scene.objects ?? []).filter((o) => (o as { attach?: string }).attach === "camera").map((o) => o.id));
  for (const id of [...attached]) walkObjects(scene.objects.find((o) => o.id === id)?.children ?? [], (c) => void attached.add(c.id));
  const objs = inspect.objects.filter((o) => !hidden.has(o.id) && declared.has(o.id) && !attached.has(o.id));
  const cam = `camera position ${JSON.stringify(inspect.camera.position)} looking at ${JSON.stringify(inspect.camera.target)}`;
  if (inspect.camera.insideObject) {
    issues.push({ severity: "warning", code: "camera-inside", path: `objects#${inspect.camera.insideObject}`, message: `The camera is inside "${inspect.camera.insideObject}" (${cam}).`, hint: `Move camera.position outside its bounding box, or scale / move "${inspect.camera.insideObject}".` });
  }
  for (const o of objs) {
    const size = o.max.map((v, i) => Math.round((v - o.min[i]) * 100) / 100);
    const centre = o.max.map((v, i) => Math.round(((v + o.min[i]) / 2) * 100) / 100);
    // Background-sized things (terrain, starfield, particles areas) are often partially in view by design.
    const big = Math.max(...size) > 30;
    const scroll = scene.timeline?.trigger === "scroll";
    const later = scroll ? "further down the page" : "later in the timeline";
    const checkHint = scroll ? "Check the other scroll states with `agent3d render --count 8` (or --scroll 0.5)." : "Check later frames with `agent3d render --count 6` (or --frames …).";
    if (hiddenAtStart.has(o.id) && o.inView !== "none") {
      // Same report as an object brought into view later: it is not visible at the checked frame either.
      issues.push({ severity: "info", code: "out-of-view-at-start", path: `objects#${o.id}`, message: `"${o.id}" is hidden at the checked frame (t = 0): the timeline starts it transparent / invisible / at scale 0 and reveals it ${later}.`, hint: checkHint });
    } else if (o.inView === "none" && scroll && (cameraMoves || animated.has(o.id))) {
      issues.push({ severity: "info", code: "out-of-view-at-start", path: `objects#${o.id}`, message: `"${o.id}" is outside the camera view at the checked frame (t = 0)${hiddenAtStart.has(o.id) ? " and hidden by the timeline" : ""}; the ${scroll ? "scroll-driven " : ""}${animated.has(o.id) ? "timeline animates it" : "camera moves"}, so it may come into view ${later}.`, hint: checkHint });
    } else if (o.inView === "none") {
      issues.push({ severity: "warning", code: "out-of-view", path: `objects#${o.id}`, message: `"${o.id}" is completely outside the camera view (centre ${JSON.stringify(centre)}, size ${JSON.stringify(size)}; ${cam}).`, hint: `Move it toward camera.target, widen camera.fov / move the camera back, or set "visible": false if it is meant to enter later.${animated.has(o.id) || cameraMoves ? " The timeline animates it: if it enters later on purpose, check later frames (`agent3d render --count 6`) and ignore this." : ""}` });
    } else if (o.inView === "partial" && !big && !spread.has(o.id)) {
      issues.push({ severity: "info", code: "clipped", path: `objects#${o.id}`, message: `"${o.id}" is clipped by the frame edges (centre ${JSON.stringify(centre)}, size ${JSON.stringify(size)}).`, hint: "If unintended, move it inward, scale it down or move the camera back. For wide banners, keep content within the central ~80% of the width." });
    }
  }
  const coverage = Math.min(1, objs.reduce((a, o) => a + (o.inView === "none" ? 0 : o.screenCoverage), 0));
  if (objs.length && coverage < 0.05) {
    issues.push({ severity: "warning", code: "too-small", path: "camera", message: `The objects cover only ${(coverage * 100).toFixed(1)}% of the frame: the scene looks empty.`, hint: "Move camera.position closer to camera.target (or lower camera.fov), or scale the main objects up." });
  }
  return issues;
}
