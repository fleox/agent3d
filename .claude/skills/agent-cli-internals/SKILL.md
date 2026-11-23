---
name: agent-cli-internals
description: Contributor notes for the agent3d CLI (agent/), its MCP server, the headless render pipeline (Chrome discovery, CDP client, preview page, contact sheets, input events, mp4 / webm / gif / webp encoders), the serve / studio local API, how each front door exposes the AI tools (render_preview host tool), the distributed skills (plugin/skills + check-skills), the generated Hermes skills, the generated CLI docs, CI and npm releases, and QA with parallel AI agents. Invoke when changing agent/ commands, output or hints, the MCP server, the render or video pipeline, the Studio REST API, an AI tool's exposure, a skill, hermes/, the release flow, or when asked to test / validate Agent3D end to end in this repository.
---

# agent3d CLI, MCP, render, skills and releases — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("CLI contract", "Headless render", "AI tools", "Ownership boundaries") and [AGENTS.md](../../../AGENTS.md) first. Don't commit, push or publish unless the user asked in this conversation: pushing a `v*` tag publishes `@fleox/agent3d` to npm. Ops, validation and the tool handlers themselves: [`engine-internals`](../engine-internals/SKILL.md); the player the renders drive: [`runtime-internals`](../runtime-internals/SKILL.md); generators / shaders / audio: [`procedural-internals`](../procedural-internals/SKILL.md); the Studio SPA that consumes `docs/studio-api.md`: [`studio-internals`](../studio-internals/SKILL.md); templates, library, briefs: [`content-internals`](../content-internals/SKILL.md); README and docs pages: [`repo-presentation`](../repo-presentation/SKILL.md); opening a PR: [`create-mr`](../create-mr/SKILL.md).

## Where things live

| Path | What |
|---|---|
| [agent/bin.ts](../../../agent/bin.ts) | entry: `routeConsoleToStderr()`, then exits only after stdout / stderr flushed (large `--json` piped results were cut short with a bare `process.exit`) |
| [agent/cli.ts](../../../agent/cli.ts) | `main(argv, io?)`: strips `--json`, moves leading `--project <dir>` / boolean globals after the command, `parseArgs({ strict: true })` → usage error exit 2 with the command's usage as hint |
| [agent/commands/](../../../agent/commands/) | `index.ts` (`COMMANDS`, `GLOBAL_OPTIONS`, `help`), `types.ts` (`Command`, `Subcommand.writes/destructive`), `util.ts` (option readers, `confirmOrPlan`, `PROJECT_OPTION`, `YES_OPTION`, `DRY_RUN_OPTION`, `FILE_OPTION`, `jsonInput` for inline / `@file` / `-`) |
| [agent/output.ts](../../../agent/output.ts) | `CliError(code, message, hint, exitCode, details)`, `printResult`, `printError`, `knownError` (OpsError / PathError / FsError → codes + `OPS_HINTS`), `cliHint` + `TOOL_COMMANDS` (tool names in hints → `agent3d …` commands) |
| [agent/paths.ts](../../../agent/paths.ts) | `packageRoot()` (bundled vs source via `__AGENT3D_BUNDLED__`), `distRoot()` (`AGENT3D_DIST`), `libraryDir()` (`AGENT3D_LIBRARY`), `templatesDir()` (`AGENT3D_TEMPLATES`), `readVersionInfo()` (`dist/version.json`, else package.json) |
| [agent/host.ts](../../../agent/host.ts), [agent/aiHost.ts](../../../agent/aiHost.ts) | runtime files / library / templates readers; `nodeHost(fs)` = the `ToolHost` (render, media, `withImageCodec`, inflate, `readLocalFile`); `listTools`, `callTool`, `previewImages` |
| [agent/nodeFs.ts](../../../agent/nodeFs.ts), [agent/watch.ts](../../../agent/watch.ts) | `ProjectFs` over a folder (symlink escapes refused); debounced recursive watcher with `ignoreWritten` |
| [agent/mcp/server.ts](../../../agent/mcp/server.ts) | hand-written JSON-RPC stdio server (no SDK), protocols 2025-06-18 / 2025-03-26 / 2024-11-05, annotations sets `DESTRUCTIVE` / `IDEMPOTENT` / `OPEN_WORLD`, `STRUCTURED_MAX_CHARS`; options built by `mcpOptions` in [commands/tools.ts](../../../agent/commands/tools.ts) |
| [agent/commands/serve.ts](../../../agent/commands/serve.ts) | `serve` (live page + SSE) and `studio` (SPA + `/api/*`), `localGuard` Host / Origin check; contract in [docs/studio-api.md](../../../docs/studio-api.md) (CLI-owned), consumed by `src/studio/backend/remote.ts` |
| [agent/render/](../../../agent/render/) | `browser.ts` (find / launch Chrome, temp profile), `cdp.ts` (CDP over global `WebSocket`), `server.ts` (127.0.0.1 static server, `resolveUnder`), `preview.ts` (page globals `window.__agent3d*`), `render.ts` (`renderProject`, `renderPoster`, `renderVideo`, `renderMedia`, `renderExportImages`, `parseInputScript`), `mp4.ts` / `webm.ts` / `gif.ts` / `webpAnim.ts` muxers, `imageCodec.ts` (`assets optimize`), `png.ts` (decoder for doctor + tests), `livePage.ts` |
| [agent/testing/](../../../agent/testing/) | `cli(args)` / `ok(args)` (in-process `--json` run), `writeFakeDist` + `FAKE_RUNTIME` (WebGL scissor stand-in for the player), `MINIMAL_SCENE` |
| [src/ai/tools.ts](../../../src/ai/tools.ts) | `ORDER` → `AI_TOOLS`; `listAiTools(host, { readOnly })` adds `RENDER_TOOL` (in `assetTools.ts`) only when `host.render` exists; `ToolHost` in `src/ai/types.ts` |
| [scripts/](../../../scripts/) | `check-skills.mjs`, `build-hermes.mjs` (`HELPERS`, `TAGS`), `build-cli-docs.mjs` + `cli-docs.mjs` + `cli-docs.test.ts`, `sync-version.mjs`, `write-version.mjs`, `build-examples.mjs` |
| [.github/workflows/](../../../.github/workflows/) | `ci.yml` (push to main / PRs), `release.yml` (tags `v*`) |

