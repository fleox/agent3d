# Studio local API (`agent3d studio`)

`agent3d studio [--project <dir>] [--port 4320]` serves the Studio SPA (`dist/studio/`) on
`http://127.0.0.1:<port>/` together with a small REST API over the project folder. The
Studio detects it with `GET /api/info` (a static deployment without the CLI gets a 404 and
falls back to in-browser projects).

Owner: CLI (`agent/commands/serve.ts`). The Studio builds against this contract.

## Rules

- Binds **127.0.0.1 only**. Requests whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>`
  / `[::1]:<port>`, or whose `Origin` (when sent) is another site, get **403** — so other web
  pages can't read or write the project (DNS rebinding / CSRF).
- JSON responses use the CLI envelope: `{ "ok": true, "data": … }` or
  `{ "ok": false, "error": { "code", "message", "hint"?, "details"? } }`.
  HTTP status: 200 ok, 400 bad input (usage / invalid path / validation), 404 not found
  (or no project), 500 other failures.
- Project paths are POSIX, relative to the project root; `..`, absolute paths and symlinks
  leaving the folder are refused (400 `invalid-path`).
- Started without a project (no `scene.json` in `--project` / cwd): `/api/info` returns
  `project: null`, project routes return 404 `no-project`.

## Static mounts (what the runtime needs)

| URL | Serves |
|---|---|
| `/__runtime/agent3d-runtime.js` (+ `chunks/`) | `dist/runtime/` — `import { mountScene } from "/__runtime/agent3d-runtime.js"` |
| `/__library/<path>` | `library/` (built-in assets; pass `libraryBase: "/__library/"`) |
| `/project/<path>` | the project folder (pass `assetBase: "/project/"`) |
| anything else | `dist/studio/` (SPA: unknown extension-less paths serve `index.html`) |

## Routes

### `GET /api/info`
```json
{ "ok": true, "data": {
  "version": "0.1.0",
  "project": { "dir": "/abs/path", "manifest": { "name": "…", "title": "…", … }, "exists": true } | null,
  "runtimeUrl": "/__runtime/agent3d-runtime.js", "assetBase": "/project/", "libraryBase": "/__library/" } }
```

### `GET /api/project` (also `/api/project/`), optional `?prefix=assets/`
Lists files: `{ "ok": true, "data": { "files": [{ "path": "scene.json", "size": 1234 }, …] } }`
(`.git`, `node_modules` skipped).

### `GET /api/project/<path>`
Raw file bytes with a content type from the extension (`scene.json` → `application/json`).
404 `notFound` (JSON envelope) when missing. `HEAD` works too.

### `PUT /api/project/<path>`
Body = raw bytes (any content type), written as is (parent folders created).
→ `{ "ok": true, "data": { "path": "scripts/game.js", "bytes": 512 } }`.
This is a raw write: **no validation**. For scene edits prefer the tools
(`scene_patch` / `scene_apply` via `/api/tools/call`) which validate and return issues.

### `DELETE /api/project/<path>`
→ `{ "ok": true, "data": { "removed": "<path>" } }`; 404 when missing.

### `GET /api/catalog`
`CATALOG` from `src/core/catalog.ts` (geometries, materialPresets, shaders, behaviours,
generators, particlePresets, postfx, fonts, sounds).

### `GET /api/library`
`library/index.json` (`{ assets: LibraryAsset[] }`; empty list when missing).

### `GET /api/templates`
`{ "templates": [{ id, title, description, kind, tags }, …] }` from `templates/*/template.json`.

### `GET /api/tools`
`{ "tools": [{ name, description, inputSchema, mutating }, …] }` — exactly
`listAiTools(host)` (the MCP / `agent3d tools` catalog, including `render_preview`).

### `POST /api/tools/call`
Body `{ "name": "scene_patch", "input": { … } }` (JSON). Runs the AI tool against the
project's NodeFs with the Node host (headless render, runtime files, library, templates).
→ `{ "ok": true, "data": <tool result> }` or the error envelope (OpsError code / message /
hint / details, e.g. `validation` with `details.issues`). Files the tool writes are not
echoed back on `/api/events`.

### `GET /api/events` (Server-Sent Events)
External changes to the project folder (another agent, an editor, `agent3d` in a terminal):
```
event: change
data: {"paths":["scene.json"]}
```
Debounced (~120 ms); `renders/`, `dist/`, `.git`, `node_modules` are ignored; writes made
through `PUT`/`DELETE`/`tools/call` of this server are muted (while the file keeps the size + mtime the server wrote). A comment ping
(`: ping`) is sent every 20 s. The Studio should reload `scene.json` (and call
`player.update(scene)`) when it sees `scene.json` in `paths`, and refresh asset lists for
`assets/…`.

## `agent3d serve` (live preview, not the Studio)

Same mounts (`/__runtime/`, `/__library/`, `/project/`) plus `/` (preview page with a toolbar),
`/__scene.json` (current scene) and `/__events` (SSE: `event: scene` when scene.json changes →
the page calls `player.update(scene)`; `event: reload` for `assets/` or `scripts/` changes).
