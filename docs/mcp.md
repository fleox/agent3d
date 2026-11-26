# MCP server

`agent3d mcp` turns a project folder into a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so Claude Code, Claude Desktop, Hermes, Cursor or any MCP client can create, edit, check, preview and export 3D scenes.

```bash
npx -y @fleox/agent3d@0.2.3 mcp --project /path/to/my-banner [--read-only]
```

- `--project` is the folder the tools work on (it may be empty: the `project_create` tool creates the project there).
- `--read-only` exposes only the tools that don't write (`mutating: false`).
- Renders need Node.js 22+ and Chrome / Chromium / Edge on the machine running the server (`agent3d doctor`).

## Client configuration

**Claude Code**

```bash
claude mcp add agent3d -- npx -y @fleox/agent3d@0.2.3 mcp --project /path/to/my-banner
```

Add `--scope project` to share it with the repository (`.mcp.json`). The skills (`/plugin marketplace add fleox/agent3d`, then `/plugin install agent3d@agent3d`) work with or without the MCP server: they drive the CLI.

**Claude Desktop** — `claude_desktop_config.json` (Settings → Developer → Edit config):

```json
{
  "mcpServers": {
    "agent3d": {
      "command": "npx",
      "args": ["-y", "@fleox/agent3d@0.2.3", "mcp", "--project", "/Users/me/agent3d/my-banner"]
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
    args: ["-y", "@fleox/agent3d@0.2.3", "mcp", "--project", "/home/me/agent3d/my-banner"]
```

Or use the Hermes skills in [`hermes/`](../hermes) (Python wrapper of the CLI, no MCP needed).

**Cursor** — `.cursor/mcp.json` (or `~/.cursor/mcp.json`): the same `mcpServers` object as Claude Desktop.

**Any other client**: run the command above as a stdio server.

## Tools

Exactly the AI tool catalog of `src/ai/tools.ts` (`agent3d tools list` prints the same list with JSON schemas), plus `render_preview` registered by the CLI host:

| Tool | Writes | Does |
|---|---|---|
| `project_info` | | Manifest, target, compact scene outline, asset count, validation summary |
| `project_create` | yes | Create the project in the folder (an attractive starter per target kind, or a template) |
| `scene_get` | | The scene, or one part of it (`path`: `"camera"`, `"objects#logo.material"`…) |
| `scene_summary` | | Compact outline: objects tree, lights, camera, background, timeline, post effects |
| `scene_validate` | | Validate a candidate scene (or the current one) against the format and the catalog |
| `scene_apply` | yes | Replace the whole scene (`dryRun` shows the plan first) |
| `scene_patch` | yes | Atomic patch ops: `set`, `merge`, `remove`, `addObject`, `updateObject`, `removeObject`, `moveObject`, `addBehaviour`, `addTrack`, `removeTrack` |
| `object_add` | yes | Add an object (at the root or under `parent`) |
| `object_update` | yes | Deep-merge fields into an object |
| `object_remove` | yes | Remove an object, its children and its timeline tracks |
| `object_list` | | Flat list of every object (id, kind, detail, parent, depth, position, behaviours) |
| `timeline_set` | yes | Replace or edit the timeline: tracks, settings, markers, segments, scroll |
| `interactions_set` | yes | Replace or append no-code interactions (click / hover / scroll / key / event → play segments, set properties, emit, open URLs, play clips) |
| `catalog_get` | | Catalog sections (geometries, materialPresets, shaders, textures, lightRigs, behaviours, generators, particlePresets, postfx, fonts, sounds), entries and parameters |
| `templates_list` | | Starter templates (filter by kind / query) |
| `check` | | Pre-publish report: validation, missing files, sandbox lint, budgets, licences, accessibility; with the last `render_preview` also framing and runtime performance |
| `assets_list` | | Project assets with licence, size and which scene paths use them |
| `assets_search` | | Free CC0 / CC-BY sources (Poly Haven, ambientCG, Khronos, Kenney, Quaternius) — network |
| `assets_add` | yes | Download a search hit (`resolution`; below 1k or `maxSize` downscales; models return `bounds`), or import a local file / Kenney / Quaternius zip |
| `assets_optimize` | yes | Lighter textures and models: smart per-usage texture sizes, WebP re-encoding (scene references rewritten), meshopt `.glb` geometry, optional `simplify`; `dryRun: true` reports the savings first. Textures need a host with headless Chrome; geometry does not |
| `library_list` | | The built-in offline library (models with sizes, triangles and clip names, textures, HDRIs) as `library:<id>` refs |
| `export` | yes | `embed` (default), `zip` or `single-html` into `dist/<format>/` (`baseUrl`, `cacheBust`, `integrity`, `extras`, `optimize`, `og`); `poster` (still), `video` (WebM / MP4 `codec`), `gif` and `animated-webp` into `dist/` or `renders/` when the host can render (`quality` draft…ultra, `transparent`, `fps`, `duration`, `size`) |
| `render_preview` | | Headless render: frames + contact sheet, stats, inspect, game `state` (CLI / MCP host only — needs Chrome) |

The CLI's `export` command has the same formats and options (animated WebP is `agent3d render --webp`; the CLI also renders the poster itself, the tool takes a `poster` image path): see [export.md](export.md).

Tool annotations carry `readOnlyHint` from `mutating`. Errors come back as tool results with `isError: true` and the engine's code, message, hint and details (validation issues). Refusals are errors too: a mutating tool that wrote nothing because of validation errors (`status: "refused"`, `applied: false` with `counts.errors > 0`) returns its normal result (plan, issues with hints) with `isError: true`. Reports such as `scene_validate` and `check` are not refusals (`isError: false`, read `ok` / `counts`).

### `render_preview` returns an image

`render_preview` (`frames: [0, 1.5, 3]` or `count`, `size`, `sheet`, and for games `input`: simulated keys / clicks, see [scripting.md](scripting.md#testing-scripts)) answers with two content blocks: a text block (JSON: `dir` — the project folder —, sheet and frame paths relative to it, game `state`, stats, per-object `inspect`, runtime issues, console errors) **and an `image` block with the contact sheet** as a JPEG (`mimeType: "image/jpeg"`, base64 — several times smaller than a PNG), scaled down to `maxWidth` pixels (default 800, `0` = full size) to save context — the full-size PNG sheet and frames stay on disk (`sheet`, `frames`; the JPEG copy is `preview`). Multimodal clients see the render directly and can judge framing, colours, text and motion, then fix with `scene_patch`. Other inputs: `scroll` (0..1, scroll-driven scenes), `reducedMotion: true` (what prefers-reduced-motion visitors see), `segment` (play a timeline segment from t = 0), and `input` events `{"t", "emit": "<event>"}` / `{"t", "ui": "<HUD button id>"}` / `{"t", "segment": "<name>"}` besides keys / clicks / drags.

### Result encoding

Tool results are one **compact** JSON text block (no pretty-printing). With protocol `2025-06-18` the server also sends `structuredContent` (the same object) for results up to 8 KB; bigger results (scene_get, full check reports, catalog dumps) are sent as text only, so large payloads are never duplicated — the spec makes `structuredContent` optional for tools without an `outputSchema` and asks for the serialized JSON in a text block, which is always there. Older protocol versions (`2025-03-26`, `2024-11-05`) get the text block only.

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
