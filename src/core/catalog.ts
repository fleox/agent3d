// The catalog — declared ONCE here: every geometry, material preset,
// behaviour, generator, particle preset, post effect, font, shader and sound
// the engine supports, with its parameters. Consumers:
// - src/core/validate.ts validates scenes against it;
// - src/runtime/ implements each entry (a test checks every id is implemented);
// - src/ai/tools.ts exposes it to agents (`catalog` tool / `agent3d catalog`);
// - docs/catalog.md is generated from it.
// Adding an entry here without implementing it in the runtime fails the tests.

export type ParamType = "number" | "integer" | "boolean" | "string" | "color" | "colors" | "vec2" | "vec3" | "enum" | "object" | "array";

export interface ParamSpec {
  name: string;
  type: ParamType;
  description: string;
  default?: unknown;
  min?: number;
  max?: number;
  options?: readonly string[];
  required?: boolean;
}

export interface CatalogEntry {
  id: string;
  description: string;
  params: ParamSpec[];
  // Rough triangle cost for `check` budgets (geometry / generator / particles).
  cost?: string;
  example?: Record<string, unknown>;
}

const n = (name: string, description: string, def?: number, min?: number, max?: number): ParamSpec => ({ name, type: "number", description, default: def, min, max });
const i = (name: string, description: string, def?: number, min?: number, max?: number): ParamSpec => ({ name, type: "integer", description, default: def, min, max });
const b = (name: string, description: string, def?: boolean): ParamSpec => ({ name, type: "boolean", description, default: def });
const c = (name: string, description: string, def?: string): ParamSpec => ({ name, type: "color", description, default: def });
const cs = (name: string, description: string, def?: string[]): ParamSpec => ({ name, type: "colors", description, default: def });
const v3 = (name: string, description: string, def?: [number, number, number]): ParamSpec => ({ name, type: "vec3", description, default: def });
const e = (name: string, description: string, options: readonly string[], def?: string): ParamSpec => ({ name, type: "enum", description, options, default: def });

// ─── Geometries ─────────────────────────────────────────────────────────

const SEG = i("segments", "Smoothness (radial segments).", 32, 3, 256);

