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
  // Generators: what an object-level `material` override applies to (absent →
  // the generator ignores `material`).
  material?: string;
  // Post effects: GPU cost tier ("low" | "medium" | "high"), used by quality
  // tiers (target.quality) and `check`.
  gpu?: "low" | "medium" | "high";
  // Extra reference data shown by `catalog_get` / `agent3d catalog <section> <id>`
  // (e.g. what each look preset expands to).
  details?: Record<string, unknown>;
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
  { id: "brushedMetal", description: "Brushed steel.", props: { type: "physical", color: "#c8ccd2", roughness: 0.35, metalness: 1, anisotropy: 0.6 } },
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
  // ─ Photoreal / product presets (physical; look best with HDRI or studio lighting) ─
  { id: "carPaint", description: "Metallic car paint: sparkling flakes under a glossy clearcoat.", props: { type: "physical", color: "#b3121f", metalness: 0.6, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.03, normalMap: { procedural: "flakes", scale: 40 }, normalScale: 0.2 } },
  { id: "ceramic", description: "Glazed ceramic / porcelain (soft body, glossy glaze).", props: { type: "physical", color: "#f3efe8", roughness: 0.45, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 } },
  { id: "marble", description: "Polished white marble with grey veins (procedural, triplanar-mapped: no UV stretching).", props: { type: "physical", color: "#ffffff", roughness: 0.2, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.1, map: { procedural: "marble" }, triplanar: 0.5 } },
  { id: "terrazzo", description: "Terrazzo stone with coloured chips (procedural, triplanar-mapped).", props: { type: "physical", color: "#ffffff", roughness: 0.45, metalness: 0, map: { procedural: "terrazzo" }, triplanar: 0.5 } },
  { id: "wood", description: "Varnished wood grain (procedural texture).", props: { type: "physical", color: "#ffffff", roughness: 0.5, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2, map: { procedural: "wood" } } },
  { id: "carbonFiber", description: "Woven carbon fibre under clearcoat (procedural texture).", props: { type: "physical", color: "#ffffff", roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, map: { procedural: "carbon", scale: 12 }, anisotropy: 0.5 } },
  { id: "leather", description: "Fine-grain leather with soft sheen.", props: { type: "physical", color: "#6b3a22", roughness: 0.62, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: "#c49a7a", bumpMap: { procedural: "voronoi", scale: 60 }, bumpScale: 0.6 } },
  { id: "satin", description: "Satin fabric: soft anisotropic sheen.", props: { type: "physical", color: "#c9a0dc", roughness: 0.4, metalness: 0, sheen: 1, sheenRoughness: 0.3, sheenColor: "#ffffff", anisotropy: 0.4 } },
  { id: "silk", description: "Silk: bright, very soft sheen.", props: { type: "physical", color: "#f2d7c9", roughness: 0.3, metalness: 0, sheen: 1, sheenRoughness: 0.2, sheenColor: "#fff4ec", specularIntensity: 0.6 } },
  { id: "brushedAluminium", description: "Brushed aluminium with stretched (anisotropic) highlights.", props: { type: "physical", color: "#d9dce1", roughness: 0.3, metalness: 1, anisotropy: 0.85, roughnessMap: { procedural: "brushed", scale: 1 } } },
  { id: "ice", description: "Clear blue-tinted ice with a frosty surface.", props: { type: "physical", color: "#eaf8ff", roughness: 0.1, metalness: 0, transmission: 1, thickness: 1.2, ior: 1.31, attenuationColor: "#8fd3ff", attenuationDistance: 1.2, bumpMap: { procedural: "noise", scale: 3 }, bumpScale: 0.4 } },
  { id: "water", description: "Liquid water: clear, slightly blue-green.", props: { type: "physical", color: "#ffffff", roughness: 0.02, metalness: 0, transmission: 1, thickness: 1, ior: 1.333, attenuationColor: "#4fc3d9", attenuationDistance: 2 } },
  { id: "diamond", description: "Diamond: high IOR with rainbow dispersion (fire).", props: { type: "physical", color: "#ffffff", roughness: 0, metalness: 0, transmission: 1, thickness: 2.5, ior: 2.33, dispersion: 8, specularIntensity: 1, envMapIntensity: 2.5, attenuationColor: "#dde8ff", attenuationDistance: 3 } },
  { id: "gem", description: "Coloured gemstone (ruby-like; change color/attenuationColor for sapphire, emerald…).", props: { type: "physical", color: "#ffe5ec", roughness: 0, metalness: 0, transmission: 1, thickness: 1, ior: 1.77, dispersion: 2, attenuationColor: "#e0115f", attenuationDistance: 0.5, envMapIntensity: 1.4 } },
  { id: "jelly", description: "Gummy jelly: coloured, translucent, glossy.", props: { type: "physical", color: "#ff7aa2", roughness: 0.12, metalness: 0, transmission: 0.95, thickness: 1.5, ior: 1.35, attenuationColor: "#ff2d6f", attenuationDistance: 0.6, clearcoat: 1, clearcoatRoughness: 0.1 } },
  { id: "chromeGradient", description: "Chrome tinted by a colour ramp (set `gradient`).", props: { type: "gradient", gradient: ["#7f5cff", "#ff5ca8", "#ffd36e"], metalness: 1, roughness: 0.08 } },
  { id: "soapBubble", description: "Soap bubble: clear with thin-film rainbow reflections.", props: { type: "physical", color: "#ffffff", roughness: 0, metalness: 0, transmission: 1, thickness: 0.05, ior: 1.1, iridescence: 1, iridescenceIOR: 1.33, iridescenceThicknessRange: [120, 900], side: "double" } },
  { id: "mattePastel", description: "Soft matte pastel with a velvety edge (stylised product renders).", props: { type: "physical", color: "#f7c8d8", roughness: 0.75, metalness: 0, sheen: 0.4, sheenRoughness: 0.8, sheenColor: "#ffffff" } },
  { id: "emissiveGradient", description: "Glowing colour ramp (set `gradient`; blooms with postfx bloom).", props: { type: "gradient", gradient: ["#00e5ff", "#7c4dff", "#ff3d9a"], emissive: "#ffffff", emissiveIntensity: 1.6, gradientEmissive: true, roughness: 0.4 } },
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
  { id: "gradientMesh", description: "Animated mesh gradient (Stripe-like soft colour blobs) — perfect banner backdrop on a plane.", params: [cs("colors", "Up to 6 colours.", ["#ff6ec4", "#7873f5", "#4adede", "#ffd86f"]), n("speed", "Animation speed.", 0.25, 0), n("scale", "Blob scale (higher = more blobs).", 1, 0.1), n("grain", "Film grain amount.", 0.04, 0, 1)] },
  { id: "aurora", description: "Northern-lights curtains over a dark sky (planes, sky domes).", params: [cs("colors", "Curtain colours.", ["#00ffa3", "#00b3ff", "#b400ff"]), c("background", "Sky colour.", "#030714"), n("speed", "Speed.", 0.3, 0), n("intensity", "Brightness.", 1.2, 0)] },
  { id: "liquidChrome", description: "Flowing liquid chrome / metaballs with a coloured reflection ramp.", params: [cs("colors", "Reflection ramp.", ["#0a0a12", "#5a5f7a", "#e8ecff", "#9ab8ff"]), n("speed", "Flow speed.", 0.35, 0), n("scale", "Pattern scale.", 1.5, 0.1)] },
  { id: "nebula", description: "Deep-space nebula with stars (star-nest style) — space backdrops.", params: [cs("colors", "Gas colours.", ["#1b0b3b", "#7b2ff7", "#f72585", "#4cc9f0"]), n("speed", "Drift speed.", 0.05, 0), n("stars", "Star density.", 1, 0, 3), n("scale", "Scale.", 1, 0.1)] },
  { id: "caustics", description: "Underwater light caustics (pools, water floors, light patterns).", params: [c("color", "Light colour.", "#bff6ff"), c("background", "Base colour.", "#05677d"), n("speed", "Speed.", 0.5, 0), n("scale", "Pattern scale.", 3, 0.1), n("intensity", "Brightness.", 1.4, 0)] },
  { id: "fresnelGlow", description: "Glowing rim (fresnel) — force fields, atmospheres, x-ray looks (additive, transparent).", params: [c("color", "Rim colour.", "#4cc9f0"), c("core", "Centre colour (black = see-through).", "#000000"), n("power", "Rim sharpness.", 2.5, 0.1), n("intensity", "Brightness.", 1.5, 0), n("pulse", "Pulse speed (0 = steady).", 0, 0)] },
  { id: "iridescentFoil", description: "Holographic foil: view-dependent rainbow with fine noise sparkle.", params: [n("speed", "Shimmer speed.", 0.3, 0), n("scale", "Rainbow bands.", 2, 0.1), n("sparkle", "Glitter amount.", 0.5, 0, 1), c("tint", "Tint.", "#ffffff")] },
  { id: "lavaLamp", description: "Soft rising lava-lamp blobs (warm retro backdrops).", params: [cs("colors", "Background → blob colours.", ["#2a0845", "#ff512f", "#f09819"]), n("speed", "Speed.", 0.3, 0), n("scale", "Blob size.", 1, 0.1)] },
  { id: "grainGradient", description: "Static-friendly grainy gradient (editorial, film look).", params: [cs("colors", "Gradient colours.", ["#ffb88c", "#de6262", "#4b1248"]), n("angle", "Gradient angle (degrees).", 30), n("grain", "Grain amount.", 0.06, 0, 1), n("speed", "Grain animation (0 = static).", 0, 0)] },
  { id: "matrixRain", description: "Falling digital glyph rain (cyber / hacker look).", params: [c("color", "Glyph colour.", "#3dff7a"), c("background", "Background.", "#000a03"), n("speed", "Fall speed.", 1, 0), n("columns", "Columns across the surface.", 40, 4, 200)] },
];

