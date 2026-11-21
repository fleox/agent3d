// Stylised low-poly characters built from primitives with a real bone
// hierarchy (rig → hips → torso → head / shoulders → elbows, hips → knees),
// one merged vertex-coloured mesh per bone, and procedural animations that
// are pure functions of t: idle, walk, run, wave, jump, dance.
//
// Pointer: `object.userData.setPointer(x, y)` (normalised -1..1) turns the
// head / eyes toward the pointer when eyesFollowPointer is true.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { MeshBuilder, built, mat4, shade } from "./geom";

type Style = "humanoid" | "robot" | "blob" | "cat" | "bird";
type Anim = "idle" | "walk" | "run" | "wave" | "jump" | "dance" | "none";

interface Rig {
  rig: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Group;
  armL?: THREE.Group;
  armR?: THREE.Group;
  elbowL?: THREE.Group;
  elbowR?: THREE.Group;
  legL?: THREE.Group;
  legR?: THREE.Group;
  kneeL?: THREE.Group;
  kneeR?: THREE.Group;
  // quadruped
  legFL?: THREE.Group;
  legFR?: THREE.Group;
  legBL?: THREE.Group;
  legBR?: THREE.Group;
  tail?: THREE.Group[];
  // bird
  wingL?: THREE.Group;
  wingR?: THREE.Group;
}

interface Colors {
  skin: THREE.Color;
  shirt: THREE.Color;
  pants: THREE.Color;
  hair: THREE.Color;
  accent: THREE.Color;
}

// Collects primitives per bone, then turns each into one mesh.
class Parts {
  private map = new Map<THREE.Object3D, { solid: MeshBuilder; glow: MeshBuilder }>();
  add(bone: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color | ((x: number, y: number, z: number, f: number) => THREE.Color), glow = false): void {
    let e = this.map.get(bone);
    if (!e) this.map.set(bone, (e = { solid: new MeshBuilder(), glow: new MeshBuilder() }));
    (glow ? e.glow : e.solid).add(geo, m, color);
    geo.dispose();
  }
  finish(solid: THREE.Material, glow: THREE.Material): void {
    for (const [bone, e] of this.map) {
      for (const [b, mat, tag] of [[e.solid, solid, "solid"], [e.glow, glow, "glow"]] as const) {
        if (b.triangles === 0) continue;
        const mesh = new THREE.Mesh(b.build(), mat);
        mesh.name = `${bone.name}-${tag}`;
        mesh.castShadow = true;
        mesh.receiveShadow = tag === "solid";
        bone.add(mesh);
      }
    }
  }
}

const g = (name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group => {
  const o = new THREE.Group();
  o.name = name;
  o.position.set(x, y, z);
  o.userData.rest = o.position.clone();
  parent.add(o);
  return o;
};
const capsule = (r: number, len: number, radial = 7): THREE.BufferGeometry => {
  const c = new THREE.CapsuleGeometry(r, len, 2, radial);
  c.translate(0, -len / 2, 0);
  return c;
};
const rbox = (w: number, h: number, d: number, r: number): THREE.BufferGeometry => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
const ball = (r: number, detail = 1): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, detail);
const I = new THREE.Matrix4();

function eyesOn(parts: Parts, eyes: THREE.Group, spread: number, r: number, z: number, y: number): void {
  const black = new THREE.Color("#1b1b24");
  const white = new THREE.Color("#ffffff");
  for (const s of [-1, 1]) {
    parts.add(eyes, ball(r, 1), mat4(s * spread, y, z, 1, 1.15, 0.7), black);
    parts.add(eyes, ball(r * 0.35, 0), mat4(s * spread + r * 0.35, y + r * 0.4, z + r * 0.55), white);
  }
}

