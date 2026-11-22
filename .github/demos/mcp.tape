# MCP demo for the README: register the published agent3d MCP server in
# Claude Code (a throw-away HOME, never the maintainer's own config), check
# it connects, then speak raw JSON-RPC to it: initialize, tools/list and a
# render_preview call that returns the contact sheet as an image block.
# render.sh appends that image as a still (what a multimodal client sees).
#   .github/demos/render.sh mcp   (needs the claude CLI)
Output .github/assets/demo-mcp.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 HOME=/tmp/a3d-cli-demo/claude-home npm_config_cache=/tmp/a3d-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/a3d-cli-demo/work/planet && source /tmp/a3d-cli-demo/timing.sh && clear"
Enter
Sleep 500ms
Show

Type "claude mcp add agent3d -- npx -y @fleox/agent3d@0.2.0 mcp"
Sleep 400ms
Enter
Sleep 2500ms

Type "claude mcp list"
Sleep 300ms
Enter
Wait@180s /❯ ?$/
Sleep 3s

Type "clear"
Enter
Type "jq -c '{id, method, tool: .params.name}' session.jsonl   # what a client sends"
Sleep 400ms
Enter
Sleep 3s

Type "npx -y @fleox/agent3d@0.2.0 mcp < session.jsonl 2>/dev/null | jq -c -f show.jq"
Sleep 400ms
Enter
Wait@180s /❯ ?$/
Sleep 5s
