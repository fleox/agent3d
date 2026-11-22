// Chibi humanoid (and the astronaut variant): big round head (~36 % of the
// height), bean-shaped torso, short soft limbs with mitten hands, rounded
// shoes. Hair styles, outfits and accessories are stamped on the bones.

import * as THREE from "three";
import { blushOf, buildFace, onHead, type FaceSpec } from "./face";
import { bone, C, I4, mat, matOn, mix, shade, type Kit, type Parts } from "./parts";
import type { BuildArgs, Look, Rig } from "./rig";

const HEAD_C: [number, number, number] = [0, 0.215, 0.005];
const HEAD_R: [number, number, number] = [0.235, 0.222, 0.215];

// Vertical gradient colour (darker towards the bottom) for soft clay shading.
const grad = (c: THREE.Color, y0: number, y1: number, dark = 0.82) => (_x: number, y: number) => shade(c, dark + (1 - dark) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0))));

function hair(parts: Parts, kit: Kit, head: THREE.Group, look: Look, b: Record<string, THREE.Group>): void {
  // Under a cap / beanie / helmet, top volumes (spikes, curls, bun) would poke through.
  const hat = look.accessories.has("cap") || look.accessories.has("beanie");
  const style = hat && (look.hairStyle === "spiky" || look.hairStyle === "curly" || look.hairStyle === "bun") ? "short" : look.hairStyle;
  if (style === "none") return;
  const h = look.hair;
  const hairCol = (_x: number, y: number) => shade(h, 0.8 + 0.2 * Math.min(1, Math.max(0, y + 0.3)));
  const spec = { center: HEAD_C, radii: HEAD_R };
  // Cap: a sphere cap tilted back (front edge above the brows, back edge at the nape).
  const cap = (theta: number, tilt: number, grow: number) => {
    const g = kit.sphere(1, { thetaStart: 0, thetaLength: theta });
    parts.add(head, g, mat(HEAD_C[0], HEAD_C[1] + 0.004, HEAD_C[2] - 0.004, HEAD_R[0] * grow, HEAD_R[1] * grow, HEAD_R[2] * grow, -tilt), hairCol);
  };
  const fringe = (n: number, size: number, y: number) => {
    for (let k = 0; k < n; k++) {
      const x = (k / (n - 1) - 0.5) * 0.3;
      const q = onHead(spec, x, y - Math.abs(x) * 0.25, 0.004);
      parts.add(head, kit.sphere(size), matOn(q.p, q.n, [1.35, 0.85, 0.55], -x * 1.5), hairCol);
    }
  };
  switch (style) {
    case "short":
      cap(Math.PI * 0.5, 0.72, 1.05);
      fringe(4, 0.055, 0.135);
      break;
    case "spiky": {
      cap(Math.PI * 0.5, 0.7, 1.04);
      const spikes: [number, number, number][] = [[0, 0.98, 0.15], [0.45, 0.85, 0.3], [-0.45, 0.85, 0.3], [0.2, 0.75, 0.62], [-0.2, 0.75, 0.62], [0.65, 0.55, -0.2], [-0.65, 0.55, -0.2], [0, 0.7, -0.6], [0.35, 0.45, -0.75], [-0.35, 0.45, -0.75]];
      for (const [x, y, z] of spikes) {
        const n = new THREE.Vector3(x, y, z).normalize();
        const p = new THREE.Vector3(n.x * HEAD_R[0], n.y * HEAD_R[1], n.z * HEAD_R[2]).add(new THREE.Vector3(...HEAD_C));
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().add(new THREE.Vector3(0, 0.4, -0.3)).normalize());
        const g = kit.cone(0.065, 0.16);
        g.translate(0, 0.06, 0);
        parts.add(head, g, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 0.8)), hairCol);
      }
      break;
    }
    case "curly": {
      cap(Math.PI * 0.52, 0.7, 1.06);
      // Fibonacci-distributed curls over the cap.
      const N = 46;
      for (let k = 0; k < N; k++) {
        const y = 1 - (k / (N - 1)) * 1.25;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const a = k * 2.39996;
        const n = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
        if (n.z > 0.35 && n.y < 0.62) continue; // keep the face clear
        if (n.y < -0.1 && n.z > -0.2) continue;
        const p = new THREE.Vector3(n.x * HEAD_R[0] * 1.06, n.y * HEAD_R[1] * 1.06, n.z * HEAD_R[2] * 1.06).add(new THREE.Vector3(...HEAD_C));
        parts.add(head, kit.sphere(0.058), mat(p.x, p.y, p.z), (_x, yy) => shade(h, 0.85 + yy * 2));
      }
      break;
    }
    case "bob":
    case "long": {
      cap(Math.PI * 0.56, 0.62, 1.07);
      fringe(5, 0.058, 0.14);
      // Side locks + back volume.
      const len = style === "long" ? 0.3 : 0.14;
      for (const s of [-1, 1]) parts.add(head, kit.capsule(0.07, len), mat(s * 0.19, HEAD_C[1] + 0.05, -0.02, 1, 1, 0.85, 0, 0, s * 0.08), hairCol);
      parts.add(head, kit.capsule(0.19, len * 0.8), mat(0, HEAD_C[1] + 0.06, -0.09, 1.05, 1, 0.62), hairCol);
      break;
    }
    case "bun":
      cap(Math.PI * 0.5, 0.65, 1.05);
      fringe(4, 0.05, 0.14);
      parts.add(head, kit.sphere(0.1), mat(0, HEAD_C[1] + 0.24, -0.06), hairCol);
      parts.add(head, kit.torus(0.07, 0.018), mat(0, HEAD_C[1] + 0.185, -0.045, 1, 1, 1, Math.PI / 2 + 0.4), look.accent);
      break;
    case "ponytail": {
      cap(Math.PI * 0.5, 0.68, 1.05);
      fringe(4, 0.052, 0.135);
      const pt = bone("ponytail", head, 0, HEAD_C[1] + 0.12, -0.2);
      parts.add(pt, kit.torus(0.04, 0.016), mat(0, 0, 0, 1, 1, 1, 0.3), look.accent);
      const g = kit.lathe([[0.01, -0.3], [0.05, -0.22], [0.075, -0.1], [0.05, 0]]);
      parts.add(pt, g, mat(0, 0.0, -0.02, 1, 1, 0.85, 0.35), hairCol);
      b.ponytail = pt;
      break;
    }
  }
}

