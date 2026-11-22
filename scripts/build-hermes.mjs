// Builds the Hermes Agent skills (hermes/skills/) from the agent skills
// (plugin/skills/) and the Python helpers (hermes/python/):
//
//   hermes/skills/<name>/SKILL.md        Hermes frontmatter + the same body,
//                                        commands run through scripts/agent3d.py
//   hermes/skills/<name>/references/     same files, same rewrite
//   hermes/skills/<name>/scripts/*.py    agent3d.py (+ the skill's helpers),
//                                        version-pinned
//
// plugin/skills stays the single source of truth: never edit hermes/skills
// by hand. `--check` fails when the committed output is stale (CI).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const check = process.argv.includes("--check");

const SOURCE = join(root, "plugin", "skills");
const PY = join(root, "hermes", "python");
const OUT = join(root, "hermes", "skills");

// Python helpers shipped with each skill (agent3d.py always).
const HELPERS = {
  "agent3d-create": ["new_banner.py", "render_and_check.py"],
  "agent3d-edit": ["render_and_check.py"],
  "agent3d-assets": [],
  "agent3d-game": ["render_and_check.py"],
  "agent3d-publish": ["render_and_check.py"],
};
const TAGS = {
  "agent3d-create": ["Agent3D", "3D", "WebGL", "Banner", "Design", "Web"],
  "agent3d-edit": ["Agent3D", "3D", "WebGL", "Editing", "Rebrand"],
  "agent3d-assets": ["Agent3D", "3D", "Assets", "CC0", "Licences"],
  "agent3d-game": ["Agent3D", "3D", "Games", "Scripting", "Interactive"],
  "agent3d-publish": ["Agent3D", "3D", "Export", "Embed", "WordPress", "React"],
};

const RUN_SKILL = "python3 ${HERMES_SKILL_DIR}/scripts/agent3d.py";
const RUN_REF = "python3 <skill dir>/scripts/agent3d.py";

function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error("no frontmatter");
  const get = (key) => new RegExp(`^${key}:\\s*(.*)$`, "m").exec(m[1])?.[1]?.trim() ?? "";
  return { name: get("name"), description: get("description"), license: get("license"), body: md.slice(m[0].length) };
}

// Commands and Claude Code specifics → the Hermes wrapper.
function rewrite(text, run) {
  return text
    .replace(/npx -y @fleox\/agent3d@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? /g, `${run} `)
    .replace(/open `data\.sheet` \(a PNG contact sheet with time labels\) with the Read tool/g, "open `data.sheet` (a PNG contact sheet with time labels) with your vision / image tool")
    .replace(/\(Read the `data\.sheet` PNG\)/g, "(open the `data.sheet` PNG with your vision / image tool)")
    .replace(/with the Read tool/g, "with your vision / image tool");
}

function hermesHeader(name) {
  const helpers = HELPERS[name] ?? [];
  return [
    "## Running the commands (Hermes)",
    "",
    `Every \`agent3d <command>\` below runs through this skill's Python wrapper: \`${RUN_SKILL} <command> …\`. It adds \`--json\`, prints the CLI's JSON object (\`{"ok": true, "data": …}\` or \`{"ok": false, "error": {code, message, hint}}\`) and exits with the CLI's code. In the reference files, \`${RUN_REF}\` means the same command with this skill's directory.`,
    "",
    "- **Requirements:** Python 3.9+ (stdlib only), **Node.js 22+** and, for renders, posters and videos, Google Chrome / Chromium / Edge. The Agent3D engine is the `@fleox/agent3d` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENT3D_CMD` overrides the engine command (e.g. `node /path/to/agent3d/dist/agent/agent3d.mjs` from a clone); `AGENT3D_CHROME` points at a browser binary.",
    "- **From Python:** `sys.path.insert(0, \"${HERMES_SKILL_DIR}/scripts\")`, then `from agent3d import run, patch, needs_confirmation, Agent3dError` — `run(\"scene\", \"summary\", project=\"my-banner\")` returns `data` and raises `Agent3dError(code, message, hint, details)` when `ok` is false (validation issues are in `details[\"issues\"]`); `patch(ops, project=…)` sends patch ops on stdin.",
    "- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)`. Show the plan to the user before re-running with `--yes`.",
    "- **Looking at renders:** `render` returns PNG paths (`data.sheet`, `data.frames`). Open them with your vision / image tool; if you can't view images, rely on `data.inspect` and `check --render` and tell the user you couldn't check the look.",
    "- **Long-running commands** (`serve`, `studio`, `mcp`) need the user's own terminal: give them the command instead of running it.",
    ...(helpers.length
      ? ["- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):", ...helpers.map((h) => `  - \`${h}\`: ${helperSummary(h)}`)]
      : []),
    "",
  ].join("\n");
}

