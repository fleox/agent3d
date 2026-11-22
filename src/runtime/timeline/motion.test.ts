import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EASE_NAMES, parseEase } from "../../core/ease";
import type { TimelineDef } from "../../core/types";
import { TimelineController, rangeTime, resolveSegment } from "./controller";
import { cubicBezier, ease, easeFn, spring, steps } from "./easing";
import { bindTrack, createTimeline, type TimelineHost } from "./index";
import { InteractionRunner, safeUrl, type InteractionHost } from "./interactions";
import { PropertyOverrides } from "./overrides";
import { resolveKeys, sampleKeys, staggerOrder } from "./sample";
import { scrollProgressFor } from "./scroll";
import { evaluateShots } from "./shots";

describe("easing set", () => {
  it("has every family × in/out/inOut and maps 0→0, 1→1", () => {
    expect(EASE_NAMES.length).toBe(32);
    for (const n of [...EASE_NAMES, "cubicBezier(0.22, 1, 0.36, 1)", "spring", "spring(300, 10)", "steps(4)", "steps(3, start)"]) {
      expect(ease(n, 0), n).toBeCloseTo(0, 5);
      expect(ease(n, 1), n).toBeCloseTo(1, 5);
    }
  });
  it("cubicBezier matches CSS ease and linear", () => {
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 4);
    // CSS "ease" at x = 0.5 ≈ 0.8024
    expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
  });
  it("springs overshoot with low damping and are monotonic when overdamped", () => {
    const bouncy = spring(200, 6);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => bouncy(i / 100)))).toBeGreaterThan(1.05);
    const stiff = spring(100, 40);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = stiff(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it("steps quantise", () => {
    expect(steps(4)(0.3)).toBe(0.25);
    expect(steps(4, true)(0.3)).toBe(0.5);
  });
  it("parses and rejects specs", () => {
    expect(parseEase("spring(170, 18)")).toEqual({ kind: "spring", stiffness: 170, damping: 18, mass: 1 });
    expect("error" in parseEase("cubicBezier(2, 0, 1, 1)")).toBe(true);
    expect("error" in parseEase("bouncy")).toBe(true);
    expect(easeFn("nope")(0.4)).toBeCloseTo(0.4);
  });
  it("inOut families are symmetric", () => {
    for (const f of ["Quad", "Cubic", "Quart", "Quint", "Sine", "Expo", "Circ"]) expect(ease(`inOut${f}`, 0.5), f).toBeCloseTo(0.5, 5);
  });
});

