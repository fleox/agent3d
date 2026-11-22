import type { Issue, SceneDoc } from "../../src/core/types";
import { CliError, printResult, type Io } from "../output";
import type { NodeFs } from "../nodeFs";
import type { Command } from "./types";
import { boolOpt, confirmOrPlan, DRY_RUN_OPTION, FILE_OPTION, jsonInput, jsonObjectOpt, jsonOpt, numOpt, positional, PROJECT_OPTION, projectFs, setEntries, setPairs, strOpt, table, usage, YES_OPTION, type Options } from "./util";

// scene / object / timeline: read the scene and change it through the ops
// (src/ops/scene.ts). Every write is validated; a change that removes or
// replaces things prints a plan with needsConfirmation unless --yes.

type PatchOp = Record<string, unknown> & { op: string };

const DESTRUCTIVE_OPS = new Set(["remove", "removeObject", "removeTrack"]);

function errorsOf(issues: Issue[] | undefined): Issue[] {
  return (issues ?? []).filter((i) => i.severity === "error");
}

function validationError(issues: Issue[], plan?: unknown): CliError {
  const errs = errorsOf(issues);
  const first = errs[0];
  return new CliError(
    "validation",
    `The change makes the scene invalid: ${errs.length} error${errs.length > 1 ? "s" : ""}${first ? ` — ${first.path}: ${first.message.replace(/[.!?]+$/, "")}` : ""}. Nothing was written.`,
    first?.hint ?? "Fix the listed issues (details.issues: JSON path + message + hint) and retry; `agent3d catalog <section> <id>` documents the parameters.",
    2,
    { issues, ...(plan !== undefined ? { plan } : {}) },
  );
}

function issuesLine(issues: Issue[]): string {
  if (!issues.length) return "No issues.";
  return issues.map((i) => `  ${i.severity === "error" ? "✗" : i.severity === "warning" ? "!" : "·"} ${i.path}: ${i.message}${i.hint ? ` (${i.hint})` : ""}`).join("\n");
}

// Runs patch ops: dry run first (validation + plan), then the write unless
// --dry-run, or when it removes things without --yes (plan + needsConfirmation).
export async function runPatch(io: Io, options: Options, fs: NodeFs, ops: PatchOp[], human: string, opts: { destructive?: boolean } = {}): Promise<number | void> {
  const { patchScene } = await import("../../src/ops/scene");
  const dry = await patchScene(fs, ops as never, { dryRun: true });
  if (errorsOf(dry.issues).length) throw validationError(dry.issues, dry.plan);
  if (dry.plan.empty) return printResult(io, { applied: false, plan: dry.plan, issues: dry.issues }, () => `${human}: no changes.`);
  if (boolOpt(options, "dry-run")) return printResult(io, { dryRun: true, plan: dry.plan, issues: dry.issues }, () => `${human} (dry run): ${dry.plan.summary}\n${issuesLine(dry.issues)}`);
  const destructive = opts.destructive ?? (dry.plan.objects.removed.length > 0 || ops.some((o) => DESTRUCTIVE_OPS.has(o.op)));
  if (destructive && !confirmOrPlan(io, options, { ...dry.plan, ops, issues: dry.issues }, () => `${human}: ${dry.plan.summary}`)) return;
  const r = await patchScene(fs, ops as never, { dryRun: false });
  if (!r.applied) throw validationError(r.issues, r.plan);
  printResult(io, { applied: true, plan: r.plan, issues: r.issues }, () => `${human}: ${r.plan.summary}\n${issuesLine(r.issues)}`);
}

// ─── scene ──────────────────────────────────────────────────────────────

