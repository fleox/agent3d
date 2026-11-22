import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { projectPath, renderFrames } from "./render";
import { timelineCommand } from "./scene";

describe("render command helpers", () => {
  it("resolves relative output / media paths against the project folder", () => {
    expect(projectPath("/work/my-banner", "renders/a.mp4")).toBe(resolve("/work/my-banner", "renders/a.mp4"));
    expect(projectPath("/work/my-banner", "/tmp/a.gif")).toBe("/tmp/a.gif");
  });
  it("renders one frame for a --scroll position unless --frames / --count ask for more", () => {
    expect(renderFrames(undefined, undefined, 0.5)).toBe("0");
    expect(renderFrames("1,2", undefined, 0.5)).toBe("1,2");
    expect(renderFrames(undefined, 8, 0.5)).toBeUndefined();
    expect(renderFrames(undefined, undefined, undefined)).toBeUndefined();
  });
  it("timeline set --trigger help lists manual", () => {
    const set = timelineCommand.subcommands?.find((s) => s.name === "set");
    expect(set?.usage).toContain("manual");
    expect(timelineCommand.options?.find((o) => o.name === "trigger")?.description).toContain("manual");
  });
});

describe("export --size help", async () => {
  const { exportCommand } = await import("./render");
  it("states the real default sizes (video 960 wide)", () => {
    const d = exportCommand.options?.find((o) => o.name === "size")?.description ?? "";
    expect(d).toContain("960 for a video");
    expect(d).toContain("640 for a gif");
  });
});
