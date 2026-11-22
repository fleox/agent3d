// Faces: eyes with highlights, brows, blush and a set of mouth shapes, laid
// on an ellipsoid head. Every feature that changes with the expression lives
// on its own bone (eyes scale for blinks, closed-eye arcs and mouths are
// shown / hidden by scaling their bone), so expressions are pure bone poses.

import * as THREE from "three";
import { bone, C, I4, Kit, matOn, mix, type Parts, type V3 } from "./parts";

export const EXPRESSIONS = ["happy", "laugh", "neutral", "surprised", "wink", "sad", "angry", "sleepy"] as const;
export type Expression = (typeof EXPRESSIONS)[number];
export type Mouth = "smile" | "laugh" | "neutral" | "o" | "frown";
const MOUTHS: Mouth[] = ["smile", "laugh", "neutral", "o", "frown"];

export interface FaceRig {
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  closedL: THREE.Group;
  closedR: THREE.Group;
  browL?: THREE.Group;
  browR?: THREE.Group;
  mouths: Record<Mouth, THREE.Group>;
  mouthRoot: THREE.Group;
  // Birds talk with their beak: no mouth shape.
  hideMouth: boolean;
  // Robots: glowing screen eyes instead of dark eyes.
  glow: boolean;
}

export interface FaceSpec {
  center: V3; // head ellipsoid centre (in the head bone space)
  radii: V3; // head ellipsoid radii
  eyeSpread: number; // x of each eye centre
  eyeY: number; // eye height relative to the centre
  eyeSize: number; // eye radius
  mouthY: number;
  brows?: boolean;
  browColor?: THREE.Color;
  blush?: THREE.Color | null;
  eyeColor?: THREE.Color;
  // Mouth width factor (1 = default).
  mouthScale?: number;
  glow?: THREE.Color; // glowing screen face (robot)
  // Sink features slightly into the surface (fraction of radius).
  inset?: number;
}

// Point on the ellipsoid surface in front of (x, y) relative to the centre, and its normal.
export function onHead(spec: Pick<FaceSpec, "center" | "radii">, x: number, y: number, lift = 0): { p: V3; n: THREE.Vector3 } {
  const [ax, ay, az] = spec.radii;
  const k = Math.max(0.02, 1 - (x / ax) ** 2 - (y / ay) ** 2);
  const z = az * Math.sqrt(k);
  const n = new THREE.Vector3(x / (ax * ax), y / (ay * ay), z / (az * az)).normalize();
  return { p: [spec.center[0] + x + n.x * lift, spec.center[1] + y + n.y * lift, spec.center[2] + z + n.z * lift], n };
}

// Tube following a 2D curve (x, y relative to the head centre) projected on the
// head surface, expressed relative to `origin` (the bone holding it). Rounded ends.
function surfaceTube(kit: Kit, spec: Pick<FaceSpec, "center" | "radii">, pts: [number, number][], r: number, lift: number, origin: V3): THREE.BufferGeometry[] {
  const v = pts.map(([x, y]) => {
    const q = onHead(spec, x, y, lift);
    return new THREE.Vector3(q.p[0] - origin[0], q.p[1] - origin[1], q.p[2] - origin[2]);
  });
  const curve = new THREE.CatmullRomCurve3(v);
  const tube = new THREE.TubeGeometry(curve, kit.smooth ? 18 : 6, r, kit.smooth ? 8 : 4, false);
  const caps = [v[0]!, v[v.length - 1]!].map((p) => {
    const g = kit.sphere(r);
    g.translate(p.x, p.y, p.z);
    return g;
  });
  return [tube, ...caps];
}

// Parabola samples: y = y0 + bend * (x / w)^2 for x in [-w, w] (bend > 0 = smile "U").
const arcPts = (cx: number, y0: number, w: number, bend: number, n = 7): [number, number][] =>
  Array.from({ length: n }, (_, k) => {
    const u = (k / (n - 1)) * 2 - 1;
    return [cx + u * w, y0 + bend * u * u] as [number, number];
  });