export const sceneCommand: Command = {
  name: "scene",
  usage: "scene <get|summary|apply|patch|validate> [--project <dir>]",
  summary: "Read, replace, patch and validate scene.json (the SceneDoc). apply / patch print a plan; destructive changes need --yes.",
  subcommands: [
    { name: "get", usage: "scene get [--path <json.path>]", summary: 'The full scene JSON, or the value at a path ("camera", "objects#logo.material").' },
    { name: "summary", usage: "scene summary", summary: "Compact outline: object tree (id, kind, geometry / generator / preset), lights, camera, timeline tracks, scripts." },
    { name: "apply", usage: "scene apply --file <scene.json|-> [--dry-run] [--yes]", summary: "Replace the whole scene (validated). Prints the diff plan + needsConfirmation unless --yes.", writes: true, destructive: true },
    { name: "patch", usage: "scene patch --file <ops.json|-> [--dry-run] [--yes]", summary: 'Apply patch ops ([{ "op": "set", "path": "camera.position", "value": [0,2,8] }, { "op": "addObject", "object": {…} }, …]). Removals need --yes.', writes: true },
    { name: "validate", usage: "scene validate [--file <scene.json|->]", summary: "Validate the project's scene (or a candidate file): issues with JSON paths, messages and hints. Exit 2 on errors." },
  ],
  options: [PROJECT_OPTION, FILE_OPTION, { name: "path", type: "string", description: "get: a JSON path into the scene." }, DRY_RUN_OPTION, YES_OPTION],
  async run({ io, options, positionals }) {
    const [action = "summary", ...rest] = positionals;
    if (action === "validate") {
      const { validateScene } = await import("../../src/core/validate");
      let scene: unknown;
      if (strOpt(options, "file") !== undefined || rest.length) scene = jsonInput(options, rest, "the scene", "--file scene.json");
      else scene = JSON.parse(await projectFs(options).readText("scene.json"));
      const issues = validateScene(scene);
      const errors = errorsOf(issues).length;
      printResult(io, { valid: errors === 0, errors, warnings: issues.filter((i) => i.severity === "warning").length, issues }, () => (errors ? `${errors} error(s):\n` : "Valid.\n") + issuesLine(issues));
      return errors ? 2 : 0;
    }
    const fs = projectFs(options);
    if (action === "get") {
      const { getScene } = await import("../../src/ops/scene");
      const scene = await getScene(fs);
      const path = strOpt(options, "path");
      if (!path) return printResult(io, scene, () => JSON.stringify(scene, null, 2));
      const { getAt } = await import("../../src/core/jsonPath");
      const value = getAt(scene as unknown as Parameters<typeof getAt>[0], path);
      if (value === undefined) throw new CliError("notFound", `Nothing at "${path}".`, "`agent3d scene summary` lists the object ids; paths look like camera.position or objects#logo.material.color.");
      return printResult(io, { path, value }, () => JSON.stringify(value, null, 2));
    }
    if (action === "summary") {
      const [{ getScene, summarizeScene }] = await Promise.all([import("../../src/ops/scene")]);
      const summary = summarizeScene(await getScene(fs));
      return printResult(io, summary, () => JSON.stringify(summary, null, 2));
    }
    if (action === "apply") {
      const next = jsonInput(options, rest, "the scene", "--file scene.json") as SceneDoc;
      const { applyScene } = await import("../../src/ops/scene");
      const dry = await applyScene(fs, next, { dryRun: true });
      if (errorsOf(dry.issues).length) throw validationError(dry.issues, dry.plan);
      if (dry.plan.empty) return printResult(io, { applied: false, plan: dry.plan, issues: dry.issues }, () => "No changes.");
      if (boolOpt(options, "dry-run")) return printResult(io, { dryRun: true, plan: dry.plan, issues: dry.issues }, () => `${dry.plan.summary}\n${issuesLine(dry.issues)}`);
      if (!confirmOrPlan(io, options, { ...dry.plan, issues: dry.issues }, () => `Replace scene.json: ${dry.plan.summary}`)) return;
      const r = await applyScene(fs, next, { dryRun: false });
      if (!r.applied) throw validationError(r.issues, r.plan);
      return printResult(io, { applied: true, plan: r.plan, issues: r.issues }, () => `Scene replaced.\n${issuesLine(r.issues)}`);
    }
    if (action === "patch") {
      const raw = jsonInput(options, rest, "the patch ops", `--file ops.json with [{"op":"set","path":"camera.position","value":[0,2,8]}]`);
      const ops = (Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { ops?: unknown }).ops) ? (raw as { ops: unknown[] }).ops : [raw]) as PatchOp[];
      if (!ops.length || ops.some((o) => !o || typeof o !== "object" || typeof o.op !== "string"))
        usage("The patch must be an array of ops with an \"op\" field.", 'e.g. [{"op":"set","path":"environment.background","value":"#101020"},{"op":"removeObject","id":"old"}]');
      return runPatch(io, options, fs, ops, `Patch (${ops.length} op${ops.length > 1 ? "s" : ""})`);
    }
    usage(`Unknown scene action "${action}".`, "Use get, summary, apply, patch or validate.");
  },
};

