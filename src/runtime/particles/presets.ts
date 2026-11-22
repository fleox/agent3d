// Particle presets (CATALOG.particlePresets): parameter sets of the single
// particle system. Object fields (count, area, size, color, …) override them.

import type { Vec3 } from "../../core/types";

export const PARTICLE_SHAPES = ["point", "soft", "square", "circle", "star", "spark", "streak", "heart", "bubble", "smoke", "petal", "leaf", "ring"] as const;
export type ParticleShape = (typeof PARTICLE_SHAPES)[number];

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
  // Emitters (lifetime > 0): constant acceleration (units/s²), colour the
  // particles fade to at the end of their life, size multiplier at the end.
  gravity: Vec3;
  endColor: string | null;
  endSize: number;
  // Velocity stretching for streak sprites (1 = none).
  stretch: number;
  // Swirl around the Y axis (radians/s at the area's edge; galaxy dust).
  swirl: number;
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
  shape: "soft",
  twinkle: 0,
  wander: 0.2,
  spin: 0,
  gravity: [0, 0, 0],
  endColor: null,
  endSize: 1,
  stretch: 1,
  swirl: 0,
};

export const PARTICLE_PRESET_PARAMS: Record<string, Partial<ParticleParams>> = {
  stars: { count: 900, area: [40, 20, 20], size: 0.09, colors: ["#ffffff", "#cfe2ff", "#ffe8c2"], speed: 0, wander: 0, twinkle: 0.8, shape: "point", blending: "additive" },
  snow: { count: 1200, area: [20, 12, 10], size: 0.08, colors: ["#ffffff", "#eef6ff"], speed: 0.6, direction: [0, -1, 0], spread: 0.3, wander: 0.35, shape: "soft", blending: "normal", opacity: 0.95 },
  rain: { count: 2200, area: [20, 12, 10], size: 0.05, colors: ["#c9ddff", "#a9c4f0"], speed: 9, direction: [-0.06, -1, 0], spread: 0.04, wander: 0, shape: "streak", stretch: 9, blending: "normal", opacity: 0.5 },
  fireflies: { count: 90, area: [10, 4, 6], size: 0.16, colors: ["#fff3a0", "#d4ff7a", "#ffe066"], speed: 0.08, spread: 1, wander: 0.7, twinkle: 0.9, shape: "point", blending: "additive" },
  confetti: { count: 320, area: [12, 8, 6], size: 0.16, colors: ["#ff006e", "#ffbe0b", "#3a86ff", "#8338ec", "#06d6a0", "#fb5607"], speed: 1.3, direction: [0, -1, 0], spread: 0.5, wander: 0.45, spin: 0.8, shape: "square", blending: "normal" },
  sparks: { count: 320, area: [0.6, 0.2, 0.6], size: 0.035, colors: ["#fff6d0", "#ffd27a", "#ff9a3d"], speed: 5, direction: [0, 1, 0], spread: 0.45, lifetime: 1.2, wander: 0, gravity: [0, -6, 0], endColor: "#ff4d00", endSize: 0.5, shape: "streak", stretch: 4, blending: "additive" },
  dust: { count: 450, area: [12, 6, 8], size: 0.035, colors: ["#ffffff", "#fff4dc"], speed: 0.04, spread: 1, wander: 0.45, twinkle: 0.35, opacity: 0.6, shape: "soft", blending: "additive" },
  bubbles: { count: 160, area: [8, 6, 4], size: 0.22, colors: ["#d6f3ff", "#a9e4ff"], speed: 0.8, direction: [0, 1, 0], spread: 0.25, wander: 0.18, shape: "bubble", blending: "normal", opacity: 0.85 },
  embers: { count: 220, area: [6, 0.6, 4], size: 0.07, colors: ["#ffb347", "#ff7b00", "#ffd27a"], speed: 1, direction: [0, 1, 0], spread: 0.45, lifetime: 3.2, wander: 0.45, twinkle: 0.4, endColor: "#c81d00", endSize: 0.4, shape: "point", blending: "additive" },
  hearts: { count: 60, area: [8, 4, 4], size: 0.32, colors: ["#ff4d6d", "#ff8fa3", "#ff006e"], speed: 0.6, direction: [0, 1, 0], spread: 0.3, lifetime: 5, wander: 0.3, endSize: 1.3, shape: "heart", blending: "normal" },
  magic: { count: 260, area: [6, 4, 3], size: 0.13, colors: ["#fff3b0", "#e9d5ff", "#a5f3fc", "#fbcfe8"], speed: 0.25, direction: [0, 1, 0], spread: 1, lifetime: 3.5, wander: 0.35, twinkle: 0.9, spin: 0.15, endSize: 0.2, shape: "star", blending: "additive" },
  smoke: { count: 90, area: [1.2, 0.3, 1.2], size: 1.1, colors: ["#d9dde3", "#c3c8d0", "#eef0f3"], speed: 0.7, direction: [0.12, 1, 0], spread: 0.25, lifetime: 6, wander: 0.35, spin: 0.05, endSize: 3.2, endColor: "#f4f5f7", shape: "smoke", blending: "normal", opacity: 0.4 },
  fire: { count: 150, area: [0.6, 0.1, 0.6], size: 0.42, colors: ["#ffd27a", "#ffb347", "#ff9a3d"], speed: 1.9, direction: [0, 1, 0], spread: 0.1, lifetime: 1.0, wander: 0.1, gravity: [0, 0.6, 0], endColor: "#c81d00", endSize: 0.12, shape: "smoke", spin: 0.2, blending: "additive", opacity: 0.5 },
  petals: { count: 140, area: [14, 8, 6], size: 0.27, colors: ["#ffc2d4", "#ffb3c6", "#ffe5ec", "#ff8fab"], speed: 0.55, direction: [0.35, -1, 0.1], spread: 0.4, wander: 0.6, spin: 0.35, shape: "petal", blending: "normal" },
  leaves: { count: 110, area: [14, 8, 6], size: 0.26, colors: ["#e76f51", "#f4a261", "#e9c46a", "#bc4b2a", "#8a9a2b"], speed: 0.7, direction: [0.45, -1, 0.1], spread: 0.45, wander: 0.7, spin: 0.3, shape: "leaf", blending: "normal" },
  galaxyDust: { count: 1800, area: [16, 2, 16], size: 0.05, colors: ["#a5b4fc", "#f0abfc", "#93c5fd", "#ffffff"], speed: 0, wander: 0.15, twinkle: 0.5, swirl: 0.12, opacity: 0.8, shape: "soft", blending: "additive" },
  bokeh: { count: 26, area: [16, 9, 6], size: 1.1, colors: ["#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#bdb2ff", "#ffc6ff"], speed: 0.05, spread: 1, wander: 0.5, twinkle: 0.3, opacity: 0.32, shape: "ring", blending: "additive" },
};
