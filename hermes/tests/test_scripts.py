"""Tests of the Hermes Python helpers against a fake agent3d engine.

    python3 -m unittest discover -s hermes/tests
"""

import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "python"))

import agent3d  # noqa: E402
import new_banner  # noqa: E402
import render_and_check  # noqa: E402


def ok(data):
    return {"ok": True, "data": data}


RENDER = {
    "frames": [{"t": 0, "path": "/p/renders/t0.png"}, {"t": 2, "path": "/p/renders/t2.png"}],
    "sheet": "/p/renders/sheet.png",
    "stats": {"triangles": 8000, "drawCalls": 7},
    "inspect": {"objects": [{"id": "title", "inView": "full"}, {"id": "dust", "inView": "partial"}]},
    "issues": [],
    "consoleErrors": [],
}
CHECK_OK = {"ok": True, "issues": [], "counts": {"errors": 0, "warnings": 0, "infos": 0}, "budget": {"totalKb": 4}, "licences": []}


class FakeEngine(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.log = os.path.join(self.dir, "calls.jsonl")
        self.script = os.path.join(self.dir, "script.json")
        os.environ["AGENT3D_CMD"] = f'"{sys.executable}" "{os.path.join(HERE, "fake_engine.py")}"'
        os.environ["FAKE_LOG"] = self.log
        os.environ["FAKE_SCRIPT"] = self.script

    def answer(self, *pairs):
        with open(self.script, "w", encoding="utf-8") as fh:
            json.dump([[list(p), r] for p, r in pairs], fh)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log, encoding="utf-8") as fh:
            return [json.loads(l) for l in fh if l.strip()]

    def commands(self):
        return [c for c in self.calls() if isinstance(c, list)]

    def stdins(self):
        return [c["stdin"] for c in self.calls() if isinstance(c, dict) and "stdin" in c]

    def capture(self, fn, argv):
        buf = StringIO()
        with redirect_stdout(buf):
            code = fn(argv)
        out = buf.getvalue()
        return code, json.loads(out) if out.strip().startswith("{") else out


class WrapperTest(FakeEngine):
    def test_run_returns_data_and_adds_json_and_project(self):
        self.answer((["scene", "summary"], ok({"id": "b", "objects": []})))
        data = agent3d.run("scene", "summary", project="my-banner")
        self.assertEqual(data["id"], "b")
        self.assertEqual(self.commands()[0], ["scene", "summary", "--project", "my-banner", "--json"])

    def test_new_takes_the_folder_not_project(self):
        self.answer((["new"], ok({"dir": "/x/b"})))
        agent3d.run("new", "b", "--target", "banner", project="ignored")
        self.assertEqual(self.commands()[0], ["new", "b", "--target", "banner", "--json"])

    def test_errors_carry_code_hint_and_details(self):
        issues = [{"severity": "error", "path": "objects#a.geometry.type", "message": "Unknown geometry"}]
        self.answer((["scene", "patch"], {"ok": False, "error": {"code": "validation", "message": "Invalid", "hint": "Did you mean torus?", "details": {"issues": issues}}, "__exit__": 2}))
        with self.assertRaises(agent3d.Agent3dError) as ctx:
            agent3d.run("scene", "patch", "--file", "ops.json", project="p")
        e = ctx.exception
        self.assertEqual((e.code, e.hint, e.exit_code), ("validation", "Did you mean torus?", 2))
        self.assertEqual(e.details["issues"], issues)
        self.assertEqual(e.as_json()["error"]["details"]["issues"], issues)

    def test_patch_sends_ops_on_stdin(self):
        self.answer((["scene", "patch"], ok({"applied": True, "plan": {"summary": "change 1 (title)."}, "issues": []})))
        ops = [{"op": "set", "path": "objects#title.material", "value": {"preset": "gold"}}]
        data = agent3d.patch(ops, project="p", yes=True)
        self.assertTrue(data["applied"])
        self.assertEqual(self.commands()[0], ["scene", "patch", "--file", "-", "--yes", "--project", "p", "--json"])
        self.assertEqual(json.loads(self.stdins()[0]), ops)

    def test_no_json_output(self):
        self.answer((["doctor"], {"__raw__": "boom", "__exit__": 1}))
        with self.assertRaises(agent3d.Agent3dError) as ctx:
            agent3d.run("doctor")
        self.assertEqual(ctx.exception.code, "no-output")

    def test_node_missing_is_explained(self):
        del os.environ["AGENT3D_CMD"]
        path = os.environ.get("PATH", "")
        os.environ["PATH"] = self.dir
        try:
            with self.assertRaises(agent3d.Agent3dError) as ctx:
                agent3d.engine_command()
            self.assertEqual(ctx.exception.code, "node-missing")
            self.assertIn("nodejs.org", ctx.exception.hint)
        finally:
            os.environ["PATH"] = path

    def test_pinned_package(self):
        self.assertEqual(agent3d.PACKAGE, "@fleox/agent3d")
        self.assertEqual(agent3d.MIN_NODE, (22, 0))

    def test_needs_confirmation_and_result(self):
        self.assertTrue(agent3d.needs_confirmation({"needsConfirmation": True, "plan": {}}))
        self.assertFalse(agent3d.needs_confirmation({"applied": True}))
        self.assertTrue(agent3d.needs_confirmation({"tool": "scene_apply", "result": {"needsConfirmation": True}}))
        self.assertEqual(agent3d.result({"tool": "check", "result": [1]}), [1])

    def test_main_prints_the_cli_object_and_exit_code(self):
        self.answer((["check"], {**ok({"ok": False, "issues": []}), "__exit__": 1}))
        code, out = self.capture(agent3d.main, ["check", "--project", "p"])
        self.assertEqual(code, 1)
        self.assertTrue(out["ok"])


