// Release guard for the agent skills (run in CI after `npm run build`).
// Fails when skills drift from the code they drive (mirror of agentcrm):
//   - plugin / skill / package versions differ, or a skill pins another
//     agent3d version than the one being released
//   - a skill calls an `agent3d <command> [<action>]` the CLI doesn't have,
//     or passes an option that command doesn't accept (checked against
//     `help --json` of the built CLI)
//   - SKILL.md frontmatter uses non-portable keys, or name ≠ folder
//   - skill text is not English (agents translate for the user at runtime)
//   - a ```json block starting with { or [ is not valid JSON
//   - a ```json block that looks like a full scene ("version" + "objects")
//     fails `agent3d scene validate` (errors or warnings)
//   - changelog.json has no entry for this version
// Usage: node scripts/check-skills.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const pkg = JSON.parse(read("package.json"));
const version = pkg.version;
const problems = [];
const fail = (file, msg) => problems.push(`${file}: ${msg}`);

// --- versions ---------------------------------------------------------
const plugin = JSON.parse(read("plugin/.claude-plugin/plugin.json"));
const market = JSON.parse(read(".claude-plugin/marketplace.json"));
if (plugin.version !== version) fail("plugin/.claude-plugin/plugin.json", `version ${plugin.version} ≠ package.json ${version} (run \`node scripts/sync-version.mjs\`)`);
const entry = market.plugins?.find((p) => p.name === plugin.name);
if (!entry) fail(".claude-plugin/marketplace.json", `no plugin entry named "${plugin.name}"`);
else {
  if (entry.version) fail(".claude-plugin/marketplace.json", "set the version in plugin.json only (it silently wins over the entry's)");
  if (entry.source !== "./plugin") fail(".claude-plugin/marketplace.json", `plugin source must be "./plugin" (is ${entry.source})`);
}

const versionFile = join(root, "dist", "version.json");
if (!existsSync(versionFile)) fail("dist/version.json", "missing — run `npm run build` (or `node scripts/write-version.mjs`) first");
else {
  const info = JSON.parse(readFileSync(versionFile, "utf8"));
  if (info.version !== version) fail("dist/version.json", `version ${info.version} ≠ ${version} — rebuild`);
  if (info.minSkillsVersion && cmp(info.minSkillsVersion, version) > 0) fail("package.json", `minSkillsVersion ${info.minSkillsVersion} is newer than the release ${version}`);
}

const changelog = JSON.parse(read("changelog.json"));
if (!changelog.versions?.some((v) => v.version === version)) fail("changelog.json", `no entry for ${version}`);
for (const v of changelog.versions ?? []) {
  if (typeof v.version !== "string" || typeof v.date !== "string" || typeof v.breaking !== "boolean" || !Array.isArray(v.changes) || !Array.isArray(v.actions)) {
    fail("changelog.json", `entry ${v.version ?? "?"} needs version, date, breaking (boolean), changes[] and actions[]`);
  }
}
const order = (changelog.versions ?? []).map((v) => v.version);
if (order.join() !== [...order].sort((a, b) => cmp(b, a)).join()) fail("changelog.json", "entries must be sorted newest first");

// --- CLI commands -----------------------------------------------------
const cli = join(root, "dist", "agent", "agent3d.mjs");
/** @type {Map<string, { subs: Set<string>, options: Set<string> }>} */
let commands = new Map();
let globalOptions = new Set();
if (!existsSync(cli)) fail("dist/agent/agent3d.mjs", "missing — run `npm run build` first");
else {
  const help = JSON.parse(execFileSync(process.execPath, [cli, "help", "--json"], { encoding: "utf8" }));
  globalOptions = new Set((help.data.globalOptions ?? []).map((o) => o.name));
  commands = new Map(help.data.commands.map((c) => [c.name, { subs: new Set((c.subcommands ?? []).map((s) => s.name)), options: new Set((c.options ?? []).map((o) => o.name)) }]));
}