export const GEOMETRIES: CatalogEntry[] = [
  { id: "box", description: "Box.", params: [n("width", "Size on X.", 1, 0), n("height", "Size on Y.", 1, 0), n("depth", "Size on Z.", 1, 0)], cost: "12" },
  { id: "roundedBox", description: "Box with rounded edges (nice for UI-like blocks, dice, buttons).", params: [n("width", "Size on X.", 1, 0), n("height", "Size on Y.", 1, 0), n("depth", "Size on Z.", 1, 0), n("radius", "Corner radius.", 0.1, 0), i("segments", "Corner smoothness.", 4, 1, 16)], cost: "~500" },
  { id: "sphere", description: "Sphere.", params: [n("radius", "Radius.", 0.5, 0), SEG, i("heightSegments", "Vertical segments.", 24, 2, 256)], cost: "segments*heightSegments*2" },
  { id: "cylinder", description: "Cylinder (different top/bottom radii make a truncated cone).", params: [n("radiusTop", "Top radius.", 0.5, 0), n("radiusBottom", "Bottom radius.", 0.5, 0), n("height", "Height.", 1, 0), SEG, b("openEnded", "No caps.", false)], cost: "segments*4" },
  { id: "cone", description: "Cone.", params: [n("radius", "Base radius.", 0.5, 0), n("height", "Height.", 1, 0), SEG], cost: "segments*2" },
  { id: "capsule", description: "Capsule (pill).", params: [n("radius", "Radius.", 0.3, 0), n("length", "Length of the straight part.", 0.6, 0), i("segments", "Smoothness.", 16, 2, 64)], cost: "~1000" },
  { id: "torus", description: "Torus (donut).", params: [n("radius", "Ring radius.", 0.5, 0), n("tube", "Tube radius.", 0.15, 0), i("radialSegments", "Tube segments.", 24, 2), i("tubularSegments", "Ring segments.", 64, 3), n("arc", "Arc in degrees.", 360, 0, 360)], cost: "radialSegments*tubularSegments*2" },
  { id: "torusKnot", description: "Torus knot (decorative).", params: [n("radius", "Radius.", 0.5, 0), n("tube", "Tube radius.", 0.15, 0), i("tubularSegments", "Segments along the knot.", 128, 3), i("radialSegments", "Tube segments.", 16, 3), i("p", "Winds around its axis.", 2, 1), i("q", "Winds around the torus interior.", 3, 1)], cost: "tubularSegments*radialSegments*2" },
  { id: "plane", description: "Flat rectangle facing +Z (rotate [-90,0,0] for a floor).", params: [n("width", "Width.", 1, 0), n("height", "Height.", 1, 0), i("widthSegments", "Subdivisions (for shaders).", 1, 1), i("heightSegments", "Subdivisions.", 1, 1)], cost: "2" },
  { id: "circle", description: "Flat disc facing +Z.", params: [n("radius", "Radius.", 0.5, 0), SEG], cost: "segments" },
  { id: "ring", description: "Flat ring facing +Z.", params: [n("innerRadius", "Inner radius.", 0.3, 0), n("outerRadius", "Outer radius.", 0.5, 0), SEG], cost: "segments*2" },
  { id: "icosahedron", description: "Icosahedron (detail 0 = low-poly gem, 3+ = smooth sphere).", params: [n("radius", "Radius.", 0.5, 0), i("detail", "Subdivision.", 0, 0, 6)], cost: "20*4^detail" },
  { id: "dodecahedron", description: "Dodecahedron.", params: [n("radius", "Radius.", 0.5, 0), i("detail", "Subdivision.", 0, 0, 5)], cost: "36" },
  { id: "octahedron", description: "Octahedron (diamond).", params: [n("radius", "Radius.", 0.5, 0), i("detail", "Subdivision.", 0, 0, 5)], cost: "8" },
  { id: "tetrahedron", description: "Tetrahedron (pyramid).", params: [n("radius", "Radius.", 0.5, 0), i("detail", "Subdivision.", 0, 0, 5)], cost: "4" },
  { id: "lathe", description: "Surface of revolution from a 2D profile (vases, bottles, chess pieces).", params: [{ name: "points", type: "array", description: "Profile [[x,y], …] (x = radius) from bottom to top.", required: true }, SEG], cost: "points*segments*2" },
  { id: "extrude", description: "Extruded 2D shape (stars, arrows, custom polygons).", params: [{ name: "shape", type: "array", description: "Polygon [[x,y], …] (closed automatically).", required: true }, n("depth", "Extrusion depth.", 0.2, 0), n("bevel", "Bevel size.", 0.02, 0)], cost: "~points*20" },
  { id: "tube", description: "Tube along a smooth curve through points (pipes, paths, ribbons).", params: [{ name: "points", type: "array", description: "Curve points [[x,y,z], …].", required: true }, n("radius", "Tube radius.", 0.05, 0), i("tubularSegments", "Segments along the curve.", 64, 2), i("radialSegments", "Segments around.", 8, 3), b("closed", "Close the loop.", false)], cost: "tubularSegments*radialSegments*2" },
];

// ─── Material presets ───────────────────────────────────────────────────

