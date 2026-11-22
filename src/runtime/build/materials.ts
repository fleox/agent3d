// MaterialDef → THREE.Material. Presets (CATALOG.materialPresets) are merged
// under explicit properties. Types: standard, physical, basic, lambert, toon,
// normal, matcap, gradient (lit vertical colour ramp in object space), shader
// (catalog shader from src/runtime/shaders/).
// Texture slots take a file (project path / library id) or a procedural
// texture ({ procedural: "<catalog textures id>", …params }, see textures.ts);
// `triplanar` projects map / roughness / metalness / normal maps along the
// object axes instead of UVs.

import * as THREE from "three";
import { MATERIAL_PRESETS } from "../../core/catalog";
import type { MaterialDef, ProceduralTextureDef, TextureRef } from "../../core/types";
import { loadTexture } from "../assets";
import { colors, DEG, num, toColor } from "../util";
import type { RuntimeContext } from "./context";
import { createProceduralTexture, TEXTURE_SLOTS } from "./textures";

export const MATERIAL_PRESET_IDS = MATERIAL_PRESETS.map((p) => p.id);

export function resolveMaterialDef(def: MaterialDef | undefined): MaterialDef {
  const d = def ?? {};
  const preset = d.preset ? MATERIAL_PRESETS.find((p) => p.id === d.preset) : undefined;
  const merged: MaterialDef = { ...((preset?.props ?? {}) as MaterialDef) };
  for (const [k, v] of Object.entries(d)) if (v !== undefined && k !== "preset") (merged as Record<string, unknown>)[k] = v;
  if (!merged.type) merged.type = merged.shader ? "shader" : merged.gradient ? "gradient" : "standard";
  return merged;
}

// ─── Shader patches (several can stack on one material) ─────────────────

type Patch = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

// Adds an onBeforeCompile patch identified by `key` (idempotent per key).
export function addShaderPatch(mat: THREE.Material, key: string, patch: Patch): void {
  let list = mat.userData.a3dPatches as { key: string; patch: Patch }[] | undefined;
  if (!list) {
    list = mat.userData.a3dPatches = [];
    // Keep a patch installed directly by other code (generators, ground…).
    const prev = mat.onBeforeCompile;
    if (prev !== THREE.Material.prototype.onBeforeCompile) {
      const prevKey = mat.customProgramCacheKey.call(mat);
      list.push({ key: `own(${prevKey})`, patch: (s, r) => prev.call(mat, s, r) });
    }
  }
  if (list.some((p) => p.key === key)) return;
  list.push({ key, patch });
  const patches = list;
  mat.onBeforeCompile = (shader, renderer) => {
    for (const p of patches) p.patch(shader, renderer);
  };
  mat.customProgramCacheKey = () => "agent3d:" + patches.map((p) => p.key).join("+");
  mat.needsUpdate = true;
}

let toonRamp: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (!toonRamp) {
    const data = new Uint8Array([90, 170, 255]);
    toonRamp = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.generateMipmaps = false;
    toonRamp.needsUpdate = true;
  }
  return toonRamp;
}

let matcapTex: THREE.Texture | null = null;
function defaultMatcap(): THREE.Texture | null {
  if (matcapTex) return matcapTex;
  if (typeof document === "undefined") return null;
  const s = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const g = cv.getContext("2d");
  if (!g) return null;
  const base = g.createRadialGradient(s * 0.38, s * 0.32, s * 0.02, s * 0.5, s * 0.5, s * 0.52);
  base.addColorStop(0, "#ffffff");
  base.addColorStop(0.25, "#e6e6ea");
  base.addColorStop(0.7, "#7d7f88");
  base.addColorStop(1, "#2a2b30");
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  const rim = g.createRadialGradient(s * 0.5, s * 0.5, s * 0.4, s * 0.5, s * 0.5, s * 0.5);
  rim.addColorStop(0, "rgba(255,255,255,0)");
  rim.addColorStop(1, "rgba(200,210,255,0.35)");
  g.fillStyle = rim;
  g.fillRect(0, 0, s, s);
  matcapTex = new THREE.CanvasTexture(cv);
  matcapTex.colorSpace = THREE.SRGBColorSpace;
  return matcapTex;
}