// ─── Procedural textures (material texture slots) ───────────────────────
// Any texture slot (map, normalMap, roughnessMap, bumpMap, …) accepts
// { "procedural": "<id>", …params } instead of a file: the texture is generated
// at load time (deterministic, zero bytes, tiles seamlessly). Colour slots use
// `colors`; data slots (roughness, bump, normal…) use the pattern's height.

const TEX_COMMON = [n("scale", "Pattern repeats across the texture.", 1, 0.05), i("seed", "Random seed.", 1), i("resolution", "Texture size in pixels.", 512, 32, 2048)];

export const TEXTURES: CatalogEntry[] = [
  { id: "marble", description: "Veined marble.", params: [cs("colors", "Base → vein colours.", ["#f4f2ee", "#b9b6b1", "#5d5a57"]), n("veins", "Vein sharpness.", 0.6, 0, 1), n("turbulence", "Vein waviness.", 1, 0), ...TEX_COMMON] },
  { id: "wood", description: "Wood grain (rings + fibres).", params: [cs("colors", "Light → dark wood.", ["#d9a066", "#a0632f", "#6b3a17"]), n("rings", "Growth rings.", 10, 1), n("grain", "Fibre detail.", 0.5, 0, 1), ...TEX_COMMON] },
  { id: "terrazzo", description: "Terrazzo: stone chips in a cement base.", params: [cs("colors", "Base colour, then chip colours.", ["#efe9e1", "#e07a5f", "#3d405b", "#81b29a", "#f2cc8f"]), n("density", "Chip density.", 0.5, 0, 1), n("chipSize", "Chip size.", 1, 0.2, 4), ...TEX_COMMON] },
  { id: "carbon", description: "Twill-woven carbon fibre.", params: [cs("colors", "Dark → light fibre.", ["#0b0b0d", "#2a2c31", "#5b5e66"]), ...TEX_COMMON] },
  { id: "noise", description: "Smooth fractal noise (clouds, stains, variation, bump).", params: [cs("colors", "Ramp colours.", ["#000000", "#ffffff"]), i("octaves", "Detail layers.", 5, 1, 8), n("contrast", "Contrast.", 1, 0), ...TEX_COMMON] },
  { id: "voronoi", description: "Cells (leather grain, scales, cracked ground, stone).", params: [cs("colors", "Cell colour → border colour.", ["#ffffff", "#000000"]), n("jitter", "Cell irregularity.", 1, 0, 1), ...TEX_COMMON] },
  { id: "flakes", description: "Metallic paint flakes — use as normalMap (sparkle) or roughnessMap.", params: [cs("colors", "Flake colours (map slot).", ["#808080", "#ffffff"]), n("strength", "Flake tilt (normal slot).", 0.6, 0, 1), ...TEX_COMMON] },
  { id: "brushed", description: "Brushed-metal streaks — use as roughnessMap or bumpMap.", params: [cs("colors", "Ramp colours.", ["#9a9a9a", "#d0d0d0"]), n("streaks", "Streak density.", 1, 0.1), ...TEX_COMMON] },
  { id: "grid", description: "Grid lines (blueprint, tiles, sci-fi floors).", params: [cs("colors", "Background → line colours.", ["#0b1d3a", "#6fd3ff"]), i("cells", "Cells per texture side.", 8, 1, 256), n("lineWidth", "Line width (fraction of a cell).", 0.04, 0, 0.5), ...TEX_COMMON] },
  { id: "checker", description: "Checkerboard.", params: [cs("colors", "Two colours.", ["#ffffff", "#222222"]), i("cells", "Cells per texture side.", 8, 1, 256), ...TEX_COMMON] },
  { id: "stripes", description: "Stripes.", params: [cs("colors", "Alternating colours.", ["#ffffff", "#ff4d6d"]), i("count", "Stripes per texture side.", 8, 1, 256), n("angle", "Angle in degrees (0, 45, 90 tile seamlessly).", 0), n("softness", "Edge softness.", 0.05, 0, 0.5), ...TEX_COMMON] },
  { id: "dots", description: "Polka dots.", params: [cs("colors", "Background → dot colours.", ["#ffffff", "#ff4d6d"]), i("cells", "Dots per texture side.", 8, 1, 256), n("radius", "Dot radius (fraction of a cell).", 0.3, 0, 0.5), ...TEX_COMMON] },
];

// ─── Light rigs (environment.rig) ───────────────────────────────────────
// Named lighting setups expanded into lights at build time (added to
// `lights`). `environment.rig: "<id>"` or { "preset": "<id>", …params }.

const RIG_COMMON = [n("intensity", "Overall brightness multiplier.", 1, 0), n("rotation", "Rotate the whole rig around Y (degrees).", 0), b("castShadow", "Key light casts shadows.", true), n("scale", "Distance multiplier (big scenes).", 1, 0.05), c("color", "Tint mixed into every light (optional).")];

