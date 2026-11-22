// Cel-shaded ("toon") material that keeps the albedo's perceived colour.
//
// three's MeshToonMaterial ignores image-based lighting (scene.environment)
// and rect-area lights, so in Agent3D's IBL-lit looks (studio, sunset, …) a
// toon surface only receives the key lights: brand colours came out dark and
// desaturated (teal #2cc7b8 → bottle green). Instead, toon here is a
// MeshStandardMaterial (full lighting: IBL fill, area lights, shadows, tone
// mapping like every other surface) whose DIRECT diffuse term is quantised
// into bands: lit (×1), half-lit (×0.5), shadow (IBL fill only). The lit band
// shows the albedo at full light, so the colour reads as specified.

import * as THREE from "three";

export const TOON_BAND_GLSL = /* glsl */ `
float a3dToonBand( float x ) {
	float w = max( fwidth( x ), 1e-3 ) * 0.75;
	return 0.5 * smoothstep( - w, w, x ) + 0.5 * smoothstep( 0.42 - w, 0.42 + w, x );
}
`;

const DIRECT_DIFFUSE = "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );";

export function applyToonShading(mat: THREE.MeshStandardMaterial): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.call(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
    if (!chunk.includes(DIRECT_DIFFUSE)) return; // three changed: plain standard shading
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_pars_fragment>",
      TOON_BAND_GLSL + chunk.replace(DIRECT_DIFFUSE, "float dotNL = a3dToonBand( dot( geometryNormal, directLight.direction ) );"),
    );
  };
  mat.customProgramCacheKey = () => `a3d-toon(${prevKey})`;
  mat.userData.toon = true;
}

export function createToonMaterial(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...params });
  applyToonShading(mat);
  return mat;
}