export interface MaterialPreset {
  id: string;
  description: string;
  // Material properties the preset sets (a MaterialDef without preset).
  props: Record<string, unknown>;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: "plastic", description: "Glossy plastic.", props: { type: "physical", color: "#e8e8e8", roughness: 0.35, metalness: 0, clearcoat: 0.3 } },
  { id: "matte", description: "Flat, non-reflective paint.", props: { type: "standard", color: "#d9d9d9", roughness: 0.95, metalness: 0 } },
  { id: "clay", description: "Soft clay / ceramic look (great for stylised scenes).", props: { type: "standard", color: "#e9dccb", roughness: 0.8, metalness: 0 } },
  { id: "chrome", description: "Mirror chrome (needs environment lighting).", props: { type: "physical", color: "#ffffff", roughness: 0.05, metalness: 1 } },
  { id: "brushedMetal", description: "Brushed steel.", props: { type: "physical", color: "#c8ccd2", roughness: 0.35, metalness: 1 } },
  { id: "gold", description: "Polished gold.", props: { type: "physical", color: "#ffcf6b", roughness: 0.15, metalness: 1 } },
  { id: "copper", description: "Copper.", props: { type: "physical", color: "#e8926a", roughness: 0.25, metalness: 1 } },
  { id: "glass", description: "Clear refractive glass.", props: { type: "physical", color: "#ffffff", roughness: 0.02, metalness: 0, transmission: 1, thickness: 0.5, ior: 1.5 } },
  { id: "frostedGlass", description: "Frosted glass.", props: { type: "physical", color: "#ffffff", roughness: 0.4, metalness: 0, transmission: 1, thickness: 0.8, ior: 1.4 } },
  { id: "rubber", description: "Matte rubber.", props: { type: "standard", color: "#2b2b2b", roughness: 1, metalness: 0 } },
  { id: "pearl", description: "Iridescent pearl.", props: { type: "physical", color: "#f4f1ee", roughness: 0.25, metalness: 0, iridescence: 1, clearcoat: 1 } },
  { id: "holographic", description: "Holographic iridescent foil.", props: { type: "physical", color: "#d7e3ff", roughness: 0.15, metalness: 0.9, iridescence: 1 } },
  { id: "neon", description: "Glowing neon (shines with bloom).", props: { type: "standard", color: "#ff2fd6", emissive: "#ff2fd6", emissiveIntensity: 3, roughness: 0.5 } },
  { id: "toon", description: "Cel-shaded cartoon.", props: { type: "toon", color: "#ffb347" } },
  { id: "flat", description: "Unlit flat colour (ignores lights).", props: { type: "basic", color: "#ffffff" } },
  { id: "lowpoly", description: "Faceted low-poly shading.", props: { type: "standard", color: "#8bc34a", roughness: 0.9, flatShading: true } },
  { id: "velvet", description: "Soft fabric with sheen.", props: { type: "physical", color: "#7b2d5b", roughness: 0.9, sheen: 1 } },
  { id: "wireframe", description: "Wireframe lines.", props: { type: "basic", color: "#7cf7ff", wireframe: true } },
  { id: "normal", description: "Rainbow normals (debug / playful).", props: { type: "normal" } },
];

// ─── Shaders (material.type "shader") ───────────────────────────────────

export const SHADERS: CatalogEntry[] = [
  { id: "plasma", description: "Animated colourful plasma.", params: [cs("colors", "Palette.", ["#ff006e", "#8338ec", "#3a86ff"]), n("speed", "Animation speed.", 1, 0), n("scale", "Pattern scale.", 1, 0)] },
  { id: "waves", description: "Moving stripes / waves.", params: [cs("colors", "Two colours.", ["#0b132b", "#5bc0be"]), n("speed", "Speed.", 1, 0), n("frequency", "Stripe frequency.", 8, 0)] },
  { id: "noise", description: "Animated smooth noise (clouds, smoke, marble).", params: [cs("colors", "Ramp colours.", ["#1b1b3a", "#ff9f1c"]), n("speed", "Speed.", 0.3, 0), n("scale", "Scale.", 2, 0)] },
  { id: "hologram", description: "Sci-fi hologram with scanlines and fresnel rim (transparent).", params: [c("color", "Colour.", "#38f9ff"), n("speed", "Scanline speed.", 1, 0), n("lines", "Scanline count.", 80, 0)] },
  { id: "gradientFlow", description: "Smooth flowing multi-colour gradient (backgrounds, blobs).", params: [cs("colors", "Palette.", ["#ff7eb3", "#ff758c", "#7afcff", "#feffb7"]), n("speed", "Speed.", 0.4, 0)] },
  { id: "toonRim", description: "Cartoon shading with coloured rim light.", params: [c("color", "Base colour.", "#ffb347"), c("rim", "Rim colour.", "#ffffff"), i("steps", "Shading bands.", 3, 1, 8)] },
  { id: "dissolve", description: "Noise dissolve driven by `uniforms.progress` (0..1) — animate it in the timeline.", params: [c("color", "Colour.", "#ffffff"), c("edge", "Burning edge colour.", "#ff7b00"), n("progress", "0 = solid, 1 = gone.", 0, 0, 1)] },
];

// ─── Behaviours ─────────────────────────────────────────────────────────

const AXIS = v3("axis", "Axis.", [0, 1, 0]);