export const LIGHT_RIGS: CatalogEntry[] = [
  { id: "studio-3point", description: "Classic key / fill / rim: warm key with soft shadow, cool fill, bright back rim. Safe default for anything.", params: RIG_COMMON },
  { id: "softbox", description: "Large overhead and side softboxes (area lights): soft wrap-around product lighting with long glossy highlights.", params: RIG_COMMON },
  { id: "product-top", description: "Overhead softbox + two vertical strip lights: luxury product / packshot look (best on glossy and metal).", params: RIG_COMMON },
  { id: "rim", description: "Two strong back rims (cool and warm) and a faint front fill: silhouettes and edge highlights on dark backgrounds.", params: RIG_COMMON },
  { id: "dramatic", description: "One hard side key (spot) with deep shadows and a thin rim — moody, high contrast.", params: RIG_COMMON },
  { id: "golden-hour", description: "Low warm sun with long shadows and a blue sky fill.", params: RIG_COMMON },
  { id: "noon", description: "High white sun with crisp shadows and a sky-blue fill.", params: RIG_COMMON },
  { id: "overcast", description: "Soft shadowless daylight (big sky dome, faint top key).", params: RIG_COMMON },
  { id: "neon", description: "Magenta and cyan side lights (area panels) over a dark ambient — night / synthwave.", params: RIG_COMMON },
  { id: "moonlight", description: "Cool blue moon key with soft shadows and a dim night-sky fill.", params: RIG_COMMON },
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
  { id: "spinOnClick", description: "Do a full spin on click (or each time the pointer enters, with trigger hover).", params: [AXIS, n("duration", "Seconds.", 0.8, 0), e("trigger", "What starts a spin: a click / tap, or the pointer entering the object.", ["click", "hover"], "click")] },
  { id: "scrollRotate", description: "Rotate with the page scroll.", params: [AXIS, n("degrees", "Rotation across the whole scroll range.", 360)] },
  { id: "scrollMove", description: "Move with the page scroll (parallax depth).", params: [v3("offset", "Offset across the scroll range.", [0, 2, 0])] },
  { id: "drift", description: "Slow random wandering inside a box (fish, dust, balloons).", params: [v3("area", "Box size around the start position.", [1, 1, 1]), n("speed", "Speed.", 0.3, 0), i("seed", "Random seed.", 1)] },
  { id: "blink", description: "Toggle visibility / flicker (lights, signs, eyes).", params: [n("interval", "Seconds between blinks.", 3, 0), n("duration", "Blink length.", 0.15, 0), b("random", "Irregular timing.", true)] },
  { id: "colorCycle", description: "Cycle the material colour through a palette.", params: [cs("colors", "Palette.", ["#ff006e", "#8338ec", "#3a86ff"]), n("speed", "Colours per second.", 0.5, 0), b("emissive", "Also drive the emissive colour.", false)] },
  { id: "flicker", description: "Random intensity flicker (fire, candles — on lights or emissive materials).", params: [n("amount", "0..1.", 0.3, 0, 1), n("speed", "Speed.", 8, 0)] },
  { id: "billboard", description: "Always face the camera (sprites, labels).", params: [b("lockY", "Only rotate around Y.", true)] },
  { id: "appear", description: "Entrance animation when the scene becomes visible.", params: [e("effect", "Effect.", ["scale", "fade", "rise", "drop", "spin"], "scale"), n("duration", "Seconds.", 0.8, 0), e("ease", "Easing.", ["outBack", "outCubic", "outElastic", "outBounce"], "outBack")] },
  { id: "magnet", description: "Pulled toward the pointer when close, springs back.", params: [n("radius", "Influence radius (screen fraction 0..1).", 0.25, 0, 1), n("strength", "Pull (units).", 0.4, 0)] },
  { id: "spring", description: "Follow the pointer with spring physics (overshoot and settle) — lively cards, mascots.", params: [n("strength", "Travel (units) at the canvas edge.", 0.4, 0), n("stiffness", "Spring stiffness (higher = snappier).", 120, 1), n("damping", "Damping (lower = more bounce).", 12, 0), n("mass", "Mass.", 1, 0.01), e("mode", "Move, lean (rotate) or both.", ["move", "rotate", "both"], "move"), n("angle", "Lean at the edge (degrees, rotate mode).", 15, 0)], example: { type: "spring", mode: "both", strength: 0.3, damping: 9 } },
  { id: "parallax", description: "Depth layer moving with the pointer (and the page scroll) in proportion to its depth — stack layers with different depths.", params: [n("depth", "0 = background, 1 = foreground (negative: opposite way).", 0.5), n("pointer", "Pointer travel (units) at depth 1.", 0.3), n("scroll", "Vertical travel (units) across the scroll range at depth 1.", 0), n("smoothing", "Smoothing.", 0.9, 0, 0.99)], example: { type: "parallax", depth: 1, pointer: 0.4 } },
  { id: "tilt", description: "Card tilt: leans toward the pointer, lifts and scales up (product cards, posters).", params: [n("maxAngle", "Max tilt (degrees).", 12, 0, 60), n("scale", "Scale while active.", 1.04, 0), n("lift", "Move toward the camera (units, +Z).", 0.1), b("hoverOnly", "Only while the object is hovered (else whenever the pointer is over the canvas).", true), b("reverse", "Lean away from the pointer.", false), n("smoothing", "Smoothing.", 0.86, 0, 0.99)] },
  { id: "breathe", description: "Organic breathing: slow inhale, shorter exhale, Y expands most (idle characters, blobs).", params: [n("amount", "Scale change (0.04 = 4 %).", 0.04, 0), n("period", "Seconds per breath.", 4, 0.1), n("rise", "Rise at full inhale (units).", 0.02), n("phase", "Phase offset (0..1).", 0)] },
  { id: "noise", description: "Organic wandering from smooth noise: position + rotation (calmer, less repetitive than float / sway).", params: [v3("amplitude", "Position amplitude per axis (units).", [0.1, 0.1, 0.05]), v3("rotation", "Rotation amplitude per axis (degrees).", [3, 3, 2]), n("speed", "Speed.", 0.3, 0), i("seed", "Noise seed.", 1)] },
  { id: "lookAt", description: "Turn to face another object, the camera or a point (smoothed). The object's front is +Z.", params: [{ name: "target", type: "string", description: 'Object id or "camera" (default).', default: "camera" }, v3("point", "Look at this point instead (parent space of the scene)."), n("smoothing", "Smoothing.", 0.85, 0, 0.99), b("lockY", "Only turn around the vertical axis.", false)], example: { type: "lookAt", target: "hero", lockY: true } },
];

// ─── Generators (procedural content, zero download) ────────────────────

