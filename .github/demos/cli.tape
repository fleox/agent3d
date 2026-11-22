# "Build a 3D scene from the terminal" demo for the README: the published
# agent3d CLI in a throw-away folder prepared by setup.sh — a project from a
# template, its summary, a gold torus added, a behaviour patched in, then
# the pre-export check.
#   .github/demos/render.sh cli   (from the repository root; needs vhs, ttyd, ffmpeg, jq)
Output .github/assets/demo-cli.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 25ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 npm_config_cache=/tmp/a3d-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/a3d-cli-demo/work && clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 15ms
Type "alias agent3d='npx -y @fleox/agent3d@0.2.0'"
Set TypingSpeed 25ms
Sleep 300ms
Enter
Sleep 500ms

Type "agent3d new my-banner --template banner-gradient-blob && cd my-banner"
Sleep 300ms
Enter
Wait@60s /❯ ?$/
Sleep 1500ms

Type "agent3d scene summary --json | jq -c '.data.objects[] | {id, kind, detail}'"
Sleep 300ms
Enter
Wait@60s /❯ ?$/
Sleep 3s

Type "clear"
Enter
Type "agent3d object add --id ring --geometry torus --set material.preset=gold --set position=[2.6,0.4,0]"
Sleep 300ms
Enter
Wait@60s /❯ ?$/
Sleep 1500ms

Type `agent3d scene patch '[{"op":"addBehaviour","id":"ring","behaviour":{"type":"rotate","speed":40}}]'`
Sleep 300ms
Enter
Wait@60s /❯ ?$/
Sleep 1500ms

Type "agent3d check"
Sleep 300ms
Enter
Wait@60s /❯ ?$/
Sleep 5s
