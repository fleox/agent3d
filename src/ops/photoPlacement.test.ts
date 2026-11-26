import { describe, expect, it } from "vitest";
import { photoDepthToZ } from "../core/photoDepth";
import type { SceneDoc } from "../core/types";
import { photoDepthIssues, photoPlacements } from "./photoPlacement";
import { summarizeScene } from "./scene";

const scene = (photo: Record<string, unknown>, more: unknown[] = []): SceneDoc =>
  ({
    version: 1,
    id: "s",
    title: "S",
    target: { kind: "hero", aspect: "16:9" },
    camera: { type: "perspective", fov: 35, position: [0, 0, 10], target: [0, 0, 0] },
    environment: { background: "#000000" },
    lights: [],
    objects: [{ id: "photo", kind: "photo", src: "assets/a.jpg", depth: "assets/d.png", width: 12, strength: 0.8, focus: 0.4, ...photo }, ...more],
  }) as SceneDoc;

describe("photo placement", () => {
  it("reports the world z of the far / near photo pixels (camera distance from the scene)", () => {
    const [p] = photoPlacements(scene({ position: [0, 0, -1] }));
    const params = { strength: 0.8, width: 12, focus: 0.4, cameraDistance: 11 };
    expect(p.zFocus).toBe(-1);
    expect(p.zFar).toBeCloseTo(-1 + photoDepthToZ(0, params), 2);
    expect(p.zNear).toBeCloseTo(-1 + photoDepthToZ(1, params), 2);
    expect(photoPlacements(scene({ depth: undefined }))).toEqual([]);
  });

  it("scene_summary carries depthRange on depth photos", () => {
    const sum = summarizeScene(scene({ occlude: true }));
    const photo = sum.objects[0];
    expect(photo.depthRange?.[0]).toBeLessThan(0);
    expect(photo.depthRange?.[1]).toBeGreaterThan(0);
    expect(photo.detail).toContain("occlude");
  });

  it("check: suggests occlude for objects inside the photo depth, tells the range when on", () => {
    const title = { id: "title", kind: "text", text: "Hi", position: [0, 1, 0.3] };
    expect(photoDepthIssues(scene({}, [title])).map((i) => i.code)).toEqual(["photo-occlude"]);
    expect(photoDepthIssues(scene({}, [{ ...title, position: [0, 1, 4] }]))).toEqual([]); // in front of everything
    expect(photoDepthIssues(scene({ occlude: true }, [title])).map((i) => i.code)).toEqual(["photo-depth-range"]);
    expect(photoDepthIssues(scene({ occlude: true })).map((i) => i.code)).toEqual(["ignored"]);
  });
});