export const GENERATORS: CatalogEntry[] = [
  {
    id: "terrain",
    description: "Heightmap terrain with colour bands (low-poly or smooth): hills, mountains, islands, dunes.",
    params: [n("size", "Width/depth.", 40, 0), i("resolution", "Grid cells per side.", 96, 8, 512), n("height", "Max height.", 6, 0), n("scale", "Noise scale (bigger = wider features).", 1, 0), i("octaves", "Detail levels.", 5, 1, 8), e("shape", "Overall shape.", ["hills", "mountains", "island", "dunes", "canyon", "flat"], "hills"), cs("palette", "Colours from low to high (sand, grass, rock, snow).", ["#e2c290", "#6aa84f", "#38761d", "#7f6a5d", "#ffffff"]), b("lowpoly", "Faceted shading.", true), n("waterLevel", "Water surface height in world units (absolute, not a fraction of height); null = no water.", 0.6), c("waterColor", "Water colour.", "#3d9bd6"), n("snowLine", "Height fraction (0..1, above the water) where the last palette colour (snow) caps the peaks; 1 = summit only.", 1, 0, 1)],
    cost: "resolution^2*2",
    material: "The ground (not the water plane). Without colour / preset / map the palette bands are kept (e.g. { \"roughness\": 0.6, \"flatShading\": false }).",
  },
  { id: "trees", description: "Scattered stylised trees.", params: [i("count", "How many.", 30, 1, 2000), v3("area", "Scatter box (x, 0, z).", [30, 0, 30]), e("style", "Tree style.", ["pine", "round", "palm", "birch", "dead", "mixed"], "mixed"), n("minScale", "Min scale.", 0.7, 0), n("maxScale", "Max scale.", 1.4, 0), cs("leafColors", "Foliage colours.", ["#2e7d32", "#43a047", "#66bb6a"]), c("trunkColor", "Trunk colour.", "#6d4c41"), b("onTerrain", "Drop onto a sibling terrain generator.", true), b("sway", "Wind sway animation.", true)], cost: "count*~150" },
  { id: "rocks", description: "Scattered low-poly rocks.", params: [i("count", "How many.", 20, 1, 2000), v3("area", "Scatter box.", [20, 0, 20]), n("minSize", "Min size.", 0.3, 0), n("maxSize", "Max size.", 1.5, 0), cs("colors", "Colours.", ["#8d8d8d", "#757575", "#9e9e9e"]), b("onTerrain", "Drop onto a sibling terrain.", true)], cost: "count*80", material: "Every rock. Without colour / preset / map the per-rock colours are kept." },
  { id: "grass", description: "Instanced grass blades swaying in the wind.", params: [i("count", "Blades.", 5000, 1, 100000), v3("area", "Area.", [20, 0, 20]), n("height", "Blade height.", 0.4, 0), cs("colors", "Colours (base → tip).", ["#2d6a1f", "#8bc34a"]), n("wind", "Wind strength.", 0.5, 0), b("onTerrain", "Follow a sibling terrain.", true)], cost: "count*1" },
  { id: "flowers", description: "Scattered little flowers.", params: [i("count", "How many.", 200, 1, 20000), v3("area", "Area.", [20, 0, 20]), cs("colors", "Petal colours.", ["#ff5d8f", "#ffd166", "#ffffff", "#9b5de5"]), b("onTerrain", "Follow a sibling terrain.", true)], cost: "count*40" },
  { id: "water", description: "Animated stylised water: waves, shallow → deep colour from the terrain depth below, animated shore foam lines, ripple normals with a moving sun glint, fresnel.", params: [n("size", "Width/depth.", 40, 0), c("color", "Deep colour.", "#1e6fa8"), c("shallowColor", "Shallow / crest colour.", "#5ec8e5"), c("foamColor", "Foam colour.", "#ffffff"), n("waveHeight", "Wave height.", 0.15, 0), n("waveSpeed", "Wave speed.", 1, 0), n("foam", "Shore foam band width (depth units; 0 = none). Needs a sibling terrain below.", 0.6, 0), n("ripples", "Ripple normal strength (sun glint).", 1, 0), n("depthRange", "Depth at which the colour is fully deep.", 3, 0.01), n("opacity", "Opacity.", 0.9, 0, 1), b("lowpoly", "Faceted low-poly water (no ripples).", false)], cost: "~20000" },
  { id: "clouds", description: "Drifting clouds: soft puffy cotton balls (or faceted low-poly), bright tops, cool shadowed undersides, silver-lining rim.", params: [i("count", "Clouds.", 8, 1, 200), v3("area", "Area.", [40, 6, 40]), n("height", "Altitude.", 10), n("size", "Cloud size factor.", 1, 0), c("color", "Colour (lit tops).", "#ffffff"), c("shadowColor", "Underside colour.", "#a9bdd6"), n("speed", "Drift speed.", 0.3, 0), e("style", "puffy = smooth soft puffs, lowpoly = faceted.", ["puffy", "lowpoly"], "puffy")], cost: "count*1500" },
  { id: "city", description: "Procedural city blocks with buildings (skylines, isometric towns).", params: [i("blocks", "Blocks per side.", 6, 1, 40), n("blockSize", "Block size.", 4, 0), n("street", "Street width.", 1.2, 0), n("minHeight", "Min building height.", 1, 0), n("maxHeight", "Max building height.", 8, 0), cs("colors", "Building colours.", ["#e0e1dd", "#778da9", "#415a77", "#ffd6a5"]), b("windows", "Lit windows (emissive).", true), c("windowColor", "Window colour.", "#ffe8a3"), b("trees", "Street trees.", true)], cost: "blocks^2*4*12" },
  {
    id: "character",
    description: "Chibi character or mascot built from soft clay-like primitives on a real skeleton: expressive face (eyes with highlights, brows, mouth expressions), hair styles, outfits, accessories and procedural animations (idle, walk, run, wave, jump, dance, cheer, celebrate, sit, point, talk). Styles: humanoid, astronaut (bubble helmet), robot (glowing screen face), blob, cat, fox, bird, ghost.",
    params: [
      e("style", "Body style.", ["humanoid", "astronaut", "robot", "blob", "cat", "fox", "bird", "ghost"], "humanoid"),
      c("skin", "Skin / fur / body colour (default per style)."),
      c("shirt", "Top / suit colour (robot: metal, blob: body, bird: wings; default per style)."),
      c("pants", "Bottom colour (robot: joints; default per style)."),
      c("hair", "Hair / brows colour (cat: stripes, fox: socks and ear tips, bird: crest; default per style)."),
      c("accent", "Accent: shoes, caps, scarves, robot glow, nose, beak (default per style)."),
      e("expression", "Facial expression (cheer / celebrate / dance / run switch the default happy face to a laugh).", ["happy", "laugh", "neutral", "surprised", "wink", "sad", "angry", "sleepy"], "happy"),
      e("hairStyle", "Hair style (humanoid).", ["short", "long", "bob", "bun", "ponytail", "spiky", "curly", "none"], "short"),
      e("outfit", "Outfit (humanoid).", ["tshirt", "hoodie", "dress", "suit", "overalls"], "tshirt"),
      { name: "accessories", type: "array", description: "Accessories (humanoid / astronaut): any of cap, beanie, crown, glasses, sunglasses, headphones, backpack, scarf, bowtie.", default: [], options: ["cap", "beanie", "glasses", "sunglasses", "headphones", "backpack", "scarf", "bowtie", "crown"] },
      e("animation", "Animation. sit = sitting on the ground; point = points to the screen right (mirror with scale [-1, 1, 1] to point left).", ["idle", "walk", "run", "wave", "jump", "dance", "cheer", "celebrate", "sit", "point", "talk", "none"], "idle"),
      n("animationSpeed", "Animation speed.", 1, 0),
      n("height", "Total height.", 1.8, 0),
      e("shading", "smooth = soft claymation, lowpoly = faceted (fewer triangles), toon = cel-shaded.", ["smooth", "lowpoly", "toon"], "smooth"),
      b("eyesFollowPointer", "Head turns toward the pointer.", false),
    ],
    cost: "~14000",
  },
  { id: "planet", description: "Small stylised planet with continents, optional rings and atmosphere.", params: [n("radius", "Radius.", 2, 0), cs("palette", "Ocean, land, mountain, ice.", ["#2a6f97", "#52b788", "#8d6e63", "#ffffff"]), n("landAmount", "0..1.", 0.45, 0, 1), b("rings", "Rings.", false), c("ringColor", "Ring colour.", "#e9c46a"), b("atmosphere", "Glow halo.", true), c("atmosphereColor", "Halo colour.", "#8ecae6"), i("detail", "Subdivision.", 5, 1, 7), n("spin", "Globe rotation around its own (ring) axis in deg/s — use this rather than a rotate behaviour so the rings stay stable.", 0)], cost: "20*4^detail", material: "The globe surface (ocean + land; rings and atmosphere keep theirs). Without colour / preset / map the palette is kept." },
  { id: "starfield", description: "Large sphere of stars around the scene (space backdrops).", params: [i("count", "Stars.", 3000, 1, 50000), n("radius", "Distance.", 80, 0), cs("colors", "Star colours.", ["#ffffff", "#cfe2ff", "#ffe8c2"]), n("size", "Star size.", 0.25, 0), b("twinkle", "Twinkle.", true)], cost: "count" },
  { id: "blob", description: "Organic animated blob (noise-displaced sphere) — modern hero banners.", params: [n("radius", "Radius.", 1.2, 0), n("noise", "Displacement amount.", 0.3, 0), n("speed", "Morph speed.", 0.4, 0), i("detail", "Smoothness.", 64, 8, 256), cs("colors", "Colour ramp flowing over the surface (brand colours).", ["#ff7eb3", "#a78bfa", "#60a5fa", "#5eead4"])], cost: "detail^2*2", material: "The whole blob; the morph keeps running with any material, shaders included (e.g. { \"type\": \"shader\", \"shader\": \"gradientFlow\" }, { \"preset\": \"chrome\" }). Without colour / preset / map the colour ramp is kept (e.g. { \"type\": \"toon\" })." },
  { id: "waveGrid", description: "Grid of points / bars rippling like a wave (tech / data banners).", params: [i("columns", "Columns.", 60, 2, 400), i("rows", "Rows.", 30, 2, 400), n("spacing", "Spacing.", 0.3, 0), n("amplitude", "Wave height.", 0.5, 0), n("speed", "Speed.", 1, 0), e("shape", "Element.", ["dots", "bars", "lines"], "dots"), cs("colors", "Colour ramp.", ["#3a86ff", "#ff006e"]), b("pointerRipple", "Ripple under the pointer.", true)], cost: "columns*rows*2" },
  { id: "maze", description: "Grid maze walls from a seed (games).", params: [i("columns", "Cells on X.", 10, 2, 60), i("rows", "Cells on Z.", 10, 2, 60), n("cellSize", "Cell size.", 2, 0), n("wallHeight", "Wall height.", 1.5, 0), c("wallColor", "Walls.", "#5e548e"), c("floorColor", "Floor.", "#e0b1cb"), b("bodies", "Add static physics bodies to walls.", true)], cost: "columns*rows*24" },
  { id: "road", description: "Endless-runner road made of tiles that scroll toward the camera.", params: [n("width", "Road width.", 6, 0), n("length", "Visible length.", 60, 0), i("lanes", "Lanes.", 3, 1, 8), c("color", "Asphalt.", "#3d405b"), c("lineColor", "Lane lines.", "#f4f1de"), n("speed", "Scroll speed (units/s), read by scripts as state.speed when set.", 10, 0)], cost: "~200" },
  {
    id: "floatingIsland",
    description: "Stylised floating island diorama (hero favourite): grassy rolling top with a noisy outline, dirt band, rocky underside tapering to stalactite tips with coloured strata; optional trees, rocks, flowers, grass, a pond with a waterfall, floating debris and a slow bob.",
    params: [n("radius", "Top radius.", 3, 0.1), n("depth", "Underside depth (top to tip).", 3.6, 0.1), n("hills", "Top relief (0 = flat lawn).", 1, 0, 4), cs("grassColors", "Grass colours (dark → light).", ["#4f9a3a", "#7cc24a", "#b5dd6a"]), c("dirtColor", "Dirt band colour.", "#8a5a3c"), cs("rockColors", "Rock strata colours of the underside.", ["#7d6b5e", "#93806f", "#6a5a52", "#a08c76"]), i("trees", "Trees planted on top.", 6, 0, 200), e("treeStyle", "Tree style.", ["pine", "round", "palm", "birch", "dead", "mixed"], "round"), cs("leafColors", "Tree foliage colours.", ["#2e7d32", "#43a047", "#7cb342"]), i("rocks", "Rocks on top.", 5, 0, 200), i("flowers", "Flowers on top.", 60, 0, 5000), i("grass", "Grass blades on top.", 1500, 0, 30000), b("waterfall", "Pond + waterfall pouring off the edge.", true), c("waterColor", "Pond / waterfall colour.", "#4fc3f7"), i("debris", "Small rocks floating around.", 6, 0, 100), n("float", "Bob amplitude (0 = still).", 0.12, 0), b("lowpoly", "Faceted shading.", true)],
    cost: "~6000+trees*150+grass+flowers*40",
    material: "The island body (top + underside). Without colour / preset / map the vertex colours are kept.",
  },
  {
    id: "globe",
    description: "Data globe for SaaS / network heroes: dot-matrix Earth (simplified continents), fresnel atmosphere, pulsing location markers and great-circle arcs with travelling light pulses between lat/lon points.",
    params: [n("radius", "Radius.", 2, 0.1), i("dots", "Dot lattice density (dots on the whole sphere before the land mask).", 12000, 200, 60000), b("continents", "Dots only on land (simplified continents).", true), c("dotColor", "Land dot colour.", "#7dd3fc"), c("oceanDotColor", "Ocean dot colour (same as baseColor = no ocean dots).", "#0b1630"), c("baseColor", "Globe body colour.", "#0b1630"), n("dotSize", "Dot size factor.", 1, 0), { name: "points", type: "array", description: "Markers: [[lat, lon], …] or [{ \"lat\": 48.85, \"lon\": 2.35 }, …].", default: [] }, { name: "arcs", type: "array", description: "Arcs: [[[lat, lon], [lat, lon]], …] or [{ \"from\": [lat, lon], \"to\": [lat, lon] }, …]. Endpoints get markers.", default: [] }, c("arcColor", "Arc colour.", "#f472b6"), n("arcSpeed", "Pulse speed along the arcs.", 1, 0), n("arcWidth", "Arc thickness factor.", 1, 0), c("markerColor", "Marker colour.", "#fde68a"), n("markerSize", "Marker size factor.", 1, 0), b("atmosphere", "Atmosphere glow.", true), c("atmosphereColor", "Atmosphere colour.", "#38bdf8"), n("spin", "Rotation speed (deg/s).", 6), n("longitude", "Longitude facing the camera at t = 0 (degrees).", 0), n("tilt", "Axis tilt (degrees).", 12)],
    cost: "dots*0.35*6+~8000",
    material: "The globe body sphere (dots, arcs and atmosphere keep theirs).",
  },
  {
    id: "crystals",
    description: "Glowing gem crystals: faceted hexagonal prisms with pointed tips (cluster on a rock base, ring, or scatter), base → tip colour gradient, emissive fresnel glow that pulses. Pair with the bloom post effect.",
    params: [i("count", "Crystals.", 14, 1, 400), n("size", "Height of a typical crystal.", 1.2, 0), cs("colors", "Gem colours (each crystal blends from one colour to the next).", ["#7c3aed", "#22d3ee", "#f0abfc"]), e("layout", "Arrangement.", ["cluster", "ring", "scatter"], "cluster"), n("spread", "Cluster radius / ring radius / scatter half-size.", 1, 0), n("glow", "Emissive glow strength.", 0.8, 0), n("pulse", "Glow pulse amount (0 = steady).", 1, 0), n("opacity", "Opacity (< 1 = translucent).", 1, 0, 1), b("base", "Rock base under a cluster.", true), c("baseColor", "Base rock colour.", "#4b4560")],
    cost: "count*40+~600",
    material: "The crystals (not the base). Without colour / preset / map the gradients are kept.",
  },
  {
    id: "galaxy",
    description: "Spiral galaxy of soft additive stars: logarithmic arms, warm bulge, star-forming knots, glowing core and differential rotation (inner faster). Space / AI / tech heroes.",
    params: [i("count", "Stars.", 40000, 100, 300000), n("radius", "Radius.", 6, 0.1), i("arms", "Spiral arms.", 3, 1, 8), n("twist", "Arm winding (radians from centre to rim).", 5, 0), n("thickness", "Disc thickness (fraction of radius).", 0.05, 0), c("coreColor", "Core colour.", "#ffd8a8"), c("armColor", "Outer arm colour.", "#6d8bff"), c("accentColor", "Star-forming knots colour.", "#ff7ac8"), n("size", "Star size.", 0.035, 0), n("speed", "Rotation speed.", 0.3), n("coreGlow", "Core glow opacity.", 0.9, 0, 1)],
    cost: "count",
  },
  {
    id: "bars3d",
    description: "3D bar chart from data (row or grid) with rounded / box / cylinder bars, colour ramp by value / row / column, base plate and an eased staggered grow entrance (or a looping wave). Dashboards, stats, fintech heroes.",
    params: [{ name: "data", type: "array", description: "Values: [3, 5, 8] (one row) or [[3, 5], [4, 7]] (grid: rows go back in depth). Items may be { \"value\": n }.", default: [3, 5, 4, 7, 6, 9, 8] }, n("barWidth", "Bar width.", 0.6, 0.01), n("gap", "Gap between bars.", 0.25, 0), n("maxHeight", "Height of the largest value.", 3, 0.01), cs("colors", "Colour ramp (value) or palette (row / column).", ["#93c5fd", "#6366f1", "#c026d3"]), e("colorBy", "What picks the colour.", ["value", "row", "column"], "value"), e("shape", "Bar shape.", ["rounded", "box", "cylinder"], "rounded"), e("animation", "grow = staggered entrance from t = 0; wave = looping ripple.", ["grow", "wave", "none"], "grow"), n("duration", "Grow duration (s).", 1.6, 0.01), b("base", "Base plate.", true), c("baseColor", "Base plate colour.", "#eef2ff")],
    cost: "data*12+~200",
    material: "Every bar (per-bar colours are kept as instance colours).",
  },
  {
    id: "abstractShapes",
    description: "Abstract Memphis / pastel composition for banners: spheres, tori, rings, pills, cones, cubes, half-discs, squiggles, triangles and stars evenly spread in a slab, gently floating and turning.",
    params: [i("count", "Shapes.", 22, 1, 300), v3("area", "Slab size (x, y, z).", [10, 4, 2]), cs("colors", "Palette.", ["#ff8fab", "#ffd166", "#06d6a0", "#118ab2", "#a78bfa", "#ff6b6b"]), { name: "shapes", type: "array", description: "Subset of shape kinds (default all): sphere, torus, ring, pill, cone, cube, halfDisc, squiggle, triangle, star.", options: ["sphere", "torus", "ring", "pill", "cone", "cube", "halfDisc", "squiggle", "triangle", "star"] }, n("minSize", "Smallest shape size.", 0.5, 0), n("maxSize", "Largest shape size.", 1.6, 0), e("style", "Material look.", ["matte", "glossy", "toon"], "matte"), n("motion", "Float / spin amount (0 = still).", 1, 0)],
    cost: "count*1500",
    material: "Every shape (per-shape palette colours are kept as instance colours).",
  },
];

