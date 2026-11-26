// The scene document — the single format every front door reads and writes
// (Studio, CLI, MCP, runtime). A scene is plain JSON (`scene.json` in a
// project folder): declarative, diffable, validated by `validateScene`
// (src/core/validate.ts) against the catalog (src/core/catalog.ts).
//
// Conventions an agent can rely on:
// - Units: 1 unit ≈ 1 metre. Y is up. The camera looks at `camera.target`.
// - Angles are in DEGREES everywhere in the document (rotation, fov, behaviour
//   speeds in deg/s). The runtime converts to radians.
// - Colours are CSS strings: "#rrggbb", "#rgb", "rgb(…)", "hsl(…)" or a CSS name.
// - Asset paths are relative to the project folder ("assets/fox.glb") or a
//   built-in library ref: "library:" + the library index id, which is the path
//   inside library/ ("library:models/nature/pine-tree.glb", "library:fonts/…").
// - Time is in seconds.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Color = string;

export const SCENE_VERSION = 1 as const;

export interface SceneDoc {
  version: typeof SCENE_VERSION;
  id: string;
  title: string;
  description?: string;
  target: TargetDef;
  camera: CameraDef;
  environment: EnvironmentDef;
  lights: LightDef[];
  objects: ObjectDef[];
  timeline?: TimelineDef;
  // No-code triggers: click / hover / scroll / key → play segments, set properties, open URLs.
  interactions?: InteractionDef[];
  postfx?: PostFxDef[];
  physics?: PhysicsWorldDef;
  // Game / interactive logic: project-relative paths ("scripts/game.js").
  scripts?: string[];
  ui?: UiDef;
  audio?: AudioDef;
  // Free-form data scripts can read (`api.data`): level layouts, tuning…
  data?: Record<string, unknown>;
  // Accessible label of the canvas (aria-label). Defaults to the title.
  ariaLabel?: string;
  // Deterministic randomness for generators / particles.
  seed?: number;
}

// ─── Target: where the scene is shown on a web page ─────────────────────

export type TargetKind = "banner" | "hero" | "card" | "square" | "fullscreen" | "inline" | "game";

export interface TargetDef {
  kind: TargetKind;
  // "W:H" (e.g. "4:1", "16:9", "1:1"). The embed keeps this ratio responsively.
  aspect: string;
  // Max weight of the exported bundle (runtime excluded), in KB. `check` warns above.
  budgetKb?: number;
  // Fixed CSS height instead of the aspect ratio (e.g. "320px", "60vh").
  height?: string;
  // Transparent canvas so the page shows through (background ignored).
  transparent?: boolean;
  // Start rendering only when visible (default true), pause off-screen (default true).
  lazy?: boolean;
  pauseOffscreen?: boolean;
  // Max devicePixelRatio (default 2).
  maxDpr?: number;
  // What to do when the visitor prefers reduced motion: "static" freezes at
  // `posterTime` (entrance behaviours such as `appear` shown finished), "slow"
  // halves speeds, "ignore" plays normally. Default "static" ("ignore" for games).
  reducedMotion?: "static" | "slow" | "ignore";
  // Time (s) of the frame used for the poster / reduced-motion still. Default 0.
  posterTime?: number;
  // Antialias (default true). Turning off helps low-end devices.
  antialias?: boolean;
  // Shadow maps on (default true when a light casts shadows).
  shadows?: boolean;
  // Tone mapping (default "aces").
  toneMapping?: "none" | "aces" | "agx" | "neutral" | "reinhard";
  exposure?: number;
  // Rendering quality tier (default "auto"). "auto" picks one from the device
  // (high on desktops, medium on phones / small GPUs, low on software GL) and
  // steps down while playing if the frame rate stays low (lower DPR first,
  // then drops costly post effects) — never in deterministic renders, which
  // use "high". "low": DPR ≤ 1, no MSAA, "high"-cost post effects (ao, dof)
  // off. "medium": DPR ≤ 1.5, heavy effects at reduced resolution. "high":
  // DPR ≤ maxDpr. "ultra": full-resolution effects, more samples, MSAA 8.
  quality?: "auto" | "low" | "medium" | "high" | "ultra";
}

// ─── Camera ──────────────────────────────────────────────────────────────