export const BEHAVIOURS: CatalogEntry[] = [
  { id: "rotate", description: "Spin continuously.", params: [AXIS, n("speed", "Degrees per second.", 45)], example: { type: "rotate", axis: [0, 1, 0], speed: 30 } },
  { id: "float", description: "Gentle up-down floating (sine).", params: [n("amplitude", "Height of the motion.", 0.15, 0), n("speed", "Cycles per second.", 0.5, 0), n("phase", "Phase offset (0..1) to desync objects.", 0)] },
  { id: "bob", description: "Bouncy hop (abs sine) — characters, icons.", params: [n("height", "Hop height.", 0.3, 0), n("speed", "Hops per second.", 1.5, 0)] },
  { id: "pulse", description: "Breathing scale.", params: [n("amount", "Scale change (0.1 = ±10%).", 0.08, 0), n("speed", "Cycles per second.", 1, 0)] },
  { id: "wobble", description: "Jelly-like squash and stretch.", params: [n("amount", "Intensity.", 0.08, 0), n("speed", "Speed.", 2, 0)] },
  { id: "sway", description: "Pendulum rotation back and forth (trees, signs).", params: [v3("axis", "Rotation axis.", [0, 0, 1]), n("angle", "Max angle (degrees).", 8, 0), n("speed", "Cycles per second.", 0.5, 0)] },
  { id: "orbit", description: "Move in a circle around a centre.", params: [v3("center", "Centre (parent space).", [0, 0, 0]), n("radius", "Radius.", 2, 0), n("speed", "Degrees per second.", 30), AXIS, b("faceDirection", "Turn to face the direction of travel.", false), n("phase", "Start angle (degrees).", 0)] },
  { id: "path", description: "Follow a smooth path through points.", params: [{ name: "points", type: "array", description: "[[x,y,z], …].", required: true }, n("duration", "Seconds per lap.", 5, 0), b("loop", "Loop (closed curve).", true), b("faceDirection", "Look along the path.", true)] },
  { id: "followPointer", description: "Lean / move toward the mouse or finger.", params: [n("strength", "How far it moves (units).", 0.5, 0), n("smoothing", "0 = instant, 0.95 = very smooth.", 0.9, 0, 0.99), e("mode", "Move or rotate.", ["move", "rotate", "both"], "rotate")] },
  { id: "lookAtPointer", description: "Turn to face the pointer (eyes, heads, turrets).", params: [n("maxAngle", "Max rotation (degrees).", 35, 0), n("smoothing", "Smoothing.", 0.85, 0, 0.99)] },
  { id: "hoverScale", description: "Grow when hovered.", params: [n("scale", "Scale when hovered.", 1.15, 0), n("smoothing", "Smoothing.", 0.8, 0, 0.99)] },
  { id: "hoverLift", description: "Rise and tilt when hovered (cards, products).", params: [n("height", "Lift.", 0.2), n("tilt", "Tilt toward the pointer (degrees).", 10)] },
  { id: "clickBounce", description: "Squash-bounce on click / tap.", params: [n("amount", "Intensity.", 0.25, 0)] },
  { id: "spinOnClick", description: "Do a full spin on click.", params: [AXIS, n("duration", "Seconds.", 0.8, 0)] },
  { id: "scrollRotate", description: "Rotate with the page scroll.", params: [AXIS, n("degrees", "Rotation across the whole scroll range.", 360)] },
  { id: "scrollMove", description: "Move with the page scroll (parallax depth).", params: [v3("offset", "Offset across the scroll range.", [0, 2, 0])] },
  { id: "drift", description: "Slow random wandering inside a box (fish, dust, balloons).", params: [v3("area", "Box size around the start position.", [1, 1, 1]), n("speed", "Speed.", 0.3, 0), i("seed", "Random seed.", 1)] },
  { id: "blink", description: "Toggle visibility / flicker (lights, signs, eyes).", params: [n("interval", "Seconds between blinks.", 3, 0), n("duration", "Blink length.", 0.15, 0), b("random", "Irregular timing.", true)] },
  { id: "colorCycle", description: "Cycle the material colour through a palette.", params: [cs("colors", "Palette.", ["#ff006e", "#8338ec", "#3a86ff"]), n("speed", "Colours per second.", 0.5, 0), b("emissive", "Also drive the emissive colour.", false)] },
  { id: "flicker", description: "Random intensity flicker (fire, candles — on lights or emissive materials).", params: [n("amount", "0..1.", 0.3, 0, 1), n("speed", "Speed.", 8, 0)] },
  { id: "billboard", description: "Always face the camera (sprites, labels).", params: [b("lockY", "Only rotate around Y.", true)] },
  { id: "appear", description: "Entrance animation when the scene becomes visible.", params: [e("effect", "Effect.", ["scale", "fade", "rise", "drop", "spin"], "scale"), n("duration", "Seconds.", 0.8, 0), e("ease", "Easing.", ["outBack", "outCubic", "outElastic", "outBounce"], "outBack")] },
  { id: "magnet", description: "Pulled toward the pointer when close, springs back.", params: [n("radius", "Influence radius (screen fraction 0..1).", 0.25, 0, 1), n("strength", "Pull (units).", 0.4, 0)] },
];