// ─── Particles presets ──────────────────────────────────────────────────

export const PARTICLE_PRESETS: CatalogEntry[] = [
  { id: "stars", description: "Twinkling static stars.", params: [] },
  { id: "snow", description: "Falling soft snowflakes.", params: [] },
  { id: "rain", description: "Falling rain streaks (velocity-stretched).", params: [] },
  { id: "fireflies", description: "Glowing wandering dots.", params: [] },
  { id: "confetti", description: "Colourful confetti falling and spinning.", params: [] },
  { id: "sparks", description: "Sparks fountain: fast streaks arcing under gravity, cooling from yellow to red (additive). Small emitter area: place it at the source.", params: [] },
  { id: "dust", description: "Slow floating dust motes.", params: [] },
  { id: "bubbles", description: "Rising bubbles.", params: [] },
  { id: "embers", description: "Rising glowing embers cooling to red.", params: [] },
  { id: "hearts", description: "Rising little hearts.", params: [] },
  { id: "magic", description: "Magic sparkles: twinkling star glints rising and shrinking (additive) — wands, reveals, product magic.", params: [] },
  { id: "smoke", description: "Soft rising smoke puffs that grow and fade (noise-shaped). Small emitter area: place it at the chimney / source.", params: [] },
  { id: "fire", description: "Flickering flame: additive noisy puffs rising fast, yellow → red, shrinking. Small emitter area: place it at the base of the fire.", params: [] },
  { id: "petals", description: "Cherry-blossom petals drifting down, fluttering and spinning.", params: [] },
  { id: "leaves", description: "Autumn leaves falling, fluttering and spinning.", params: [] },
  { id: "galaxyDust", description: "Flat disc of twinkling cosmic dust slowly swirling (inner faster).", params: [] },
  { id: "bokeh", description: "Big soft out-of-focus light orbs drifting (dreamy backgrounds).", params: [] },
];

