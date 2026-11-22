import { describe, expect, it } from "vitest";
import { defaultMedia, mediaInput } from "./MediaOptions";

describe("media options → export tool input", () => {
  it("maps every kind to the export tool formats", () => {
    expect(mediaInput(defaultMedia("mp4"), "renders/a.mp4")).toEqual({ format: "video", codec: "mp4", out: "renders/a.mp4" });
    expect(mediaInput({ ...defaultMedia("webm"), fps: 24, duration: 3, quality: "high", width: 640, height: 360 }, "renders/a.webm")).toEqual({ format: "video", codec: "webm", fps: 24, duration: 3, quality: "high", size: "640x360", out: "renders/a.webm" });
    expect(mediaInput({ ...defaultMedia("gif"), transparent: true }, "renders/a.gif")).toEqual({ format: "gif", transparent: true, out: "renders/a.gif" });
    expect(mediaInput(defaultMedia("webp"), "renders/a.webp")).toMatchObject({ format: "animated-webp" });
    expect(mediaInput({ ...defaultMedia("poster"), image: "png", time: 1, quality: "ultra" }, "dist/poster.png")).toEqual({ format: "poster", image: "png", time: 1, quality: "ultra", out: "dist/poster.png" });
  });
});
