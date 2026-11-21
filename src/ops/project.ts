// Project lifecycle: create (from a template or a starter scene), load, save.

import type { ProjectFs } from "../core/fs";
import { slugify } from "../core/ids";
import type { AssetManifest, Issue, ProjectManifest, SceneDoc, TargetDef } from "../core/types";
import { normalizeScene, validateScene } from "../core/validate";
import { AGENT3D_VERSION, OpsError, hasErrors, nowIso, readJson, readJsonOr, validationError, writeJson } from "./context";
import { STARTER_GAME_SCRIPT, starterScene } from "./starters";

export const MANIFEST_FILE = "agent3d.json";
export const SCENE_FILE = "scene.json";
export const ASSET_MANIFEST_FILE = "assets/manifest.json";

export interface CreateProjectOptions {
  name: string;
  title?: string;
  // Template id (recorded in the manifest) and its files (read by the front door from templates/<id>/).
  template?: string;
  templateFiles?: Record<string, Uint8Array | string>;
  target?: Partial<TargetDef>;
  // Overwrite an existing project in the folder.
  force?: boolean;
}

export interface CreateProjectResult {
  manifest: ProjectManifest;
  scene: SceneDoc;
  files: string[];
  issues: Issue[];
}

const decoder = new TextDecoder();
const asText = (v: Uint8Array | string) => (typeof v === "string" ? v : decoder.decode(v));

export async function createProject(fs: ProjectFs, opts: CreateProjectOptions): Promise<CreateProjectResult> {
  if (!opts.name || !opts.name.trim()) throw new OpsError("invalid", "A project needs a name.", 'Pass a name, e.g. "spring-banner".');
  if (!opts.force && ((await fs.exists(MANIFEST_FILE)) || (await fs.exists(SCENE_FILE)))) {
    throw new OpsError("conflict", "This folder already contains an Agent3D project.", "Choose an empty folder, or pass force: true (CLI --force) to overwrite it.");
  }
  if (opts.template && !opts.templateFiles) {
    throw new OpsError("invalid", `Template "${opts.template}" was requested but its files were not provided.`, "The front door must read templates/<id>/ and pass templateFiles (tool: templates_list for valid ids).");
  }
  const name = slugify(opts.name, "project");
  const title = opts.title?.trim() || opts.name.trim();
  const files: string[] = [];
  let scene: SceneDoc;

  if (opts.templateFiles) {
    const tf = opts.templateFiles;
    if (!tf[SCENE_FILE]) throw new OpsError("invalid", `Template "${opts.template ?? "?"}" has no scene.json.`, "A template folder holds agent3d.json, scene.json, template.json and optional scripts/ and assets/.");
    for (const [path, content] of Object.entries(tf)) {
      if (path === SCENE_FILE || path === MANIFEST_FILE || path === "template.json") continue;
      if (typeof content === "string") await fs.writeText(path, content);
      else await fs.writeBytes(path, content);
      files.push(path);
    }
    try {
      scene = normalizeScene(JSON.parse(asText(tf[SCENE_FILE])));
    } catch (e) {
      throw new OpsError("invalid", `Template scene.json is not valid JSON: ${(e as Error).message}`);
    }
    scene.id = name;
    if (opts.title) scene.title = title;
    if (opts.target) scene.target = { ...scene.target, ...opts.target };
  } else {
    scene = starterScene({ title, id: name, target: opts.target });
    if (scene.scripts?.includes("scripts/game.js")) {
      await fs.writeText("scripts/game.js", STARTER_GAME_SCRIPT);
      files.push("scripts/game.js");
    }
  }

  const issues = validateScene(scene);
  if (hasErrors(issues)) throw validationError("The new project's scene is invalid.", issues, "Fix the template (or the target options) and retry.");

  const now = nowIso();
  const manifest: ProjectManifest = { name, title, createdAt: now, updatedAt: now, ...(opts.template ? { template: opts.template } : {}), agent3d: AGENT3D_VERSION };
  await writeJson(fs, MANIFEST_FILE, manifest);
  await writeJson(fs, SCENE_FILE, scene);
  if (!(await fs.exists(ASSET_MANIFEST_FILE))) await writeJson(fs, ASSET_MANIFEST_FILE, { assets: [] } satisfies AssetManifest);
  files.push(MANIFEST_FILE, SCENE_FILE, ASSET_MANIFEST_FILE);
  return { manifest, scene, files: [...new Set(files)].sort(), issues };
}

export async function loadManifest(fs: ProjectFs): Promise<ProjectManifest> {
  return readJson<ProjectManifest>(fs, MANIFEST_FILE, "Project manifest");
}

export async function loadProject(fs: ProjectFs): Promise<{ manifest: ProjectManifest; scene: SceneDoc }> {
  const manifest = await loadManifest(fs);
  const scene = await readJson<SceneDoc>(fs, SCENE_FILE, "Scene");
  return { manifest, scene };
}

export async function readSceneFile(fs: ProjectFs): Promise<SceneDoc> {
  return readJson<SceneDoc>(fs, SCENE_FILE, "Scene");
}

// Validates then writes scene.json (and bumps agent3d.json updatedAt).
// Refuses scenes with errors unless allowInvalid.
export async function saveScene(fs: ProjectFs, scene: SceneDoc, opts: { allowInvalid?: boolean } = {}): Promise<{ issues: Issue[] }> {
  const issues = validateScene(scene);
  if (hasErrors(issues) && !opts.allowInvalid) throw validationError("Scene not saved:", issues);
  await writeJson(fs, SCENE_FILE, scene);
  await touchManifest(fs);
  return { issues };
}

export async function touchManifest(fs: ProjectFs): Promise<void> {
  const manifest = await readJsonOr<ProjectManifest | null>(fs, MANIFEST_FILE, null);
  if (!manifest) return;
  await writeJson(fs, MANIFEST_FILE, { ...manifest, updatedAt: nowIso(), agent3d: AGENT3D_VERSION });
}
