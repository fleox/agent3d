# Agent3D documentation

The [README](../README.md) is the overview. These pages go into detail.

## Start here

| Document | For |
|---|---|
| [getting-started.md](getting-started.md) | Install, first banner in five commands, using it from an agent |
| [art-direction.md](art-direction.md) | Art direction: premium defaults per kind (composition, lighting, palettes, motion, mobile and games) and the format features that get you there |
| [studio.md](studio.md) | The visual editor (gizmos, editor camera, drag and drop), live preview, the assistant |
| [mcp.md](mcp.md) | The MCP server: Claude Code / Desktop, Hermes, Cursor configuration, tools, resources, the `render_preview` image |

## Reference

| Document | For |
|---|---|
| [scene-format.md](scene-format.md) | `scene.json` (SceneDoc) field by field, with examples: target, camera and shots, environment and lookdev, lights, objects, materials, text, models, generators, behaviours, timeline, interactions, post effects, physics, scripts / HUD / audio, data bindings |
| [catalog.md](catalog.md) | Every geometry, material preset, shader, procedural texture, light rig, behaviour, generator, particle preset, instance layout, post effect (and look preset), font and sound with parameters (generated) |
| [cli.md](cli.md) | The `agent3d` CLI: conventions, environment, every command, action and option (reference generated) |
| [scripting.md](scripting.md) | Game and interactive scripts: the ScriptApi, rigid-body physics API, HUD, determinism, sandbox rules, headless testing with simulated input |
| [export.md](export.md) | Export formats (embed, zip, single-html, poster, video, GIF), the `<agent3d-scene>` element (attributes, JS API, events, data bindings), framework wrappers, `mountScene`, Content-Security-Policy, media renders, runtime size |
| [assets.md](assets.md) | The built-in library, project assets, `assets optimize` (smart sizes, WebP, meshopt), free CC0 sources, licences |
| [security.md](security.md) | What touches the network, local servers, the script sandbox, navigation, CSP, asset licences |

## Contributors and maintainers

| Document | For |
|---|---|
| [architecture.md](architecture.md) | How the pieces fit: one engine, four front doors, the runtime, the headless render loop, why there is no server |
| [studio-api.md](studio-api.md) | The Studio's local REST API (contract, owned by the CLI) |
| [releasing.md](releasing.md) | Release process |

Agent skills: [`plugin/skills/`](../plugin/skills) (Claude Code plugin) and [`hermes/`](../hermes) (Hermes Agent). AgentCMS block: [`integrations/agentcms/`](../integrations/agentcms). Templates: [`templates/`](../templates). Maintenance rules: [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md); contributing: [CONTRIBUTING.md](../CONTRIBUTING.md); security reports: [SECURITY.md](../SECURITY.md).