// ─── Post effects ───────────────────────────────────────────────────────

// Every post effect declares `gpu` (its GPU cost: "low" = one cheap
// fullscreen pass, "medium" = a few passes / a blur chain, "high" = a scene
// pre-pass + heavy per-pixel sampling). Quality tiers (target.quality) drop
// "high" effects on "low" and run them at reduced resolution below "ultra";
// `check` warns about heavy effects on games and reports the estimated cost.
// Effects run in a fixed, physically sensible order (src/runtime/postfx):
// HDR scene effects (ao, outline, godrays, dof, bloom, lensflare) → tone
// mapping + background → antialiasing (fxaa, smaa) → stylised looks (tiltshift,
// pixelate, halftone, ascii, glitch, in the declared order) → one "finish"
// pass merging chromatic, sharpen, grading, vignette and film with dithering
// and the sRGB output.

export const GRADING_LOOK_IDS = ["none", "cinematic", "teal-orange", "warm", "cool", "bleach", "noir", "vintage", "pastel"] as const;
export const POSTFX_LOOK_IDS = ["cinematic", "product", "dreamy", "neon", "retro", "clean"] as const;

// Procedural grading looks (the `grading.look` enum): base values blended by
// `grading.intensity`; explicit grading params override them.
export const GRADING_LOOKS: Record<Exclude<(typeof GRADING_LOOK_IDS)[number], "none">, { description: string; values: Record<string, number | string> }> = {
  cinematic: { description: "Soft S-curve, slightly desaturated, teal shadows / warm highlights.", values: { contrast: 1.12, saturation: 0.92, vibrance: 0.1, shadows: "#2f6f86", highlights: "#ffb27a", toning: 0.32, lift: 0.015, gain: 1.02 } },
  "teal-orange": { description: "Blockbuster complementary split: teal shadows, orange skin / highlights.", values: { contrast: 1.18, saturation: 1.05, vibrance: 0.2, shadows: "#1b6f8a", highlights: "#ff9a4a", toning: 0.55, gain: 1.03 } },
  warm: { description: "Golden-hour warmth.", values: { temperature: 0.3, tint: 0.04, saturation: 1.06, contrast: 1.05, highlights: "#ffcf8f", toning: 0.2 } },
  cool: { description: "Crisp cool daylight / tech.", values: { temperature: -0.3, saturation: 0.96, contrast: 1.06, shadows: "#2d5c9e", toning: 0.22 } },
  bleach: { description: "Bleach bypass: desaturated, punchy, metallic.", values: { bleach: 0.65, saturation: 0.7, contrast: 1.2 } },
  noir: { description: "Black and white, deep contrast.", values: { saturation: 0, contrast: 1.35, lift: -0.02, gain: 1.06 } },
  vintage: { description: "Faded film print: lifted blacks, warm, muted greens.", values: { saturation: 0.78, contrast: 0.92, lift: 0.07, gain: 0.96, temperature: 0.15, shadows: "#4f6a5a", highlights: "#ffe0ae", toning: 0.35 } },
  pastel: { description: "Airy, soft and bright.", values: { saturation: 0.82, contrast: 0.86, lift: 0.08, gamma: 1.08, highlights: "#ffe3ef", shadows: "#8a9fd8", toning: 0.25 } },
};

