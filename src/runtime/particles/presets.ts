// Particle presets (CATALOG.particlePresets): parameter sets of the single
// particle system. Object fields (count, area, size, color, …) override them.

import type { Vec3 } from "../../core/types";

export type ParticleShape = "point" | "square" | "circle" | "star" | "spark" | "heart" | "bubble";

export interface ParticleParams {
  count: number;
  area: Vec3;
  size: number;
  colors: string[];
  speed: number;
  direction: Vec3;
  spread: number;
  lifetime: number; // 0 = infinite (positions wrap inside the area)
  opacity: number;
  blending: "normal" | "additive";
  shape: ParticleShape;
  twinkle: number; // 0..1 brightness oscillation
  wander: number; // noise drift amplitude (units)
  spin: number; // rotation speed (turns/s) of the sprite
}

export const PARTICLE_DEFAULTS: ParticleParams = {
  count: 300,
  area: [10, 6, 6],
  size: 0.08,
  colors: ["#ffffff"],
  speed: 0.3,
  direction: [0, 1, 0],
  spread: 0.3,
  lifetime: 0,
  opacity: 1,
  blending: "additive",
  shape: "point",
  twinkle: 0,
  wander: 0.2,
  spin: 0,
};

export const PARTICLE_PRESET_PARAMS: Record<string, Partial<ParticleParams>> = {
  stars: { count: 900, area: [40, 20, 20], size: 0.09, colors: ["#ffffff", "#cfe2ff", "#ffe8c2"], speed: 0, wander: 0, twinkle: 0.8, shape: "point", blending: "additive" },
  snow: { count: 1200, area: [20, 12, 10], size: 0.07, colors: ["#ffffff", "#eef6ff"], speed: 0.6, direction: [0, -1, 0], spread: 0.3, wander: 0.35, shape: "circle", blending: "normal", opacity: 0.95 },
  rain: { count: 2200, area: [20, 12, 10], size: 0.16, colors: ["#b7d3ff", "#9cbcf0"], speed: 9, direction: [-0.06, -1, 0], spread: 0.08, wander: 0, shape: "spark", blending: "normal", opacity: 0.55 },
  fireflies: { count: 90, area: [10, 4, 6], size: 0.14, colors: ["#fff3a0", "#d4ff7a", "#ffe066"], speed: 0.08, spread: 1, wander: 0.7, twinkle: 0.9, shape: "point", blending: "additive" },
  confetti: { count: 320, area: [12, 8, 6], size: 0.16, colors: ["#ff006e", "#ffbe0b", "#3a86ff", "#8338ec", "#06d6a0", "#fb5607"], speed: 1.3, direction: [0, -1, 0], spread: 0.5, wander: 0.45, spin: 0.8, shape: "square", blending: "normal" },
  sparks: { count: 320, area: [1, 0.2, 1], size: 0.06, colors: ["#fff1b8", "#ffd27a", "#ff8a3d"], speed: 4, direction: [0, 1, 0], spread: 0.7, lifetime: 1.1, wander: 0.05, shape: "point", blending: "additive" },
  dust: { count: 450, area: [12, 6, 8], size: 0.035, colors: ["#ffffff", "#fff4dc"], speed: 0.04, spread: 1, wander: 0.45, twinkle: 0.35, opacity: 0.6, shape: "point", blending: "additive" },
  bubbles: { count: 160, area: [8, 6, 4], size: 0.22, colors: ["#d6f3ff", "#a9e4ff"], speed: 0.8, direction: [0, 1, 0], spread: 0.25, wander: 0.18, shape: "bubble", blending: "normal", opacity: 0.85 },
  embers: { count: 220, area: [6, 0.6, 4], size: 0.07, colors: ["#ff7b00", "#ffb347", "#ff3d00"], speed: 1, direction: [0, 1, 0], spread: 0.45, lifetime: 3.2, wander: 0.45, twinkle: 0.4, shape: "point", blending: "additive" },
  hearts: { count: 60, area: [8, 4, 4], size: 0.32, colors: ["#ff4d6d", "#ff8fa3", "#ff006e"], speed: 0.6, direction: [0, 1, 0], spread: 0.3, lifetime: 5, wander: 0.3, shape: "heart", blending: "normal" },
};
