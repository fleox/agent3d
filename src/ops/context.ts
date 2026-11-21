// Shared bits of the engine: the error type every op throws, JSON file
// helpers over ProjectFs and the engine version. Ops are pure TS over
// ProjectFs (no DOM, no Node APIs) — they run in the CLI, MCP server and the
// browser Studio alike.

import { FsError, type ProjectFs } from "../core/fs";
import type { Issue } from "../core/types";

export const AGENT3D_VERSION = "0.1.0";

export type OpsErrorCode = "notFound" | "validation" | "conflict" | "invalid" | "forbidden-script" | "io";

export class OpsError extends Error {
  override name = "OpsError";
  constructor(
    readonly code: OpsErrorCode,
    message: string,
    readonly hint?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  toJSON(): { code: OpsErrorCode; message: string; hint?: string; details?: unknown } {
    return { code: this.code, message: this.message, ...(this.hint ? { hint: this.hint } : {}), ...(this.details !== undefined ? { details: this.details } : {}) };
  }
}

// Validation failure carrying the issues (errors first).
export function validationError(message: string, issues: Issue[], hint?: string): OpsError {
  const errors = issues.filter((i) => i.severity === "error");
  const first = errors[0];
  return new OpsError(
    "validation",
    `${message} ${errors.length} error${errors.length === 1 ? "" : "s"}${first ? `, first: ${first.path ? `${first.path}: ` : ""}${first.message}` : ""}`,
    hint ?? first?.hint ?? "Fix the listed issues (details.issues) and retry.",
    { issues },
  );
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === "error");

export function nowIso(): string {
  return new Date().toISOString();
}

export async function readJson<T>(fs: ProjectFs, path: string, what: string): Promise<T> {
  let text: string;
  try {
    text = await fs.readText(path);
  } catch (e) {
    if (e instanceof FsError && e.code === "notFound") throw new OpsError("notFound", `${what} not found (${path}).`, path === "agent3d.json" || path === "scene.json" ? "This folder is not an Agent3D project: create one with `agent3d new <dir>` (tool project_create) or pass --project <dir>." : undefined);
    throw new OpsError("io", `Cannot read ${path}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new OpsError("invalid", `${path} is not valid JSON: ${(e as Error).message}`, `Fix the JSON syntax in ${path} (trailing commas and comments are not allowed).`);
  }
}

export async function writeJson(fs: ProjectFs, path: string, value: unknown): Promise<void> {
  await fs.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonOr<T>(fs: ProjectFs, path: string, fallback: T): Promise<T> {
  if (!(await fs.exists(path))) return fallback;
  return readJson<T>(fs, path, path);
}

export const KB = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;
