// Procedural animations: pure functions of t (deterministic screenshots).
// Each animation is a set of eased key poses or smooth cycles applied as
// offsets on top of the rest pose. Biped (humanoid, astronaut, robot, blob),
// quadruped (cat, fox), bird and ghost rigs have their own interpretation of
// every animation id.

import * as THREE from "three";
import type { Expression, FaceState, Mouth } from "./face";
import type { Anim, Rig } from "./rig";

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const phase = (t: number, period: number) => (((t / period) % 1) + 1) % 1;

// Looping eased keyframes: frames = [[phase 0..1, value], …] sorted by phase.
export function keys(ph: number, frames: readonly (readonly [number, number])[], ease: (x: number) => number = easeInOut): number {
  const n = frames.length;
  if (n === 1) return frames[0]![1];
  let k = n - 1;
  for (let i = 0; i < n; i++) if (frames[i]![0] <= ph) k = i;
  const [p0, v0] = frames[k]!;
  const [p1raw, v1] = frames[(k + 1) % n]!;
  const p1 = k + 1 < n ? p1raw : p1raw + 1;
  const x = ph < p0 ? ph + 1 : ph;
  return v0 + (v1 - v0) * ease(clamp01((x - p0) / Math.max(1e-6, p1 - p0)));
}

export function resetRig(r: Rig): void {
  r.root.traverse((o) => {
    if (!(o instanceof THREE.Group) || o === r.root) return;
    if (o.userData.rest) o.position.copy(o.userData.rest as THREE.Vector3);
    if (o.userData.restRot) o.rotation.copy(o.userData.restRot as THREE.Euler);
    o.scale.set(1, 1, 1);
  });
  r.root.position.set(0, 0, 0);
  r.root.rotation.set(0, 0, 0);
  r.root.scale.set(1, 1, 1);
}

// Blink: a quick eased close every ~3.4 s (away from the usual screenshot times 0, 1, 1.5, 2, 3).
export function blink(t: number): number {
  const p = ((t % 3.4) + 3.4) % 3.4;
  const d = Math.abs(p - 2.55);
  return d > 0.09 ? 1 : 0.08 + 0.92 * (d / 0.09) ** 2;
}

interface Out {
  mouth?: Mouth;
  talk?: number;
  expression?: Expression;
}

// Rotation offsets helper.
function R(o: THREE.Object3D | undefined, x = 0, y = 0, z = 0): void {
  if (!o) return;
  o.rotation.x += x;
  o.rotation.y += y;
  o.rotation.z += z;
}

// Deterministic syllable pattern for talking (0..1 mouth opening).
const talkCurve = (t: number) => clamp01(Math.abs(Math.sin(t * 11.5)) * (0.55 + 0.45 * Math.sin(t * 2.7 + 1.3)) * (Math.sin(t * 0.9) > -0.75 ? 1 : 0));

