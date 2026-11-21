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
//   built-in library id ("library:nature/pine-tree").
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
  // `posterTime`, "slow" halves speeds, "ignore" plays normally. Default "static".
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
  orbitLimits?: { minDistance?: number; maxDistance?: number; minPolar?: number; maxPolar?: number };
  parallax?: { strength?: number; smoothing?: number };
  scrollPath?: { position: Vec3; target?: Vec3 }[];
  follow?: { target: string; offset?: Vec3; smoothing?: number; lookAhead?: number };
}

// ─── Environment ─────────────────────────────────────────────────────────

export type BackgroundDef =
  | Color
  | "transparent"
  | { gradient: Color[]; angle?: number } // CSS-like linear gradient (degrees, 0 = bottom→top)
  | { radial: Color[] }
  | { sky: SkyParams }
  | { hdri: string; blur?: number };

export interface SkyParams {
  top?: Color;
  horizon?: Color;
  bottom?: Color;
  sun?: { direction?: Vec3; color?: Color; size?: number } | false;
  stars?: number; // count, 0 = none
}

export interface EnvironmentDef {
  background: BackgroundDef;
  // Image-based lighting for reflections: a preset or an HDRI asset path.
  lighting?: "studio" | "soft" | "sunset" | "night" | "neutral" | "none" | { hdri: string; intensity?: number };
  lightingIntensity?: number;
  fog?: { color?: Color; near?: number; far?: number } | { color?: Color; density: number };
  // Simple ground: a plane at y = `y`, optionally only catching shadows.
  ground?: { y?: number; size?: number; color?: Color; shadowOnly?: boolean; grid?: boolean; roughness?: number };
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
  bevel?: number; // bevel size (default 0.02)
  align?: "left" | "center" | "right"; // default center (the text is centred on its position)
  letterSpacing?: number;
  lineHeight?: number;
  material?: MaterialDef;
}

export interface ModelObjectDef extends BaseObjectDef {
  kind: "model";
  src: string; // .glb / .gltf project path or "library:<id>"
  // Fit the model so its largest dimension equals this size (units).
  fit?: number;
  // Move the model so its bounding box bottom-centre sits at the origin (default true).
  center?: boolean;
  animation?: { clip?: string | number; loop?: boolean; speed?: number; crossfade?: number };
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
}

export interface ParticlesObjectDef extends BaseObjectDef {
  kind: "particles";
  preset?: string; // catalog particle preset: stars, snow, rain, fireflies, confetti, sparks, dust, bubbles, embers
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
  shape?: "point" | "square" | "circle" | "star" | "spark";
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
  size?: number; // width in units (default 2)
  depth?: number; // default 0.2
  bevel?: number;
  material?: MaterialDef;
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
  | SvgObjectDef;

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
  // textures (project paths or library ids)
  map?: string;
  normalMap?: string;
  roughnessMap?: string;
  repeat?: Vec2;
  // gradient material: vertical colour ramp in object space
  gradient?: Color[];
  // shader material: a catalog shader id (e.g. "plasma", "waves", "noise", "hologram")
  shader?: string;
  uniforms?: Record<string, number | Color | Vec2 | Vec3>;
}

// ─── Behaviours (procedural animation & interaction) ───────────────────

export interface BehaviourDef {
  type: string; // catalog behaviour id: rotate, float, pulse, orbit, followPointer, …
  // When it runs: always (default), on hover, while visible, after a click…
  when?: "always" | "hover" | "click" | "visible" | "scroll";
  delay?: number;
  [param: string]: unknown;
}

// ─── Timeline (keyframes) ───────────────────────────────────────────────

export type EaseName =
  | "linear"
  | "inQuad" | "outQuad" | "inOutQuad"
  | "inCubic" | "outCubic" | "inOutCubic"
  | "inSine" | "outSine" | "inOutSine"
  | "inExpo" | "outExpo" | "inOutExpo"
  | "inBack" | "outBack" | "inOutBack"
  | "outElastic" | "outBounce" | "step";

export type KeyValue = number | Vec3 | Color | boolean;

export interface TrackDef {
  // "<objectId>.<property path>" — position, position.x, rotation.y (degrees),
  // scale (number = uniform), visible, material.opacity, material.color,
  // material.emissiveIntensity, or "camera.position" / "camera.target" /
  // "camera.fov", "<lightId>.intensity", "<lightId>.color".
  target: string;
  keys: [number, KeyValue][]; // [time, value], sorted by time
  ease?: EaseName;
}

export interface TimelineDef {
  duration: number;
  loop?: boolean | "pingpong";
  autoplay?: boolean; // default true
  // What starts it: page load, when visible (default), on hover, on click, or
  // scroll (timeline time = scroll progress of the embed through the viewport).
  trigger?: "load" | "visible" | "hover" | "click" | "scroll";
  tracks: TrackDef[];
}

// ─── Post-processing ────────────────────────────────────────────────────

export interface PostFxDef {
  type: string; // catalog postfx id: bloom, vignette, film, chromatic, pixelate, outline, dof
  [param: string]: unknown;
}

// ─── Physics & game ─────────────────────────────────────────────────────

export interface PhysicsWorldDef {
  gravity?: Vec3; // default [0, -9.81, 0]
  // Fixed step (s) for determinism (default 1/60).
  step?: number;
}

export interface BodyDef {
  type: "static" | "dynamic" | "kinematic" | "trigger";
  shape?: "box" | "sphere" | "auto"; // auto: from the object's bounding box
  size?: Vec3; // box size override
  radius?: number; // sphere radius override
  mass?: number;
  restitution?: number; // bounciness 0..1
  friction?: number;
  velocity?: Vec3;
  fixedRotation?: boolean;
}

export interface UiElementDef {
  id: string;
  type: "text" | "button" | "bar";
  text?: string; // may contain {state.key} placeholders, e.g. "Score: {score}"
  anchor?: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
  style?: "plain" | "pill" | "title" | "subtitle";
  value?: string; // bar: state key holding 0..1
  action?: string; // button: event name emitted to scripts (api.on(action))
  visible?: boolean | string; // or a state key / expression "state.phase == 'over'"
}

export interface UiDef {
  elements: UiElementDef[];
  // Theme of the HUD.
  font?: string; // CSS font-family (system stacks only — no web font fetch)
  color?: Color;
  accent?: Color;
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
