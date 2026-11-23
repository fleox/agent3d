---
name: content-internals
description: Contributor notes for the Agent3D shipped content — the starter templates (templates/<id>/ layout, template.json, preview.png, README, scripts and assets, validated by src/ops/templates.content.test.ts), the built-in library (library/index.json generated from sources.json by scripts/build-library.mjs, models / textures / HDRIs, CC0 and CC-BY attribution, make-library-models.mjs, make-bakery-models.mjs), the examples (examples/prompts.json, the blind-QA briefs in examples/briefs/, the gallery built by scripts/build-examples.mjs into the git-ignored examples/site/) and the validated recipes in plugin/skills/agent3d-create/references/recipes.md. Invoke when adding, upgrading or re-describing a template, adding or replacing a library asset, adding a QA brief, rebuilding the gallery, or re-rendering templates and recipes after a runtime look change in this repository.
---

# Content (templates, library, examples) — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("The project folder", "Ownership boundaries": Content = `templates/`, `library/` except fonts, `examples/`) and [AGENTS.md](../../../AGENTS.md) ("Skills follow the code", "Docs") first. Don't commit unless asked. Content is judged by how it **looks**: every template, brief and recipe was rendered headless and looked at; a change you did not render and look at is not done. For the README templates table, counts, showcase stills and grid see [`repo-presentation`](../repo-presentation/SKILL.md); for the CLI commands used here see [`agent-cli-internals`](../agent-cli-internals/SKILL.md); for `check` / `createProject` rules see [`engine-internals`](../engine-internals/SKILL.md); for looks, lighting and materials see [`runtime-internals`](../runtime-internals/SKILL.md); for generators, shaders, sounds and fonts (`library/fonts/` is theirs) see [`procedural-internals`](../procedural-internals/SKILL.md); for the Studio gallery see [`studio-internals`](../studio-internals/SKILL.md).

## Where things live

| What | Files | Consumers | Tests / checks |
|---|---|---|---|
| Templates (31) | [`templates/<id>/`](../../../templates/): `template.json`, `agent3d.json`, `scene.json`, `README.md`, `preview.png`, optional `scripts/`, `assets/` (+ `assets/manifest.json`) | `readTemplatesIndex` / `readTemplateFiles` / `templatePreviewFile` in [`agent/host.ts`](../../../agent/host.ts); `parseTemplateInfo`, `instantiateTemplate` in [`src/ops/templates.ts`](../../../src/ops/templates.ts) → `createProject` ([`src/ops/project.ts`](../../../src/ops/project.ts)); Studio gallery via `/api/templates/<id>/preview.png` (`src/studio/backend/remote.ts`) | [`src/ops/templates.content.test.ts`](../../../src/ops/templates.content.test.ts), `agent/commands/serve.test.ts` (preview route) |
| Library (179 assets) | [`library/sources.json`](../../../library/sources.json) (hand-written provenance) → [`library/index.json`](../../../library/index.json) (generated), [`library/LICENSES.md`](../../../library/LICENSES.md), `models/<category>/*.glb`, `textures/<set>-<map>.jpg`, `hdri/<name>.hdr` + `.jpg` | `LibraryIndex` / `LIBRARY_PREFIX` in [`src/core/library.ts`](../../../src/core/library.ts); `check` (unknown ids, bytes, triangles), `export` (copies into `<name>/assets/library/`), `assets library`, `library_list` | `node scripts/build-library.mjs --check`; the template content test resolves every `library:` ref |
| Library tooling | [`scripts/build-library.mjs`](../../../scripts/build-library.mjs), [`make-library-models.mjs`](../../../scripts/make-library-models.mjs) (downloads + trims third-party GLBs; network + ImageMagick `magick`, maintainer only), [`make-bakery-models.mjs`](../../../scripts/make-bakery-models.mjs) (own-work CC0 food GLBs from three.js geometry, `--check`) | maintainers | the scripts' own `--check` |
| Prompts | [`examples/prompts.json`](../../../examples/prompts.json): `templates { intro, shared, upgrade, byId }`, `briefs { intro, shared, items[] }` | `build-examples.mjs` (shown under each card) | none: keep `byId` keys = template folders by hand |
| Blind-QA briefs (8) | [`examples/briefs/<id>/`](../../../examples/briefs/): the project exactly as the QA agent left it (`agent3d.json`, `scene.json`, `assets/`, sometimes `scripts/`, `README.md`) | `build-examples.mjs` → `briefs.html` | none automated |
| Gallery | [`scripts/build-examples.mjs`](../../../scripts/build-examples.mjs) → `examples/site/` (`index.html`, `briefs.html`, `agent3d-runtime/`, `<id>/`, `briefs/<id>/`) — **git-ignored** | local review, README "Templates" | none |
| Recipes | [`plugin/skills/agent3d-create/references/recipes.md`](../../../plugin/skills/agent3d-create/references/recipes.md) (10 full scenes) + [`docs/images/recipe-*.jpg`](../../../docs/images/) | agents following `agent3d-create` | `npm run check:skills` validates every full scene block |