export interface CameraDef {
  type: "perspective" | "orthographic";
  fov?: number; // degrees, perspective only (default 45)
  zoom?: number; // orthographic: world units visible vertically (default 10)
  position: Vec3;
  target?: Vec3; // look-at point (default [0,0,0])
  near?: number;
  far?: number;
  // none: fixed; orbit: drag to orbit (+ zoom unless orbitZoom false);
  // parallax: camera drifts with the pointer; scroll: camera follows page scroll
  // along `scrollPath`; follow: tracks the object `follow.target` (games).
  controls?: "none" | "orbit" | "parallax" | "scroll" | "follow";
  autoRotate?: number; // deg/s around target (orbit / none)
  orbitZoom?: boolean;
  orbitLimits?: { minDistance?: number; maxDistance?: number; minPolar?: number; maxPolar?: number; minAzimuth?: number; maxAzimuth?: number }; // polar / azimuth in degrees (azimuth 0 = camera on +Z, 90 = +X)
  parallax?: { strength?: number; smoothing?: number };
  scrollPath?: { position: Vec3; target?: Vec3 }[];
  follow?: { target: string; offset?: Vec3; smoothing?: number; lookAhead?: number };
  // Keep looking at this object (its world position replaces `target`).
  lookAt?: string;
  // Handheld camera: organic noise. amount: position wobble (units, default
  // 0.03); rotation: aim wobble (degrees, default 0.4); speed (default 0.5).
  shake?: { amount?: number; rotation?: number; speed?: number; seed?: number };
  // Cinematic moves on the timeline clock (scene time without a timeline).
  // Each shot starts from the pose the previous ones left.
  shots?: CameraShotDef[];
}

// dolly / pushIn / pullOut: along the view axis by `distance` (pushIn
// default: 25 % closer); truck: sideways; pedestal: up / down (target follows);
// crane: rises by `height` while the target stays (+ `distance` toward it);
// orbit: around the target by `angle` (yaw) and `elevation` degrees; zoom:
// fov → `fov`; move: to `position` / `target` / `fov`; path: Catmull-Rom
// through `points` looking `lookAhead` ahead (or at `lookAt`); lookAt: pan to
// an object; focus: rack focus — postfx dof `focus` → `focus` distance or the
// distance to `object`.
export interface CameraShotDef {
  type: "dolly" | "pushIn" | "pullOut" | "truck" | "pedestal" | "crane" | "orbit" | "zoom" | "move" | "path" | "lookAt" | "focus";
  at: number; // start (s)
  duration: number;
  ease?: EaseSpec; // default "inOutCubic"
  distance?: number;
  height?: number;
  angle?: number;
  elevation?: number;
  fov?: number;
  position?: Vec3;
  target?: Vec3;
  points?: Vec3[];
  lookAhead?: number; // path: 0..0.5 of the path (default 0.05)
  lookAt?: string | Vec3; // path: object id or point to look at
  object?: string; // lookAt / focus: object id
  focus?: number; // focus: distance
}

// ─── Environment ─────────────────────────────────────────────────────────

export type BackgroundDef =
  | Color
  | "transparent"
  | { gradient: Color[]; angle?: number; grain?: number } // CSS-like linear gradient (degrees, 0 = bottom→top)
  | { radial: Color[]; center?: Vec2; radius?: number; grain?: number } // center in 0..1 (default [0.5, 0.5])
  // Soft multi-colour "mesh gradient" (Stripe-like), animated when speed > 0.
  | { meshGradient: Color[]; speed?: number; scale?: number; seed?: number; grain?: number }
  | { sky: SkyParams }
  // HDRI (.hdr/.exr or a .jpg equirect). rotation: degrees around Y (also turns the IBL
  // when lighting comes from this background); groundProjection: the lower half is
  // projected on a ground disc (GroundedSkybox) so objects stand inside the photo.
  | { hdri: string; blur?: number; intensity?: number; rotation?: number; groundProjection?: boolean | { height?: number; radius?: number } };

export type SkyPreset = "sunrise" | "morning" | "noon" | "afternoon" | "golden-hour" | "sunset" | "dusk";

export interface SkySun {
  direction?: Vec3; // or elevation/azimuth
  elevation?: number; // degrees above the horizon
  azimuth?: number; // degrees, 0 = +Z (towards the default camera), 90 = +X
  color?: Color;
  size?: number;
  // Physical sky only: the matching directional sun light (default on).
  light?: boolean;
  intensity?: number;
  castShadow?: boolean; // default true
}

export interface SkyParams {
  top?: Color;
  horizon?: Color;
  bottom?: Color;
  sun?: SkySun | false;
  stars?: number; // count, 0 = none
  // Physical (Preetham) atmosphere instead of the colour gradient. Implied by `preset`.
  physical?: boolean;
  preset?: SkyPreset;
  turbidity?: number; // haze (1..20)
  rayleigh?: number; // blue scattering (0..4)
  mieCoefficient?: number;
  mieDirectionalG?: number;
  exposure?: number; // physical sky brightness (default 1)
  clouds?: number; // 0..1 cloud coverage (physical sky)
}

export interface ContactShadowsDef {
  y?: number; // plane height (default: ground.y or 0)
  size?: number; // square side in units (default: fitted to the objects)
  center?: [number, number]; // plane centre [x, z] (default: the centre of the objects it fits)
  opacity?: number; // 0..1 (default 0.6)
  blur?: number; // softness (default 2.5)
  far?: number; // how high above the plane objects still cast (default 1.5)
  resolution?: number; // render target size (default 512)
  color?: Color;
  frames?: number; // re-render every frame (default 0 = always), or only the first N frames (static scenes)
}