describe("keys: per-key ease, relative values, stagger", () => {
  it("uses the ease of the key ending the segment", () => {
    expect(sampleKeys([[0, 0], [1, 10, "inQuad"], [2, 20]], 0.5)).toBeCloseTo(2.5);
    expect(sampleKeys([[0, 0], [1, 10, "inQuad"], [2, 20]], 1.5)).toBeCloseTo(15);
  });
  it("resolves relative values against the base", () => {
    expect(resolveKeys([[0, "-=1"], [1, "+=0"]], 2)).toEqual([[0, 1], [1, 2]]);
    expect(resolveKeys([[0, ["+=0", "-=2", 5]]], [1, 3, 0])).toEqual([[0, [1, 1, 5]]]);
    expect(resolveKeys([[0, "*=2"]], [1, 2, 3])).toEqual([[0, [2, 4, 6]]]);
  });
  it("orders staggers", () => {
    expect(staggerOrder(4, "start")).toEqual([0, 1, 2, 3]);
    expect(staggerOrder(4, "end")).toEqual([3, 2, 1, 0]);
    expect(staggerOrder(5, "center")).toEqual([2, 1, 0, 1, 2]);
    expect(staggerOrder(5, "random", 3).slice().sort()).toEqual([0, 1, 2, 3, 4]);
  });
  it("binds a multi-target selector with stagger and relative keys", () => {
    const objs = new Map(["a", "b", "c"].map((id) => [id, Object.assign(new THREE.Object3D(), { name: id })] as const));
    objs.forEach((o, id) => o.position.set(0, id === "b" ? 1 : 0, 0));
    const host: TimelineHost = { object: (id) => objs.get(id) ?? null, select: () => ["a", "b", "c"], camera: null, issue: () => undefined };
    const tl = createTimeline({ duration: 2, tracks: [{ target: "tag:letter.position.y", keys: [[0, "-=1"], [1, "+=0"]], stagger: 0.5 }] }, host);
    tl.apply(0.5);
    expect(objs.get("a")!.position.y).toBeCloseTo(-0.5);
    expect(objs.get("b")!.position.y).toBeCloseTo(0); // starts at 0.5: rest 1 - 1
    expect(objs.get("c")!.position.y).toBeCloseTo(-1);
    tl.apply(2);
    expect(objs.get("c")!.position.y).toBeCloseTo(0);
    expect([...tl.targets].sort()).toEqual(["a", "b", "c"]);
  });
  it("animates environment and postfx targets", () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 1, 10);
    const fx: [string, string, unknown][] = [];
    const host: TimelineHost = { object: () => null, camera: null, scene, issue: () => undefined, postfx: { set: (a, b, c) => fx.push([a, b, c]), base: () => 0.5 } };
    bindTrack({ target: "environment.fog.far", keys: [] }, host)[0].set(40);
    expect((scene.fog as THREE.Fog).far).toBe(40);
    bindTrack({ target: "environment.lightingIntensity", keys: [] }, host)[0].set(2);
    expect(scene.environmentIntensity).toBe(2);
    const b = bindTrack({ target: "postfx.bloom.strength", keys: [[0, "+=1"], [1, 0]] }, host)[0];
    expect(b.keys[0][1]).toBeCloseTo(1.5);
    b.set(0.7);
    expect(fx).toEqual([["bloom", "strength", 0.7]]);
  });
});

const tl = (over: Partial<TimelineDef> = {}): TimelineDef => ({ duration: 4, tracks: [], ...over });
const frame = (t: number, over = {}) => ({ t, dt: 1 / 60, deterministic: true, staticMotion: false, hovered: false, clicked: false, scroll: 0, ...over });

describe("timeline controller", () => {
  it("plays with speed and loops", () => {
    const c = new TimelineController(tl({ speed: 2, loop: true }));
    expect(c.update(frame(1))).toBeCloseTo(2);
    expect(c.update(frame(3))).toBeCloseTo(2);
  });
  it("resolves segments with markers and plays them (also reversed)", () => {
    const def = tl({ markers: { a: 1, b: 3 }, segments: { mid: { from: "a", to: "b" }, back: [3, 1] } });
    expect(resolveSegment(def, "mid")).toMatchObject({ from: 1, to: 3 });
    const c = new TimelineController({ ...def, trigger: "manual" });
    expect(c.update(frame(0.5))).toBe(0);
    c.play("mid", 1);
    expect(c.update(frame(2))).toBeCloseTo(2);
    expect(c.update(frame(5))).toBeCloseTo(3);
    c.play("mid", 5, { reverse: true });
    expect(c.update(frame(5.5))).toBeCloseTo(2.5);
    expect(rangeTime({ from: 3, to: 1, loop: false, speed: 1 }, 1)).toBeCloseTo(2);
  });
  it("autoplays a named segment", () => {
    const c = new TimelineController(tl({ autoplay: "intro", segments: { intro: [0, 2] } }));
    expect(c.update(frame(1))).toBeCloseTo(1);
    expect(c.update(frame(10))).toBeCloseTo(2);
  });
  it("toggles forward then backward from where it is", () => {
    const c = new TimelineController(tl({ trigger: "manual", segments: { open: [0, 1] } }));
    c.toggle("open", 0);
    expect(c.update(frame(0.5))).toBeCloseTo(0.5);
    c.toggle("open", 0.5);
    expect(c.update(frame(0.75))).toBeCloseTo(0.25);
  });
  it("emits markers crossed forward and backward", () => {
    const c = new TimelineController(tl({ markers: { hit: 1.5 } }));
    c.update(frame(1));
    expect(c.drainMarkers()).toEqual([]);
    c.update(frame(2));
    expect(c.drainMarkers()).toEqual([{ name: "hit", time: 1.5 }]);
    c.update(frame(3));
    expect(c.drainMarkers()).toEqual([]);
  });
  it("maps scroll to the range", () => {
    const c = new TimelineController(tl({ trigger: "scroll" }));
    expect(c.update(frame(0, { scroll: 0.25 }))).toBeCloseTo(1);
  });
});

