// Contact shadows (environment.contactShadows): the scene is rendered from
// below with an orthographic camera into a small render target as "height
// above the plane" darkness, blurred twice (separable Gaussian), and shown on
// a transparent plane that fades out radially. Soft, grounded shadows under
// products without any shadow-casting light. Re-rendered every frame (or only
// the first `frames` frames for static scenes).

import * as THREE from "three";
import type { ContactShadowsDef } from "../../core/types";
import { num, toColor } from "../util";
import type { RuntimeContext } from "./context";

const BLUR_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(tDiffuse, vUv) * 0.2270270270;
  s += texture2D(tDiffuse, vUv + uDir * 1.3846153846) * 0.3162162162;
  s += texture2D(tDiffuse, vUv - uDir * 1.3846153846) * 0.3162162162;
  s += texture2D(tDiffuse, vUv + uDir * 3.2307692308) * 0.0702702703;
  s += texture2D(tDiffuse, vUv - uDir * 3.2307692308) * 0.0702702703;
  gl_FragColor = s;
}`;

const PLANE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const PLANE_FRAG = /* glsl */ `
uniform sampler2D tShadow;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  // The shadow camera looks up (+Y) with +Z as its up axis: flip V onto the plane.
  float a = texture2D(tShadow, vec2(vUv.x, 1.0 - vUv.y)).a;
  float fade = 1.0 - smoothstep(0.32, 0.5, length(vUv - 0.5));
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0) * uOpacity * fade);
  #include <colorspace_fragment>
}`;

export interface ContactShadows {
  object: THREE.Object3D;
  dispose(): void;
}

export function createContactShadows(opts: boolean | ContactShadowsDef, scene: THREE.Scene, defaultY: number | undefined, ctx: RuntimeContext): ContactShadows | null {
  const renderer = ctx.renderer;
  if (!renderer) return null;
  const o: ContactShadowsDef = typeof opts === "object" ? opts : {};
  const res = 2 ** Math.round(Math.log2(Math.max(128, Math.min(2048, num(o.resolution, 512)))));
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true } as const;
  const rt = new THREE.WebGLRenderTarget(res, res, rtOpts);
  const rtBlur = new THREE.WebGLRenderTarget(res, res, { ...rtOpts, depthBuffer: false });
  rt.texture.generateMipmaps = rtBlur.texture.generateMipmaps = false;

  const group = new THREE.Group();
  group.name = "__contactShadows";
  group.userData.helper = true;

  const planeMat = new THREE.ShaderMaterial({
    uniforms: { tShadow: { value: rt.texture }, uColor: { value: toColor(o.color ?? "#000000") }, uOpacity: { value: num(o.opacity, 0.6) } },
    vertexShader: PLANE_VERT,
    fragmentShader: PLANE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = -10;
  plane.userData.helper = true;
  group.add(plane);

  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  cam.rotation.x = Math.PI / 2; // looks up (+Y)
  group.add(cam);

  // "Darkness = closeness to the plane" depth material.
  const depthMat = new THREE.MeshDepthMaterial({ depthTest: true, depthWrite: true, side: THREE.DoubleSide });
  depthMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "gl_FragColor = vec4( vec3( 0.0 ), pow( clamp( 1.0 - fragCoordZ, 0.0, 1.0 ), 2.2 ) * 1.6 );",
    );
  };
  depthMat.customProgramCacheKey = () => "agent3d-contact-depth";

  const blurMat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: BLUR_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
  const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat);
  blurQuad.frustumCulled = false;
  const blurScene = new THREE.Scene();
  blurScene.add(blurQuad);
  const blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const blurAmount = num(o.blur, 2.5);
  const frames = Math.max(0, Math.round(num(o.frames, 0)));
  let rendered = 0;
  let fitted = false;

  const fit = () => {
    fitted = true;
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    scene.updateMatrixWorld(true);
    for (const child of scene.children) {
      if (child.userData.helper || child === group || (child as THREE.Light).isLight) continue;
      meshBox(child, tmp);
      if (tmp.isEmpty() || tmp.getSize(new THREE.Vector3()).length() > 200) continue;
      box.union(tmp);
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const y = o.y ?? defaultY ?? box.min.y;
    const side = o.size ?? Math.max(size.x, size.z, 0.5) * 2.2 + 0.5;
    const far = o.far ?? Math.max(0.5, Math.min(size.y, side) * 0.9);
    // Centred on the subject (also with an explicit size), or on `center`.
    const c = Array.isArray(o.center) ? o.center : [center.x, center.z];
    group.position.set(c[0], y + 0.001, c[1]);
    plane.scale.set(side, side, 1);
    cam.left = -side / 2;
    cam.right = side / 2;
    cam.top = side / 2;
    cam.bottom = -side / 2;
    cam.near = 0;
    cam.far = far;
    cam.updateProjectionMatrix();
  };

  const blur = (amount: number) => {
    blurMat.uniforms.tDiffuse!.value = rt.texture;
    (blurMat.uniforms.uDir!.value as THREE.Vector2).set(amount / res, 0);
    renderer.setRenderTarget(rtBlur);
    renderer.render(blurScene, blurCam);
    blurMat.uniforms.tDiffuse!.value = rtBlur.texture;
    (blurMat.uniforms.uDir!.value as THREE.Vector2).set(0, amount / res);
    renderer.setRenderTarget(rt);
    renderer.render(blurScene, blurCam);
  };

  ctx.onUpdate(() => {
    if (!fitted) fit();
    if (frames > 0 && rendered >= frames) return;
    rendered++;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((x) => {
      if (x.visible && (x.userData.helper || (x as THREE.Points).isPoints || (x as THREE.Sprite).isSprite)) hidden.push(x);
    });
    for (const x of hidden) x.visible = false;
    const prev = {
      target: renderer.getRenderTarget(),
      bg: scene.background,
      override: scene.overrideMaterial,
      fog: scene.fog,
      clearAlpha: renderer.getClearAlpha(),
      clearColor: renderer.getClearColor(new THREE.Color()),
      shadowAuto: renderer.shadowMap.autoUpdate,
      xr: renderer.xr.enabled,
    };
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = depthMat;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);
    group.updateMatrixWorld(true);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    scene.overrideMaterial = null;
    blur(blurAmount);
    blur(blurAmount * 0.4);
    renderer.setRenderTarget(prev.target);
    renderer.setClearColor(prev.clearColor, prev.clearAlpha);
    renderer.shadowMap.autoUpdate = prev.shadowAuto;
    scene.overrideMaterial = prev.override;
    scene.background = prev.bg;
    scene.fog = prev.fog;
    for (const x of hidden) x.visible = true;
  });

  return {
    object: group,
    dispose() {
      rt.dispose();
      rtBlur.dispose();
      planeMat.dispose();
      depthMat.dispose();
      blurMat.dispose();
      plane.geometry.dispose();
      blurQuad.geometry.dispose();
    },
  };
}

/**
 * World box of the solid meshes under `root` — particles, points, sprites,
 * lines and helpers don't count (a snow / dust system would blow the fit up).
 */
export function meshBox(root: THREE.Object3D, out = new THREE.Box3()): THREE.Box3 {
  out.makeEmpty();
  const tmp = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  const visit = (o: THREE.Object3D) => {
    if (!o.visible || o.userData.helper || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      // This mesh's geometry only (children are visited on their own).
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if ((m as THREE.InstancedMesh).isInstancedMesh) {
        const im = m as THREE.InstancedMesh;
        if (!im.boundingBox) im.computeBoundingBox();
        tmp.copy(im.boundingBox!).applyMatrix4(im.matrixWorld);
      } else tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      out.union(tmp);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return out;
}
