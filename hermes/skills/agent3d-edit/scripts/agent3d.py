#!/usr/bin/env python3
"""Agent3D from Python — a thin, dependency-free wrapper of the `agent3d` CLI.

The Agent3D engine (scene validation, headless renders, exports, MCP server)
is the `@fleox/agent3d` npm package and runs on Node.js 22+ (renders also need
Google Chrome, Chromium or Edge). This module runs it for Python agents and
scripts, always in JSON mode, and turns its output into Python values:

    from agent3d import run, Agent3dError
    run("new", "my-banner", "--target", "banner", "--title", "Spring sale")
    summary = run("scene", "summary", project="my-banner")
    sheet = run("render", "--sheet", project="my-banner")["sheet"]

Command line (same arguments as the CLI; --json is added for you):

    python3 agent3d.py doctor
    python3 agent3d.py render --sheet --project my-banner

Output: the CLI's JSON object, pretty-printed: {"ok": true, "data": …} or
{"ok": false, "error": {"code", "message", "hint"}}. Progress lines go to
stderr. The exit code is the CLI's (0 ok, 1 failure, 2 usage / validation).

Engine selection: $AGENT3D_CMD when set (e.g. "node /path/to/agent3d.mjs"),
else `npx -y @fleox/agent3d@<pinned version>`. Python 3.9+, stdlib only.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional, Sequence

# Pinned to the release these skills were written for (kept in step by the
# repository's build script).
VERSION = "0.3.1"
PACKAGE = "@fleox/agent3d"
MIN_NODE = (22, 0)

# Commands that run until stopped: they need the user's terminal, never JSON capture.
LONG_RUNNING = ("serve", "studio", "mcp")

__all__ = ["run", "run_raw", "result", "needs_confirmation", "Agent3dError", "engine_command", "VERSION"]


class Agent3dError(Exception):
    """A failed command: `code`, `message`, the CLI's `hint` (what to do) and `details` (e.g. validation issues)."""

    def __init__(self, code: str, message: str, hint: Optional[str] = None, exit_code: int = 1, details: Any = None):
        super().__init__(f"{code}: {message}" + (f" — {hint}" if hint else ""))
        self.code = code
        self.message = message
        self.hint = hint
        self.exit_code = exit_code
        self.details = details

    def as_json(self) -> Dict[str, Any]:
        err: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.hint:
            err["hint"] = self.hint
        if self.details is not None:
            err["details"] = self.details
        return {"ok": False, "error": err}


def _node_version() -> Optional[tuple]:
    node = shutil.which("node")
    if not node:
        return None
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.match(r"v(\d+)\.(\d+)", out)
    return (int(m.group(1)), int(m.group(2))) if m else None


def engine_command() -> List[str]:
    """The command that runs the Agent3D engine (raises when Node.js is missing or too old)."""
    custom = os.environ.get("AGENT3D_CMD", "").strip()
    if custom:
        return shlex.split(custom)
    version = _node_version()
    if version is None:
        raise Agent3dError(
            "node-missing",
            "Node.js is not installed: the Agent3D engine runs on Node.js 22 or newer.",
            "Install Node.js LTS (https://nodejs.org, or `brew install node` / your package manager), then retry.",
        )
    if version < MIN_NODE:
        raise Agent3dError(
            "node-too-old",
            f"Node.js {version[0]}.{version[1]} is too old: Agent3D needs 22 or newer.",
            "Update Node.js (https://nodejs.org), then retry.",
        )
    npx = shutil.which("npx")
    if not npx:
        raise Agent3dError("npx-missing", "npx was not found next to Node.js.", "Reinstall Node.js with npm included.")
    pinned = VERSION if not VERSION.startswith("__") else "latest"
    return [npx, "-y", f"{PACKAGE}@{pinned}"]


def _with_project(argv: List[str], project: Optional[str]) -> List[str]:
    if project and "--project" not in argv:
        # `new <dir>` takes the folder as its argument, not --project.
        if not argv or argv[0] not in ("new", "help", "version", "catalog", "templates", "doctor"):
            argv = argv + ["--project", str(project)]
    return argv