function biped(r: Rig, anim: Anim, t: number, style: string): Out {
  const b = r.b;
  const blob = style === "blob";
  const arm = (s: 1 | -1, up: number, fwd: number, elbow: number, twist = 0) => {
    const L = s > 0 ? "L" : "R";
    R(b[`arm${L}`], -fwd, twist * s, s * up);
    R(b[`elbow${L}`], -elbow);
  };
  const leg = (s: 1 | -1, fwd: number, knee: number) => {
    const L = s > 0 ? "L" : "R";
    R(b[`leg${L}`], -fwd);
    R(b[`knee${L}`], knee);
  };
  const breathe = (amt = 1) => {
    const br = Math.sin(t * 2.1);
    b.torso!.scale.set(1 - br * 0.006 * amt, 1 + br * 0.016 * amt, 1 + br * 0.008 * amt);
    if (blob) b.torso!.scale.set(1 + br * 0.03, 1 - br * 0.035, 1 + br * 0.03);
    return br;
  };
  const ponytail = (amp: number, speed: number) => R(b.ponytail, Math.sin(t * speed) * amp * 0.5, 0, Math.sin(t * speed * 0.5 + 0.7) * amp);
  const lean = (x: number) => R(b.torso, x);
  switch (anim) {
    case "none":
      return {};
    case "idle": {
      const br = breathe();
      const sway = Math.sin(t * 0.8);
      b.hips!.position.x += sway * 0.008;
      R(b.hips, 0, 0, sway * 0.025);
      R(b.torso, 0, Math.sin(t * 0.45) * 0.05, -sway * 0.03);
      R(b.head, Math.sin(t * 0.55) * 0.04, Math.sin(t * 0.37) * 0.12, Math.sin(t * 0.8 + 0.5) * 0.05);
      arm(1, 0.04 + br * 0.03, Math.sin(t * 0.9) * 0.04, 0.12);
      arm(-1, 0.04 + br * 0.03, -Math.sin(t * 0.9) * 0.04, 0.12);
      leg(1, 0, sway > 0 ? sway * 0.08 : 0);
      leg(-1, 0, sway < 0 ? -sway * 0.08 : 0);
      R(b.antenna, 0, 0, Math.sin(t * 2.3) * 0.12);
      ponytail(0.08, 1.6);
      return {};
    }
    case "walk":
    case "run": {
      const run = anim === "run";
      const ph = phase(t, run ? 0.64 : 1.0) * TAU;
      const s = Math.sin(ph);
      const amp = run ? 0.95 : 0.5;
      // Knee bends while the leg swings forward (recovery), straight on contact.
      leg(1, s * amp, Math.max(0, Math.sin(ph + 1.6)) * (run ? 1.55 : 0.75) + 0.05);
      leg(-1, -s * amp, Math.max(0, Math.sin(ph + Math.PI + 1.6)) * (run ? 1.55 : 0.75) + 0.05);
      arm(1, 0.02, -s * amp * 0.85, run ? 1.35 : 0.35);
      arm(-1, 0.02, s * amp * 0.85, run ? 1.35 : 0.35);
      const bounce = Math.abs(Math.cos(ph));
      r.root.position.y += (run ? 0.055 : 0.022) * (1 - bounce) - (run ? 0.0 : 0.004);
      b.hips!.position.y -= (run ? 0.03 : 0.01) * bounce;
      R(b.hips, 0, s * 0.14, 0);
      R(b.torso, run ? 0.28 : 0.06, -s * 0.2, 0);
      R(b.head, run ? -0.2 : -0.03, s * 0.08, 0);
      R(b.antenna, -(run ? 0.4 : 0.1) + Math.cos(ph * 2) * 0.1);
      ponytail(run ? 0.35 : 0.15, run ? 19.6 : 12.6);
      if (blob) {
        b.torso!.scale.set(1 + bounce * 0.05, 1.04 - bounce * 0.08, 1 + bounce * 0.03);
        r.root.position.y += (1 - bounce) * (run ? 0.07 : 0.03);
      }
      return run ? { mouth: "laugh" } : {};
    }
    case "wave": {
      breathe();
      const w = Math.sin(t * TAU * 1.5);
      // Right arm up, elbow bent outward, forearm waving.
      arm(-1, 2.2, 0.25, 0, 0);
      R(b.elbowR, 0, 0, -0.2 + w * 0.45);
      R(b.handR, 0, 0, w * 0.25);
      arm(1, 0.06, 0, 0.18);
      R(b.torso, 0, 0.08, 0.05);
      R(b.head, -0.04, 0.1, 0.1 + Math.sin(t * TAU * 0.75) * 0.05);
      b.hips!.position.y += Math.abs(Math.sin(t * TAU * 0.75)) * 0.006;
      ponytail(0.1, 3);
      return {};
    }
    case "jump":
    case "celebrate": {
      const cel = anim === "celebrate";
      const P = cel ? 1.8 : 1.5;
      const ph = phase(t, P);
      // anticipation 0–.22 · launch .22–.3 · air .3–.74 · land .74–.86 · settle
      const crouch = keys(ph, [[0, 0], [0.18, 1], [0.27, -0.25], [0.32, 0], [0.74, 0], [0.79, 0.85], [0.9, 0.1], [0.999, 0]]);
      const air = ph > 0.27 && ph < 0.76 ? Math.sin(((ph - 0.27) / 0.49) * Math.PI) : 0;
      r.root.position.y += air * (cel ? 0.55 : 0.45);
      b.hips!.position.y -= Math.max(0, crouch) * 0.085;
      const tuck = air > 0 ? Math.sin(Math.min(1, ((ph - 0.27) / 0.49) * 1.0) * Math.PI) : 0;
      leg(1, Math.max(0, crouch) * 0.75 + tuck * 0.65, Math.max(0, crouch) * 1.45 + tuck * 1.1);
      leg(-1, Math.max(0, crouch) * 0.75 + tuck * 0.45, Math.max(0, crouch) * 1.45 + tuck * 0.95);
      lean(Math.max(0, crouch) * 0.35 - Math.max(0, -crouch) * 0.2);
      const up = air > 0 || crouch < 0 ? 2.25 + air * 0.2 : 0.25 - Math.max(0, crouch) * 0.5;
      const back = crouch > 0 ? -crouch * 0.6 : air * 0.25;
      if (cel) {
        // Fist pump: one arm high, the other bent; full spin in the air.
        arm(-1, up, back, air > 0 ? 0.25 : 0.4);
        arm(1, air > 0 ? 1.2 : 0.3, back, air > 0 ? 1.6 : 0.4);
        if (air > 0) r.root.rotation.y += easeInOut(clamp01((ph - 0.3) / 0.42)) * TAU;
      } else {
        arm(1, up, back, 0.2);
        arm(-1, up, back, 0.2);
      }
      R(b.head, Math.max(0, crouch) * -0.15 + air * -0.1);
      if (blob) b.torso!.scale.set(1 + Math.max(0, crouch) * 0.2, 1 - Math.max(0, crouch) * 0.22 + tuck * 0.12 + Math.max(0, -crouch) * 0.2, 1 + Math.max(0, crouch) * 0.2);
      ponytail(0.3 * (air + Math.abs(crouch)), 8);
      return cel ? { mouth: "laugh", expression: "laugh" } : air > 0.3 ? { mouth: "laugh" } : {};
    }
    case "cheer": {
      const ph = phase(t, 0.7);
      const pump = keys(ph, [[0, 0], [0.35, 1], [0.6, 0.2]]);
      const hop = Math.max(0, Math.sin(ph * TAU)) ** 2;
      r.root.position.y += hop * 0.07;
      b.hips!.position.y -= (1 - hop) * 0.012;
      arm(1, 2.35 + pump * 0.35, 0.1, 0.25 + (1 - pump) * 0.6);
      arm(-1, 2.35 + pump * 0.35, 0.1, 0.25 + (1 - pump) * 0.6);
      leg(1, hop * 0.15, hop * 0.3);
      leg(-1, hop * 0.15, hop * 0.3);
      R(b.head, -0.12 - pump * 0.08, 0, Math.sin(t * TAU * 0.7) * 0.08);
      if (blob) b.torso!.scale.set(1 - hop * 0.04, 1 + hop * 0.06, 1 - hop * 0.04);
      ponytail(0.25, 9);
      return { mouth: "laugh" };
    }
    case "dance": {
      const beat = t * 2; // 2 beats per second
      const ph = phase(beat, 1);
      const bounce = keys(ph, [[0, 1], [0.5, 0]], easeOut);
      const side = Math.sin(beat * Math.PI);
      b.hips!.position.y -= bounce * 0.03;
      b.hips!.position.x += side * 0.03;
      R(b.hips, 0, 0, side * 0.1);
      R(b.torso, 0.05, Math.sin(beat * Math.PI * 0.5) * 0.35, -side * 0.15);
      R(b.head, bounce * 0.12 - 0.04, 0, side * 0.18);
      const bar = Math.floor(beat / 2) % 2;
      if (bar) {
        arm(1, 2.4 + side * 0.25, 0, 0.2);
        arm(-1, 0.9, 0.6, 1.5);
      } else {
        arm(-1, 2.4 - side * 0.25, 0, 0.2);
        arm(1, 0.9, 0.6, 1.5);
      }
      leg(1, Math.max(0, side) * 0.35, Math.max(0, side) * 0.7 + bounce * 0.15);
      leg(-1, Math.max(0, -side) * 0.35, Math.max(0, -side) * 0.7 + bounce * 0.15);
      r.root.rotation.y += Math.sin(t * 0.6) * 0.35;
      if (blob) b.torso!.scale.set(1 + bounce * 0.05, 1 - bounce * 0.06, 1 + bounce * 0.05);
      ponytail(0.3, 12.6);
      return { mouth: "laugh" };
    }
    case "sit": {
      breathe(0.8);
      // Sitting on the ground: pelvis down, legs forward, hands on the knees.
      const drop = style === "blob" ? 0.03 : style === "robot" ? 0.25 : 0.335;
      r.root.position.y -= drop;
      if (blob) {
        b.torso!.scale.set(1.06, 0.92, 1.06);
        return {};
      }
      const swing = Math.sin(t * 1.6);
      leg(1, 1.6, 0.55 + swing * 0.1);
      leg(-1, 1.6, 0.55 - swing * 0.1);
      // Leaning back on the hands, palms on the ground beside the hips.
      R(b.torso, -0.16);
      arm(1, 0.32, -0.45, 0.05);
      arm(-1, 0.32, -0.45, 0.05);
      R(b.head, Math.sin(t * 0.6) * 0.05 - 0.04, Math.sin(t * 0.4) * 0.18, Math.sin(t * 0.8) * 0.06);
      ponytail(0.08, 1.6);
      return {};
    }
    case "point": {
      breathe();
      // Points to the screen right (its own left) at shoulder height, looking that way.
      const ph = phase(t, 1.6);
      const jab = keys(ph, [[0, 0], [0.12, 1], [0.3, 0.75], [0.6, 0.8]]);
      arm(1, 1.45, 0.35 + jab * 0.08, 0.05);
      R(b.handL, 0, 0, 0.1);
      arm(-1, 0.55, -0.3, 1.5, 0.3);
      R(b.torso, 0, 0.18, -0.04);
      R(b.head, -0.05, 0.3, -0.05);
      return {};
    }
    case "talk": {
      const br = breathe();
      const g = Math.sin(t * 1.3);
      arm(1, 0.15, 0.55 + Math.max(0, g) * 0.35, 1.2 + Math.sin(t * 2.6) * 0.15, -0.4);
      arm(-1, 0.1 + br * 0.03, 0.15 + Math.max(0, -g) * 0.5, 0.4 + Math.max(0, -g) * 0.8, -0.4);
      R(b.head, Math.sin(t * 3.1) * 0.05, Math.sin(t * 0.7) * 0.15, Math.sin(t * 1.1) * 0.06);
      R(b.torso, 0, Math.sin(t * 0.7) * 0.06, 0);
      return { talk: talkCurve(t) };
    }
  }
  return {};
}

