## What and why

<!-- What does this change, and which issue does it address? -->

## Checklist

- [ ] Business rules live in `src/ops/` (not in a page or a command), with Vitest tests next to the code; tests never touch the network
- [ ] `npm run typecheck`, `npm run build`, `npm test`, `npm run check:skills`, `npm run check:hermes` and `npm run check:docs` pass
- [ ] Catalog changes have a runtime implementation and a regenerated `docs/catalog.md`
- [ ] Nothing calls a third-party service at run time (runtime, CLI, Studio, exports)
- [ ] New Studio strings in `en` and `fr`
- [ ] Skills in `plugin/skills/` and `docs/` updated if the CLI, the AI tools, the scene format or the Studio's behaviour changed
- [ ] Changed templates re-rendered (`preview.png`) and passing `agent3d check --render`
- [ ] `changelog.json` entry for user-visible changes