describe("scroll progress", () => {
  it("defaults to top bottom → bottom top", () => {
    expect(scrollProgressFor(800, 400, 800)).toBe(0);
    expect(scrollProgressFor(-400, 400, 800)).toBe(1);
    expect(scrollProgressFor(200, 400, 800)).toBeCloseTo(0.5);
  });
  it("supports custom positions", () => {
    // Pinned-like: 0 when the top reaches the viewport top, 1 when the bottom reaches the bottom.
    expect(scrollProgressFor(0, 2000, 800, "top top", "bottom bottom")).toBe(0);
    expect(scrollProgressFor(-600, 2000, 800, "top top", "bottom bottom")).toBeCloseTo(0.5);
    expect(scrollProgressFor(400, 400, 800, "center center", "50% top")).toBeCloseTo(0);
  });
});

describe("camera shots", () => {
  const base = { position: new THREE.Vector3(0, 0, 10), target: new THREE.Vector3(), fov: 40 };
  const host = { objectPosition: (id: string) => (id === "hero" ? new THREE.Vector3(2, 0, 0) : null) };
  it("chains dolly → orbit → zoom", () => {
    const shots = [
      { type: "dolly" as const, at: 0, duration: 1, distance: 4, ease: "linear" as const },
      { type: "orbit" as const, at: 1, duration: 1, angle: 90, ease: "linear" as const },
      { type: "zoom" as const, at: 2, duration: 1, fov: 20 },
    ];
    expect(evaluateShots(shots, 0.5, base, host).position.z).toBeCloseTo(8);
    const p = evaluateShots(shots, 2, base, host).position;
    expect(p.x).toBeCloseTo(6);
    expect(p.z).toBeCloseTo(0);
    expect(evaluateShots(shots, 3, base, host).fov).toBeCloseTo(20);
    expect(base.position.z).toBe(10); // base untouched
  });
  it("follows a path looking ahead and pans to objects", () => {
    const path = [{ type: "path" as const, at: 0, duration: 2, points: [[5, 0, 5], [10, 0, 0]] as [number, number, number][] }];
    expect(evaluateShots(path, 2, base, host).position.toArray()).toEqual([10, 0, 0]);
    const look = [{ type: "lookAt" as const, at: 0, duration: 1, object: "hero" }];
    expect(evaluateShots(look, 1, base, host).target.x).toBeCloseTo(2);
    const focus = [{ type: "focus" as const, at: 0, duration: 1, object: "hero" }];
    expect(evaluateShots(focus, 1, { ...base, focus: 3 }, host).focus).toBeCloseTo(Math.hypot(2, 10));
  });
});

