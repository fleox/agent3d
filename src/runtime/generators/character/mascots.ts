// Mascot styles: robot, blob, cat, fox, bird, ghost — chibi proportions
// (big head, small body), soft clay shapes and the shared expressive face.

import * as THREE from "three";
import { blushOf, buildFace, onHead } from "./face";
import { bone, C, I4, mat, matOn, mix, shade } from "./parts";
import type { BuildArgs, Rig } from "./rig";

const grad = (c: THREE.Color, y0: number, y1: number, dark = 0.82) => (_x: number, y: number) => shade(c, dark + (1 - dark) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0))));

export function robot({ look, parts, kit }: BuildArgs): Rig {
  const root = new THREE.Group();
  root.name = "rig";
  const b: Record<string, THREE.Group> = {};
  const metal = look.shirt;
  const joint = look.pants;
  const plate = mix(look.skin, "#eef1f6", 0.75);
  const screen = C("#141629");
  const hips = (b.hips = bone("hips", root, 0, 0.36, 0));
  parts.add(hips, kit.rbox(0.24, 0.1, 0.17, 0.045), I4, joint);
  const torso = (b.torso = bone("torso", hips, 0, 0.04, 0));
  parts.add(torso, kit.rbox(0.34, 0.28, 0.24, 0.09), mat(0, 0.15, 0), grad(metal, 0.0, 0.3, 0.85));
  parts.add(torso, kit.rbox(0.2, 0.13, 0.04, 0.03), mat(0, 0.16, 0.11), plate);
  parts.add(torso, kit.sphere(0.024), mat(0.05, 0.17, 0.13), look.accent, "glow");
  parts.add(torso, kit.sphere(0.018), mat(-0.04, 0.18, 0.128), C("#7cff8a"), "glow");
  for (let k = 0; k < 3; k++) parts.add(torso, kit.rbox(0.07, 0.012, 0.01, 0.005), mat(-0.02, 0.135 - k * 0.022, 0.13), shade(plate, 0.8));
  parts.add(torso, kit.cyl(0.045, 0.055, 0.06), mat(0, 0.31, 0), joint);
  const head = (b.head = bone("head", torso, 0, 0.33, 0));
  parts.add(head, kit.rbox(0.42, 0.33, 0.32, 0.1), mat(0, 0.17, 0), grad(plate, 0.0, 0.34, 0.86));
  parts.add(head, kit.rbox(0.34, 0.22, 0.04, 0.06), mat(0, 0.17, 0.15), screen);
  for (const s of [-1, 1]) {
    parts.add(head, kit.cyl(0.06, 0.06, 0.05), mat(s * 0.215, 0.17, 0, 1, 1, 1, 0, 0, Math.PI / 2), metal);
    parts.add(head, kit.cyl(0.035, 0.035, 0.03), mat(s * 0.245, 0.17, 0, 1, 1, 1, 0, 0, Math.PI / 2), look.accent);
  }
  const ant = (b.antenna = bone("antenna", head, 0, 0.33, 0));
  parts.add(ant, kit.cyl(0.009, 0.012, 0.13), mat(0, 0.065, 0), joint);
  parts.add(ant, kit.sphere(0.035), mat(0, 0.14, 0), look.accent, "glow");
  const face = buildFace(parts, kit, head, { center: [0, 0.17, 0], radii: [3, 3, 0.172], eyeSpread: 0.075, eyeY: 0.02, eyeSize: 0.04, mouthY: -0.055, glow: look.accent, mouthScale: 1, inset: 0 });
  const arm = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const a = (b[`arm${L}`] = bone(`arm${L}`, torso, s * 0.2, 0.24, 0));
    parts.add(a, kit.sphere(0.06), I4, joint);
    parts.add(a, kit.capsule(0.045, 0.08), mat(0, -0.02, 0), metal);
    const e = (b[`elbow${L}`] = bone(`elbow${L}`, a, 0, -0.14, 0));
    parts.add(e, kit.sphere(0.045), I4, joint);
    parts.add(e, kit.capsule(0.042, 0.07), I4, metal);
    const h = (b[`hand${L}`] = bone(`hand${L}`, e, 0, -0.12, 0));
    parts.add(h, kit.sphere(0.055), mat(0, -0.02, 0, 1, 0.9, 0.9), joint);
    for (const z of [-1, 1]) parts.add(h, kit.capsule(0.017, 0.04), mat(0, -0.05, z * 0.025, 1, 1, 1, z * 0.3, 0, 0), plate);
  };
  arm(1);
  arm(-1);
  b.armL!.rotation.z = b.armL!.userData.restRot.z = 0.15;
  b.armR!.rotation.z = b.armR!.userData.restRot.z = -0.15;
  const leg = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const l = (b[`leg${L}`] = bone(`leg${L}`, hips, s * 0.075, -0.04, 0));
    parts.add(l, kit.capsule(0.05, 0.08), mat(0, -0.01, 0), metal);
    const k = (b[`knee${L}`] = bone(`knee${L}`, l, 0, -0.13, 0));
    parts.add(k, kit.sphere(0.048), I4, joint);
    parts.add(k, kit.capsule(0.046, 0.07), I4, metal);
    parts.add(k, kit.rbox(0.12, 0.07, 0.17, 0.035), mat(0, -0.15, 0.025), grad(joint, -0.04, 0.03));
  };
  leg(1);
  leg(-1);
  const contacts: Rig["contacts"] = [[hips, [0, -0.06, 0]]];
  for (const k of [b.kneeL!, b.kneeR!]) contacts.push([k, [0, -0.185, 0.11]], [k, [0, -0.185, -0.06]]);
  return { kind: "biped", root, b, face, tail: [], contacts };
}

