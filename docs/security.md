# Security

## What runs where

- **Exports** are static files. The runtime makes no request to any third party: it loads the scene, its assets and its scripts from the URLs of the export, and nothing else (no CDN, no web fonts, no analytics, no telemetry). Library assets are copied into the export, never hotlinked.
- **The CLI** works on local folders. Its only network use is `assets search` / `assets add --hit` against free, account-less CC0 sources (Poly Haven, ambientCG, Khronos samples on GitHub), and `npx` fetching the package itself. Kenney and Quaternius packs are downloaded by the user, not by Agent3D.
- **Headless renders** use the user's installed Chrome / Chromium / Edge with a temporary profile, driven over a local DevTools connection; the page is served from 127.0.0.1.
- **The Studio assistant** (optional) sends the conversation and tool results to `api.anthropic.com` with the user's own API key, kept in the browser's `localStorage`. Nothing else in the Studio talks to the network.

## Local servers

`agent3d serve`, `agent3d studio` and the render server bind **127.0.0.1 only**. The Studio API rejects requests whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>` or whose `Origin` is another site (403), which blocks DNS-rebinding and cross-site requests from other web pages. Project paths are POSIX and relative; `..`, absolute paths and symlinks leaving the folder are refused.

## Scene scripts

Game scripts are ES modules that receive only the `ScriptApi`. `agent3d check` rejects, before export, scripts that use `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `eval`, `Function`, imports (static, dynamic, `import.meta`), `document`, `window`, `globalThis`, `self`, `localStorage`, `sessionStorage`, `indexedDB`, cookies, `parent`, `top`, `opener`, `postMessage`, `importScripts`, `navigator`, `location` or `Worker` ([scripting.md](scripting.md)).

This is a **contract checked by static analysis**, not a runtime sandbox: scripts run as modules in the host page with the page's privileges. Treat a scene with scripts like any JavaScript you add to your site — only publish scripts you wrote or reviewed and that pass `check`. Scenes without scripts contain no executable code (JSON data interpreted by the runtime; HUD text is inserted as text, never as HTML).

## Content-Security-Policy

Embeds work under a strict CSP: `script-src 'self'; connect-src 'self'; img-src 'self' blob:` (+ `style-src 'unsafe-inline'` with a HUD, + `'wasm-unsafe-eval'` in `script-src` when a model is meshopt-compressed: its decoder is WebAssembly). Single-HTML exports additionally need `'unsafe-inline'` and `blob:` scripts and `data:` URLs. The runtime never uses `eval` or `new Function`. Details: [export.md](export.md#content-security-policy).

## Asset licences

Downloaded and imported assets record their licence in `assets/manifest.json`; `check` and `export` surface the ones that need attribution (`CREDITS.txt`). Agent3D only searches sources whose licences allow redistribution (CC0, CC-BY for some Khronos samples).

## Reporting

Report vulnerabilities privately to the maintainer through GitHub security advisories on `fleox/agent3d` rather than public issues.
