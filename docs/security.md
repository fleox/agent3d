# Security

## What runs where

- **Exports** are static files. The runtime makes no request to any third party: it loads the scene, its assets and its scripts from the URLs of the export, and nothing else (no CDN, no web fonts, no analytics, no telemetry). Library assets are copied into the export, never hotlinked.
- **The CLI and the MCP server** work on local folders. Their only network use is `assets search` / `assets add --hit` (MCP `assets_search` / `assets_add` with a hit) against free, account-less CC0 / CC-BY sources (Poly Haven, ambientCG, Khronos samples on GitHub), and `npx` fetching the package itself. Kenney and Quaternius packs are downloaded by the user, not by Agent3D. Everything else — validation, checks, renders, exports, `assets optimize` (WebP encoding in the local Chrome, meshopt in embedded WebAssembly) — is offline. No telemetry, no update check.
- **Headless renders** use the user's installed Chrome / Chromium / Edge with a temporary profile, driven over a local DevTools connection; the page is served from 127.0.0.1.
- **The Studio assistant** (optional) sends the conversation and tool results to `api.anthropic.com` with the user's own API key, kept in the browser's `localStorage`. Nothing else in the Studio talks to the network.

## Local servers

`agent3d serve`, `agent3d studio` and the render server bind **127.0.0.1 only**. The Studio API rejects requests whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>` or whose `Origin` is another site (403), which blocks DNS-rebinding and cross-site requests from other web pages. Project paths are POSIX and relative; `..`, absolute paths and symlinks leaving the folder are refused.

## Scene scripts

Game scripts are ES modules that receive only the `ScriptApi`. `agent3d check` rejects, before export, scripts that use `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, `Function`, imports (static, dynamic, `import.meta`), `document`, `window`, `globalThis`, `self`, `localStorage`, `sessionStorage`, `indexedDB`, cookies, `parent`, `top`, `opener`, `postMessage`, `importScripts`, `navigator`, `location` or `Worker` ([scripting.md](scripting.md)).

This is a **contract checked by static analysis**, not a runtime sandbox: scripts run as modules in the host page with the page's privileges. Treat a scene with scripts like any JavaScript you add to your site — only publish scripts you wrote or reviewed and that pass `check`. Scenes without scripts contain no executable code (JSON data interpreted by the runtime; HUD text and `{data.key}` bindings are inserted as text, never as HTML).

## Navigation

A scene can only navigate through an `openUrl` interaction or an object `href`, fired by a click (or, for `openUrl`, a key press) — a user gesture — and never in headless renders. `openUrl` accepts http(s) and page-relative URLs only and opens cross-origin URLs in a new tab with `noopener,noreferrer`. `href` refuses `javascript:` URLs (validation rejects them, and the runtime re-checks after data bindings) and opens cross-origin URLs in a new tab with `noopener`.

## Content-Security-Policy

Embeds work under a strict CSP: `script-src 'self'; connect-src 'self'; img-src 'self' blob:`, plus `style-src 'unsafe-inline'` when the scene has a HUD. `'wasm-unsafe-eval'` in `script-src` is needed **only** for scenes with meshopt-compressed models (`assets optimize`, `export --optimize`): their decoder is WebAssembly. Nothing ever needs `'unsafe-eval'`: the runtime never uses `eval` or `new Function` (verified on the built runtime) and starts no workers. Single-HTML exports additionally need `'unsafe-inline'` and `blob:` scripts and `data:` URLs. The embed snippet pins the runtime with Subresource Integrity (`integrity="sha384-…"`, `--no-integrity` to drop it). Details: [export.md](export.md#content-security-policy).

## Asset licences

Downloaded and imported assets record their licence in `assets/manifest.json`; `check` and `export` surface the ones that need attribution (`CREDITS.txt`). Agent3D only searches sources whose licences allow redistribution (CC0, CC-BY for some Khronos samples). The built-in library is CC0 except its OFL fonts and four CC-BY Khronos models ([assets.md](assets.md#the-built-in-library)).

## Reporting

Report vulnerabilities privately to the maintainer through GitHub security advisories on `fleox/agent3d` rather than public issues.
