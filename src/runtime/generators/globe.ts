// Data globe (SaaS hero classic): a dot-matrix Earth (dots on simplified
// continents or everywhere), a soft fresnel atmosphere, glowing location
// markers and great-circle arcs with travelling light pulses between
// lat/lon points. One instanced dot mesh + one arc mesh + one marker mesh.
// Deterministic: spin and pulses are pure functions of t.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built } from "./geom";

// Very simplified continent outlines [lon, lat] (enough for a dot globe).
const LAND: [number, number][][] = [
  // North America
  [[-168, 66], [-162, 70], [-140, 70], [-125, 72], [-95, 72], [-80, 73], [-62, 66], [-55, 52], [-66, 45], [-70, 42], [-76, 35], [-81, 31], [-80, 25], [-82, 28], [-84, 30], [-90, 29], [-97, 26], [-97, 21], [-92, 18], [-88, 15], [-83, 9], [-79, 8], [-85, 12], [-90, 14], [-95, 16], [-105, 20], [-110, 24], [-112, 30], [-118, 33], [-123, 38], [-124, 42], [-124, 48], [-130, 54], [-140, 59], [-150, 60], [-158, 57], [-165, 60]],
  // Greenland
  [[-73, 78], [-60, 82], [-30, 83], [-20, 80], [-20, 72], [-30, 68], [-42, 60], [-50, 64], [-55, 70], [-62, 76]],
  // South America
  [[-80, 9], [-72, 12], [-62, 10], [-52, 5], [-50, 0], [-35, -6], [-38, -13], [-40, -22], [-48, -26], [-53, -34], [-58, -38], [-65, -42], [-66, -48], [-69, -52], [-72, -54], [-75, -48], [-73, -38], [-71, -30], [-70, -18], [-76, -14], [-81, -6], [-80, 0], [-78, 3]],
  // Europe
  [[-10, 36], [-9, 43], [-2, 44], [-4, 48], [2, 51], [8, 54], [8, 57], [5, 60], [5, 62], [12, 66], [18, 70], [28, 71], [40, 67], [45, 68], [60, 69], [60, 55], [50, 47], [40, 47], [36, 45], [28, 41], [26, 38], [22, 37], [20, 40], [16, 38], [12, 44], [8, 44], [3, 43], [0, 39], [-6, 36]],
  // Asia
  [[60, 69], [70, 73], [80, 73], [100, 78], [110, 74], [130, 72], [140, 72], [160, 70], [180, 68], [180, 64], [170, 60], [162, 57], [156, 51], [142, 54], [140, 48], [135, 43], [130, 42], [127, 38], [126, 35], [122, 40], [118, 38], [122, 31], [120, 25], [110, 21], [108, 16], [109, 12], [105, 9], [100, 13], [100, 7], [103, 1], [98, 8], [94, 16], [90, 22], [86, 20], [80, 15], [77, 8], [73, 18], [72, 22], [67, 25], [60, 25], [57, 26], [52, 28], [48, 30], [44, 29], [50, 25], [56, 24], [59, 22], [55, 17], [44, 13], [43, 16], [39, 22], [35, 28], [34, 32], [36, 36], [30, 37], [27, 40], [36, 45], [40, 47], [50, 47], [60, 55]],
  // Africa
  [[-17, 15], [-17, 21], [-13, 27], [-10, 30], [-6, 36], [10, 37], [11, 33], [20, 31], [25, 32], [32, 31], [34, 28], [38, 20], [43, 12], [51, 12], [48, 5], [40, -3], [40, -10], [40, -15], [35, -22], [33, -27], [27, -34], [20, -35], [18, -30], [12, -17], [13, -8], [9, -1], [9, 4], [5, 6], [-4, 5], [-8, 4], [-13, 8], [-16, 12]],
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -16]], // Madagascar
  [[114, -22], [114, -34], [118, -35], [124, -33], [131, -31], [138, -35], [141, -38], [147, -38], [150, -37], [153, -31], [153, -25], [146, -19], [142, -11], [136, -12], [130, -12], [126, -14], [122, -18]], // Australia
  [[130, 31], [132, 34], [136, 35], [140, 36], [141, 41], [142, 45], [145, 44], [141, 39], [140, 35], [135, 33]], // Japan
  [[-5, 50], [1, 51], [0, 53], [-2, 56], [-3, 58], [-6, 58], [-5, 55], [-3, 54], [-5, 52]], // Great Britain
  [[109, 1], [117, 7], [119, 1], [116, -4], [110, -3]], // Borneo
  [[95, 5], [98, 4], [106, -6], [101, -3]], // Sumatra
  [[131, -1], [141, -3], [150, -10], [141, -9], [137, -5]], // New Guinea
  [[172, -34], [178, -38], [174, -41], [167, -46], [170, -44]], // New Zealand
  [[-24, 64], [-14, 66], [-13, 64], [-20, 63]], // Iceland
];