function accessories(parts: Parts, kit: Kit, look: Look, head: THREE.Group, torso: THREE.Group): void {
  const a = look.accessories;
  const spec = { center: HEAD_C, radii: HEAD_R };
  const [cx, cy, cz] = HEAD_C;
  if (a.has("cap")) {
    const g = kit.sphere(1, { thetaLength: Math.PI * 0.52 });
    parts.add(head, g, mat(cx, cy + 0.005, cz - 0.005, HEAD_R[0] * 1.12, HEAD_R[1] * 1.08, HEAD_R[2] * 1.12, -0.12), grad(look.accent, 0, 1, 0.85));
    const visor = kit.sphere(0.17, { thetaLength: Math.PI * 0.5 });
    parts.add(head, visor, mat(cx, cy + 0.085, cz + 0.14, 0.95, 0.12, 1.0, 0.18), shade(look.accent, 0.85));
    parts.add(head, kit.sphere(0.022), mat(cx, cy + 0.245, cz - 0.03), shade(look.accent, 0.8));
  } else if (a.has("beanie")) {
    const g = kit.sphere(1, { thetaLength: Math.PI * 0.52 });
    parts.add(head, g, mat(cx, cy + 0.03, cz - 0.01, HEAD_R[0] * 1.1, HEAD_R[1] * 1.12, HEAD_R[2] * 1.1, -0.2), (x, y) => shade(look.accent, 0.85 + (Math.sin(Math.atan2(x, 0.0001 + y) * 22) > 0 ? 0.1 : 0)));
    parts.add(head, kit.torus(0.24, 0.035), mat(cx, cy + 0.07, cz - 0.0, 1.02, 1.0, 0.95, Math.PI / 2 - 0.2), shade(look.accent, 0.78));
    parts.add(head, kit.sphere(0.06), mat(cx, cy + 0.29, cz - 0.06), mix(look.accent, "#ffffff", 0.7));
  } else if (a.has("crown")) {
    const gold = C("#ffc93c");
    const ring = kit.cyl(0.12, 0.12, 0.06, true);
    parts.add(head, ring, mat(cx, cy + 0.24, cz - 0.02, 1, 1, 1, -0.15), gold);
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2;
      parts.add(head, kit.cone(0.035, 0.08, 6), mat(cx + Math.sin(ang) * 0.11, cy + 0.3, cz - 0.02 + Math.cos(ang) * 0.11 - 0.01, 1, 1, 1, -0.15), gold);
      parts.add(head, kit.sphere(0.014), mat(cx + Math.sin(ang) * 0.12, cy + 0.25, cz - 0.02 + Math.cos(ang) * 0.12), look.accent);
    }
  }
  if (a.has("headphones")) {
    const band = kit.torus(0.255, 0.022, Math.PI);
    parts.add(head, band, mat(cx, cy - 0.01, cz - 0.02, 1, 1.05, 1, 0, 0, 0), C("#2b2d42"));
    for (const s of [-1, 1]) {
      parts.add(head, kit.cyl(0.07, 0.07, 0.06), mat(cx + s * 0.245, cy - 0.02, cz, 1, 1, 1, 0, 0, Math.PI / 2), look.accent);
      parts.add(head, kit.cyl(0.055, 0.055, 0.03), mat(cx + s * 0.28, cy - 0.02, cz, 1, 1, 1, 0, 0, Math.PI / 2), C("#2b2d42"));
    }
  }
  if (a.has("glasses") || a.has("sunglasses")) {
    const frame = a.has("sunglasses") ? C("#1d1d27") : C("#2b2d42");
    for (const s of [-1, 1]) {
      const q = onHead(spec, s * 0.085, -0.02, 0.022);
      parts.add(head, kit.torus(0.052, 0.009), matOn(q.p, q.n), frame);
      if (a.has("sunglasses")) parts.add(head, kit.sphere(0.05), matOn(q.p, q.n, [1, 0.9, 0.18]), C("#141420"));
      const t = onHead(spec, s * 0.2, 0.0, 0.0);
      parts.add(head, kit.capsule(0.007, 0.13), mat(t.p[0], t.p[1] + 0.005, t.p[2] - 0.02, 1, 1, 1, Math.PI / 2, 0, 0), frame);
    }
    const br = onHead(spec, 0, -0.0, 0.025);
    parts.add(head, kit.capsule(0.007, 0.06), mat(br.p[0] - 0.03, br.p[1], br.p[2], 1, 1, 1, 0, 0, Math.PI / 2), frame);
  }
  if (a.has("backpack")) {
    parts.add(torso, kit.rbox(0.25, 0.27, 0.12, 0.05), mat(0, 0.16, -0.17), grad(look.accent, -0.13, 0.13));
    parts.add(torso, kit.rbox(0.17, 0.1, 0.05, 0.025), mat(0, 0.09, -0.235), shade(look.accent, 0.85));
    for (const s of [-1, 1]) parts.add(torso, kit.torus(0.13, 0.016, Math.PI * 1.1), mat(s * 0.085, 0.15, -0.02, 1, 1.15, 0.78, 0, Math.PI / 2, -0.15), shade(look.accent, 0.7));
  }
  if (a.has("scarf")) {
    parts.add(torso, kit.torus(0.085, 0.038), mat(0, 0.285, 0, 1, 1, 0.9, Math.PI / 2), look.accent);
    parts.add(torso, kit.rbox(0.06, 0.15, 0.03, 0.015), mat(0.05, 0.2, 0.11, 1, 1, 1, 0.15, 0, 0.12), shade(look.accent, 0.9));
  }
  if (a.has("bowtie")) {
    for (const s of [-1, 1]) parts.add(torso, kit.cone(0.035, 0.07, 8), mat(s * 0.035, 0.27, 0.105, 1, 1, 0.5, 0, 0, s * Math.PI / 2), look.accent);
    parts.add(torso, kit.sphere(0.018), mat(0, 0.27, 0.11), shade(look.accent, 0.8));
  }
}