## Invariants and traps

**Templates**

- The content test enforces, per folder: `template.json` has `id, title, description, kind, tags, aspect`; `id` equals the **folder name**; `kind` is one of `banner hero card square fullscreen inline game`; `aspect` matches `W:H`; description > 30 chars; `README.md` and `agent3d.json` exist; `scene.target.kind` / `scene.target.aspect` equal the template's; zero validation errors; `ariaLabel` set; every `library:` ref exists in `library/index.json`; instantiated in a `MemoryFs`, `checkProject` has zero errors and `budget.totalKb <= budgetKb` (library bytes count, see `DEFAULT_BUDGET_KB` in `src/core/validate.ts`: banner 600, hero 1500, card 400…). It needs at least 12 folders.
- The test runs `check` **without** a render: no framing, no runtime triangle counts. `check --render` (Chrome) is a separate manual gate; the README promises every template passes it.
- A template with an unparsable `template.json` is silently skipped by `readTemplatesIndex` (CLI `templates list`, gallery): only the content test notices.
- What reaches the user's project: everything except `template.json` and `preview.png` (filtered in both `agent/host.ts readTemplateFiles` and `createProject`). So the template `README.md`, `scripts/`, `assets/` are copied; `agent3d.json` is regenerated (`template` set, fresh dates) and `scene.id` becomes the project name. Write the README for the end user ("What to tweak" table naming object ids, `data.*` keys, `ui.elements`), as the existing ones do.
- Template assets need an `assets/manifest.json` entry with a licence (see `banner-logo-extrude`); prefer `library:` refs and generators (0 KB) over copied files.
- Games set `target.reducedMotion: "ignore"`, carry touch + keyboard controls and an attract mode that plays itself, so headless renders and the gallery show action.
- `preview.png` is a 1200 px wide render of a frame where the scene is complete (title revealed, game in attract mode). The README table and the Studio gallery show it; it is never copied into projects.

**Library**

- `index.json` is generated; edit `sources.json` and rerun the script. `--check` fails when a file is not in `sources.json`, a listed file is missing, a GLB is not a valid single-file glTF 2.0, references external URIs, uses Draco / meshopt / KTX2 (`KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_texture_basisu`), a CC-BY licence has no `attribution`, or `index.json` differs byte for byte.
- The asset id **is** its path (`models/nature/pine-tree.glb`). Renaming or moving a file breaks every scene that references it: grep `templates/`, `examples/briefs/`, `plugin/skills/`, `docs/` and `src/` for the old id.
- The script computes `triangles`, `size`, `center`, `minY`, `animations`, `skinned`, `morphTargets` and appends the bounding box to the description: don't write sizes in `sources.json`. Textures need `set` + `map` (`color`, `normal`, `roughness`) in `sources.json`; HDRIs ship as a pair (`.hdr` for lighting, `.jpg` LDR for the background).
- CC-BY assets (sneaker, velvet sofa, iridescent lamp, fox) flow into `check` licences and export `CREDITS.txt` through `attribution`. Nothing that needs an account, a non-commercial or no-derivatives clause enters the library. Fonts' provenance lives in `library/fonts/LICENSES.md` (procedural area).
- The library ships in the npm package (`package.json → files`): every MB is paid by every user (~35 MB today; the largest model, `products/lounge-chair.glb`, is 1.8 MB). `make-library-models.mjs` caps embedded textures at `maxTexture: 1024`; do the same, and remember a template's budget counts the library bytes it uses.

**Examples and recipes**

