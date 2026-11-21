import { format } from "node:util";

// Output protocol shared by every command (mirror of agentcrm agent/output.ts).
// Agents parse --json output, so it is one JSON object per invocation:
//   success → { "ok": true, "data": … }
//   failure → { "ok": false, "error": { "code", "message", "hint"? } }
// Human mode prints plain text. Logs and progress always go to stderr so
// they never corrupt the JSON on stdout. Exit codes: 0 ok, 1 failure,
// 2 usage error (bad arguments, invalid input, validation).

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// stdout belongs to the command's result (one JSON object with --json, the
// JSON-RPC frames of `mcp`). Third-party code (scene scripts evaluated by
// ops, libraries) may call console.log / info / debug: send those to stderr
// so they never corrupt it. Called once by the binary entry (agent/bin.ts).
export function routeConsoleToStderr(target: Pick<Console, "log" | "info" | "debug"> = console, write: (text: string) => void = (t) => void process.stderr.write(t)): void {
  const toStderr = (...args: unknown[]) => write(`${format(...args)}\n`);
  target.log = toStderr;
  target.info = toStderr;
  target.debug = toStderr;
}

export interface Io {
  json: boolean;
  out(text: string): void;
  err(text: string): void;
}

export function createIo(json: boolean): Io {
  return {
    json,
    out: (text) => process.stdout.write(text.endsWith("\n") ? text : text + "\n"),
    err: (text) => process.stderr.write(text.endsWith("\n") ? text : text + "\n"),
  };
}

export function printResult(io: Io, data: unknown, human: () => string): void {
  if (io.json) io.out(JSON.stringify({ ok: true, data }));
  else io.out(human());
}

const OPS_HINTS: Record<string, string> = {
  notFound: "Check the id or path (`agent3d object list`, `agent3d scene summary`, `agent3d assets list` print them).",
  validation: "Fix the scene and retry: `agent3d scene validate` lists every issue with its JSON path and a hint; `agent3d catalog <section> <id>` documents the parameters.",
  conflict: "Something with the same id already exists — list it first (`agent3d object list`), then update instead of adding, or pick another id.",
  invalid: "Check the arguments with `agent3d help <command>`.",
  "forbidden-script": "Scene scripts only get the ScriptApi (src/runtime/api.ts): remove fetch, eval, document, window, storage… and use api.* instead. `agent3d check` lists the offending lines.",
  io: "A file could not be read or written: check the path and permissions of the project folder (--project <dir>).",
};

// Known errors thrown by the engine (OpsError, FsError), translated into
// codes and hints an agent can act on.
export function knownError(error: unknown): CliError | null {
  if (!(error instanceof Error)) return null;
  if (error.name === "OpsError") {
    const e = error as Error & { code?: string; hint?: string; details?: unknown };
    const code = e.code ?? "invalid";
    return new CliError(code, error.message, e.hint || OPS_HINTS[code] || OPS_HINTS.invalid, code === "validation" || code === "invalid" ? 2 : 1, e.details);
  }
  if (error.name === "FsError") {
    const code = (error as Error & { code?: string }).code;
    if (code === "notFound") return new CliError("notFound", error.message, "Is --project pointing at an Agent3D project folder (agent3d.json + scene.json)? Create one with `agent3d new <dir>`.");
    if (code === "invalidPath") return new CliError("invalid-path", error.message, "Project paths are relative to the project folder and never contain \"..\" or an absolute prefix.", 2);
    return new CliError("io", error.message, OPS_HINTS.io);
  }
  return null;
}

export function toCliError(error: unknown): CliError {
  return error instanceof CliError
    ? error
    : knownError(error) ??
        new CliError("internal", error instanceof Error ? error.message : String(error), "Unexpected error. Retry once; if it persists, report it with the command and this output (`agent3d doctor` checks the setup).");
}

export function printError(io: Io, error: unknown): number {
  const e = toCliError(error);
  const details = e.details !== undefined ? { details: e.details } : {};
  if (io.json) io.out(JSON.stringify({ ok: false, error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}), ...details } }));
  else io.err(`Error: ${e.message}${e.hint ? `\nHint: ${e.hint}` : ""}`);
  return e.exitCode;
}
