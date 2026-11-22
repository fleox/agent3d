// Studio floor grid: one shader plane on y = 0 that follows the camera, with
// anti-aliased 1 m / 5 m lines, X (red) and Z (blue) axis lines, a fade with
// distance and at grazing angles (an eye-level camera sees no horizontal line
// streaks). Lives in the World scene (depth-tested against the content,
// never writes depth) and is tagged `userData.helper` (skipped by contact
// shadows / post-effect masks) + `userData.editorHelper` (the G toggle).

import * as THREE from "three";

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uCam;
  uniform vec3 uCamDir;
  uniform float uOrtho;
  uniform float uFade;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  varying vec3 vWorld;

  // Coverage of lines every \`step\` metres, ~\`px\` pixels wide; fades out when the cells get sub-pixel.
  float lines(vec2 p, float step, float px) {
    vec2 c = p / step;
    vec2 d = fwidth(c);
    vec2 g = abs(fract(c - 0.5) - 0.5) / max(d, 1e-5);
    float l = 1.0 - min(min(g.x, g.y) / px, 1.0);
    float lod = 1.0 - smoothstep(0.15, 0.5, max(d.x, d.y));
    return l * lod;
  }
  float axis(float v, float px) {
    float d = fwidth(v);
    return 1.0 - min(abs(v) / max(d, 1e-5) / px, 1.0);
  }

  void main() {
    vec3 toFrag = vWorld - uCam;
    float dist = length(toFrag.xz);
    vec3 view = uOrtho > 0.5 ? uCamDir : normalize(toFrag);
    float graze = smoothstep(0.02, 0.22, abs(view.y));
    float fade = (1.0 - smoothstep(uFade * 0.25, uFade, dist)) * graze;
    if (fade <= 0.0) discard;

    float minor = lines(vWorld.xz, 1.0, 0.8);
    float major = lines(vWorld.xz, 5.0, 1.1);
    float ax = axis(vWorld.z, 1.4);
    float az = axis(vWorld.x, 1.4);

    vec3 col = uMinor;
    float a = minor * 0.2;
    if (major * 0.38 > a) { col = uMajor; a = major * 0.38; }
    if (ax * 0.75 > a) { col = vec3(0.86, 0.28, 0.3); a = ax * 0.75; }
    if (az * 0.75 > a) { col = vec3(0.3, 0.5, 0.95); a = az * 0.75; }
    a *= fade;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;

// Fade radius (metres) for a camera `orbitDistance` away from what it looks at.
export function gridFadeRadius(orbitDistance: number, height: number): number {
  const d = Math.max(Math.abs(orbitDistance), Math.abs(height), 0);
  return Math.min(Math.max(d * 3, 12), 600);
}

export interface EditorGrid {
  mesh: THREE.Mesh;
  // Distance from the camera to its orbit target (drives the fade radius).
  setFocusDistance(d: number): void;
  dispose(): void;
}

export function createEditorGrid(): EditorGrid {
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uCamDir: { value: new THREE.Vector3(0, -1, 0) },
    uOrtho: { value: 0 },
    uFade: { value: 30 },
    uMinor: { value: new THREE.Color(0x8a8a90) },
    uMajor: { value: new THREE.Color(0xb4b4ba) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
    // Wins against a ground plane lying on y = 0 (no z-fighting).
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "__editorGrid";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.userData.helper = true;
  mesh.userData.editorHelper = true;
  mesh.raycast = () => {};
  let focus = 10;
  const dir = new THREE.Vector3();
  mesh.onBeforeRender = (_r, _s, camera) => {
    const cam = uniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(dir);
    uniforms.uCamDir.value.copy(dir);
    uniforms.uOrtho.value = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    const r = gridFadeRadius(focus, cam.y);
    uniforms.uFade.value = r;
    // Follow the camera on whole 5 m cells (lines stay put in world space).
    mesh.position.set(Math.round(cam.x / 5) * 5, 0, Math.round(cam.z / 5) * 5);
    mesh.scale.set(r + 5, 1, r + 5);
    mesh.updateMatrixWorld();
  };
  return {
    mesh,
    setFocusDistance(d) {
      focus = d;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
