// Flock of stylised birds: ONE instanced mesh (one draw call, ~18 triangles a
// bird). Wings have a dihedral and swept-back tips, so a bird reads as a V /
// chevron from every angle (never a flat "+" edge-on); they flap in the vertex
// shader (inner and outer wing segments, gull-like "M" stroke) and every bird
// alternates flapping and gliding.
//
// Flight is boids-LIKE but a pure function of t (deterministic renders): the
// flock centre follows the mode (orbit / path / drift) and each bird keeps a
// slot in the flock (loose cloud or V formation) plus a smooth noise wander;
// heading comes from the bird's own velocity (finite difference) and it banks
// into turns.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { noise2D } from "../random";
import { generatorParams } from "./params";
import { built } from "./geom";

type Mode = "orbit" | "path" | "drift";

// Bird geometry in local space: forward +z, up +y, wingspan 2 (x = ±1).
// aWing: 0 = body / tail, 1 = wing vertex (flapped in the shader).
export function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], w: number) => {
    pos.push(...a, ...b, ...c);
    wing.push(w, w, w);
  };
  // Body: a slim diamond (nose, tail, top, belly, sides).
  const nose = [0, 0, 0.42], tail = [0, 0.01, -0.34], top = [0, 0.07, 0.04], belly = [0, -0.06, 0.02], l = [-0.075, 0, 0.04], r = [0.075, 0, 0.04];
  for (const [a, b] of [[l, top], [top, r], [r, belly], [belly, l]] as number[][][]) {
    tri(nose, a!, b!, 0);
    tri(tail, b!, a!, 0);
  }
  // Tail fan.
  tri([0, 0.01, -0.3], [-0.14, 0.02, -0.58], [0.14, 0.02, -0.58], 0);
  // Wings: inner (root → elbow) and outer (elbow → swept-back tip) panels.
  for (const s of [-1, 1]) {
    const root0 = [s * 0.05, 0.01, 0.14], root1 = [s * 0.05, 0.01, -0.12];
    const elb0 = [s * 0.48, 0.0, 0.1], elb1 = [s * 0.48, 0.0, -0.14];
    const tip = [s * 1.0, -0.01, -0.26];
    tri(root0, elb0, elb1, 1);
    tri(root0, elb1, root1, 1);
    tri(elb0, tip, elb1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 1));
  g.computeVertexNormals();
  return g;
}

