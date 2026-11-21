// Starter scenes for `agent3d new` without a template: one attractive,
// valid scene per target kind (gradient backgrounds, soft studio lighting,
// a floating 3D title) so the very first render already looks good.

import { DEFAULT_ASPECT } from "../core/validate";
import { slugify } from "../core/ids";
import type { LightDef, ObjectDef, SceneDoc, TargetDef, TargetKind } from "../core/types";
import { SCENE_VERSION } from "../core/types";

const studioLights = (): LightDef[] => [
  { id: "fill", type: "hemisphere", skyColor: "#e8ecff", groundColor: "#3a2f5c", intensity: 0.9 },
  { id: "key", type: "directional", position: [4, 6, 6], intensity: 2.2, castShadow: true },
  { id: "rim", type: "point", position: [-5, 2, -3], color: "#7cc8ff", intensity: 30, distance: 20 },
];

function title(text: string, size: number, extra: Partial<ObjectDef> = {}): ObjectDef {
  return {
    id: "title",
    kind: "text",
    text,
    font: "sans-bold",
    size,
    depth: size * 0.3,
    bevel: size * 0.03,
    material: { preset: "plastic", color: "#ffffff", roughness: 0.25 },
    behaviours: [
      { type: "appear", effect: "rise", duration: 1 },
      { type: "float", amplitude: 0.08, speed: 0.4 },
    ],
    ...extra,
  } as ObjectDef;
}

const shape = (id: string, type: string, position: [number, number, number], color: string, params: Record<string, unknown> = {}, phase = 0): ObjectDef => ({
  id,
  kind: "mesh",
  geometry: { type: type as never, ...params },
  material: { preset: "plastic", color },
  position,
  rotation: [20, 30, 0],
  behaviours: [
    { type: "float", amplitude: 0.2, speed: 0.3, phase },
    { type: "rotate", axis: [0.3, 1, 0.2], speed: 18 },
  ],
});

function banner(text: string): Pick<SceneDoc, "camera" | "environment" | "lights" | "objects" | "postfx"> {
  return {
    camera: { type: "perspective", fov: 30, position: [0, 0, 12], target: [0, 0, 0], controls: "parallax", parallax: { strength: 0.4, smoothing: 0.92 } },
    environment: { background: { gradient: ["#1b1446", "#4a2a8f", "#ff7ab6"], angle: 20 }, lighting: "studio", lightingIntensity: 0.8 },
    lights: studioLights(),
    objects: [
      title(text, 1),
      shape("torus", "torus", [-6.2, 0.6, -1.5], "#ffb3d9", { radius: 0.6, tube: 0.22 }),
      shape("gem", "icosahedron", [6.3, -0.4, -1], "#8fd3ff", { radius: 0.7, detail: 0 }, 0.4),
      shape("pill", "capsule", [4.2, 1.3, -2.5], "#ffe08a", { radius: 0.25, length: 0.5 }, 0.7),
      { id: "dust", kind: "particles", preset: "dust", count: 120, area: [26, 7, 6], size: 0.05, color: "#ffffff", opacity: 0.6 },
    ],
    postfx: [{ type: "bloom", strength: 0.35, radius: 0.4, threshold: 0.9 }],
  };
}

function hero(text: string): ReturnType<typeof banner> {
  return {
    camera: { type: "perspective", fov: 35, position: [0, 0.3, 10], target: [0, 0, 0], controls: "parallax", parallax: { strength: 0.5 } },
    environment: { background: { radial: ["#2b1f63", "#0c0a1f"] }, lighting: "studio" },
    lights: studioLights(),
    objects: [
      { id: "blob", kind: "generator", generator: "blob", params: { radius: 1.6, noise: 0.35, speed: 0.35 }, position: [2.6, 0, -1] },
      title(text, 0.8, { position: [-2.2, 0.2, 0.5], align: "center" } as Partial<ObjectDef>),
      { id: "sparkles", kind: "particles", preset: "dust", count: 160, area: [16, 9, 6], size: 0.05, color: "#cfc6ff", opacity: 0.7 },
    ],
    postfx: [{ type: "bloom", strength: 0.4, radius: 0.5, threshold: 0.85 }, { type: "vignette", darkness: 0.9 }],
  };
}