// ─── Generators (procedural content, zero download) ────────────────────

export const GENERATORS: CatalogEntry[] = [
  {
    id: "terrain",
    description: "Heightmap terrain with colour bands (low-poly or smooth): hills, mountains, islands, dunes.",
    params: [n("size", "Width/depth.", 40, 0), i("resolution", "Grid cells per side.", 96, 8, 512), n("height", "Max height.", 6, 0), n("scale", "Noise scale (bigger = wider features).", 1, 0), i("octaves", "Detail levels.", 5, 1, 8), e("shape", "Overall shape.", ["hills", "mountains", "island", "dunes", "canyon", "flat"], "hills"), cs("palette", "Colours from low to high (sand, grass, rock, snow).", ["#e2c290", "#6aa84f", "#38761d", "#7f6a5d", "#ffffff"]), b("lowpoly", "Faceted shading.", true), n("waterLevel", "Water surface height in world units (absolute, not a fraction of height); null = no water.", 0.6), c("waterColor", "Water colour.", "#3d9bd6")],
    cost: "resolution^2*2",
  },
  { id: "trees", description: "Scattered stylised trees.", params: [i("count", "How many.", 30, 1, 2000), v3("area", "Scatter box (x, 0, z).", [30, 0, 30]), e("style", "Tree style.", ["pine", "round", "palm", "birch", "dead", "mixed"], "mixed"), n("minScale", "Min scale.", 0.7, 0), n("maxScale", "Max scale.", 1.4, 0), cs("leafColors", "Foliage colours.", ["#2e7d32", "#43a047", "#66bb6a"]), c("trunkColor", "Trunk colour.", "#6d4c41"), b("onTerrain", "Drop onto a sibling terrain generator.", true), b("sway", "Wind sway animation.", true)], cost: "count*~150" },
  { id: "rocks", description: "Scattered low-poly rocks.", params: [i("count", "How many.", 20, 1, 2000), v3("area", "Scatter box.", [20, 0, 20]), n("minSize", "Min size.", 0.3, 0), n("maxSize", "Max size.", 1.5, 0), cs("colors", "Colours.", ["#8d8d8d", "#757575", "#9e9e9e"]), b("onTerrain", "Drop onto a sibling terrain.", true)], cost: "count*80" },
  { id: "grass", description: "Instanced grass blades swaying in the wind.", params: [i("count", "Blades.", 5000, 1, 100000), v3("area", "Area.", [20, 0, 20]), n("height", "Blade height.", 0.4, 0), cs("colors", "Colours (base → tip).", ["#2d6a1f", "#8bc34a"]), n("wind", "Wind strength.", 0.5, 0), b("onTerrain", "Follow a sibling terrain.", true)], cost: "count*1" },
  { id: "flowers", description: "Scattered little flowers.", params: [i("count", "How many.", 200, 1, 20000), v3("area", "Area.", [20, 0, 20]), cs("colors", "Petal colours.", ["#ff5d8f", "#ffd166", "#ffffff", "#9b5de5"]), b("onTerrain", "Follow a sibling terrain.", true)], cost: "count*40" },
  { id: "water", description: "Animated water surface (waves + specular).", params: [n("size", "Width/depth.", 40, 0), c("color", "Deep colour.", "#1e6fa8"), c("shallowColor", "Light colour.", "#5ec8e5"), n("waveHeight", "Wave height.", 0.15, 0), n("waveSpeed", "Wave speed.", 1, 0), n("opacity", "Opacity.", 0.85, 0, 1)], cost: "~20000" },
  { id: "clouds", description: "Puffy low-poly clouds drifting.", params: [i("count", "Clouds.", 8, 1, 200), v3("area", "Area.", [40, 6, 40]), n("height", "Altitude.", 10), c("color", "Colour.", "#ffffff"), n("speed", "Drift speed.", 0.3, 0)], cost: "count*400" },
  { id: "city", description: "Procedural city blocks with buildings (skylines, isometric towns).", params: [i("blocks", "Blocks per side.", 6, 1, 40), n("blockSize", "Block size.", 4, 0), n("street", "Street width.", 1.2, 0), n("minHeight", "Min building height.", 1, 0), n("maxHeight", "Max building height.", 8, 0), cs("colors", "Building colours.", ["#e0e1dd", "#778da9", "#415a77", "#ffd6a5"]), b("windows", "Lit windows (emissive).", true), c("windowColor", "Window colour.", "#ffe8a3"), b("trees", "Street trees.", true)], cost: "blocks^2*4*12" },
  {
    id: "character",
    description: "Stylised low-poly character built from primitives, with procedural animations (idle, walk, run, wave, jump, dance).",
    params: [e("style", "Body style.", ["humanoid", "robot", "blob", "cat", "bird"], "humanoid"), c("skin", "Skin / body colour.", "#f1c27d"), c("shirt", "Top colour.", "#3a86ff"), c("pants", "Bottom colour.", "#22223b"), c("hair", "Hair colour.", "#3b2a20"), c("accent", "Accent (shoes, eyes, antenna).", "#ff006e"), e("animation", "Animation.", ["idle", "walk", "run", "wave", "jump", "dance", "none"], "idle"), n("animationSpeed", "Animation speed.", 1, 0), n("height", "Total height.", 1.8, 0), b("eyesFollowPointer", "Eyes follow the pointer.", false)],
    cost: "~2000",
  },
  { id: "planet", description: "Small stylised planet with continents, optional rings and atmosphere.", params: [n("radius", "Radius.", 2, 0), cs("palette", "Ocean, land, mountain, ice.", ["#2a6f97", "#52b788", "#8d6e63", "#ffffff"]), n("landAmount", "0..1.", 0.45, 0, 1), b("rings", "Rings.", false), c("ringColor", "Ring colour.", "#e9c46a"), b("atmosphere", "Glow halo.", true), c("atmosphereColor", "Halo colour.", "#8ecae6"), i("detail", "Subdivision.", 5, 1, 7)], cost: "20*4^detail" },
  { id: "starfield", description: "Large sphere of stars around the scene (space backdrops).", params: [i("count", "Stars.", 3000, 1, 50000), n("radius", "Distance.", 80, 0), cs("colors", "Star colours.", ["#ffffff", "#cfe2ff", "#ffe8c2"]), n("size", "Star size.", 0.25, 0), b("twinkle", "Twinkle.", true)], cost: "count" },
  { id: "blob", description: "Organic animated blob (noise-displaced sphere) — modern hero banners.", params: [n("radius", "Radius.", 1.2, 0), n("noise", "Displacement amount.", 0.3, 0), n("speed", "Morph speed.", 0.4, 0), i("detail", "Smoothness.", 64, 8, 256)], cost: "detail^2*2" },
  { id: "waveGrid", description: "Grid of points / bars rippling like a wave (tech / data banners).", params: [i("columns", "Columns.", 60, 2, 400), i("rows", "Rows.", 30, 2, 400), n("spacing", "Spacing.", 0.3, 0), n("amplitude", "Wave height.", 0.5, 0), n("speed", "Speed.", 1, 0), e("shape", "Element.", ["dots", "bars", "lines"], "dots"), cs("colors", "Colour ramp.", ["#3a86ff", "#ff006e"]), b("pointerRipple", "Ripple under the pointer.", true)], cost: "columns*rows*2" },
  { id: "maze", description: "Grid maze walls from a seed (games).", params: [i("columns", "Cells on X.", 10, 2, 60), i("rows", "Cells on Z.", 10, 2, 60), n("cellSize", "Cell size.", 2, 0), n("wallHeight", "Wall height.", 1.5, 0), c("wallColor", "Walls.", "#5e548e"), c("floorColor", "Floor.", "#e0b1cb"), b("bodies", "Add static physics bodies to walls.", true)], cost: "columns*rows*24" },
  { id: "road", description: "Endless-runner road made of tiles that scroll toward the camera.", params: [n("width", "Road width.", 6, 0), n("length", "Visible length.", 60, 0), i("lanes", "Lanes.", 3, 1, 8), c("color", "Asphalt.", "#3d405b"), c("lineColor", "Lane lines.", "#f4f1de"), n("speed", "Scroll speed (units/s), read by scripts as state.speed when set.", 10, 0)], cost: "~200" },
];

