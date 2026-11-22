// Environment: background (colour, transparent, gradients, mesh gradient, sky
// dome — gradient or physical with a sun light —, HDRI with blur / rotation /
// ground projection), image-based lighting (presets, HDRI, from the sky),
// fog (linear, exponential, height), ground, contact shadows and light rigs.

import * as THREE from "three";
import type { EnvironmentDef, SkyParams } from "../../core/types";
import { loadTexture } from "../assets";
import { GLSL_NOISE } from "../shaders/noise.glsl";
import { MESH_GRADIENT_GLSL } from "../shaders/meshGradient.glsl";
import { DEG, num, toColor, vec3 } from "../util";
import type { RuntimeContext } from "./context";
import { createContactShadows } from "./contactShadows";
import { installHeightFog, type HeightFogUniforms } from "./heightFog";
import { buildLight, configureShadow } from "./lights";
import { expandRig } from "./rigs";
import { createPhysicalSky, isPhysicalSky, sunLight, type PhysicalSky } from "./sky";

export interface BuiltEnvironment {
  objects: THREE.Object3D[]; // sky dome, ground, grid, rig / sun lights (added to the scene root)
  ground?: THREE.Object3D;
  dispose(): void;
}

// ─── Canvas gradients ───────────────────────────────────────────────────

function canvasGradient(cols: string[], kind: "linear" | "radial", angle = 0, opts: { center?: [number, number]; radius?: number; grain?: number } = {}): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const s = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d");
  if (!g) return null;
  let grad: CanvasGradient;
  if (kind === "radial") {
    const cx = (opts.center?.[0] ?? 0.5) * s, cy = (1 - (opts.center?.[1] ?? 0.5)) * s;
    grad = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.72 * (opts.radius ?? 1));
  } else {
    // CSS-like: 0deg = bottom → top, 90deg = left → right.
    const a = (angle * Math.PI) / 180;
    const dx = Math.sin(a), dy = -Math.cos(a);
    const half = s / 2;
    grad = g.createLinearGradient(half - dx * half, half - dy * half, half + dx * half, half + dy * half);
  }
  const list = cols.length ? cols : ["#000000"];
  list.forEach((c, i) => grad.addColorStop(list.length === 1 ? 0 : i / (list.length - 1), c));
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  // Dithering against banding (+ optional visible film grain).
  const amp = 2 + Math.max(0, Math.min(1, opts.grain ?? 0)) * 70;
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5;
    img.data[i] += n * amp;
    img.data[i + 1] += n * amp;
    img.data[i + 2] += n * amp;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─── Mesh-gradient background (full-screen quad behind everything) ──────