export interface ShadowSettings {
  type?: "pcf" | "vsm"; // vsm = smooth blurred shadows
  softness?: number; // blur radius (default 3; 0 = hard)
  mapSize?: number; // shadow map size (default 2048)
  intensity?: number; // 0..1 darkness (default 1)
}

export interface LightRigDef {
  preset: string; // catalog `lightRigs` id
  intensity?: number;
  rotation?: number; // degrees around Y
  castShadow?: boolean;
  color?: Color;
  scale?: number; // distance multiplier
}

export interface EnvironmentDef {
  background: BackgroundDef;
  // Image-based lighting for reflections: a preset or an HDRI asset path.
  // "sky" = from the background (physical / gradient sky, mesh gradient).
  lighting?: "studio" | "soft" | "sunset" | "night" | "neutral" | "sky" | "none" | { hdri: string; intensity?: number; rotation?: number };
  lightingIntensity?: number;
  // Linear (near/far) or exponential (density) fog. `height` (+ `falloff`) turns the
  // exponential fog into a ground-hugging height fog (thick below `height`).
  fog?: { color?: Color; near?: number; far?: number } | { color?: Color; density: number; height?: number; falloff?: number };
  // Simple ground: a plane at y = `y`, optionally only catching shadows.
  ground?: { y?: number; size?: number; color?: Color; shadowOnly?: boolean; grid?: boolean; roughness?: number; opacity?: number };
  // Light rig preset (catalog `lightRigs`), added to `lights`.
  rig?: string | LightRigDef;
  // Blurred contact shadows under the objects (product shots).
  contactShadows?: boolean | ContactShadowsDef;
  // Shadow-map quality for every shadow-casting light.
  shadows?: ShadowSettings;
}

// ─── Lights ──────────────────────────────────────────────────────────────

export type LightType = "ambient" | "directional" | "point" | "spot" | "hemisphere" | "rect";

export interface LightDef {
  id?: string;
  type: LightType;
  color?: Color;
  intensity?: number;
  position?: Vec3;
  target?: Vec3;
  castShadow?: boolean;
  // hemisphere
  skyColor?: Color;
  groundColor?: Color;
  // point / spot
  distance?: number;
  decay?: number;
  // spot
  angle?: number; // degrees
  penumbra?: number;
  // rect
  width?: number;
  height?: number;
  // rect: draw the glowing panel itself (visible in the frame and in reflections).
  panel?: boolean;
  // spot: cheap volumetric light cone.
  volumetric?: boolean | { intensity?: number; length?: number; color?: Color };
  // Per-light shadow tuning (overrides environment.shadows).
  shadow?: { softness?: number; mapSize?: number; bias?: number; normalBias?: number; intensity?: number };
  behaviours?: BehaviourDef[];
}

// ─── Objects ─────────────────────────────────────────────────────────────

export interface TransformDef {
  position?: Vec3;
  rotation?: Vec3; // degrees, XYZ order
  scale?: number | Vec3;
}

export interface BaseObjectDef extends TransformDef {
  id: string; // unique in the scene, [a-zA-Z][a-zA-Z0-9_-]*
  name?: string;
  visible?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  behaviours?: BehaviourDef[];
  children?: ObjectDef[];
  tags?: string[]; // scripts query by tag (api.findByTag)
  body?: BodyDef; // physics / collisions (games)
  // Link: clicking the object opens this URL (banners). Adds a pointer cursor.
  href?: string;
  // Arbitrary data scripts can read (`obj.userData`).
  userData?: Record<string, unknown>;
  // "camera" (top-level objects only): the object rides with the camera —
  // position / rotation are in camera space (x right, y up, -z forward:
  // [0, -1, -6] is 6 m in front of the lens, 1 m below its axis). Chapter
  // labels, 3D captions and HUD-like text stay on screen during camera moves
  // and scroll stories.
  attach?: "camera";
}

export interface MeshObjectDef extends BaseObjectDef {
  kind: "mesh";
  geometry: GeometryDef;
  material?: MaterialDef;
}

export interface TextObjectDef extends BaseObjectDef {
  kind: "text";
  text: string;
  font?: string; // catalog font id (default "sans-bold")
  size?: number; // cap height in units (default 1)
  depth?: number; // extrusion (default 0.2; 0 = flat)
  bevel?: number; // bevel size (default min(depth × 0.3, size × 0.035))
  align?: "left" | "center" | "right"; // default center (the text is centred on its position)
  letterSpacing?: number; // units added between characters (on top of the font's kerning)
  lineHeight?: number; // multiple of the font size (default 1.25)
  kerning?: boolean; // apply the font's kerning pairs (default true)
  maxWidth?: number; // wrap lines on spaces to this width (units)
  curveSegments?: number; // points per glyph curve (default grows with the size)
  // A darker / contrasting rim behind the letters (offset glyph outline, recessed).
  outline?: boolean | TextOutlineDef;
  // Each glyph becomes a child object "<id>/<n>" (n = 0, 1, … over non-space
  // characters) that timeline tracks can target ("title/0.position.y").
  splitLetters?: boolean;
  // Per-letter staggered entrance (implies splitLetters).
  reveal?: TextRevealDef;
  material?: MaterialDef;
}

