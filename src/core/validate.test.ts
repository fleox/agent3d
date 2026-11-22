import { describe, expect, it } from "vitest";
import type { SceneDoc } from "./types";
import { defaultScene, normalizeScene, validateScene, assetPathProblem } from "./validate";
import { starterScene } from "../ops/starters";
import { TARGET_KINDS } from "./validate";
import { isValidColor, parseColor } from "./color";
import { parseAspect } from "./aspect";
import { closest } from "./suggest";
import { slugify, uniqueId } from "./ids";

const base = (): SceneDoc => ({
  ...defaultScene({ id: "t", title: "Test" }),
  objects: [
    {
      id: "logo",
      kind: "mesh",
      geometry: { type: "torusKnot", radius: 0.5, tube: 0.15 },
      material: { preset: "gold", roughness: 0.2 },
      position: [0, 1, 0],
      behaviours: [{ type: "rotate", speed: 30 }],
      children: [{ id: "label", kind: "text", text: "Hi", font: "sans-bold" }],
    },
  ],
  timeline: { duration: 4, loop: true, tracks: [{ target: "logo.rotation.y", keys: [[0, 0], [4, 360]], ease: "inOutSine" }] },
});

const errors = (s: unknown) => validateScene(s).filter((i) => i.severity === "error");
const codes = (s: unknown) => validateScene(s).map((i) => `${i.severity}:${i.code}:${i.path}`);

