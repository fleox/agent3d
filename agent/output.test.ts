import { describe, expect, it } from "vitest";
import { OpsError } from "../src/ops/context";
import { cliHint, printError, withCliHints } from "./output";

describe("CLI hints name commands, not AI tools", () => {
  it("translates tool names", () => {
    expect(cliHint("Use scene_summary to see the structure.")).toBe("Use `agent3d scene summary` to see the structure.");
    expect(cliHint("List ids with object_list.")).toBe("List ids with `agent3d object list`.");
    expect(cliHint("Look up params with catalog_get.")).toBe("Look up params with `agent3d catalog`.");
  });
  it("keeps the CLI part of mixed hints", () => {
    expect(cliHint("List the library with library_list (CLI: agent3d assets library --query <word>).")).toBe("List the library with `agent3d assets library --query <word>`.");
    expect(cliHint("Add it with assets_add / `agent3d assets add`, or fix it (assets_list).")).toBe("Add it with `agent3d assets add`, or fix it (`agent3d assets list`).");
    expect(cliHint("Download it first (assets_search + assets_add, CLI: agent3d assets search|add) and use it.")).toBe("Download it first (`agent3d assets search|add`) and use it.");
  });
  it("leaves other text alone", () => {
    expect(cliHint("Run `agent3d check` again.")).toBe("Run `agent3d check` again.");
  });
  it("rewrites nested result hints and ops errors", () => {
    expect(withCliHints({ issues: [{ code: "x", hint: "see scene_summary", message: "scene_summary stays" }] })).toEqual({ issues: [{ code: "x", hint: "see `agent3d scene summary`", message: "scene_summary stays" }] });
    let out = "";
    printError({ json: true, out: (t) => void (out += t), err: () => undefined }, new OpsError("notFound", "nope", "Use object_list."));
    expect(JSON.parse(out).error.hint).toBe("Use `agent3d object list`.");
  });
});