export function buildFace(parts: Parts, kit: Kit, head: THREE.Group, spec: FaceSpec): FaceRig {
  const dark = spec.eyeColor ?? C("#1f1a2b");
  const white = C("#ffffff");
  const mouthDark = C("#5a1f2c");
  const tongue = C("#ff7f8e");
  const glow = spec.glow;
  const es = spec.eyeSize;
  const ms = (spec.mouthScale ?? 1) * es * 1.45;
  const inset = spec.inset ?? 0.25;

  const eye = (s: 1 | -1) => {
    const x = s * spec.eyeSpread;
    const { p, n } = onHead(spec, x, spec.eyeY, -es * inset);
    const b = bone(s > 0 ? "eyeL" : "eyeR", head, p[0], p[1], p[2]);
    const nLocal = n;
    if (glow) {
      parts.add(b, kit.sphere(es), matOn([0, 0, 0], nLocal, [0.9, 1.05, 0.35]), glow, "glow");
    } else {
      parts.add(b, kit.sphere(es), matOn([0, 0, 0], nLocal, [0.82, 1.08, 0.5]), dark);
      // Two highlights: big upper one + tiny lower one (sparkly cartoon eyes).
      const hl = (dx: number, dy: number, r: number) => {
        const q = onHead(spec, x + dx, spec.eyeY + dy, -es * inset + es * 0.42);
        parts.add(b, kit.sphere(r), matOn([q.p[0] - p[0], q.p[1] - p[1], q.p[2] - p[2]], q.n, [1, 1, 0.45]), white);
      };
      hl(es * 0.3, es * 0.42, es * 0.3);
      hl(-es * 0.28, -es * 0.38, es * 0.13);
    }
    // Closed eye: a happy "∩" arc, hidden by default.
    const closed = bone(s > 0 ? "eyeClosedL" : "eyeClosedR", head, p[0], p[1], p[2]);
    for (const g of surfaceTube(kit, spec, arcPts(x, spec.eyeY + es * 0.15, es * 0.8, -es * 0.55), es * 0.16, es * 0.05, p)) parts.add(closed, g, I4, glow ?? dark, glow ? "glow" : "solid");
    // Hidden by applyFace after skinning (a zero scale before binding would collapse the bind pose).
    return [b, closed] as const;
  };
  const [eyeL, closedL] = eye(1);
  const [eyeR, closedR] = eye(-1);

  let browL: THREE.Group | undefined;
  let browR: THREE.Group | undefined;
  if (spec.brows !== false && !glow) {
    const bc = spec.browColor ?? C("#3b2a20");
    const brow = (s: 1 | -1) => {
      const { p, n } = onHead(spec, s * spec.eyeSpread, spec.eyeY + es * 1.75, -es * 0.05);
      const b = bone(s > 0 ? "browL" : "browR", head, p[0], p[1], p[2]);
      b.userData.unit = es;
      const bx = s * spec.eyeSpread;
      const by = spec.eyeY + es * 1.75;
      for (const g of surfaceTube(kit, spec, arcPts(bx, by, es * 0.62, -es * 0.18, 5), es * 0.15, es * 0.06, p)) parts.add(b, g, I4, bc);
      void n;
      return b;
    };
    browL = brow(1);
    browR = brow(-1);
  }

  if (spec.blush !== null && !glow) {
    const bl = spec.blush ?? C("#ff8a9a");
    for (const s of [-1, 1]) {
      const { p, n } = onHead(spec, s * (spec.eyeSpread + es * 0.85), spec.eyeY - es * 1.5, -es * 0.14);
      parts.add(head, kit.sphere(es * 0.62), matOn(p, n, [1.25, 0.72, 0.32]), bl);
    }
  }

  // Mouths: one bone at the mouth spot, one child bone per shape.
  const mp = onHead(spec, 0, spec.mouthY, ms * 0.04);
  const mouthRoot = bone("mouth", head, mp.p[0], mp.p[1], mp.p[2]);
  const n = mp.n;
  const col = glow ?? mouthDark;
  const tag = glow ? "glow" : "solid";
  const mouths = {} as Record<Mouth, THREE.Group>;
  for (const m of MOUTHS) {
    const b = bone(`mouth-${m}`, mouthRoot);
    mouths[m] = b;
    switch (m) {
      case "smile":
      case "frown":
      case "neutral": {
        const w = m === "neutral" ? ms * 0.42 : ms * 0.62;
        const bend = m === "smile" ? ms * 0.42 : m === "frown" ? -ms * 0.32 : 0.0001;
        const y0 = spec.mouthY - (m === "smile" ? ms * 0.3 : m === "frown" ? -ms * 0.15 : 0);
        for (const g of surfaceTube(kit, spec, arcPts(0, y0, w, bend), ms * 0.15, ms * 0.04, mp.p)) parts.add(b, g, I4, col, tag);
        break;
      }
      case "o": {
        parts.add(b, kit.sphere(ms * 0.42), matOn([0, -ms * 0.05, 0], n, [0.85, 1.05, 0.3]), col, tag);
        break;
      }
      case "laugh": {
        // D-shaped open mouth with a tongue.
        const g = kit.sphere(ms * 0.7, { thetaStart: Math.PI / 2, thetaLength: Math.PI / 2 });
        g.translate(0, ms * 0.14, 0);
        parts.add(b, g, matOn([0, 0, 0], n, [1, 0.95, 0.4]), col, tag);
        if (!glow) {
          const tg = kit.sphere(ms * 0.36);
          tg.translate(0, -ms * 0.3, ms * 0.12);
          parts.add(b, tg, matOn([0, 0, 0], n, [1.15, 0.6, 0.45]), tongue);
        }
        break;
      }
    }
  }
  return { eyeL, eyeR, closedL, closedR, browL, browR, mouths, mouthRoot, glow: !!glow, hideMouth: false };
}

