// Lighting / environment / materials: procedural textures, light rigs,
// physical sky helpers, material presets and shader patches.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LIGHT_RIGS, MATERIAL_PRESETS, TEXTURES } from "../../core/catalog";
import { validateScene } from "../../core/validate";
import type { SceneDoc } from "../../core/types";
import { createRng } from "../random";
import type { RuntimeContext } from "./context";
import { applyHeightFog } from "./heightFog";
import { shadowMapSettings } from "./lights";
import { addShaderPatch, createMaterial } from "./materials";
import { expandRig, LIGHT_RIG_IDS } from "./rigs";
import { isPhysicalSky, resolveSky, SKY_PRESETS, sunDirection, sunLight } from "./sky";
import { generateProceduralImage, PROCEDURAL_TEXTURE_IDS } from "./textures";

const ctx = (): RuntimeContext => ({
  scene: {} as SceneDoc,
  rng: createRng(1),
  siblings: new Map(),
  color: (c) => new THREE.Color(c),
  resolveAsset: (p) => p,
  renderer: null,
  deterministic: true,
  track: (p) => p,
  onUpdate: () => {},
  issue: (code, message) => {
    throw new Error(`${code}: ${message}`);
  },
  shaders: async () => ({}),
  generators: async () => ({}),
});

describe("procedural textures", () => {
  it("every catalog texture has a pattern and vice versa", () => {
    expect([...PROCEDURAL_TEXTURE_IDS].sort()).toEqual(TEXTURES.map((t) => t.id).sort());
  });
  for (const t of TEXTURES) {
    it(`${t.id} generates colour, data and normal images deterministically`, () => {
      for (const kind of ["color", "data", "normal"] as const) {
        const a = generateProceduralImage({ procedural: t.id, resolution: 64 }, kind);
        expect(a.size).toBe(64);
        expect(a.data.length).toBe(64 * 64 * 4);
        const b = generateProceduralImage({ procedural: t.id, resolution: 64, seed: 1 }, kind);
        expect(Buffer.from(b.data).equals(Buffer.from(a.data))).toBe(true);
      }
      const img = generateProceduralImage({ procedural: t.id, resolution: 64 }, "data");
      let min = 255, max = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        min = Math.min(min, img.data[i]!);
        max = Math.max(max, img.data[i]!);
      }
      expect(max - min, `${t.id} should not be flat`).toBeGreaterThan(10);
    });
  }
  it("tiles seamlessly (opposite edges match closely)", () => {
    const n = 128;
    const img = generateProceduralImage({ procedural: "noise", resolution: n }, "data");
    let edge = 0, inner = 0;
    for (let y = 0; y < n; y++) {
      edge += Math.abs(img.data[(y * n + (n - 1)) * 4]! - img.data[(y * n) * 4]!);
      inner += Math.abs(img.data[(y * n + 40) * 4]! - img.data[(y * n + 41) * 4]!);
    }
    expect(edge / n).toBeLessThan(Math.max(6, (inner / n) * 3));
  });
  it("seed changes the pattern", () => {
    const a = generateProceduralImage({ procedural: "marble", resolution: 64, seed: 1 }, "color");
    const b = generateProceduralImage({ procedural: "marble", resolution: 64, seed: 2 }, "color");
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(false);
  });
});

describe("light rigs", () => {
  it("every catalog rig is implemented and vice versa", () => {
    expect([...LIGHT_RIG_IDS].sort()).toEqual(LIGHT_RIGS.map((r) => r.id).sort());
  });
  for (const r of LIGHT_RIGS) {
    it(`${r.id} expands to valid lights`, () => {
      const lights = expandRig(r.id);
      expect(lights.length).toBeGreaterThan(0);
      const scene = { version: 1, id: "t", title: "T", target: { kind: "banner", aspect: "4:1" }, camera: { type: "perspective", position: [0, 1, 5] }, environment: { background: "#000" }, lights: lights.map((l) => ({ ...l, id: l.id!.replace("rig:", "") })), objects: [] };
      const errors = validateScene(scene).filter((i) => i.severity === "error");
      expect(errors).toEqual([]);
    });
  }
  it("applies rotation, scale, intensity, tint and castShadow", () => {
    const base = expandRig("golden-hour");
    const turned = expandRig({ preset: "golden-hour", rotation: 90, scale: 2, intensity: 0.5, castShadow: false, color: "#0000ff" });
    const sun0 = base.find((l) => l.id === "rig:sun")!;
    const sun1 = turned.find((l) => l.id === "rig:sun")!;
    expect(sun1.position![1]).toBeCloseTo(sun0.position![1] * 2);
    expect(Math.hypot(sun1.position![0], sun1.position![2])).toBeCloseTo(Math.hypot(sun0.position![0], sun0.position![2]) * 2);
    expect(sun1.intensity).toBeCloseTo(sun0.intensity! * 0.5);
    expect(sun1.castShadow).toBeUndefined();
    expect(sun1.color).not.toBe(sun0.color);
    expect(expandRig("nope")).toEqual([]);
  });
});

