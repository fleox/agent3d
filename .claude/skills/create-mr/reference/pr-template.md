# PR description template

The body written to the temporary body file and passed to
`gh pr create --body-file …` (or URL-encoded into the compare URL). Fill every
applicable section in **English**.

```markdown
## Summary

<1–2 sentences: what this PR does and the user-visible effect.>

## Motivation

<Why this change is needed. Reference the issue or the QA finding.
Explain the problem before the solution.>

## Changes

- <bullet 1: imperative voice — "Add the `ripple` behaviour to the catalog and runtime">
- <bullet 2>
- <bullet 3>

## How to test

- [ ] <e.g. `npx vitest run src/ops/check.test.ts`>
- [ ] <e.g. `node dist/agent/agent3d.mjs new /tmp/x --template banner-neon-title --json && node dist/agent/agent3d.mjs render --project /tmp/x --sheet --json`>
- [ ] <expected output / what the render must show>

## Renders

<Visual changes only: before / after contact sheets (`agent3d render --sheet`)
of the affected templates or recipes.>

## Changelog

<The `changelog.json` entry under the next version: user-facing `changes[]`,
and any `actions[]` users must run after updating (update the skills, re-export
scenes, rebuild the AgentCMS block…).>

## Related

- Closes #N

## Risk & rollback

<What could break? Scene format (SCENE_VERSION, normalizeScene migration)?
Runtime size or lazy chunks? Existing exports? Revert with `git revert <sha>`.>
```

## When to omit sections

| Section | Skip when |
|---|---|
| `Motivation` | the subject line says it all |
| `How to test` | pure docs / typo fix |
| `Renders` | nothing visible changed |
| `Changelog` | nothing user-visible (tests, refactors, contributor docs) |
| `Related` | no linked issue |
| `Risk & rollback` | truly trivial change |

`Summary` and `Changes` are **mandatory**.

## Style rules

- `Changes`: bullets, imperative voice, no trailing period.
- `How to test`: GitHub checkboxes; commands run on scratch projects
  (`/tmp/…`, `.agent3d-tmp/`), never on a user's project.
- Precise numbers where the diff allows ("runtime main chunk 412 → 418 KB",
  "draw calls 61 → 38").

## Never in the PR body

- Personal context, speculation about future work (open an issue instead).
- Tokens (npm, GitHub), credentials, personal data.
- Claude attribution (`Co-Authored-By`, "Generated with Claude Code").
- Long copy-pasted shell sessions — a `<details><summary>` block at most.
