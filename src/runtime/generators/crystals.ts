// Glowing gem clusters: faceted hexagonal prisms with pointed tips growing
// from a rocky base (cluster), around a ring, or scattered. Vertex colours
// run from a deep base to a bright tip; an emissive inner glow pulses
// (deterministic) and a fresnel rim makes them read as translucent gems —
// add the bloom post effect for the full glow.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { MeshBuilder, built, jitter, ramp, shade } from "./geom";

// One crystal: hexagonal prism (slightly tapered) + pyramid tip, along +Y, base at 0.
function crystalGeometry(height: number, radius: number, sides: number, tipFrac: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const white = new THREE.Color(1, 1, 1);
  const body = height * (1 - tipFrac);
  const top = radius * 0.86;
  const ring = (r: number, y: number) => Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r] as [number, number, number];
  });
  const r0 = ring(radius, 0);
  const r1 = ring(top, body);
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    b.quad(r0[k1]!, r0[k]!, r1[k]!, r1[k1]!, white);
    b.tri(r1[k1]!, r1[k]!, [0, height, 0], white);
  }
  return b.build();
}

export const crystals: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("crystals", raw, ctx);
  const count = p.int("count");
  const size = p.num("size");
  const colors = p.colors("colors");
  const layout = p.str<"cluster" | "ring" | "scatter">("layout");
  const spread = p.num("spread");
  const glow = p.num("glow");
  const rng = ctx.rng;

  const b = new MeshBuilder();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Color();
  const variants = Array.from({ length: 4 }, (_, k) => crystalGeometry(1, 0.22 + k * 0.03, k % 2 ? 6 : 5, 0.26 + k * 0.04));
  for (let i = 0; i < count; i++) {
    const big = i === 0 && layout === "cluster";
    let pos = new THREE.Vector3();
    let dir = new THREE.Vector3(0, 1, 0);
    if (layout === "cluster") {
      const a = rng.next() * Math.PI * 2;
      const rr = big ? 0 : spread * Math.sqrt(rng.next()) * 0.5;
      pos.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      dir.set(Math.cos(a) * (0.3 + (rr / spread) * 1.6), 1, Math.sin(a) * (0.3 + (rr / spread) * 1.6)).normalize();
      if (big) dir.set(0, 1, 0);
    } else if (layout === "ring") {
      const a = (i / count) * Math.PI * 2 + rng.range(-0.1, 0.1);
      pos.set(Math.cos(a) * spread, 0, Math.sin(a) * spread);
      dir.set(rng.range(-0.25, 0.25), 1, rng.range(-0.25, 0.25)).normalize();
    } else {
      pos = new THREE.Vector3((rng.next() - 0.5) * spread * 2, 0, (rng.next() - 0.5) * spread * 2);
      dir.set(rng.range(-0.3, 0.3), 1, rng.range(-0.3, 0.3)).normalize();
    }
    const h = size * (big ? 1.3 : rng.range(0.4, 1.0)) * (layout === "cluster" ? 1 - (pos.length() / spread) * 0.6 : 1);
    const w = h * rng.range(0.42, 0.58) * (big ? 0.85 : 1);
    q.setFromUnitVectors(up, dir);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rng.next() * Math.PI));
    m.compose(pos.clone().addScaledVector(dir, -h * 0.08), q, new THREE.Vector3(w, h, w));
    const c0 = rng.pick(colors);
    const c1 = colors.length > 1 ? colors[(colors.indexOf(c0) + 1) % colors.length]! : c0;
    const g = rng.pick(variants);
    b.add(g, m, (_x, y, _z, f) => {
      // Base → tip gradient, per-facet brightness for a cut-gem look.
      tmp.copy(c0).lerp(c1, Math.min(1, y * 0.9)).multiplyScalar(0.55 + y * 0.45);
      return shade(tmp, 0.85 + ((f * 37) % 7) / 7 * 0.35);
    });
  }
  for (const v of variants) v.dispose();
  const geometry = b.build();
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.35,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: glow,
    transparent: p.num("opacity") < 1,
    opacity: p.num("opacity"),
  });
  const uniforms = { uTime: { value: 0 }, uPulse: { value: p.num("pulse") } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uPulse;")
      // Emissive = vertex colour (gem glow), modulated by a slow pulse and a fresnel rim.
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  vec3 fn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  float fres = pow(1.0 - abs(dot(fn, normalize(vViewPosition))), 2.0);
  float pulse = 1.0 + uPulse * 0.35 * sin(uTime * 1.7 + vViewPosition.y * 2.0);
  totalEmissiveRadiance *= diffuseColor.rgb * diffuseColor.rgb * 1.8 * (0.3 + fres * 0.9) * pulse;
}`,
      );
  };
  material.customProgramCacheKey = () => "agent3d-crystals";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "crystals";
  mesh.castShadow = true;
  mesh.userData.materialTarget = true;
  const group = new THREE.Group();
  group.name = "crystals";
  group.add(mesh);

  if (p.bool("base") && layout === "cluster") {
    const rb = new MeshBuilder();
    const rock = p.color("baseColor");
    for (let k = 0; k < 7; k++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      jitter(g, 0.35, rng.next);
      const a = (k / 7) * Math.PI * 2;
      const rr = k === 0 ? 0 : spread * 0.4;
      const s = size * (k === 0 ? 0.42 : rng.range(0.18, 0.3));
      rb.add(g, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * rr, -s * 0.45, Math.sin(a) * rr), new THREE.Quaternion(), new THREE.Vector3(s * 1.3, s * 0.6, s * 1.3)), (_x, y, _z, f) => shade(ramp([rock, rock.clone().multiplyScalar(1.3)], y * 0.5 + 0.5), 0.85 + (f % 5) * 0.05));
      g.dispose();
    }
    const base = new THREE.Mesh(rb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    base.name = "crystals-base";
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
  }
  return built(group, {
    update: (t) => {
      uniforms.uTime.value = t;
    },
  });
};
