#!/usr/bin/env bash
# Prepares the throw-away projects the README terminal demo tapes use
# (cli, render, export, mcp), from the PUBLISHED package (never the
# repository build: inside the repo, npx would resolve the local package).
# Idempotent: wipes and rebuilds /tmp/a3d-cli-demo/work every time
# (render.sh runs it before each tape).
#   .github/demos/setup.sh
# Needs Node >= 22, an installed Chrome / Chromium (headless renders), jq.
set -euo pipefail
VERSION="${AGENT3D_DEMO_VERSION:-0.2.0}"
PKG="@fleox/agent3d@$VERSION"
DEMO=/tmp/a3d-cli-demo
export npm_config_cache="$DEMO/npm-cache"
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false

mkdir -p "$DEMO"
cd "$DEMO"
rm -rf work claude-home timing.log
mkdir -p work claude-home
a3d() { npx -y "$PKG" "$@"; }

# Warm the npx cache so nothing downloads while recording.
a3d version >/dev/null

cd work
# cli.tape creates its own project (my-banner) on screen.
# render.tape: a 16:9 procedural hero.
a3d new island --template hero-floating-island >/dev/null
# export.tape: a product hero exported once already (the tape re-exports
# over it: plan + needsConfirmation, then --yes).
a3d new sneaker --template hero-sneaker-showcase >/dev/null
(cd sneaker && a3d export --yes >/dev/null 2>&1)
# mcp.tape: a space hero + a raw JSON-RPC session (initialize, tools/list,
# tools/call render_preview) and the jq filter that prints the answers.
a3d new planet --template hero-space-planet >/dev/null
cat > planet/session.jsonl <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"render_preview","arguments":{"frames":[0,4],"sheet":true,"maxWidth":1200}}}
JSON
cat > planet/show.jq <<'JQ'
if .id == 1 then {id, server: .result.serverInfo}
elif .id == 2 then {id, tools: (.result.tools | length), names: ([.result.tools[].name][0:5] + ["…"])}
else .id as $id | .result.content[] | if .type == "image"
  then {id: $id, image: "\(.mimeType), \(.data | length * 3 / 4 / 1024 | floor) KB"}
  else {id: $id, text: (.text | fromjson | {sheet, frames: [.frames[].t], stats: (.stats | {triangles, drawCalls})})} end end
JQ
# render / export / mcp tapes source this (hidden): it logs when each npx /
# claude command starts
# ("s") and when the prompt comes back ("e"), so render.sh can find the
# waits to speed up. t0 = when it is sourced
# (the tape shows the terminal ~0.5 s later).
cat > "$DEMO/timing.sh" <<'SH'
A3D_LOG=/tmp/a3d-cli-demo/timing.log
rm -f "$A3D_LOG"
a3d_now() { perl -MTime::HiRes=time -e 'printf "%.2f", time'; }
trap 'case $BASH_COMMAND in npx*|claude*) echo "$(a3d_now) s" >> "$A3D_LOG";; esac' DEBUG
PROMPT_COMMAND='echo "$(a3d_now) e" >> "$A3D_LOG"'
echo "$(a3d_now) t0" >> "$A3D_LOG"
SH
echo "demo projects ready in $DEMO/work"