function quad(r: Rig, anim: Anim, t: number): Out {
  const b = r.b;
  const tail = r.tail;
  const wag = (speed: number, amp: number, lift = 0) => tail.forEach((s, k) => R(s, k === 0 ? lift : 0, 0, Math.sin(t * speed - k * 0.8) * amp * (0.5 + k * 0.25)));
  const breathe = () => {
    const br = Math.sin(t * 2);
    b.torso!.scale.set(1 + br * 0.012, 1 + br * 0.02, 1);
  };
  const legs = (fl: number, fr: number, bl: number, br: number) => {
    R(b.legFL, fl);
    R(b.legFR, fr);
    R(b.legBL, bl);
    R(b.legBR, br);
  };
  switch (anim) {
    case "none":
      return {};
    case "idle":
      breathe();
      R(b.head, Math.sin(t * 0.6) * 0.06, Math.sin(t * 0.4) * 0.25, Math.sin(t * 0.7) * 0.1);
      wag(1.6, 0.22);
      return {};
    case "walk":
    case "run": {
      const run = anim === "run";
      const ph = phase(t, run ? 0.5 : 0.9) * TAU;
      const amp = run ? 0.8 : 0.45;
      if (run) {
        legs(-Math.sin(ph) * amp, -Math.sin(ph + 0.3) * amp, Math.sin(ph + 0.9) * amp, Math.sin(ph + 1.2) * amp);
        R(b.torso, Math.sin(ph) * 0.12);
        r.root.position.y += Math.max(0, Math.sin(ph)) * 0.06;
      } else {
        legs(Math.sin(ph) * amp, Math.sin(ph + Math.PI) * amp, Math.sin(ph + Math.PI + 0.5) * amp, Math.sin(ph + 0.5) * amp);
        b.hips!.position.y += Math.abs(Math.cos(ph)) * 0.01;
      }
      R(b.head, Math.sin(ph * 2) * 0.05);
      wag(run ? 7 : 3.5, run ? 0.12 : 0.28);
      return run ? { mouth: "laugh" } : {};
    }
    case "wave":
    case "point": {
      breathe();
      const w = anim === "wave" ? Math.sin(t * TAU * 1.5) * 0.3 : 0;
      R(b.legFL, -2.0 + w, 0, anim === "point" ? -0.5 : 0.2);
      R(b.hips, -0.12);
      R(b.head, 0, anim === "point" ? 0.5 : 0, 0.15);
      wag(2.5, 0.3);
      return {};
    }
    case "jump":
    case "celebrate":
    case "cheer": {
      const P = anim === "cheer" ? 0.8 : anim === "celebrate" ? 1.6 : 1.3;
      const ph = phase(t, P);
      const crouch = keys(ph, [[0, 0], [0.2, 1], [0.28, -0.2], [0.33, 0], [0.75, 0], [0.82, 0.7], [0.95, 0]]);
      const air = ph > 0.28 && ph < 0.78 ? Math.sin(((ph - 0.28) / 0.5) * Math.PI) : 0;
      const h = anim === "cheer" ? 0.18 : 0.42;
      r.root.position.y += air * h;
      b.hips!.position.y -= Math.max(0, crouch) * 0.06;
      legs(-air * 0.9, -air * 0.9, air * 0.9, air * 0.9);
      R(b.torso, -air * 0.15);
      if (anim === "celebrate" && air > 0) r.root.rotation.y += easeInOut(clamp01((ph - 0.3) / 0.45)) * TAU;
      R(b.head, -air * 0.2);
      wag(9, 0.35, 0.3);
      return anim === "jump" && air < 0.3 ? {} : { mouth: "laugh" };
    }
    case "dance": {
      const beat = t * 2;
      const side = Math.sin(beat * Math.PI);
      const bounce = keys(phase(beat, 1), [[0, 1], [0.5, 0]], easeOut);
      R(b.hips, 0, 0, side * 0.14);
      b.hips!.position.y -= bounce * 0.025;
      R(b.head, bounce * 0.1, 0, -side * 0.3);
      R(b.legFL, -Math.max(0, side) * 0.9);
      R(b.legFR, -Math.max(0, -side) * 0.9);
      wag(10, 0.5);
      r.root.rotation.y += Math.sin(t * 0.6) * 0.4;
      return { mouth: "laugh" };
    }
    case "sit": {
      breathe();
      // Classic cat sit: rear down, chest up, front legs straight.
      const pitch = -0.62;
      R(b.torso, pitch);
      b.hips!.position.y -= 0.075;
      b.hips!.position.z -= 0.02;
      R(b.legFL, -pitch);
      R(b.legFR, -pitch);
      R(b.legBL, -1.25);
      R(b.legBR, -1.25);
      R(b.head, -pitch * 0.8 + Math.sin(t * 0.6) * 0.05, Math.sin(t * 0.4) * 0.25, Math.sin(t * 0.7) * 0.08);
      wag(1.3, 0.15, 0.6);
      return {};
    }
    case "talk":
      breathe();
      R(b.head, Math.sin(t * 3.1) * 0.08 - 0.05, Math.sin(t * 0.7) * 0.2, Math.sin(t * 1.1) * 0.08);
      wag(2, 0.25);
      return { talk: talkCurve(t) };
  }
  return {};
}

