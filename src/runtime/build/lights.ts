// Scene lights (ambient, directional, point, spot, hemisphere, rect) + shadow
// tuning, rect-light panels, volumetric spot cones, shadow-camera fitting.

import * as THREE from "three";
import type { LightDef, SceneDoc, ShadowSettings } from "../../core/types";
import { DEG, num, toColor } from "../util";

let rectLibReady: Promise<void> | null = null;
function initRectLib(): Promise<void> {
  rectLibReady ??= import("three/addons/lights/RectAreaLightUniformsLib.js").then((m) => m.RectAreaLightUniformsLib.init());
  return rectLibReady;
}

export const LIGHT_DEFAULT_INTENSITY: Record<LightDef["type"], number> = {
  ambient: 0.4,
  directional: 2.5,
  point: 15,
  spot: 40,
  hemisphere: 0.8,
  rect: 6,
};

export const SHADOW_DEFAULTS = { softness: 4, mapSize: 2048, pointMapSize: 1024 } as const;

// Does the scene need the renderer's shadow map, and which type? (player.ts)
export function shadowMapSettings(scene: SceneDoc): { enabled: boolean; type: THREE.ShadowMapType } {
  const env = scene.environment;
  const bg = env?.background as { sky?: { physical?: boolean; preset?: string; sun?: false | { light?: boolean; castShadow?: boolean } } } | undefined;
  const sky = bg && typeof bg === "object" ? bg.sky : undefined;
  const physicalSun = !!sky && (sky.physical || sky.preset) && sky.sun !== false && sky.sun?.light !== false && sky.sun?.castShadow !== false;
  const rig = env?.rig;
  const rigShadow = !!rig && (typeof rig === "string" || rig.castShadow !== false);
  const any = (scene.lights ?? []).some((l) => l.castShadow) || !!physicalSun || rigShadow;
  return { enabled: scene.target?.shadows !== false && any, type: env?.shadows?.type === "vsm" ? THREE.VSMShadowMap : THREE.PCFShadowMap };
}

export function configureShadow(light: THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight, def: LightDef, global?: ShadowSettings): void {
  light.castShadow = true;
  const s = light.shadow;
  const own = def.shadow ?? {};
  const isPoint = light instanceof THREE.PointLight;
  const size = num(own.mapSize, num(global?.mapSize, isPoint ? SHADOW_DEFAULTS.pointMapSize : SHADOW_DEFAULTS.mapSize));
  const pow2 = 2 ** Math.round(Math.log2(Math.max(256, Math.min(4096, size))));
  s.mapSize.set(pow2, pow2);
  s.bias = num(own.bias, -0.0004);
  s.normalBias = num(own.normalBias, 0.02);
  s.radius = Math.max(0, num(own.softness, num(global?.softness, SHADOW_DEFAULTS.softness)));
  if (global?.type === "vsm") (s as THREE.LightShadow & { blurSamples: number }).blurSamples = 16;
  const intensity = own.intensity ?? global?.intensity;
  if (intensity !== undefined) s.intensity = intensity;
  light.userData.fixedNormalBias = own.normalBias !== undefined;
}

// ─── Rect-light panel ───────────────────────────────────────────────────