function humanoid(c: Colors, parts: Parts): Rig {
  const rig = new THREE.Group();
  rig.name = "rig";
  const hips = g("hips", rig, 0, 0.4, 0);
  parts.add(hips, rbox(0.25, 0.11, 0.16, 0.05), I, c.pants);
  const torso = g("torso", hips, 0, 0.03, 0);
  parts.add(torso, rbox(0.27, 0.27, 0.17, 0.07), mat4(0, 0.15, 0), (_x, y) => (y < -0.1 ? shade(c.shirt, 0.85) : c.shirt));
  parts.add(torso, new THREE.CylinderGeometry(0.045, 0.05, 0.06, 7), mat4(0, 0.3, 0), shade(c.skin, 0.92));
  const head = g("head", torso, 0, 0.31, 0);
  parts.add(head, ball(0.165, 2), mat4(0, 0.15, 0, 1, 0.96, 0.94), c.skin);
  // hair cap + fringe
  const cap = new THREE.SphereGeometry(0.178, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
  parts.add(head, cap, mat4(0, 0.165, -0.012, 1, 0.98, 1, -0.32), c.hair);
  parts.add(head, rbox(0.25, 0.05, 0.08, 0.025), mat4(0, 0.255, 0.105, 1, 1, 1, 0.35), c.hair);
  // nose, blush, smile
  parts.add(head, ball(0.022, 0), mat4(0, 0.125, 0.16), shade(c.skin, 0.9));
  const blush = c.skin.clone().lerp(new THREE.Color("#ff7a8a"), 0.45);
  for (const s of [-1, 1]) parts.add(head, ball(0.028, 1), mat4(s * 0.1, 0.1, 0.128, 1, 0.6, 0.35), blush);
  parts.add(head, new THREE.TorusGeometry(0.032, 0.008, 4, 8, Math.PI), mat4(0, 0.088, 0.152, 1, 1, 1, 0, 0, Math.PI), new THREE.Color("#6b2f2f"));
  const eyes = g("eyes", head, 0, 0.16, 0);
  eyesOn(parts, eyes, 0.062, 0.026, 0.148, 0);
  // arms
  const mk = (s: number) => {
    const arm = g(s > 0 ? "armL" : "armR", torso, s * 0.165, 0.245, 0);
    parts.add(arm, ball(0.058, 1), I, c.shirt);
    parts.add(arm, capsule(0.048, 0.09), mat4(0, -0.02, 0), c.shirt);
    const elbow = g(s > 0 ? "elbowL" : "elbowR", arm, 0, -0.145, 0);
    parts.add(elbow, capsule(0.04, 0.085), I, c.skin);
    parts.add(elbow, ball(0.048, 1), mat4(0, -0.14, 0.005), c.skin);
    return [arm, elbow] as const;
  };
  const [armL, elbowL] = mk(1);
  const [armR, elbowR] = mk(-1);
  const leg = (s: number) => {
    const l = g(s > 0 ? "legL" : "legR", hips, s * 0.07, -0.03, 0);
    parts.add(l, capsule(0.058, 0.1), mat4(0, -0.01, 0), c.pants);
    const knee = g(s > 0 ? "kneeL" : "kneeR", l, 0, -0.17, 0);
    parts.add(knee, capsule(0.05, 0.1), I, c.pants);
    parts.add(knee, rbox(0.1, 0.065, 0.16, 0.03), mat4(0, -0.17, 0.028), c.accent);
    parts.add(knee, rbox(0.104, 0.02, 0.164, 0.008), mat4(0, -0.195, 0.028), new THREE.Color("#f4f1ea"));
    return [l, knee] as const;
  };
  const [legL, kneeL] = leg(1);
  const [legR, kneeR] = leg(-1);
  return { rig, hips, torso, head, eyes, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR };
}

function robot(c: Colors, parts: Parts): Rig {
  const rig = new THREE.Group();
  rig.name = "rig";
  const metal = c.shirt;
  const joint = c.pants;
  const plate = c.skin.clone().lerp(new THREE.Color("#dfe3ea"), 0.7);
  const hips = g("hips", rig, 0, 0.4, 0);
  parts.add(hips, rbox(0.24, 0.1, 0.16, 0.03), I, joint);
  const torso = g("torso", hips, 0, 0.04, 0);
  parts.add(torso, rbox(0.32, 0.28, 0.2, 0.05), mat4(0, 0.16, 0), metal);
  parts.add(torso, rbox(0.16, 0.1, 0.03, 0.015), mat4(0, 0.18, 0.1), plate);
  parts.add(torso, ball(0.025, 1), mat4(0.04, 0.18, 0.118), c.accent, true);
  parts.add(torso, ball(0.018, 1), mat4(-0.035, 0.19, 0.115), new THREE.Color("#7cff8a"), true);
  parts.add(torso, new THREE.CylinderGeometry(0.04, 0.05, 0.06, 8), mat4(0, 0.32, 0), joint);
  const head = g("head", torso, 0, 0.34, 0);
  parts.add(head, rbox(0.3, 0.24, 0.24, 0.06), mat4(0, 0.13, 0), plate);
  parts.add(head, rbox(0.24, 0.15, 0.03, 0.03), mat4(0, 0.13, 0.115), new THREE.Color("#15172b"));
  for (const s of [-1, 1]) parts.add(head, new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), mat4(s * 0.16, 0.13, 0, 1, 1, 1, 0, 0, Math.PI / 2), metal);
  parts.add(head, new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5), mat4(0, 0.3, 0), joint);
  parts.add(head, ball(0.028, 1), mat4(0, 0.37, 0), c.accent, true);
  const eyes = g("eyes", head, 0, 0.14, 0);
  for (const s of [-1, 1]) parts.add(eyes, rbox(0.05, 0.06, 0.015, 0.012), mat4(s * 0.055, 0, 0.132), c.accent, true);
  parts.add(head, new THREE.TorusGeometry(0.03, 0.006, 4, 8, Math.PI), mat4(0, 0.098, 0.132, 1, 0.8, 1, 0, 0, Math.PI), c.accent, true);
  const mk = (s: number) => {
    const arm = g(s > 0 ? "armL" : "armR", torso, s * 0.2, 0.25, 0);
    parts.add(arm, ball(0.055, 1), I, joint);
    parts.add(arm, rbox(0.07, 0.13, 0.07, 0.02), mat4(0, -0.08, 0), metal);
    const elbow = g(s > 0 ? "elbowL" : "elbowR", arm, 0, -0.16, 0);
    parts.add(elbow, ball(0.04, 1), I, joint);
    parts.add(elbow, rbox(0.06, 0.11, 0.06, 0.02), mat4(0, -0.07, 0), metal);
    parts.add(elbow, rbox(0.075, 0.05, 0.05, 0.015), mat4(0, -0.15, 0), joint);
    return [arm, elbow] as const;
  };
  const [armL, elbowL] = mk(1);
  const [armR, elbowR] = mk(-1);
  const leg = (s: number) => {
    const l = g(s > 0 ? "legL" : "legR", hips, s * 0.075, -0.04, 0);
    parts.add(l, rbox(0.08, 0.13, 0.08, 0.02), mat4(0, -0.07, 0), metal);
    const knee = g(s > 0 ? "kneeL" : "kneeR", l, 0, -0.16, 0);
    parts.add(knee, ball(0.042, 1), I, joint);
    parts.add(knee, rbox(0.075, 0.12, 0.075, 0.02), mat4(0, -0.07, 0), metal);
    parts.add(knee, rbox(0.11, 0.05, 0.16, 0.02), mat4(0, -0.17, 0.025), joint);
    return [l, knee] as const;
  };
  const [legL, kneeL] = leg(1);
  const [legR, kneeR] = leg(-1);
  return { rig, hips, torso, head, eyes, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR };
}