function meshGradientBackground(cols: string[], o: { speed?: number; scale?: number; seed?: number; grain?: number }, ctx: RuntimeContext): THREE.Mesh {
  const list = cols.slice(0, 6).map((c) => toColor(c));
  while (list.length < 6) list.push(list[list.length - 1]?.clone() ?? new THREE.Color(0));
  const uniforms = {
    uMgColors: { value: list },
    uMgCount: { value: Math.max(1, Math.min(6, cols.length)) },
    uMgScale: { value: num(o.scale, 1) },
    uMgSeed: { value: num(o.seed, 1) },
    uTime: { value: 0 },
    uGrain: { value: num(o.grain, 0.035) },
    uAspect: { value: 1 },
    uMgSpread: { value: new THREE.Vector2(1, 1) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }",
    fragmentShader: `uniform float uTime;\nuniform float uGrain;\nuniform float uAspect;\nvarying vec2 vUv;\n${GLSL_NOISE}\n${MESH_GRADIENT_GLSL}
void main() {
  vec2 p = (vUv - 0.5) * vec2(max(uAspect, 1.0), max(1.0 / uAspect, 1.0)) * 1.6;
  vec3 col = meshGradient(p, uTime);
  col += mgGrain(gl_FragCoord.xy, uTime) * uGrain;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = "__background";
  mesh.userData.helper = true;
  const size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    uniforms.uAspect.value = size.x / Math.max(size.y, 1);
    uniforms.uMgSpread.value.set(Math.max(uniforms.uAspect.value, 1) * 1.6, Math.max(1 / uniforms.uAspect.value, 1) * 1.6);
  };
  const speed = num(o.speed, 0.15);
  ctx.onUpdate((t) => (uniforms.uTime.value = t * speed));
  return mesh;
}

// ─── Gradient sky dome ──────────────────────────────────────────────────

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunSize; uniform float uSun;
uniform float uStars; uniform float uTime;
varying vec3 vDir;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.4));
  if (uSun > 0.5) {
    float cosA = dot(d, normalize(uSunDir));
    float r = uSunSize * 0.02;
    float disc = smoothstep(cos(r * 1.2), cos(r * 0.9), cosA);
    float glow = pow(max(cosA, 0.0), 400.0 / max(uSunSize, 0.2)) * 0.8 + pow(max(cosA, 0.0), 24.0) * 0.12;
    col += uSunColor * (disc * 6.0 + glow);
  }
  if (uStars > 0.0 && h > -0.05) {
    vec3 p = d * 120.0;
    vec3 cell = floor(p);
    float rnd = hash13(cell);
    if (rnd < uStars) {
      vec3 jitter = vec3(hash13(cell + 1.3), hash13(cell + 7.1), hash13(cell + 3.7));
      float dist = length(fract(p) - jitter);
      float tw = 0.65 + 0.35 * sin(uTime * (1.0 + rnd * 40.0) + rnd * 100.0);
      float star = smoothstep(0.12, 0.0, dist) * tw * smoothstep(-0.05, 0.25, h);
      col += vec3(star) * (0.6 + rnd / max(uStars, 1e-4) * 0.8);
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSky(p: SkyParams, ctx: RuntimeContext): THREE.Mesh {
  const sun = p.sun === false ? null : p.sun ?? {};
  let dir = vec3(sun?.direction, [0.4, 0.35, -1]);
  if (sun && (sun.elevation !== undefined || sun.azimuth !== undefined) && !sun.direction) {
    const e = num(sun.elevation, 20) * DEG, a = num(sun.azimuth, 180) * DEG;
    dir = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: toColor(p.top ?? "#2f6fd6") },
      uHorizon: { value: toColor(p.horizon ?? "#cfe6ff") },
      uBottom: { value: toColor(p.bottom ?? p.horizon ?? "#e8eef5") },
      uSunDir: { value: new THREE.Vector3(...dir).normalize() },
      uSunColor: { value: toColor(sun?.color ?? "#fff2d6") },
      uSunSize: { value: num(sun?.size, 1) },
      uSun: { value: sun ? 1 : 0 },
      uStars: { value: Math.min(0.5, num(p.stars, 0) / 20000) },
      uTime: { value: 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = "__sky";
  mesh.userData.helper = true;
  ctx.onUpdate((t) => (mat.uniforms.uTime.value = t));
  return mesh;
}

// ─── IBL presets ────────────────────────────────────────────────────────

function gradientEnvScene(top: string, horizon: string, bottom: string, glow?: { dir: THREE.Vector3; color: string; power: number; size: number }, panels = true): THREE.Scene {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 64, 32);
  const pos = geo.getAttribute("position");
  const cols = new Float32Array(pos.count * 3);
  const ct = toColor(top), ch = toColor(horizon), cb = toColor(bottom);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y >= 0) c.copy(ch).lerp(ct, Math.pow(y, 0.6));
    else c.copy(ch).lerp(cb, Math.pow(-y, 0.5));
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false })));
  if (glow) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(glow.size, 32), new THREE.MeshBasicMaterial({ color: toColor(glow.color).multiplyScalar(glow.power), side: THREE.DoubleSide, toneMapped: false }));
    m.position.copy(glow.dir.clone().normalize().multiplyScalar(9));
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  if (panels) {
    // Soft panels so reflections have some structure.
    const panelMat = new THREE.MeshBasicMaterial({ color: toColor(horizon).multiplyScalar(1.6), side: THREE.DoubleSide, toneMapped: false });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.6;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.4), panelMat);
      panel.position.set(Math.cos(a) * 9, 1.5, Math.sin(a) * 9);
      panel.lookAt(0, 1.5, 0);
      scene.add(panel);
    }
  }
  return scene;
}

function disposeScene(s: THREE.Scene): void {
  s.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  });
}

async function loadEquirect(url: string): Promise<THREE.Texture> {
  const lower = url.toLowerCase().split("?")[0];
  let tex: THREE.Texture;
  if (lower.endsWith(".hdr")) {
    const { HDRLoader } = await import("three/addons/loaders/HDRLoader.js");
    tex = await new HDRLoader().loadAsync(url);
  } else if (lower.endsWith(".exr")) {
    const { EXRLoader } = await import("three/addons/loaders/EXRLoader.js");
    tex = await new EXRLoader().loadAsync(url);
  } else {
    tex = await loadTexture(url);
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

// Ground whose edges fade out (no hard horizon line against the background).
function fadingGroundMaterial(color: THREE.Color, roughness: number): THREE.Material {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, transparent: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec2 vGroundUv;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvGroundUv = uv;");
    shader.fragmentShader = "varying vec2 vGroundUv;\n" + shader.fragmentShader.replace(
      "#include <alphamap_fragment>",
      "#include <alphamap_fragment>\n\tdiffuseColor.a *= 1.0 - smoothstep(0.3, 0.5, length(vGroundUv - 0.5));",
    );
  };
  mat.customProgramCacheKey = () => "agent3d-ground";
  return mat;
}

// Shadow catcher (ground.shadowOnly) whose shadows fade out radially toward
// the plane's edges and toward the canvas edges, so a shadow never ends in
// a hard cut in transparent embeds (where the page shows around it).
export const SHADOW_FADE = { radial: [0.25, 0.5], screenEdge: 0.15 } as const;
function fadingShadowMaterial(color: THREE.Color, opacity: number): THREE.Material {
  const mat = new THREE.ShadowMaterial({ opacity, color });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying vec2 vShadowUv;\nvarying vec4 vShadowClip;\n" + shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n\tvShadowUv = uv;\n\tvShadowClip = gl_Position;");
    shader.fragmentShader =
      "varying vec2 vShadowUv;\nvarying vec4 vShadowClip;\n" +
      shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        `{
\t\tvec2 ndc = vShadowClip.xy / max(vShadowClip.w, 1e-5);
\t\tfloat edge = 1.0 - max(abs(ndc.x), abs(ndc.y));
\t\tgl_FragColor.a *= (1.0 - smoothstep(${SHADOW_FADE.radial[0].toFixed(2)}, ${SHADOW_FADE.radial[1].toFixed(2)}, length(vShadowUv - 0.5))) * smoothstep(0.0, ${SHADOW_FADE.screenEdge.toFixed(2)}, edge);
\t}
\t#include <tonemapping_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => "agent3d-shadow-catcher";
  return mat;
}

// Default fog colour: explicit > physical-sky haze > gradient-sky horizon > background colour.
/** IBL strength under a light rig when environment.lightingIntensity is not set. */
export const RIG_IBL_SCALE = 0.45;

export function defaultFogColor(env: EnvironmentDef, skyHaze?: string): string {
  const bg = env.background;
  if (env.fog?.color) return env.fog.color;
  if (skyHaze) return skyHaze;
  if (bg && typeof bg === "object" && "sky" in bg && bg.sky?.horizon) return bg.sky.horizon;
  if (bg && typeof bg === "object" && "meshGradient" in bg && bg.meshGradient[0]) return bg.meshGradient[0];
  return typeof bg === "string" && bg !== "transparent" ? bg : "#ffffff";
}

export async function buildEnvironment(env: EnvironmentDef, scene: THREE.Scene, camera: THREE.Camera, transparent: boolean, ctx: RuntimeContext): Promise<BuiltEnvironment> {
  const objects: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  const renderer = ctx.renderer;
  const bg = env.background;
  const ortho = !!(camera as THREE.OrthographicCamera).isOrthographicCamera;
  let bgHdri: THREE.Texture | null = null;
  let bgRotation = 0;
  let physicalSky: PhysicalSky | null = null;
  let gradientSky: SkyParams | null = null;
  let meshGradient: string[] | null = null;
  scene.background = null;
  scene.backgroundIntensity = 1;
  scene.backgroundRotation.set(0, 0, 0);
  scene.environmentRotation.set(0, 0, 0);

  const bgObj = bg && typeof bg === "object" ? bg : null;
  const skyParams = bgObj && "sky" in bgObj ? bgObj.sky ?? {} : null;
  if (skyParams && isPhysicalSky(skyParams)) {
    try {
      physicalSky = await createPhysicalSky(skyParams);
    } catch (err) {
      ctx.issue("asset-load", (err as Error).message, "environment.background.sky");
    }
  }

  if (!transparent && bg !== undefined && bg !== "transparent") {
    if (typeof bg === "string") scene.background = toColor(bg);
    else if ("gradient" in bg) scene.background = canvasGradient(bg.gradient, "linear", num(bg.angle, 0), { grain: bg.grain });
    else if ("radial" in bg) scene.background = canvasGradient(bg.radial, "radial", 0, { center: bg.center, radius: bg.radius, grain: bg.grain });
    else if ("meshGradient" in bg) {
      meshGradient = bg.meshGradient;
      objects.push(meshGradientBackground(bg.meshGradient, bg, ctx));
    } else if ("sky" in bg) {
      const sky = bg.sky ?? {};
      if (physicalSky) {
        if (!ortho) {
          objects.push(physicalSky.mesh);
          const ps = physicalSky;
          ctx.onUpdate((t) => ps.setTime(t));
        }
      } else {
        gradientSky = sky;
        if (ortho) scene.background = canvasGradient([sky.bottom ?? sky.horizon ?? "#e8eef5", sky.horizon ?? "#cfe6ff", sky.top ?? "#2f6fd6"], "linear", 0);
        else objects.push(createSky(sky, ctx));
      }
    } else if ("hdri" in bg) {
      try {
        bgHdri = await loadEquirect(ctx.resolveAsset(bg.hdri));
        bgRotation = num(bg.rotation, 0) * DEG;
        scene.backgroundRotation.set(0, bgRotation, 0);
        scene.backgroundIntensity = num(bg.intensity, 1);
        disposables.push(bgHdri);
        if (bg.groundProjection && !ortho) {
          const gp = typeof bg.groundProjection === "object" ? bg.groundProjection : {};
          const { GroundedSkybox } = await import("three/addons/objects/GroundedSkybox.js");
          const height = num(gp.height, 2), radius = num(gp.radius, 60);
          const box = new GroundedSkybox(bgHdri, height, radius);
          box.position.y = height - 0.01 + num(env.ground?.y, 0);
          box.rotation.y = bgRotation;
          (box.material as THREE.MeshBasicMaterial).color.setScalar(scene.backgroundIntensity);
          box.name = "__groundProjection";
          box.userData.helper = true;
          box.renderOrder = -999;
          objects.push(box);
          scene.background = toColor("#000000");
        } else {
          scene.background = bgHdri;
          scene.backgroundBlurriness = num(bg.blur, 0);
        }
      } catch (err) {
        ctx.issue("asset-load", (err as Error).message, "environment.background.hdri");
      }
    }
    if (scene.background instanceof THREE.Texture && scene.background !== bgHdri) disposables.push(scene.background);
  }

  // Fog (before the IBL so the sky's horizon haze is baked into reflections too).
  scene.fog = null;
  installHeightFog(scene, null);
  let fogColor: THREE.Color | null = null;
  if (env.fog) {
    fogColor = toColor(defaultFogColor(env, physicalSky?.values.haze));
    // The sky haze as fog colour is an in-scatter colour: slightly dimmed so a
    // thick (height) fog in front of a low sun doesn't wash the frame to white
    // (the sky's horizon blends to the same colour: setHaze below).
    if (!env.fog.color && physicalSky) fogColor.multiplyScalar(0.82);
    if ("density" in env.fog) {
      scene.fog = new THREE.FogExp2(fogColor, env.fog.density);
      if (env.fog.height !== undefined) {
        const uniforms: HeightFogUniforms = { uA3dFogHeight: { value: env.fog.height }, uA3dFogFalloff: { value: num(env.fog.falloff, 0.25) } };
        installHeightFog(scene, uniforms);
      }
    } else scene.fog = new THREE.Fog(fogColor, num(env.fog.near, 10), num(env.fog.far, 60));
    physicalSky?.setHaze(fogColor, 0.85);
  }

  // IBL
  const defaultLighting: NonNullable<EnvironmentDef["lighting"]> = bgHdri ? { hdri: "" } : physicalSky ? "sky" : "soft";
  const lighting = env.lighting ?? defaultLighting;
  scene.environment = null;
  scene.environmentIntensity = num(env.lightingIntensity, 1);
  if (renderer && lighting !== "none") {
    const pmrem = new THREE.PMREMGenerator(renderer);
    let rt: THREE.WebGLRenderTarget | null = null;
    try {
      if (typeof lighting === "object") {
        const tex = lighting.hdri ? await loadEquirect(ctx.resolveAsset(lighting.hdri)) : bgHdri;
        if (tex) rt = pmrem.fromEquirectangular(tex);
        if (lighting.intensity !== undefined) scene.environmentIntensity = lighting.intensity;
        scene.environmentRotation.set(0, lighting.hdri ? num(lighting.rotation, 0) * DEG : lighting.rotation !== undefined ? lighting.rotation * DEG : bgRotation, 0);
        if (tex && tex !== bgHdri) tex.dispose();
      } else if (lighting === "sky") {
        if (physicalSky) {
          const s = physicalSky.envScene();
          rt = pmrem.fromScene(s, 0, 0.1, 100);
          disposeScene(s);
        } else if (gradientSky) {
          const s = gradientSky;
          const sun = s.sun === false ? undefined : s.sun;
          const envScene = gradientEnvScene(s.top ?? "#2f6fd6", s.horizon ?? "#cfe6ff", s.bottom ?? s.horizon ?? "#e8eef5", sun ? { dir: new THREE.Vector3(...vec3(sun.direction, [0.4, 0.35, -1])), color: sun.color ?? "#fff2d6", power: 4, size: 0.9 } : undefined, false);
          rt = pmrem.fromScene(envScene, 0.02);
          disposeScene(envScene);
        } else if (meshGradient) {
          const m = meshGradient;
          const envScene = gradientEnvScene(m[1] ?? m[0]!, m[0]!, m[2] ?? m[0]!, undefined, true);
          rt = pmrem.fromScene(envScene, 0.04);
          disposeScene(envScene);
        } else {
          const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
          const room = new RoomEnvironment();
          rt = pmrem.fromScene(room, 0.06);
          room.dispose?.();
        }
      } else if (lighting === "studio" || lighting === "soft") {
        const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
        const room = new RoomEnvironment();
        rt = pmrem.fromScene(room, lighting === "soft" ? 0.06 : 0.02);
        if (lighting === "soft" && env.lightingIntensity === undefined) scene.environmentIntensity = 0.8;
        room.dispose?.();
      } else {
        const presets: Record<string, Parameters<typeof gradientEnvScene>> = {
          neutral: ["#d8d8dc", "#b9b9bd", "#5a5a60"],
          sunset: ["#33306e", "#ff9a5a", "#3a2531", { dir: new THREE.Vector3(1, 0.15, -0.6), color: "#ffb36b", power: 6, size: 1.6 }],
          night: ["#060a1a", "#1d2a55", "#05060c", { dir: new THREE.Vector3(-0.5, 0.7, -0.5), color: "#cfdcff", power: 3, size: 0.8 }],
        };
        const envScene = gradientEnvScene(...(presets[lighting] ?? presets.neutral!));
        rt = pmrem.fromScene(envScene, 0.03);
        disposeScene(envScene);
      }
    } catch (err) {
      ctx.issue("asset-load", (err as Error).message, "environment.lighting");
    }
    if (rt) {
      scene.environment = rt.texture;
      disposables.push(rt);
      // Orthographic cameras cannot use the sky dome: show the (sharp) PMREM level instead.
      if (ortho && physicalSky && !transparent) {
        scene.background = rt.texture;
        scene.backgroundBlurriness = 0;
      }
    }
    pmrem.dispose();
    // A light rig already provides key / fill / rim: the IBL then only needs to
    // give reflections and soft ambient. At full strength the two stacked
    // washed light colours (pastels) out to white under ACES.
    const explicitIbl = env.lightingIntensity !== undefined || (typeof lighting === "object" && lighting.intensity !== undefined);
    if (env.rig && !explicitIbl) scene.environmentIntensity *= RIG_IBL_SCALE;
  }

  const lightsToAdd: THREE.Light[] = [];

  // Physical sky sun light.
  const sunDef = skyParams && skyParams.sun !== false ? skyParams.sun ?? {} : null;
  if (physicalSky && sunDef && sunDef.light !== false) {
    const sl = sunLight(physicalSky.values.elevation);
    const light = new THREE.DirectionalLight(sunDef.color ? toColor(sunDef.color) : sl.color, num(sunDef.intensity, sl.intensity));
    light.position.copy(physicalSky.sunDir).multiplyScalar(30);
    light.name = "__sun";
    light.userData.a3dId = "sun";
    if (sunDef.castShadow !== false && light.intensity > 0) configureShadow(light, { type: "directional", shadow: { softness: 3 } }, env.shadows);
    lightsToAdd.push(light);
  }

  // Light rig.
  for (const def of expandRig(env.rig)) {
    const light = await buildLight(def, env.shadows);
    lightsToAdd.push(light);
  }
  for (const l of lightsToAdd) {
    objects.push(l);
    if (l instanceof THREE.DirectionalLight || l instanceof THREE.SpotLight) objects.push(l.target);
  }

  // Ground
  let ground: THREE.Object3D | undefined;
  if (env.ground) {
    const g = env.ground;
    const size = num(g.size, 60);
    const y = num(g.y, 0);
    const mat = g.shadowOnly
      ? fadingShadowMaterial(toColor(g.color ?? "#000000"), num(g.opacity, 0.28))
      : fadingGroundMaterial(toColor(g.color ?? "#d9d9d9"), num(g.roughness, 0.9));
    if (!g.shadowOnly && g.opacity !== undefined) (mat as THREE.MeshStandardMaterial).opacity = g.opacity;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    plane.receiveShadow = true;
    plane.name = "__ground";
    // The fading ground is transparent: draw it before the contact-shadow
    // plane (renderOrder -10) or it covers the shadows lying on it.
    plane.renderOrder = -20;
    plane.userData.helper = true;
    plane.userData.ground = true;
    objects.push(plane);
    ground = plane;
    if (g.grid) {
      const grid = new THREE.GridHelper(size, Math.round(size), toColor("#000000"), toColor("#000000"));
      const gm = grid.material as THREE.Material;
      gm.transparent = true;
      gm.opacity = 0.12;
      gm.depthWrite = false;
      grid.position.y = y + 0.002;
      grid.userData.helper = true;
      objects.push(grid);
    }
  }

  // Contact shadows
  if (env.contactShadows) {
    const cs = createContactShadows(env.contactShadows, scene, env.ground ? num(env.ground.y, 0) : undefined, ctx);
    if (cs) {
      objects.push(cs.object);
      disposables.push(cs);
    }
  }

  return {
    objects,
    ground,
    dispose() {
      for (const d of disposables) d.dispose();
      for (const o of objects) {
        o.traverse((x) => {
          const m = x as THREE.Mesh;
          m.geometry?.dispose();
          const mm = m.material as THREE.Material | undefined;
          mm?.dispose?.();
          (x as THREE.DirectionalLight).shadow?.dispose?.();
        });
      }
    },
  };
}