describe("validateScene", () => {
  it("accepts a good scene with no errors or warnings", () => {
    expect(validateScene(base())).toEqual([]);
  });

  it("accepts every starter scene", () => {
    for (const kind of TARGET_KINDS) {
      const issues = validateScene(starterScene({ title: "Hello world", target: { kind } }));
      expect(issues.filter((i) => i.severity !== "info"), kind).toEqual([]);
    }
  });

  it("rejects non-objects and missing sections", () => {
    expect(errors(null)[0].code).toBe("type");
    const c = codes({ version: 2 });
    expect(c).toContain("error:enum:version");
    for (const k of ["id", "title", "target", "camera", "environment", "lights", "objects"]) expect(c).toContain(`error:required:${k}`);
  });

  it("checks target kind, aspect and height", () => {
    const s = base();
    (s.target as unknown as Record<string, unknown>).kind = "baner";
    s.target.aspect = "4x1";
    s.target.height = "tall";
    const iss = errors(s);
    const kind = iss.find((i) => i.path === "target.kind")!;
    expect(kind.hint).toContain('Did you mean "banner"');
    expect(iss.find((i) => i.path === "target.aspect")?.code).toBe("aspect");
    expect(iss.find((i) => i.path === "target.height")).toBeTruthy();
  });

  it("reports vec3, colour and range errors with readable object paths", () => {
    const s = base();
    const logo = s.objects[0] as unknown as Record<string, unknown>;
    logo.position = [0, 1];
    (logo.material as Record<string, unknown>).roughness = 3;
    (logo.material as Record<string, unknown>).color = "#ggg";
    const iss = errors(s);
    expect(iss.map((i) => i.path)).toEqual(expect.arrayContaining(["objects#logo.position", "objects#logo.material.roughness", "objects#logo.material.color"]));
    expect(iss.find((i) => i.path === "objects#logo.material.roughness")!.hint).toContain("between 0 and 1");
  });

  it("detects duplicate and invalid ids across the tree and lights", () => {
    const s = base();
    s.objects.push({ id: "label", kind: "group", children: [{ id: "1bad", kind: "group" }] });
    s.lights[0].id = "logo";
    const c = codes(s);
    expect(c).toContain("error:duplicate-id:objects#label.id");
    expect(c).toContain("error:duplicate-id:objects#logo.id");
    expect(c.some((x) => x.startsWith("error:invalid-id"))).toBe(true);
  });

  it("suggests catalog ids", () => {
    const s = base();
    (s.objects[0] as unknown as { geometry: { type: string } }).geometry.type = "torusknot";
    s.objects[0].behaviours = [{ type: "rotat" }];
    (s.objects[0] as unknown as { material: Record<string, unknown> }).material.preset = "golden";
    s.objects.push({ id: "gen", kind: "generator", generator: "terain" });
    s.postfx = [{ type: "blom" }];
    const iss = errors(s);
    const hint = (p: string) => iss.find((i) => i.path === p)?.hint ?? "";
    expect(hint("objects#logo.geometry.type")).toContain('"torusKnot"');
    expect(hint("objects#logo.behaviours[0].type")).toContain('"rotate"');
    expect(hint("objects#logo.material.preset")).toContain('"gold"');
    expect(hint("objects#gen.generator")).toContain('"terrain"');
    expect(hint("postfx[0].type")).toContain('"bloom"');
  });

  it("checks catalog params: types, ranges, enums, unknown params as warnings", () => {
    const s = base();
    s.objects.push({ id: "land", kind: "generator", generator: "terrain", params: { resolution: 2.5, shape: "hill", octave: 3, waterLevel: null } });
    const iss = validateScene(s);
    const at = (p: string) => iss.find((i) => i.path === p);
    expect(at("objects#land.params.resolution")?.severity).toBe("error");
    expect(at("objects#land.params.shape")?.hint).toContain('"hills"');
    const unk = at("objects#land.params.octave")!;
    expect(unk.severity).toBe("warning");
    expect(unk.hint).toContain('"octaves"');
    expect(at("objects#land.params.waterLevel")).toBeUndefined();
  });

  it("accepts a material override on generators that support it, warns on the others", () => {
    const s = base();
    s.objects.push({ id: "blob", kind: "generator", generator: "blob", material: { type: "shader", shader: "gradientFlow" } });
    s.objects.push({ id: "trees", kind: "generator", generator: "trees", material: { color: "#ff0000" } });
    s.objects.push({ id: "rock", kind: "generator", generator: "rocks", material: { preset: "gld" } });
    const iss = validateScene(s);
    const at = (p: string) => iss.find((i) => i.path === p);
    expect(at("objects#blob.material")).toBeUndefined();
    expect(at("objects#trees.material")?.severity).toBe("warning");
    expect(at("objects#trees.material")?.hint).toContain("blob");
    expect(at("objects#rock.material.preset")?.severity).toBe("error");
  });

  it("checks required params and point arrays", () => {
    const s = base();
    s.objects.push({ id: "vase", kind: "mesh", geometry: { type: "lathe" } });
    s.objects.push({ id: "star", kind: "mesh", geometry: { type: "extrude", shape: [[0, 0], [1]] } });
    const c = codes(s);
    expect(c).toContain("error:required:objects#vase.geometry.points");
    expect(c).toContain("error:vec:objects#star.geometry.shape[1]");
    expect(c).toContain("error:required:objects#star.geometry.shape");
  });

  it("warns on unknown fields with suggestions", () => {
    const s = base() as unknown as Record<string, unknown>;
    (s.objects as Record<string, unknown>[])[0].positon = [0, 0, 0];
    s.lighting = "studio";
    const iss = validateScene(s);
    const f = iss.find((i) => i.path === "objects#logo.positon")!;
    expect(f.severity).toBe("warning");
    expect(f.hint).toContain('"position"');
    expect(iss.find((i) => i.path === "lighting")?.code).toBe("unknown-field");
  });

  it("validates timeline targets, order and values", () => {
    const s = base();
    s.lights[1].id = "key";
    s.timeline!.tracks.push(
      { target: "logoo.position", keys: [[0, [0, 0, 0]]] },
      { target: "logo.position", keys: [[2, [0, 0, 0]], [1, [0, 1, 0]]] },
      { target: "logo.scale", keys: [[0, "big" as never]] },
      { target: "camera.fov", keys: [[0, 40], [9, 30]] },
      { target: "key.intensity", keys: [[0, 1]] },
      { target: "logo.material.opacity", keys: [[0, 1], [1, 0]] },
      { target: "logo.wings", keys: [[0, 1]] },
    );
    const iss = validateScene(s);
    const at = (p: string) => iss.filter((i) => i.path === p);
    expect(at("timeline.tracks[1].target")[0].hint).toContain('"logo"');
    expect(at("timeline.tracks[2].keys")[0].code).toBe("track-order");
    expect(at("timeline.tracks[3].keys[0][1]")[0].code).toBe("track-value");
    expect(at("timeline.tracks[4].keys[1][0]")[0].severity).toBe("warning");
    expect(at("timeline.tracks[5].target")).toEqual([]);
    expect(at("timeline.tracks[6].target")).toEqual([]);
    expect(at("timeline.tracks[7].target")[0].code).toBe("track-target");
  });

  it("checks scripts, asset paths, ui and audio", () => {
    const s = base();
    s.scripts = ["game.js", "scripts/ok.js", "scripts/x.ts"];
    s.objects.push({ id: "fox", kind: "model", src: "https://example.com/fox.glb" });
    s.objects.push({ id: "tree", kind: "model", src: "library:nature/pine-tree" });
    s.objects.push({ id: "pic", kind: "mesh", geometry: { type: "plane" }, material: { map: "../x.png" } });
    s.ui = { elements: [{ id: "hp", type: "bar", anchor: "middle" as never }, { id: "go", type: "button", text: "Go" }] };
    s.audio = { sounds: { coin: { preset: "coins" }, boom: { src: "assets/audio/boom.txt" } } };
    const c = codes(s);
    expect(c).toContain("error:script-path:scripts[0]");
    expect(c).not.toContain("error:script-path:scripts[1]");
    expect(c).toContain("error:script-path:scripts[2]");
    expect(c).toContain("error:asset-path:objects#fox.src");
    expect(c.filter((x) => x.includes("objects#tree"))).toEqual([]);
    expect(c).toContain("error:asset-path:objects#pic.material.map");
    expect(c).toContain("error:enum:ui.elements#hp.anchor");
    expect(c).toContain("error:required:ui.elements#hp.value");
    expect(c).toContain("error:required:ui.elements#go.action");
    expect(c).toContain("error:unknown-id:audio.sounds.coin.preset");
    expect(c).toContain("error:asset-path:audio.sounds.boom.src");
  });

  it("checks camera follow references and degenerate cameras", () => {
    const s = base();
    s.camera.controls = "follow";
    s.camera.follow = { target: "playr" };
    const iss = errors(s);
    expect(iss.find((i) => i.path === "camera.follow.target")!.hint).toContain("Object ids");
    s.camera.position = [0, 0, 0];
    s.camera.target = [0, 0, 0];
    expect(errors(s).some((i) => i.path === "camera.position")).toBe(true);
  });

  it("flags string materials and radians", () => {
    const s = base();
    (s.objects[0] as unknown as Record<string, unknown>).material = "gold";
    s.objects[0].rotation = [0, 1.57, 0];
    const iss = validateScene(s);
    expect(iss.find((i) => i.path === "objects#logo.material")!.hint).toContain('{ "preset": "gold" }');
    expect(iss.find((i) => i.path === "objects#logo.rotation")!.code).toBe("radians");
  });

  it("warns when nothing lights the scene", () => {
    const s = base();
    s.lights = [];
    s.environment.lighting = "none";
    expect(codes(s)).toContain("warning:no-lights:lights");
  });
});