function blobChar(c: Colors, parts: Parts): Rig {
  const rig = new THREE.Group();
  rig.name = "rig";
  const body = c.shirt;
  const hips = g("hips", rig, 0, 0.06, 0);
  const torso = g("torso", hips, 0, 0, 0);
  parts.add(torso, ball(0.34, 3), mat4(0, 0.32, 0, 1, 0.92, 0.95), (_x, y) => (y < -0.15 ? shade(body, 0.9) : body));
  parts.add(torso, ball(0.22, 2), mat4(0, 0.22, 0.17, 1, 0.9, 0.5), body.clone().lerp(new THREE.Color("#ffffff"), 0.35));
  const head = g("head", torso, 0, 0.32, 0);
  const eyes = g("eyes", head, 0, 0.07, 0);
  const white = new THREE.Color("#ffffff");
  for (const s of [-1, 1]) {
    parts.add(eyes, ball(0.075, 2), mat4(s * 0.1, 0, 0.27, 1, 1.1, 0.6), white);
    parts.add(eyes, ball(0.042, 1), mat4(s * 0.1, 0, 0.31, 1, 1.1, 0.6), new THREE.Color("#1b1b24"));
    parts.add(eyes, ball(0.014, 0), mat4(s * 0.1 + 0.015, 0.025, 0.33), white);
  }
  for (const s of [-1, 1]) parts.add(head, ball(0.04, 1), mat4(s * 0.2, -0.03, 0.25, 1, 0.6, 0.4), c.accent.clone().lerp(white, 0.3));
  parts.add(head, new THREE.TorusGeometry(0.035, 0.01, 4, 8, Math.PI), mat4(0, -0.04, 0.315, 1, 1, 1, 0, 0, Math.PI), new THREE.Color("#3a1d2a"));
  // antenna sprout
  parts.add(head, new THREE.CylinderGeometry(0.01, 0.014, 0.12, 5), mat4(0, 0.33, 0, 1, 1, 1, 0.2), shade(body, 0.8));
  parts.add(head, ball(0.035, 1), mat4(0, 0.39, 0.012), c.accent);
  const mkArm = (s: number) => {
    const a = g(s > 0 ? "armL" : "armR", torso, s * 0.31, 0.3, 0);
    parts.add(a, capsule(0.05, 0.08), mat4(0, 0.01, 0), shade(body, 0.95));
    return a;
  };
  const armL = mkArm(1);
  const armR = mkArm(-1);
  const mkLeg = (s: number) => {
    const l = g(s > 0 ? "legL" : "legR", hips, s * 0.13, 0.04, 0);
    parts.add(l, rbox(0.11, 0.07, 0.15, 0.035), mat4(0, -0.06, 0.03), c.pants);
    return l;
  };
  const legL = mkLeg(1);
  const legR = mkLeg(-1);
  return { rig, hips, torso, head, eyes, armL, armR, legL, legR };
}

