# The Studio

The Studio is Agent3D's visual editor: a React SPA (`src/studio/`, built to `dist/studio/`) with a live viewport (the same runtime as the exports, in editor mode), an outliner, an inspector, a timeline, a catalog / library browser, the templates gallery, the check panel, render and export dialogs, a JSON panel and an optional AI assistant.

```bash
npx -y @fleox/agent3d@0.5.2 studio --project my-banner
```

`agent3d studio` serves the Studio on `http://127.0.0.1:4320/` (next free port; `--port`, `--no-open`) with a local REST API over the project folder (contract: [studio-api.md](studio-api.md)). Edits go through the AI tool catalog (`/api/tools/call`), so validation is the same as in the CLI and MCP. Changes made by another program (an agent in a terminal, an editor) are pushed to the open Studio through Server-Sent Events and appear live: you can watch your agent work.

Without the CLI (`npm run dev`, or the static `dist/studio/` on any host) the Studio keeps projects in the browser (IndexedDB). The interface is available in English and French.

## Viewport editing

The viewport renders the scene with the website runtime and adds editor-only tools on top (`src/runtime/editor/`, loaded lazily by the Studio and never shipped in exports):

- **Select** (`Q`): click an object to select it; click again inside a group to go one level deeper. `Esc` deselects, `Delete` removes, `Ctrl/⌘+D` duplicates, `F` frames the selection (or the whole scene).
- **Transform gizmos**: move `W`, rotate `E`, scale `R`; `X` toggles world / local space. The magnet button turns snapping on (0.25 m grid, 15°, 0.1 scale); hold `Shift` while dragging to invert it. Objects nested in groups are edited in their parent's space, so `scene.json` keeps local values in metres and degrees. Animated objects are edited at their authored pose. The drag previews live and saves as one `scene_patch` — one undo step.
- **Lights**: directional, spot, point and rect lights show a handle (and a target diamond for directional / spot / rect lights). Click one to move it with the gizmo; its card is highlighted in the inspector.
- **Cameras**: the editor camera (drag: orbit, right-drag: pan, wheel: zoom) starts on the scene camera; the scene camera's frame is drawn at its target distance with the scene's aspect ratio. "Set the scene camera from this view" writes `camera.position` / `camera.target`. `C` switches to the scene camera (what the website shows, with rule-of-thirds and title-safe guides). Interact mode (`I`) always looks through the scene camera and passes the pointer to the scene.
- **Drag and drop**: drag a primitive, text, generator, particle preset, library model or light from the Add panel onto the viewport to place it on the surface under the pointer (or on the ground plane).
- **3D photos**: the Add panel's **3D photo** tab turns an image of the project (or a library image) into a `photo` object. Its inspector section picks the image, the depth map and (once there is a depth map) the background plate + plate depth from `agent3d assets plate`, sets the mode (parallax, mesh, layers), strength, focus and motion, and **Generate depth map** estimates the depth map locally (the `image_depth` tool: Depth Anything V2 Small in headless Chrome, model downloaded once) and plugs it in. The button needs the CLI (`agent3d studio`); in the in-browser mode it is disabled, and you can pick a depth image you made elsewhere. See [assets.md](assets.md#depth-maps-3d-photos).
- The overlay shows triangles, draw calls and fps; `G` toggles the grid and helpers.
- Other shortcuts: `Ctrl/⌘+Z` / `Ctrl/⌘+Shift+Z` undo / redo, `Ctrl/⌘+S` save, `H` hide, `Space` play / pause, `T` timeline, `J` JSON panel, `A` assistant. `?` lists every shortcut (the list in the Studio is the reference).

## Live preview without the editor

```bash
npx -y @fleox/agent3d@0.5.2 serve --project my-banner --open
```

`serve` shows the scene alone at its aspect ratio with play / pause and a time scrubber; `scene.json` edits update the page instantly, asset or script edits reload it.

## The assistant

The assistant panel runs a tool-use loop with Claude over the same tool catalog (including `render_preview`, whose images it looks at). It calls the Claude Messages API directly from the browser with the user's own API key, stored in the browser's `localStorage` and sent only to `api.anthropic.com`. It is optional; everything else in the Studio works without it.

## Security

The Studio server binds 127.0.0.1 only and rejects requests whose `Host` or `Origin` is not local (DNS rebinding / CSRF protection); project paths cannot leave the folder. See [security.md](security.md).
