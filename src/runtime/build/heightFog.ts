// Height fog: exponential fog (scene.fog = FogExp2) whose density decays with
// altitude above `height` (analytic integral along the view ray), so valleys
// and the ground fill with haze while hills and the sky stay clear. Every lit
// / basic material of the scene with `fog: true` gets its fog chunk patched
// (materials created later — spawned objects — are patched on the next frame).

import * as THREE from "three";
import { addShaderPatch } from "./materials";

export const HEIGHT_FOG_GLSL = /* glsl */ `
uniform float uA3dFogHeight;
uniform float uA3dFogFalloff;
varying vec3 vA3dFogWorld;
float a3dHeightFog(float density) {
  vec3 ro = cameraPosition;
  vec3 d = vA3dFogWorld - ro;
  float dist = length(d);
  vec3 rd = d / max(dist, 1e-4);
  float b = max(uA3dFogFalloff, 1e-4);
  float h = ro.y - uA3dFogHeight;
  float amount;
  if (abs(rd.y) < 1e-4) amount = density * exp(-h * b) * dist;
  else amount = (density / b) * exp(-h * b) * (1.0 - exp(-dist * rd.y * b)) / rd.y;
  return 1.0 - exp(-max(amount, 0.0));
}
`;

export interface HeightFogUniforms {
  uA3dFogHeight: { value: number };
  uA3dFogFalloff: { value: number };
}

export function patchHeightFog(mat: THREE.Material, uniforms: HeightFogUniforms): void {
  if (!(mat as { fog?: boolean }).fog || (mat as THREE.ShaderMaterial).isShaderMaterial) return;
  addShaderPatch(mat, "height-fog", (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (!shader.vertexShader.includes("#include <fog_vertex>")) return;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vA3dFogWorld;")
      .replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
	{
		vec4 a3dW = vec4( transformed, 1.0 );
		#ifdef USE_INSTANCING
			a3dW = instanceMatrix * a3dW;
		#endif
		vA3dFogWorld = ( modelMatrix * a3dW ).xyz;
	}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + HEIGHT_FOG_GLSL)
      .replace(
        "#include <fog_fragment>",
        `#ifdef USE_FOG
	#ifdef FOG_EXP2
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, a3dHeightFog( fogDensity ) );
	#else
		#include <fog_fragment>
	#endif
#endif`,
      );
  });
}

// Patches every material under `root` (idempotent; cheap to call every frame).
export function applyHeightFog(root: THREE.Object3D, uniforms: HeightFogUniforms): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) {
      if (x.userData.a3dHeightFog) continue;
      x.userData.a3dHeightFog = true;
      patchHeightFog(x, uniforms);
    }
  });
}
