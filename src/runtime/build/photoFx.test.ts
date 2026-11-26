import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { bindTrack } from "../timeline/index";
import { autoLightPath, blurFocus, blurTaps, createPhotoFx, photoFxGlsl, resolvePhotoEffects, revealThreshold, type PhotoFxOptions } from "./photoFx";

const rgb = (c: string) => new THREE.Color(c).toArray() as [number, number, number];
const opts = (o: Partial<PhotoFxOptions> = {}): PhotoFxOptions => ({ depth: true, color: rgb, aspect: 16 / 9, ...o });
const still = { pointer: { x: 0, y: 0, inside: false }, reduced: false };

describe("photo effects (photoFx)", () => {
  it("adds nothing without effects (the photo shaders stay unchanged)", () => {
    const fx = createPhotoFx(undefined, opts());
    expect(fx.glsl).toBe("");
    expect(fx.call("pxUv", "d")).toBe("");
    expect(fx.alpha).toBe(false);
    expect(photoFxGlsl({}, true)).toBe("");
    expect(createPhotoFx({}, opts()).glsl).toBe("");
  });

  it("resolves defaults (linear colours) and drops depth-only effects on a flat photo", () => {
    const s = resolvePhotoEffects({ fog: {}, light: { color: "#ff0000" }, reveal: {} }, opts());
    expect(s.fog).toMatchObject({ amount: 0.6, start: 0.7, end: 0, drift: 0.3, color: [1, 1, 1] });
    expect(s.light).toMatchObject({ intensity: 1, ambient: 0.75, position: [0.4, 0.4], height: 0.6, radius: 0.8, relief: 1, follow: "pointer", color: [1, 0, 0] });
    expect(s.reveal).toMatchObject({ progress: 1, from: "far", softness: 0.15, delay: 0 });
    expect(s.reveal!.duration).toBeUndefined();
    const flat = resolvePhotoEffects({ fog: {}, light: {}, reveal: {} }, opts({ depth: false }));
    expect(Object.keys(flat)).toEqual(["light"]);
  });

  it("emits only the GLSL of the active effects, without the depth map on a flat photo", () => {
    const g = createPhotoFx({ fog: {} }, opts()).glsl;
    expect(g).toContain("uniform vec4 uFog;");
    expect(g).not.toContain("uLight");
    expect(g).not.toContain("uReveal");
    expect(createPhotoFx({ light: {} }, opts()).glsl).toContain("uDepth");
    expect(createPhotoFx({ light: {} }, opts({ depth: false })).glsl).not.toContain("uDepth");
    expect(createPhotoFx({ light: {} }, opts({ depth: false })).call("uv", "d")).toBe("c = photoFx(c, uv, 0.5, uv);");
    expect(createPhotoFx({ reveal: {} }, opts()).call("pxUv", "textureLod(uDepth, pxUv, 0.0).r", "vUv")).toBe("c = photoFx(c, pxUv, textureLod(uDepth, pxUv, 0.0).r, vUv);");
    expect(createPhotoFx({ reveal: {} }, opts()).alpha).toBe(true);
    // the light's normals read a smoothed depth (lower mips, noise floor): the depth texture needs mipmaps
    const lit = createPhotoFx({ light: {} }, opts());
    expect(lit.depthMips).toBe(true);
    expect(lit.glsl).toMatch(/textureLod\(uDepth, p, lod\)/);
    expect(lit.glsl).toContain("smoothstep(0.015, 0.05, length(sl))");
    expect(createPhotoFx({ fog: {} }, opts()).depthMips).toBe(false);
    expect(createPhotoFx({ light: {} }, opts({ depth: false })).depthMips).toBe(false);
  });

  it("reveal: threshold from progress, auto progress from duration / delay", () => {
    expect(revealThreshold(0, 0.15)).toBeCloseTo(-0.15);
    expect(revealThreshold(1, 0.15)).toBeCloseTo(1.15);
    const fx = createPhotoFx({ reveal: { duration: 2, delay: 1, from: "near" } }, opts());
    const at = (t: number, reduced = false) => (fx.frame(t, 0, { ...still, reduced }), fx.uniforms().uReveal);
    expect(at(0.5)[0]).toBeCloseTo(-0.15); // before the delay: hidden
    expect(at(2)[0]).toBeCloseTo(0.5); // halfway (smoothstep)
    expect(at(3.5)[0]).toBeCloseTo(1.15);
    expect(at(0.5, true)[0]).toBeCloseTo(1.15); // reduced motion: shown
    expect(at(2)[1]).toBe(1); // from near
  });

  it("light: follows the pointer, falls back to the auto path, fixed with follow none / reduced motion", () => {
    expect(autoLightPath([0.4, 0.4], 1, 0)).toEqual([0.4, 0.4]);
    const fx = createPhotoFx({ light: { position: [0.2, 0.1], height: 0.5, intensity: 2, color: "#ffffff" } }, opts());
    fx.frame(0, 0, { pointer: { x: -0.8, y: 0.6, inside: true }, reduced: false });
    let u = fx.uniforms();
    expect(u.uLightPos).toEqual([-0.8, 0.6, 0.5]);
    expect(u.uLightColor).toEqual([2, 2, 2]);
    fx.frame(3, 0, still);
    expect(fx.uniforms().uLightPos.slice(0, 2)).toEqual(autoLightPath([0.2, 0.1], 1, 3));
    fx.frame(3, 0, { ...still, reduced: true });
    expect(fx.uniforms().uLightPos.slice(0, 2)).toEqual([0.2, 0.1]);
    const fixed = createPhotoFx({ light: { follow: "none" } }, opts());
    fixed.frame(2, 0, { pointer: { x: 1, y: 1, inside: true }, reduced: false });
    u = fixed.uniforms();
    expect(u.uLightPos.slice(0, 2)).toEqual([0.4, 0.4]);
  });

  it("fog uniforms are deterministic functions of the params and time", () => {
    const fx = createPhotoFx({ fog: { amount: 0.5, start: 0.6, end: 0.1, drift: 0.2 } }, opts());
    fx.frame(1.5, 0, still);
    const u = fx.uniforms();
    expect(u.uFxTime).toEqual([1.5]);
    expect(u.uFog[0]).toBe(0.5);
    expect(u.uFog[2]).toBeCloseTo(2);
    // start === end: no division by zero
    const edge = createPhotoFx({ fog: { start: 0.4, end: 0.4 } }, opts());
    expect(Number.isFinite(edge.uniforms().uFog[2])).toBe(true);
  });

  it("get / set live params (timeline), incl. vec2 axes and colours", () => {
    const fx = createPhotoFx({ light: { follow: "none" }, fog: {} }, opts());
    fx.set("light", "position", [-0.5, 0.25]);
    fx.set("light", "position.y", 0.75);
    expect(fx.get("light", "position")).toEqual([-0.5, 0.75]);
    expect(fx.get("light", "position.x")).toBe(-0.5);
    expect(fx.set("fog", "amount", 0.2)).toBe(true);
    expect(fx.set("reveal", "progress", 0.2)).toBe(false); // not declared
    fx.set("fog", "color", [1, 0, 0]);
    fx.frame(0, 0, still);
    expect(fx.uniforms().uFogColor).toEqual([1, 0, 0]);
    expect(fx.uniforms().uFog[0]).toBe(0.2);
  });

  it("blur: defaults (focus from the photo), taps per quality tier, depth-aware only with a depth map", () => {
    const s = resolvePhotoEffects({ blur: {} }, { ...opts(), focus: 0.7 });
    expect(s.blur).toMatchObject({ focus: 0.7, amount: 0.6, range: 0.1, delay: 0 });
    expect(s.blur!.to).toBeUndefined();
    expect(resolvePhotoEffects({ blur: {} }, opts()).blur!.focus).toBe(0.5);
    expect(resolvePhotoEffects({ blur: {} }, opts({ depth: false })).blur).toBeDefined(); // works flat (even blur)
    expect([blurTaps("low"), blurTaps("medium"), blurTaps("high"), blurTaps("ultra"), blurTaps(undefined)]).toEqual([8, 12, 16, 16, 16]);
    const g = createPhotoFx({ blur: {} }, opts({ quality: "low" })).glsl;
    expect(g).toContain("uniform vec4 uBlur;");
    expect(g).toContain("i < 8;");
    expect(g).toContain("textureLod(uDepth, p, 0.0)");
    expect(createPhotoFx({ blur: {} }, opts()).glsl).toContain("i < 16;");
    expect(createPhotoFx({ blur: {} }, opts({ depth: false })).glsl).not.toContain("uDepth");
    // parallax mode: taps centred off the disocclusion jump (PARALLAX_GLSL uniforms), not elsewhere
    expect(createPhotoFx({ blur: {} }, opts({ parallax: true })).glsl).toContain("uMaxOffset");
    expect(createPhotoFx({ blur: {} }, opts()).glsl).not.toContain("uMaxOffset");
    expect(createPhotoFx({ blur: {} }, opts({ parallax: true, depth: false })).glsl).not.toContain("uMaxOffset");
    // blur runs first (it replaces the colour the other effects shade)
    const all = createPhotoFx({ fog: {}, blur: {} }, opts()).glsl;
    expect(all.indexOf("fxCoc(d)")).toBeLessThan(all.indexOf("uFog.y - d"));
    expect(createPhotoFx({ blur: {} }, opts()).alpha).toBe(false);
    const u = createPhotoFx({ blur: { amount: 1.5, range: 0.2, focus: 0.3 } }, opts());
    u.frame(0, 0, still);
    expect(u.uniforms().uBlur.slice(0, 3)).toEqual([0.3, 0.2, 0.015]);
  });

  it("blur rack: smooth ping-pong focus → to → focus from delay, still with reduced motion", () => {
    expect(blurFocus(0.9, 0.1, 2, 1, 0)).toBe(0.9); // before the delay
    expect(blurFocus(0.9, 0.1, 2, 1, 2)).toBeCloseTo(0.5); // half a leg
    expect(blurFocus(0.9, 0.1, 2, 1, 3)).toBeCloseTo(0.1); // reached `to`
    expect(blurFocus(0.9, 0.1, 2, 1, 5)).toBeCloseTo(0.9); // and back
    expect(blurFocus(0.9, 0.1, 2, 1, 3, true)).toBe(0.9);
    expect(blurFocus(0.9, undefined, 2, 0, 3)).toBe(0.9); // no rack without `to`
    expect(blurFocus(0.9, 0.1, undefined, 0, 3)).toBe(0.9);
    const fx = createPhotoFx({ blur: { focus: 0.9, to: 0.1, duration: 2 } }, opts());
    fx.frame(2, 0, still);
    expect(fx.uniforms().uBlur[0]).toBeCloseTo(0.1);
    // a timeline track on focus moves the rack's start
    fx.set("blur", "focus", 0.5);
    fx.frame(0, 0, still);
    expect(fx.uniforms().uBlur[0]).toBe(0.5);
  });

  it("frame: alpha, scalar inset, uniforms in photo space, subject shadow only with depth", () => {
    const fx = createPhotoFx({ frame: { inset: 0.25, border: 0.05, color: "#000000", shadow: 0.5, threshold: 0.7 } }, opts({ aspect: 2 }));
    expect(fx.alpha).toBe(true);
    expect(fx.state.frame).toMatchObject({ inset: [0.25, 0.25], softness: 0.04 });
    fx.frame(0, 0, still);
    const u = fx.uniforms();
    expect(u.uFrame[0]).toBeCloseTo(1); // (1 - 2 × 0.25) × aspect
    expect(u.uFrame[1]).toBeCloseTo(0.5);
    expect(u.uFrame[2]).toBeCloseTo(0.2); // border × 2 × aspect
    expect(u.uFrameB).toEqual([0.7, 0.5, 1, 1]); // + parallax UV inset (none here)
    expect(createPhotoFx({ frame: {} }, opts({ inset: [0.9, 0.8] })).uniforms().uFrameB.slice(2)).toEqual([0.9, 0.8]);
    expect(u.uFrameColor).toEqual([0, 0, 0]);
    expect(resolvePhotoEffects({ frame: {} }, opts()).frame).toMatchObject({ inset: [0.12, 0.12], threshold: 0.6, border: 0.015, shadow: 0.35, color: [1, 1, 1] });
    expect(fx.glsl).toContain("vec4 photoFx(vec4 c, vec2 uv, float d, vec2 s)");
    expect(fx.glsl).toContain("uFrameB.zw, 0.0).r"); // subject shadow taps (depth at the rest position)
    expect(fx.glsl).toContain("dp = min(dp"); // eroded pop-out mask
    expect(createPhotoFx({ frame: {} }, opts({ depth: false })).glsl).not.toContain("uDepth");
    // inset animates as a vec2 (or one number for both sides)
    fx.set("frame", "inset", 0.1);
    expect(fx.get("frame", "inset")).toEqual([0.1, 0.1]);
    fx.set("frame", "inset.y", 0.3);
    expect(fx.get("frame", "inset")).toEqual([0.1, 0.3]);
  });

  it("timeline tracks reach the photo effects through the host", () => {
    const fx = createPhotoFx({ light: { follow: "none" }, fog: {} }, opts());
    const obj = new THREE.Group();
    const host = { object: (id: string) => (id === "p" ? obj : null), camera: null, issue: () => undefined, photoEffects: (id: string) => (id === "p" ? fx : undefined) };
    bindTrack({ target: "p.effects.light.position", keys: [] }, host)[0].set([0.1, -0.2, 0]);
    bindTrack({ target: "p.effects.fog.amount", keys: [] }, host)[0].set(0.9);
    bindTrack({ target: "p.effects.fog.color", keys: [] }, host)[0].set(new THREE.Color(0, 0.5, 1));
    expect(fx.get("light", "position")).toEqual([0.1, -0.2]);
    expect(fx.get("fog", "amount")).toBe(0.9);
    expect(fx.get("fog", "color")).toEqual([0, 0.5, 1]);
    // relative keys resolve against the current value (the accessor's get)
    expect(bindTrack({ target: "p.effects.fog.amount", keys: [[0, "+=0.05"]] }, host)[0].keys[0][1]).toBeCloseTo(0.95);
    expect(bindTrack({ target: "p.effects.light.position.x", keys: [[0, "-=0.1"]] }, host)[0].keys[0][1]).toBeCloseTo(0);
    const issues: string[] = [];
    expect(bindTrack({ target: "q.effects.fog.amount", keys: [] }, { ...host, object: () => obj, issue: (_c: string, m: string) => issues.push(m) })).toEqual([]);
    expect(issues[0]).toContain("effect tracks need a 3D photo");
  });
});
