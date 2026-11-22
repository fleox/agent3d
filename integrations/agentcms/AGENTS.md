# Agent3D scene — notes for coding agents

This is an AgentCMS **plugin** (id `agent3d-scene`), built into `agent3d-scene.zip` and installed from the admin (or `agentcms ext install`).

- The `agentcms-extensions` skill explains the whole extension API; the types in `node_modules/@agent-cms/agentcms/types/agentcms-runtime.d.ts` document every runtime export.
- After every change: `npm run build && npm run check` (`npm run -s check -- --json` for machine-readable output). Fix every error; read every warning.
- `npm run preview` renders a demo site through the real publisher and prints screenshot paths — look at them when you change markup or CSS.
- Keep `id` identical in `manifest.json` and `src/manifest.tsx`; keep `version` in sync in both.
- The admin provides `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `react-i18next` and `@agent-cms/runtime` (externals in vite.config.ts); everything else you import is bundled.
- Filters on `page.head.extra` / `page.body.end` must be synchronous.
- Unit tests of the pure rendering helpers: `src/render.test.ts`, run by the Agent3D repository's `npx vitest run` (excluded from this package's `tsc`).
- `ext check` reports one expected warning, `block-empty-output`: the demo site has no Agent3D export, so the sample scene URL shows nothing. Render a real export by copying an `agent3d export` folder to `<preview out>/agent3d/` and serving it.
