// Physical (Preetham) sky: three/addons Sky shader + exposure, horizon haze
// matched to the fog colour, stars, and the sun as elevation / azimuth. The
// same sun drives a directional light (colour / intensity follow the
// elevation) and the sky is PMREM'd into the environment lighting.

import * as THREE from "three";
import type { SkyParams, SkyPreset, Vec3 } from "../../core/types";
import { num, toColor } from "../util";

export interface SkyPresetValues {
  elevation: number;
  azimuth: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  exposure: number;
  // Horizon haze (default fog colour) — matches what the sky renders near the horizon.
  haze: string;
}

// Tuned for ACES / AgX at `exposure: 1` (a multiplier of these values): the
// Preetham radiance grows with the sun's elevation, so bright presets get a low
// exposure and every preset enough Rayleigh scattering for a deep sky colour.
export const SKY_PRESETS: Record<SkyPreset, SkyPresetValues> = {
  sunrise: { elevation: 2.5, azimuth: 70, turbidity: 5, rayleigh: 2.4, mieCoefficient: 0.004, mieDirectionalG: 0.9, exposure: 0.7, haze: "#f1c1a0" },
  morning: { elevation: 18, azimuth: 110, turbidity: 2.6, rayleigh: 2.4, mieCoefficient: 0.003, mieDirectionalG: 0.8, exposure: 0.2, haze: "#b9cde4" },
  noon: { elevation: 62, azimuth: 150, turbidity: 2, rayleigh: 2.6, mieCoefficient: 0.003, mieDirectionalG: 0.8, exposure: 0.11, haze: "#a9c3e3" },
  afternoon: { elevation: 32, azimuth: 220, turbidity: 2.4, rayleigh: 2.6, mieCoefficient: 0.003, mieDirectionalG: 0.8, exposure: 0.15, haze: "#b4c8de" },
  "golden-hour": { elevation: 6, azimuth: 235, turbidity: 5, rayleigh: 3.6, mieCoefficient: 0.004, mieDirectionalG: 0.8, exposure: 0.36, haze: "#f4c08c" },
  sunset: { elevation: 1.5, azimuth: 250, turbidity: 8, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.94, exposure: 0.8, haze: "#e9a07e" },
  dusk: { elevation: -3, azimuth: 255, turbidity: 6, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.85, exposure: 6, haze: "#5a5f86" },
};

export function isPhysicalSky(p: SkyParams | undefined): boolean {
  return !!p && (p.physical === true || p.preset !== undefined || p.turbidity !== undefined || p.rayleigh !== undefined);
}

export function resolveSky(p: SkyParams): SkyPresetValues {
  const base = SKY_PRESETS[p.preset ?? "afternoon"] ?? SKY_PRESETS.afternoon;
  const sun = p.sun === false ? undefined : p.sun;
  let elevation = num(sun?.elevation, base.elevation);
  let azimuth = num(sun?.azimuth, base.azimuth);
  if (sun?.direction && sun.elevation === undefined && sun.azimuth === undefined) {
    const [x, y, z] = sun.direction;
    const l = Math.hypot(x, y, z) || 1;
    elevation = (Math.asin(y / l) * 180) / Math.PI;
    azimuth = (Math.atan2(x, z) * 180) / Math.PI;
  }
  return {
    elevation,
    azimuth,
    turbidity: num(p.turbidity, base.turbidity),
    rayleigh: num(p.rayleigh, base.rayleigh),
    mieCoefficient: num(p.mieCoefficient, base.mieCoefficient),
    mieDirectionalG: num(p.mieDirectionalG, base.mieDirectionalG),
    exposure: num(p.exposure, 1) * base.exposure,
    haze: base.haze,
  };
}