export const birds: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("birds", raw, ctx);
  const count = p.int("count");
  const mode = p.str<Mode>("mode");
  const area = p.vec3("area");
  const speed = p.num("speed");
  const size = p.num("size");
  const spread = p.num("spread");
  const formation = p.str<"loose" | "v">("formation");
  const flapSpeed = p.num("flapSpeed");
  const heading = (p.num("heading") * Math.PI) / 180;
  const color = p.color("color");
  const rng = ctx.rng;

  const geo = birdGeometry();
  geo.scale(size / 2, size / 2, size / 2);
  const phases = new Float32Array(count);
  const rates = new Float32Array(count);
  for (let k = 0; k < count; k++) {
    phases[k] = rng.next() * Math.PI * 2;
    rates[k] = flapSpeed * rng.range(0.82, 1.18);
  }
  geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  geo.setAttribute("aRate", new THREE.InstancedBufferAttribute(rates, 1));

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      "uniform float uTime;\nattribute float aWing;\nattribute float aPhase;\nattribute float aRate;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
{
  // Flap / glide cycle: strong strokes, then a few seconds of gliding.
  float glide = 0.5 + 0.5 * sin(uTime * 0.45 + aPhase * 1.7);
  float amp = mix(0.12, 1.0, smoothstep(0.25, 0.6, glide));
  float f = sin(uTime * aRate * 6.2831853 + aPhase);
  float a1 = 0.32 + f * 0.62 * amp;           // inner panel (dihedral ~18° at rest)
  float a2 = a1 + 0.12 + f * 0.38 * amp;      // outer panel bends further (gull "M")
  float sx = sign(transformed.x);
  float ax = abs(transformed.x);
  float span = ${(size / 2).toFixed(5)};
  float elbow = 0.48 * span;
  float inner = min(ax, elbow);
  float outer = max(ax - elbow, 0.0);
  vec2 wingXY = vec2(inner * cos(a1) + outer * cos(a2), transformed.y + inner * sin(a1) + outer * sin(a2));
  transformed.xy = mix(transformed.xy, vec2(sx * wingXY.x, wingXY.y), aWing);
}
`,
      );
  };
  mat.customProgramCacheKey = () => "agent3d-birds";

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "birds";
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const tint = new THREE.Color();
  for (let k = 0; k < count; k++) mesh.setColorAt(k, tint.copy(color).multiplyScalar(rng.range(0.85, 1.1)));

  // Flock slots (flock frame: x = right, y = up, z = forward) + wander seeds.
  const slots: THREE.Vector3[] = [];
  const seeds: number[] = [];
  const gap = Math.max(size * 1.5, 0.01);
  for (let k = 0; k < count; k++) {
    if (formation === "v") {
      const rank = Math.ceil(k / 2);
      const side = k === 0 ? 0 : k % 2 ? 1 : -1;
      slots.push(new THREE.Vector3(side * rank * gap * 0.9, rng.range(-0.15, 0.15) * gap, -rank * gap * 0.75));
    } else {
      // Uniform in a flattened ellipsoid of radius `spread`.
      const u = rng.next() * Math.PI * 2, v = Math.acos(rng.range(-1, 1)), r = spread * Math.cbrt(rng.next());
      slots.push(new THREE.Vector3(Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r * 0.45, Math.sin(v) * Math.sin(u) * r));
    }
    seeds.push(rng.range(0, 1000));
  }
  const wanderAmp = formation === "v" ? gap * 0.18 : spread * 0.35 + gap * 0.2;

  // Flock centre path (local units) as a pure function of t.
  const rx = Math.max(area[0] / 2, 0.01), rz = Math.max(area[2] / 2, 0.01), ry = area[1] / 2;
  let curve: THREE.CatmullRomCurve3 | null = null;
  if (mode === "path") {
    const pts = (Array.isArray(p.raw("points")) ? (p.raw("points") as unknown[]) : [])
      .filter((q): q is number[] => Array.isArray(q) && q.length >= 3 && q.every((x) => typeof x === "number"))
      .map((q) => new THREE.Vector3(q[0], q[1], q[2]));
    if (pts.length >= 2) curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  }
  const curveLen = curve ? Math.max(curve.getLength(), 0.01) : 1;
  const orbitLen = Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz)));
  const dHead = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
  const centre = (t: number, out: THREE.Vector3): THREE.Vector3 => {
    if (mode === "path" && curve) return curve.getPointAt((((t * speed) / curveLen) % 1 + 1) % 1, out);
    if (mode === "drift") {
      // Crosses the area along `heading`, wraps around (start / end off-area).
      const len = Math.max(area[0], 0.01);
      const d = (((t * speed) % len) + len) % len - len / 2;
      return out.set(dHead.x * d, Math.sin(t * 0.35) * ry * 0.5, dHead.z * d);
    }
    const a = (t * speed * Math.PI * 2) / Math.max(orbitLen, 0.01);
    return out.set(Math.cos(a) * rx, Math.sin(t * 0.3) * ry * 0.6, -Math.sin(a) * rz);
  };

  // Bird k's position at t: centre + slot in the flock frame (oriented along
  // the flock heading) + wander.
  const c0 = new THREE.Vector3(), c1 = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const birdAt = (k: number, t: number, out: THREE.Vector3): THREE.Vector3 => {
    centre(t, c0);
    centre(t + 0.05, c1);
    fwd.subVectors(c1, c0);
    if (mode === "drift") fwd.copy(dHead);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-10) fwd.set(0, 0, 1);
    fwd.normalize();
    right.crossVectors(fwd, UP).normalize();
    const s = slots[k]!;
    const sd = seeds[k]!;
    const w = t * 0.25;
    out.copy(c0)
      .addScaledVector(right, s.x + noise2D(sd, w) * wanderAmp)
      .addScaledVector(fwd, s.z + noise2D(sd + 31.7, w) * wanderAmp)
      .addScaledVector(UP, s.y + noise2D(sd - 57.3, w * 1.3) * wanderAmp * 0.5);
    // Drift: each bird wraps on its own (no whole-flock jump).
    if (mode === "drift") {
      const len = Math.max(area[0], 0.01);
      const along = out.x * dHead.x + out.z * dHead.z;
      const wrapped = ((((along + len / 2) % len) + len) % len) - len / 2;
      out.addScaledVector(dHead, wrapped - along);
    }
    return out;
  };

  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), look = new THREE.Vector3();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), bank = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const Z = new THREE.Vector3(0, 0, 1);
  const n1 = new THREE.Vector3(), n2 = new THREE.Vector3(), target = new THREE.Vector3();
  const h = 0.08;
  const wrapLim = Math.max(speed * h * 6, 0.5) + spread;
  const update = (t: number): void => {
    uniforms.uTime.value = t;
    for (let k = 0; k < count; k++) {
      birdAt(k, t - h, pA);
      birdAt(k, t, pB);
      birdAt(k, t + h, pC);
      v1.subVectors(pB, pA);
      v2.subVectors(pC, pB);
      // A drift wrap (or a standstill) breaks the finite difference: fly along the heading.
      if (v1.lengthSq() < 1e-12 || v2.lengthSq() < 1e-12 || v1.length() > wrapLim || v2.length() > wrapLim) {
        v1.copy(mode === "drift" ? dHead : Z);
        v2.copy(v1);
      }
      look.addVectors(v1, v2).normalize();
      // Turn rate → bank into the turn (a gentle roll), clamped.
      const turn = n1.copy(v1).normalize().cross(n2.copy(v2).normalize()).y;
      const roll = Math.max(-0.45, Math.min(0.45, -turn * 12));
      target.copy(pB).sub(look);
      m.lookAt(pB, target, UP);
      q.setFromRotationMatrix(m);
      bank.setFromAxisAngle(Z, roll);
      q.multiply(bank);
      m.compose(pB, q, one);
      mesh.setMatrixAt(k, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);

  const group = new THREE.Group();
  group.name = "birds";
  group.add(mesh);
  return built(group, { update: (t) => update(t) });
};