const SIDES = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide } as const;

// Gradient: patch a lit material so diffuse comes from a ramp over object-space Y.
const MAX_STOPS = 8;
export interface GradientUniforms {
  uGradColors: { value: THREE.Color[] };
  uGradCount: { value: number };
  uGradMin: { value: number };
  uGradMax: { value: number };
}

function applyGradient(mat: THREE.Material, ramp: string[], emissive = false): GradientUniforms {
  const cols = ramp.slice(0, MAX_STOPS).map((c) => toColor(c));
  while (cols.length < MAX_STOPS) cols.push(cols[cols.length - 1].clone());
  const uniforms: GradientUniforms = {
    uGradColors: { value: cols },
    uGradCount: { value: Math.min(Math.max(ramp.length, 1), MAX_STOPS) },
    uGradMin: { value: -0.5 },
    uGradMax: { value: 0.5 },
  };
  addShaderPatch(mat, emissive ? "gradient-emissive" : "gradient", (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = "varying float vGradY;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvGradY = position.y;");
    let frag =
      `varying float vGradY;\nuniform vec3 uGradColors[${MAX_STOPS}];\nuniform int uGradCount;\nuniform float uGradMin;\nuniform float uGradMax;\n` +
      shader.fragmentShader.replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `float gT = clamp((vGradY - uGradMin) / max(uGradMax - uGradMin, 1e-5), 0.0, 1.0);
	vec3 gCol = uGradColors[0];
	if (uGradCount > 1) {
		float f = gT * float(uGradCount - 1);
		for (int i = 0; i < ${MAX_STOPS - 1}; i++) {
			if (i < uGradCount - 1) gCol = mix(gCol, uGradColors[i + 1], clamp(f - float(i), 0.0, 1.0));
		}
	}
	vec4 diffuseColor = vec4( diffuse * gCol, opacity );`,
      );
    if (emissive) frag = frag.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= gCol;");
    shader.fragmentShader = frag;
  });
  mat.userData.gradient = uniforms;
  return uniforms;
}

// Fit a gradient material's ramp to the geometry's Y extent.
export function fitGradient(mat: THREE.Material | THREE.Material[], geometry: THREE.BufferGeometry): void {
  for (const m of Array.isArray(mat) ? mat : [mat]) {
    const u = m.userData.gradient as GradientUniforms | undefined;
    if (!u) continue;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    u.uGradMin.value = bb.min.y;
    u.uGradMax.value = bb.max.y;
  }
}

// ─── Triplanar mapping ──────────────────────────────────────────────────