export function humanoid({ look, parts, kit }: BuildArgs, astronaut = false): Rig {
  const root = new THREE.Group();
  root.name = "rig";
  const b: Record<string, THREE.Group> = {};
  const skin = look.skin;
  const top = look.shirt;
  const bottom = look.pants;
  const outfit = astronaut ? "astronaut" : look.outfit;
  const longSleeves = outfit === "hoodie" || outfit === "suit" || outfit === "astronaut";
  const skirt = outfit === "dress";
  const white = C("#f4f1ea");

  const hips = (b.hips = bone("hips", root, 0, 0.44, 0));
  parts.add(hips, kit.sphere(0.135), mat(0, 0.0, 0, 1.08, 0.75, 0.82), skirt ? top : bottom);
  if (skirt) {
    const g = kit.lathe([[0.25, -0.17], [0.235, -0.12], [0.18, -0.03], [0.14, 0.06]]);
    parts.add(hips, g, mat(0, 0.0, 0, 1, 1, 0.82), (_x, y) => shade(top, 0.82 + (y + 0.17) * 0.8));
    parts.add(hips, kit.torus(0.245, 0.012), mat(0, -0.165, 0, 1, 1, 0.82, Math.PI / 2), mix(top, "#ffffff", 0.6));
  }
  const torso = (b.torso = bone("torso", hips, 0, 0.04, 0));
  const body = kit.lathe([[0.001, 0], [0.13, 0.0], [0.15, 0.06], [0.148, 0.14], [0.135, 0.21], [0.105, 0.27], [0.05, 0.3], [0.001, 0.305]]);
  parts.add(torso, body, mat(0, -0.02, 0, 1, 1, 0.8), grad(top, -0.02, 0.3, 0.84));
  parts.add(torso, kit.cyl(0.048, 0.055, 0.08), mat(0, 0.3, 0), shade(skin, 0.9));
  if (outfit === "tshirt" || outfit === "overalls") parts.add(torso, kit.torus(0.06, 0.014), mat(0, 0.285, 0.005, 1, 1, 0.85, Math.PI / 2 - 0.1), shade(top, 0.86));
  if (outfit === "hoodie") {
    parts.add(torso, kit.torus(0.1, 0.05), mat(0, 0.28, -0.025, 1, 1, 0.9, Math.PI / 2 + 0.35), shade(top, 0.9));
    parts.add(torso, kit.rbox(0.18, 0.07, 0.04, 0.02), mat(0, 0.06, 0.11, 1, 1, 1, -0.12), shade(top, 0.88));
    for (const s of [-1, 1]) {
      parts.add(torso, kit.capsule(0.007, 0.08), mat(s * 0.03, 0.26, 0.115, 1, 1, 1, 0.12), white);
      parts.add(torso, kit.sphere(0.012), mat(s * 0.03, 0.18, 0.124), white);
    }
  }
  if (outfit === "suit") {
    const shirtV = kit.cone(0.06, 0.16, 3);
    parts.add(torso, shirtV, mat(0, 0.215, 0.105, 1, -1, 0.3, 0.12), white);
    parts.add(torso, kit.cone(0.022, 0.13, 4), mat(0, 0.2, 0.125, 1, -1, 0.4, 0.12), look.accent);
    parts.add(torso, kit.sphere(0.012), mat(0, 0.08, 0.13), shade(top, 0.6));
    parts.add(torso, kit.sphere(0.012), mat(0, 0.03, 0.13), shade(top, 0.6));
  }
  if (outfit === "overalls") {
    parts.add(torso, kit.rbox(0.19, 0.15, 0.05, 0.03), mat(0, 0.07, 0.1, 1, 1, 1, -0.08), grad(bottom, -0.05, 0.12, 0.9));
    for (const s of [-1, 1]) {
      parts.add(torso, kit.capsule(0.014, 0.17), mat(s * 0.075, 0.27, 0.075, 1, 1, 1, -0.5, 0, 0), bottom);
      parts.add(torso, kit.sphere(0.016), mat(s * 0.065, 0.13, 0.13), C("#ffd166"));
    }
  }
  if (astronaut) {
    parts.add(torso, kit.rbox(0.14, 0.09, 0.04, 0.015), mat(0, 0.15, 0.12, 1, 1, 1, -0.05), C("#d9dde6"));
    parts.add(torso, kit.sphere(0.016), mat(-0.035, 0.155, 0.142), C("#ff4d6d"), "glow");
    parts.add(torso, kit.sphere(0.016), mat(0.0, 0.155, 0.142), C("#4ade80"), "glow");
    parts.add(torso, kit.sphere(0.016), mat(0.035, 0.155, 0.142), C("#60a5fa"), "glow");
    parts.add(torso, kit.rbox(0.26, 0.3, 0.14, 0.05), mat(0, 0.15, -0.17), grad(C("#e8eaf0"), -0.15, 0.15));
    parts.add(torso, kit.torus(0.12, 0.035), mat(0, 0.29, 0, 1, 1, 0.92, Math.PI / 2), look.accent);
    parts.add(torso, kit.torus(0.13, 0.02), mat(0, 0.03, 0, 1.12, 1, 0.9, Math.PI / 2), look.accent);
  }

  const head = (b.head = bone("head", torso, 0, 0.31, 0));
  parts.add(head, kit.sphere(1), mat(HEAD_C[0], HEAD_C[1], HEAD_C[2], HEAD_R[0], HEAD_R[1], HEAD_R[2]), skin);
  for (const s of [-1, 1]) parts.add(head, kit.sphere(0.045), mat(s * 0.228, HEAD_C[1] - 0.02, 0, 0.5, 1, 0.8), shade(skin, 0.95));
  const fs: FaceSpec = { center: HEAD_C, radii: HEAD_R, eyeSpread: 0.088, eyeY: -0.02, eyeSize: 0.041, mouthY: -0.112, browColor: shade(look.hair, 0.9), blush: blushOf(skin) };
  const nose = onHead(fs, 0, -0.07, -0.01);
  parts.add(head, kit.sphere(0.02), matOn(nose.p, nose.n, [1.2, 0.9, 0.8]), shade(skin, 0.94));
  const face = buildFace(parts, kit, head, fs);
  if (!astronaut) hair(parts, kit, head, look, b);
  else {
    // Bubble helmet (glass) + rim.
    parts.add(head, kit.sphere(0.34), mat(HEAD_C[0], HEAD_C[1] + 0.005, HEAD_C[2], 1, 0.98, 1), C("#cfe8ff"), "glass");
    parts.add(head, kit.torus(0.2, 0.03), mat(0, 0.01, 0, 1, 1, 1, Math.PI / 2), shade(C("#e8eaf0"), 0.95));
    parts.add(head, kit.sphere(0.03), mat(0.2, HEAD_C[1] + 0.28, -0.05), look.accent, "glow");
    parts.add(head, kit.cyl(0.006, 0.006, 0.12), mat(0.17, HEAD_C[1] + 0.22, -0.05, 1, 1, 1, 0, 0, -0.5), C("#c0c4ce"));
  }
  accessories(parts, kit, look, head, torso);

  const sleeve = longSleeves ? top : skin;
  const arm = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const a = (b[`arm${L}`] = bone(`arm${L}`, torso, s * 0.168, 0.24, 0));
    parts.add(a, kit.sphere(0.058), I4, top);
    if (!longSleeves) parts.add(a, kit.capsule(0.057, 0.04), mat(0, -0.005, 0), top);
    parts.add(a, kit.capsule(0.049, 0.1), mat(0, -0.01, 0), longSleeves ? top : skin);
    const e = (b[`elbow${L}`] = bone(`elbow${L}`, a, 0, -0.125, 0));
    parts.add(e, kit.sphere(0.047), I4, sleeve);
    parts.add(e, kit.capsule(0.045, 0.085), I4, sleeve);
    if (longSleeves) parts.add(e, kit.torus(0.043, 0.012), mat(0, -0.1, 0, 1, 1, 1, Math.PI / 2), astronaut ? look.accent : shade(top, 0.85));
    const hnd = (b[`hand${L}`] = bone(`hand${L}`, e, 0, -0.13, 0));
    const glove = astronaut ? C("#f2f3f6") : skin;
    parts.add(hnd, kit.sphere(0.056), mat(0, -0.025, 0.004, 0.9, 1.0, 0.82), glove);
    parts.add(hnd, kit.sphere(0.024), mat(-s * 0.0, -0.01, 0.045, 1, 1.3, 1, 0.4), glove);
  };
  arm(1);
  arm(-1);
  b.armL!.rotation.z = 0.16;
  b.armR!.rotation.z = -0.16;
  b.armL!.userData.restRot = b.armL!.rotation.clone();
  b.armR!.userData.restRot = b.armR!.rotation.clone();

  const shoe = astronaut ? C("#e8eaf0") : look.accent;
  const leg = (s: 1 | -1) => {
    const L = s > 0 ? "L" : "R";
    const l = (b[`leg${L}`] = bone(`leg${L}`, hips, s * 0.072, -0.03, 0));
    const thigh = skirt ? skin : bottom;
    parts.add(l, kit.capsule(0.062, 0.12), mat(0, -0.005, 0), thigh);
    const k = (b[`knee${L}`] = bone(`knee${L}`, l, 0, -0.17, 0));
    parts.add(k, kit.sphere(0.057), I4, thigh);
    parts.add(k, kit.capsule(0.056, 0.11), I4, skirt ? skin : bottom);
    if (!skirt && outfit !== "astronaut") parts.add(k, kit.torus(0.054, 0.012), mat(0, -0.15, 0, 1, 1, 1, Math.PI / 2), shade(bottom, 0.85));
    if (astronaut) parts.add(k, kit.cyl(0.066, 0.07, 0.09), mat(0, -0.15, 0.0), C("#e8eaf0"));
    // Shoe: rounded toe + white sole.
    parts.add(k, kit.sphere(0.07), mat(0, -0.208, 0.035, 1.0, 0.68, 1.5), grad(shoe, -0.06, 0.04, 0.85));
    parts.add(k, kit.cyl(0.07, 0.072, 0.025), mat(0, -0.245, 0.035, 1.0, 1, 1.5), astronaut ? shade(look.accent, 0.9) : white);
  };
  leg(1);
  leg(-1);
  const contacts: Rig["contacts"] = [[hips, [0, -0.1, 0]]];
  for (const k of [b.kneeL!, b.kneeR!]) contacts.push([k, [0, -0.258, 0.14]], [k, [0, -0.258, -0.07]]);
  return { kind: "biped", root, b, face, tail: [], contacts };
}
