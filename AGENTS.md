# AGENTS.md — maintenance rules for AI agents working on Agent3D

Read `CLAUDE.md` first (architecture, hard rules, contracts). This file lists what must stay in sync when you change something.

## One engine, four front doors

- Business rules live in `src/ops/` only. The Studio (`src/studio/`), the CLI (`agent/commands/`), the MCP server (`agent/mcp/`) and the Studio assistant call ops — never re-implement a rule in a command or a page.
- AI tools are declared once in `src/ai/tools.ts`. MCP `tools/list`, `agent3d tools list|call`, the Studio API (`/api/tools`) and the assistant expose exactly that list (+ `render_preview` from the CLI host). A new tool needs a precise description, a JSON schema and `mutating` set right (`mcp --read-only` depends on it); mention it in `docs/mcp.md` and in the skill that uses it.

## The catalog is declared once

`src/core/catalog.ts` → validation (`src/core/validate.ts`), runtime registries (`src/runtime/registry.ts` and each implementation folder), AI tools (`catalog_get`), the Studio's catalog browser and `docs/catalog.md`.

- Adding a geometry, material preset, shader, behaviour, generator, particle preset, post effect, font or sound means: the catalog entry (params with types, ranges, defaults, `cost` formula), its runtime implementation (the registry parity test fails otherwise), and `UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts` to regenerate `docs/catalog.md` (the test fails when it is stale).
- Skills and docs never list parameters by heart beyond examples: they send agents to `agent3d catalog`. When you rename or remove a catalog id or parameter, grep `plugin/skills/` and `docs/` for it.

## The scene format is a contract

`src/core/types.ts` changes are additive. When a field is added: `docs/scene-format.md` (prose + example), the relevant skill reference (`agent3d-edit/references/patch-ops.md`, `agent3d-create/references/art-direction.md`…), and the Studio inspector if it should be editable. A breaking change bumps `SCENE_VERSION` (copied into `dist/version.json` as `sceneVersion`) and needs a migration in `normalizeScene`.

## Skills follow the code

- `plugin/skills/` is the single source of the agent skills (`agent3d-create`, `agent3d-edit`, `agent3d-assets`, `agent3d-game`, `agent3d-publish`). When a CLI command, option, output field, error code or default changes, update every skill / reference that mentions it **in the same change**.
- `npm run check:skills` (after the build) fails when a skill calls a command, action or **option** missing from `help --json`, pins another version than `package.json`, uses non-portable frontmatter, contains non-English prose, has an invalid ```json block, or contains a full scene example (`"version"` + `"objects"`) that fails `agent3d scene validate` (errors or warnings).
- Skills are 100% English; agents translate for the user at runtime.
- Commands in skills are always pinned: `npx -y @fleox/agent3d@<version> <command> --json`.
- Every command written in a skill must have been run for real. Every scene in `agent3d-create/references/recipes.md` was validated, checked and rendered: re-render the recipes after runtime changes that affect looks (lighting, tone mapping, materials, generators) and update them if they no longer look right.

## Hermes is generated

- `hermes/skills/` is generated from `plugin/skills/` + `hermes/python/` by `npm run hermes:build`. Never edit it by hand; regenerate and commit.
- `npm run check:hermes` fails when it is stale and runs the Python tests (`hermes/tests/`, fake engine, stdlib only, no Node).
- Python helpers stay stdlib-only, Python 3.9+, print one JSON object, and take `--project`. A new helper: add it to `HELPERS` in `scripts/build-hermes.mjs`, describe it in its docstring's first line (it becomes the skill's helper list) and in `hermes/README.md`, and test it in `hermes/tests/test_scripts.py`.

## CLI contract

- `--json` → exactly one `{ ok, data }` or `{ ok: false, error: { code, message, hint } }` on stdout; logs on stderr. Exit 0 ok, 1 failure, 2 usage / validation.
- Destructive or overwriting commands print `{ needsConfirmation: true, plan }` unless `--yes`.
- Every error a user can hit has a `hint`.
- New command, action or option: `agent/commands/` (`usage`, `summary`, `options`, `subcommands`), a test, then `node scripts/build-cli-docs.mjs` (regenerates the reference in `docs/cli.md`; `scripts/cli-docs.test.ts` fails in `npm test` when it is stale) and the relevant skill.

## Versions and releases

- `package.json` version = `plugin/.claude-plugin/plugin.json` version = every skill's `metadata.version` = every pinned `@fleox/agent3d@x.y.z` (skills, docs, READMEs, `integrations/agentcms/README.md`). `node scripts/sync-version.mjs` rewrites them all.
- `scripts/write-version.mjs` (run by `npm run build`) writes `dist/version.json` (`version`, `minSkillsVersion` from `package.json → agent3d.minSkillsVersion` or the version, `sceneVersion`).
- Every release has a `changelog.json` entry (newest first) with `changes[]` and `actions[]`. See `docs/releasing.md`.

## Docs

- `docs/catalog.md` is generated (catalog), `docs/cli.md`'s reference section is generated (CLI), `docs/studio-api.md` is owned by the CLI (`agent/commands/serve.ts`). Everything else in `docs/` is hand-written: keep it true when behaviour changes (export layout, element attributes, CSP needs, budgets, security properties).
- `docs/images/` holds real renders used by the README: regenerate them from the recipes (`agent3d render`) rather than editing images.

## AgentCMS integration

`integrations/agentcms/` is an AgentCMS plugin (its own `package.json`; build with `npm install && npm run build`, validate with `npm run check`). Its pure helpers (`src/render.ts`) are unit-tested by the root `npx vitest run`. When the export layout (`agent3d-runtime/`, `<name>/scene.json`, `poster.webp`) or the element's attributes change, update `src/render.ts`, rebuild and commit `agent3d-scene.zip`.

## Tests

- `npm test` (Vitest, next to the code) — never touches the network (inject `fetch`), never needs Chrome (render e2e tests skip without `dist/runtime` / a browser).
- `npm run typecheck`, `npm run build`, `npm run check:skills`, `npm run check:hermes`, `node scripts/build-cli-docs.mjs --check`.