- `build-examples.mjs` drives the **built** CLI (`dist/agent/agent3d.mjs`; needs `npm run build:runtime && npm run build:agent`): `new --template` + `export --format embed` per template. A full run deletes `examples/site/` first; `--only a,b` rebuilds those cards and keeps the others but skips the briefs; `--no-poster` skips Chrome posters.
- A brief is exported only when it is in `prompts.json → briefs.items` (`id, kind, aspect, title, brief, scores`, optional `scroll: true`) **and** `examples/briefs/<id>/scene.json` exists. It is exported from a temp copy; the brief folder is never modified — and never "fix" a brief's scene by hand, it is the QA record.
- `byId` prompts starting with `UPGRADE:` get `templates.upgrade` prepended in the gallery.
- `check:skills` runs `scene validate` on every ```json block containing `"version"` and `"objects"`: a recipe with a warning fails it. It does not render: re-render recipes yourself after a look change.

## How to add a template

1. Pick an id `<kind>-<name>`; start from the closest template or recipe: `node dist/agent/agent3d.mjs new /tmp/t/<id> --template <closest> --json` (or `--target <kind> --aspect W:H`).
2. Iterate: `scene patch` / `scene apply`, then `render --project /tmp/t/<id> --sheet --count 6 --json` (games: also `--input`), and **open the PNGs**. Hold it to `prompts.json → templates.shared` (premium agency hero, not a tech demo; mobile framing; reduced motion; quality auto).
3. `check --render --project /tmp/t/<id> --json`: `ok`, no avoidable warnings, within budget.
4. Copy `scene.json`, `scripts/`, `assets/` into `templates/<id>/`; write `agent3d.json` (`"template": "<id>"`), `template.json` (`id` = folder, kind / aspect identical to the scene, tags, one-paragraph description whose first sentence works alone) and `README.md` (controls, how it works, what to tweak).
5. `preview.png`: `render --frames <t> --size 1200x<h>` at a complete moment, copy the frame.
6. Add the prompt the builder received to `examples/prompts.json → templates.byId.<id>`.
7. `npx vitest run src/ops/templates.content.test.ts`; rebuild the card: `node scripts/build-examples.mjs --only <id>` and look at it served.
8. README: templates table row, counts ("31 templates", per-kind split), grid image → [`repo-presentation`](../repo-presentation/SKILL.md). Mention it in `changelog.json` for the next release.

## How to add a library asset

1. Licence first: CC0 (or CC-BY 4.0 with a ready attribution line) from an account-less source; record the original URL.
2. Make it fit: single-file `.glb`, no compression extensions, trimmed clips and textures (`make-library-models.mjs` does this for its list; add an entry there for downloads), or a deterministic generator script like `make-bakery-models.mjs`.
3. Put it under `library/<models/<category>|textures|hdri>/`, add its `sources.json` entry (`path, kind, license, author, source, pack?, sourceUrl, tags, description`, `attribution` for CC-BY, `set`/`map` for textures).
4. `node scripts/build-library.mjs`, then `--check`; add a source row to `library/LICENSES.md` if the source is new.
5. Render it isolated in a scratch project (`render --isolate <objectId>`) to check orientation and size.
6. Update counts and lists: `plugin/skills/agent3d-assets/SKILL.md` (library summary), `docs/assets.md`, README numbers (`agent3d assets library --json`).

## Upgrading templates after a runtime look change

Lighting, tone mapping, materials, post-processing or generator changes shift every look. For each affected template (and each recipe): `new /tmp/u/<id> --template <id>`, render the same frames as before, compare, fix in the template folder, rerun `check --render`, re-render `preview.png`. Re-render the recipes and `docs/images/recipe-*.jpg`, the briefs' cards (full `build-examples.mjs` run), and hand the `.github/assets` stills to `repo-presentation`. Record a substantial rework as an `UPGRADE:` prompt in `byId`.

## Rebuilding and serving the gallery

```bash
npm run build:runtime && npm run build:agent        # once (the lead may own builds; ask when agents run in parallel)
node scripts/build-examples.mjs                      # everything + briefs (Chrome for posters)
node scripts/build-examples.mjs --only game-runner --no-poster
python3 -m http.server -d examples/site 8080         # open http://127.0.0.1:8080/ and /briefs.html
```

## Checks before handing over

```bash
npx vitest run src/ops/templates.content.test.ts
node scripts/build-library.mjs --check
node scripts/make-bakery-models.mjs --check          # when food models or three changed
npm run check:skills                                 # after a build, when recipes.md changed
npm run typecheck && npm test
# + check --render and LOOKED-at renders for every template / recipe you touched
```