function inPoly(lon: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isLand(lat: number, lon: number): boolean {
  if (lat < -66 + 3 * Math.sin(lon * 0.05)) return true; // Antarctica
  return LAND.some((poly) => inPoly(lon, lat, poly));
}

// lat/lon (degrees) → unit vector (lon 0 faces +Z, north = +Y).
export function latLonToVec(lat: number, lon: number, r = 1, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  return out.set(Math.cos(phi) * Math.sin(lam) * r, Math.sin(phi) * r, Math.cos(phi) * Math.cos(lam) * r);
}

const readLatLon = (v: unknown): [number, number] | null => {
  if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") return [v[0], v[1]];
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.lat === "number" && typeof o.lon === "number") return [o.lat, o.lon];
  }
  return null;
};

export const globe: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("globe", raw, ctx);
  const radius = p.num("radius");
  const dotCount = p.int("dots");
  const landOnly = p.bool("continents");
  const dotColor = p.color("dotColor");
  const oceanDots = p.color("oceanDotColor");
  const baseColor = p.color("baseColor");
  const arcColor = p.color("arcColor");
  const markerColor = p.color("markerColor");
  const dotSize = p.num("dotSize");
  const spin = p.num("spin");
  const tilt = p.num("tilt");

  const root = new THREE.Group();
  root.name = "globe";
  const tiltG = new THREE.Group();
  tiltG.rotation.z = (tilt * Math.PI) / 180;
  root.add(tiltG);
  const earth = new THREE.Group();
  earth.name = "globe-earth";
  tiltG.add(earth);

  // Base sphere (slightly smaller than the dot shell).
  const base = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.985, 64, 48), new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7, metalness: 0.1 }));
  base.name = "globe-base";
  base.userData.materialTarget = true;
  earth.add(base);

  // Dots: Fibonacci lattice, kept on land (or everywhere, ocean dots dimmer).
  const dirs: THREE.Vector3[] = [];
  const colors: THREE.Color[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < dotCount; i++) {
    const y = 1 - ((i + 0.5) / dotCount) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const lat = (Math.asin(y) * 180) / Math.PI;
    const lon = (Math.atan2(d.x, d.z) * 180) / Math.PI;
    const land = isLand(lat, lon);
    if (landOnly && !land && oceanDots.getHex() === baseColor.getHex()) continue;
    dirs.push(d);
    colors.push(land ? dotColor : oceanDots);
  }
  const dotGeo = new THREE.CircleGeometry(dotSize * radius * 0.0105, 8);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, Math.max(1, dirs.length));
  dots.name = "globe-dots";
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const z = new THREE.Vector3(0, 0, 1);
  const one = new THREE.Vector3(1, 1, 1);
  dirs.forEach((d, i) => {
    q.setFromUnitVectors(z, d);
    m.compose(d.clone().multiplyScalar(radius * 1.002), q, one);
    dots.setMatrixAt(i, m);
    dots.setColorAt(i, colors[i]!);
  });
  dots.count = dirs.length;
  dots.instanceMatrix.needsUpdate = true;
  dots.computeBoundingSphere();
  earth.add(dots);

  // Atmosphere: back-side fresnel shell, additive.
  if (p.bool("atmosphere")) {
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.16, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: p.color("atmosphereColor") } },
        vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