// Unit vector towards the sun. azimuth 0 = +Z (towards the default camera), 90 = +X.
export function sunDirection(elevation: number, azimuth: number): Vec3 {
  const e = (elevation * Math.PI) / 180, a = (azimuth * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}

// Sun light colour / intensity from the elevation (warm and dim near the horizon).
const SUN_RAMP: [number, string, number][] = [
  [-4, "#ff6a3a", 0],
  [0, "#ff8a4c", 0.6],
  [3, "#ff9a52", 1.5],
  [8, "#ffb46a", 2.4],
  [16, "#ffdcb4", 2.8],
  [30, "#fff0dc", 3.1],
  [60, "#fff8ee", 3.3],
];
export function sunLight(elevation: number): { color: THREE.Color; intensity: number } {
  const r = SUN_RAMP;
  if (elevation <= r[0]![0]) return { color: toColor(r[0]![1]), intensity: 0 };
  for (let i = 1; i < r.length; i++) {
    const [e1, c1, i1] = r[i]!;
    const [e0, c0, i0] = r[i - 1]!;
    if (elevation <= e1) {
      const t = (elevation - e0) / (e1 - e0);
      return { color: toColor(c0).lerp(toColor(c1), t), intensity: i0 + (i1 - i0) * t };
    }
  }
  const last = r[r.length - 1]!;
  return { color: toColor(last[1]), intensity: last[2] };
}

interface SkyShaderDef {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}
let skyShader: Promise<SkyShaderDef> | null = null;
function loadSkyShader(): Promise<SkyShaderDef> {
  skyShader ??= import("three/addons/objects/Sky.js").then((m) => (m.Sky as unknown as { SkyShader: SkyShaderDef }).SkyShader);
  return skyShader;
}

const STARS_GLSL = /* glsl */ `
uniform float uStars;
uniform float uTime;
uniform float uExposure;
uniform vec3 uHaze;
uniform float uHazeAmount;
float a3dHash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
`;

export interface PhysicalSky {
  mesh: THREE.Mesh;
  values: SkyPresetValues;
  sunDir: THREE.Vector3;
  // Same sky without the sun disc / stars, for PMREM.
  envScene(): THREE.Scene;
  setTime(t: number): void;
  setHaze(color: THREE.Color | null, amount: number): void;
}

export async function createPhysicalSky(p: SkyParams): Promise<PhysicalSky> {
  const shader = await loadSkyShader();
  const v = resolveSky(p);
  const dir = new THREE.Vector3(...sunDirection(v.elevation, v.azimuth));
  const frag = shader.fragmentShader
    .replace("uniform float mieDirectionalG;", "uniform float mieDirectionalG;\n" + STARS_GLSL)
    // Tame the sun disc: three's Preetham disc is ~10⁴× the sky, so a low sun
    // in frame drove bloom / god rays / exposure into a washed-out frame. Soft
    // compression keeps a bright, crisp disc (≤ ~12 before exposure).
    .replace(
      "vec3 sundiscColor = ( 760.0 * sundisc ) * min( vSunE * Fex, 80.0 );",
      "vec3 sundiscColor = ( 760.0 * sundisc ) * min( vSunE * Fex, 80.0 );\n\t\t\tsundiscColor = sundiscColor / ( 1.0 + dot( sundiscColor, vec3( 0.2126, 0.7152, 0.0722 ) ) / 12.0 );",
    )
    .replace(
      "gl_FragColor = vec4( texColor, 1.0 );",
      `texColor *= uExposure;
			// Below the horizon: darken towards a hazy ground tone.
			texColor = mix( texColor, texColor * 0.55, smoothstep( 0.0, -0.25, direction.y ) );
			// Stars when the sun is down.
			if ( uStars > 0.0 && direction.y > 0.0 ) {
				vec3 sp = direction * 120.0;
				vec3 cell = floor( sp );
				float rnd = a3dHash13( cell );
				if ( rnd < uStars ) {
					vec3 jitter = vec3( a3dHash13( cell + 1.3 ), a3dHash13( cell + 7.1 ), a3dHash13( cell + 3.7 ) );
					float d = length( fract( sp ) - jitter );
					float tw = 0.65 + 0.35 * sin( uTime * ( 1.0 + rnd * 40.0 ) + rnd * 100.0 );
					float night = 1.0 - smoothstep( -0.12, 0.05, vSunDirection.y );
					texColor += vec3( smoothstep( 0.12, 0.0, d ) * tw * night * smoothstep( 0.0, 0.25, direction.y ) ) * 0.8;
				}
			}
			// Horizon haze blends into the fog colour so fogged ground meets the sky.
			if ( uHazeAmount > 0.0 ) texColor = mix( texColor, uHaze, uHazeAmount * ( 1.0 - smoothstep( -0.02, 0.22, direction.y ) ) );
			gl_FragColor = vec4( texColor, 1.0 );`,
    );
  const makeMat = (disc: boolean) => {
    const uniforms = THREE.UniformsUtils.clone(shader.uniforms);
    uniforms.turbidity!.value = v.turbidity;
    uniforms.rayleigh!.value = v.rayleigh;
    uniforms.mieCoefficient!.value = v.mieCoefficient;
    uniforms.mieDirectionalG!.value = v.mieDirectionalG;
    (uniforms.sunPosition!.value as THREE.Vector3).copy(dir).multiplyScalar(450000);
    uniforms.showSunDisc!.value = disc ? 1 : 0;
    uniforms.cloudCoverage!.value = Math.max(0, Math.min(1, num(p.clouds, 0)));
    uniforms.uStars = { value: disc ? Math.min(0.5, num(p.stars, 0) / 20000) : 0 };
    uniforms.uTime = { value: 0 };
    uniforms.uExposure = { value: v.exposure };
    uniforms.uHaze = { value: new THREE.Color(0, 0, 0) };
    uniforms.uHazeAmount = { value: 0 };
    return new THREE.ShaderMaterial({ name: "agent3d-sky", uniforms, vertexShader: shader.vertexShader, fragmentShader: frag, side: THREE.BackSide, depthWrite: false });
  };
  const mat = makeMat(true);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(450);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = "__sky";
  mesh.userData.helper = true;
  // Read by post effects (godrays source): direction towards the sun + its colour.
  mesh.userData.sunDir = dir.clone();
  mesh.userData.sunColor = sunLight(v.elevation).color;
  mesh.userData.sunUp = v.elevation > -3;
  // Follow the camera so the dome never clips.
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.position.setFromMatrixPosition(camera.matrixWorld);
    mesh.updateMatrixWorld();
  };
  return {
    mesh,
    values: v,
    sunDir: dir,
    envScene() {
      const s = new THREE.Scene();
      const m = makeMat(false);
      m.uniforms.uHaze!.value.copy(mat.uniforms.uHaze!.value);
      m.uniforms.uHazeAmount!.value = mat.uniforms.uHazeAmount!.value;
      const e = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), m);
      e.scale.setScalar(50);
      s.add(e);
      return s;
    },
    setTime(t) {
      mat.uniforms.uTime!.value = t;
      mat.uniforms.time!.value = t;
    },
    setHaze(color, amount) {
      if (color) mat.uniforms.uHaze!.value.copy(color);
      mat.uniforms.uHazeAmount!.value = color ? amount : 0;
    },
  };
}