function bird(r: Rig, anim: Anim, t: number): Out {
  const b = r.b;
  const flap = (speed: number, amp: number, base = 0) => {
    const a = Math.sin(t * TAU * speed) * amp + base;
    R(b.wingL, 0, 0, a);
    R(b.wingR, 0, 0, -a);
  };
  switch (anim) {
    case "none":
      return {};
    case "idle":
      b.torso!.scale.y = 1 + Math.sin(t * 2.4) * 0.02;
      R(b.head, Math.max(0, Math.sin(t * 1.1)) * 0.12, keys(phase(t, 3.2), [[0, -0.25], [0.45, -0.25], [0.5, 0.35], [0.95, 0.35]]), 0);
      flap(0.5, 0.04, 0.05);
      return {};
    case "walk":
    case "run": {
      const run = anim === "run";
      const ph = phase(t, run ? 0.36 : 0.6) * TAU;
      r.root.position.y += Math.abs(Math.sin(ph)) * (run ? 0.07 : 0.035);
      R(b.legL, Math.sin(ph) * 0.5);
      R(b.legR, -Math.sin(ph) * 0.5);
      b.head!.position.z += Math.sin(ph * 2) * 0.015;
      R(b.torso, run ? 0.15 : 0, 0, Math.sin(ph) * 0.07);
      flap(run ? 3 : 1, run ? 0.35 : 0.06, run ? 0.45 : 0.05);
      return {};
    }
    case "wave":
    case "point":
      R(b.wingR, 0, 0, anim === "wave" ? -(1.6 + Math.sin(t * TAU * 2) * 0.35) : -1.35);
      R(b.wingL, 0, 0, 0.08);
      R(b.head, 0, anim === "point" ? -0.45 : 0, 0.15);
      return {};
    case "jump":
    case "celebrate":
    case "cheer": {
      const P = anim === "cheer" ? 0.7 : 1.3;
      const ph = phase(t, P);
      const air = ph > 0.15 && ph < 0.85 ? Math.sin(((ph - 0.15) / 0.7) * Math.PI) : 0;
      r.root.position.y += air * (anim === "cheer" ? 0.12 : 0.5);
      flap(anim === "cheer" ? 3 : 4, air > 0 ? 0.6 : 0.1, air > 0 ? 0.8 : 0.4);
      if (anim === "celebrate" && air > 0) r.root.rotation.y += easeInOut(clamp01((ph - 0.2) / 0.6)) * TAU;
      return anim === "jump" ? {} : { mouth: "laugh" };
    }
    case "dance": {
      const f = t * TAU;
      R(b.torso, 0, 0, Math.sin(f) * 0.2);
      R(b.head, Math.abs(Math.sin(f)) * 0.2);
      r.root.position.y += Math.abs(Math.sin(f)) * 0.05;
      flap(2, 0.5, 0.7);
      r.root.rotation.y += Math.sin(f * 0.25) * 0.5;
      return {};
    }
    case "sit":
      r.root.position.y -= 0.12;
      b.torso!.scale.set(1.04, 0.96 + Math.sin(t * 2.4) * 0.015, 1.04);
      R(b.head, 0, Math.sin(t * 0.5) * 0.3, 0);
      flap(0.4, 0.03, 0.02);
      return {};
    case "talk":
      R(b.head, Math.sin(t * 3.4) * 0.08, Math.sin(t * 0.7) * 0.2, 0);
      flap(0.8, Math.max(0, Math.sin(t * 1.3)) * 0.3, 0.1);
      return {};
  }
  return {};
}