describe("interactions", () => {
  const log: unknown[][] = [];
  const host: InteractionHost = {
    play: (...a) => log.push(["play", ...a]),
    toggle: (...a) => log.push(["toggle", ...a]),
    seek: (...a) => log.push(["seek", ...a]),
    set: (...a) => log.push(["set", ...a]),
    emit: (...a) => log.push(["emit", ...a]),
    openUrl: (...a) => log.push(["openUrl", ...a]),
    playClip: (...a) => log.push(["playClip", ...a]),
  };
  const base = { hovered: new Set<string>(), pointerInside: false, clicked: new Set<string>(), canvasClicked: false, pressed: new Set<string>(), scroll: 0, visible: true, userGesture: true };
  it("fires hover / hoverEnd / click / key / scroll / event", () => {
    log.length = 0;
    const r = new InteractionRunner(
      [
        { on: "hover", target: "box", do: [{ play: "hover-in" }] },
        { on: "hoverEnd", target: "box", do: [{ play: "hover-in", reverse: true }] },
        { on: "click", target: "box", do: [{ openUrl: "https://shop.example/p/1" }, { emit: "bought" }] },
        { on: "event", event: "bought", do: [{ set: { path: "box.material.color", value: "#ff0000" }, duration: 0.3 }] },
        { on: "key", key: "Space", do: [{ toggle: "open" }] },
        { on: "scroll", at: 0.5, once: true, do: [{ seek: "end" }] },
        { on: "visible", do: [{ playClip: "Wave", target: "robot" }] },
      ],
      host,
    );
    expect([...r.targets()]).toEqual(["box"]);
    r.step(base);
    r.step({ ...base, hovered: new Set(["box"]), pointerInside: true });
    r.step({ ...base, hovered: new Set(["box"]), pointerInside: true, clicked: new Set(["box"]), canvasClicked: true });
    r.event("bought");
    r.flush();
    r.step({ ...base, pressed: new Set(["Space"]), scroll: 0.6 });
    r.step({ ...base, scroll: 0.2 });
    r.step({ ...base, scroll: 0.7 });
    expect(log).toEqual([
      ["playClip", "robot", "Wave", { loop: undefined, speed: undefined, crossfade: undefined }],
      ["play", "hover-in", false],
      ["openUrl", "https://shop.example/p/1", undefined],
      ["emit", "bought", undefined],
      ["set", "box.material.color", "#ff0000", 0.3, undefined],
      ["play", "hover-in", true],
      ["toggle", "open"],
      ["seek", "end"],
    ]);
  });
  it("never opens URLs without a user gesture or from hover", () => {
    log.length = 0;
    const r = new InteractionRunner([{ on: "click", do: [{ openUrl: "https://a.example" }] }, { on: "hover", do: [{ openUrl: "https://b.example" }] }], host);
    r.step({ ...base, canvasClicked: true, pointerInside: true, userGesture: false });
    expect(log.map((l) => l[0])).toEqual(["emit", "emit"]);
  });
  it("only allows http(s) URLs", () => {
    expect(safeUrl("https://x.example/a", "https://site.example/")).toBe("https://x.example/a");
    expect(safeUrl("/shop", "https://site.example/page")).toBe("https://site.example/shop");
    expect(safeUrl("javascript:alert(1)", "https://site.example/")).toBeNull();
    expect(safeUrl("data:text/html,x", "https://site.example/")).toBeNull();
  });
});

describe("property overrides", () => {
  it("tweens from the current value and restores on reset", () => {
    const o = new THREE.Object3D();
    o.position.set(0, 1, 0);
    const ov = new PropertyOverrides({ object: () => o, camera: null, issue: () => undefined });
    ov.set("box.position.y", "+=2", 0, 1, "linear");
    ov.apply(0.5);
    expect(o.position.y).toBeCloseTo(2);
    ov.apply(1);
    expect(o.position.y).toBeCloseTo(3);
    ov.reset();
    expect(o.position.y).toBeCloseTo(1);
  });
});

describe("colour interpolation spaces", () => {
  const sat = (c: THREE.Color) => {
    const hsl = { h: 0, s: 0, l: 0 };
    c.clone().convertLinearToSRGB().getHSL(hsl);
    return hsl.s;
  };
  it("blends orange → teal in OKLCh by default (no grey midpoint)", () => {
    const keys: [number, string][] = [[0, "#ff7a1a"], [1, "#14b8a6"]];
    const ok = sampleKeys(keys, 0.5) as THREE.Color;
    const rgb = sampleKeys(keys, 0.5, "linear", "rgb") as THREE.Color;
    expect(sat(ok)).toBeGreaterThan(sat(rgb) + 0.1);
    // End points are exact.
    expect((sampleKeys(keys, 0) as THREE.Color).getHexString()).toBe("ff7a1a");
    expect((sampleKeys(keys, 1) as THREE.Color).getHexString()).toBe("14b8a6");
    expect(sat(sampleKeys(keys, 0.5, "linear", "oklab") as THREE.Color)).toBeLessThan(sat(ok));
    expect((sampleKeys(keys, 0.9999, "linear", "oklab") as THREE.Color).getHexString()).toBe("14b8a6");
  });
  it("hsl goes the short way round the hue wheel", () => {
    const c = sampleKeys([[0, "#ff0000"], [1, "#ff00ff"]], 0.5, "linear", "hsl") as THREE.Color;
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    expect(hsl.h).toBeGreaterThan(0.8);
  });
});