function rectPanel(light: THREE.RectAreaLight): THREE.Mesh {
  // Bright but not blown out: ACES keeps saturated hues only up to ~1.6×.
  const gain = () => Math.max(1, Math.min(1.6, light.intensity / 6));
  const glow = light.color.clone().multiplyScalar(gain());
  const mat = new THREE.MeshBasicMaterial({ color: glow, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.scale.set(light.width, light.height, 1);
  mesh.name = "__rectPanel";
  mesh.userData.helper = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.onBeforeRender = () => {
    mesh.scale.set(light.width, light.height, 1);
    mat.color.copy(light.color).multiplyScalar(gain());
  };
  return mesh;
}

// ─── Volumetric spot cone ───────────────────────────────────────────────

const CONE_VERT = /* glsl */ `
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
varying float vWorldY;
varying float vViewZ;
#include <common>
#include <fog_pars_vertex>
void main() {
  vAlong = position.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vWorldY = (modelMatrix * vec4(position, 1.0)).y;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex>
}`;

// Soft intersections: with the post-effect depth pre-pass (uUseDepth) the
// cone fades as it nears ANY surface behind it (soft particles); without it,
// it fades towards the scene ground plane (uUseGround) — no hard ellipse where
// the beam meets the floor. Camera-facing fresnel softens the silhouette.
const CONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform sampler2D uDepth;
uniform float uUseDepth;
uniform vec2 uViewport;
uniform float uNear;
uniform float uFar;
uniform float uOrtho;
uniform float uGroundY;
uniform float uUseGround;
uniform float uSoft;
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
varying float vWorldY;
varying float vViewZ;
#include <common>
#include <fog_pars_fragment>
float a3dSceneViewZ(float d) {
  if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
  return uNear * uFar / max(uFar - d * (uFar - uNear), 1e-6);
}
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float edge = pow(facing, 2.2);
  float fall = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.06, vAlong);
  float soft = 1.0;
  if (uUseDepth > 0.5) {
    float sceneZ = a3dSceneViewZ(texture2D(uDepth, gl_FragCoord.xy / uViewport).x);
    soft *= smoothstep(0.0, uSoft, sceneZ - vViewZ);
  }
  if (uUseGround > 0.5) soft *= smoothstep(0.0, uSoft, vWorldY - uGroundY);
  float a = edge * fall * soft * uIntensity * 0.22;
  // Pure added light: alpha 0 (premultiplied additive) so the cone never
  // writes coverage — in the post-effect pipeline that hid the background
  // behind the cone (dark rims along its silhouette).
  gl_FragColor = vec4(uColor * a, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    float fogF = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb *= 1.0 - fogF;
  #endif
}`;

/**
 * Scene-wide depth of the current frame, published by the post-effect
 * pipeline (its normal / depth pre-pass, which never contains the cones) on
 * `scene.userData.a3dDepth` before the scene renders. Absent without postfx.
 */
export interface SceneDepthInfo {
  texture: THREE.Texture;
  width: number;
  height: number;
}

function volumetricCone(light: THREE.SpotLight, def: LightDef): THREE.Mesh {
  const opts = typeof def.volumetric === "object" ? def.volumetric : {};
  // Unit cone: tip at the origin, base (radius 1) at z = 1, open ended.
  const geo = new THREE.CylinderGeometry(1, 0.0, 1, 48, 24, true);
  geo.translate(0, 0.5, 0);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uColor: { value: toColor(opts.color ?? def.color ?? "#ffffff") },
      uIntensity: { value: num(opts.intensity, 1) },
      uDepth: { value: null },
      uUseDepth: { value: 0 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uOrtho: { value: 0 },
      uGroundY: { value: 0 },
      uUseGround: { value: 0 },
      uSoft: { value: 0.5 },
    },
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  const cone = new THREE.Mesh(geo, mat);
  cone.name = "__volumetric";
  cone.userData.helper = true;
  cone.castShadow = false;
  cone.receiveShadow = false;
  cone.frustumCulled = false;
  const fixedLen = typeof def.volumetric === "object" ? def.volumetric.length : undefined;
  const base = new THREE.Vector3(), tgt = new THREE.Vector3();
  const baseIntensity = num(opts.intensity, 1);
  const lightIntensity0 = Math.max(light.intensity, 1e-3);
  let ground: THREE.Object3D | null | undefined;
  const groundPos = new THREE.Vector3();
  cone.onBeforeRender = (renderer, scene, camera) => {
    light.getWorldPosition(base);
    light.target.getWorldPosition(tgt);
    const len = fixedLen ?? Math.max(0.5, base.distanceTo(tgt) * 1.25);
    const u = mat.uniforms;
    // Soft fade distance: a fraction of the beam length.
    u.uSoft!.value = Math.max(0.05, len * 0.12);
    const depth = scene.userData.a3dDepth as SceneDepthInfo | undefined;
    const cam = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    if (depth && renderer.getRenderTarget()) {
      u.uDepth!.value = depth.texture;
      u.uUseDepth!.value = 1;
      u.uViewport!.value.set(depth.width, depth.height);
      u.uNear!.value = cam.near;
      u.uFar!.value = cam.far;
      u.uOrtho!.value = (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    } else {
      u.uDepth!.value = null;
      u.uUseDepth!.value = 0;
    }
    // Ground plane fallback (also kept with depth: the plane is exact).
    if (ground === undefined || (ground && !ground.parent)) {
      ground = null;
      scene.traverse((o) => {
        if (!ground && o.userData.ground) ground = o;
      });
    }
    if (ground && ground.visible) {
      ground.getWorldPosition(groundPos);
      u.uGroundY!.value = groundPos.y;
      u.uUseGround!.value = 1;
    } else {
      // No scene ground: a beam aimed down fades near its target's height
      // (usually a floor object).
      u.uGroundY!.value = tgt.y;
      u.uUseGround!.value = !fixedLen && tgt.y < base.y - 0.1 ? 1 : 0;
    }
    const r = Math.tan(Math.min(light.angle, 1.5)) * len;
    // Orient in world space, then express in the light's local space.
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tgt.clone().sub(base).normalize());
    const parentQ = light.getWorldQuaternion(new THREE.Quaternion()).invert();
    cone.quaternion.copy(parentQ.multiply(q));
    cone.scale.set(r, r, len);
    cone.position.set(0, 0, 0);
    cone.updateMatrixWorld(true);
    mat.uniforms.uColor!.value.copy(opts.color ? toColor(opts.color) : light.color);
    mat.uniforms.uIntensity!.value = baseIntensity * Math.min(3, light.intensity / lightIntensity0);
  };
  return cone;
}

export async function buildLight(def: LightDef, shadows?: ShadowSettings): Promise<THREE.Light> {
  const color = toColor(def.color ?? "#ffffff");
  const intensity = num(def.intensity, LIGHT_DEFAULT_INTENSITY[def.type] ?? 1);
  let light: THREE.Light;
  switch (def.type) {
    case "ambient":
      light = new THREE.AmbientLight(color, intensity);
      break;
    case "hemisphere":
      light = new THREE.HemisphereLight(toColor(def.skyColor ?? def.color ?? "#ffffff"), toColor(def.groundColor ?? "#444444"), intensity);
      light.position.set(0, 10, 0);
      break;
    case "point": {
      const l = new THREE.PointLight(color, intensity, num(def.distance, 0), num(def.decay, 2));
      light = l;
      break;
    }
    case "spot": {
      const l = new THREE.SpotLight(color, intensity, num(def.distance, 0), num(def.angle, 30) * DEG, num(def.penumbra, 0.3), num(def.decay, 2));
      light = l;
      break;
    }
    case "rect": {
      await initRectLib();
      const l = new THREE.RectAreaLight(color, intensity, num(def.width, 2), num(def.height, 2));
      light = l;
      break;
    }
    default: {
      const l = new THREE.DirectionalLight(color, intensity);
      light = l;
    }
  }
  const pos = def.position ?? (def.type === "directional" ? [5, 10, 7] : def.type === "spot" ? [3, 6, 4] : [0, 3, 3]);
  if (def.type !== "ambient" && def.type !== "hemisphere") light.position.set(pos[0], pos[1], pos[2]);
  const target = def.target ?? [0, 0, 0];
  if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
    light.target.position.set(target[0], target[1], target[2]);
  } else if (light instanceof THREE.RectAreaLight) {
    light.lookAt(target[0], target[1], target[2]);
    if (def.panel) light.add(rectPanel(light));
  }
  if (def.castShadow && (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight || light instanceof THREE.PointLight)) {
    configureShadow(light, def, shadows);
  }
  if (def.volumetric && light instanceof THREE.SpotLight) light.add(volumetricCone(light, def));
  light.name = def.id ?? def.type;
  light.userData.baseIntensity = intensity;
  light.userData.baseColor = color.clone();
  return light;
}

// Fit directional shadow cameras to the bounds of the shadow-relevant scene content.
export function fitShadowCamera(light: THREE.DirectionalLight, bounds: THREE.Box3): void {
  if (bounds.isEmpty()) return;
  const cam = light.shadow.camera as THREE.OrthographicCamera;
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  const lightPos = new THREE.Vector3().setFromMatrixPosition(light.matrixWorld);
  const targetPos = new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld);
  const view = new THREE.Matrix4().lookAt(lightPos, targetPos, new THREE.Vector3(0, 1, 0));
  view.setPosition(lightPos);
  const inv = view.clone().invert();
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).applyMatrix4(inv);
    box.expandByPoint(p);
  }
  const pad = 0.5;
  cam.left = box.min.x - pad;
  cam.right = box.max.x + pad;
  cam.bottom = box.min.y - pad;
  cam.top = box.max.y + pad;
  cam.near = Math.max(0.01, -box.max.z - pad);
  cam.far = -box.min.z + pad;
  cam.updateProjectionMatrix();
  const texel = Math.max(cam.right - cam.left, cam.top - cam.bottom) / light.shadow.mapSize.x;
  if (!light.userData.fixedNormalBias) light.shadow.normalBias = Math.max(0.01, texel * 1.5);
}
