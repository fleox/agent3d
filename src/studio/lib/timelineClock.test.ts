import { describe, expect, it } from "vitest";
import { rangeTime as rtRange, resolveSegment } from "../../runtime/timeline/controller";
import { defaultScene } from "../../core/validate";
import type { SceneDoc } from "../../core/types";
import { editingScene, rangeTime, sceneTimeFor, segmentRange, timelineTime } from "./timelineClock";

const scene = (tl: Partial<SceneDoc["timeline"]>): SceneDoc => ({ ...defaultScene(), timeline: { duration: 4, tracks: [], ...tl } as SceneDoc["timeline"] });

describe("studio timeline clock", () => {
  it("honours speed and loop", () => {
    expect(timelineTime(1, scene({ speed: 2 }))).toBe(2);
    expect(timelineTime(3, scene({ speed: 2, loop: true }))).toBe(2);
    expect(timelineTime(3, scene({ speed: 2 }))).toBe(4);
    expect(timelineTime(5, scene({ loop: "pingpong" }))).toBe(3);
    expect(sceneTimeFor(2, scene({ speed: 2 }))).toBe(1);
    expect(sceneTimeFor(9, scene({}))).toBe(4);
    expect(timelineTime(2, null)).toBe(2);
  });
  it("plays segments (markers, reverse ranges, speed) like the runtime", () => {
    const s = scene({ markers: { open: 1, end: 3 }, segments: { intro: { from: "open", to: "end", speed: 2 }, back: [3, 1], spin: { from: 0, to: 2, loop: true } } });
    const tl = s.timeline!;
    for (const name of ["intro", "back", "spin", "timeline"]) {
      const mine = segmentRange(tl, name)!;
      const theirs = resolveSegment(tl, name)!;
      expect(mine).toEqual(theirs);
      for (const e of [0, 0.3, 0.9, 1.7, 5]) expect(rangeTime(mine, e)).toBeCloseTo(rtRange(theirs, e), 9);
    }
    expect(timelineTime(10.5, s, { range: segmentRange(tl, "intro")!, start: 10 })).toBe(2);
    expect(segmentRange(tl, "nope")).toBeNull();
  });
  it("edits with the whole timeline from load", () => {
    const s = scene({ trigger: "click", autoplay: "intro", speed: 2 });
    expect(editingScene(s).timeline).toMatchObject({ trigger: "load", speed: 2 });
    expect(editingScene(s).timeline).not.toHaveProperty("autoplay");
    const plain = scene({});
    expect(editingScene(plain)).toBe(plain);
    // Game scripts never run while editing (interact mode runs them).
    const game = { ...plain, scripts: ["scripts/game.js"] };
    expect(editingScene(game)).not.toHaveProperty("scripts");
    expect(game.scripts).toEqual(["scripts/game.js"]);
  });
});