def run_raw(*args: Any, project: Optional[str] = None, timeout: Optional[float] = None, echo_progress: bool = False, input_text: Optional[str] = None) -> Dict[str, Any]:
    """Runs a command and returns the CLI's whole JSON object ({"ok": …}).

    `input_text` is sent on stdin (for `--file -`)."""
    argv = _with_project([str(a) for a in args], project)
    if "--json" not in argv:
        argv.append("--json")
    cmd = engine_command() + argv
    try:
        proc = subprocess.run(
            cmd,
            input=input_text,
            stdout=subprocess.PIPE,
            stderr=None if echo_progress else subprocess.PIPE,
            text=True,
            timeout=timeout,
            # Never let a stray prompt wait forever on a captured run.
            stdin=None if input_text is not None else subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired as exc:
        raise Agent3dError("timeout", f"`agent3d {' '.join(argv[:2])}` took longer than {timeout}s.", "Retry with a longer timeout (renders and video exports can take a minute).") from exc
    except FileNotFoundError as exc:
        raise Agent3dError("engine-missing", f"Could not start {cmd[0]}.", "Check Node.js / $AGENT3D_CMD.") from exc
    lines = [l for l in proc.stdout.splitlines() if l.strip()]
    for line in reversed(lines):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and "ok" in value:
            value.setdefault("exitCode", proc.returncode)
            return value
    stderr = (proc.stderr or "").strip().splitlines()[-5:] if not echo_progress else []
    raise Agent3dError(
        "no-output",
        f"`agent3d {' '.join(argv[:2])}` printed no JSON result (exit {proc.returncode}).",
        ("Last messages: " + " | ".join(stderr)) if stderr else "Retry once; if it persists, run it in a terminal to see the error.",
        proc.returncode or 1,
    )


def run(*args: Any, project: Optional[str] = None, timeout: Optional[float] = None, echo_progress: bool = False, input_text: Optional[str] = None) -> Any:
    """Runs a command; returns its `data`, raises Agent3dError when ok is false."""
    out = run_raw(*args, project=project, timeout=timeout, echo_progress=echo_progress, input_text=input_text)
    if not out.get("ok"):
        err = out.get("error") or {}
        raise Agent3dError(err.get("code", "failed"), err.get("message", "Command failed."), err.get("hint"), int(out.get("exitCode") or 1), err.get("details"))
    return out.get("data")


def patch(ops: List[Dict[str, Any]], project: str, yes: bool = False, dry_run: bool = False, timeout: Optional[float] = None) -> Any:
    """`scene patch` with a list of ops (sent on stdin). Returns `data`: check `applied`, `issues`, or `needs_confirmation(data)`."""
    args: List[str] = ["scene", "patch", "--file", "-"]
    if yes:
        args.append("--yes")
    if dry_run:
        args.append("--dry-run")
    return run(*args, project=project, timeout=timeout, input_text=json.dumps(ops))


def result(data: Any) -> Any:
    """`tools call` wraps the tool's answer as {tool, result}: the result. Other data is returned as is."""
    if isinstance(data, dict) and "result" in data and "tool" in data:
        return data["result"]
    return data


def needs_confirmation(data: Any) -> bool:
    """True when the command only printed a plan and wrote nothing (removing objects,
    replacing the scene, overwriting an export, deleting an asset): re-run it with
    --yes once the user agreed. The JSON marker is `needsConfirmation` on `data`."""
    if not isinstance(data, dict):
        return False
    if data.get("needsConfirmation") is True:
        return True
    inner = result(data)
    return inner is not data and isinstance(inner, dict) and inner.get("needsConfirmation") is True


def main(argv: Sequence[str]) -> int:
    args = list(argv)
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0
    try:
        if args[0] in LONG_RUNNING:
            # Long-running servers: the user's own terminal (or the MCP client).
            return subprocess.call(engine_command() + args)
        out = run_raw(*args, echo_progress=True)
    except Agent3dError as err:
        print(json.dumps(err.as_json(), indent=2, ensure_ascii=False))
        return err.exit_code if err.exit_code else 1
    code = int(out.pop("exitCode", 0) or 0)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return code if code else (0 if out.get("ok") else 1)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
