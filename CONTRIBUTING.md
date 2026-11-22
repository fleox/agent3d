# Contributing to Agent3D

Thanks for helping! Agent3D is source-available under the PolyForm Noncommercial license; by contributing you agree your contribution is licensed the same way.

## Setup

```bash
npm install --legacy-peer-deps
npm run dev              # the Studio in your browser (projects kept in IndexedDB)
npm run typecheck
npm run build            # dist/runtime + dist/studio + dist/agent/agent3d.mjs + dist/version.json
npm test                 # Vitest; the render / embed e2e tests use dist/runtime and your Chrome (skipped when missing)
npm run check:skills     # after the build
npm run check:hermes     # needs python3
npm run check:docs       # docs/cli.md is generated from `help --json`
```

To try the CLI you just built: `node dist/agent/agent3d.mjs doctor`. Renders need Node.js 22+ and Chrome, Chromium, Edge or Brave.

## Rules of the road

- Read `CLAUDE.md` (architecture and hard rules) and `AGENTS.md` (what must stay in sync).
- Business logic goes in `src/ops/` with Vitest tests next to it; the Studio in `src/studio/`; the CLI and the MCP server in `agent/`; the website player in `src/runtime/`.
- The catalog (`src/core/catalog.ts`) and the AI tools (`src/ai/tools.ts`) are declared once. A new catalog entry needs its runtime implementation and a regenerated `docs/catalog.md` (`UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts`).
- No server, no account, no network at run time. The runtime, the CLI, the Studio and the exports never call a third-party service; only the optional `assets search|add` talks to free, account-less CC0 sources. No CDN, web fonts or analytics. Tests never touch the network (inject `fetch`).
- Scenes are data, and the runtime is deterministic: renders must be reproducible.
- Game scripts only get the `ScriptApi`; keep the sandbox lint (`src/ops/scriptLint.ts`) in step with `docs/scripting.md`.
- New built-in assets must allow redistribution (CC0, or CC BY with the credit recorded in `library/index.json` and `library/LICENSES.md`).
- English everywhere in code, docs and skills; Studio strings in `en` and `fr`.
- Keep the CLI JSON contract (one object on stdout, hints on errors, plans before destructive changes).
- No new runtime dependency besides `three` (and the bundled cannon-es / meshoptimizer) without discussing it first.

## Pull requests

- One topic per PR, with tests. CI runs typecheck, build, tests, `check:skills`, `check:hermes`, the CLI docs check, the library index check and a CLI smoke test.
- If you change a command or an AI tool, update `docs/cli.md` (`npm run docs:cli`), `docs/mcp.md`, the skills in `plugin/skills/`, and regenerate Hermes (`npm run hermes:build`).
- If you change a template, re-render its `preview.png` and make sure it passes `agent3d check --render`.
- Describe user-visible changes; maintainers add them to `changelog.json` at release time.
