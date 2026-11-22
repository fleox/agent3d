// Mesh gradient (Stripe-like): up to 6 colour points drifting on Lissajous
// paths, blended by inverse-distance weights over a noise-warped domain, plus
// film grain. Shared by the `gradientMesh` catalog shader and the
// `{ "meshGradient": [...] }` background. Needs GLSL_NOISE (snoise).
export const MESH_GRADIENT_GLSL = /* glsl */ `
uniform vec3 uMgColors[6];
uniform int uMgCount;
uniform float uMgScale;
uniform float uMgSeed;
uniform vec2 uMgSpread; // spreads the colour points over wide / tall surfaces
vec3 meshGradient(vec2 p, float t) {
  p /= max(uMgScale, 0.05);
  vec2 w = vec2(snoise(vec3(p * 1.1, t * 0.17 + uMgSeed)), snoise(vec3(p * 1.1 + 7.3, t * 0.17 + uMgSeed + 3.1)));
  p += w * 0.22;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uMgCount) break;
    float fi = float(i) + uMgSeed * 1.37;
    vec2 c = vec2(sin(fi * 2.39996 + 0.4) * 0.62, cos(fi * 3.1199 + 1.1) * 0.48);
    c += 0.3 * vec2(sin(t * (0.31 + 0.07 * fi) + fi * 1.9), cos(t * (0.27 + 0.05 * fi) + fi * 2.7));
    c *= uMgSpread;
    float d2 = dot(p - c, p - c);
    float wt = 1.0 / ((d2 + 0.12) * (d2 + 0.12));
    acc += uMgColors[i] * wt;
    wsum += wt;
  }
  return acc / max(wsum, 1e-5);
}
float mgGrain(vec2 frag, float t) {
  vec3 p = fract(vec3(frag, t * 0.37) * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z) - 0.5;
}
`;