export interface TextOutlineDef {
  width?: number; // units (default size × 0.06)
  color?: Color; // default "#111111"
  depth?: number; // thickness (default depth × 0.6)
  material?: MaterialDef; // overrides color
}

export interface TextRevealDef {
  effect?: "rise" | "fade" | "scale" | "spin" | "drop"; // default "rise"
  stagger?: number; // seconds between letters (default 0.04)
  duration?: number; // seconds per letter (default 0.6)
  delay?: number; // seconds before the first letter (default 0)
  ease?: string; // timeline easing name (default outCubic; outBack for scale / spin)
  order?: "forward" | "reverse" | "center" | "random"; // default forward
}

export interface ModelObjectDef extends BaseObjectDef {
  kind: "model";
  src: string; // .glb / .gltf project path or "library:<id>" (e.g. "library:models/nature/pine-tree.glb")
  // Fit the model so its largest dimension equals this size (units).
  fit?: number;
  // Move the model so its bounding box bottom-centre sits at the origin (default true).
  center?: boolean;
  // offset: start time (s) into the clip; blend: extra clips playing at the
  // same time with these weights (0..1) — animate them with
  // "<id>.animation.<clip>.weight" tracks.
  animation?: { clip?: string | number; loop?: boolean; speed?: number; crossfade?: number; offset?: number; blend?: Record<string, number> };
  // Morph target influences by name (0..1), animatable as "<id>.morph.<name>".
  morph?: Record<string, number>;
  // Override every material of the model (e.g. a colour or a preset).
  material?: MaterialDef;
}

export interface GroupObjectDef extends BaseObjectDef {
  kind: "group";
}

export interface GeneratorObjectDef extends BaseObjectDef {
  kind: "generator";
  generator: string; // catalog generator id: terrain, trees, rocks, water, clouds, city, character, grass, …
  params?: Record<string, unknown>;
  seed?: number;
  // Material override for the generator's main surface (only generators whose
  // catalog entry has `material`: blob, rocks, terrain, planet). Without
  // a colour / preset / map, lit materials keep the generator's vertex colours.
  material?: MaterialDef;
}

export interface ParticlesObjectDef extends BaseObjectDef {
  kind: "particles";
  preset?: string; // catalog particle preset (`agent3d catalog particlePresets`)
  count?: number;
  area?: Vec3; // emission box size
  size?: number;
  color?: Color | Color[];
  speed?: number;
  direction?: Vec3;
  spread?: number; // 0..1 randomness of direction
  lifetime?: number;
  opacity?: number;
  blending?: "normal" | "additive";
  shape?: "point" | "soft" | "square" | "circle" | "star" | "spark" | "streak" | "heart" | "bubble" | "smoke" | "petal" | "leaf" | "ring";
  seed?: number;
}

export interface InstancesObjectDef extends BaseObjectDef {
  kind: "instances";
  // One geometry/material drawn many times (cheap): a grid, a scatter or explicit transforms.
  geometry: GeometryDef;
  material?: MaterialDef;
  layout:
    | { type: "grid"; count: Vec3; spacing: Vec3 }
    | { type: "scatter"; count: number; area: Vec3; minScale?: number; maxScale?: number; randomRotation?: boolean; seed?: number }
    | { type: "circle"; count: number; radius: number }
    | { type: "list"; items: TransformDef[] };
  colors?: Color[]; // cycled / random per instance
}

export interface SvgObjectDef extends BaseObjectDef {
  kind: "svg";
  // Inline SVG markup or a project path to an .svg (a logo): extruded into 3D.
  src: string;
  size?: number; // width in units (default 2; see fit)
  fit?: "width" | "height" | "max"; // which dimension `size` sets (default "width")
  depth?: number; // default 0.2 (0 = flat)
  bevel?: number;
  // Keep the SVG's own fill / stroke colours (default true without material,
  // false with one; true + material = the material's finish with the SVG colours).
  keepColors?: boolean;
  strokes?: boolean; // extrude stroked paths (stroke-width, linejoin, linecap) — default true
  curveSegments?: number; // points per curve (default 12)
  layerGap?: number; // z step between successive paths, painter's order (units, default depth × 0.02)
  material?: MaterialDef;
}