describe("physical sky", () => {
  it("presets imply a physical sky; elevation/azimuth → direction", () => {
    expect(isPhysicalSky({ preset: "noon" })).toBe(true);
    expect(isPhysicalSky({ top: "#000" })).toBe(false);
    const [x, y, z] = sunDirection(0, 90);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
    expect(sunDirection(90, 0)[1]).toBeCloseTo(1);
  });
  it("sun direction overrides the preset angles", () => {
    const v = resolveSky({ preset: "noon", sun: { direction: [0, 1, 1] } });
    expect(v.elevation).toBeCloseTo(45);
    expect(v.azimuth).toBeCloseTo(0);
    expect(resolveSky({ preset: "sunset" }).elevation).toBe(SKY_PRESETS.sunset.elevation);
  });
  it("sun light gets warmer and dimmer towards the horizon", () => {
    const low = sunLight(2), high = sunLight(50);
    expect(low.intensity).toBeLessThan(high.intensity);
    expect(low.color.b / low.color.r).toBeLessThan(high.color.b / high.color.r);
    expect(sunLight(-10).intensity).toBe(0);
  });
});

describe("shadow map settings", () => {
  const base = { version: 1, id: "t", target: { kind: "banner", aspect: "4:1" }, camera: { type: "perspective", position: [0, 0, 5] }, lights: [], objects: [] } as unknown as SceneDoc;
  it("enables shadows for the physical sun and rigs, not for plain scenes", () => {
    expect(shadowMapSettings({ ...base, environment: { background: "#000" } }).enabled).toBe(false);
    expect(shadowMapSettings({ ...base, environment: { background: { sky: { preset: "noon" } } } }).enabled).toBe(true);
    expect(shadowMapSettings({ ...base, environment: { background: { sky: { preset: "noon", sun: { castShadow: false } } } } }).enabled).toBe(false);
    expect(shadowMapSettings({ ...base, environment: { background: "#000", rig: "softbox" } }).enabled).toBe(true);
    expect(shadowMapSettings({ ...base, environment: { background: "#000", rig: "softbox", shadows: { type: "vsm" } } }).type).toBe(THREE.VSMShadowMap);
  });
});

describe("materials", () => {
  for (const p of MATERIAL_PRESETS) {
    it(`preset ${p.id} builds`, async () => {
      const m = await createMaterial({ preset: p.id }, ctx());
      expect(m).toBeInstanceOf(THREE.Material);
    });
  }
  it("maps the new physical parameters", async () => {
    const m = (await createMaterial({ type: "physical", anisotropy: 0.7, anisotropyRotation: 90, dispersion: 3, attenuationColor: "#ff0000", attenuationDistance: 0.5, clearcoat: 1, clearcoatRoughness: 0.02, sheen: 1, sheenColor: "#00ff00", envMapIntensity: 2, iridescence: 1, iridescenceThicknessRange: [100, 400] }, ctx())) as THREE.MeshPhysicalMaterial;
    expect(m.anisotropy).toBeCloseTo(0.7);
    expect(m.anisotropyRotation).toBeCloseTo(Math.PI / 2);
    expect(m.dispersion).toBe(3);
    expect(m.attenuationDistance).toBe(0.5);
    expect(m.clearcoatRoughness).toBe(0.02);
    expect(m.sheenColor.g).toBeGreaterThan(0.9);
    expect(m.envMapIntensity).toBe(2);
    expect(m.iridescenceThicknessRange).toEqual([100, 400]);
  });
  it("procedural textures land in the right slot / colour space", async () => {
    const m = (await createMaterial({ type: "physical", map: { procedural: "checker", resolution: 32 }, normalMap: { procedural: "flakes", resolution: 32 }, roughnessMap: { procedural: "noise", resolution: 32 } }, ctx())) as THREE.MeshPhysicalMaterial;
    expect(m.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.normalMap?.colorSpace).toBe(THREE.NoColorSpace);
    expect(m.roughnessMap).toBeInstanceOf(THREE.DataTexture);
  });
  it("triplanar patch rewrites the map / normal chunks", async () => {
    const m = (await createMaterial({ type: "standard", triplanar: 2, map: { procedural: "grid", resolution: 32 } }, ctx())) as THREE.MeshStandardMaterial;
    const lib = THREE.ShaderLib.physical;
    const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("triSample( map )");
    expect(shader.fragmentShader).toContain("normalMatrix * objN");
    expect(shader.vertexShader).toContain("vTriPos = position");
    expect(m.customProgramCacheKey()).toContain("triplanar");
  });
  it("addShaderPatch keeps a pre-existing onBeforeCompile", () => {
    const m = new THREE.MeshStandardMaterial();
    const calls: string[] = [];
    m.onBeforeCompile = () => void calls.push("own");
    addShaderPatch(m, "x", () => void calls.push("x"));
    addShaderPatch(m, "x", () => void calls.push("dup"));
    m.onBeforeCompile({} as never, {} as never);
    expect(calls).toEqual(["own", "x"]);
  });
  it("height fog patches fogged materials only", () => {
    const root = new THREE.Group();
    const fogged = new THREE.MeshStandardMaterial();
    const shader = new THREE.ShaderMaterial();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), fogged), new THREE.Mesh(new THREE.BoxGeometry(), shader));
    const u = { uA3dFogHeight: { value: 0 }, uA3dFogFalloff: { value: 0.3 } };
    applyHeightFog(root, u);
    expect(fogged.customProgramCacheKey()).toContain("height-fog");
    const lib = THREE.ShaderLib.standard;
    const s = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    fogged.onBeforeCompile(s, {} as THREE.WebGLRenderer);
    expect(s.fragmentShader).toContain("a3dHeightFog( fogDensity )");
    expect(s.vertexShader).toContain("vA3dFogWorld = ");
    expect(shader.userData.a3dPatches).toBeUndefined();
  });
});