function ghost(r: Rig, anim: Anim, t: number): Out {
  const b = r.b;
  const float = Math.sin(t * 1.8);
  r.root.position.y += 0.06 + float * 0.04;
  R(b.torso, 0, 0, Math.sin(t * 1.1) * 0.04);
  b.torso!.scale.set(1 - float * 0.015, 1 + float * 0.03, 1 - float * 0.015);
  const arms = (l: number, rr: number) => {
    R(b.armL, 0, 0, l);
    R(b.armR, 0, 0, -rr);
  };
  switch (anim) {
    case "none":
      r.root.position.y -= float * 0.04;
      return {};
    case "idle":
      arms(Math.sin(t * 1.8) * 0.15, Math.sin(t * 1.8 + 0.4) * 0.15);
      R(b.head, 0, Math.sin(t * 0.5) * 0.1, 0);
      return {};
    case "walk":
    case "run":
      R(b.torso, anim === "run" ? 0.3 : 0.12);
      arms(-0.3 + Math.sin(t * 6) * 0.15, -0.3 - Math.sin(t * 6) * 0.15);
      return anim === "run" ? { mouth: "laugh" } : {};
    case "wave":
      arms(0, 1.5 + Math.sin(t * TAU * 1.5) * 0.45);
      return {};
    case "point":
      arms(1.0, 0);
      R(b.head, 0, 0.3, 0);
      return {};
    case "cheer":
    case "celebrate":
    case "jump": {
      const ph = phase(t, anim === "cheer" ? 0.8 : 1.4);
      const up = Math.sin(ph * Math.PI);
      r.root.position.y += up * (anim === "cheer" ? 0.08 : 0.3);
      arms(1.4 + up * 0.4, 1.4 + up * 0.4);
      if (anim === "celebrate") r.root.rotation.y += easeInOut(ph) * TAU;
      return { mouth: "laugh" };
    }
    case "dance":
      R(b.torso, 0, 0, Math.sin(t * TAU) * 0.15);
      arms(1 + Math.sin(t * TAU) * 0.6, 1 - Math.sin(t * TAU) * 0.6);
      r.root.rotation.y += Math.sin(t * 0.8) * 0.4;
      return { mouth: "laugh" };
    case "sit":
      r.root.position.y -= 0.06;
      b.torso!.scale.set(1.06, 0.92, 1.06);
      arms(-0.3, -0.3);
      return {};
    case "talk":
      arms(0.2 + Math.max(0, Math.sin(t * 1.3)) * 0.7, 0.1);
      R(b.head, Math.sin(t * 3.1) * 0.05, Math.sin(t * 0.7) * 0.15, 0);
      return { talk: talkCurve(t) };
  }
  return {};
}