// A 2D image given a 3D effect from a depth map (a "3D photo"). The depth map
// is a grayscale image, white = near, black = far (the convention of
// `agent3d assets depth`, which estimates it with Depth Anything V2 Small);
// its alpha channel, when present, marks depth discontinuities (0 = cut edge).
export interface PhotoObjectDef extends BaseObjectDef {
  kind: "photo";
  src: string; // image: project path or "library:<id>" (.jpg / .png / .webp)
  depth?: string; // depth map path (same aspect as src). Without it the photo is flat.
  // parallax: flat quad, shader parallax (relief mapping) — the "3D photo" look for
  //   small motions (default). mesh: displaced grid, survives larger camera moves.
  // layers: the photo cut into depth slices, a pop-up book look.
  mode?: "parallax" | "mesh" | "layers";
  width?: number; // world width in units (default 4); height follows the image aspect
  height?: number; // world height (overrides the aspect when both are set)
  strength?: number; // depth effect amount 0..1 (default 0.5; 0.6–0.9 for a bold parallax hero)
  focus?: number; // depth (0 far .. 1 near) that stays still while the view moves (default 0.5)
  segments?: number; // mesh: grid cells on the long side (default 256)
  layers?: number; // layers: number of slices (default 6)
  edgeCut?: number; // mesh / layers: hide stretched edges where depth jumps more than this (0..1, default 0.08; 0 = off)
  // What moves the view (combined): pointer (0..1 amount, default 1), scroll
  // (0..1 amount, default 0), gyro on phones (default true when pointer > 0),
  // auto: a looping drift for headless renders / videos and touch screens
  // ("sway" default, "orbit", "zoom", "none") at `speed` cycles per 10 s, or a
  // cinematic camera move: "dolly" (push in toward the focus plane), "pan"
  // (lateral truck left → right), "rise" (crane up), "vertigo" (dolly zoom:
  // the focus plane keeps its size while the background stretches).
  // loop (default true): seamless ping-pong loop of 10 / speed s; false: one
  // move over `duration` seconds (default 10 / speed), then held.
  // progress (0..1): the move's position instead of time — animate it with a
  // timeline track "<id>.motion.progress" (scroll-driven timelines: scroll story).
  motion?: {
    pointer?: number;
    scroll?: number;
    gyro?: boolean;
    auto?: "none" | "sway" | "orbit" | "zoom" | "dolly" | "pan" | "rise" | "vertigo";
    speed?: number;
    smoothing?: number;
    loop?: boolean;
    duration?: number;
    progress?: number;
  };
  material?: Pick<MaterialDef, "opacity" | "color" | "emissiveIntensity">; // tint / opacity / self-lit amount (photos are unlit by default)
}

export type ObjectKind = ObjectDef["kind"];
export type ObjectDef =
  | MeshObjectDef
  | TextObjectDef
  | ModelObjectDef
  | GroupObjectDef
  | GeneratorObjectDef
  | ParticlesObjectDef
  | InstancesObjectDef
  | SvgObjectDef
  | PhotoObjectDef;

// ─── Geometry ────────────────────────────────────────────────────────────

export type GeometryType =
  | "box"
  | "roundedBox"
  | "sphere"
  | "cylinder"
  | "cone"
  | "capsule"
  | "torus"
  | "torusKnot"
  | "plane"
  | "circle"
  | "ring"
  | "icosahedron"
  | "dodecahedron"
  | "octahedron"
  | "tetrahedron"
  | "lathe"
  | "extrude"
  | "tube";

export interface GeometryDef {
  type: GeometryType;
  // Parameters per type are documented in the catalog (CATALOG.geometries).
  [param: string]: unknown;
}

// ─── Material ────────────────────────────────────────────────────────────

export type MaterialType = "standard" | "physical" | "basic" | "lambert" | "toon" | "normal" | "matcap" | "gradient" | "shader";

export interface MaterialDef {
  // Catalog preset (chrome, gold, glass, plastic, clay, neon, toon, holographic…);
  // explicit properties below override it.
  preset?: string;
  type?: MaterialType;
  color?: Color;
  metalness?: number;
  roughness?: number;
  emissive?: Color;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  wireframe?: boolean;
  flatShading?: boolean;
  side?: "front" | "back" | "double";
  // physical
  transmission?: number;
  thickness?: number;
  ior?: number;
  clearcoat?: number;
  iridescence?: number;
  sheen?: number;
  clearcoatRoughness?: number;
  sheenColor?: Color;
  sheenRoughness?: number;
  anisotropy?: number; // 0..1 stretched highlights (brushed metal)
  anisotropyRotation?: number; // degrees
  attenuationColor?: Color; // transmission: colour picked up through the volume
  attenuationDistance?: number;
  specularIntensity?: number;
  specularColor?: Color;
  dispersion?: number; // transmission: rainbow fire (gems), 0..10
  iridescenceIOR?: number;
  iridescenceThicknessRange?: Vec2; // nm
  envMapIntensity?: number; // reflection strength of the environment lighting
  // textures: project paths / library ids, or a procedural texture
  // ({ "procedural": "<catalog textures id>", …params }) generated at load time.
  map?: TextureRef;
  normalMap?: TextureRef;
  roughnessMap?: TextureRef;
  metalnessMap?: TextureRef;
  aoMap?: TextureRef;
  emissiveMap?: TextureRef;
  bumpMap?: TextureRef;
  displacementMap?: TextureRef;
  alphaMap?: TextureRef;
  normalScale?: number;
  bumpScale?: number;
  aoMapIntensity?: number;
  displacementScale?: number;
  repeat?: Vec2;
  // Project textures along X/Y/Z instead of UVs (generators, terrain, any mesh
  // without good UVs). true or a scale (texture repeats per unit, default 1).
  triplanar?: boolean | number;
  // gradient material: vertical colour ramp in object space
  gradient?: Color[];
  // gradient material: the ramp drives the emissive glow too (needs emissive + emissiveIntensity)
  gradientEmissive?: boolean;
  // shader material: a catalog shader id (e.g. "plasma", "waves", "noise", "hologram")
  shader?: string;
  uniforms?: Record<string, number | Color | Vec2 | Vec3>;
}