function cat(c: Colors, parts: Parts): Rig {
  const rig = new THREE.Group();
  rig.name = "rig";
  const fur = c.skin;
  const stripe = c.hair;
  const light = fur.clone().lerp(new THREE.Color("#fff8ee"), 0.65);
  const hips = g("hips", rig, 0, 0.3, 0);
  const torso = g("torso", hips, 0, 0, 0);
  const bodyGeo = new THREE.CapsuleGeometry(0.15, 0.34, 3, 9);
  bodyGeo.rotateX(Math.PI / 2);
  parts.add(torso, bodyGeo, mat4(0, 0.05, 0), (x, y, z) => {
    if (y < -0.07) return light;
    return y > 0.02 && Math.abs(Math.sin(z * 18)) > 0.72 && Math.abs(x) < 0.13 ? stripe : fur;
  });
  parts.add(torso, new THREE.TorusGeometry(0.11, 0.02, 4, 12), mat4(0, 0.13, 0.27, 1, 1, 1, 0.5), c.shirt);
  parts.add(torso, ball(0.025, 0), mat4(0, 0.07, 0.36), new THREE.Color("#ffd166"));
  const head = g("head", torso, 0, 0.18, 0.3);
  parts.add(head, ball(0.15, 2), mat4(0, 0.06, 0.02, 1.08, 0.92, 0.95), (_x, y, z) => (y < -0.05 && z > 0.05 ? light : fur));
  parts.add(head, ball(0.065, 1), mat4(0, 0.005, 0.135, 1.25, 0.75, 0.8), light);
  parts.add(head, ball(0.018, 0), mat4(0, 0.035, 0.19, 1.3, 0.8, 1), c.accent);
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.06, 0.1, 4);
    parts.add(head, ear, mat4(s * 0.085, 0.19, 0, 1, 1, 0.55, 0, 0, -s * 0.25), fur);
    parts.add(head, new THREE.ConeGeometry(0.035, 0.065, 4), mat4(s * 0.083, 0.182, 0.018, 1, 1, 0.3, 0, 0, -s * 0.25), c.accent.clone().lerp(new THREE.Color("#ffffff"), 0.45));
  }
  const eyes = g("eyes", head, 0, 0.075, 0);
  eyesOn(parts, eyes, 0.06, 0.024, 0.145, 0);
  const leg = (name: string, x: number, z: number) => {
    const l = g(name, hips, x, -0.04, z);
    parts.add(l, capsule(0.045, 0.16), I, fur);
    parts.add(l, ball(0.05, 1), mat4(0, -0.24, 0.015, 1, 0.65, 1.2), light);
    return l;
  };
  const legFL = leg("legFL", 0.08, 0.18);
  const legFR = leg("legFR", -0.08, 0.18);
  const legBL = leg("legBL", 0.08, -0.17);
  const legBR = leg("legBR", -0.08, -0.17);
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = torso;
  let pos = new THREE.Vector3(0, 0.1, -0.3);
  for (let k = 0; k < 5; k++) {
    const seg = g(`tail${k}`, parent, pos.x, pos.y, pos.z);
    const geo = new THREE.CapsuleGeometry(0.035 - k * 0.003, 0.08, 2, 6);
    geo.translate(0, 0.04, 0);
    parts.add(seg, geo, mat4(0, 0, 0), k === 4 ? stripe : fur);
    seg.rotation.x = k === 0 ? -0.9 : 0.25;
    seg.userData.restRot = seg.rotation.x;
    tail.push(seg);
    parent = seg;
    pos = new THREE.Vector3(0, 0.1, 0);
  }
  return { rig, hips, torso, head, eyes, legFL, legFR, legBL, legBR, tail };
}