// Look presets (`{ "type": "look", "preset": "<id>" }`): exactly what each
// expands to. `look.intensity` scales the amounts (strength, intensity,
// darkness, amount, toning…); effects listed next to the look override.
export const POSTFX_LOOKS: Record<(typeof POSTFX_LOOK_IDS)[number], { description: string; effects: { type: string; [param: string]: unknown }[] }> = {
  cinematic: {
    description: "Film-like: contact AO, restrained bloom, teal / orange grade, soft vignette, fine grain, supersampled stills.",
    effects: [{ type: "ao", intensity: 0.9, radius: 0.6 }, { type: "bloom", strength: 0.25, radius: 0.6, threshold: 2.2, smoothing: 0.4 }, { type: "grading", look: "cinematic" }, { type: "vignette", offset: 1, darkness: 0.75 }, { type: "film", intensity: 0.06 }, { type: "taa", samples: 8 }],
  },
  product: {
    description: "Clean studio product shot: strong contact AO, crisp detail, neutral punchy grade, faint vignette, supersampled stills.",
    effects: [{ type: "ao", intensity: 1.1, radius: 0.5 }, { type: "bloom", strength: 0.15, radius: 0.5, threshold: 2.5, smoothing: 0.4 }, { type: "grading", contrast: 1.07, saturation: 1.04, vibrance: 0.1 }, { type: "sharpen", amount: 0.25 }, { type: "vignette", offset: 1.1, darkness: 0.4 }, { type: "taa", samples: 8 }],
  },
  dreamy: {
    description: "Soft and glowing: wide bloom, pastel grade, gentle lens fringes, light vignette.",
    effects: [{ type: "bloom", strength: 0.45, radius: 0.85, threshold: 1.0, smoothing: 0.6 }, { type: "grading", look: "pastel" }, { type: "chromatic", amount: 0.0015 }, { type: "vignette", offset: 1, darkness: 0.5 }, { type: "film", intensity: 0.04 }],
  },
  neon: {
    description: "Night-club neon: strong tight bloom, anamorphic streaks, saturated contrasty grade, deep vignette.",
    effects: [{ type: "bloom", strength: 1.3, radius: 0.55, threshold: 0.55, smoothing: 0.2 }, { type: "lensflare", intensity: 0.45, threshold: 1.4, streaks: 1.2, ghosts: 0.2, halo: 0.1 }, { type: "grading", contrast: 1.15, saturation: 1.2, vibrance: 0.2 }, { type: "chromatic", amount: 0.001 }, { type: "vignette", offset: 0.95, darkness: 0.95 }],
  },
  retro: {
    description: "Old film / VHS: vintage faded grade, heavy grain + scanlines, fringes, strong vignette.",
    effects: [{ type: "grading", look: "vintage" }, { type: "film", intensity: 0.3, scanlines: 0.25 }, { type: "chromatic", amount: 0.0025, radial: false }, { type: "vignette", offset: 0.9, darkness: 1.2 }, { type: "bloom", strength: 0.3, radius: 0.6, threshold: 1.6, smoothing: 0.4 }],
  },
  clean: {
    description: "Minimal polish for UI-like scenes: FXAA, subtle contrast, light sharpening, supersampled stills.",
    effects: [{ type: "fxaa" }, { type: "grading", contrast: 1.04, saturation: 1.02 }, { type: "sharpen", amount: 0.15 }, { type: "vignette", offset: 1.2, darkness: 0.25 }, { type: "taa", samples: 8 }],
  },
};

