# Releasing

The package is published to npm as [`@fleox/agent3d`](https://www.npmjs.com/package/@fleox/agent3d). `dist/` is not committed: every publish builds it.

## Each release

1. Make sure `main` is green: `npm run typecheck`, `npm test`, `npm run build`, `npm run check:skills`, `npm run check:hermes`, `node scripts/build-cli-docs.mjs --check`.
2. Add the release to `changelog.json` (newest first): `version`, `date`, `breaking`, `changes[]` (user-facing), `actions[]` (what users must do after updating, e.g. "re-export scenes to get the new runtime").
3. If older skills no longer work with this CLI, set `"agent3d": { "minSkillsVersion": "x.y.z" }` in `package.json` (`scripts/write-version.mjs` copies it into `dist/version.json`; default: the release version).
4. `npm version patch|minor|major`, then sync everything that repeats the version:
   ```bash
   node scripts/sync-version.mjs     # plugin.json, skills' metadata.version, every pinned @fleox/agent3d@x.y.z in skills, docs, READMEs
   npm run build                     # dist/ + dist/version.json
   npm run hermes:build              # hermes/skills from plugin/skills + hermes/python
   node scripts/build-cli-docs.mjs   # docs/cli.md command reference
   npm run check:skills && npm run check:hermes
   ```
   Commit `plugin`, `hermes`, `.claude-plugin`, `docs`, `README.md`, `changelog.json` with the version bump.
5. Push the commit and the tag: `git push && git push --tags`. The **Release** workflow (`.github/workflows/release.yml`) runs every check, smoke-tests the packed tarball, publishes to npm with provenance through **npm trusted publishing** (OIDC — no npm token is stored in GitHub) and creates the GitHub Release from the `changelog.json` entry. It is idempotent: a version already on npm is skipped.

Every push to `main` and every pull request also runs the **CI** workflow (`.github/workflows/ci.yml`): typecheck, build, tests (render e2e with the runner's Chrome), skills, Hermes, CLI docs, library index, CLI smoke test, `npm pack --dry-run`.

### One-time setup (already done for 0.2.0)

- The first version (0.2.0) was published by hand: npm only allows trusted publishing on an existing package.
- On npmjs.com → package `@fleox/agent3d` → **Settings → Trusted Publisher**: GitHub Actions, organization/user `fleox`, repository `agent3d`, workflow file `release.yml`, no environment.
- Manual fallback: `npm publish` from a clean `main` (`prepublishOnly` runs typecheck, tests, build and `check:skills`).

The package ships `dist/agent`, `dist/runtime`, `dist/studio`, `library`, `templates`, `plugin`, `changelog.json`, `README.md`, `LICENSE`.

## What users do

- Claude Code: `/plugin marketplace update agent3d`, then `/reload-plugins` (the skills pin the new version, so `npx` fetches it).
- Hermes: `hermes skills update` (or re-install from `hermes/skills`).
- MCP configs pin a version in their `args`: update it.
- Sites: re-export scenes (or just replace the `agent3d-runtime/` folder) to ship the new runtime. The scene format is versioned (`version` in `scene.json`, `sceneVersion` in `dist/version.json`).

## What must stay in sync

See [AGENTS.md](../AGENTS.md): catalog ↔ runtime registries ↔ `docs/catalog.md`; AI tools ↔ skills; CLI commands ↔ skills ↔ `docs/cli.md`; versions everywhere; `hermes/skills` generated.