// Expression → bone pose. `open` (0..1) blends towards the talking mouth.
export interface FaceState {
  expression: Expression;
  blink: number; // 1 open … 0 closed
  talk?: number; // 0..1 mouth opening when talking
  mouth?: Mouth; // forced mouth (cheer / celebrate)
}

const show = (b: THREE.Group | undefined, on: boolean, s = 1) => {
  if (!b) return;
  b.scale.setScalar(on ? s : 0);
};

export function applyFace(f: FaceRig, st: FaceState): void {
  const e = st.expression;
  let mouth: Mouth = { happy: "smile", laugh: "laugh", neutral: "neutral", surprised: "o", wink: "smile", sad: "frown", angry: "frown", sleepy: "neutral" }[e] as Mouth;
  if (st.mouth) mouth = st.mouth;
  let talkScale = 1;
  if (st.talk !== undefined) {
    // Talking: alternate a small open mouth and the expression mouth.
    if (st.talk > 0.35) mouth = e === "sad" || e === "angry" ? "o" : "laugh";
    talkScale = st.talk > 0.35 ? 0.55 + st.talk * 0.45 : 1;
  }
  for (const [k, b] of Object.entries(f.mouths)) show(b, k === mouth && !f.hideMouth, k === mouth && mouth !== "smile" ? talkScale : 1);
  if (mouth === "laugh" && st.talk !== undefined) f.mouths.laugh.scale.y = talkScale * (0.6 + (st.talk ?? 0) * 0.4);

  // Eyes.
  let openL = st.blink;
  let openR = st.blink;
  let closedL = false;
  let closedR = false;
  let eyeScale = 1;
  if (e === "laugh") closedL = closedR = true;
  if (e === "wink") closedR = true;
  if (e === "surprised") eyeScale = 1.18;
  if (e === "angry") openL = openR = Math.min(st.blink, 0.72);
  if (e === "sleepy") openL = openR = Math.min(st.blink, 0.35);
  const eyeY = (b: THREE.Group, open: number, closed: boolean, cb: THREE.Group) => {
    if (closed) {
      b.scale.setScalar(0);
      show(cb, true);
    } else {
      b.scale.set(eyeScale, eyeScale * Math.max(0.08, open), eyeScale);
      show(cb, false);
    }
  };
  eyeY(f.eyeL, openL, closedL, f.closedL);
  eyeY(f.eyeR, openR, closedR, f.closedR);

  // Brows: raise (y offset in eye-size units) and tilt (inner end up > 0).
  const brow = { happy: [0.15, 0.05], laugh: [0.3, 0.1], neutral: [0, 0], surprised: [0.75, 0.05], wink: [0.25, 0.1], sad: [0.15, 0.4], angry: [-0.2, -0.45], sleepy: [-0.15, 0] }[e] as [number, number];
  for (const [b, s] of [[f.browL, 1], [f.browR, -1]] as const) {
    if (!b) continue;
    const rest = b.userData.rest as THREE.Vector3;
    const size = (b.userData.unit as number) ?? 0.04;
    b.position.copy(rest);
    b.position.y += brow[0] * size;
    // Positive tilt raises the inner end (towards x = 0).
    b.rotation.z = -s * brow[1];
    if (e === "wink" && s < 0) b.position.y -= 0.3 * size;
  }
}

export const blushOf = (skin: THREE.Color): THREE.Color => mix(skin, "#ff6f8a", 0.5);
