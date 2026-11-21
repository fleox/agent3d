// Environment: background (colour, transparent, gradients, sky dome, HDRI),
// image-based lighting presets (PMREM), fog, ground.

import * as THREE from "three";
import type { EnvironmentDef, SkyParams } from "../../core/types";
import { loadTexture } from "../assets";
import { num, toColor, vec3 } from "../util";
import type { RuntimeContext } from "./context";

export interface BuiltEnvironment {
  objects: THREE.Object3D[]; // sky dome, ground, grid (added to the scene root)
  ground?: THREE.Object3D;
  dispose(): void;
}

// ─── Canvas gradients ───────────────────────────────────────────────────

function canvasGradient(cols: string[], kind: "linear" | "radial", angle = 0): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const s = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d");
  if (!g) return null;
  let grad: CanvasGradient;
  if (kind === "radial") grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.72);
  else {
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
  // Light dithering against banding.
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (((i * 2654435761) >>> 0) % 1000) / 1000 - 0.5;
    img.data[i] += n * 2;
    img.data[i + 1] += n * 2;
    img.data[i + 2] += n * 2;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─── Sky dome ───────────────────────────────────────────────────────────

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
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: toColor(p.top ?? "#2f6fd6") },
      uHorizon: { value: toColor(p.horizon ?? "#cfe6ff") },
      uBottom: { value: toColor(p.bottom ?? p.horizon ?? "#e8eef5") },
      uSunDir: { value: new THREE.Vector3(...vec3(sun?.direction, [0.4, 0.35, -1])).normalize() },
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

function gradientEnvScene(top: string, horizon: string, bottom: string, glow?: { dir: THREE.Vector3; color: string; power: number; size: number }): THREE.Scene {
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
  // Soft panels so reflections have some structure.
  const panelMat = new THREE.MeshBasicMaterial({ color: toColor(horizon).multiplyScalar(1.6), side: THREE.DoubleSide, toneMapped: false });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.4), panelMat);
    panel.position.set(Math.cos(a) * 9, 1.5, Math.sin(a) * 9);
    panel.lookAt(0, 1.5, 0);
    scene.add(panel);
  }
  return scene;
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

export async function buildEnvironment(env: EnvironmentDef, scene: THREE.Scene, camera: THREE.Camera, transparent: boolean, ctx: RuntimeContext): Promise<BuiltEnvironment> {
  const objects: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];
  const renderer = ctx.renderer;
  const bg = env.background;
  let bgHdri: THREE.Texture | null = null;
  scene.background = null;

  if (!transparent && bg !== undefined && bg !== "transparent") {
    if (typeof bg === "string") scene.background = toColor(bg);
    else if ("gradient" in bg) scene.background = canvasGradient(bg.gradient, "linear", num(bg.angle, 0));
    else if ("radial" in bg) scene.background = canvasGradient(bg.radial, "radial");
    else if ("sky" in bg) {
      const sky = bg.sky ?? {};
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) scene.background = canvasGradient([sky.bottom ?? sky.horizon ?? "#e8eef5", sky.horizon ?? "#cfe6ff", sky.top ?? "#2f6fd6"], "linear", 0);
      else objects.push(createSky(sky, ctx));
    } else if ("hdri" in bg) {
      try {
        bgHdri = await loadEquirect(ctx.resolveAsset(bg.hdri));
        scene.background = bgHdri;
        scene.backgroundBlurriness = num(bg.blur, 0);
        disposables.push(bgHdri);
      } catch (err) {
        ctx.issue("asset-load", (err as Error).message, "environment.background.hdri");
      }
    }
    if (scene.background instanceof THREE.Texture) disposables.push(scene.background);
  }

  // IBL
  const lighting = env.lighting ?? (bgHdri ? { hdri: "" } : "soft");
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
        if (tex && tex !== bgHdri) tex.dispose();
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
        const envScene = gradientEnvScene(...(presets[lighting] ?? presets.neutral));
        rt = pmrem.fromScene(envScene, 0.03);
        envScene.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          (m.material as THREE.Material | undefined)?.dispose();
        });
      }
    } catch (err) {
      ctx.issue("asset-load", (err as Error).message, "environment.lighting");
    }
    if (rt) {
      scene.environment = rt.texture;
      disposables.push(rt);
    }
    pmrem.dispose();
  }

  // Fog
  scene.fog = null;
  if (env.fog) {
    const fogColor = toColor(env.fog.color ?? (typeof bg === "string" && bg !== "transparent" ? bg : "#ffffff"));
    if ("density" in env.fog) scene.fog = new THREE.FogExp2(fogColor, env.fog.density);
    else scene.fog = new THREE.Fog(fogColor, num(env.fog.near, 10), num(env.fog.far, 60));
  }

  // Ground
  let ground: THREE.Object3D | undefined;
  if (env.ground) {
    const g = env.ground;
    const size = num(g.size, 60);
    const y = num(g.y, 0);
    const mat = g.shadowOnly
      ? new THREE.ShadowMaterial({ opacity: 0.28, color: toColor(g.color ?? "#000000") })
      : fadingGroundMaterial(toColor(g.color ?? "#d9d9d9"), num(g.roughness, 0.9));
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    plane.receiveShadow = true;
    plane.name = "__ground";
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
        });
      }
    },
  };
}
