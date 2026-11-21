import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { TargetDef, TargetKind } from "../../src/core/types";
import { readTemplateFiles } from "../host";
import { NodeFs } from "../nodeFs";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { positional, PROJECT_OPTION, projectFs, strOpt, usage } from "./util";

const TARGET_KINDS: TargetKind[] = ["banner", "hero", "card", "square", "fullscreen", "inline", "game"];

export const newCommand: Command = {
  name: "new",
  usage: "new <dir> [--template <id>] [--title <text>] [--target banner|hero|card|square|fullscreen|inline|game] [--aspect W:H]",
  summary: "Create a project folder (agent3d.json, scene.json, assets/, scripts/) — empty for its target, or from a template (`templates list`).",
  writes: true,
  options: [
    { name: "template", type: "string", description: "Start from this template (`agent3d templates list`)." },
    { name: "title", type: "string", description: "Scene title (also its accessible label)." },
    { name: "target", type: "string", description: `Where it is shown: ${TARGET_KINDS.join(", ")} (sets the default aspect).` },
    { name: "aspect", type: "string", description: 'Aspect ratio "W:H" (e.g. 4:1, 16:9, 1:1).' },
    { name: "name", type: "string", description: "Project name (default: the folder name)." },
  ],
  async run({ io, options, positionals }) {
    const dir = resolve(positional(positionals, 0, "project folder", this.usage));
    if (existsSync(resolve(dir, "scene.json")))
      throw new CliError("conflict", `${dir} is already an Agent3D project (scene.json exists).`, "Work on it with `--project <dir>` (`agent3d info --project …`), or pick another folder.");
    if (existsSync(dir) && readdirSync(dir).filter((f) => !f.startsWith(".")).length)
      throw new CliError("conflict", `${dir} exists and is not empty.`, "Pick a new or empty folder for the project.");
    const kind = strOpt(options, "target");
    if (kind && !TARGET_KINDS.includes(kind as TargetKind)) usage(`Unknown --target "${kind}".`, `Use one of: ${TARGET_KINDS.join(", ")}.`);
    const aspect = strOpt(options, "aspect");
    if (aspect && !/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(aspect)) usage(`--aspect must be "W:H" (e.g. 16:9), got "${aspect}".`);
    const target: Partial<TargetDef> = { ...(kind ? { kind: kind as TargetKind } : {}), ...(aspect ? { aspect } : {}) };
    const template = strOpt(options, "template");
    const templateFiles = template ? readTemplateFiles(template) : undefined;
    const { createProject } = await import("../../src/ops/project");
    const fs = new NodeFs(dir);
    const name = strOpt(options, "name") ?? basename(dir);
    const r = await createProject(fs, { name, title: strOpt(options, "title"), template, templateFiles, target });
    const files = await fs.list();
    printResult(io, { dir, manifest: r.manifest, target: r.scene.target, objects: r.scene.objects.length, files }, () =>
      [`Created ${dir} (${r.scene.target.kind}, ${r.scene.target.aspect}${template ? `, template ${template}` : ""}).`, `Next: agent3d scene summary --project ${dir}  ·  agent3d render --sheet --project ${dir}`].join("\n"),
    );
  },
};

export const infoCommand: Command = {
  name: "info",
  usage: "info [--project <dir>]",
  summary: "Project overview: manifest, target, scene summary (objects, lights, camera, timeline), assets and the latest renders.",
  options: [PROJECT_OPTION],
  async run({ io, options }) {
    const fs = projectFs(options);
    const [{ loadProject }, { summarizeScene }] = await Promise.all([import("../../src/ops/project"), import("../../src/ops/scene")]);
    const { manifest, scene } = await loadProject(fs);
    const files = await fs.list();
    const renders = files.filter((f) => f.startsWith("renders/") && f.endsWith(".png")).slice(-8);
    const data = {
      dir: fs.root,
      manifest,
      target: scene.target,
      summary: summarizeScene(scene),
      assets: files.filter((f) => f.startsWith("assets/") && f !== "assets/manifest.json").length,
      scripts: files.filter((f) => f.startsWith("scripts/")),
      renders: renders.map((r) => resolve(fs.root, r)),
    };
    printResult(io, data, () =>
      [
        `${manifest.title} (${manifest.name}) — ${fs.root}`,
        `Target: ${scene.target.kind} ${scene.target.aspect}  ·  ${scene.objects.length} top-level objects  ·  ${scene.lights.length} lights${scene.timeline ? `  ·  timeline ${scene.timeline.duration}s` : ""}`,
        `Assets: ${data.assets}  ·  Scripts: ${data.scripts.length}  ·  Renders: ${renders.length}`,
      ].join("\n"),
    );
  },
};