export const TRIPLANAR_GLSL = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
uniform vec2 uTriScale;
vec3 triW() {
  vec3 w = pow(abs(normalize(vTriNormal)), vec3(4.0));
  return w / max(w.x + w.y + w.z, 1e-5);
}
vec4 triSample(sampler2D tex) {
  vec3 w = triW();
  vec3 p = vTriPos;
  return texture2D(tex, p.zy * uTriScale) * w.x + texture2D(tex, p.xz * uTriScale) * w.y + texture2D(tex, p.xy * uTriScale) * w.z;
}
`;

function applyTriplanar(mat: THREE.Material, scale: number, repeat: [number, number] | undefined): void {
  const uScale = { value: new THREE.Vector2(scale * (repeat?.[0] ?? 1), scale * (repeat?.[1] ?? repeat?.[0] ?? 1)) };
  addShaderPatch(mat, "triplanar", (shader) => {
    shader.uniforms.uTriScale = uScale;
    shader.vertexShader =
      "varying vec3 vTriPos;\nvarying vec3 vTriNormal;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvTriPos = position;\n\tvTriNormal = normal;");
    let f = shader.fragmentShader;
    f = f.replace("#include <common>", "#include <common>\n" + TRIPLANAR_GLSL + "\n#if defined( USE_NORMALMAP_TANGENTSPACE ) && !defined( USE_NORMALMAP_OBJECTSPACE )\nuniform mat3 normalMatrix;\n#endif\n");
    f = f.replace("#include <map_fragment>", "#ifdef USE_MAP\n\tdiffuseColor *= triSample( map );\n#endif");
    f = f.replace(
      "#include <roughnessmap_fragment>",
      "float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n\troughnessFactor *= triSample( roughnessMap ).g;\n#endif",
    );
    f = f.replace(
      "#include <metalnessmap_fragment>",
      "float metalnessFactor = metalness;\n#ifdef USE_METALNESSMAP\n\tmetalnessFactor *= triSample( metalnessMap ).b;\n#endif",
    );
    f = f.replace("#include <emissivemap_fragment>", "#ifdef USE_EMISSIVEMAP\n\ttotalEmissiveRadiance *= triSample( emissiveMap ).rgb;\n#endif");
    // Whiteout-blended tangent normals → object space → view space.
    f = f.replace(
      "#include <normal_fragment_maps>",
      `#if defined( USE_NORMALMAP_TANGENTSPACE )
	{
		vec3 tw = triW();
		vec3 on = normalize( vTriNormal );
		vec3 p = vTriPos;
		vec3 tx = texture2D( normalMap, p.zy * uTriScale ).xyz * 2.0 - 1.0;
		vec3 ty = texture2D( normalMap, p.xz * uTriScale ).xyz * 2.0 - 1.0;
		vec3 tz = texture2D( normalMap, p.xy * uTriScale ).xyz * 2.0 - 1.0;
		tx.xy *= normalScale; ty.xy *= normalScale; tz.xy *= normalScale;
		tx = vec3( tx.xy + on.zy, abs( tx.z ) * on.x );
		ty = vec3( ty.xy + on.xz, abs( ty.z ) * on.y );
		tz = vec3( tz.xy + on.xy, abs( tz.z ) * on.z );
		vec3 objN = normalize( tx.zyx * tw.x + ty.xzy * tw.y + tz.xyz * tw.z );
		normal = normalize( normalMatrix * objN ) * faceDirection;
	}
#else
	#include <normal_fragment_maps>
#endif`,
    );
    shader.fragmentShader = f;
  });
}

// ─── Textures ───────────────────────────────────────────────────────────

const SLOT_KEYS = Object.keys(TEXTURE_SLOTS) as (keyof MaterialDef)[];

function configureTexture(tex: THREE.Texture, def: MaterialDef, srgb: boolean): void {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (def.repeat || def.triplanar) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (def.repeat && !def.triplanar) tex.repeat.set(def.repeat[0], def.repeat[1]);
  }
  tex.anisotropy = Math.max(tex.anisotropy, 4);
}

function assignTexture(mat: THREE.Material, slot: string, tex: THREE.Texture, def: MaterialDef): void {
  const m = mat as unknown as Record<string, unknown>;
  m[slot] = tex;
  if (slot === "map" && !def.color) (mat as THREE.MeshStandardMaterial).color?.set(0xffffff);
  if (slot === "emissiveMap" && !def.emissive) (mat as THREE.MeshStandardMaterial).emissive?.set(0xffffff);
  if (slot === "alphaMap") mat.transparent = def.transparent ?? true;
  mat.needsUpdate = true;
}

function applyTextures(mat: THREE.Material, def: MaterialDef, ctx: RuntimeContext): void {
  for (const slot of SLOT_KEYS) {
    const ref = def[slot] as TextureRef | undefined;
    if (!ref || !(slot in mat)) continue;
    const kind = TEXTURE_SLOTS[slot as string]!;
    if (typeof ref === "object") {
      try {
        const tex = createProceduralTexture(ref as ProceduralTextureDef, kind);
        configureTexture(tex, def, kind === "color");
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        assignTexture(mat, slot as string, tex, def);
      } catch (err) {
        ctx.issue("unknown-catalog-id", (err as Error).message, `material.${String(slot)}`);
      }
      continue;
    }
    const url = ctx.resolveAsset(ref);
    ctx.track(
      loadTexture(url)
        .then((tex) => {
          configureTexture(tex, def, kind === "color");
          assignTexture(mat, slot as string, tex, def);
        })
        .catch((err: Error) => ctx.issue("asset-load", err.message, ref)),
    );
  }
}

export interface MaterialOptions {
  defaultColor?: string;
  vertexColors?: boolean;
}