function card(text: string): ReturnType<typeof banner> {
  return {
    camera: { type: "perspective", fov: 35, position: [0, 1.2, 7], target: [0, 0.4, 0] },
    environment: { background: { gradient: ["#fdf2e9", "#f6c6c6"], angle: 0 }, lighting: "soft", ground: { y: -1, shadowOnly: true } },
    lights: studioLights(),
    objects: [
      { id: "pedestal", kind: "mesh", geometry: { type: "cylinder", radiusTop: 1.2, radiusBottom: 1.3, height: 0.4, segments: 64 }, material: { preset: "clay", color: "#fff4ea" }, position: [0, -0.8, 0], receiveShadow: true, castShadow: true },
      { id: "knot", kind: "mesh", geometry: { type: "torusKnot", radius: 0.6, tube: 0.2 }, material: { preset: "pearl", color: "#ffd1dc" }, position: [0, 0.6, 0], castShadow: true, behaviours: [{ type: "rotate", speed: 25 }, { type: "float", amplitude: 0.1, speed: 0.4 }, { type: "hoverScale", scale: 1.1 }] },
      title(text, 0.35, { position: [0, 2.1, 0], material: { preset: "matte", color: "#5a3e5d" } } as Partial<ObjectDef>),
    ],
  };
}

function square(text: string): ReturnType<typeof banner> {
  return {
    camera: { type: "perspective", fov: 35, position: [0, 0.5, 7], target: [0, 0, 0], controls: "orbit", orbitZoom: false, autoRotate: 10 },
    environment: { background: { radial: ["#3a1c71", "#0f0c29"] }, lighting: "studio" },
    lights: studioLights(),
    objects: [
      { id: "gem", kind: "mesh", geometry: { type: "icosahedron", radius: 1.3, detail: 0 }, material: { preset: "holographic" }, behaviours: [{ type: "rotate", axis: [0.2, 1, 0], speed: 20 }, { type: "float", amplitude: 0.12, speed: 0.4 }] },
      title(text, 0.35, { position: [0, -2, 0.5] } as Partial<ObjectDef>),
      { id: "stars", kind: "particles", preset: "stars", count: 200, area: [12, 12, 8], size: 0.04 },
    ],
    postfx: [{ type: "bloom", strength: 0.5, radius: 0.4, threshold: 0.8 }],
  };
}

function landscape(text: string): ReturnType<typeof banner> {
  return {
    camera: { type: "perspective", fov: 45, position: [0, 9, 26], target: [0, 1, 0], controls: "orbit", autoRotate: 4, orbitLimits: { minDistance: 10, maxDistance: 45, maxPolar: 85 } },
    environment: { background: { sky: { top: "#3d7dd8", horizon: "#f7d9b0", sun: { direction: [0.6, 0.35, 0.4] } } }, lighting: "sunset", fog: { color: "#f2dcc0", near: 30, far: 90 } },
    lights: [
      { id: "sky", type: "hemisphere", skyColor: "#cfe6ff", groundColor: "#6b5a3a", intensity: 0.9 },
      { id: "sun", type: "directional", position: [20, 18, 12], color: "#ffe2b8", intensity: 2.5, castShadow: true },
    ],
    objects: [
      { id: "terrain", kind: "generator", generator: "terrain", params: { size: 60, height: 7, shape: "island", waterLevel: 0.8 }, seed: 7, receiveShadow: true },
      { id: "trees", kind: "generator", generator: "trees", params: { count: 60, area: [40, 0, 40], style: "mixed" }, seed: 3, castShadow: true },
      { id: "clouds", kind: "generator", generator: "clouds", params: { count: 7, height: 14 } },
      title(text, 1.4, { position: [0, 8, 0], material: { preset: "clay", color: "#ffffff" } } as Partial<ObjectDef>),
    ],
  };
}