// --- skills -----------------------------------------------------------
const PORTABLE_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const FRENCH = /\b(les|des|une|est|pour|avec|dans|vous|votre|vos|nous|sont|cette|mais|aussi|donc|être|faire|fichier|dossier|hébergement|données|jeton|clé|ici|puis|déjà|scène|couleur)\b/i;
const ACCENTED = /[À-ÖØ-öø-ÿŒœ]/;
const CALL = /npx(?:\s+-y)?\s+((?:@[\w.-]+\/)?agent3d)(@[0-9][\w.-]*)?(?:[ \t]+([a-z][a-z-]*))?(?:[ \t]+([a-z][a-z-]*))?([^\n`]*)/g;

const skillsDir = join(root, "plugin", "skills");
const skills = existsSync(skillsDir) ? readdirSync(skillsDir).filter((n) => existsSync(join(skillsDir, n, "SKILL.md"))) : [];
if (skills.length === 0) fail("plugin/skills", "no skills found");
let calls = 0;
const scenes = [];
let jsonBlocks = 0;
for (const name of skills) {
  const skillMd = join(skillsDir, name, "SKILL.md");
  const rel = relative(root, skillMd);
  const fm = frontmatter(readFileSync(skillMd, "utf8"));
  if (!fm) {
    fail(rel, "missing YAML frontmatter");
    continue;
  }
  for (const key of fm.keys) if (!PORTABLE_KEYS.has(key)) fail(rel, `frontmatter key "${key}" is not portable (allowed: ${[...PORTABLE_KEYS].join(", ")})`);
  if (fm.values.name !== name) fail(rel, `name "${fm.values.name}" must equal its folder "${name}"`);
  if (!fm.values.description) fail(rel, "description is required");
  if ((fm.values.description ?? "").length > 1024) fail(rel, "description longer than 1024 characters");
  if (fm.values.license !== "PolyForm-Noncommercial-1.0.0") fail(rel, `license must be PolyForm-Noncommercial-1.0.0 (is ${fm.values.license})`);
  if (!fm.values.compatibility) fail(rel, "compatibility is required (Node.js and Chrome requirements)");
  if (fm.values["metadata.version"] !== version) fail(rel, `metadata.version ${fm.values["metadata.version"]} ≠ ${version}`);

  for (const file of walk(join(skillsDir, name))) {
    const r = relative(root, file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(CALL)) {
      calls++;
      const [, pkgName, pin, cmd, sub, rest] = m;
      if (pkgName !== pkg.name) fail(r, `calls the package "${pkgName}" — the npm package is ${pkg.name}`);
      if (!pin) fail(r, `unpinned "${m[0].slice(0, 60)}" — always call npx -y ${pkg.name}@${version}`);
      else if (pin !== `@${version}`) fail(r, `pins ${pkgName}${pin} instead of @${version}`);
      if (!cmd || !commands.size) continue;
      const def = commands.get(cmd);
      if (!def) {
        fail(r, `calls unknown command "${cmd}" (have: ${[...commands.keys()].join(", ")})`);
        continue;
      }
      if (sub && def.subs.size && !def.subs.has(sub) && !/^-/.test(sub)) {
        fail(r, `calls unknown action "${cmd} ${sub}" (have: ${[...def.subs].join(", ")})`);
      }
      // Options on the same line (stop at a shell comment).
      const args = (sub && def.subs.size ? "" : ` ${sub ?? ""}`) + rest.replace(/\s#.*$/, "");
      for (const o of args.matchAll(/(?:^|\s)--([a-z][a-z0-9-]*)/g)) {
        if (!def.options.has(o[1]) && !globalOptions.has(o[1])) fail(r, `"${cmd}" has no option --${o[1]} (have: ${[...def.options].map((x) => `--${x}`).join(", ") || "none"})`);
      }
    }
    // ```json blocks: valid JSON; full scenes validated by the engine.
    for (const b of text.matchAll(/```json\n([\s\S]*?)```/g)) {
      const body = b[1].trim();
      if (!/^[[{]/.test(body)) continue;
      jsonBlocks++;
      const line = text.slice(0, b.index).split("\n").length;
      let value;
      try {
        value = JSON.parse(body);
      } catch (err) {
        fail(`${r}:${line}`, `invalid JSON in a \`\`\`json block: ${err.message}`);
        continue;
      }
      if (value && typeof value === "object" && !Array.isArray(value) && "version" in value && "objects" in value) scenes.push({ where: `${r}:${line}`, body });
    }
    const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    prose.split("\n").forEach((line, i) => {
      if (ACCENTED.test(line) || FRENCH.test(line)) fail(`${r}:${i + 1}`, `not English: ${line.trim().slice(0, 80)}`);
    });
  }
}

// Full scene examples must pass the engine's validation (no errors, no warnings).
if (existsSync(cli)) {
  for (const s of scenes) {
    const res = spawnSync(process.execPath, [cli, "scene", "validate", "--file", "-", "--json"], { input: s.body, encoding: "utf8" });
    let out;
    try {
      out = JSON.parse(res.stdout.trim().split("\n").pop());
    } catch {
      fail(s.where, `scene validate printed no JSON (exit ${res.status}): ${res.stderr.slice(0, 200)}`);
      continue;
    }
    const issues = out.data?.issues ?? out.error?.details?.issues ?? [];
    const bad = issues.filter((i) => i.severity !== "info");
    if (!out.ok || bad.length) fail(s.where, `scene example does not validate: ${bad.map((i) => `${i.path}: ${i.message}`).join("; ") || out.error?.message}`);
  }
}

if (problems.length) {
  console.error(`[check-skills] ${problems.length} problem(s):\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`[check-skills] ${skills.length} skill(s), ${calls} command call(s), ${jsonBlocks} JSON block(s), ${scenes.length} scene example(s) OK for agent3d ${version}`);

// --- helpers ----------------------------------------------------------
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(md|txt)$/.test(e.name) ? [join(dir, e.name)] : []));
}

// Tiny YAML-frontmatter reader: top-level keys + one level of nesting.
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const keys = [];
  const values = {};
  let parent = null;
  for (const line of m[1].split("\n")) {
    const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    const nested = /^\s+([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (top) {
      keys.push(top[1]);
      parent = top[2] === "" ? top[1] : null;
      values[top[1]] = unquote(top[2]);
    } else if (nested && parent) {
      values[`${parent}.${nested[1]}`] = unquote(nested[2]);
    }
  }
  return { keys, values };
}

function unquote(v) {
  return v.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function cmp(a, b) {
  const pa = a.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}