// Lifts the rig so no contact point (sole, pelvis, paw) goes below y = 0.
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
function groundLock(r: Rig): void {
  if (!r.contacts?.length) return;
  r.root.updateMatrix();
  let min = Infinity;
  for (const [b, p] of r.contacts) {
    _m.identity();
    for (let o: THREE.Object3D | null = b; o && o !== r.root.parent; o = o.parent) {
      o.updateMatrix();
      _m.premultiply(o.matrix);
    }
    _v.set(p[0], p[1], p[2]).applyMatrix4(_m);
    min = Math.min(min, _v.y);
  }
  if (min < 0) r.root.position.y -= min;
}

export function animate(r: Rig, anim: Anim, t: number, style: string, expression: Expression, blinkOn: boolean): FaceState {
  const out = r.kind === "quad" ? quad(r, anim, t) : r.kind === "bird" ? bird(r, anim, t) : r.kind === "ghost" ? ghost(r, anim, t) : biped(r, anim, t, style);
  groundLock(r);
  // Forced animation expressions only replace the default "happy" face.
  const expr = expression === "happy" && out.expression ? out.expression : expression;
  const mouth = expression === "happy" || expression === "laugh" ? out.mouth : undefined;
  return { expression: expr, blink: blinkOn && anim !== "none" ? blink(t) : 1, talk: out.talk, mouth };
}
