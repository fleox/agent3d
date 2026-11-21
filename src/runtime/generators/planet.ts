// Small stylised planet: faceted icosphere displaced by 3D fbm, biome colours
// (deep/shallow ocean, beach, land, mountain, ice caps), optional rings and a
// fresnel atmosphere shell.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { fbm3D } from "../random";
import { generatorParams } from "./params";
import { built, smoothstep } from "./geom";

export const planet: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("planet", raw, ctx);
  const radius = p.num("radius");
  const palette = p.colors("palette");
  const land = p.num("landAmount");
  const detail = p.int("detail");
  const ocean = palette[0]!;
  const grass = palette[1] ?? ocean;
  const mountain = palette[2] ?? grass;
  const ice = palette[3] ?? new THREE.Color("#ffffff");
  const rng = ctx.rng;
  const off = new THREE.Vector3(rng.range(-100, 100), rng.range(-100, 100), rng.range(-100, 100));

  // 20 * 4^detail faces.
  const ico = new THREE.IcosahedronGeometry(1, Math.pow(2, detail) - 1);
  const geo = ico.index ? ico.toNonIndexed() : ico;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const count = pos.count;
  const v = new THREE.Vector3();
  // noise per unique vertex (cache by key so facets stay closed)
  const cache = new Map<string, number>();
  const noiseAt = (x: number, y: number, z: number): number => {
    const k = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    let n = cache.get(k);
    if (n === undefined) {
      n = fbm3D(x * 1.4 + off.x, y * 1.4 + off.y, z * 1.4 + off.z, 5);
      cache.set(k, n);
    }
    return n;
  };
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    values[i] = noiseAt(v.x, v.y, v.z);
  }
  // Sea level threshold = quantile so landAmount is the actual land fraction.
  const sorted = Array.from(new Set(cache.values())).sort((a, b) => a - b);
  const thr = sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - land) * sorted.length)))] ?? 0;
  const maxN = sorted[sorted.length - 1] ?? 1;
  const minN = sorted[0] ?? -1;
  const relief = radius * 0.09;

  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  const shallow = ocean.clone().lerp(new THREE.Color("#7fdbda"), 0.45);
  const deep = ocean.clone().multiplyScalar(0.72);
  const beach = grass.clone().lerp(new THREE.Color("#f2d49b"), 0.7);
  const forest = grass.clone().multiplyScalar(0.72);
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = values[i]!;
    const h = n > thr ? (n - thr) / Math.max(1e-4, maxN - thr) : 0;
    v.multiplyScalar(radius + h * relief);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  for (let f = 0; f < count; f += 3) {
    let nAvg = 0;
    let lat = 0;
    for (let k = 0; k < 3; k++) {
      nAvg += values[f + k]!;
      lat += Math.abs(pos.getY(f + k)) / radius;
    }
    nAvg /= 3;
    lat /= 3;
    const polar = smoothstep(0.78, 0.9, lat + (nAvg - thr) * 0.25);
    if (nAvg <= thr) {
      const d = (thr - nAvg) / Math.max(1e-4, thr - minN);
      c.copy(shallow).lerp(ocean, smoothstep(0, 0.25, d)).lerp(deep, smoothstep(0.35, 1, d));
      if (polar > 0.5) c.copy(ice).multiplyScalar(0.93);
    } else {
      const h = (nAvg - thr) / Math.max(1e-4, maxN - thr);
      if (h < 0.06) c.copy(beach);
      else if (h < 0.45) c.copy(grass).lerp(forest, smoothstep(0.15, 0.45, h));
      else if (h < 0.75) c.copy(mountain).lerp(forest, 0.15);
      else c.copy(ice);
      if (polar > 0.5) c.copy(ice);
    }
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute("uv");
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  if (geo !== ico) ico.dispose();

  const group = new THREE.Group();
  group.name = "planet";
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 }));
  body.name = "planet-body";
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  if (p.bool("rings")) {
    const ringColor = p.color("ringColor");
    const inner = radius * 1.45, outer = radius * 2.3;
    const rg = new THREE.RingGeometry(inner, outer, 96, 6);
    const rp = rg.getAttribute("position") as THREE.BufferAttribute;
    const rc = new Float32Array(rp.count * 4);
    for (let i = 0; i < rp.count; i++) {
      const r = Math.hypot(rp.getX(i), rp.getY(i));
      const t = (r - inner) / (outer - inner);
      const band = 0.55 + 0.45 * Math.sin(t * 40) * Math.sin(t * 13 + 1);
      const cc = ringColor.clone().multiplyScalar(0.75 + band * 0.35);
      rc.set([cc.r, cc.g, cc.b, smoothstep(0, 0.08, t) * smoothstep(1, 0.85, t) * (0.45 + band * 0.45)], i * 4);
    }
    rg.setAttribute("color", new THREE.BufferAttribute(rc, 4));
    rg.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, roughness: 0.9, depthWrite: false }));
    ring.name = "planet-rings";
    ring.rotation.set(0.42, 0, 0.18);
    ring.receiveShadow = true;
    group.add(ring);
  }

  if (p.bool("atmosphere")) {
    const atmo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius * 1.14, 5),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: p.color("atmosphereColor") } },
        vertexShader: /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
        fragmentShader: /* glsl */ `
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
void main() {
  float d = dot(normalize(vN), normalize(vV));
  // Front faces: glow peaks near the planet limb and fades to 0 at the shell
  // silhouette (no hard edge); back faces: soft halo outside the limb.
  float a = gl_FrontFacing
    ? smoothstep(0.0, 0.45, d) * pow(1.0 - d, 3.2) * 1.1
    : pow(clamp(-d, 0.0, 1.0), 1.6) * 1.4;
  gl_FragColor = vec4(uColor * 1.2, a);
  #include <colorspace_fragment>
}`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    atmo.name = "planet-atmosphere";
    group.add(atmo);
  }
  return built(group);
};