export async function createMaterial(input: MaterialDef | undefined, ctx: RuntimeContext, opts: MaterialOptions = {}): Promise<THREE.Material> {
  const def = resolveMaterialDef(input);
  const type = def.type ?? "standard";
  const color = def.color ?? (input?.preset ? undefined : opts.defaultColor);

  if (type === "shader") {
    const impls = await ctx.shaders().catch(() => ({}) as Record<string, never>);
    const id = def.shader ?? "plasma";
    const impl = (impls as Record<string, import("../registry").ShaderImpl>)[id];
    if (impl) {
      const params: Record<string, unknown> = { ...(def.uniforms ?? {}) };
      if (def.color && params.color === undefined) params.color = def.color;
      if (def.gradient && params.colors === undefined) params.colors = def.gradient;
      if (def.opacity !== undefined && params.opacity === undefined) params.opacity = def.opacity;
      const made = impl.create(params, ctx);
      if (made.update) {
        const up = made.update.bind(made);
        ctx.onUpdate((t) => up(t));
      }
      if (def.side) made.material.side = SIDES[def.side];
      return made.material;
    }
    ctx.issue("unknown-catalog-id", `Unknown shader "${id}"`, "material.shader");
  }

  const common: Record<string, unknown> = {};
  if (color) common.color = toColor(color);
  if (def.opacity !== undefined) common.opacity = def.opacity;
  if (def.transparent !== undefined || (def.opacity !== undefined && def.opacity < 1)) common.transparent = def.transparent ?? true;
  if (def.wireframe) common.wireframe = true;
  if (def.side) common.side = SIDES[def.side];
  if (opts.vertexColors) common.vertexColors = true;

  const lit: Record<string, unknown> = { ...common };
  if (def.emissive) lit.emissive = toColor(def.emissive);
  if (def.emissiveIntensity !== undefined) lit.emissiveIntensity = def.emissiveIntensity;
  if (def.flatShading) lit.flatShading = true;
  if (def.bumpScale !== undefined) lit.bumpScale = def.bumpScale;
  if (def.normalScale !== undefined) lit.normalScale = new THREE.Vector2(def.normalScale, def.normalScale);
  if (def.aoMapIntensity !== undefined) lit.aoMapIntensity = def.aoMapIntensity;
  if (def.displacementScale !== undefined) lit.displacementScale = def.displacementScale;

  const pbr: Record<string, unknown> = { ...lit };
  if (def.metalness !== undefined) pbr.metalness = def.metalness;
  pbr.roughness = num(def.roughness, 0.5);
  if (def.envMapIntensity !== undefined) pbr.envMapIntensity = def.envMapIntensity;

  let mat: THREE.Material;
  switch (type) {
    case "physical": {
      const p: Record<string, unknown> = { ...pbr };
      if (def.transmission !== undefined) p.transmission = def.transmission;
      if (def.thickness !== undefined) p.thickness = def.thickness;
      if (def.ior !== undefined) p.ior = def.ior;
      if (def.clearcoat !== undefined) {
        p.clearcoat = def.clearcoat;
        p.clearcoatRoughness = num(def.clearcoatRoughness, 0.1);
      }
      if (def.iridescence !== undefined) {
        p.iridescence = def.iridescence;
        p.iridescenceIOR = num(def.iridescenceIOR, 1.6);
        p.iridescenceThicknessRange = def.iridescenceThicknessRange ?? [180, 600];
      }
      if (def.sheen !== undefined) {
        p.sheen = def.sheen;
        p.sheenRoughness = num(def.sheenRoughness, 0.6);
        p.sheenColor = def.sheenColor ? toColor(def.sheenColor) : toColor(color ?? "#ffffff").lerp(new THREE.Color(1, 1, 1), 0.5);
      }
      if (def.anisotropy !== undefined) {
        p.anisotropy = def.anisotropy;
        p.anisotropyRotation = num(def.anisotropyRotation, 0) * DEG;
      }
      if (def.attenuationColor !== undefined) p.attenuationColor = toColor(def.attenuationColor);
      if (def.attenuationDistance !== undefined) p.attenuationDistance = def.attenuationDistance;
      if (def.specularIntensity !== undefined) p.specularIntensity = def.specularIntensity;
      if (def.specularColor !== undefined) p.specularColor = toColor(def.specularColor);
      if (def.dispersion !== undefined) p.dispersion = def.dispersion;
      mat = new THREE.MeshPhysicalMaterial(p as THREE.MeshPhysicalMaterialParameters);
      break;
    }
    case "basic":
      mat = new THREE.MeshBasicMaterial(common as THREE.MeshBasicMaterialParameters);
      break;
    case "lambert":
      mat = new THREE.MeshLambertMaterial(lit as THREE.MeshLambertMaterialParameters);
      break;
    case "toon":
      mat = new THREE.MeshToonMaterial({ ...(lit as THREE.MeshToonMaterialParameters), gradientMap: toonGradient() });
      break;
    case "normal":
      mat = new THREE.MeshNormalMaterial({ flatShading: !!def.flatShading, wireframe: !!def.wireframe, side: common.side as THREE.Side | undefined, transparent: common.transparent as boolean | undefined, opacity: def.opacity ?? 1 });
      break;
    case "matcap":
      mat = new THREE.MeshMatcapMaterial({ ...(common as THREE.MeshMatcapMaterialParameters), flatShading: !!def.flatShading, matcap: defaultMatcap() ?? undefined });
      break;
    case "gradient": {
      mat = new THREE.MeshStandardMaterial({ ...(pbr as THREE.MeshStandardMaterialParameters), color: toColor(def.color ?? "#ffffff") });
      applyGradient(mat, colors(def.gradient, ["#3a86ff", "#ff006e"]), !!def.gradientEmissive);
      break;
    }
    default:
      mat = new THREE.MeshStandardMaterial(pbr as THREE.MeshStandardMaterialParameters);
  }

  // three ignores material.envMapIntensity when the IBL comes from scene.environment:
  // scale the image-based radiance / irradiance in the shader instead.
  if (def.envMapIntensity !== undefined && mat instanceof THREE.MeshStandardMaterial && def.envMapIntensity !== 1) envScaleUniform(mat).value = def.envMapIntensity;
  if (mat instanceof THREE.MeshPhysicalMaterial && isGemLike(def)) applyGemSparkle(mat, def);
  if (def.triplanar && mat instanceof THREE.MeshStandardMaterial) applyTriplanar(mat, typeof def.triplanar === "number" ? def.triplanar : 1, def.repeat);
  applyTextures(mat, def, ctx);
  return mat;
}

