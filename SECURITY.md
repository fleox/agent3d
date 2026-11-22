# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories ("Report a vulnerability" on the repository's Security tab), or by opening an issue asking for a private contact if advisories are unavailable. Don't include exploit details in public issues. We aim to acknowledge within 72 hours.

## Security model

Agent3D has no server: the CLI, the MCP server and the Studio run on the user's computer, and exports are static files on the user's website. The trust boundaries are:

- **Exports** make no request to any third party: the runtime loads the scene, its assets and its scripts from the export's own URLs, and nothing else (no CDN, no web fonts, no analytics, no telemetry). Library assets are copied into the export, never hotlinked.
- **The network** is used only by the optional `assets search` / `assets add` (MCP `assets_search` / `assets_add`) against free, account-less sources (Poly Haven, ambientCG, Khronos samples), by `npx` fetching the package, and by the optional Studio assistant, which sends the conversation to `api.anthropic.com` with the user's own API key kept in the browser's `localStorage`. No telemetry, no update check.
- **Local servers** (`serve`, `studio`, the render server) bind 127.0.0.1 only. The Studio API rejects requests whose `Host` is not local or whose `Origin` is another site (DNS rebinding, CSRF), and project paths cannot leave the project folder.
- **Headless renders** use the user's installed Chrome / Chromium / Edge / Brave with a temporary profile, over a local DevTools connection.
- **Scene scripts** are a contract checked by static analysis, not a runtime sandbox: `agent3d check` rejects scripts that use network, DOM, storage, `eval` / `Function`, imports and other forbidden globals, but scripts run as modules with the host page's privileges. Scenes without scripts contain no executable code; HUD texts and `{data.key}` bindings are inserted as text, never as HTML.
- **Navigation** happens only on a user gesture (`openUrl` interactions, object `href`), with http(s) or page-relative URLs; `javascript:` URLs are refused.
- **Content-Security-Policy**: embeds work without `'unsafe-eval'`; `'wasm-unsafe-eval'` is needed only for meshopt-compressed models. The snippet pins the runtime with Subresource Integrity.

Details: [docs/security.md](https://github.com/fleox/agent3d/blob/main/docs/security.md).

## What users should do

- Only publish scene scripts you wrote or reviewed and that pass `agent3d check`.
- Treat a scene from someone else like any JavaScript you add to your site when it has `scripts`.
- Keep the Studio assistant's API key to your own browser; use the assistant panel's "Forget the key" on a shared computer.
- Keep the Subresource Integrity attributes of the export snippet, and set a Content-Security-Policy on your site ([export.md](https://github.com/fleox/agent3d/blob/main/docs/export.md#content-security-policy)).

## Supported versions

Security fixes go to the latest release; update with `npx -y @fleox/agent3d@latest version` and re-export your embeds to get the new runtime.