// Procedural texture: a catalog `textures` id + its params (scale, colors, seed…).
export interface ProceduralTextureDef {
  procedural: string;
  [param: string]: unknown;
}
export type TextureRef = string | ProceduralTextureDef;

// ─── Behaviours (procedural animation & interaction) ───────────────────

export interface BehaviourDef {
  type: string; // catalog behaviour id: rotate, float, pulse, orbit, followPointer, …
  // When it runs: always (default), on hover, while visible, after a click…
  when?: "always" | "hover" | "click" | "visible" | "scroll";
  delay?: number;
  [param: string]: unknown;
}

// ─── Timeline (keyframes) ───────────────────────────────────────────────

export type EaseFamily = "Quad" | "Cubic" | "Quart" | "Quint" | "Sine" | "Expo" | "Circ" | "Back" | "Elastic" | "Bounce";
export type EaseName = "linear" | "step" | `in${EaseFamily}` | `out${EaseFamily}` | `inOut${EaseFamily}`;
// A named easing or a parametric one (src/core/ease.ts):
// "cubicBezier(0.22, 1, 0.36, 1)", "spring" | "spring(stiffness, damping[, mass])", "steps(4)" | "steps(4, start)".
export type EaseSpec = EaseName | `cubicBezier(${string})` | "spring" | `spring(${string})` | `steps(${string})`;

// Relative key values: "+=1" / "-=0.5" (added to the property's rest value),
// "*=1.2" (multiplies it). Vec3 keys may mix numbers and relative strings.
export type RelativeValue = `+=${number}` | `-=${number}` | `*=${number}`;
export type KeyValue = number | Vec3 | Color | boolean | RelativeValue | [number | RelativeValue, number | RelativeValue, number | RelativeValue];
// [time, value] or [time, value, ease]: the optional ease shapes the segment
// that ENDS at this key (overrides the track ease).
export type TrackKey = [number, KeyValue] | [number, KeyValue, EaseSpec];

export interface TrackDef {
  // "<selector>.<property path>". Selector: an object / light id, "camera",
  // "environment", "postfx", a comma list "a,b,c", "tag:<tag>" (objects with
  // that tag, scene order) or "children:<id>" (direct children of an object).
  // Paths: position, position.x, rotation.y (degrees), scale (number =
  // uniform), visible, material.<prop> (opacity, color, emissive,
  // emissiveIntensity, metalness, roughness, …), material.uniforms.<name>,
  // morph.<name> (models), animation.<clip>.weight|speed|time (models);
  // lights: intensity, color, position, target, angle, penumbra, distance;
  // camera.position | target | fov | zoom; environment.fog.color | near | far |
  // density, environment.lightingIntensity, environment.exposure,
  // environment.background (solid colours); postfx.<type>.<param>.
  target: string;
  keys: TrackKey[]; // sorted by time
  ease?: EaseSpec;
  // Multi-target selectors: seconds between consecutive targets' starts.
  stagger?: number;
  // Order of the stagger: "start" (default), "end", "center", "edges", "random" (seeded).
  staggerFrom?: "start" | "end" | "center" | "edges" | "random";
  // Colour keys: blend space. "oklch" (default, perceptual with chroma kept:
  // orange → teal stays saturated), "oklab" (perceptual straight line),
  // "rgb" (straight linear-light RGB blend, the pre-0.2 behaviour), "hsl"
  // (around the hue wheel, shortest way).
  colorSpace?: "oklch" | "oklab" | "rgb" | "hsl";
}

// A named range of the timeline. from / to: seconds or marker names; to < from plays backwards.
export interface SegmentDef {
  from: number | string;
  to: number | string;
  loop?: boolean | "pingpong";
  speed?: number;
}

