# Auto-review checklist (Agent3D)

What Claude looks for during Step 6 of `/create-mr`. Findings are sorted into
five buckets; each finding becomes a single `AskUserQuestion`. The hard rules and
contracts are in [CLAUDE.md](../../../../CLAUDE.md); what must stay in sync is in
[AGENTS.md](../../../../AGENTS.md). Area details: the `*-internals` skills.

## 1. Bugs

- **Determinism**: no `Math.random()`, `Date.now()` or `performance.now()` in a
  path that runs under `deterministic: true` — use the seeded RNG
  (`src/runtime/random.ts`) and the player's clock. Same scene + same `t` must give
  the same pixels (`render` screenshots, `check --render`, video export).
- `seek(t)` must be pure in `t`: state carried from the previous frame (physics,
  particles, behaviours with memory) has to be re-simulated or reset on seek.
- Disposal: geometries, materials, textures, render targets and listeners
  released on `dispose()` / `reload()`; no leak across Studio rebuilds.
- `applyScene` / `patchScene` never write an invalid scene (errors → `applied: false`);
  a patch op that fails throws with `details.opIndex`; same input twice → empty plan.
- Paths in scenes resolve against the scene.json URL (exports, `--base-url`);
  library refs `library:<id>` are copied into `<name>/assets/library/`.
- CLI: `--json` prints exactly one object, logs on stderr, exit 0 / 1 / 2;
  destructive or overwriting commands answer `needsConfirmation` unless `--yes`.
- Headless render: every CDP wait has a timeout (`AGENT3D_CDP_TIMEOUT_MS`), the
  browser and temp profile are closed / removed on every exit path.
- Element: works without WebGL (poster / fallback), with `prefers-reduced-motion`,
  off-screen (paused) and after a context loss.

## 2. Architecture

- **One engine, four front doors**: a rule in a command, the MCP server, a Studio
  page or the assistant instead of `src/ops/`.
- **Catalog declared once** (`src/core/catalog.ts`): every id has a runtime
  implementation (`src/runtime/registry.test.ts`), params with types / ranges /
  defaults and a `cost` formula; `docs/catalog.md` regenerated.
- **AI tools declared once** in `src/ai/`; `mutating` correct (`mcp --read-only`).
- `src/ops/` and `src/core/` stay pure TS over `ProjectFs`: no DOM, no Node APIs,
  network only through an injected `fetch`.
- Contracts (`types.ts`, `catalog.ts`, `runtime/api.ts`, `runtime/registry.ts`)
  change additively; a breaking scene change bumps `SCENE_VERSION` with a
  migration in `normalizeScene`.
- Runtime size: heavy code (postfx, generators, physics, loaders, fonts) stays in
  lazy chunks — no static import from the main entry.
- No new runtime dependency besides `three`, `cannon-es`, `meshoptimizer`
  without the maintainer's go.

## 3. Style / conventions

- `strict` TypeScript, no needless `any`, domain types from `src/core/types.ts`.
- Code matches the surrounding naming, comment density and idiom.
- Errors a user can hit carry an actionable `hint` (`OpsError`, CLI errors).
- Dead code, unused imports, magic numbers without a name.

## 4. Documentation

- Comments in English, only when the *why* is non-obvious.
- **Skills follow the code**: a changed command, option, output field, scene
  field or catalog id updates `plugin/skills/` in the same change, then
  `npm run hermes:build`; commands in skills are pinned and were run for real.
- New command / option: `agent/commands/`, `node scripts/build-cli-docs.mjs`, a test.
- Scene field: `docs/scene-format.md`; element attribute: `docs/export.md` and
  `integrations/agentcms/src/render.ts`.
- User-visible change: a `changelog.json` entry under the next version.
- README numbers / tables when catalog, templates or library change
  (`repo-presentation`).

## 5. Security

- Scripts sandbox: `src/ops/scriptLint.ts` still rejects the forbidden globals;
  a new `ScriptApi` method cannot reach the network, the DOM or storage outside
  the provided API.
- Exports never hotlink (no CDN, no web fonts, no analytics); assets downloaded
  once into the project with their licence in `assets/manifest.json`.
- `openUrl` / href interactions: only safe schemes (no `javascript:`).
- The local servers (`render`, `serve`, `studio`) bind 127.0.0.1 and never serve
  files outside the project / dist / library roots (path traversal).
- ZIP import (`importAssetZip`): entry paths checked, file count and size limits.
- No token, credential or personal data in code, fixtures, logs or `--json` output.

## Severity grading

- **Critical** — actively broken or dangerous. Default to "Apply".
- **Major** — design issue that will hurt soon. Default to "Apply".
- **Minor** — style nit, missing comment. Batch at the end.

Always show the finding's line + the proposed fix in chat before asking.
