# Agent3D scene — AgentCMS plugin

Embed 3D scenes made with [Agent3D](https://github.com/fleox/agent3d) (animated banners, heroes, characters, landscapes, product showcases, mini games) in AgentCMS posts and pages.

- **Settings → Agent3D scenes** uploads an Agent3D export folder (`dist/embed`, written by `agent3d export`) to `agent3d/` on the site's hosting and lists the scenes it contains.
- The **Agent3D scene** editor block ("+" or `/`, category Embed) picks an uploaded scene or takes the URL of any `scene.json`, with an accessible label and an optional caption. The editor shows the poster and can play the live scene.
- Published pages get the `<agent3d-scene>` Web Component and the runtime module script: no third-party request, lazy start, pause off-screen, reduced-motion support, poster fallback without WebGL. Sites hosted in a sub-folder are handled.

## Install

1. Get `agent3d-scene.zip` (in `integrations/agentcms/` of the Agent3D repository, or build it: `npm install && npm run build`).
2. In the AgentCMS admin: **Plugins → Install**, drop the ZIP. Or, for a site the AgentCMS CLI manages:
   ```bash
   npx -y @agent-cms/agentcms@0.3.13 ext install agent3d-scene.zip --site <alias> --json          # plan
   npx -y @agent-cms/agentcms@0.3.13 ext install agent3d-scene.zip --site <alias> --yes --json    # install
   ```
3. Reload the admin.

## Use

1. Make a scene with Agent3D and export it: `npx -y @fleox/agent3d@0.1.0 export --project my-banner --json` → `my-banner/dist/embed/`.
2. **Settings → Agent3D scenes** → pick that `embed` folder. Every file except the demo page is uploaded to `agent3d/` (the runtime once, then one folder per scene).
3. In a post or page, insert **Agent3D scene**, choose the scene in the Block tab, write the accessible label, publish.

Already uploaded the export some other way (git, bucket)? Paste its `scene.json` URL in the block (e.g. `/assets/3d/my-banner/scene.json`); the poster and runtime URLs default to the export layout (`poster.webp` next to `scene.json`, `../agent3d-runtime/agent3d-runtime.js`) and can be overridden.

## Published HTML

```html
<figure class="agent3d-scene-block">
  <script type="module" src="/agent3d/agent3d-runtime/agent3d-runtime.js"></script>
  <agent3d-scene src="/agent3d/my-banner/scene.json" poster="/agent3d/my-banner/poster.webp" aria-label="…"></agent3d-scene>
  <figcaption>…</figcaption>
</figure>
```

Several blocks on a page share the runtime (browsers run a module URL once). Content-Security-Policy, if the site sets one: `script-src 'self'`, `connect-src 'self'`, `img-src 'self' blob:` (+ `style-src 'unsafe-inline'` for scenes with a HUD).

## Develop

```bash
npm install
npm run build        # tsc + vite build + pack → agent3d-scene.zip
npm run check        # validates the package like the admin, renders a demo site
npm run preview      # demo site + screenshots
```

Source: `src/render.ts` (attributes, URL safety, published HTML), `src/scene-block.tsx` (Tiptap node, node view, inspector), `src/settings.tsx` (folder upload), `src/manifest.tsx`.
