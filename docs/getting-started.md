# Getting started

Agent3D is meant to be driven by an AI agent, but every step is a plain command you can run yourself. You need **Node.js 22+** and **Google Chrome** (or Chromium / Edge / Brave) for previews, posters and videos.

```bash
npx -y @fleox/agent3d@0.2.2 doctor
```

`doctor` checks Node, finds your browser, and renders a one-object test scene headless (in a temp folder). It exits 1 when a required check fails, with a hint per failed check (`--json`: `{ ok: false, error: { code: "doctor-failed", details: { checks } } }`).

## With an agent

**Claude Code** — install the skills, then just ask:

```text
/plugin marketplace add fleox/agent3d
/plugin install agent3d@agent3d
```

> Make an animated 4:1 banner for my bakery "Golden Crust", warm browns and cream, with a couple of pastries floating around the title.

The `agent3d-create` skill clarifies the brief, builds the scene, renders it, looks at the screenshots, fixes what it sees, runs the checks and exports the embed. Other skills: `agent3d-edit`, `agent3d-assets`, `agent3d-game`, `agent3d-publish`.

**Any MCP client** (Claude Desktop, Cursor, Hermes…) — see [mcp.md](mcp.md). **Hermes Agent** skills — see [`hermes/`](../hermes).

## By hand, in five commands

```bash
npx -y @fleox/agent3d@0.2.2 new bakery --target banner --title "Golden Crust" --json
npx -y @fleox/agent3d@0.2.2 render --project bakery --sheet --json
```

Open the contact sheet the result points to (`data.sheet`, e.g. `bakery/renders/20261122-124337-sheet.png`): the starter is already a complete banner (gradient, studio lights, a floating 3D title, props, dust, an 8-second loop). Change it with a patch:

```bash
cat > ops.json <<'JSON'
[
  { "op": "set", "path": "environment.background", "value": { "gradient": ["#2a1306", "#5c2c0c", "#a8561b"], "angle": 10 } },
  { "op": "set", "path": "objects#title.material", "value": { "preset": "plastic", "color": "#fff4e0", "roughness": 0.3 } },
  { "op": "updateObject", "id": "title", "set": { "font": "serif-bold" } }
]
JSON
npx -y @fleox/agent3d@0.2.2 scene patch --project bakery --file ops.json --json
npx -y @fleox/agent3d@0.2.2 check --project bakery --json
npx -y @fleox/agent3d@0.2.2 export --project bakery --json
```

`bakery/dist/embed/` now holds the runtime, the scene, a poster, a demo page and the snippet to paste into your site:

```html
<link rel="modulepreload" href="./agent3d-runtime/chunks/three.module-….js" integrity="sha384-…">
<script type="module" src="./agent3d-runtime/agent3d-runtime.js" integrity="sha384-…"></script>
<agent3d-scene src="./bakery/scene.json" aspect="4:1" role="img" aria-label="Golden Crust — animated 3D banner">
  <img slot="poster" src="./bakery/poster.webp" alt="Golden Crust — animated 3D banner" width="1200" height="300" decoding="async" style="display:block;width:100%;height:auto">
</agent3d-scene>
```

Upload the whole `dist/embed/` folder next to your pages (or pass `--base-url /path/to/it/` to the export). `EMBED.md` in the folder explains WordPress, Webflow, Shopify, React / Vue / Svelte and the Content-Security-Policy; `--format single-html` gives one self-contained file instead, `--format video` / `gif` a promo clip.

Useful render options: `--sheet` (contact sheet), `--size 390x700` (phone), `--isolate <objectId>` (one object alone, auto-framed from the front — check a model's orientation), `--bg checker|<colour>` (background under transparent scenes; transparent scenes get a checkerboard sheet by default), `--input` (simulated game input, see [scripting.md](scripting.md#testing-scripts)).

## Next

- See it live while you edit: `npx -y @fleox/agent3d@0.2.2 serve --project bakery --open`, or the visual editor: `npx -y @fleox/agent3d@0.2.2 studio --project bakery`.
- Start from a template: `npx -y @fleox/agent3d@0.2.2 templates list`.
- Learn the format: [scene-format.md](scene-format.md) and the [catalog](catalog.md).
- Put it on your site: [export.md](export.md).
