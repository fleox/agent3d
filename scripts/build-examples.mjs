#!/usr/bin/env node
// Builds the examples gallery: for each templates/<id>/, creates a temporary
// project with the built CLI (`agent3d new --template`), exports it as an
// `embed` and gathers everything into examples/site/:
//
//   examples/site/
//     agent3d-runtime/      shared by every scene
//     <id>/scene.json …     one folder per template (+ poster.webp)
//     index.html            responsive gallery, each template live in <agent3d-scene>
//     briefs/<id>/ + briefs.html   the blind-QA client briefs (examples/briefs/<id>/)
//
// examples/prompts.json holds the prompt shown under each card.
//
// Usage: node scripts/build-examples.mjs [--no-poster] [--only id,id]
// Needs `npm run build:runtime && npm run build:agent` first (and Chrome for posters).

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "agent", "agent3d.mjs");
const SITE = join(ROOT, "examples", "site");
const args = process.argv.slice(2);
const noPoster = args.includes("--no-poster");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? new Set((args[onlyIdx + 1] ?? "").split(",").filter(Boolean)) : null;

if (!existsSync(CLI)) {
  console.error("dist/agent/agent3d.mjs not found — run `npm run build:runtime && npm run build:agent` first.");
  process.exit(1);
}

function cli(argv) {
  const out = execFileSync(process.execPath, [CLI, ...argv, "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const res = JSON.parse(out);
  if (!res.ok) throw new Error(`agent3d ${argv.join(" ")}: ${res.error?.message} (${res.error?.hint ?? ""})`);
  return res.data;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const PROMPTS = JSON.parse(readFileSync(join(ROOT, "examples", "prompts.json"), "utf8"));
const BRIEFS_DIR = join(ROOT, "examples", "briefs");
const promptBlock = (label, text) => `<details class="prompt"><summary>${esc(label)}</summary><pre>${esc(text)}</pre></details>`;

const templates = cli(["templates", "list"]).templates.filter((t) => !only || only.has(t.id));
if (!templates.length) {
  console.error("No templates found.");
  process.exit(1);
}

if (!only) rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "agent3d-examples-"));
const built = [];

try {
  for (const t of templates) {
    const started = Date.now();
    const proj = join(work, t.id);
    const out = join(work, `${t.id}-export`);
    cli(["new", proj, "--template", t.id]);
    const res = cli(["export", "--project", proj, "--format", "embed", "--out", out, "--name", t.id, "--yes", ...(noPoster ? ["--no-poster"] : [])]);
    rmSync(join(SITE, t.id), { recursive: true, force: true });
    cpSync(join(out, t.id), join(SITE, t.id), { recursive: true });
    if (!built.length) {
      // the shared runtime comes from the first export of this run (always fresh)
      rmSync(join(SITE, "agent3d-runtime"), { recursive: true, force: true });
      cpSync(join(out, "agent3d-runtime"), join(SITE, "agent3d-runtime"), { recursive: true });
    }
    const poster = existsSync(join(SITE, t.id, "poster.webp")) ? `./${t.id}/poster.webp` : null;
    built.push({ ...t, poster, totalKb: res.totalKb });
    console.error(`✓ ${t.id} (${res.totalKb ?? "?"} KB, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
  // Blind-QA briefs: copied to a temp project (export never touches examples/briefs/).
  if (!only) {
    for (const b of PROMPTS.briefs.items) {
      const src = join(BRIEFS_DIR, b.id);
      if (!existsSync(join(src, "scene.json"))) continue;
      const proj = join(work, `brief-${b.id}`);
      const out = join(work, `brief-${b.id}-export`);
      cpSync(src, proj, { recursive: true });
      cli(["export", "--project", proj, "--format", "embed", "--out", out, "--name", b.id, "--yes", ...(noPoster ? ["--no-poster"] : [])]);
      cpSync(join(out, b.id), join(SITE, "briefs", b.id), { recursive: true });
      b.poster = existsSync(join(SITE, "briefs", b.id, "poster.webp")) ? `./briefs/${b.id}/poster.webp` : null;
      b.built = true;
      console.error(`✓ brief ${b.id}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

// When rebuilding a subset, keep the cards of templates already in the site.
if (only) {
  const all = cli(["templates", "list"]).templates;
  for (const t of all) {
    if (built.some((b) => b.id === t.id) || !existsSync(join(SITE, t.id, "scene.json"))) continue;
    built.push({ ...t, poster: existsSync(join(SITE, t.id, "poster.webp")) ? `./${t.id}/poster.webp` : null });
  }
}

const order = ["banner", "hero", "square", "card", "fullscreen", "inline", "game"];
built.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id.localeCompare(b.id));
const ratio = (aspect) => {
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
};

const promptFor = (id) => {
  const p = PROMPTS.templates.byId[id] ?? "";
  return p.startsWith("UPGRADE:") ? `${PROMPTS.templates.upgrade}\n\n${p}` : p;
};

const cards = built
  .map((t) => {
    const wide = ratio(t.aspect) >= 2.5;
    return `    <article class="card${wide ? " wide" : ""}" id="${esc(t.id)}">
      <agent3d-scene src="./${esc(t.id)}/scene.json"${t.poster ? ` poster="${esc(t.poster)}"` : ""}></agent3d-scene>
      <div class="meta">
        <h2>${esc(t.title)}</h2>
        <p>${esc(t.description)}</p>
        <p class="tags"><span class="kind">${esc(t.kind)}</span><span>${esc(t.aspect)}</span><code>agent3d new my-site --template ${esc(t.id)}</code></p>
        ${promptBlock("Prompt", promptFor(t.id))}
      </div>
    </article>`;
  })
  .join("\n");

const page = ({ title, description, heading, intro, body, nav }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<style>
  :root { color-scheme: light dark; --bg: #f6f5f2; --fg: #17161c; --muted: #5d5a66; --card: #ffffff; --line: #e4e1ea; --accent: #6d4aff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f0e14; --fg: #f2f0f7; --muted: #a29fae; --card: #1a1922; --line: #2a2834; --accent: #a48bff; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { max-width: 1240px; margin: 0 auto; padding: 56px 16px 24px; }
  header h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 44px); letter-spacing: -0.02em; }
  header p { margin: 0; color: var(--muted); max-width: 680px; overflow-wrap: anywhere; }
  main { max-width: 1240px; margin: 0 auto; padding: 8px 16px 64px; display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); }
  .card { min-width: 0; background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
  .card.wide { grid-column: 1 / -1; }
  agent3d-scene { display: block; width: 100%; max-width: 100%; overflow: hidden; background: #00000010; }
  .meta { padding: 14px 16px 16px; }
  .meta h2 { margin: 0 0 4px; font-size: 17px; }
  .meta p { margin: 0; color: var(--muted); font-size: 14px; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px !important; align-items: center; }
  .tags span { font-size: 12px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  .tags .kind { color: var(--accent); border-color: currentColor; }
  .tags code { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  nav { display: flex; gap: 16px; margin-bottom: 20px; font-size: 14px; }
  nav a { color: var(--muted); text-decoration: none; } nav a[aria-current] { color: var(--accent); font-weight: 600; }
  header details.prompt { margin-top: 14px; max-width: 820px; }
  .prompt { margin-top: 12px; }
  .prompt summary { cursor: pointer; font-size: 13px; color: var(--accent); }
  .prompt pre { margin: 8px 0 0; padding: 10px 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg); }
  .score { display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600; color: var(--accent); }
  footer { text-align: center; color: var(--muted); font-size: 13px; padding: 0 16px 40px; }
</style>
<script type="module" src="./agent3d-runtime/agent3d-runtime.js"></script>
</head>
<body>
  <header>
    <nav>${nav}</nav>
    <h1>${esc(heading)}</h1>
    ${intro}
  </header>
  <main>
${body}
  </main>
  <footer>Built with <code>node scripts/build-examples.mjs</code> — self-contained, no CDN, no tracking.</footer>
</body>
</html>
`;

const nav = (cur) => [["index.html", "Templates"], ["briefs.html", "Blind-QA client briefs"]].map(([h, l]) => `<a href="./${h}"${h === cur ? ' aria-current="page"' : ""}>${l}</a>`).join("");
const html = page({
  title: "Agent3D templates",
  description: "Live gallery of the Agent3D starter templates: banners, heroes, landscapes, dioramas, characters, product cards and mini games.",
  heading: "Agent3D templates",
  nav: nav("index.html"),
  intro: `<p>${built.length} starter projects, each running live below (scenes start when scrolled into view and pause off-screen). Start one with <code>agent3d new my-site --template &lt;id&gt;</code>, then ask your agent to make it yours.</p>
    <p style="margin-top:10px">${esc(PROMPTS.templates.intro)}</p>
    ${promptBlock("Shared instructions given to every template agent", PROMPTS.templates.shared)}`,
  body: cards,
});
writeFileSync(join(SITE, "index.html"), html);
const briefs = PROMPTS.briefs.items.filter((b) => existsSync(join(SITE, "briefs", b.id, "scene.json")));
if (briefs.length) {
  const bcards = briefs
    .map((b) => `    <article class="card${ratio(b.aspect) >= 2.5 ? " wide" : ""}" id="${esc(b.id)}">
      <agent3d-scene src="./briefs/${esc(b.id)}/scene.json"${b.poster ?? existsSync(join(SITE, "briefs", b.id, "poster.webp")) ? ` poster="./briefs/${esc(b.id)}/poster.webp"` : ""}></agent3d-scene>
      <div class="meta">
        <h2>${esc(b.title)}</h2>
        <p class="tags"><span class="kind">${esc(b.kind)}</span><span>${esc(b.aspect)}</span>${b.scroll ? "<span>scroll the page to drive it</span>" : ""}</p>
        <span class="score">QA score: ${esc(b.scores)}</span>
        ${promptBlock("Client brief (prompt)", b.brief)}
      </div>
    </article>`)
    .join("\n");
  writeFileSync(join(SITE, "briefs.html"), page({
    title: "Agent3D blind-QA briefs",
    description: "Client briefs delivered blind by an AI agent using only the Agent3D skills.",
    heading: "Blind-QA client briefs",
    nav: nav("briefs.html"),
    intro: `<p>${esc(PROMPTS.briefs.intro)}</p>
    ${promptBlock("Shared instructions given to the QA agents", PROMPTS.briefs.shared)}`,
    body: bcards + (briefs.some((b) => b.scroll) ? '\n    <div style="height:60vh;grid-column:1/-1"></div>' : ""),
  }));
}

const kb = (dir) => readdirSync(dir).reduce((s, f) => { const p = join(dir, f); const st = statSync(p); return s + (st.isDirectory() ? kb(p) : st.size); }, 0);
console.error(`\nexamples/site/index.html — ${built.length} templates, ${(kb(SITE) / 1024 / 1024).toFixed(1)} MB in total`);