export function blob({ look, parts, kit }: BuildArgs): Rig {
  const root = new THREE.Group();
  root.name = "rig";
  const b: Record<string, THREE.Group> = {};
  const body = look.shirt;
  const hips = (b.hips = bone("hips", root, 0, 0.06, 0));
  const torso = (b.torso = bone("torso", hips, 0, 0, 0));
  const shape = kit.lathe([[0.001, 0], [0.24, 0.02], [0.34, 0.16], [0.35, 0.32], [0.3, 0.5], [0.17, 0.62], [0.001, 0.65]]);
  parts.add(torso, shape, mat(0, 0, 0, 1, 1, 0.92), grad(body, 0, 0.6, 0.8));
  parts.add(torso, kit.sphere(0.22), mat(0, 0.2, 0.17, 1, 0.85, 0.5), mix(body, "#ffffff", 0.4));
  const head = (b.head = bone("head", torso, 0, 0.32, 0));
  const face = buildFace(parts, kit, head, { center: [0, 0.03, 0], radii: [0.345, 0.31, 0.335], eyeSpread: 0.105, eyeY: 0.06, eyeSize: 0.055, mouthY: -0.06, brows: false, blush: mix(look.accent, "#ffffff", 0.35) });
  const ant = (b.antenna = bone("antenna", head, 0, 0.32, 0));
  parts.add(ant, kit.cyl(0.011, 0.015, 0.12), mat(0, 0.05, 0, 1, 1, 1, 0.2), shade(body, 0.8));
  parts.add(ant, kit.sphere(0.04), mat(0, 0.115, 0.012), look.accent);
  const arm = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const a = (b[`arm${L}`] = bone(`arm${L}`, torso, s * 0.3, 0.3, 0.02));
    parts.add(a, kit.capsule(0.068, 0.11), mat(0, 0.0, 0), shade(body, 0.95));
  };
  arm(1);
  arm(-1);
  b.armL!.rotation.z = b.armL!.userData.restRot.z = 0.75;
  b.armR!.rotation.z = b.armR!.userData.restRot.z = -0.75;
  const leg = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const l = (b[`leg${L}`] = bone(`leg${L}`, hips, s * 0.13, 0.04, 0));
    parts.add(l, kit.sphere(0.075), mat(0, -0.055, 0.04, 1, 0.62, 1.3), look.pants);
  };
  leg(1);
  leg(-1);
  return { kind: "biped", root, b, face, tail: [], contacts: [[b.legL!, [0, -0.1, 0.04]], [b.legR!, [0, -0.1, 0.04]], [torso, [0, 0.0, 0]]] };
}

