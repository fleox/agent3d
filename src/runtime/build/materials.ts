// MaterialDef → THREE.Material. Presets (CATALOG.materialPresets) are merged
// under explicit properties. Types: standard, physical, basic, lambert, toon,
// normal, matcap, gradient (lit vertical colour ramp in object space), shader
// (catalog shader from src/runtime/shaders/).

import * as THREE from "three";
import { MATERIAL_PRESETS } from "../../core/catalog";
import type { MaterialDef } from "../../core/types";
import { loadTexture } from "../assets";
import { colors, num, toColor } from "../util";
import type { RuntimeContext } from "./context";

export const MATERIAL_PRESET_IDS = MATERIAL_PRESETS.map((p) => p.id);

export function resolveMaterialDef(def: MaterialDef | undefined): MaterialDef {
  const d = def ?? {};
  const preset = d.preset ? MATERIAL_PRESETS.find((p) => p.id === d.preset) : undefined;
  const merged: MaterialDef = { ...((preset?.props ?? {}) as MaterialDef) };
  for (const [k, v] of Object.entries(d)) if (v !== undefined && k !== "preset") (merged as Record<string, unknown>)[k] = v;
  if (!merged.type) merged.type = merged.shader ? "shader" : merged.gradient ? "gradient" : "standard";
  return merged;
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

function applyGradient(mat: THREE.Material, ramp: string[]): GradientUniforms {
  const cols = ramp.slice(0, MAX_STOPS).map((c) => toColor(c));
  while (cols.length < MAX_STOPS) cols.push(cols[cols.length - 1].clone());
  const uniforms: GradientUniforms = {
    uGradColors: { value: cols },
    uGradCount: { value: Math.min(Math.max(ramp.length, 1), MAX_STOPS) },
    uGradMin: { value: -0.5 },
    uGradMax: { value: 0.5 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = "varying float vGradY;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvGradY = position.y;");
    shader.fragmentShader =
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
  };
  mat.customProgramCacheKey = () => "agent3d-gradient";
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

  const pbr: Record<string, unknown> = { ...lit };
  if (def.metalness !== undefined) pbr.metalness = def.metalness;
  pbr.roughness = num(def.roughness, 0.5);

  let mat: THREE.Material;
  switch (type) {
    case "physical": {
      const p: Record<string, unknown> = { ...pbr };
      if (def.transmission !== undefined) p.transmission = def.transmission;
      if (def.thickness !== undefined) p.thickness = def.thickness;
      if (def.ior !== undefined) p.ior = def.ior;
      if (def.clearcoat !== undefined) {
        p.clearcoat = def.clearcoat;
        p.clearcoatRoughness = 0.1;
      }
      if (def.iridescence !== undefined) {
        p.iridescence = def.iridescence;
        p.iridescenceIOR = 1.6;
        p.iridescenceThicknessRange = [180, 600];
      }
      if (def.sheen !== undefined) {
        p.sheen = def.sheen;
        p.sheenRoughness = 0.6;
        p.sheenColor = toColor(color ?? "#ffffff").lerp(new THREE.Color(1, 1, 1), 0.5);
      }
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
      applyGradient(mat, colors(def.gradient, ["#3a86ff", "#ff006e"]));
      break;
    }
    default:
      mat = new THREE.MeshStandardMaterial(pbr as THREE.MeshStandardMaterialParameters);
  }

  // Textures
  const texSlots: [keyof MaterialDef, string, boolean][] = [
    ["map", "map", true],
    ["normalMap", "normalMap", false],
    ["roughnessMap", "roughnessMap", false],
  ];
  for (const [key, slot, srgb] of texSlots) {
    const path = def[key] as string | undefined;
    if (!path || !(slot in mat)) continue;
    const url = ctx.resolveAsset(path);
    ctx.track(
      loadTexture(url)
        .then((tex) => {
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          if (def.repeat) {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(def.repeat[0], def.repeat[1]);
          }
          tex.anisotropy = 4;
          (mat as unknown as Record<string, unknown>)[slot] = tex;
          if (slot === "map" && !def.color) (mat as THREE.MeshStandardMaterial).color?.set(0xffffff);
          mat.needsUpdate = true;
        })
        .catch((err: Error) => ctx.issue("asset-load", err.message, path)),
    );
  }
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