void main() { float d = smoothstep(0.0, 0.55, -dot(vN, vV)); gl_FragColor = vec4(uColor, d * d * 0.5);
#include <colorspace_fragment>
}`,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    atmo.name = "globe-atmosphere";
    root.add(atmo);
    // Inner rim glow on the globe itself.
    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.004, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: p.color("atmosphereColor") } },
        vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; varying vec3 vN; varying vec3 vV; void main() { float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0); gl_FragColor = vec4(uColor, f * 0.6);
#include <colorspace_fragment>
}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    rim.name = "globe-rim";
    tiltG.add(rim);
  }

  // Markers (points) and arcs.
  const points = (Array.isArray(p.raw("points")) ? (p.raw("points") as unknown[]) : []).map(readLatLon).filter((v): v is [number, number] => !!v);
  const arcsRaw = Array.isArray(p.raw("arcs")) ? (p.raw("arcs") as unknown[]) : [];
  const arcs: [[number, number], [number, number]][] = [];
  for (const a of arcsRaw) {
    let from: [number, number] | null = null;
    let to: [number, number] | null = null;
    if (Array.isArray(a) && a.length === 2) {
      from = readLatLon(a[0]);
      to = readLatLon(a[1]);
    } else if (Array.isArray(a) && a.length === 4 && a.every((x) => typeof x === "number")) {
      from = [a[0], a[1]];
      to = [a[2], a[3]];
    } else if (a && typeof a === "object") {
      from = readLatLon((a as Record<string, unknown>).from);
      to = readLatLon((a as Record<string, unknown>).to);
    }
    if (from && to) arcs.push([from, to]);
  }
  // Arc endpoints are markers too.
  const markerSet = new Map<string, [number, number]>();
  for (const pt of [...points, ...arcs.flat()]) markerSet.set(`${pt[0].toFixed(2)},${pt[1].toFixed(2)}`, pt);
  const markers = [...markerSet.values()];

  const uniforms = { uTime: { value: 0 }, uArc: { value: arcColor }, uMarker: { value: markerColor }, uSpeed: { value: p.num("arcSpeed") } };
  if (markers.length) {
    // Each marker: a core dot + a pulsing ring, one instanced quad with a shader.
    const quad = new THREE.PlaneGeometry(1, 1);
    const mm = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `attribute float aPhase; varying vec2 vUv; varying float vPhase; void main() { vUv = uv; vPhase = aPhase; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uMarker; varying vec2 vUv; varying float vPhase;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float core = smoothstep(0.24, 0.16, d);
  float ph = fract(uTime * 0.6 + vPhase);
  float ring = smoothstep(0.08, 0.0, abs(d - ph)) * (1.0 - ph);
  float glow = exp(-d * d * 9.0) * 0.5;
  float a = max(core, max(ring, glow));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uMarker * (1.0 + core), a);
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const im = new THREE.InstancedMesh(quad, mm, markers.length);
    im.name = "globe-markers";
    const phases = new Float32Array(markers.length);
    const s = radius * 0.11 * p.num("markerSize");
    markers.forEach(([lat, lon], i) => {
      const d = latLonToVec(lat, lon);
      q.setFromUnitVectors(z, d);
      m.compose(d.clone().multiplyScalar(radius * 1.006), q, new THREE.Vector3(s, s, s));
      im.setMatrixAt(i, m);
      phases[i] = (i * 0.37) % 1;
    });
    quad.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    im.frustumCulled = false;
    earth.add(im);
  }
  if (arcs.length) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const ids: number[] = [];
    const idx: number[] = [];
    const segs = 64;
    const sides = 6;
    const tubeR = radius * 0.006 * p.num("arcWidth");
    arcs.forEach(([a, b], ai) => {
      const va = latLonToVec(a[0], a[1]);
      const vb = latLonToVec(b[0], b[1]);
      const ang = va.angleTo(vb);
      const lift = radius * (0.04 + ang * 0.16);
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= segs; k++) {
        const u = k / segs;
        const v = va.clone().lerp(vb, u).normalize();
        if (ang > 3.1) v.copy(new THREE.Vector3().copy(va).applyAxisAngle(new THREE.Vector3(0, 1, 0), u * ang));
        pts.push(v.multiplyScalar(radius + Math.sin(u * Math.PI) * lift));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const frames = curve.computeFrenetFrames(segs, false);
      const base = pos.length / 3;
      for (let k = 0; k <= segs; k++) {
        const c = curve.getPointAt(k / segs);
        const nrm = frames.normals[k]!;
        const bin = frames.binormals[k]!;
        for (let s = 0; s < sides; s++) {
          const th = (s / sides) * Math.PI * 2;
          pos.push(c.x + (nrm.x * Math.cos(th) + bin.x * Math.sin(th)) * tubeR, c.y + (nrm.y * Math.cos(th) + bin.y * Math.sin(th)) * tubeR, c.z + (nrm.z * Math.cos(th) + bin.z * Math.sin(th)) * tubeR);
          uvs.push(k / segs, s / sides);
          ids.push(ai);
        }
        if (k < segs)
          for (let s = 0; s < sides; s++) {
            const a0 = base + k * sides + s, a1 = base + k * sides + ((s + 1) % sides), b0 = a0 + sides, b1 = a1 + sides;
            idx.push(a0, b0, b1, a0, b1, a1);
          }
      }
    });
    const ag = new THREE.BufferGeometry();
    ag.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    ag.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    ag.setAttribute("aArc", new THREE.Float32BufferAttribute(ids, 1));
    ag.setIndex(idx);
    ag.computeBoundingSphere();
    const am = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `attribute float aArc; varying vec2 vUv; varying float vArc; void main() { vUv = uv; vArc = aArc; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uArc; uniform float uSpeed; varying vec2 vUv; varying float vArc;
void main() {
  float head = fract(uTime * 0.35 * uSpeed + vArc * 0.29) * 1.6 - 0.3;
  float d = head - vUv.x;
  float pulse = d > 0.0 ? exp(-d * 9.0) : smoothstep(-0.02, 0.0, d);
  float a = 0.22 + pulse * 0.95;
  a *= smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
  gl_FragColor = vec4(uArc * (0.8 + pulse * 1.6), a);
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arcMesh = new THREE.Mesh(ag, am);
    arcMesh.name = "globe-arcs";
    earth.add(arcMesh);
  }

  return built(root, {
    update: (t) => {
      uniforms.uTime.value = t;
      earth.rotation.y = (p.num("longitude") * -Math.PI) / 180 + (t * spin * Math.PI) / 180;
    },
  });
};
