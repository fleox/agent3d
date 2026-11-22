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
import { DRAW_CALL_LIMIT, estimateTriangles, TRIANGLE_LIMIT } from "./budget";
import { modelInfo } from "./gltf";
import { KB, readJsonOr } from "./context";
import { ASSET_MANIFEST_FILE, readSceneFile, SCENE_FILE } from "./project";
import { collectAssetRefs, gltfDependencies } from "./refs";
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
  const sceneBytes = (await fs.exists(SCENE_FILE)) ? await fs.size(SCENE_FILE) : 0;
  const budgetKb = scene.target?.budgetKb ?? DEFAULT_BUDGET_KB[kind] ?? 600;
  const totalKb = KB(assetBytes + scriptBytes + sceneBytes);
  if (totalKb > budgetKb) {
    const heaviest = [...fileBytes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    issues.push({
      severity: "warning",
      code: "budget",
      path: "target.budgetKb",
      message: `The bundle weighs ~${totalKb} KB (runtime excluded), above the ${budgetKb} KB budget for a ${kind}.`,
      hint: `${heaviest.length ? `Heaviest files: ${heaviest.map(([p, n]) => `${p} (${KB(n)} KB)`).join(", ")}. ` : ""}Shrink textures (also those inside .glb models) with \`agent3d assets optimize <path>… --max-size 512 --yes\` (or --all), download smaller resolutions (\`assets add --hit … --resolution 512\`), or replace heavy models with catalog geometries / generators (zero bytes). Raise target.budgetKb only if the page can afford it.`,
    });
  }
  const triLimit = TRIANGLE_LIMIT[kind] ?? 500_000;
  // A render measured the real number (all passes): it supersedes the estimate.
  if (tris.total > triLimit && !opts.runtimeStats) {
    issues.push({
      severity: "warning",
      code: "triangles",
      path: tris.byObject[0] ? `objects#${tris.byObject[0].id}` : "objects",
      message: `Estimated ${tris.total.toLocaleString("en-US")} triangles, above ${triLimit.toLocaleString("en-US")} for a ${kind}.`,
      hint: `Heaviest: ${tris.byObject.slice(0, 3).map((o) => `${o.id} (~${o.triangles.toLocaleString("en-US")})`).join(", ")}. Lower segments / resolution / detail / count params, or use "instances" for repeated meshes.`,
    });
  }

  // ── Framing (from a render's inspect()) ──
  if (opts.inspect) issues.push(...framingIssues(scene, opts.inspect));

  // ── Runtime performance ──
  if (opts.runtimeStats) {
    const st = opts.runtimeStats;
    if (st.drawCalls > DRAW_CALL_LIMIT) issues.push({ severity: "warning", code: "draw-calls", path: "objects", message: `${st.drawCalls} draw calls per frame (limit ${DRAW_CALL_LIMIT}).`, hint: 'Merge repeated meshes into an "instances" object, group static decoration into fewer meshes, reduce particles systems and post effects.' });
    if (st.triangles > triLimit)
      issues.push({
        severity: "warning",
        code: "triangles",
        path: tris.byObject[0] ? `objects#${tris.byObject[0].id}` : "objects",
        message: `The runtime renders ${st.triangles.toLocaleString("en-US")} triangles per frame, all passes included (limit ${triLimit.toLocaleString("en-US")} for a ${kind}; geometry estimate ~${tris.total.toLocaleString("en-US")}).`,
        hint: `Heaviest: ${tris.byObject.slice(0, 3).map((o) => `${o.id} (~${o.triangles.toLocaleString("en-US")})`).join(", ") || "n/a"}. Lower geometry segments / generator resolution or counts, use lighter models (decimate them); shadow-casting lights re-draw every caster (castShadow only where it shows).`,
      });
    if (st.textures > 24) issues.push({ severity: "info", code: "textures", path: "objects", message: `${st.textures} textures in GPU memory.`, hint: "Share textures between materials and prefer 1k maps for web embeds." });
    if (st.fps !== undefined && st.fps < 30) issues.push({ severity: "warning", code: "fps", path: "target", message: `Measured ${Math.round(st.fps)} fps in the headless render.`, hint: "Headless rendering is slower than a real GPU, but simplify if it drops below ~20: fewer post effects, lower maxDpr, fewer shadows." });
  }

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
      ...(opts.runtimeStats ? { runtimeTriangles: opts.runtimeStats.triangles } : {}),
      triangles: opts.runtimeStats ? opts.runtimeStats.triangles : tris.total,
      trianglesSource: opts.runtimeStats ? "runtime" : "estimate",
      heaviestObjects: tris.byObject.slice(0, 5),
      assetsKb: KB(assetBytes),
      scriptsKb: KB(scriptBytes),
      sceneKb: KB(sceneBytes),
      totalKb,
      budgetKb,
      runtimeKb: opts.runtimeKb ?? 0,
    },
    licences,
  };
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
  // flowers, clouds…; particle systems) spreads past the frame edges by
  // design: never "clipped".
  const spread = new Set<string>();
  const scatter = new Set(GENERATORS.filter((g) => g.params.some((p) => p.name === "area")).map((g) => g.id));
  walkObjects(scene.objects, (o) => {
    declared.add(o.id);
    const def = o as { kind?: string; generator?: string };
    if (def.kind === "particles" || (def.kind === "generator" && def.generator && scatter.has(def.generator))) spread.add(o.id);
  });
  const objs = inspect.objects.filter((o) => !hidden.has(o.id) && declared.has(o.id));
  const cam = `camera position ${JSON.stringify(inspect.camera.position)} looking at ${JSON.stringify(inspect.camera.target)}`;
  if (inspect.camera.insideObject) {
    issues.push({ severity: "warning", code: "camera-inside", path: `objects#${inspect.camera.insideObject}`, message: `The camera is inside "${inspect.camera.insideObject}" (${cam}).`, hint: `Move camera.position outside its bounding box, or scale / move "${inspect.camera.insideObject}".` });
  }
  for (const o of objs) {
    const size = o.max.map((v, i) => Math.round((v - o.min[i]) * 100) / 100);
    const centre = o.max.map((v, i) => Math.round(((v + o.min[i]) / 2) * 100) / 100);
    // Background-sized things (terrain, starfield, particles areas) are often partially in view by design.
    const big = Math.max(...size) > 30;
    if (o.inView === "none") {
      issues.push({ severity: "warning", code: "out-of-view", path: `objects#${o.id}`, message: `"${o.id}" is completely outside the camera view (centre ${JSON.stringify(centre)}, size ${JSON.stringify(size)}; ${cam}).`, hint: `Move it toward camera.target, widen camera.fov / move the camera back, or set "visible": false if it is meant to enter later.` });
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