describe("validation of the lookdev fields", () => {
  const scene = (environment: unknown, extra: Record<string, unknown> = {}) => ({
    version: 1,
    id: "t",
    title: "T",
    target: { kind: "banner", aspect: "4:1" },
    camera: { type: "perspective", position: [0, 1, 5] },
    environment,
    lights: [],
    objects: [],
    ...extra,
  });
  const errs = (s: unknown) => validateScene(s).filter((i) => i.severity !== "info");
  it("accepts the new environment fields", () => {
    expect(errs(scene({ background: { sky: { preset: "golden-hour", sun: { elevation: 5, azimuth: 200, castShadow: true }, clouds: 0.3 } }, fog: { density: 0.03, height: 0, falloff: 0.4 }, rig: { preset: "softbox", intensity: 1.2 }, contactShadows: { opacity: 0.7, blur: 3 }, shadows: { type: "vsm", softness: 6 } }))).toEqual([]);
    expect(errs(scene({ background: { meshGradient: ["#ff0000", "#00ff00", "#0000ff"], speed: 0.2, grain: 0.05 }, lighting: "sky" }))).toEqual([]);
    expect(errs(scene({ background: { hdri: "library:hdri/softbox.hdr", rotation: 90, intensity: 0.8, groundProjection: { height: 2, radius: 40 } } }))).toEqual([]);
    expect(errs(scene({ background: { radial: ["#fff", "#000"], center: [0.3, 0.6], radius: 1.2 } }))).toEqual([]);
  });
  it("flags bad rigs, sky presets and procedural textures", () => {
    const a = errs(scene({ background: { sky: { preset: "midnight" } }, rig: "studio3point" }));
    expect(a.map((i) => i.path)).toEqual(expect.arrayContaining(["environment.background.sky.preset", "environment.rig"]));
    const b = errs(
      scene({ background: "#000" }, { objects: [{ id: "a", kind: "mesh", geometry: { type: "box" }, material: { type: "standard", map: { procedural: "marbel" }, anisotropy: 0.5 } }] }),
    );
    expect(b.find((i) => i.path === "objects#a.material.map.procedural")?.hint).toContain("marble");
    expect(b.some((i) => i.path === "objects#a.material.anisotropy" && i.code === "ignored")).toBe(true);
  });
  it("accepts light panels, volumetric spots and per-light shadows", () => {
    const s = scene({ background: "#000" }, { lights: [
      { id: "panel", type: "rect", position: [0, 2, 2], width: 2, height: 1, panel: true },
      { id: "spot", type: "spot", position: [0, 4, 0], target: [0, 0, 0], volumetric: { intensity: 1.5 }, castShadow: true, shadow: { softness: 8, mapSize: 1024 } },
    ] });
    expect(errs(s)).toEqual([]);
  });
});

