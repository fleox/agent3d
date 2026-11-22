#!/usr/bin/env python3
"""Renders an Agent3D project headless (contact sheet + frames) and runs `check`, then prints the image paths to look at and a compact verdict.

    python3 render_and_check.py --project my-banner [--count 4 | --frames 0,2,4] [--size 1200x300] [--scale 2]

Read-only for the scene (writes PNGs into <project>/renders/). Open `data.sheet` with your image viewer / vision tool,
then fix what you see. `data.ok` is true when check has no errors and no warnings and the render had no runtime issue.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agent3d import Agent3dError, run  # noqa: E402


def collect(project: str, count: int, frames: str, size: str, scale: str, timeout: float) -> Dict[str, Any]:
    args: List[str] = ["render", "--sheet"]
    if frames:
        args += ["--frames", frames]
    else:
        args += ["--count", str(count)]
    if size:
        args += ["--size", size]
    if scale:
        args += ["--scale", scale]
    render = run(*args, project=project, timeout=timeout) or {}
    check = run_check(project, timeout)
    issues = check.get("issues", [])
    errors = [i for i in issues if i.get("severity") == "error"]
    warnings = [i for i in issues if i.get("severity") == "warning"]
    runtime = list(render.get("issues") or []) + [{"code": "console-error", "message": str(e)} for e in (render.get("consoleErrors") or [])]
    lines = [f"Look at {render.get('sheet') or 'the frames'} before deciding anything."]
    lines.append(f"check: {len(errors)} error(s), {len(warnings)} warning(s)")
    for i in (errors + warnings)[:12]:
        lines.append(f"- {i.get('severity')} {i.get('path')}: {i.get('message')}" + (f" ({i['hint']})" if i.get("hint") else ""))
    for r in runtime[:8]:
        lines.append(f"- runtime {r.get('code')}: {r.get('message')}")
    clipped = [o["id"] for o in ((render.get("inspect") or {}).get("objects") or []) if o.get("inView") != "full"]
    if clipped:
        lines.append(f"- not fully in view: {', '.join(clipped)} (fine for full-frame particles)")
    return {
        "project": project,
        "ok": not errors and not warnings and not runtime,
        "sheet": render.get("sheet"),
        "frames": render.get("frames", []),
        "stats": render.get("stats"),
        "runtimeIssues": runtime,
        "check": {"ok": check.get("ok"), "counts": check.get("counts"), "issues": issues, "budget": check.get("budget"), "licences": check.get("licences", [])},
        "summary": "\n".join(lines),
    }


def run_check(project: str, timeout: float) -> Dict[str, Any]:
    # `check` exits 1 when not ok but still answers ok: true with the report.
    try:
        return run("check", project=project, timeout=timeout) or {}
    except Agent3dError as err:
        if isinstance(err.details, dict) and "issues" in err.details:
            return {"ok": False, "issues": err.details["issues"], "counts": {}}
        raise


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--project", required=True)
    p.add_argument("--count", type=int, default=4)
    p.add_argument("--frames", default="")
    p.add_argument("--size", default="")
    p.add_argument("--scale", default="")
    p.add_argument("--timeout", type=float, default=240)
    a = p.parse_args(argv)
    try:
        report = collect(a.project, a.count, a.frames, a.size, a.scale, a.timeout)
    except Agent3dError as err:
        print(json.dumps(err.as_json(), indent=2))
        return err.exit_code or 1
    print(json.dumps({"ok": True, "data": report}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