class RenderAndCheckTest(FakeEngine):
    def test_renders_then_checks(self):
        self.answer((["render"], ok(RENDER)), (["check"], ok(CHECK_OK)))
        code, out = self.capture(render_and_check.main, ["--project", "p", "--frames", "0,2", "--size", "1200x300"])
        self.assertEqual(code, 0)
        data = out["data"]
        self.assertTrue(data["ok"])
        self.assertEqual(data["sheet"], "/p/renders/sheet.png")
        self.assertIn("dust", data["summary"])
        render, check = self.commands()
        self.assertEqual(render, ["render", "--sheet", "--frames", "0,2", "--size", "1200x300", "--project", "p", "--json"])
        self.assertEqual(check, ["check", "--project", "p", "--json"])

    def test_problems_make_it_not_ok(self):
        bad = {**CHECK_OK, "ok": False, "issues": [{"severity": "warning", "code": "triangles", "path": "objects", "message": "Too many triangles", "hint": "Lower segments"}], "counts": {"errors": 0, "warnings": 1}}
        render = {**RENDER, "consoleErrors": ["script-error: boom"]}
        self.answer((["render"], ok(render)), (["check"], {**ok(bad), "__exit__": 1}))
        code, out = self.capture(render_and_check.main, ["--project", "p"])
        self.assertEqual(code, 0)
        data = out["data"]
        self.assertFalse(data["ok"])
        self.assertIn("Too many triangles", data["summary"])
        self.assertIn("boom", data["summary"])
        self.assertIn("--count", self.commands()[0])

    def test_render_failure_is_reported(self):
        self.answer((["render"], {"ok": False, "error": {"code": "browser-missing", "message": "No Chrome", "hint": "Install Google Chrome"}, "__exit__": 1}))
        code, out = self.capture(render_and_check.main, ["--project", "p"])
        self.assertEqual(code, 1)
        self.assertEqual(out["error"]["hint"], "Install Google Chrome")


class NewBannerTest(FakeEngine):
    def test_creates_brands_and_renders(self):
        self.answer(
            (["new"], ok({"dir": "/x/b", "target": {"kind": "banner", "aspect": "4:1"}})),
            (["object", "list"], ok({"objects": [{"id": "title", "kind": "text"}]})),
            (["scene", "patch"], ok({"applied": True, "plan": {"summary": "change 1 (title); update environment."}, "issues": []})),
            (["render"], ok(RENDER)),
        )
        code, out = self.capture(new_banner.main, ["b", "--title", "Golden Crust", "--colors", "#2a1306, #5c2c0c", "--text-color", "#fff4e0"])
        self.assertEqual(code, 0)
        data = out["data"]
        self.assertEqual(data["sheet"], "/p/renders/sheet.png")
        self.assertTrue(data["patch"]["applied"])
        cmds = self.commands()
        self.assertEqual(cmds[0], ["new", "b", "--title", "Golden Crust", "--target", "banner", "--json"])
        ops = json.loads(self.stdins()[0])
        self.assertEqual(ops[0]["value"], {"gradient": ["#2a1306", "#5c2c0c"], "angle": 10})
        # The material is replaced, never merged (old overrides must not survive).
        self.assertEqual(ops[1], {"op": "set", "path": "objects#title.material", "value": {"preset": "plastic", "color": "#fff4e0", "roughness": 0.3}})

    def test_template_without_title_skips_text_colour(self):
        self.answer(
            (["new"], ok({"dir": "/x/b"})),
            (["object", "list"], ok({"objects": [{"id": "headline", "kind": "text"}]})),
        )
        code, out = self.capture(new_banner.main, ["b", "--title", "Hi", "--template", "banner-neon-title", "--text-color", "#fff", "--no-render"])
        self.assertEqual(code, 0)
        self.assertIn("note", out["data"])
        self.assertIn("--template", self.commands()[0])
        self.assertFalse(any(c[:2] == ["scene", "patch"] for c in self.commands()))

    def test_brand_ops(self):
        self.assertEqual(new_banner.brand_ops([], "", True), [])
        self.assertEqual(len(new_banner.brand_ops(["#000", "#111"], "#fff", False)), 1)


if __name__ == "__main__":
    unittest.main()