// Cat and fox share a chibi quadruped body.
export function quadruped({ look, parts, kit }: BuildArgs, fox: boolean): Rig {
  const root = new THREE.Group();
  root.name = "rig";
  const b: Record<string, THREE.Group> = {};
  const fur = look.skin;
  const dark = look.hair;
  const light = mix(fur, "#fffaf2", fox ? 0.9 : 0.65);
  const hips = (b.hips = bone("hips", root, 0, 0.27, 0));
  const torso = (b.torso = bone("torso", hips, 0, 0, 0));
  const bodyGeo = new THREE.CapsuleGeometry(0.135, 0.22, kit.smooth ? 8 : 3, kit.smooth ? 18 : 8);
  bodyGeo.rotateX(Math.PI / 2);
  parts.add(torso, bodyGeo, mat(0, 0.04, -0.02, 1, 0.95, 1), (_x, y, z) => {
    if (y < -0.06 || (fox && z > 0.1 && y < 0.02)) return light;
    if (!fox && y > 0.03 && z > -0.2 && z < 0.12 && Math.abs(Math.sin(z * 20)) > 0.8) return dark;
    return shade(fur, 0.88 + Math.min(0.12, (y + 0.1) * 0.6));
  });
  if (!fox) {
    parts.add(torso, kit.torus(0.095, 0.02), mat(0, 0.11, 0.18, 1, 1, 1, 0.65), look.shirt);
    parts.add(torso, kit.sphere(0.028), mat(0, 0.05, 0.26), C("#ffd166"));
  } else {
    parts.add(torso, kit.sphere(0.11), mat(0, 0.07, 0.16, 1, 1.0, 0.7), light);
  }
  const head = (b.head = bone("head", torso, 0, 0.17, 0.2));
  const HC: [number, number, number] = [0, 0.09, 0.03];
  const HR: [number, number, number] = fox ? [0.19, 0.165, 0.17] : [0.2, 0.175, 0.18];
  parts.add(head, kit.sphere(1), mat(HC[0], HC[1], HC[2], HR[0], HR[1], HR[2]), (_x, y, z) => (fox && y < -0.2 && z > 0.2 ? light : fur));
  // Cheek fluff / muzzle.
  const muz = onHead({ center: HC, radii: HR }, 0, -0.06, -0.03);
  if (fox) {
    const snout = kit.sphere(0.075);
    parts.add(head, snout, matOn([muz.p[0], muz.p[1] + 0.005, muz.p[2] + 0.02], muz.n, [1.05, 0.75, 1.15]), light);
    for (const s of [-1, 1]) parts.add(head, kit.sphere(0.08), mat(s * 0.12, HC[1] - 0.06, HC[2] + 0.07, 1, 0.75, 0.8, 0, 0, s * 0.4), light);
    parts.add(head, kit.sphere(0.022), matOn([muz.p[0], muz.p[1] + 0.03, muz.p[2] + 0.085], muz.n, [1.3, 0.85, 1]), C("#2a1f24"));
  } else {
    for (const s of [-1, 1]) parts.add(head, kit.sphere(0.055), matOn([s * 0.035, muz.p[1], muz.p[2] - 0.005], muz.n, [1, 0.8, 0.7]), light);
    parts.add(head, kit.sphere(0.018), matOn([0, muz.p[1] + 0.028, muz.p[2] + 0.02], muz.n, [1.35, 0.85, 0.8]), look.accent);
    for (const s of [-1, 1])
      for (const k of [-1, 1]) parts.add(head, kit.capsule(0.004, 0.09), mat(s * 0.085, muz.p[1] + k * 0.012, muz.p[2] - 0.01, 1, 1, 1, 0, 0, s * (Math.PI / 2 + k * 0.12)), shade(light, 0.75));
  }
  for (const s of [-1, 1]) {
    const earH = fox ? 0.15 : 0.1;
    const ear = kit.cone(fox ? 0.07 : 0.065, earH, kit.smooth ? 12 : 4);
    const em = mat(s * 0.1, HC[1] + 0.15 + earH * 0.3, HC[2] - 0.02, 1, 1, 0.5, 0, 0, -s * 0.3);
    parts.add(head, ear, em, (_x, y) => (fox && y > earH * 0.18 ? dark : fur));
    parts.add(head, kit.cone(0.04, earH * 0.65, kit.smooth ? 10 : 4), mat(s * 0.098, HC[1] + 0.145 + earH * 0.25, HC[2] + 0.003, 1, 1, 0.3, 0, 0, -s * 0.3), mix(look.accent, "#ffffff", 0.5));
  }
  const face = buildFace(parts, kit, head, { center: HC, radii: HR, eyeSpread: 0.075, eyeY: 0.015, eyeSize: 0.033, mouthY: fox ? -0.06 : -0.075, brows: false, blush: blushOf(fur), mouthScale: 0.7 });
  face.mouthRoot.position.z += fox ? 0.04 : 0.012;
  face.mouthRoot.userData.rest = face.mouthRoot.position.clone();
  const leg = (name: string, x: number, z: number) => {
    const l = (b[name] = bone(name, hips, x, -0.04, z));
    parts.add(l, kit.capsule(0.048, 0.13), I4, (_x, y) => (fox && y < -0.09 ? dark : fur));
    parts.add(l, kit.sphere(0.055), mat(0, -0.19, 0.015, 1, 0.65, 1.2), fox ? dark : light);
  };
  leg("legFL", 0.075, 0.13);
  leg("legFR", -0.075, 0.13);
  leg("legBL", 0.075, -0.14);
  leg("legBR", -0.075, -0.14);
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = torso;
  let pos = new THREE.Vector3(0, 0.08, -0.22);
  const segs = fox ? 4 : 5;
  for (let k = 0; k < segs; k++) {
    const seg = bone(`tail${k}`, parent, pos.x, pos.y, pos.z, { rx: k === 0 ? (fox ? -1.9 : -1.2) : fox ? 0.18 : 0.32 });
    if (fox) {
      const r = [0.06, 0.085, 0.08, 0.055][k]!;
      const g = kit.sphere(r);
      parts.add(seg, g, mat(0, 0.06, 0, 1, 1.25, 1), k === segs - 1 ? light : fur);
    } else {
      const g = kit.capsule(0.033 - k * 0.003, 0.07);
      g.rotateX(Math.PI);
      parts.add(seg, g, I4, k === segs - 1 ? dark : fur);
    }
    tail.push(seg);
    b[`tail${k}`] = seg;
    parent = seg;
    pos = new THREE.Vector3(0, fox ? 0.1 : 0.085, 0);
  }
  const contacts: Rig["contacts"] = [[torso, [0, -0.1, -0.12]], [torso, [0, -0.08, -0.25]], [torso, [0, 0.04, -0.3]]];
  for (const n of ["legFL", "legFR", "legBL", "legBR"]) contacts.push([b[n]!, [0, -0.225, 0.015]], [b[n]!, [0, -0.12, 0.04]]);
  for (const seg of tail) contacts.push([seg, [0, fox ? 0.12 : 0.085, 0]]);
  return { kind: "quad", root, b, face, tail, contacts };
}