function bird(c: Colors, parts: Parts): Rig {
  const rig = new THREE.Group();
  rig.name = "rig";
  const body = c.skin;
  const belly = body.clone().lerp(new THREE.Color("#fffbea"), 0.55);
  const hips = g("hips", rig, 0, 0.18, 0);
  const torso = g("torso", hips, 0, 0, 0);
  parts.add(torso, ball(0.22, 2), mat4(0, 0.2, 0, 1, 1.05, 1.1), (_x, y, z) => (z > 0.08 && y < 0.05 ? belly : body));
  // tail feathers
  for (const s of [-1, 0, 1]) parts.add(torso, new THREE.ConeGeometry(0.05, 0.18, 4), mat4(s * 0.04, 0.17, -0.25, 1, 1, 0.35, -2.1, s * 0.25, 0), c.shirt);
  const head = g("head", torso, 0, 0.36, 0.04);
  parts.add(head, ball(0.15, 2), mat4(0, 0.06, 0), body);
  parts.add(head, new THREE.ConeGeometry(0.045, 0.11, 6), mat4(0, 0.04, 0.17, 1, 1, 0.75, Math.PI / 2), c.accent);
  for (let k = 0; k < 3; k++) parts.add(head, new THREE.ConeGeometry(0.025, 0.1, 4), mat4(0, 0.21, -0.02 - k * 0.04, 1, 1, 1, -0.3 - k * 0.35), c.hair);
  for (const s of [-1, 1]) parts.add(head, ball(0.025, 1), mat4(s * 0.09, 0.0, 0.11, 1, 0.6, 0.4), c.accent.clone().lerp(new THREE.Color("#ffffff"), 0.4));
  const eyes = g("eyes", head, 0, 0.08, 0);
  eyesOn(parts, eyes, 0.07, 0.022, 0.125, 0);
  const wing = (s: number) => {
    const w = g(s > 0 ? "wingL" : "wingR", torso, s * 0.2, 0.25, -0.01);
    const geo = new THREE.IcosahedronGeometry(0.14, 1);
    geo.scale(0.32, 0.85, 1);
    geo.translate(s * 0.03, -0.09, -0.02);
    parts.add(w, geo, I, (_x, y) => (y < -0.15 ? shade(c.shirt, 0.8) : c.shirt));
    return w;
  };
  const wingL = wing(1);
  const wingR = wing(-1);
  const leg = (s: number) => {
    const l = g(s > 0 ? "legL" : "legR", hips, s * 0.07, 0.04, 0.02);
    parts.add(l, new THREE.CylinderGeometry(0.012, 0.012, 0.14, 5), mat4(0, -0.08, 0), c.accent);
    for (const a of [-0.5, 0, 0.5]) parts.add(l, new THREE.CylinderGeometry(0.01, 0.01, 0.07, 4), mat4(Math.sin(a) * 0.03, -0.215, 0.03 * Math.cos(a), 1, 1, 1, Math.PI / 2, a, 0), c.accent);
    return l;
  };
  const legL = leg(1);
  const legR = leg(-1);
  return { rig, hips, torso, head, eyes, wingL, wingR, legL, legR };
}

const BUILD: Record<Style, (c: Colors, parts: Parts) => Rig> = { humanoid, robot, blob: blobChar, cat, bird };

const TAU = Math.PI * 2;
const blink = (t: number): number => {
  // closes ~0.12 s every ~3.3 s (+ a double blink sometimes)
  const p = t % 3.3;
  const d = Math.min(Math.abs(p - 1.7), Math.abs(p - 1.95) * (Math.floor(t / 3.3) % 3 === 0 ? 1 : 99));
  return d < 0.07 ? 0.12 : 1;
};

function resetRig(r: Rig): void {
  r.rig.traverse((o) => {
    if (o.userData.rest) o.position.copy(o.userData.rest as THREE.Vector3);
    o.rotation.set(typeof o.userData.restRot === "number" ? (o.userData.restRot as number) : 0, 0, 0);
    if (o instanceof THREE.Group) o.scale.set(1, 1, 1);
  });
  r.rig.position.set(0, 0, 0);
  r.rig.rotation.set(0, 0, 0);
}

