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
  if (def.envMapIntensity !== undefined && mat instanceof THREE.MeshStandardMaterial && def.envMapIntensity !== 1) {
    const uEnv = { value: def.envMapIntensity };
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
  }
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