// ─── object ─────────────────────────────────────────────────────────────

const OBJECT_KINDS = ["mesh", "text", "model", "group", "generator", "particles", "instances", "svg"];

// --json-def + shortcuts (--id, --kind, --geometry, --generator, --preset, --text, --src) + --set a.b=v.
function objectDef(options: Options, base: Record<string, unknown> = {}): Record<string, unknown> {
  const def: Record<string, unknown> = { ...base, ...(jsonObjectOpt(options, "json-def") ?? {}) };
  const id = strOpt(options, "id");
  if (id) def.id = id;
  const kind = strOpt(options, "kind");
  if (kind) def.kind = kind;
  const geometry = strOpt(options, "geometry");
  if (geometry) {
    def.geometry = { ...((def.geometry as object) ?? {}), type: geometry };
    def.kind ??= "mesh";
  }
  const generator = strOpt(options, "generator");
  if (generator) {
    def.generator = generator;
    def.kind ??= "generator";
  }
  const preset = strOpt(options, "preset");
  if (preset) {
    def.preset = preset;
    def.kind ??= "particles";
  }
  const text = strOpt(options, "text");
  if (text !== undefined) {
    def.text = text;
    def.kind ??= "text";
  }
  const src = strOpt(options, "src");
  if (src) {
    def.src = src;
    def.kind ??= src.endsWith(".svg") || src.trim().startsWith("<svg") ? "svg" : "model";
  }
  const sets = setPairs(options);
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? merge(out[k] as Record<string, unknown>, v as Record<string, unknown>) : v;
    return out;
  };
  return merge(def, sets);
}

const OBJECT_OPTIONS = [
  { name: "json-def", type: "string" as const, description: "The object (add) or the properties to change (update) as JSON, @file or - (stdin)." },
  { name: "set", type: "string" as const, multiple: true, description: "key=value (dotted keys, JSON values), repeated: --set position=[0,1,0] --set material.color=\"#ff3366\"." },
  { name: "id", type: "string" as const, description: "add: the new object's id ([a-zA-Z][a-zA-Z0-9_-]*)." },
  { name: "kind", type: "string" as const, description: `add: ${OBJECT_KINDS.join(", ")}.` },
  { name: "geometry", type: "string" as const, description: "add: geometry type (implies kind mesh) — `agent3d catalog geometries`." },
  { name: "generator", type: "string" as const, description: "add: generator id (implies kind generator) — `agent3d catalog generators`." },
  { name: "preset", type: "string" as const, description: "add: particle preset (implies kind particles) — `agent3d catalog particlePresets`." },
  { name: "text", type: "string" as const, description: "add: the text (implies kind text)." },
  { name: "src", type: "string" as const, description: "add: model / svg source (project path or library:<id>)." },
  { name: "parent", type: "string" as const, description: "add / move: parent object id." },
  { name: "root", type: "boolean" as const, description: "move: to the top level." },
  { name: "index", type: "string" as const, description: "add / move: position among the siblings." },
];

