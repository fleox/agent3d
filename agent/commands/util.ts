import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NodeFs } from "../nodeFs";
import { CliError, printResult, type Io } from "../output";
import type { CommandOption, OptionValue } from "./types";

// Option parsing shared by the commands (mirror of agentcrm commands/util.ts).

export type Options = Record<string, OptionValue>;

export function usage(message: string, hint?: string): never {
  throw new CliError("usage", message, hint, 2);
}

export function strOpt(options: Options, name: string): string | undefined {
  const v = options[name];
  if (Array.isArray(v)) return v.at(-1);
  return typeof v === "string" ? v : undefined;
}

export function requireStr(options: Options, name: string, hint?: string): string {
  const v = strOpt(options, name);
  if (!v || !v.trim()) usage(`--${name} is required.`, hint);
  return v.trim();
}

export function listOpt(options: Options, name: string): string[] | undefined {
  const v = options[name];
  if (v === undefined || v === false) return undefined;
  const all = Array.isArray(v) ? v : [String(v)];
  return all.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
}

export function multiOpt(options: Options, name: string): string[] {
  const v = options[name];
  if (v === undefined || v === false) return [];
  return Array.isArray(v) ? v : [String(v)];
}

export function numOpt(options: Options, name: string): number | undefined {
  const v = strOpt(options, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) usage(`--${name} must be a number, got "${v}".`);
  return n;
}

export function boolOpt(options: Options, name: string): boolean {
  return options[name] === true;
}

// Reads stdin once (several options may not all be "-").
let stdinText: string | null = null;
export function readStdin(): string {
  if (stdinText === null) stdinText = readFileSync(0, "utf8");
  return stdinText;
}

// `--x value`, `--x @file` (file contents) or `--x -` (stdin).
export function readTextValue(value: string, name: string): string {
  if (value === "-") return readStdin();
  if (value.startsWith("@")) {
    const file = value.slice(1);
    if (!existsSync(file)) usage(`--${name}: ${file} does not exist.`);
    return readFileSync(file, "utf8");
  }
  return value;
}

export function parseJson(text: string, what: string, example: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    usage(`${what} is not valid JSON: ${(err as Error).message}`, `Example: ${example}`);
  }
}

export function jsonOpt(options: Options, name: string, example = `--${name} '{"id":"logo"}' or --${name} @file.json`): unknown {
  const v = strOpt(options, name);
  if (v === undefined) return undefined;
  return parseJson(readTextValue(v, name), `--${name}`, example);
}

export function jsonObjectOpt(options: Options, name: string): Record<string, unknown> | undefined {
  const v = jsonOpt(options, name);
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) usage(`--${name} must be a JSON object.`);
  return v as Record<string, unknown>;
}

// A JSON document given as --file <path|->, as a positional "@file" / "-",
// or inline as a positional JSON string.
export function jsonInput(options: Options, positionals: string[], what: string, example: string): unknown {
  const file = strOpt(options, "file");
  let text: string | undefined;
  if (file !== undefined) {
    if (file === "-") text = readStdin();
    else {
      const f = file.startsWith("@") ? file.slice(1) : file;
      if (!existsSync(f)) usage(`--file: ${f} does not exist.`);
      text = readFileSync(f, "utf8");
    }
  } else if (positionals.length) {
    text = readTextValue(positionals[0], "file");
  }
  if (text === undefined) usage(`Missing ${what}.`, `Pass --file <path>, --file - (stdin), @file or inline JSON. ${example}`);
  return parseJson(text, what, example);
}

// "42" → 42, "true" → true, "null" → null, '[1,2,3]' → array; anything
// that doesn't round-trip ("00123", "#ff0000") stays a string.
export function parseScalar(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  try {
    const v = JSON.parse(t) as unknown;
    if (typeof v === "string") return v;
    if (typeof v === "number" && String(v) !== t) return raw;
    return v;
  } catch {
    return raw;
  }
}

// --set a.b.c=value (repeated): dotted keys build nested objects.
export function setPairs(options: Options): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of multiOpt(options, "set")) {
    const i = pair.indexOf("=");
    if (i <= 0) usage(`--set expects key=value, got "${pair}".`, 'e.g. --set position=[0,1,0] --set material.color="#ff3366" --set geometry.radius=0.8');
    const keys = pair.slice(0, i).trim().split(".");
    let node = out;
    for (const k of keys.slice(0, -1)) {
      if (!node[k] || typeof node[k] !== "object" || Array.isArray(node[k])) node[k] = {};
      node = node[k] as Record<string, unknown>;
    }
    node[keys.at(-1)!] = parseScalar(pair.slice(i + 1));
  }
  return out;
}

// Deep merge of plain objects (arrays and scalars replace).
export function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b) ? deepMerge(b as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
}

// Last line of every human plan (the --json answer carries needsConfirmation).
export const PLAN_FOOTER = "Nothing changed. Re-run with --yes to apply.";

// Destructive commands: without --yes, print the plan and write nothing.
export function confirmOrPlan(io: Io, options: Options, plan: unknown, human: () => string): boolean {
  if (options.yes === true) return true;
  printResult(io, { needsConfirmation: true, plan }, () => `${human()}\n${PLAN_FOOTER}`);
  return false;
}

export function positional(positionals: string[], index: number, what: string, usageLine: string): string {
  const v = positionals[index];
  if (!v) usage(`Missing ${what}.`, `Usage: agent3d ${usageLine}`);
  return v;
}

export function writeOutFile(path: string, data: string | Uint8Array): string {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return abs;
}

export function table(rows: Record<string, unknown>[], columns: string[]): string {
  if (!rows.length) return "(none)";
  const cell = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\s+/g, " ").slice(0, 70);
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(columns.map((c) => cell(r[c]))))].join("\n");
}

// ─── Project ────────────────────────────────────────────────────────────

export const PROJECT_OPTION: CommandOption = { name: "project", type: "string", description: "Project folder (default: the current directory)." };
export const YES_OPTION: CommandOption = { name: "yes", type: "boolean", description: "Apply — only after the user confirmed the plan." };
export const DRY_RUN_OPTION: CommandOption = { name: "dry-run", type: "boolean", description: "Compute the plan and the issues, write nothing." };
export const FILE_OPTION: CommandOption = { name: "file", type: "string", description: "Read the JSON input from this file (`-` = stdin). A positional @file / - / inline JSON works too." };

export function projectDir(options: Options): string {
  return resolve(strOpt(options, "project") ?? process.cwd());
}

// The project's ProjectFs; fails with a hint when the folder is not a project.
export function projectFs(options: Options, { mustExist = true } = {}): NodeFs {
  const dir = projectDir(options);
  if (mustExist && !existsSync(resolve(dir, "scene.json")))
    throw new CliError(
      "no-project",
      `No Agent3D project in ${dir} (scene.json not found).`,
      existsSync(dir) ? "Pass --project <dir>, or create one with `agent3d new <dir> --target banner`." : `The folder does not exist. Create the project with \`agent3d new ${dir}\`.`,
    );
  return new NodeFs(dir);
}
