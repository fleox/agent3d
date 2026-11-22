# "Render headless and look at it" demo for the README: the published agent3d
# CLI renders a project (prepared by setup.sh) in the installed Chrome at
# fixed times and composes a contact sheet; render.sh then appends that very
# sheet as a still, the picture the agent looks at.
#   .github/demos/render.sh render
Output .github/assets/demo-render.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 npm_config_cache=/tmp/a3d-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/a3d-cli-demo/work/island && source /tmp/a3d-cli-demo/timing.sh && clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 20ms
Type "alias agent3d='npx -y @fleox/agent3d@0.2.0'"
Set TypingSpeed 35ms
Sleep 300ms
Enter
Sleep 600ms

Type "agent3d scene summary --json | jq -c '.data | {title, target, counts}'"
Sleep 400ms
Enter
Sleep 2500ms

Type "agent3d render --sheet --frames 0,1,2,3 --json | jq '.data | {sheet, frames: [.frames[].path], stats, issues}'"
Sleep 400ms
Enter
Wait@180s /❯ ?$/
Sleep 4s
