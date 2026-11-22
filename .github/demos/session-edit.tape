# Edit demo for the README (demo-edit.gif): a REAL Claude Code session with
# the agent3d plugin (0.2.0) reworking the Maison Lune banner that
# session-create.tape left in the same folder (fresh claude session):
# golden-hour lighting, gold letters revealed one by one, a click on the
# croissant that opens /shop, re-render, re-export. Not reproducible as is:
# the recording is reviewed, then the agent's work is sped up with a visible
# label.
# How the environment was prepared (not recorded):
# - /tmp/a3d-session-create and /tmp/a3d-session-game, each with
#   .claude/settings.json: extraKnownMarketplaces agent3d (github
#   fleox/agent3d), enabledPlugins agent3d@agent3d, permissions.defaultMode
#   "auto", the agent3d CLI (`npx -y @fleox/agent3d@0.2.0 …`) plus Read / Write /
#   Edit / ls / cat / mkdir pre-approved; plugin installed at project scope
#   (`claude plugin marketplace add fleox/agent3d --scope project`,
#   `claude plugin install agent3d@agent3d --scope project`); each folder
#   trusted by running claude there once and accepting the trust dialog.
# - CLAUDE_CODE_PLUGIN_CACHE_DIR=/tmp/a3d-demo-plugins so skill paths shown on
#   screen are not under the owner's home.
# - The agent's Bash tool runs /tmp/a3d-demo-bin/zsh
#   (`exec /bin/zsh -o shwordsplit "$@"`); /tmp/a3d-demo-bin/ls
#   (`exec /bin/ls -g -o "$@"`, first on PATH) keeps the account name out of
#   `ls -l` output. Agent3D itself needs no home folder or account.
# - Renders use the machine's installed Google Chrome (headless).
# Every frame of the take was OCR-checked (macOS Vision) for /Users paths and
# the account name before composing.
#
# Compose (timings of the take used, first take):
#   COLORS=128 FASTFPS=3 STILL=5 .github/demos/compose.sh /tmp/a3d-rec/edit.mp4 .github/assets/demo-edit.gif 15 197.5 10 16 /tmp/a3d-session-create/maison-lune/renders/20261122-215037-sheet.png
# The still is the agent's own contact sheet from that take (t = 1.3 s, mid
# letter reveal, and t = 3 s).
Output "/tmp/a3d-rec/edit.mp4"

Set Shell "bash"
Set FontSize 20
Set Width 1600
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type `export BASH_SILENCE_DEPRECATION_WARNING=1; unset $(compgen -e | grep -E '^CLAUDE'); export PATH=/tmp/a3d-demo-bin:$PATH SHELL=/tmp/a3d-demo-bin/zsh CLAUDE_CODE_SHELL=/tmp/a3d-demo-bin/zsh CLAUDE_CODE_PLUGIN_CACHE_DIR=/tmp/a3d-demo-plugins`
Enter
Type "alias claude='claude --setting-sources project,local' && export PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/a3d-session-create && clear"
Enter
Sleep 500ms
Show

Type "claude"
Enter
Sleep 7s

Type `Make the Maison Lune banner more premium: golden-hour lighting, gold letters revealed one by one, and a click on the croissant that opens /shop. Render it again and re-export. Go ahead without asking.`
Sleep 1s
Enter
Sleep 600s