function game(text: string): ReturnType<typeof banner> & Pick<SceneDoc, "scripts" | "ui" | "physics" | "audio"> {
  return {
    camera: { type: "perspective", fov: 50, position: [0, 6, 9], target: [0, 0, 0], controls: "follow", follow: { target: "player", offset: [0, 6, 9], smoothing: 0.9 } },
    environment: { background: { gradient: ["#8ec5fc", "#e0c3fc"], angle: 0 }, lighting: "soft" },
    lights: [
      { id: "fill", type: "hemisphere", skyColor: "#ffffff", groundColor: "#8a7fb0", intensity: 1 },
      { id: "sun", type: "directional", position: [6, 10, 4], intensity: 2, castShadow: true },
    ],
    objects: [
      { id: "floor", kind: "mesh", geometry: { type: "box", width: 20, height: 0.5, depth: 20 }, material: { preset: "matte", color: "#b8e0a8" }, position: [0, -0.25, 0], receiveShadow: true, body: { type: "static" } },
      { id: "player", kind: "mesh", geometry: { type: "roundedBox", width: 0.8, height: 0.8, depth: 0.8, radius: 0.15 }, material: { preset: "plastic", color: "#ff6b6b" }, position: [0, 0.4, 0], castShadow: true, body: { type: "kinematic" }, tags: ["player"] },
      { id: "coins", kind: "group", children: [-4, -1.5, 2, 4.5].map((x, i) => ({ id: `coin-${i + 1}`, kind: "mesh" as const, geometry: { type: "cylinder" as const, radiusTop: 0.3, radiusBottom: 0.3, height: 0.08 }, material: { preset: "gold" }, position: [x, 0.6, i % 2 ? -3 : 3] as [number, number, number], rotation: [90, 0, 0] as [number, number, number], tags: ["coin"], body: { type: "trigger" as const }, behaviours: [{ type: "rotate", axis: [0, 0, 1], speed: 120 }] })) },
      title(text, 0.6, { position: [0, 3, -6], behaviours: [{ type: "float", amplitude: 0.1, speed: 0.4 }] } as Partial<ObjectDef>),
    ],
    scripts: ["scripts/game.js"],
    ui: { elements: [{ id: "score", type: "text", text: "Coins: {score}", anchor: "top-left", style: "pill" }], color: "#2b2340" },
    physics: { gravity: [0, -9.81, 0] },
    audio: { sounds: { coin: { preset: "coin" } } },
  };
}

export const STARTER_GAME_SCRIPT = `// Move the player with the arrow keys / WASD (or swipe); collect the coins.
// Scripts only get \`api\` (see ScriptApi in the Agent3D docs).
export default function (api) {
  const player = api.get("player");
  const speed = 4;
  return {
    start() {
      api.state.score = 0;
    },
    update(dt) {
      if (!player) return;
      const left = api.input.isDown("ArrowLeft") || api.input.isDown("KeyA");
      const right = api.input.isDown("ArrowRight") || api.input.isDown("KeyD");
      const up = api.input.isDown("ArrowUp") || api.input.isDown("KeyW");
      const down = api.input.isDown("ArrowDown") || api.input.isDown("KeyS");
      player.position.x += ((right ? 1 : 0) - (left ? 1 : 0)) * speed * dt;
      player.position.z += ((down ? 1 : 0) - (up ? 1 : 0)) * speed * dt;
      for (const coin of api.findByTag("coin")) {
        if (coin.visible && api.physics.overlaps(player, coin)) {
          coin.visible = false;
          api.state.score = Number(api.state.score) + 1;
          api.audio.play("coin");
        }
      }
    },
  };
}
`;

export function starterScene(opts: { title: string; id?: string; target?: Partial<TargetDef> }): SceneDoc {
  const kind: TargetKind = opts.target?.kind ?? "banner";
  const text = opts.title.length > 28 ? `${opts.title.slice(0, 27)}…` : opts.title;
  const body = kind === "banner" ? banner(text) : kind === "hero" || kind === "inline" ? hero(text) : kind === "card" ? card(text) : kind === "square" ? square(text) : kind === "fullscreen" ? landscape(text) : game(text);
  const scene: SceneDoc = {
    version: SCENE_VERSION,
    id: opts.id ?? slugify(opts.title, "scene"),
    title: opts.title,
    ariaLabel: `${opts.title} — animated 3D ${kind === "game" ? "mini game" : kind}`,
    target: { ...opts.target, kind, aspect: opts.target?.aspect ?? DEFAULT_ASPECT[kind] },
    ...body,
  };
  if (kind === "banner" || kind === "hero" || kind === "square") scene.timeline = { duration: 8, loop: true, tracks: [{ target: "title.rotation.y", keys: [[0, -6], [4, 6], [8, -6]], ease: "inOutSine" }] };
  return scene;
}
