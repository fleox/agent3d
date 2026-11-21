// Scene lights (ambient, directional, point, spot, hemisphere, rect) + shadow tuning.

import * as THREE from "three";
import type { LightDef } from "../../core/types";
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

export async function buildLight(def: LightDef): Promise<THREE.Light> {
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
  }
  if (def.castShadow && (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight || light instanceof THREE.PointLight)) {
    light.castShadow = true;
    const s = light.shadow;
    s.mapSize.set(2048, 2048);
    s.bias = -0.0004;
    s.normalBias = 0.02;
    s.radius = 4;
    if (light instanceof THREE.PointLight) s.mapSize.set(1024, 1024);
  }
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
  light.shadow.normalBias = Math.max(0.01, texel * 1.5);
}