export const POSTFX: CatalogEntry[] = [
  { id: "look", description: 'Named look preset expanding into a tuned stack (`details.presets` lists exactly what each one expands to). Effects listed next to it override the matching expanded entry param by param.', params: [e("preset", "Look preset.", POSTFX_LOOK_IDS, "cinematic"), n("intensity", "Strength of the look (scales its effect amounts).", 1, 0, 1)], gpu: "medium", example: { type: "look", preset: "cinematic" }, details: { presets: POSTFX_LOOKS } },
  { id: "bloom", description: "Glow around bright / emissive parts (HDR threshold, 5-level mip blur).", params: [n("strength", "Strength.", 0.8, 0), n("radius", "Radius / spread (0…1).", 0.4, 0), n("threshold", "Luminance threshold (HDR: >1 = only emissive / very bright parts).", 0.85, 0), n("smoothing", "Soft knee above the threshold (0 = hard cut).", 0.1, 0, 1)], gpu: "medium" },
  { id: "ao", description: "Ambient occlusion (GTAO): contact shading in creases and under objects — grounds them and makes scenes read as real. Best with a ground.", params: [n("intensity", "Darkening amount.", 1, 0, 2), n("radius", "Sampling radius in scene units (≈ metres).", 0.6, 0.01, 10), n("thickness", "Assumed thickness of surfaces (larger = darker behind thin objects).", 1, 0.01, 10), n("falloff", "Distance falloff (0 = none, 1 = smooth).", 1, 0, 1)], gpu: "high", example: { type: "ao", intensity: 1, radius: 0.6 } },
  { id: "outline", description: "Cartoon outlines (toon look) from depth + normal edges.", params: [c("color", "Line colour.", "#000000"), n("thickness", "Thickness (CSS px).", 1, 0)], gpu: "medium" },
  { id: "godrays", description: "Light shafts (screen-space radial scattering) from the sky sun, a light or a point, occluded by objects.", params: [{ name: "source", type: "string", description: 'Where the rays come from: "auto" (sky sun, else the first directional / spot light, else top centre), "sun", or a light id.', default: "auto" }, n("intensity", "Strength.", 0.6, 0, 4), n("length", "Ray length (0…1 of the distance to the source).", 0.85, 0, 1), n("decay", "Falloff along the ray.", 0.96, 0.5, 1), c("color", "Tint of the light source glow (default: the light / sun colour)."), n("size", "Size of the source glow (fraction of the screen).", 0.1, 0, 1)], gpu: "medium", example: { type: "godrays", intensity: 0.7 } },
  { id: "dof", description: "Depth of field (bokeh disc blur). Blur = |depth − focus| × aperture (clamped to maxblur). `focusOn` keeps an object sharp wherever it moves.", params: [n("focus", "Focus distance from the camera (scene units).", 8, 0), { name: "focusOn", type: "string", description: "Object id to autofocus on every frame (overrides focus)." }, n("aperture", "Aperture: blur per unit of distance from the focus plane.", 0.002, 0), n("maxblur", "Max blur radius (fraction of the screen height).", 0.01, 0, 0.1)], gpu: "high" },
  { id: "lensflare", description: "Procedural lens flare from HDR highlights: anamorphic streaks, ghosts and a halo (no textures).", params: [n("intensity", "Overall strength.", 0.5, 0, 4), n("threshold", "HDR luminance that flares (>1 = only very bright parts).", 1.2, 0), n("streaks", "Anamorphic horizontal streaks amount.", 1, 0, 4), n("ghosts", "Ghost reflections amount.", 0.5, 0, 4), n("halo", "Halo ring amount.", 0.3, 0, 4), c("tint", "Streak colour.", "#9fc4ff")], gpu: "medium", example: { type: "lensflare", intensity: 0.6 } },
  { id: "fxaa", description: "Fast approximate antialiasing (smooths shader / texture edges MSAA misses). Cheap.", params: [], gpu: "low" },
  { id: "smaa", description: "Subpixel morphological antialiasing — sharper than FXAA.", params: [], gpu: "medium" },
  { id: "taa", description: "Supersampled stills: deterministic renders (agent3d render / poster / video), the reduced-motion still and paused frames accumulate `samples` sub-pixel-jittered frames (perfect edges, smooth AO / shadows). No cost while playing.", params: [i("samples", "Jittered frames per still.", 8, 2, 64)], gpu: "low", example: { type: "taa", samples: 8 } },
  { id: "tiltshift", description: "Tilt-shift miniature look: blur above and below a sharp horizontal band.", params: [n("focus", "Vertical centre of the sharp band (0 = bottom, 1 = top).", 0.5, 0, 1), n("width", "Half height of the sharp band (fraction of the screen).", 0.18, 0, 1), n("blur", "Blur strength.", 1, 0, 4)], gpu: "medium" },
  { id: "pixelate", description: "Retro pixels.", params: [i("pixelSize", "Pixel size (CSS px).", 4, 1, 32)], gpu: "low" },
  { id: "halftone", description: "Print halftone dots (comic / risograph banners).", params: [n("size", "Dot spacing (CSS px).", 6, 2, 64), n("angle", "Screen angle in degrees.", 45), b("mono", "Black ink only (else CMYK colour dots).", false)], gpu: "low" },
  { id: "ascii", description: "ASCII-art characters (procedural 5×5 glyphs).", params: [n("size", "Cell size (CSS px).", 8, 4, 64), b("mono", "Single ink colour instead of the scene colours.", false), c("color", "Ink colour when mono.", "#33ff88")], gpu: "low" },
  { id: "glitch", description: "Digital glitch: block displacement, RGB split, scan jitter (deterministic, driven by time).", params: [n("amount", "Strength (0…1).", 0.5, 0, 1), n("speed", "Glitch bursts per second.", 1, 0, 20)], gpu: "low" },
  { id: "chromatic", description: "Chromatic aberration: RGB fringes growing towards the edges (dreamy / lens).", params: [n("amount", "Shift amount (fraction of the screen).", 0.002, 0, 0.05), b("radial", "Radial lens fringes (false = uniform diagonal shift).", true)], gpu: "low" },
  { id: "sharpen", description: "Unsharp-mask sharpening (crisper details after AA / blur).", params: [n("amount", "Strength.", 0.3, 0, 2)], gpu: "low" },
  { id: "grading", description: "Colour grading in one pass: a procedural `look` LUT + exposure, white balance, contrast, lift / gamma / gain, split toning, saturation.", params: [e("look", "Procedural look (see GRADING_LOOKS).", GRADING_LOOK_IDS, "none"), n("intensity", "Strength of the look.", 1, 0, 1), n("exposure", "Exposure in stops.", 0, -5, 5), n("contrast", "Contrast (S-curve, 1 = neutral).", 1, 0, 3), n("saturation", "Saturation (0 = grey).", 1, 0, 3), n("vibrance", "Saturates muted colours more than vivid ones.", 0, -1, 1), n("temperature", "White balance: −1 cool … +1 warm.", 0, -1, 1), n("tint", "White balance: −1 green … +1 magenta.", 0, -1, 1), n("lift", "Raises (or crushes, < 0) the blacks.", 0, -0.5, 0.5), n("gamma", "Midtones (>1 brighter).", 1, 0.2, 5), n("gain", "Highlights multiplier.", 1, 0, 3), c("shadows", "Split toning: shadow tint colour (with `toning`)."), c("highlights", "Split toning: highlight tint colour (with `toning`)."), n("toning", "Split toning strength.", 0, 0, 1), n("bleach", "Bleach bypass (silver retention) amount.", 0, 0, 1)], gpu: "low", example: { type: "grading", look: "teal-orange", intensity: 0.8 }, details: { looks: GRADING_LOOKS } },
  { id: "vignette", description: "Darker (or tinted) edges.", params: [n("offset", "Size (bigger = smaller vignette).", 1, 0), n("darkness", "Darkness.", 1.1, 0), c("color", "Vignette colour.", "#000000")], gpu: "low" },
  { id: "film", description: "Film grain (luma-weighted, deterministic) + optional scanlines.", params: [n("intensity", "Grain.", 0.35, 0, 1), b("grayscale", "Black and white.", false), n("scanlines", "Scanlines strength.", 0, 0, 1), n("size", "Grain size (CSS px).", 1.5, 0.5, 8)], gpu: "low" },
];



// ─── Fonts (bundled, no web font fetch) ─────────────────────────────────

export const FONTS: CatalogEntry[] = [
  { id: "sans-bold", description: "Inter Bold — clean neo-grotesk, the default: headlines, UI-like titles.", params: [] },
  { id: "sans", description: "Inter Regular — subtitles, taglines, small labels.", params: [] },
  { id: "inter-black", description: "Inter Black — heavy, punchy headlines (tech, sport, sales).", params: [] },
  { id: "montserrat-extrabold", description: "Montserrat ExtraBold — wide geometric sans: bold brand titles, posters.", params: [] },
  { id: "space-grotesk-bold", description: "Space Grotesk Bold — quirky tech grotesk (startups, crypto, dev tools).", params: [] },
  { id: "bebas-neue", description: "Bebas Neue — tall condensed all-caps display: banners, cinema, sport.", params: [] },
  { id: "anton", description: "Anton — heavy condensed impact display: loud banners, sales.", params: [] },
  { id: "serif-bold", description: "Playfair Display Bold — elegant high-contrast serif (luxury, editorial, food).", params: [] },
  { id: "serif", description: "Playfair Display Regular — refined serif for subtitles and quotes.", params: [] },
  { id: "mono", description: "JetBrains Mono Bold — monospace (tech, code, terminal looks); no kerning by design.", params: [] },
  { id: "display", description: "Fredoka SemiBold — rounded, friendly (kids, games, playful brands).", params: [] },
  { id: "pacifico", description: "Pacifico — brush script (retro, surf, cafés, handwritten feel).", params: [] },
  { id: "lobster", description: "Lobster — bold connected script (retro signage, bakery, vintage).", params: [] },
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
  textures: TEXTURES,
  lightRigs: LIGHT_RIGS,
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
