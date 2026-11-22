# The Studio

The Studio is Agent3D's visual editor: a React SPA (`src/studio/`, built to `dist/studio/`) with a live viewport (the same runtime as the exports, in editor mode), an outliner, an inspector, a timeline, a catalog / library browser, the templates gallery, the check panel, render and export dialogs, a JSON panel and an optional AI assistant.

```bash
npx -y @fleox/agent3d@0.1.0 studio --project my-banner
```

`agent3d studio` serves the Studio on `http://127.0.0.1:4320/` (next free port; `--port`, `--no-open`) with a local REST API over the project folder (contract: [studio-api.md](studio-api.md)). Edits go through the AI tool catalog (`/api/tools/call`), so validation is the same as in the CLI and MCP. Changes made by another program (an agent in a terminal, an editor) are pushed to the open Studio through Server-Sent Events and appear live: you can watch your agent work.

Without the CLI (`npm run dev`, or the static `dist/studio/` on any host) the Studio keeps projects in the browser.

## Live preview without the editor

```bash
npx -y @fleox/agent3d@0.1.0 serve --project my-banner --open
```

`serve` shows the scene alone at its aspect ratio with play / pause and a time scrubber; `scene.json` edits update the page instantly, asset or script edits reload it.

## The assistant

The assistant panel runs a tool-use loop with Claude over the same tool catalog (including `render_preview`, whose images it looks at). It calls the Claude Messages API directly from the browser with the user's own API key, stored in the browser's `localStorage` and sent only to `api.anthropic.com`. It is optional; everything else in the Studio works without it.

## Security

The Studio server binds 127.0.0.1 only and rejects requests whose `Host` or `Origin` is not local (DNS rebinding / CSRF protection); project paths cannot leave the folder. See [security.md](security.md).