// ─── Particles presets ──────────────────────────────────────────────────

export const PARTICLE_PRESETS: CatalogEntry[] = [
  { id: "stars", description: "Twinkling static stars.", params: [] },
  { id: "snow", description: "Falling snowflakes.", params: [] },
  { id: "rain", description: "Falling rain streaks.", params: [] },
  { id: "fireflies", description: "Glowing wandering dots.", params: [] },
  { id: "confetti", description: "Colourful confetti falling and spinning.", params: [] },
  { id: "sparks", description: "Fast upward sparks (additive).", params: [] },
  { id: "dust", description: "Slow floating dust motes.", params: [] },
  { id: "bubbles", description: "Rising bubbles.", params: [] },
  { id: "embers", description: "Rising glowing embers.", params: [] },
  { id: "hearts", description: "Rising little hearts.", params: [] },
];

// ─── Post effects ───────────────────────────────────────────────────────

export const POSTFX: CatalogEntry[] = [
  { id: "bloom", description: "Glow around bright / emissive parts.", params: [n("strength", "Strength.", 0.8, 0), n("radius", "Radius.", 0.4, 0), n("threshold", "Luminance threshold.", 0.85, 0)] },
  { id: "vignette", description: "Darker edges.", params: [n("offset", "Size.", 1, 0), n("darkness", "Darkness.", 1.1, 0)] },
  { id: "film", description: "Film grain + scanlines.", params: [n("intensity", "Grain.", 0.35, 0, 1), b("grayscale", "Black and white.", false)] },
  { id: "chromatic", description: "RGB shift (glitchy / dreamy).", params: [n("amount", "Shift amount.", 0.002, 0)] },
  { id: "pixelate", description: "Retro pixels.", params: [i("pixelSize", "Pixel size.", 4, 1, 32)] },
  { id: "outline", description: "Cartoon outlines (toon look).", params: [c("color", "Line colour.", "#000000"), n("thickness", "Thickness.", 1, 0)] },
  { id: "dof", description: "Depth of field (bokeh).", params: [n("focus", "Focus distance.", 8, 0), n("aperture", "Aperture.", 0.002, 0), n("maxblur", "Max blur.", 0.01, 0)] },
];

