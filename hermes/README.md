# Agent3D for Hermes Agent

Skills and Python scripts that let [Hermes Agent](https://hermes-agent.nousresearch.com) (and any agent that prefers Python) build 3D elements for web pages with Agent3D: write a JSON scene, render it headless, look at the screenshots, fix, and export a self-contained embed.

| Skill | Use it to |
|---|---|
| [`agent3d-create`](skills/agent3d-create/SKILL.md) | go from a brief ("an animated banner for my bakery") to a finished embed, with art direction and validated recipes |
| [`agent3d-edit`](skills/agent3d-edit/SKILL.md) | change an existing project: patches, materials, timeline, behaviours, rebranding, phone checks |
| [`agent3d-assets`](skills/agent3d-assets/SKILL.md) | built-in CC0 library, generators, Poly Haven / ambientCG / Khronos downloads, Kenney / Quaternius zips, licences |
| [`agent3d-game`](skills/agent3d-game/SKILL.md) | mini games and interactive logic with the sandboxed ScriptApi |
| [`agent3d-publish`](skills/agent3d-publish/SKILL.md) | export formats, plain HTML, WordPress, AgentCMS, React / Next / Vue, CSP |

## Install

```bash
hermes skills install fleox/agent3d/hermes/skills/agent3d-create
```

Or from a clone, in `~/.hermes/config.yaml`:

```yaml
skills:
  external_dirs:
    - /path/to/agent3d/hermes/skills
```

The MCP server works too (tools + `render_preview` returning the contact sheet as an image): see [docs/mcp.md](../docs/mcp.md).

## Requirements

- **Python 3.9+** — standard library only.
- **Node.js 22+** — the engine is the [`@fleox/agent3d`](https://www.npmjs.com/package/@fleox/agent3d) npm package, run with `npx` and pinned to the skills' version. `AGENT3D_CMD` overrides it (e.g. `AGENT3D_CMD="node /path/to/agent3d/dist/agent/agent3d.mjs"`).
- **Google Chrome, Chromium or Edge** for renders, posters and videos (`AGENT3D_CHROME` points at a specific binary). `agent3d doctor` checks everything.

## The scripts

Every skill ships `scripts/agent3d.py`, a dependency-free wrapper of the CLI (adds `--json`, prints the CLI's JSON object, keeps its exit code):

```python
import sys; sys.path.insert(0, "<skill dir>/scripts")
from agent3d import run, patch, needs_confirmation, Agent3dError

run("new", "spring-banner", "--target", "banner", "--title", "Spring sale")
patch([{"op": "set", "path": "objects#title.material", "value": {"preset": "gold"}}], project="spring-banner")
sheet = run("render", "--sheet", project="spring-banner", timeout=240)["sheet"]   # look at this PNG
snippet = run("export", project="spring-banner", timeout=240)["snippet"]
```

| Script | Skills | What it does |
|---|---|---|
| `render_and_check.py` | create, edit, game, publish | Renders the contact sheet + frames, runs `check`, prints the image paths and a compact verdict (errors, warnings, runtime issues, objects not in view). |
| `new_banner.py` | create | Creates a banner project (starter or template), applies brand colours (background gradient, title material) and renders a first sheet. |

## Maintenance (this repository)

`hermes/skills/` is generated — don't edit it. Text comes from [`plugin/skills/`](../plugin/skills), scripts from [`hermes/python/`](python). `npm run hermes:build` regenerates it; `npm run check:hermes` verifies it is up to date and runs the Python tests ([`hermes/tests/`](tests), fake engine, no network, no Node needed).