function animateBiped(r: Rig, anim: Anim, t: number, style: Style): void {
  const arm = (s: 1 | -1, z: number, x: number, elbow: number) => {
    const a = s > 0 ? r.armL : r.armR;
    const e = s > 0 ? r.elbowL : r.elbowR;
    if (a) {
      a.rotation.z = s * z;
      a.rotation.x = x;
    }
    if (e) e.rotation.x = elbow;
  };
  const leg = (s: 1 | -1, x: number, knee: number) => {
    const l = s > 0 ? r.legL : r.legR;
    const k = s > 0 ? r.kneeL : r.kneeR;
    if (l) l.rotation.x = x;
    if (k) k.rotation.x = knee;
  };
  const isBlob = style === "blob";
  switch (anim) {
    case "none":
      arm(1, 0.12, 0, 0);
      arm(-1, 0.12, 0, 0);
      return;
    case "idle": {
      const b = Math.sin(t * 2.2);
      r.torso.scale.set(1 - b * 0.008, 1 + b * 0.018, 1);
      r.hips.position.y += b * 0.004;
      r.head.rotation.z = Math.sin(t * 0.8) * 0.05;
      r.head.rotation.x = Math.sin(t * 0.55) * 0.04;
      arm(1, 0.1 + b * 0.03, Math.sin(t * 0.9) * 0.05, -0.12);
      arm(-1, 0.1 + b * 0.03, -Math.sin(t * 0.9) * 0.05, -0.12);
      if (isBlob) r.torso.scale.set(1 + b * 0.03, 1 - b * 0.035, 1 + b * 0.03);
      return;
    }
    case "walk":
    case "run": {
      const run = anim === "run";
      const f = t * TAU * (run ? 1.45 : 0.95);
      const s = Math.sin(f);
      const amp = run ? 0.95 : 0.5;
      leg(1, -s * amp, Math.max(0, Math.sin(f + 1.4)) * (run ? 1.4 : 0.7));
      leg(-1, s * amp, Math.max(0, Math.sin(f + Math.PI + 1.4)) * (run ? 1.4 : 0.7));
      arm(1, 0.1, s * amp * 0.9, run ? -1.25 : -0.3);
      arm(-1, 0.1, -s * amp * 0.9, run ? -1.25 : -0.3);
      r.hips.position.y += Math.abs(Math.cos(f)) * (run ? 0.045 : 0.02) - (run ? 0.03 : 0.005);
      r.hips.rotation.y = s * 0.12;
      r.torso.rotation.y = -s * 0.18;
      r.torso.rotation.x = run ? 0.25 : 0.04;
      r.head.rotation.x = run ? -0.18 : 0;
      if (isBlob) {
        const sq = Math.abs(Math.cos(f));
        r.torso.scale.set(1 + (1 - sq) * 0.05, 0.95 + sq * 0.08, 1);
        r.rig.position.y = sq * (run ? 0.08 : 0.03);
      }
      return;
    }
    case "wave": {
      const b = Math.sin(t * 2.2);
      arm(-1, 2.55 + Math.sin(t * TAU * 1.4) * 0.12, 0, 0);
      if (r.elbowR) {
        r.elbowR.rotation.x = 0;
        r.elbowR.rotation.z = Math.sin(t * TAU * 1.4) * 0.45 - 0.2;
      }
      arm(1, 0.12 + b * 0.03, 0, -0.15);
      r.head.rotation.z = Math.sin(t * TAU * 0.7) * 0.08 + 0.06;
      r.torso.rotation.z = -0.04;
      r.torso.scale.y = 1 + b * 0.015;
      return;
    }
    case "jump": {
      const P = 1.4;
      const ph = (t % P) / P;
      let lift = 0;
      let crouch = 0;
      if (ph < 0.22) crouch = Math.sin((ph / 0.22) * Math.PI);
      else if (ph < 0.78) {
        const a = (ph - 0.22) / 0.56;
        lift = 4 * a * (1 - a);
      } else crouch = Math.sin(((ph - 0.78) / 0.22) * Math.PI) * 0.8;
      r.rig.position.y = lift * 0.42;
      r.hips.position.y -= crouch * 0.07;
      const tuck = lift > 0 ? Math.sin(Math.min(1, lift) * Math.PI * 0.5) : 0;
      leg(1, -crouch * 0.7 - tuck * 0.5, crouch * 1.3 + tuck * 0.9);
      leg(-1, -crouch * 0.7 - tuck * 0.3, crouch * 1.3 + tuck * 0.7);
      r.torso.rotation.x = crouch * 0.3;
      const up = lift > 0 ? 2.4 * Math.min(1, lift * 1.5) : 0.15 + crouch * 0.2;
      arm(1, up, crouch * 0.5, -0.2);
      arm(-1, up, crouch * 0.5, -0.2);
      if (isBlob) r.torso.scale.set(1 + crouch * 0.18, 1 - crouch * 0.2 + tuck * 0.12, 1 + crouch * 0.18);
      return;
    }
    case "dance": {
      const f = t * TAU * 1.05;
      const s = Math.sin(f);
      r.hips.position.x = s * 0.035;
      r.hips.position.y -= Math.abs(Math.sin(f)) * 0.03;
      r.hips.rotation.z = s * 0.1;
      r.torso.rotation.z = -s * 0.14;
      r.torso.rotation.y = Math.sin(f * 0.5) * 0.3;
      r.head.rotation.z = s * 0.15;
      r.head.rotation.x = Math.abs(Math.cos(f)) * 0.12 - 0.05;
      const up = Math.sin(f * 0.5) > 0;
      arm(1, up ? 2.6 + s * 0.2 : 0.7, 0, up ? 0 : -1.4);
      arm(-1, !up ? 2.6 - s * 0.2 : 0.7, 0, !up ? 0 : -1.4);
      leg(1, -Math.max(0, s) * 0.4, Math.max(0, s) * 0.7);
      leg(-1, -Math.max(0, -s) * 0.4, Math.max(0, -s) * 0.7);
      r.rig.rotation.y = Math.sin(f * 0.25) * 0.4;
      if (isBlob) r.torso.scale.set(1 + s * 0.04, 1 - Math.abs(s) * 0.05, 1);
      return;
    }
  }
}

