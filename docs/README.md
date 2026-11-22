# Agent3D documentation

| Document | For |
|---|---|
| [getting-started.md](getting-started.md) | Install, first banner in five commands, using it from an agent |
| [architecture.md](architecture.md) | How the pieces fit: one engine, four front doors, the runtime, the headless render loop |
| [scene-format.md](scene-format.md) | `scene.json` (SceneDoc) field by field, with examples: target, camera and shots, environment and lookdev, lights, objects, materials, text, models, generators, behaviours, timeline, interactions, post effects, physics, scripts / HUD / audio, data bindings |
| [art-direction.md](art-direction.md) | Art direction: how to make scenes look professional, with the format features that get you there |
| [catalog.md](catalog.md) | Every geometry, material preset, shader, procedural texture, light rig, behaviour, generator, particle preset, post effect (and look preset), font and sound with parameters (generated) |
| [cli.md](cli.md) | The `agent3d` CLI: conventions, environment, every command, action and option (reference generated) |
| [mcp.md](mcp.md) | The MCP server: Claude Code / Desktop, Hermes, Cursor configuration, tools, the `render_preview` image |
| [scripting.md](scripting.md) | Game and interactive scripts: the ScriptApi, rigid-body physics API, HUD, determinism, sandbox rules, headless testing with simulated input |
| [export.md](export.md) | Export formats (embed, zip, single-html, poster, video, GIF), the `<agent3d-scene>` element (attributes, JS API, events, data bindings), framework wrappers, `mountScene`, Content-Security-Policy, media renders |
| [assets.md](assets.md) | The built-in library, project assets, `assets optimize` (smart sizes, WebP, meshopt), free CC0 sources, licences |
| [studio.md](studio.md) | The visual editor (gizmos, editor camera, drag and drop), live preview, the assistant |
| [studio-api.md](studio-api.md) | The Studio's local REST API (contract, owned by the CLI) |
| [security.md](security.md) | What touches the network, local servers, the script sandbox, CSP |
| [releasing.md](releasing.md) | Release process (maintainers) |

Agent skills: [`plugin/skills/`](../plugin/skills) (Claude Code plugin) and [`hermes/`](../hermes) (Hermes Agent). AgentCMS block: [`integrations/agentcms/`](../integrations/agentcms). Maintenance rules: [AGENTS.md](../AGENTS.md).
