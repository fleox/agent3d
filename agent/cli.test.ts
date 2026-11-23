import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands";
import { renderFailure } from "./commands/meta";
import { CliError } from "./output";
import { parseScalar, setPairs } from "./commands/util";
import { cli, ok } from "./testing/cli";
import { writeZipStored } from "../src/ops/zip";
import { tempDir } from "./testing/tmp";

// The JSON contract agents rely on: exactly one {ok,data} / {ok:false,
// error:{code,message,hint}} object on stdout, exit 2 for usage /
// validation errors, help --json listing every command with its arguments.

const REQUIRED = ["help", "version", "new", "info", "scene", "object", "timeline", "catalog", "templates", "check", "render", "serve", "studio", "export", "assets", "tools", "mcp", "doctor"];

const tmp = () => tempDir("agent3d-cli-");

describe("CLI contract", () => {
  it("help --json lists every command with usage, options and subcommands", async () => {
    const r = await cli(["help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toHaveLength(1);
    const names = r.body.data.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(REQUIRED);
    const scene = r.body.data.commands.find((c: { name: string }) => c.name === "scene");
    expect(scene.subcommands.map((s: { name: string }) => s.name)).toEqual(["get", "summary", "apply", "patch", "validate"]);
    const object = r.body.data.commands.find((c: { name: string }) => c.name === "object");
    expect(object.subcommands.map((s: { name: string }) => s.name)).toEqual(["add", "update", "remove", "list", "get", "move"]);
    expect(object.options.map((o: { name: string }) => o.name)).toEqual(expect.arrayContaining(["project", "json-def", "set", "yes"]));
    for (const c of r.body.data.commands) {
      expect(c.usage.startsWith(c.name)).toBe(true);
      expect(c.summary.length).toBeGreaterThan(10);
    }
    expect((await cli(["help", "render"])).body.data.commands).toHaveLength(1);
    expect((await cli(["render", "--help"])).body.data.commands[0].name).toBe("render");
  });

  it("every subcommand usage starts with its command", () => {
    for (const c of COMMANDS) for (const s of c.subcommands ?? []) expect(s.usage.startsWith(`${c.name} `) || s.usage === `${c.name} ${s.name}`).toBe(true);
  });

  it("prints the version", async () => {
    expect((await cli(["version"])).body).toMatchObject({ ok: true, data: { version: expect.stringMatching(/^\d+\.\d+\.\d+/) } });
    expect((await cli(["--version"])).body.ok).toBe(true);
  });

  it("exits 2 with one error object on usage errors", async () => {
    const dir = tmp();
    const cases: [string[], string][] = [
      [["nope"], "unknown-command"],
      [["help", "--bogus"], "usage"],
      [["new"], "usage"],
      [["new", join(dir, "x"), "--target", "billboard"], "usage"],
      [["catalog", "nope"], "usage"],
    ];
    for (const [args, code] of cases) {
      const r = await cli(args);
      expect({ args, exit: r.code }).toEqual({ args, exit: 2 });
      expect(r.stdout).toHaveLength(1);
      expect(r.body).toMatchObject({ ok: false, error: { code, message: expect.any(String), hint: expect.any(String) } });
    }
  });

  it("fails with no-project + a hint outside a project", async () => {
    const r = await cli(["scene", "summary", "--project", tmp()]);
    expect(r.code).toBe(1);
    expect(r.body.error).toMatchObject({ code: "no-project", hint: expect.stringContaining("agent3d new") });
  });

  it("doctor reports its checks", async () => {
    const r = await cli(["doctor", "--no-render"]);
    expect(r.stdout).toHaveLength(1);
    // ok mirrors the checks: { ok: true, data } (exit 0) or { ok: false, error: doctor-failed } (exit 1).
    const checks = r.body.ok ? r.body.data.checks : (r.body.error as { details: { checks: unknown[] } }).details.checks as { id: string; ok: boolean; optional?: boolean; hint?: string }[];
    expect(checks.map((c: { id: string }) => c.id)).toEqual(["node", "browser", "runtime", "studio", "library", "templates"]);
    for (const c of checks) if (!c.ok && !c.optional) expect(c.hint).toBeTruthy();
    const failed = checks.some((c: { ok: boolean; optional?: boolean }) => !c.ok && !c.optional);
    expect(r.body.ok).toBe(!failed);
    expect(r.code).toBe(failed ? 1 : 0);
    if (failed) expect(r.body.error).toMatchObject({ code: "doctor-failed", hint: expect.any(String) });
    else expect(r.body.data.ok).toBe(true);
  });

  it("doctor only blames the browser when the browser failed", () => {
    expect(renderFailure(new CliError("browser-launch", "boom", "Could not start Chrome")).hint).toBe("Could not start Chrome");
    expect(renderFailure(new CliError("webgl-unavailable", "no gl")).hint).toMatch(/Chrome/);
    const internal = renderFailure(new Error("ENOENT: no such file or directory, open 'renders/x-t0.png'"));
    expect(internal.hint).not.toMatch(/AGENT3D_CHROME/);
    expect(internal.message).toContain("ENOENT");
  });

  it("validation messages never end with a double period", async () => {
    const dir = join(tmp(), "dots");
    await ok(["new", dir, "--target", "banner"]);
    const r = await cli(["object", "update", "title", "--set", 'behaviours=[{"type":"hoverscale"}]', "--project", dir]);
    expect(r.code).toBe(2);
    expect(r.body.error?.message).toContain('Unknown behaviour "hoverscale". Nothing was written.');
    expect(r.body.error?.message).not.toMatch(/[^.]\.\.(?!\.)/);
  });

  it("pages the built-in library and shows animation clips", async () => {
    const first = await ok(["assets", "library"]);
    expect(first.assets.length).toBeLessThanOrEqual(50);
    if (first.total > 50) expect(first.more).toBe(true);
    const all = await ok(["assets", "library", "--all"]);
    expect(all.assets.length).toBe(all.total);
    expect((await ok(["assets", "library", "--limit", "5", "--offset", "5"])).assets.map((a: { id: string }) => a.id)).toEqual(all.assets.slice(5, 10).map((a: { id: string }) => a.id));
    const animated = all.assets.filter((a: { animations?: string[] }) => a.animations?.length);
    expect(animated.length).toBeGreaterThan(0);
  });

  it("documents the catalog", async () => {
    const sections = (await ok(["catalog"])).sections.map((s: { section: string }) => s.section);
    expect(sections).toEqual(expect.arrayContaining(["geometries", "behaviours", "generators"]));
    expect((await ok(["catalog", "geometries", "box"])).entry).toMatchObject({ id: "box" });
    expect((await cli(["catalog", "geometries", "boxx"])).body.error?.code).toBe("notFound");
  });
});

describe("assets add <pack.zip>", () => {
  it("imports a Kenney pack zip with --source, --license, repeated --filter and --name", async () => {
    const dir = join(tmp(), "game");
    await ok(["new", dir, "--target", "game"]);
    const zip = join(tmp(), "kenney_platformer-kit.zip");
    writeFileSync(
      zip,
      writeZipStored({
        "kenney_platformer-kit/Models/GLB format/coin-gold.glb": new Uint8Array([1]),
        "kenney_platformer-kit/Models/GLB format/flag.glb": new Uint8Array([2]),
        "kenney_platformer-kit/Models/GLB format/tree.glb": new Uint8Array([3]),
        "kenney_platformer-kit/Models/FBX format/coin-gold.fbx": new Uint8Array([4]),
      }),
    );
    const r = await ok(["assets", "add", zip, "--source", "kenney", "--license", "CC0-1.0", "--filter", "coin", "--filter", "flag", "--name", "platformer", "--project", dir]);
    expect(r.models.sort()).toEqual(["assets/models/platformer/coin-gold.glb", "assets/models/platformer/flag.glb"]);
    const list = await ok(["assets", "list", "--project", dir]);
    expect(list.assets.find((a: { path: string }) => a.path === "assets/models/platformer/flag.glb")).toMatchObject({ source: "kenney", license: "CC0-1.0", author: "Kenney" });
    expect((await cli(["assets", "add", zip, "--source", "kenney", "--project", dir])).code).toBe(2);
  });
});

describe("project workflow (new → validate → patch → check)", () => {
  it("creates, edits and checks a project", async () => {
    const dir = join(tmp(), "banner");
    const created = await ok(["new", dir, "--target", "banner", "--title", "Spring sale"]);
    expect(created.target).toMatchObject({ kind: "banner" });
    expect(created.files).toEqual(expect.arrayContaining(["agent3d.json", "scene.json"]));
    expect((await cli(["new", dir])).body.error?.code).toBe("conflict");

    const v = await cli(["scene", "validate", "--project", dir]);
    expect(v.code).toBe(0);
    expect(v.body.data.valid).toBe(true);

    // Global --project before the command.
    const summary = await ok(["--project", dir, "scene", "summary"]);
    expect(summary).toBeTruthy();

    // Add an object with shortcuts, change one key, read it back.
    const add = await ok(["object", "add", "--project", dir, "--id", "orb", "--geometry", "icosahedron", "--set", "position=[0,1,0]", "--set", "material.color=#ff3366"]);
    expect(add.applied).toBe(true);
    expect(add.plan.objects.added).toEqual(["orb"]);
    await ok(["object", "update", "orb", "--project", dir, "--set", "material.roughness=0.2"]);
    const orb = await ok(["object", "get", "orb", "--project", dir]);
    expect(orb.object).toMatchObject({ id: "orb", kind: "mesh", geometry: { type: "icosahedron" }, position: [0, 1, 0], material: { color: "#ff3366", roughness: 0.2 } });
    expect((await ok(["object", "list", "--project", dir])).objects.map((o: { id: string }) => o.id)).toContain("orb");

    // Patch from a file; invalid patch → exit 2 with issues, nothing written.
    const ops = join(dir, "..", "ops.json");
    writeFileSync(ops, JSON.stringify([{ op: "set", path: "objects#orb.geometry.detail", value: 2 }]));
    expect((await ok(["scene", "patch", "--project", dir, "--file", ops])).applied).toBe(true);
    const before = readFileSync(join(dir, "scene.json"), "utf8");
    writeFileSync(ops, JSON.stringify([{ op: "set", path: "objects#orb.geometry.type", value: "blob" }]));
    const bad = await cli(["scene", "patch", "--project", dir, "--file", ops]);
    expect(bad.code).toBe(2);
    expect(bad.body.error).toMatchObject({ code: "validation", details: { issues: expect.any(Array) } });
    expect(readFileSync(join(dir, "scene.json"), "utf8")).toBe(before);

    // Replacing a whole collection with set needs --yes, like a removal.
    const objs = JSON.parse(before).objects.map((o: { id: string }) => ({ ...o, visible: true }));
    writeFileSync(ops, JSON.stringify([{ op: "set", path: "objects", value: objs }]));
    const setPlan = await ok(["scene", "patch", "--project", dir, "--file", ops]);
    expect(setPlan).toMatchObject({ needsConfirmation: true, plan: { replaces: [{ opIndex: 0, path: "objects", items: objs.length }] } });
    expect(readFileSync(join(dir, "scene.json"), "utf8")).toBe(before);

    // Removing needs --yes.
    const plan = await ok(["object", "remove", "orb", "--project", dir]);
    expect(plan).toMatchObject({ needsConfirmation: true, plan: { objects: { removed: ["orb"] } } });
    expect(readFileSync(join(dir, "scene.json"), "utf8")).toBe(before);
    expect((await ok(["object", "remove", "orb", "--project", dir, "--yes"])).applied).toBe(true);

    // scene apply: plan unless --yes.
    const scene = JSON.parse(readFileSync(join(dir, "scene.json"), "utf8"));
    scene.title = "Summer sale";
    writeFileSync(join(dir, "..", "next.json"), JSON.stringify(scene));
    expect((await ok(["scene", "apply", "--project", dir, "--file", join(dir, "..", "next.json")])).needsConfirmation).toBe(true);
    expect((await ok(["scene", "apply", "--project", dir, "--file", join(dir, "..", "next.json"), "--yes"])).applied).toBe(true);
    expect((await ok(["scene", "get", "--project", dir, "--path", "title"])).value).toBe("Summer sale");

    // Timeline.
    await ok(["timeline", "set", "--project", dir, "--duration", "3", "--loop", "true"]);
    const firstId = (await ok(["object", "list", "--project", dir])).objects[0]?.id;
    if (firstId) {
      await ok(["timeline", "add-track", "--project", dir, "--target", `${firstId}.rotation.y`, "--keys", "[[0,0],[3,360]]"]);
      expect((await ok(["timeline", "get", "--project", dir])).timeline.tracks.length).toBeGreaterThan(0);
    }

    const check = await cli(["check", "--project", dir]);
    expect(check.stdout).toHaveLength(1);
    expect(check.body.data).toMatchObject({ ok: expect.any(Boolean), budget: { estimatedTriangles: expect.any(Number) } });
    // AI tools through the CLI (same catalog as MCP).
    const tools = (await ok(["tools", "list"])).tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["scene_patch", "render_preview", "export"]));
    expect((await ok(["tools", "call", "scene_summary", "--project", dir])).result).toMatchObject({ title: "Summer sale" });
    expect((await cli(["tools", "call", "nope", "--project", dir])).code).toBe(2);

    const info = await ok(["info", "--project", dir]);
    expect(info.manifest.title).toBe("Spring sale");
  });
});

describe("option parsing", () => {
  it("parses scalars and dotted --set keys", () => {
    expect(parseScalar("42")).toBe(42);
    expect(parseScalar("#ff0000")).toBe("#ff0000");
    expect(parseScalar("[0,1,0]")).toEqual([0, 1, 0]);
    expect(parseScalar("00123")).toBe("00123");
    expect(setPairs({ set: ["material.color=#fff", "material.roughness=0.5", "position=[1,2,3]"] })).toEqual({ material: { color: "#fff", roughness: 0.5 }, position: [1, 2, 3] });
  });
});