// ─── Fonts (bundled, no web font fetch) ─────────────────────────────────

export const FONTS: CatalogEntry[] = [
  { id: "sans-bold", description: "Geometric sans bold (default).", params: [] },
  { id: "sans", description: "Sans regular.", params: [] },
  { id: "serif-bold", description: "Serif bold.", params: [] },
  { id: "mono", description: "Monospace (tech).", params: [] },
  { id: "display", description: "Rounded display font (playful).", params: [] },
];

// ─── Synth sounds (WebAudio, zero bytes) ────────────────────────────────

export const SOUND_PRESETS: CatalogEntry[] = [
  { id: "coin", description: "Pickup / coin.", params: [] },
  { id: "jump", description: "Jump.", params: [] },
  { id: "hit", description: "Hit / damage.", params: [] },
  { id: "explosion", description: "Explosion.", params: [] },
  { id: "click", description: "UI click.", params: [] },
  { id: "powerup", description: "Power-up arpeggio.", params: [] },
  { id: "laser", description: "Laser shot.", params: [] },
  { id: "win", description: "Victory jingle.", params: [] },
  { id: "lose", description: "Game over.", params: [] },
  { id: "whoosh", description: "Whoosh.", params: [] },
  { id: "ambient-pad", description: "Soft looping pad (music).", params: [] },
  { id: "chiptune-loop", description: "Cheerful chiptune loop (music).", params: [] },
];

export const CATALOG = {
  geometries: GEOMETRIES,
  materialPresets: MATERIAL_PRESETS,
  shaders: SHADERS,
  behaviours: BEHAVIOURS,
  generators: GENERATORS,
  particlePresets: PARTICLE_PRESETS,
  postfx: POSTFX,
  fonts: FONTS,
  sounds: SOUND_PRESETS,
} as const;

export type CatalogSection = keyof typeof CATALOG;

export function catalogEntry(section: Exclude<CatalogSection, "materialPresets">, id: string): CatalogEntry | undefined {
  return (CATALOG[section] as CatalogEntry[]).find((x) => x.id === id);
}

export function materialPreset(id: string): MaterialPreset | undefined {
  return MATERIAL_PRESETS.find((p) => p.id === id);
}