## Invariants and traps

- **stdout is the protocol.** Anything reaching stdout besides the one JSON object (or MCP frames) breaks agents. Logs go through `io.err` / `process.stderr`; bin.ts reroutes `console.log/info/debug`. `cli.test.ts` checks the envelope and exit codes.
- **Hints differ per door.** The CLI rewrites tool names in every `hint` (`withCliHints`), MCP and `/api/tools/call` keep tool names, `tools call` prints raw (`{ raw: true }`). A new tool whose name appears in op hints needs a `TOOL_COMMANDS` entry, or CLI users get a tool name (`output.test.ts`).
- **Errors need a hint.** Exit-2 `CliError`s without one get the command usage; anything unknown becomes `internal`. Map new op error codes in `OPS_HINTS`.
- **`render_preview` exists only where a renderer exists.** `listTools()` fakes `host.render` so `tools list`, MCP and `/api/tools` show it; the Studio's in-browser mode doesn't. `tools.test.ts` pins `EXPECTED` (must equal the CLAUDE.md list). MCP returns `previewImages` (the JPEG `preview`, else sheet, else first frame) as an `image` block; `status: "refused"` or `applied:false` with errors → `isError: true`.
- **Read-only MCP depends on `mutating`.** Wrong flag = a write tool exposed under `mcp --read-only` (`server.test.ts` "read-only mode").
- **Node 22.** `engines` says ≥ 22 (`vite.agent.config.ts` targets `node22`): `cdp.ts` needs the global `WebSocket` (`node-too-old` otherwise); `doctor` fails its `node` check below 22. `docs/cli.md`'s requirements line is hand-written in `scripts/cli-docs.mjs`.
- **Timeouts.** `AGENT3D_CDP_TIMEOUT_MS` (default 60 000) sets CDP answers and render waits; CI sets 180 000 for SwiftShader. Browser startup has its own 20 s timeout in `launchBrowser`.
- **Render output paths** are relative to the project folder (`projectPath`); `agent3d render` run from the repo root without `--project` writes `renders/` there.
- **E2E timeouts.** Browser e2e tests wrap their test and wait timeouts in `e2eTimeout(ms)` ([`agent/testing/e2e.ts`](../../../agent/testing/e2e.ts)): stretched by `AGENT3D_CDP_TIMEOUT_MS / 60 s`, which CI sets to 180 s (software WebGL on shared runners). A bare number timeout in a browser test flakes on CI.
- **Temp dirs.** Chrome profiles (`agent3d-chrome-*`) are removed on `close()` and on process exit, and a launch sweeps profiles older than a day (left by a killed process); `doctor` removes its dir. `check --render` keeps its frame on purpose (path in `render`) in `$TMPDIR/agent3d-check/<project>-<hash>/`, emptied on each run. Tests create temp folders only through `tempDir(prefix)` from [`agent/testing/tmp.ts`](../../../agent/testing/tmp.ts), which deletes them after the test file (`A3D_E2E_KEEP=1` keeps them); never call `mkdtempSync` in a test.
- **E2E tests skip silently** without Chrome or `dist/runtime` (`describe.skipIf`); `e2e-render.test.ts` also skips when `AGENT3D_DIST` is set. A green `npm test` before a build proves nothing about rendering: build first, as CI does.
- **Local server security.** serve / studio bind 127.0.0.1 and 403 foreign Host / Origin (`serve.test.ts` "refuses paths outside the project and foreign hosts / origins"). Keep `localGuard` first in every route list.
- **Shared `dist/`.** `npm run build` rewrites `dist/`, which other agents' e2e tests and `check:skills` read. Parallel agents build privately: `.agent3d-tmp/devbuild.sh <ws> [runtime|agent|studio|all]` (git-ignored) builds into `.agent3d-tmp/<ws>/dist` and writes `.agent3d-tmp/<ws>/a3d` (sets `AGENT3D_DIST`, `AGENT3D_LIBRARY`, `AGENT3D_TEMPLATES`). It does not write `version.json`, and `build-cli-docs.mjs` / `check-skills.mjs` always read the shared `dist/agent/agent3d.mjs`.