export function bird({ look, parts, kit }: BuildArgs): Rig {
  const root = new THREE.Group();
  root.name = "rig";
  const b: Record<string, THREE.Group> = {};
  const body = look.skin;
  const belly = mix(body, "#fffbea", 0.6);
  const hips = (b.hips = bone("hips", root, 0, 0.17, 0));
  const torso = (b.torso = bone("torso", hips, 0, 0, 0));
  parts.add(torso, kit.sphere(0.23), mat(0, 0.2, 0, 1, 1.0, 1.0), (_x, y, z) => (z > 0.1 && y < 0.08 ? belly : shade(body, 0.85 + Math.min(0.15, (y + 0.2) * 0.4))));
  for (const s of [-1, 0, 1]) {
    const g = kit.sphere(0.06);
    parts.add(torso, g, mat(s * 0.05, 0.2, -0.24, 0.6, 0.35, 1.5, 0.6, s * 0.35, 0), look.shirt);
  }
  const head = (b.head = bone("head", torso, 0, 0.34, 0.03));
  const HC: [number, number, number] = [0, 0.07, 0];
  const HR: [number, number, number] = [0.17, 0.16, 0.16];
  parts.add(head, kit.sphere(1), mat(HC[0], HC[1], HC[2], HR[0], HR[1], HR[2]), body);
  const beakP = onHead({ center: HC, radii: HR }, 0, -0.02, -0.01);
  const beak = kit.cone(0.045, 0.09, kit.smooth ? 14 : 6);
  beak.rotateX(Math.PI / 2);
  parts.add(head, beak, mat(beakP.p[0], beakP.p[1], beakP.p[2] + 0.035, 1, 0.75, 1), look.accent);
  for (let k = 0; k < 3; k++) {
    const g = kit.sphere(0.035);
    parts.add(head, g, mat(0, HC[1] + 0.17 - k * 0.012, -0.0 - k * 0.045, 0.6, 1.6, 0.8, -0.4 - k * 0.4), look.hair);
  }
  const face = buildFace(parts, kit, head, { center: HC, radii: HR, eyeSpread: 0.075, eyeY: 0.035, eyeSize: 0.03, mouthY: -0.07, brows: false, blush: mix(look.accent, "#ffffff", 0.45), mouthScale: 0.6 });
  // Birds talk with the beak: hide the mouth shapes behind it.
  face.hideMouth = true;
  const wing = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const w = (b[`wing${L}`] = bone(`wing${L}`, torso, s * 0.205, 0.26, -0.0));
    const g = kit.sphere(0.14);
    g.scale(0.3, 0.8, 0.85);
    g.translate(s * 0.02, -0.085, -0.02);
    parts.add(w, g, I4, (_x, y) => shade(look.shirt, 0.8 + Math.min(0.2, (y + 0.15) * 0.8)));
  };
  wing(1);
  wing(-1);
  const leg = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const l = (b[`leg${L}`] = bone(`leg${L}`, hips, s * 0.075, 0.04, 0.02));
    parts.add(l, kit.cyl(0.013, 0.013, 0.13), mat(0, -0.075, 0), look.accent);
    for (const a of [-0.55, 0, 0.55]) parts.add(l, kit.capsule(0.012, 0.05), mat(0, -0.14, 0.0, 1, 1, 1, -Math.PI / 2, a, 0), look.accent);
  };
  leg(1);
  leg(-1);
  return { kind: "bird", root, b, face, tail: [], contacts: [[b.legL!, [0, -0.155, 0.03]], [b.legR!, [0, -0.155, 0.03]], [torso, [0, -0.02, 0]]] };
}