describe("contact shadows fit", () => {
  it("ignores particles / points / helpers when fitting the subject box", async () => {
    const THREE = await import("three");
    const { meshBox } = await import("./contactShadows");
    const root = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    box.position.set(3, 1, 0);
    root.add(box);
    const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([-50, 0, -50, 50, 20, 50], 3)));
    root.add(dust);
    const helper = new THREE.Mesh(new THREE.BoxGeometry(100, 1, 100));
    helper.userData.helper = true;
    root.add(helper);
    const b = meshBox(root);
    expect(b.min.toArray()).toEqual([2, 0, -1]);
    expect(b.max.toArray()).toEqual([4, 2, 1]);
  });
});

describe("gems, text fades, volumetric cones", () => {
  it("diamond / gem presets get the sparkle patch; plain glass does not", async () => {
    const diamond = (await createMaterial({ preset: "diamond" }, ctx())) as THREE.MeshPhysicalMaterial;
    const gem = (await createMaterial({ preset: "gem" }, ctx())) as THREE.MeshPhysicalMaterial;
    const glass = (await createMaterial({ type: "physical", transmission: 1, ior: 1.5, roughness: 0 }, ctx())) as THREE.MeshPhysicalMaterial;
    expect(diamond.customProgramCacheKey()).toContain("gem-sparkle");
    expect(gem.customProgramCacheKey()).toContain("gem-sparkle");
    expect(glass.userData.gemSparkle).toBeUndefined();
    const u = diamond.userData.gemSparkle as { uA3dGemAmount: { value: number }; uA3dGemDisp: { value: number } };
    expect(u.uA3dGemAmount.value).toBeGreaterThan((gem.userData.gemSparkle as typeof u).uA3dGemAmount.value);
    expect(u.uA3dGemDisp.value).toBeGreaterThan(0);
  });
  it("fading text letters get a depth-only twin, hidden once opaque", async () => {
    const { revealImpl, depthTwin } = await import("./text");
    const letter = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    letter.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const run = revealImpl({ effect: "fade", duration: 1 }, 1)({ type: "appear" } as never, { object: letter } as never) as { update(t: number): void };
    const twins = letter.children.filter((c) => c.userData.depthTwin);
    expect(twins).toHaveLength(1);
    expect(letter.children[0].children.filter((c) => c.userData.depthTwin)).toHaveLength(1);
    run.update(0.2);
    expect(twins[0].visible).toBe(true);
    expect((twins[0] as THREE.Mesh).material).toMatchObject({ colorWrite: false, depthWrite: true });
    run.update(2);
    expect(twins[0].visible).toBe(false);
    expect(typeof depthTwin).toBe("function");
  });
  it("volumetric cones fade against the ground / scene depth and never write coverage", async () => {
    const { buildLight } = await import("./lights");
    const spot = await buildLight({ id: "s", type: "spot", position: [0, 4, 0], target: [0, 0, 0], volumetric: true });
    const cone = spot.children.find((c) => c.name === "__volumetric") as THREE.Mesh;
    const mat = cone.material as THREE.ShaderMaterial;
    expect(mat.premultipliedAlpha).toBe(true);
    expect(mat.fragmentShader).toContain("gl_FragColor = vec4(uColor * a, 0.0)");
    const scene = new THREE.Scene();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry());
    ground.userData.ground = true;
    ground.position.y = -0.5;
    scene.add(ground, spot);
    scene.updateMatrixWorld(true);
    const renderer = { getRenderTarget: () => null } as unknown as THREE.WebGLRenderer;
    cone.onBeforeRender(renderer, scene, new THREE.PerspectiveCamera(), cone.geometry, mat, null as never);
    expect(mat.uniforms.uUseGround.value).toBe(1);
    expect(mat.uniforms.uGroundY.value).toBeCloseTo(-0.5);
    expect(mat.uniforms.uUseDepth.value).toBe(0);
    scene.userData.a3dDepth = { texture: new THREE.Texture(), width: 100, height: 50 };
    const rendererRt = { getRenderTarget: () => ({}) } as unknown as THREE.WebGLRenderer;
    cone.onBeforeRender(rendererRt, scene, new THREE.PerspectiveCamera(), cone.geometry, mat, null as never);
    expect(mat.uniforms.uUseDepth.value).toBe(1);
    expect(mat.uniforms.uViewport.value.toArray()).toEqual([100, 50]);
  });
  it("a light rig halves the default IBL (pastels stay coloured)", async () => {
    const { RIG_IBL_SCALE } = await import("./environment");
    expect(RIG_IBL_SCALE).toBeLessThan(0.6);
    const top = expandRig("softbox").find((l) => l.id === "rig:top")!;
    expect(top.intensity).toBeLessThanOrEqual(2.2);
  });
});