function helperSummary(file) {
  const src = readFileSync(join(PY, file), "utf8");
  const doc = /"""([\s\S]*?)"""/.exec(src)?.[1]?.trim().split("\n")[0] ?? "";
  return doc.replace(/\.$/, "") + ".";
}

function buildSkill(name) {
  const src = join(SOURCE, name);
  const fm = frontmatter(readFileSync(join(src, "SKILL.md"), "utf8"));
  if (!TAGS[name]) throw new Error(`scripts/build-hermes.mjs: add "${name}" to HELPERS and TAGS`);
  const others = Object.keys(HELPERS).filter((n) => n !== name);
  const header = [
    "---",
    `name: ${fm.name}`,
    `description: ${JSON.stringify(fm.description.replace(/^"|"$/g, ""))}`,
    `version: ${version}`,
    "author: Agent3D",
    `license: ${fm.license}`,
    "platforms: [macos, linux, windows]",
    "metadata:",
    "  hermes:",
    `    tags: [${TAGS[name].join(", ")}]`,
    `    related_skills: [${others.join(", ")}]`,
    "---",
    "",
  ].join("\n");
  // Insert the Hermes section right before the first "## " section.
  const body = rewrite(fm.body, RUN_SKILL);
  const firstSection = body.indexOf("\n## ");
  const merged = firstSection >= 0 ? body.slice(0, firstSection + 1) + hermesHeader(name) + "\n" + body.slice(firstSection + 1) : body + "\n" + hermesHeader(name);
  const files = new Map([["SKILL.md", header + merged]]);
  const refs = join(src, "references");
  if (existsSync(refs)) {
    for (const f of readdirSync(refs)) files.set(`references/${f}`, rewrite(readFileSync(join(refs, f), "utf8"), RUN_REF));
  }
  for (const py of ["agent3d.py", ...(HELPERS[name] ?? [])]) {
    files.set(`scripts/${py}`, readFileSync(join(PY, py), "utf8").replace(/__AGENT3D_VERSION__/g, version));
  }
  return files;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const expected = new Map();
for (const name of readdirSync(SOURCE)) {
  if (!existsSync(join(SOURCE, name, "SKILL.md"))) continue;
  for (const [rel, content] of buildSkill(name)) expected.set(join(OUT, name, rel), content);
}

if (check) {
  const problems = [];
  for (const [file, content] of expected) {
    if (!existsSync(file)) problems.push(`missing ${relative(root, file)}`);
    else if (readFileSync(file, "utf8") !== content) problems.push(`stale ${relative(root, file)}`);
  }
  for (const file of walk(OUT)) if (!expected.has(file) && !file.includes("__pycache__")) problems.push(`extra ${relative(root, file)}`);
  if (problems.length) {
    console.error(`[hermes] hermes/skills is out of date (run \`npm run hermes:build\`):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`[hermes] ${expected.size} file(s) up to date for agent3d ${version}`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [file, content] of expected) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { mode: file.endsWith(".py") ? 0o755 : 0o644 });
  }
  console.log(`[hermes] wrote ${expected.size} file(s) to hermes/skills for agent3d ${version}`);
}