## How to add a command, action or option

1. Implement it in `agent/commands/<area>.ts` calling `src/ops/` (no business rule here); options from `util.ts`, destructive writes through `confirmOrPlan` + `YES_OPTION`, `--json` via `printResult`.
2. Declare `usage`, `summary`, `options`, `subcommands` (`writes`, `destructive`); a new command goes into `COMMANDS` in `index.ts`.
3. Test with `cli([...])` / `ok([...])` from `agent/testing/cli.ts` in `agent/cli.test.ts` (or a test next to the command).
4. Regenerate `docs/cli.md`: `npm run build:agent && node scripts/build-cli-docs.mjs` (`scripts/cli-docs.test.ts` fails when stale).
5. Update every skill / reference in `plugin/skills/` that mentions it, then `npm run hermes:build`.

## How to add or change an AI tool's exposure

1. Handler and schema: `src/ai/sceneTools.ts` or `assetTools.ts`, name in `ORDER` (`tools.ts`), `EXPECTED` in `src/ai/tools.test.ts`, the CLAUDE.md tool list.
2. Host needs (Chrome, files): extend `ToolHost` in `src/ai/types.ts` additively and implement it in `nodeHost` (`agent/aiHost.ts`).
3. MCP annotations: add the name to `DESTRUCTIVE` / `IDEMPOTENT` / `OPEN_WORLD` in `agent/mcp/server.ts` when relevant; CLI hint mapping in `TOOL_COMMANDS`.
4. Document it in [docs/mcp.md](../../../docs/mcp.md) and in the skill that uses it.

## How to change the render pipeline

- Page-side helpers live in `preview.ts` (`window.__agent3dFrame`, `__agent3dSheet`, `__agent3dGrab`, `__agent3dVideoStart/Frame/Drain/End`…); Node-side calls them in `render.ts`. Change both together.
- Video: mp4 tries `avc1.*` candidates, webm tries `vp09.00.40.08`, `vp09.00.31.08`, `vp8`, then falls back to WebP stills muxed as VP8 key frames (`codec: "vp8 (key frames)"`). Muxers are pure TS and tested in `media.test.ts`.
- Plumbing tests use the fake runtime (`render.test.ts` sets `AGENT3D_DIST = writeFakeDist(dir)` and restores it); real-player checks are `e2e-render.test.ts`, `determinism.e2e.test.ts`, `embed.e2e.test.ts`. Browser discovery is unit-tested with injected deps in `browser.test.ts`.
- New `render` / `export` options: also `RenderOptions` / `render_preview` schema / `nodeHost.render` if the tool should pass them, then `docs/cli.md`, `docs/mcp.md`, skills.