export interface TimelineDef {
  duration: number;
  loop?: boolean | "pingpong";
  // true (default): starts on `trigger`; false: waits for an interaction /
  // script; a segment name: the trigger plays only that segment (e.g. "intro").
  autoplay?: boolean | string;
  // What drives the clock: page load, when visible (default), on hover
  // (scrubs forward while hovered, back on leave), on click, scroll (timeline
  // time = scroll progress, see `scroll`), or manual (only interactions /
  // scripts play segments).
  trigger?: "load" | "visible" | "hover" | "click" | "scroll" | "manual";
  // Playback rate (default 1).
  speed?: number;
  // Named times (s). Crossing one emits an event with its name (scripts
  // api.on(name), interactions { on: "event" }, DOM "agent3d:event").
  markers?: Record<string, number>;
  // Named ranges played by interactions ({ play: "hover-in" }) or player.playSegment().
  segments?: Record<string, SegmentDef | [number | string, number | string]>;
  // trigger "scroll": ScrollTrigger-like range — "<element edge> <viewport edge>"
  // with edges top | center | bottom | N% | Npx. Default start "top bottom"
  // (element top reaches the viewport bottom) → end "bottom top".
  // smoothing 0..0.99 (default 0.8) eases the scrub.
  scroll?: { start?: string; end?: string; smoothing?: number };
  tracks: TrackDef[];
}

// ─── Interactions (no-code triggers) ─────────────────────────────────────

export type InteractionAction =
  // Play a segment (or "timeline": the whole timeline from 0); reverse plays it backwards.
  | { play: string; reverse?: boolean }
  // Play a segment forward, then backward on the next trigger (open / close).
  | { toggle: string }
  // Jump the timeline to a time (s) or a marker name.
  | { seek: number | string }
  // Set an animatable property (track target syntax) — tweened when duration > 0.
  | { set: { path: string; value: KeyValue }; duration?: number; ease?: EaseSpec }
  // Emit an event (scripts api.on, interactions { on: "event" }, DOM "agent3d:event").
  | { emit: string; payload?: unknown }
  // Open a URL (http(s) or relative; only on click / key interactions — a user gesture).
  | { openUrl: string; newTab?: boolean }
  // Play a model animation clip (crossfades from the current one).
  | { playClip: string | number; target: string; loop?: boolean; speed?: number; crossfade?: number };

export interface InteractionDef {
  // click / hover / hoverEnd on `target` (or the whole canvas without target),
  // visible (the embed enters the viewport, once), scroll (progress crosses
  // `at` downward), key (KeyboardEvent.code `key`), event (marker / emitted name).
  on: "click" | "hover" | "hoverEnd" | "visible" | "scroll" | "key" | "event";
  target?: string;
  key?: string;
  event?: string;
  at?: number;
  once?: boolean;
  do: InteractionAction[];
}

// ─── Post-processing ────────────────────────────────────────────────────

export interface PostFxDef {
  // Catalog postfx id (bloom, ao, grading, dof, …) or "look" (a named preset
  // expanding into a tuned stack: { "type": "look", "preset": "cinematic" }).
  type: string;
  [param: string]: unknown;
}

// ─── Physics & game ─────────────────────────────────────────────────────

export interface PhysicsWorldDef {
  gravity?: Vec3; // default [0, -9.81, 0]
  // Fixed step (s) for determinism (default 1/60).
  step?: number;
  // Solver sub-steps per fixed step (1..8, default 1). More = stabler stacks and
  // fewer tunnelling fast objects (bodies with `ccd: true` add sub-steps on their own).
  substeps?: number;
  iterations?: number; // constraint solver iterations (default 10)
  sleep?: boolean; // let resting bodies sleep (default true)
  debug?: boolean; // draw collider wireframes (handy in render screenshots)
  // Named surface materials (body.material) and per-pair overrides.
  materials?: Record<string, PhysicsMaterialDef>;
  contacts?: PhysicsContactDef[];
  // Collision layer names in bit order (max 16). Layers used by bodies but not
  // listed are appended in scene order; "default" is always the first.
  layers?: string[];
  joints?: JointDef[];
}

export interface PhysicsMaterialDef {
  friction?: number;
  restitution?: number;
}

export interface PhysicsContactDef {
  a: string; // material name
  b: string;
  friction?: number;
  restitution?: number;
}

// Constraint between two bodies (or a body and the world when `b` is omitted).
// Pivots and axes are in WORLD space at scene start.
export interface JointDef {
  id?: string;
  type: "hinge" | "point" | "distance" | "lock" | "spring";
  a: string; // object id with a body
  b?: string; // other object id; omitted → anchored to the world
  pivot?: Vec3; // world anchor (default: b's centre, or a's centre when b is omitted)
  axis?: Vec3; // hinge axis (default [0, 1, 0])
  distance?: number; // distance joint (default: the current distance)
  restLength?: number; // spring (default: the current distance)
  stiffness?: number; // spring (default 50)
  damping?: number; // spring (default 1)
  motor?: { speed: number; maxForce?: number }; // hinge motor, degrees / s
  limits?: [number, number]; // hinge angle limits in degrees [min, max], relative to the start pose (e.g. [0, 110] for a door)
  maxForce?: number; // constraint strength (default 1e6)
  collideConnected?: boolean; // default false
}