export const objectCommand: Command = {
  name: "object",
  usage: "object <add|update|remove|list|get|move> [<id>] [--project <dir>]",
  summary: "Add, change, remove, list, inspect and re-parent scene objects (shortcuts over scene patch).",
  subcommands: [
    { name: "add", usage: "object add --json-def <json|@file> | --id <id> --geometry box [--set k=v …] [--parent <id>] [--index <n>]", summary: "Add an object (validated).", writes: true },
    { name: "update", usage: "object update <id> [--json-def <json>] [--set k=v …]", summary: "Change properties of an object (--set material.color=… changes only that key).", writes: true },
    { name: "remove", usage: "object remove <id> [--yes]", summary: "Remove an object and its children (plan + needsConfirmation unless --yes).", writes: true, destructive: true },
    { name: "list", usage: "object list", summary: "Every object (tree flattened): id, kind, geometry / generator / preset, parent, behaviours." },
    { name: "get", usage: "object get <id>", summary: "One object's full definition." },
    { name: "move", usage: "object move <id> (--parent <id> | --root) [--index <n>]", summary: "Re-parent or reorder an object.", writes: true },
  ],
  options: [PROJECT_OPTION, ...OBJECT_OPTIONS, DRY_RUN_OPTION, YES_OPTION],
  async run({ io, options, positionals }) {
    const [action = "list", id] = positionals;
    const fs = projectFs(options);
    const index = numOpt(options, "index");
    if (action === "list" || action === "get") {
      const { listObjects, getObject } = await import("../../src/ops/objects");
      if (action === "list") {
        const rows = await listObjects(fs);
        return printResult(io, { objects: rows }, () => table(rows.map((r) => ({ ...r, id: `${"  ".repeat(r.depth)}${r.id}`, behaviours: r.behaviours?.join(",") })), ["id", "kind", "detail", "behaviours"]));
      }
      const oid = positional(positionals, 1, "object id", "object get <id>");
      const hit = await getObject(fs, oid);
      return printResult(io, hit, () => JSON.stringify(hit.object, null, 2));
    }
    if (action === "add") {
      const def = objectDef(options);
      if (!def.id || !def.kind) usage("object add needs an id and a kind.", 'e.g. --id logo --geometry torusKnot --set material.preset=chrome, or --json-def \'{"id":"sun","kind":"mesh","geometry":{"type":"sphere"}}\'');
      const op: PatchOp = { op: "addObject", object: def, ...(strOpt(options, "parent") ? { parent: strOpt(options, "parent") } : {}), ...(index !== undefined ? { index } : {}) };
      return runPatch(io, options, fs, [op], `Add ${def.kind} "${def.id}"`);
    }
    if (action === "update") {
      const oid = positional(positionals, 1, "object id", "object update <id> --set k=v");
      const json = jsonObjectOpt(options, "json-def");
      const sets = setEntries(options);
      if (!json && !sets.length) usage("Nothing to change.", "Pass --set key=value (repeated) and/or --json-def '{…}'.");
      const ops: PatchOp[] = [];
      if (json) ops.push({ op: "updateObject", id: oid, set: json });
      // Dotted --set keys change only that key (set at objects#id.<key>).
      for (const [k, value] of sets) ops.push({ op: "set", path: `objects#${oid}.${k}`, value });
      return runPatch(io, options, fs, ops, `Update "${oid}"`);
    }
    if (action === "remove") {
      const oid = positional(positionals, 1, "object id", "object remove <id>");
      return runPatch(io, options, fs, [{ op: "removeObject", id: oid }], `Remove "${oid}"`, { destructive: true });
    }
    if (action === "move") {
      const oid = positional(positionals, 1, "object id", "object move <id> --parent <id>");
      const parent = boolOpt(options, "root") ? null : strOpt(options, "parent");
      if (parent === undefined && index === undefined) usage("object move needs --parent <id>, --root or --index <n>.");
      return runPatch(io, options, fs, [{ op: "moveObject", id: oid, ...(parent !== undefined ? { parent } : {}), ...(index !== undefined ? { index } : {}) }], `Move "${oid}"`);
    }
    void id;
    usage(`Unknown object action "${action}".`, "Use add, update, remove, list, get or move.");
  },
};

// ─── timeline ───────────────────────────────────────────────────────────