function animateCat(r: Rig, anim: Anim, t: number): void {
  const legs = [r.legFL!, r.legBR!, r.legFR!, r.legBL!];
  const tail = r.tail ?? [];
  const tailWave = (speed: number, amp: number) => tail.forEach((s, k) => (s.rotation.z = Math.sin(t * speed - k * 0.7) * amp * (0.5 + k * 0.2)));
  switch (anim) {
    case "none":
      return;
    case "idle": {
      const b = Math.sin(t * 2);
      r.torso.scale.y = 1 + b * 0.02;
      r.head.rotation.z = Math.sin(t * 0.7) * 0.08;
      r.head.rotation.y = Math.sin(t * 0.45) * 0.2;
      tailWave(1.6, 0.25);
      return;
    }
    case "walk":
    case "run": {
      const run = anim === "run";
      const f = t * TAU * (run ? 1.8 : 1.1);
      const amp = run ? 0.75 : 0.42;
      if (run) {
        // bound: front pair vs back pair
        r.legFL!.rotation.x = r.legFR!.rotation.x = -Math.sin(f) * amp;
        r.legBL!.rotation.x = r.legBR!.rotation.x = Math.sin(f + 0.6) * amp;
        r.torso.rotation.x = Math.sin(f) * 0.12;
        r.hips.position.y += Math.abs(Math.sin(f)) * 0.05;
      } else {
        legs.forEach((l, k) => (l.rotation.x = Math.sin(f + (k % 2) * Math.PI + (k >= 2 ? 0.5 : 0)) * amp));
        r.hips.position.y += Math.abs(Math.cos(f)) * 0.012;
      }
      r.head.rotation.x = Math.sin(f * 2) * 0.04;
      tailWave(run ? 6 : 3, run ? 0.15 : 0.3);
      return;
    }
    case "wave": {
      r.legFR!.rotation.x = -1.9 + Math.sin(t * TAU * 1.4) * 0.25;
      r.legFR!.rotation.z = -0.2;
      r.hips.rotation.x = -0.15;
      r.head.rotation.z = 0.15;
      tailWave(2.5, 0.35);
      return;
    }
    case "jump": {
      const ph = (t % 1.3) / 1.3;
      let lift = 0;
      let crouch = 0;
      if (ph < 0.25) crouch = Math.sin((ph / 0.25) * Math.PI);
      else if (ph < 0.8) {
        const a = (ph - 0.25) / 0.55;
        lift = 4 * a * (1 - a);
      } else crouch = Math.sin(((ph - 0.8) / 0.2) * Math.PI) * 0.7;
      r.rig.position.y = lift * 0.45;
      r.hips.position.y -= crouch * 0.08;
      r.legFL!.rotation.x = r.legFR!.rotation.x = lift > 0 ? -0.9 * Math.min(1, lift * 2) : 0;
      r.legBL!.rotation.x = r.legBR!.rotation.x = lift > 0 ? 0.9 * Math.min(1, lift * 2) : 0;
      tailWave(4, 0.2);
      return;
    }
    case "dance": {
      const f = t * TAU;
      r.hips.rotation.z = Math.sin(f) * 0.12;
      r.hips.position.y += Math.abs(Math.sin(f)) * 0.04;
      r.head.rotation.z = Math.sin(f + 1) * 0.25;
      r.legFL!.rotation.x = Math.max(0, Math.sin(f)) * -0.8;
      r.legFR!.rotation.x = Math.max(0, -Math.sin(f)) * -0.8;
      tailWave(5, 0.5);
      return;
    }
  }
}