export type ColliderShape = "box" | "sphere" | "cylinder" | "capsule";

// One collider of a compound body (offsets in the object's frame, world units).
export interface ColliderDef {
  shape: ColliderShape;
  size?: Vec3; // box
  radius?: number; // sphere / cylinder / capsule
  height?: number; // cylinder / capsule (total height)
  offset?: Vec3;
  rotation?: Vec3; // degrees
}

export interface BodyDef {
  type: "static" | "dynamic" | "kinematic" | "trigger";
  // box (default, bounding box) | sphere | cylinder | capsule (Y-up) | convex
  // (hull of the mesh/model) | trimesh (exact triangles, static only) |
  // heightfield (terrain generators) | compound (`shapes`) | auto (primitive
  // geometry → matching shape, terrain → heightfield, else bounding box).
  shape?: "box" | "sphere" | "auto" | "cylinder" | "capsule" | "convex" | "trimesh" | "heightfield" | "compound";
  size?: Vec3; // box size override
  radius?: number; // sphere / cylinder / capsule radius override
  height?: number; // cylinder / capsule height override
  shapes?: ColliderDef[]; // compound colliders
  offset?: Vec3; // collider centre offset from the object origin (default: bounding-box centre)
  mass?: number;
  restitution?: number; // bounciness 0..1
  friction?: number;
  material?: string; // physics.materials name (friction / restitution defaults)
  velocity?: Vec3;
  angularVelocity?: Vec3; // degrees / s
  linearDamping?: number; // 0..1 (default 0.01)
  angularDamping?: number; // 0..1 (default 0.01)
  gravityScale?: number; // default 1 (dynamic)
  fixedRotation?: boolean; // no rotation (players, characters)
  character?: boolean; // character controller: fixed rotation, no friction, never sleeps
  sleep?: boolean; // allow sleeping (default true)
  ccd?: boolean; // fast object: extra sub-steps against tunnelling
  layer?: string; // collision layer name (default "default")
  collidesWith?: string[]; // layers this body collides with (default: all)
}

export interface UiElementDef {
  id: string;
  type: "text" | "button" | "bar";
  text?: string; // may contain {state.key} placeholders, e.g. "Score: {score}"
  anchor?: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
  // panel = a backdrop card (game-over / pause screens; multi-line text, "\n" breaks lines).
  style?: "plain" | "pill" | "title" | "subtitle" | "panel";
  value?: string; // bar: state key holding 0..1
  action?: string; // button: event name emitted to scripts (api.on(action))
  visible?: boolean | string; // or a state key / expression "state.phase == 'over'"
  // (expressions and {placeholders} can also read timeline.time, .progress, .segment, .marker)
  // Per-element theme (CSS colours): text colour, and the background of a
  // button / pill / panel / bar track.
  color?: Color;
  background?: Color;
}

export interface UiDef {
  elements: UiElementDef[];
  // Theme of the HUD.
  font?: string; // CSS font-family (system stacks only — no web font fetch)
  color?: Color;
  accent?: Color;
  // Button label colour. Default: white or near-black, whichever contrasts
  // best with the accent (WCAG contrast ≥ 4.5 whenever one of them can).
  buttonText?: Color;
}

export interface AudioDef {
  // Named sounds scripts play with api.audio.play(name): synthesised presets
  // (WebAudio, zero bytes) or project audio files.
  sounds?: Record<string, { preset: string; volume?: number } | { src: string; volume?: number }>;
  music?: { src?: string; preset?: string; volume?: number; loop?: boolean };
  // Audio never starts before a user gesture (browser rule); default muted icon shown.
  muted?: boolean;
}

// ─── Project ─────────────────────────────────────────────────────────────

// `agent3d.json` at the root of a project folder.
export interface ProjectManifest {
  name: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  template?: string;
  agent3d: string; // engine version that last wrote it
}

export interface AssetEntry {
  path: string; // project-relative
  kind: "model" | "texture" | "hdri" | "audio" | "font" | "svg" | "other";
  bytes: number;
  source: string; // "local" | "library" | "polyhaven" | "ambientcg" | "kenney" | "quaternius" | "khronos" | url
  sourceUrl?: string;
  license: string; // "CC0-1.0", "CC-BY-4.0", …
  author?: string;
  attribution?: string; // text to show when the licence requires it
  addedAt: string;
}

// `assets/manifest.json`
export interface AssetManifest {
  assets: AssetEntry[];
}

// ─── Issues (validation & check) ────────────────────────────────────────

export interface Issue {
  severity: "error" | "warning" | "info";
  code: string;
  path: string; // JSON path in the scene, e.g. "objects[2].geometry.radius" or "objects#logo.material"
  message: string;
  hint?: string;
}
