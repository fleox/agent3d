# "Export for any website" demo for the README: the published agent3d CLI
# re-exports a project (prepared and exported once by setup.sh): the
# overwrite plan, --yes, the page weight and the snippet, then an MP4 teaser
# rendered frame by frame. render.sh speeds up the two waits (export with
# its poster render, video; visible label) and appends a headless Chrome screenshot of the exported index.html.
#   .github/demos/render.sh export
Output .github/assets/demo-export.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 npm_config_cache=/tmp/a3d-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/a3d-cli-demo/work/sneaker && source /tmp/a3d-cli-demo/timing.sh && clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 20ms
Type "alias agent3d='npx -y @fleox/agent3d@0.2.0'"
Set TypingSpeed 35ms
Sleep 300ms
Enter
Sleep 600ms

Type "agent3d export"
Sleep 400ms
Enter
Sleep 2500ms

Type "agent3d export --yes 2>/dev/null"
Sleep 400ms
Enter
Wait@180s /❯ ?$/
Sleep 6s

Type "clear"
Enter
Type "agent3d render --video teaser.mp4 --duration 3 --size 960x540"
Sleep 400ms
Enter
# The frame-by-frame render takes ~40 s: render.sh speeds this part up.
Wait@180s /❯ ?$/
Sleep 3s