export function ghost({ look, parts, kit }: BuildArgs): Rig {
  const root = new THREE.Group();
  root.name = "rig";
  const b: Record<string, THREE.Group> = {};
  const body = look.skin;
  const hips = (b.hips = bone("hips", root, 0, 0.12, 0));
  const torso = (b.torso = bone("torso", hips, 0, 0, 0));
  const g = kit.lathe([[0.3, 0.0], [0.29, 0.08], [0.27, 0.25], [0.27, 0.4], [0.24, 0.55], [0.15, 0.66], [0.001, 0.7]], kit.smooth ? 48 : 14);
  // Wavy hem.
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0.2) continue;
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const w = (1 - y / 0.2) ** 2;
    p.setY(i, y + Math.sin(a * 6) * 0.04 * w);
    const f = 1 + (Math.cos(a * 6) * 0.04 + 0.04) * w;
    p.setX(i, p.getX(i) * f);
    p.setZ(i, p.getZ(i) * f);
  }
  g.deleteAttribute("normal");
  g.computeVertexNormals();
  parts.add(torso, g, mat(0, 0, 0, 1, 1, 0.95), (_x, y) => shade(body, 0.86 + Math.min(0.14, y * 0.3)));
  const head = (b.head = bone("head", torso, 0, 0.42, 0));
  const face = buildFace(parts, kit, head, { center: [0, 0.0, 0], radii: [0.26, 0.25, 0.255], eyeSpread: 0.09, eyeY: 0.04, eyeSize: 0.045, mouthY: -0.06, brows: false, blush: mix(look.accent, "#ffffff", 0.4) });
  const arm = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const a = (b[`arm${L}`] = bone(`arm${L}`, torso, s * 0.255, 0.32, 0));
    parts.add(a, kit.capsule(0.055, 0.09), mat(0, 0.01, 0), shade(body, 0.95));
  };
  arm(1);
  arm(-1);
  b.armL!.rotation.z = b.armL!.userData.restRot.z = 0.75;
  b.armR!.rotation.z = b.armR!.userData.restRot.z = -0.75;
  return { kind: "ghost", root, b, face, tail: [] };
}
