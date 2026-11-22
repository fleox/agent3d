import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import { createProject } from "./project";
import { editTimeline, getInteractions, getTimeline, setInteractions } from "./timeline";

async function project() {
  const fs = new MemoryFs();
  await createProject(fs, { name: "Motion", target: { kind: "banner" } });
  return fs;
}

describe("timeline ops", () => {
  it("merges markers and segments, creating the timeline when needed", async () => {
    const fs = await project();
    await editTimeline(fs, { removeTargets: ["x.y"] }).catch(() => undefined);
    const r = await editTimeline(fs, { settings: { duration: 3, trigger: "manual" }, markers: { mid: 1.5 }, segments: { intro: { from: 0, to: "mid" } } });
    expect(r.applied).toBe(true);
    let tl = await getTimeline(fs);
    expect(tl?.markers).toEqual({ mid: 1.5 });
    expect(tl?.segments).toEqual({ intro: { from: 0, to: "mid" } });
    await editTimeline(fs, { markers: { end: 3 }, segments: { out: [1.5, 3] } });
    tl = await getTimeline(fs);
    expect(Object.keys(tl!.markers!)).toEqual(["mid", "end"]);
    expect(tl!.duration).toBe(3);
  });
  it("sets, appends and removes interactions (validated)", async () => {
    const fs = await project();
    const scene = JSON.parse(await fs.readText("scene.json"));
    const id = scene.objects[0].id as string;
    let r = await setInteractions(fs, { add: [{ on: "click", target: id, do: [{ emit: "hello" }] }] });
    expect(r.applied).toBe(true);
    r = await setInteractions(fs, { add: [{ on: "hover", target: id, do: [{ openUrl: "https://x.example" }] }] });
    expect(r.applied).toBe(false); // openUrl on hover is refused
    expect((await getInteractions(fs)).length).toBe(1);
    await setInteractions(fs, { interactions: null });
    expect(await getInteractions(fs)).toEqual([]);
  });
});