function animateBird(r: Rig, anim: Anim, t: number): void {
  const flap = (speed: number, amp: number, base = 0) => {
    const a = Math.sin(t * TAU * speed) * amp + base;
    r.wingL!.rotation.z = a;
    r.wingR!.rotation.z = -a;
  };
  switch (anim) {
    case "none":
      return;
    case "idle":
      r.torso.scale.y = 1 + Math.sin(t * 2.4) * 0.02;
      r.head.rotation.y = Math.floor(t / 1.6) % 2 ? 0.35 : -0.2;
      r.head.rotation.x = Math.max(0, Math.sin(t * 1.1)) * 0.15;
      flap(0.5, 0.04, 0.05);
      return;
    case "walk":
    case "run": {
      const run = anim === "run";
      const f = t * TAU * (run ? 2.6 : 1.6);
      r.rig.position.y = Math.abs(Math.sin(f)) * (run ? 0.08 : 0.04);
      r.legL!.rotation.x = Math.sin(f) * 0.4;
      r.legR!.rotation.x = -Math.sin(f) * 0.4;
      r.head.position.z += Math.sin(f) * 0.02;
      r.torso.rotation.z = Math.sin(f) * 0.06;
      flap(run ? 3 : 1, run ? 0.35 : 0.06, run ? 0.4 : 0.05);
      return;
    }
    case "wave":
      r.wingR!.rotation.z = -(1.6 + Math.sin(t * TAU * 2) * 0.35);
      r.wingL!.rotation.z = 0.08;
      r.head.rotation.z = 0.15;
      return;
    case "jump": {
      const ph = (t % 1.2) / 1.2;
      const lift = ph > 0.15 && ph < 0.85 ? Math.sin(((ph - 0.15) / 0.7) * Math.PI) : 0;
      r.rig.position.y = lift * 0.5;
      flap(4, lift > 0 ? 0.6 : 0.02, lift > 0 ? 0.6 : 0.05);
      r.hips.position.y -= lift === 0 ? 0.02 : 0;
      return;
    }
    case "dance": {
      const f = t * TAU * 1.1;
      r.torso.rotation.z = Math.sin(f) * 0.18;
      r.head.rotation.x = Math.abs(Math.sin(f)) * 0.2;
      r.rig.position.y = Math.abs(Math.sin(f)) * 0.05;
      flap(2.2, 0.5, 0.7);
      r.rig.rotation.y = Math.sin(f * 0.25) * 0.5;
      return;
    }
  }
}

export const character: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("character", raw, ctx);
  const style = p.str<Style>("style");
  const anim = p.str<Anim>("animation");
  const speed = p.num("animationSpeed");
  const height = p.num("height");
  const follow = p.bool("eyesFollowPointer");
  const colors: Colors = { skin: p.color("skin"), shirt: p.color("shirt"), pants: p.color("pants"), hair: p.color("hair"), accent: p.color("accent") };
  const parts = new Parts();
  const r = BUILD[style](colors, parts);
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: style === "robot" ? 0.45 : 0.75, metalness: style === "robot" ? 0.25 : 0 });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  parts.finish(solid, glow);

  // Normalise the rest pose to the requested height (feet at y = 0).
  r.rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(r.rig);
  const scale = height / Math.max(0.01, box.max.y - Math.min(0, box.min.y));
  const holder = new THREE.Group();
  holder.name = "character-scale";
  holder.scale.setScalar(scale);
  holder.position.y = -Math.min(0, box.min.y) * scale;
  holder.add(r.rig);
  const root = new THREE.Group();
  root.name = "character";
  root.add(holder);

  const pointer = { x: 0, y: 0 };
  root.userData.setPointer = (x: number, y: number) => {
    pointer.x = Math.max(-1, Math.min(1, x));
    pointer.y = Math.max(-1, Math.min(1, y));
  };
  root.userData.bones = Object.fromEntries(Object.entries(r).filter(([, v]) => v instanceof THREE.Object3D).map(([k, v]) => [k, v]));

  const update = (t: number): void => {
    const tt = t * speed;
    resetRig(r);
    if (style === "cat") animateCat(r, anim, tt);
    else if (style === "bird") animateBird(r, anim, tt);
    else animateBiped(r, anim, tt, style);
    if (anim !== "none") r.eyes.scale.y = blink(t + 0.4);
    if (follow) {
      r.head.rotation.y += pointer.x * 0.5;
      r.head.rotation.x -= pointer.y * 0.3;
      r.eyes.position.x += pointer.x * 0.012;
      r.eyes.position.y += pointer.y * 0.01;
    }
  };
  update(0);
  return built(root, { update });
};
