# MCP server

`agent3d mcp` turns a project folder into a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so Claude Code, Claude Desktop, Hermes, Cursor or any MCP client can create, edit, check, preview and export 3D scenes.

```bash
npx -y @fleox/agent3d@0.1.0 mcp --project /path/to/my-banner [--read-only]
```

- `--project` is the folder the tools work on (it may be empty: the `project_create` tool creates the project there).
- `--read-only` exposes only the tools that don't write (`mutating: false`).
- Renders need Node.js 22+ and Chrome / Chromium / Edge on the machine running the server (`agent3d doctor`).

## Client configuration

**Claude Code**

```bash
claude mcp add agent3d -- npx -y @fleox/agent3d@0.1.0 mcp --project /path/to/my-banner
```

Add `--scope project` to share it with the repository (`.mcp.json`). The skills (`/plugin marketplace add fleox/agent3d`, then `/plugin install agent3d@agent3d`) work with or without the MCP server: they drive the CLI.

**Claude Desktop** — `claude_desktop_config.json` (Settings → Developer → Edit config):

```json
{
  "mcpServers": {
    "agent3d": {
      "command": "npx",
      "args": ["-y", "@fleox/agent3d@0.1.0", "mcp", "--project", "/Users/me/agent3d/my-banner"]
    }
  }
}
```

Desktop apps may not see your shell's `PATH`: use the absolute path of `npx` (`which npx`) as `command` if the server doesn't start. Several projects = several entries with different names and `--project`.

**Hermes Agent** — `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  agent3d:
    command: npx
    args: ["-y", "@fleox/agent3d@0.1.0", "mcp", "--project", "/home/me/agent3d/my-banner"]
```

Or use the Hermes skills in [`hermes/`](../hermes) (Python wrapper of the CLI, no MCP needed).

**Cursor** — `.cursor/mcp.json` (or `~/.cursor/mcp.json`): the same `mcpServers` object as Claude Desktop.

**Any other client**: run the command above as a stdio server.

## Tools

Exactly the AI tool catalog of `src/ai/tools.ts` (`agent3d tools list` prints the same list with JSON schemas), plus `render_preview` registered by the CLI host:

| Tool | Writes | Does |
|---|---|---|
| `project_info` | | Manifest, target, scene summary, assets, renders |
| `project_create` | yes | Create the project (starter per target, or a template) |
| `scene_get`, `scene_summary`, `scene_validate` | | Read / outline / validate the scene |
| `scene_apply` | yes | Replace the whole scene (plan first) |
| `scene_patch` | yes | Patch ops (set, merge, remove, addObject, updateObject, removeObject, moveObject, addBehaviour, addTrack, removeTrack) |
| `object_add`, `object_update`, `object_remove`, `object_list` | some | Object shortcuts |
| `timeline_set` | yes | Replace or edit the timeline |
| `catalog_get` | | Geometries, materials, shaders, behaviours, generators, particles, post effects, fonts, sounds with parameters |
| `templates_list` | | Starter templates |
| `check` | | Validation, sandbox lint, budgets, framing, licences, web settings |
| `assets_list`, `assets_search`, `library_list` | | Project assets, free CC0 sources (network), built-in library |
| `assets_add` | yes | Download a search hit (`resolution` below 1k / `maxSize` downscales; models return `bounds`), or import a local file / Kenney / Quaternius zip |
| `assets_optimize` | yes | Downscale / re-encode textures in place (also inside `.glb`) when the KB budget is exceeded — needs headless Chrome |
| `export` | yes | Embed or single-HTML export into the project; `poster` (still image) and `video` (WebM) into `dist/` when the host can render |
| `render_preview` | | Headless render (frames + contact sheet) |

Tool annotations carry `readOnlyHint` from `mutating`. Errors come back as tool results with `isError: true` and the engine's code, message, hint and details (validation issues). Refusals are errors too: a mutating tool that wrote nothing because of validation errors (`status: "refused"`, `applied: false` with `counts.errors > 0`) returns its normal result (plan, issues with hints) with `isError: true`. Reports such as `scene_validate` and `check` are not refusals (`isError: false`, read `ok` / `counts`).

### `render_preview` returns an image

`render_preview` (`frames: [0, 1.5, 3]` or `count`, `size`, `sheet`, and for games `input`: simulated keys / clicks, see [scripting.md](scripting.md#testing-scripts)) answers with two content blocks: a text block (JSON: `dir` — the project folder —, sheet and frame paths relative to it, game `state`, stats, per-object `inspect`, runtime issues, console errors) **and an `image` block with the contact sheet** (`mimeType: "image/png"`, base64), scaled down to `maxWidth` pixels (default 800, `0` = full size) to save context — the full-size sheet and frames stay on disk (`sheet`, `frames`; the scaled copy is `preview`). Multimodal clients see the render directly and can judge framing, colours, text and motion, then fix with `scene_patch`. The same JSON is in `structuredContent`.

## Resources

| URI | Content |
|---|---|
| `agent3d://scene` | The project's `scene.json` |
| `agent3d://summary` | The scene outline |
| `agent3d://catalog` | The full catalog with parameters |

## Protocol

- JSON-RPC 2.0, one message per line on stdin / stdout (logs on stderr).
- Protocol version `2025-06-18` (also accepts `2025-03-26` and `2024-11-05`).
- The `initialize` result includes `instructions` describing the workflow (summary → catalog → patch → render_preview and look → check → export).