// Apply a material def as an override to every mesh under `root`.
export async function overrideMaterials(root: THREE.Object3D, def: MaterialDef, ctx: RuntimeContext): Promise<void> {
  const mat = await createMaterial(def, ctx);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = mat;
      fitGradient(mat, m.geometry);
    }
  });
}

/**
 * The per-material environment (IBL) strength uniform — installs the shader
 * patch on first use. three ignores material.envMapIntensity when the IBL
 * comes from scene.environment, so the image-based radiance / irradiance is
 * scaled in the shader instead (also what timeline tracks
 * `<id>.material.envMapIntensity` drive).
 */
export function envScaleUniform(mat: THREE.MeshStandardMaterial): { value: number } {
  const existing = mat.userData.envScale as { value: number } | undefined;
  if (existing) return existing;
  const uEnv = { value: 1 };
  mat.userData.envScale = uEnv;
  addShaderPatch(mat, "env-scale", (shader) => {
    shader.uniforms.uA3dEnvScale = uEnv;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uA3dEnvScale;")
      .replace(
        "#include <lights_fragment_maps>",
        "#include <lights_fragment_maps>\n#if defined( RE_IndirectSpecular ) && defined( RE_IndirectDiffuse )\n\tradiance *= uA3dEnvScale;\n\tclearcoatRadiance *= uA3dEnvScale;\n\tiblIrradiance *= uA3dEnvScale;\n#endif",
      );
  });
  return uEnv;
}

// ─── Gem sparkle (diamond / gem presets and any clear high-IOR solid) ────
//
// A real gem sparkles because light bounces inside it and exits through other
// facets, each one seeing a different (often dark) part of the surroundings.
// Three's transmission only refracts once, so on a soft, light environment
// (softbox HDRI, white page) gems read as flat frosted glass. This patch adds
// a cheap fake: per-facet hashed inner-facet normals (object space, so the
// pattern is stable while the gem turns), the refracted ray reflected off
// three of them, the environment sampled along the exit rays per colour
// channel (dispersion = "fire"), contrast-stretched (dark and bright facets)
// and mixed over the plain transmission, tinted by the attenuation colour.

