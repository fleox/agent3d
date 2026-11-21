// Every command the CLI exposes. `help --json` lists them (with their
// subcommands and options), and scripts/check-skills.mjs fails the build
// when a skill mentions a command or subcommand that is not here — keep
// skills and commands in sync.
import { CliError, printResult } from "../output";
import { readVersionInfo } from "../paths";
import { assetsCommand } from "./assets";
import { catalogCommand, templatesCommand } from "./catalog";
import { checkCommand } from "./check";
import { doctorCommand, versionCommand } from "./meta";
import { infoCommand, newCommand } from "./project";
import { exportCommand, renderCommand } from "./render";
import { objectCommand, sceneCommand, timelineCommand } from "./scene";
import { serveCommand, studioCommand } from "./serve";
import { mcpCommand, toolsCommand } from "./tools";
import type { Command, CommandOption } from "./types";

export const GLOBAL_OPTIONS: CommandOption[] = [
  { name: "json", type: "boolean", description: "Print one JSON object on stdout: { ok, data } or { ok: false, error: { code, message, hint } }." },
  { name: "help", type: "boolean", description: "Show the command's usage and options instead of running it." },
];

const helpCommand: Command = {
  name: "help",
  usage: "help [<command>]",
  summary: "List commands with their subcommands and options (--json gives a machine-readable list).",
  options: [],
  async run({ io, positionals }) {
    const wanted = positionals[0];
    const list = wanted ? COMMANDS.filter((c) => c.name === wanted) : COMMANDS;
    if (wanted && !list.length) throw new CliError("unknown-command", `Unknown command "${wanted}".`, `Available: ${COMMANDS.map((c) => c.name).join(", ")}.`, 2);
    const { version } = readVersionInfo();
    const data = {
      name: "agent3d",
      version,
      globalOptions: GLOBAL_OPTIONS,
      commands: list.map(({ name, summary, usage, options, subcommands, writes }) => ({ name, summary, usage, options, ...(subcommands ? { subcommands } : {}), ...(writes ? { writes } : {}) })),
    };
    printResult(io, data, () =>
      [
        `agent3d ${version} — the 3D studio your AI agent can run.`,
        "",
        "Usage: agent3d <command> [options] [--json]",
        "",
        ...list.flatMap((c) => [
          `  ${c.usage}`,
          `      ${c.summary}`,
          ...(wanted ? (c.subcommands ?? []).map((s) => `      · ${s.usage}\n          ${s.summary}`) : []),
          ...(wanted ? c.options.map((o) => `      --${o.name}${o.type === "string" ? " <value>" : ""}  ${o.description}`) : []),
        ]),
        "",
        "Global options:",
        ...GLOBAL_OPTIONS.map((o) => `  --${o.name}  ${o.description}`),
        ...(wanted ? [] : ["", "`agent3d help <command>` shows a command's actions and options."]),
      ].join("\n"),
    );
  },
};

export const COMMANDS: Command[] = [
  helpCommand,
  versionCommand,
  newCommand,
  infoCommand,
  sceneCommand,
  objectCommand,
  timelineCommand,
  catalogCommand,
  templatesCommand,
  checkCommand,
  renderCommand,
  serveCommand,
  studioCommand,
  exportCommand,
  assetsCommand,
  toolsCommand,
  mcpCommand,
  doctorCommand,
];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}
