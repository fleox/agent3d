#!/usr/bin/env python3
"""Creates an Agent3D banner project in one step (starter or template), applies brand colours and text, and renders a first contact sheet.

    python3 new_banner.py my-banner --title "Golden Crust" [--target banner] [--aspect 4:1] [--template banner-neon-title]
                         [--colors "#2a1306,#5c2c0c,#a8561b"] [--text-color "#fff4e0"] [--no-render]

--colors sets the background gradient (2-3 colours, dark to light); --text-color replaces the material of the
`title` object (the starter's 3D title). Prints the project folder, the sheet to look at and any issues.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agent3d import Agent3dError, patch, run  # noqa: E402


def brand_ops(colors: List[str], text_color: str, has_title: bool) -> List[Dict[str, Any]]:
    ops: List[Dict[str, Any]] = []
    if colors:
        ops.append({"op": "set", "path": "environment.background", "value": {"gradient": colors, "angle": 10}})
    if text_color and has_title:
        # Replace (not merge) the material so old colour overrides don't survive.
        ops.append({"op": "set", "path": "objects#title.material", "value": {"preset": "plastic", "color": text_color, "roughness": 0.3}})
    return ops


def create(a: argparse.Namespace) -> Dict[str, Any]:
    args = ["new", a.dir, "--title", a.title, "--target", a.target]
    if a.aspect:
        args += ["--aspect", a.aspect]
    if a.template:
        args += ["--template", a.template]
    created = run(*args)
    out: Dict[str, Any] = {"dir": created.get("dir", a.dir), "target": created.get("target")}
    colors = [c.strip() for c in a.colors.split(",") if c.strip()] if a.colors else []
    if colors or a.text_color:
        objects = run("object", "list", project=a.dir).get("objects", [])
        has_title = any(o.get("id") == "title" for o in objects)
        ops = brand_ops(colors, a.text_color, has_title)
        if ops:
            res = patch(ops, project=a.dir)
            out["patch"] = {"applied": res.get("applied"), "summary": (res.get("plan") or {}).get("summary"), "issues": res.get("issues", [])}
        if a.text_color and not has_title:
            out["note"] = "No object with id `title`: set the text colour on your own text object with scene patch."
    if not a.no_render:
        render = run("render", "--sheet", "--count", "4", project=a.dir, timeout=240)
        out["sheet"] = render.get("sheet")
        out["renderIssues"] = render.get("issues", []) + render.get("consoleErrors", [])
        out["next"] = "Look at the sheet, then refine with scene patch and render again."
    return out


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("dir")
    p.add_argument("--title", required=True)
    p.add_argument("--target", default="banner")
    p.add_argument("--aspect", default="")
    p.add_argument("--template", default="")
    p.add_argument("--colors", default="")
    p.add_argument("--text-color", dest="text_color", default="")
    p.add_argument("--no-render", dest="no_render", action="store_true")
    a = p.parse_args(argv)
    try:
        report = create(a)
    except Agent3dError as err:
        print(json.dumps(err.as_json(), indent=2))
        return err.exit_code or 1
    print(json.dumps({"ok": True, "data": report}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
