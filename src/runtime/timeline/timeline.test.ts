import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { EaseName } from "../../core/types";
import { EASINGS, ease } from "./easing";
import { bindTrack, createTimeline } from "./index";
import { interpolate, sampleKeys, splitTarget, timelineTime } from "./sample";

describe("easing", () => {
  it("every easing maps 0→0 and 1→1", () => {
    for (const name of Object.keys(EASINGS) as EaseName[]) {
      expect(ease(name, 0), name).toBeCloseTo(0, 6);
      expect(ease(name, 1), name).toBeCloseTo(1, 6);
    }
  });
  it("clamps input and shapes the curve", () => {
    expect(ease("linear", 2)).toBe(1);
    expect(ease("inQuad", 0.5)).toBeCloseTo(0.25);
    expect(ease("outQuad", 0.5)).toBeCloseTo(0.75);
    expect(ease("outBack", 0.6)).toBeGreaterThan(1);
    expect(ease("step", 0.99)).toBe(0);
    expect(ease("unknown" as EaseName, 0.3)).toBeCloseTo(0.3);
  });
});

describe("timelineTime", () => {
  it("clamps without loop", () => expect(timelineTime(5, 2, false)).toBe(2));
  it("wraps with loop", () => expect(timelineTime(5, 2, true)).toBeCloseTo(1));
  it("ping-pongs", () => {
    expect(timelineTime(1, 2, "pingpong")).toBeCloseTo(1);
    expect(timelineTime(3, 2, "pingpong")).toBeCloseTo(1);
    expect(timelineTime(4.5, 2, "pingpong")).toBeCloseTo(0.5);
  });
});

describe("sampleKeys", () => {
  it("interpolates numbers with the track easing", () => {
    expect(sampleKeys([[0, 0], [2, 10]], 1)).toBeCloseTo(5);
    expect(sampleKeys([[0, 0], [2, 10]], 1, "inQuad")).toBeCloseTo(2.5);
    expect(sampleKeys([[0, 0], [2, 10]], -1)).toBe(0);
    expect(sampleKeys([[0, 0], [2, 10]], 9)).toBe(10);
  });
  it("interpolates vec3 and promotes numbers", () => {
    expect(sampleKeys([[0, [0, 0, 0]], [1, [2, 4, 6]]], 0.5)).toEqual([1, 2, 3]);
    expect(interpolate(1, [3, 3, 3], 0.5)).toEqual([2, 2, 2]);
  });
  it("interpolates colours in linear space", () => {
    const c = sampleKeys([[0, "#000000"], [1, "#ffffff"]], 0.5) as THREE.Color;
    expect(c.r).toBeCloseTo(0.5);
    expect(c.getHexString()).toBe("bcbcbc"); // linear 0.5 → sRGB ≈ #bc
  });
  it("steps booleans", () => {
    expect(sampleKeys([[0, false], [1, true]], 0.99)).toBe(false);
    expect(sampleKeys([[0, false], [1, true]], 1)).toBe(true);
  });
  it("splits targets", () => {
    expect(splitTarget("logo.material.color")).toEqual({ id: "logo", path: "material.color" });
    expect(splitTarget("camera.position")).toEqual({ id: "camera", path: "position" });
  });
});

describe("track binding", () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const light = new THREE.PointLight(0xffffff, 1);
  const cam = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 45 };
  const host = { object: (id: string) => (id === "box" ? mesh : id === "lamp" ? light : null), camera: cam, issue: () => undefined };
  it("rotation in degrees, scale uniform, material props, light props, camera", () => {
    bindTrack({ target: "box.rotation.y", keys: [] }, host)!(90);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    bindTrack({ target: "box.scale", keys: [] }, host)!(2);
    expect(mesh.scale.toArray()).toEqual([2, 2, 2]);
    bindTrack({ target: "box.material.opacity", keys: [] }, host)!(0.5);
    expect((mesh.material as THREE.Material).opacity).toBe(0.5);
    expect((mesh.material as THREE.Material).transparent).toBe(true);
    bindTrack({ target: "lamp.intensity", keys: [] }, host)!(7);
    expect(light.intensity).toBe(7);
    bindTrack({ target: "camera.position", keys: [] }, host)!([1, 2, 3]);
    expect(cam.position.toArray()).toEqual([1, 2, 3]);
    bindTrack({ target: "camera.fov", keys: [] }, host)!(30);
    expect(cam.fov).toBe(30);
  });
  it("reports unknown targets", () => {
    const issues: string[] = [];
    expect(bindTrack({ target: "ghost.position", keys: [] }, { ...host, issue: (_c, m) => issues.push(m) })).toBeNull();
    expect(issues.length).toBe(1);
  });
  it("applies a whole timeline", () => {
    const tl = createTimeline({ duration: 2, tracks: [{ target: "box.position.x", keys: [[0, 0], [2, 4]] }] }, host);
    tl.apply(1);
    expect(mesh.position.x).toBeCloseTo(2);
    expect([...tl.targets]).toEqual(["box"]);
  });
});