describe("normalizeScene / defaultScene", () => {
  it("fills structural defaults only", () => {
    const n = normalizeScene({ id: "x", timeline: { duration: 2 } });
    expect(n.version).toBe(1);
    expect(n.lights).toEqual([]);
    expect(n.objects).toEqual([]);
    expect(n.timeline!.tracks).toEqual([]);
  });
  it("defaultScene is valid", () => {
    expect(errors(defaultScene({ kind: "hero" }))).toEqual([]);
    expect(defaultScene({ kind: "hero" }).target.aspect).toBe("16:9");
  });
});

describe("helpers", () => {
  it("parses CSS colours", () => {
    for (const c of ["#fff", "#ffffff", "#ffffff80", "rgb(1,2,3)", "rgba(1 2 3 / 50%)", "hsl(120 50% 50%)", "hsla(120deg, 50%, 50%, 0.3)", "tomato", "RebeccaPurple"]) expect(isValidColor(c), c).toBe(true);
    for (const c of ["#ff", "rgb(1,2)", "hsl(1,2,3)", "nocolor", "", 12]) expect(isValidColor(c), String(c)).toBe(false);
    expect(parseColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    const g = parseColor("hsl(120, 100%, 50%)")!;
    expect([Math.round(g.r), Math.round(g.g), Math.round(g.b)]).toEqual([0, 255, 0]);
  });
  it("parses aspects", () => {
    expect(parseAspect("4:1")?.ratio).toBe(4);
    expect(parseAspect("16:9")?.ratio).toBeCloseTo(1.777, 2);
    expect(parseAspect("0:1")).toBeNull();
    expect(parseAspect("4/1")).toBeNull();
  });
  it("suggests", () => {
    expect(closest("rotat", ["rotate", "float"])).toBe("rotate");
    expect(closest("zzzzzz", ["rotate", "float"])).toBeUndefined();
  });
  it("ids", () => {
    expect(slugify("My Logo 3D!")).toBe("my-logo-3d");
    expect(slugify("3D")).toBe("item-3d");
    expect(uniqueId("box", ["box", "box-2"])).toBe("box-3");
  });
  it("asset path syntax", () => {
    expect(assetPathProblem("assets/a.glb")).toBeNull();
    expect(assetPathProblem("library:nature/pine")).toBeNull();
    expect(assetPathProblem("/abs.glb")).not.toBeNull();
    expect(assetPathProblem("library:../x")).not.toBeNull();
  });
});

describe("validateScene: orbit azimuth limits and three.js parameter names", () => {
  it("accepts orbitLimits.minAzimuth / maxAzimuth (degrees) and range-checks them", () => {
    const s = defaultScene({}) as SceneDoc;
    s.camera.controls = "orbit";
    s.camera.orbitLimits = { minAzimuth: -40, maxAzimuth: 40, minPolar: 30, maxPolar: 85 };
    expect(validateScene(s)).toEqual([]);
    s.camera.orbitLimits = { minAzimuth: -400 };
    expect(validateScene(s).map((i) => i.path)).toEqual(["camera.orbitLimits.minAzimuth"]);
  });
  it("names the catalog parameter for three.js geometry names (radialSegments → segments)", () => {
    const s = defaultScene({}) as SceneDoc;
    s.objects = [
      { id: "c", kind: "mesh", geometry: { type: "cylinder", radialSegments: 12 } as never },
      { id: "k", kind: "mesh", geometry: { type: "cone", radialSegments: 12 } as never },
    ];
    const issues = validateScene(s);
    expect(issues).toHaveLength(2);
    for (const i of issues) {
      expect(i.code).toBe("unknown-param");
      expect(i.message).toContain('it is called "segments" here');
      expect(i.hint).toBe('Rename "radialSegments" to "segments".');
    }
    // torus really has radialSegments: no issue.
    s.objects = [{ id: "t", kind: "mesh", geometry: { type: "torus", radialSegments: 12 } as never }];
    expect(validateScene(s)).toEqual([]);
  });
});

describe("instances layouts and particle fields (declared in the catalog)", () => {
  const withObj = (o: Record<string, unknown>): SceneDoc => ({ ...defaultScene({ id: "t", title: "Test" }), objects: [o as never] });
  it("validates layout fields from CATALOG.instanceLayouts with did-you-mean", () => {
    const ok = withObj({ id: "trees", kind: "instances", geometry: { type: "cone" }, layout: { type: "scatter", count: 50, area: [10, 0, 10], minScale: 0.5, maxScale: 1.2, seed: 2 } });
    expect(validateScene(ok)).toEqual([]);
    const typo = validateScene(withObj({ id: "g", kind: "instances", geometry: { type: "box" }, layout: { type: "grid", count: [2, 1, 2], spacing: [1, 0, 1], spaceing: 2 } }));
    expect(typo).toEqual([expect.objectContaining({ code: "unknown-param", path: "objects#g.layout.spaceing", hint: expect.stringContaining('Did you mean "spacing"') })]);
    const missing = errors(withObj({ id: "c", kind: "instances", geometry: { type: "box" }, layout: { type: "circle", count: 5 } }));
    expect(missing.map((i) => i.path)).toEqual(["objects#c.layout.radius"]);
    const badGrid = errors(withObj({ id: "g", kind: "instances", geometry: { type: "box" }, layout: { type: "grid", count: [2.5, 1, 2], spacing: [1, 0, 1] } }));
    expect(badGrid[0]).toMatchObject({ path: "objects#g.layout.count", code: "range" });
  });
  it("particle presets declare the overridable fields the validator accepts", async () => {
    const { CATALOG, PARTICLE_PARAMS, PARTICLE_SHAPES } = await import("./catalog");
    const runtime = await import("../runtime/particles/presets");
    for (const p of CATALOG.particlePresets) expect(p.params.map((x) => x.name), p.id).toEqual(PARTICLE_PARAMS.map((x) => x.name));
    expect([...PARTICLE_SHAPES]).toEqual([...runtime.PARTICLE_SHAPES]);
    // Every overridable field the runtime reads is declared (seed is the object's RNG seed).
    for (const k of ["count", "area", "size", "speed", "direction", "spread", "lifetime", "opacity", "blending", "shape"]) expect(k in runtime.PARTICLE_DEFAULTS, k).toBe(true);
    expect(validateScene(withObj({ id: "s", kind: "particles", preset: "snow", count: 400, area: [10, 5, 5], size: 0.1, color: ["#fff", "#eef"] }))).toEqual([]);
    expect(validateScene(withObj({ id: "s", kind: "particles", preset: "snow", cuont: 4 }))[0]).toMatchObject({ path: "objects#s.cuont", hint: expect.stringContaining('"count"') });
  });
});