export const timelineCommand: Command = {
  name: "timeline",
  usage: "timeline <get|set|add-track|remove-track> [--project <dir>]",
  summary: "Keyframe timeline: read it, replace it, add or remove a track (target \"<objectId>.<property>\", keys [[t, value], …]).",
  subcommands: [
    { name: "get", usage: "timeline get", summary: "The timeline (duration, loop, trigger, tracks)." },
    { name: "set", usage: "timeline set --file <timeline.json|-> | [--duration <s>] [--loop true|false|pingpong] [--trigger load|visible|hover|click|scroll]", summary: "Replace the timeline, or change its settings.", writes: true },
    { name: "add-track", usage: "timeline add-track --target <obj.prop> --keys <json> [--ease <name>] | --json-def <track>", summary: 'Add a track, e.g. --target logo.rotation.y --keys "[[0,0],[4,360]]".', writes: true },
    { name: "remove-track", usage: "timeline remove-track --target <obj.prop> [--yes]", summary: "Remove the track(s) of a target.", writes: true, destructive: true },
  ],
  options: [
    PROJECT_OPTION,
    FILE_OPTION,
    { name: "duration", type: "string", description: "set: duration in seconds." },
    { name: "loop", type: "string", description: "set: true, false or pingpong." },
    { name: "trigger", type: "string", description: "set: load, visible, hover, click or scroll." },
    { name: "target", type: "string", description: 'add-track / remove-track: "<objectId>.<property path>" (e.g. logo.position.y, camera.position).' },
    { name: "keys", type: "string", description: "add-track: [[time, value], …] as JSON." },
    { name: "ease", type: "string", description: "add-track: easing (linear, inOutCubic, outBack, outElastic, …)." },
    { name: "json-def", type: "string", description: "add-track: the whole track as JSON." },
    DRY_RUN_OPTION,
    YES_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action = "get", ...rest] = positionals;
    const fs = projectFs(options);
    if (action === "get") {
      const { getScene } = await import("../../src/ops/scene");
      const timeline = (await getScene(fs)).timeline ?? null;
      return printResult(io, { timeline }, () => (timeline ? JSON.stringify(timeline, null, 2) : "No timeline."));
    }
    if (action === "set") {
      if (strOpt(options, "file") !== undefined || rest.length) {
        const timeline = jsonInput(options, rest, "the timeline", '--file timeline.json with {"duration":4,"loop":true,"tracks":[]}');
        return runPatch(io, options, fs, [{ op: "set", path: "timeline", value: timeline }], "Replace the timeline", { destructive: true });
      }
      const ops: PatchOp[] = [];
      const { getScene } = await import("../../src/ops/scene");
      const has = !!(await getScene(fs)).timeline;
      const duration = numOpt(options, "duration");
      const loop = strOpt(options, "loop");
      const trigger = strOpt(options, "trigger");
      if (duration === undefined && loop === undefined && trigger === undefined) usage("Nothing to set.", "Pass --file <timeline.json>, or --duration / --loop / --trigger.");
      if (!has) ops.push({ op: "set", path: "timeline", value: { duration: duration ?? 4, tracks: [] } });
      if (duration !== undefined) ops.push({ op: "set", path: "timeline.duration", value: duration });
      if (loop !== undefined) ops.push({ op: "set", path: "timeline.loop", value: loop === "pingpong" ? "pingpong" : loop === "true" });
      if (trigger !== undefined) ops.push({ op: "set", path: "timeline.trigger", value: trigger });
      return runPatch(io, options, fs, ops, "Timeline settings");
    }
    if (action === "add-track") {
      let track = jsonObjectOpt(options, "json-def");
      if (!track) {
        const target = strOpt(options, "target");
        const keys = jsonOpt(options, "keys", '--keys "[[0,[0,0,0]],[2,[0,1,0]]]"');
        if (!target || !Array.isArray(keys)) usage("add-track needs --target and --keys (or --json-def).", 'e.g. --target logo.rotation.y --keys "[[0,0],[4,360]]" --ease inOutCubic');
        track = { target, keys, ...(strOpt(options, "ease") ? { ease: strOpt(options, "ease") } : {}) };
      }
      return runPatch(io, options, fs, [{ op: "addTrack", track }], `Add track ${String(track.target)}`);
    }
    if (action === "remove-track") {
      const target = strOpt(options, "target") ?? rest[0];
      if (!target) usage("remove-track needs --target <obj.prop>.");
      return runPatch(io, options, fs, [{ op: "removeTrack", target }], `Remove track ${target}`, { destructive: true });
    }
    usage(`Unknown timeline action "${action}".`, "Use get, set, add-track or remove-track.");
  },
};