## Skills, Hermes, studio API

- `plugin/skills/` is the source; `check-skills.mjs` runs the built CLI's `help --json` and `scene validate` on full scene blocks, checks versions (`plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` must have no `version`), portable frontmatter keys, English, and a `changelog.json` entry for the version.
- Hermes: never edit `hermes/skills/`. New Python helper → `HELPERS` + `TAGS` in `build-hermes.mjs`, docstring first line, `hermes/README.md`, `hermes/tests/test_scripts.py` (stdlib, `fake_engine.py` via `AGENT3D_CMD`).
- Studio API route: `serve.ts` + `docs/studio-api.md` + `serve.test.ts`, and tell the Studio owner (`src/studio/backend/remote.ts`).

## Releases and CI

1. `changelog.json` entry (newest first; 0.2.1 used a separate `changelog: 0.2.1` commit), `agent3d.minSkillsVersion` in package.json if old skills break. Tree clean.
2. `npm version patch|minor` runs the `version` script: `sync-version.mjs`, `npm run build`, `build-hermes.mjs`, `build-cli-docs.mjs`, then `git add -A plugin hermes .claude-plugin README.md docs integrations/agentcms/README.md` — so the version commit (message = bare version) carries the README / docs pins. [docs/releasing.md](../../../docs/releasing.md) step 4 lists the same commands; they already ran.
3. Push on `main`: `git push && git push --tags`. `release.yml`: tag = package.json version, typecheck, build, tests, `check:skills`, `check:hermes`, CLI docs check, packed-tarball smoke test, `npm install -g npm@latest` (trusted publishing needs npm ≥ 11.5.1), `npm publish --provenance --access public --ignore-scripts` via OIDC (no token), skipped when the version is already on the registry, then `gh release create` from `changelog.json` (skipped if it exists).
4. Trusted publisher on npmjs.com: user `fleox`, repo `agent3d`, workflow `release.yml`, no environment. It must be saved **before** the run, or the publish PUT answers 404. Re-run a failed release with `gh run rerun <id>` (idempotent).
5. Verify from outside the repo: `cd /tmp && npx -y @fleox/agent3d@<v> version --json` (inside, npx resolves the local package). `gh` is installed and authenticated here: `gh run list --workflow release.yml`, `gh run watch`.
- `ci.yml` also runs `node scripts/build-library.mjs --check`, a CLI smoke test and `npm pack --dry-run`. No Claude attribution in commits, PRs or releases.

## QA with parallel AI agents

- One background agent per area, each in its own worktree (`isolation: "worktree"`, `.claude/worktrees/` is git-ignored), with its own `devbuild.sh` workspace and its own `serve` / `studio --port`.
- **Blind QA** (how the `examples/briefs/` scenes were made): the agent gets only `plugin/skills/` plus `help` / `catalog` output, never `src/`; briefs and the shared tester prompt are in [examples/prompts.json](../../../examples/prompts.json) (`briefs.shared`, `briefs.items[]` with id, kind, aspect, brief, scores). It must render, look at every PNG, `check --render`, export, and score each brief harshly.
- Test the published package from a folder outside the repo with the pinned `npx -y @fleox/agent3d@<version>`; projects under `/tmp/qa-<agent>/`.
- Verify each reported bug in the code before fixing; fix in `src/ops/` / `agent/` / skills with tests; give fix agents disjoint files and "no version bump, no `npm run build`, no push". Merge into one integration branch, run the checks below, then fast-forward `main` after the user's go.

## Checks before handing over

```bash
npm run typecheck && npm test
npm run build            # shared dist/ — skip when other agents are running; use .agent3d-tmp/devbuild.sh <ws>
npm run check:skills && npm run check:hermes
node scripts/build-cli-docs.mjs --check
node dist/agent/agent3d.mjs doctor --json   # Chrome + WebGL + Node for renders
```