export function isGemLike(def: MaterialDef): boolean {
  return (def.transmission ?? 0) >= 0.5 && (def.ior ?? 1.5) >= 1.7 && (def.roughness ?? 0.5) <= 0.15;
}

export function applyGemSparkle(mat: THREE.MeshPhysicalMaterial, def: MaterialDef): void {
  const u = {
    uA3dGemIor: { value: def.ior ?? 2 },
    uA3dGemDisp: { value: Math.min(0.12, (def.dispersion ?? 0) * 0.012) },
    uA3dGemTint: { value: def.attenuationColor ? toColor(def.attenuationColor) : new THREE.Color(1, 1, 1) },
    uA3dGemEnv: envScaleUniform(mat), // shared with the env-scale patch (and its timeline tracks)
    // Diamond-like IORs (≥ 2) get more of it than coloured stones.
    uA3dGemAmount: { value: Math.min(0.85, 0.45 + Math.max(0, (def.ior ?? 2) - 1.5) * 0.45) },
  };
  mat.userData.gemSparkle = u;
  addShaderPatch(mat, "gem-sparkle", (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vA3dJ0; varying vec3 vA3dJ1; varying vec3 vA3dJ2;
vec3 a3dGemHash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
vec3 a3dOn = floor(objectNormal * 64.0 + 0.5);
vA3dJ0 = normalMatrix * (a3dGemHash(a3dOn + 1.7) - 0.5);
vA3dJ1 = normalMatrix * (a3dGemHash(a3dOn + 9.3) - 0.5);
vA3dJ2 = normalMatrix * (a3dGemHash(a3dOn + 23.1) - 0.5);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vA3dJ0; varying vec3 vA3dJ1; varying vec3 vA3dJ2;
uniform float uA3dGemIor; uniform float uA3dGemDisp; uniform vec3 uA3dGemTint; uniform float uA3dGemEnv; uniform float uA3dGemAmount;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
{
  vec3 gV = normalize(geometryViewDir);
  vec3 gN = normalize(normal);
  vec3 sp = vec3(0.0);
  vec3 iors = vec3(uA3dGemIor - uA3dGemDisp, uA3dGemIor, uA3dGemIor + uA3dGemDisp);
  for (int k = 0; k < 3; k++) {
    vec3 J = k == 0 ? vA3dJ0 : (k == 1 ? vA3dJ1 : vA3dJ2);
    vec3 fn = normalize(-gN + J * 1.6);
    for (int c = 0; c < 3; c++) {
      vec3 rd = refract(-gV, gN, 1.0 / iors[c]);
      vec3 d = normalize(reflect(rd, fn));
      // A second inner bounce off the next fake facet: the exit ray swings a
      // lot with the view angle, so faces break into light / dark areas.
      vec3 J2 = k == 0 ? vA3dJ1 : (k == 1 ? vA3dJ2 : vA3dJ0);
      d = normalize(reflect(d, normalize(d * -0.5 + J2 * 2.0 + gN * 0.3)));
      sp[c] += getIBLRadiance(d, d, 0.0)[c];
    }
  }
  sp *= uA3dGemEnv / 3.0;
  // Contrast: facets catching bright light flash, the others go dark.
  // Relative to the environment's average brightness (its irradiance), so it
  // works on a uniformly light softbox as well as on a dark studio.
  vec3 avgEnv = (getIBLIrradiance(gN) + getIBLIrradiance(-gN)) / (2.0 * PI) * uA3dGemEnv / max(envMapIntensity, 1e-3);
  float la = max(dot(avgEnv, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  float l = dot(sp, vec3(0.2126, 0.7152, 0.0722));
  sp *= smoothstep(0.7 * la, 1.6 * la, l) * 1.6;
  float F = pow(1.0 - saturate(dot(gN, gV)), 5.0);
  outgoingLight = mix(outgoingLight, sp * uA3dGemTint + outgoingLight * 0.25, uA3dGemAmount * (1.0 - F));
}
#endif
#include <opaque_fragment>`,
      );
  });
}
