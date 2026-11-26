import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loopFrames, parseFit, presetOpt, projectPath, renderCommand, renderFrames } from "./render";
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

describe("social video flags (--preset / --fit)", () => {
  it("parses presets case-insensitively and suggests the closest one", () => {
    expect(presetOpt(undefined)).toBeUndefined();
    expect(presetOpt("vertical")).toBe("vertical");
    expect(presetOpt("Square")).toBe("square");
    expect(presetOpt("story")).toBe("story");
    expect(() => presetOpt("verticle")).toThrow(/Unknown video preset/);
    try {
      presetOpt("verticle");
    } catch (e) {
      expect((e as { hint?: string }).hint).toContain('"vertical"');
      expect((e as { exitCode?: number; code?: string }).code).toBe("usage");
    }
  });
  it("parses --fit", () => {
    expect(parseFit(undefined)).toBeUndefined();
    expect(parseFit("cover")).toBe("cover");
    expect(parseFit("contain")).toBe("contain");
    expect(() => parseFit("fill")).toThrow(/--fit must be cover or contain/);
  });
  it("spreads preview frames over one loop", () => {
    expect(loopFrames(0, 10, undefined)).toBe("0,2.5,5,7.5");
    expect(loopFrames(5, 5, 2)).toBe("5,7.5");
  });
  it("documents the flags on render and export", async () => {
    const { exportCommand } = await import("./render");
    expect(renderCommand.usage).toContain("--preset vertical|square|landscape|story");
    expect(renderCommand.options?.find((o) => o.name === "preset")?.description).toContain("1080x1920");
    expect(exportCommand.options?.find((o) => o.name === "preset")?.description).toContain("video-<preset>.mp4");
  });
});
