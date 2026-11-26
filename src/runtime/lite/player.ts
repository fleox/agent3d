// Photo-only lite player (dist/runtime/agent3d-photo.js): renders a scene that
// is exactly one 3D photo (src/ops/liteRuntime.ts liteRuntimeEligibility) with
// raw WebGL2 — no Three.js. One full-canvas triangle: each fragment casts the
// scene camera's ray onto the photo plane (perspective fov / position /
// target, responsive fov fit, the photo's position / size / scale), maps it to
// photo UV and runs the same relief-mapping shader as the full runtime
// (../build/photoCore.ts PARALLAX_GLSL) with the same uniforms, march steps,
// texture setup (sRGB map with mipmaps + 4× anisotropy, linear depth, mirrored
// wrap) and output (sRGB, no tone mapping, normal blending over the
// background colour). Same player rules as ../player.ts: lazy start, pause
// off-screen / hidden tab, reduced motion, DPR cap per quality tier (and the
// "auto" DPR step-down), deterministic seek, simulated pointer / scroll input.

import { resolveQualityTier, TIER_DPR_CAP, type QualityTier } from "../../core/qualityTier";
import type { PhotoObjectDef, SceneDoc } from "../../core/types";
import type { FrameStats, InspectResult, MountOptions, Player, RuntimeIssue } from "../api";
import { createResolver } from "../assetResolver";
import { designAspectOf, fitScale, fittedFov, nudgeOffPlanes } from "../build/cameraFit";
import { PARALLAX_GLSL, PARALLAX_WALL_SLOPE, PHOTO_COMMON_GLSL, PHOTO_DEFAULTS, createPhotoMotion, motionSettings, parallaxParams, parallaxSteps, photoSize, type PhotoMotion } from "../build/photoCore";
import { DEG, clamp, num } from "../num";

const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG_HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;
const FLAT_TEXEL = /* glsl */ `
vec4 photoTexel(vec2 uv) { return texture(uMap, uv); }
`;
const PARALLAX_TEXEL = /* glsl */ `
vec4 photoTexel(vec2 uv) { return parallaxTexel(uv); }
`;
// uO: camera position in photo space (x / y in photo widths / heights, z in
// world units); uF / uR / uU: the view direction at NDC (0,0) and its change
// per NDC unit, in the same space; t along the ray = view depth (near / far
// clip). Coverage of the photo edge is analytic (the full runtime gets MSAA).
// Output = three.js NormalBlending of the sRGB-encoded photo over uBg
// (premultiplied: opaque colour, or 0 on a transparent canvas).
const FRAG_MAIN = /* glsl */ `
uniform vec3 uO;
uniform vec3 uF;
uniform vec3 uR;
uniform vec3 uU;
uniform vec2 uClip;
uniform vec4 uBg;
uniform float uBlend;
in vec2 vNdc;
out vec4 fragColor;
vec3 toSrgb(vec3 v) {
  return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308))));
}
void main() {
  vec3 d = uF + uR * vNdc.x + uU * vNdc.y;
  float t = d.z < 0.0 ? -uO.z / d.z : -1.0;
  vec2 uv = uO.xy + t * d.xy + 0.5;
  // derivatives / texture fetches stay in uniform control flow
  vec2 fw = max(fwidth(uv), vec2(1e-7));
  vec4 c = photoTexel(uv);
  vec2 e = min(uv, 1.0 - uv) / fw;
  float cover = uO.z > 0.0 && t >= uClip.x && t <= uClip.y ? clamp(min(e.x, e.y) + 0.5, 0.0, 1.0) : 0.0;
  vec4 s = shade(c, 1.0);
  float a = c.a * uOpacity < 0.004 ? 0.0 : uBlend > 0.5 ? s.a : 1.0;
  vec4 photo = vec4(toSrgb(s.rgb) * a, a) + uBg * (1.0 - a);
  fragColor = mix(uBg, photo, cover);
}
`;

export const photoFragment = (flat: boolean, steps: number): string =>
  FRAG_HEAD + PHOTO_COMMON_GLSL + (flat ? FLAT_TEXEL : PARALLAX_GLSL.replace("__STEPS__", String(steps)) + PARALLAX_TEXEL) + FRAG_MAIN;

const UNIFORMS = ["uMap", "uDepth", "uTint", "uOpacity", "uIntensity", "uView", "uZoom", "uMaxOffset", "uInset", "uFocus", "uWallSlope", "uO", "uF", "uR", "uU", "uClip", "uBg", "uBlend"] as const;

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// "#rgb" / "#rrggbb" → sRGB 0..1 (eligible scenes only use hex colours).
export function hexColor(c: string | undefined, fallback: Vec3): Vec3 {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c ?? "");
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Vec3;
}
const toLinear = (c: number) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));

// The camera of a perspective SceneDoc for a canvas aspect: position (nudged
// off authored planes), right / up / forward basis (three.js lookAt), fov
// fitted to target.aspect. Mirrors build/camera.ts.
export function cameraBasis(scene: SceneDoc, aspect: number): { pos: Vec3; right: Vec3; up: Vec3; fwd: Vec3; tanY: number; near: number; far: number } {
  const cam = scene.camera;
  const tgt = (cam.target ?? [0, 0, 0]) as Vec3;
  const p = { x: cam.position[0], y: cam.position[1], z: cam.position[2], set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  nudgeOffPlanes(p, { x: tgt[0], y: tgt[1], z: tgt[2] });
  const pos: Vec3 = [p.x, p.y, p.z];
  // three.js Matrix4.lookAt(eye, target, up (0,1,0)) for cameras: z = eye - target.
  let z = sub(pos, tgt);
  if (Math.hypot(...z) === 0) z = [0, 0, 1];
  z = norm(z);
  let x = cross([0, 1, 0], z);
  if (Math.hypot(...x) === 0) {
    z = norm([z[0], z[1], z[2] + 0.0001]);
    x = cross([0, 1, 0], z);
  }
  x = norm(x);
  const y = cross(z, x);
  const fov = fittedFov(num(cam.fov, 45), fitScale(aspect, designAspectOf(scene.target?.aspect)));
  return { pos, right: x, up: y, fwd: [-z[0], -z[1], -z[2]], tanY: Math.tan((fov * DEG) / 2), near: num(cam.near, 0.1), far: num(cam.far, 1000) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`Cannot load texture ${url}`));
    img.src = url;
  });
}

type Images = { map: HTMLImageElement | null; depth: HTMLImageElement | null };

// Closure-style on purpose: local names minify, class members do not (size).
export function mountPhotoScene(container: HTMLElement, initial: SceneDoc, options: MountOptions = {}): Player {
  let scene = initial;
  const deterministic = !!options.deterministic;
  const resolve = createResolver(options);
  let readyResolve!: () => void;
  let readyReject!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => ((readyResolve = res), (readyReject = rej)));
  ready.catch(() => undefined);
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const canvas = doc.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;touch-action:manipulation;";
  const cpos = win.getComputedStyle(container).position;
  if (!cpos || cpos === "static") container.style.position = "relative";
  container.appendChild(canvas);

  let gl: WebGL2RenderingContext | null = null;
  let prog: WebGLProgram | null = null;
  const loc: Partial<Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>> = {};
  let textures: WebGLTexture[] = [];
  let images: Images | null = null;
  let motion: PhotoMotion | null = null;
  let size: [number, number] = [1, 1];
  let tier: QualityTier = "high";
  let qualityAuto = false;
  let dpr = 1;
  const pointer = { x: 0, y: 0, inside: false };
  let scrollOverride: number | null = null;
  let t = 0, raf = 0, lastNow = 0, fps = 0, perfClock = 0, slowFor = 0;
  let playing = false, visible = true, started = false, disposed = false, readyCalled = false;
  let staticMotion = false, timeScale = 1;
  let width = 1, height = 1;
  let building: Promise<void> | null = null;
  let cleanups: (() => void)[] = [];
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  const targetOf = () => scene.target ?? ({} as SceneDoc["target"]);
  const photo = () => scene.objects[0] as PhotoObjectDef;

  const report = (issue: RuntimeIssue) => {
    try {
      options.onError?.(issue);
    } catch {
      /* user callback */
    }
    if (!options.onError) console.warn(`[agent3d] ${issue.code}: ${issue.message}`);
  };
  const listen = (target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  const measure = () => {
    const w = Math.max(1, container.clientWidth || canvas.clientWidth || 300);
    width = w;
    height = Math.max(1, container.clientHeight || Math.round(w / (designAspectOf(scene.target?.aspect) ?? 16 / 9)));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  };

  const scrollValue = () => {
    if (scrollOverride !== null) return scrollOverride;
    if (deterministic || staticMotion) return clamp(t / 4, 0, 1);
    const r = container.getBoundingClientRect();
    const vh = win.innerHeight || 1;
    return clamp((vh - r.top) / (vh + r.height), 0, 1);
  };

  const draw = (off?: { x: number; y: number; zoom: number }) => {
    if (!gl) return;
    const L = loc;
    const bgDef = scene.environment?.background;
    const bg: [number, number, number, number] = targetOf().transparent ? [0, 0, 0, 0] : [...hexColor(typeof bgDef === "string" ? bgDef : undefined, [0, 0, 0]), 1];
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (!prog) {
      gl.clearColor(...bg);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    gl.useProgram(prog);
    if (off) {
      gl.uniform2f(L.uView!, off.x, off.y);
      gl.uniform1f(L.uZoom!, off.zoom);
    }
    const def = photo();
    const aspect = width / Math.max(height, 1);
    const c = cameraBasis(scene, aspect);
    const p = (def.position ?? [0, 0, 0]) as Vec3;
    const sc = def.scale ?? 1;
    const W = size[0] * (typeof sc === "number" ? sc : sc[0]);
    const H = size[1] * (typeof sc === "number" ? sc : sc[1]);
    const local = (v: Vec3, k: number): Vec3 => [(v[0] * k) / W, (v[1] * k) / H, v[2] * k];
    gl.uniform3f(L.uO!, (c.pos[0] - p[0]) / W, (c.pos[1] - p[1]) / H, c.pos[2] - p[2]);
    gl.uniform3f(L.uF!, ...local(c.fwd, 1));
    gl.uniform3f(L.uR!, ...local(c.right, c.tanY * aspect));
    gl.uniform3f(L.uU!, ...local(c.up, c.tanY));
    gl.uniform2f(L.uClip!, c.near, c.far);
    gl.uniform4f(L.uBg!, ...bg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const frame = (dt: number) => {
    if (gl && motion) draw(motion.offset(t, dt, { pointer, scroll: scrollValue(), reduced: staticMotion }));
  };

  const resize = () => {
    if (!gl) return;
    measure();
    if (!raf || deterministic) draw();
  };

  // "auto" quality: below 40 fps for 3 s (after a 2 s warm-up) → pixel ratio ×0.75, down to 1 (../player.ts).
  const adaptQuality = (dt: number) => {
    perfClock += dt;
    if (perfClock < 2) return;
    if (fps < 40) slowFor += dt;
    else slowFor = Math.max(0, slowFor - dt);
    if (slowFor < 3) return;
    slowFor = perfClock = 0;
    if (options.pixelRatio === undefined && dpr > 1.01) {
      dpr = Math.max(1, dpr * 0.75);
      resize();
    } else qualityAuto = false;
  };

  const updateRunning = () => {
    const hidden = doc.visibilityState === "hidden";
    const run = playing && !disposed && !hidden && (visible || targetOf().pauseOffscreen === false) && !!motion;
    if (run && !raf) {
      lastNow = performance.now();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(Math.max((now - lastNow) / 1000, 0), 0.1);
        lastNow = now;
        if (dt > 0.002) fps = fps ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
        if (qualityAuto) adaptQuality(dt);
        t = Math.max(t + dt * timeScale, 0);
        frame(dt * timeScale);
      };
      raf = requestAnimationFrame(loop);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  // Quality tier → march steps and pixel ratio (same heuristics as ../player.ts).
  const configure = (g: WebGL2RenderingContext) => {
    const target = targetOf();
    const nav = (globalThis.navigator ?? {}) as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    let gpu: string | undefined;
    try {
      const ext = g.getExtension("WEBGL_debug_renderer_info");
      gpu = String(g.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : g.RENDERER) ?? "");
    } catch {
      /* not exposed */
    }
    tier = resolveQualityTier(target.quality, { deterministic, mobile: nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(nav.userAgent ?? ""), cores: nav.hardwareConcurrency, memoryGb: nav.deviceMemory, gpu });
    qualityAuto = (target.quality ?? "auto") === "auto" && !deterministic;
    perfClock = slowFor = 0;
    dpr = options.pixelRatio ?? Math.min(globalThis.devicePixelRatio || 1, target.maxDpr ?? 2, TIER_DPR_CAP[tier]);
    measure();
  };

  const loadImages = async (): Promise<Images> => {
    const def = photo();
    let total = 0, done = 0;
    const load = (path: string, what: string, at: string) => {
      const p = loadImage(resolve(path));
      if (options.onProgress) {
        total++;
        const tick = () => {
          try {
            options.onProgress?.(++done, total);
          } catch {
            /* user callback */
          }
        };
        p.then(tick, tick);
      }
      return p.catch((err: Error) => {
        report({ code: "asset-load", message: `${def.id}: ${what}${err.message}${at ? " — showing the photo flat" : ""}`, path: `objects#${def.id}${at}` });
        return null;
      });
    };
    const [map, depth] = await Promise.all([load(def.src, "", ""), def.depth ? load(def.depth, "depth map: ", ".depth") : null]);
    return { map, depth };
  };

  const teardown = () => {
    if (!gl) return;
    for (const tex of textures) gl.deleteTexture(tex);
    textures = [];
    if (prog) gl.deleteProgram(prog);
    prog = null;
  };

  const build = async () => {
    images ??= await loadImages();
    if (disposed || !gl) return;
    const g = gl;
    configure(g);
    motion?.dispose();
    const def = photo();
    const { map, depth } = images;
    const flat = !depth;
    motion = createPhotoMotion(motionSettings(def.motion), { live: !deterministic, flat });
    if (!map) return; // the object failed to load: background only (like the full runtime)
    const strength = clamp(num(def.strength, PHOTO_DEFAULTS.strength), 0, 1);
    const program = g.createProgram()!;
    const attach = (type: number, src: string) => {
      const sh = g.createShader(type)!;
      g.shaderSource(sh, src);
      g.compileShader(sh);
      if (!g.getShaderParameter(sh, g.COMPILE_STATUS) && !g.isContextLost()) throw new Error(`photo shader: ${g.getShaderInfoLog(sh)}`);
      g.attachShader(program, sh);
    };
    attach(g.VERTEX_SHADER, VERT);
    attach(g.FRAGMENT_SHADER, photoFragment(flat, parallaxSteps(tier, strength)));
    g.bindAttribLocation(program, 0, "aPos");
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS) && !g.isContextLost()) throw new Error(`photo shader: ${g.getProgramInfoLog(program)}`);
    prog = program;
    for (const u of UNIFORMS) loc[u] = g.getUniformLocation(program, u);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    // Textures: three.js upload rules (flipY, no premultiply, no colour-space conversion).
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
    const texture = (unit: number, img: HTMLImageElement, srgb: boolean) => {
      const tex = g.createTexture()!;
      textures.push(tex);
      g.activeTexture(g.TEXTURE0 + unit);
      g.bindTexture(g.TEXTURE_2D, tex);
      g.texImage2D(g.TEXTURE_2D, 0, srgb ? g.SRGB8_ALPHA8 : g.RGBA8, g.RGBA, g.UNSIGNED_BYTE, img);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.MIRRORED_REPEAT);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.MIRRORED_REPEAT);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, srgb ? g.LINEAR_MIPMAP_LINEAR : g.LINEAR);
      if (srgb) {
        g.generateMipmap(g.TEXTURE_2D);
        const an = g.getExtension("EXT_texture_filter_anisotropic");
        if (an) g.texParameterf(g.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, g.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      }
    };
    texture(0, map, true);
    if (depth) texture(1, depth, false);
    g.useProgram(program);
    const L = loc;
    g.uniform1i(L.uMap!, 0);
    g.uniform1i(L.uDepth!, 1);
    const m = def.material ?? {};
    const tint = hexColor(m.color, [1, 1, 1]).map(toLinear);
    g.uniform3f(L.uTint!, tint[0], tint[1], tint[2]);
    const opacity = clamp(num(m.opacity, 1), 0, 1);
    g.uniform1f(L.uOpacity!, opacity);
    g.uniform1f(L.uIntensity!, Math.max(0, num(m.emissiveIntensity, 1)));
    g.uniform1f(L.uBlend!, opacity < 1 || /\.(png|webp)$/i.test(def.src) ? 1 : 0);
    const ps = photoSize(def, map.naturalWidth || map.width || 1, map.naturalHeight || map.height || 1);
    const pp = parallaxParams(strength, ps.width, ps.height);
    g.uniform2f(L.uMaxOffset!, ...pp.maxOffset);
    g.uniform2f(L.uInset!, ...pp.inset);
    g.uniform1f(L.uFocus!, clamp(num(def.focus, PHOTO_DEFAULTS.focus), 0, 1));
    g.uniform1f(L.uWallSlope!, PARALLAX_WALL_SLOPE);
    size = [ps.width, ps.height];
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    const target = targetOf();
    gl = canvas.getContext("webgl2", { alpha: !!target.transparent, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: "high-performance", preserveDrawingBuffer: deterministic });
    if (!gl) {
      report({ code: "webgl-unavailable", message: "WebGL is not available: no WebGL2 context" });
      readyReject(new Error("webgl-unavailable"));
      return;
    }
    building = build()
      .then(() => {
        if (disposed) return;
        t = deterministic ? 0 : staticMotion ? (target.posterTime ?? 0) : t;
        frame(0);
        if (!deterministic && !staticMotion) {
          playing = true;
          updateRunning();
        }
        readyResolve();
        if (!readyCalled) options.onReady?.(player);
        readyCalled = true;
      })
      .catch((err: Error) => {
        report({ code: "build-error", message: err.message });
        readyReject(err);
      });
  };

  const setScrollProgress = (progress: number | null) => {
    scrollOverride = progress === null || !Number.isFinite(progress) ? null : clamp(progress, 0, 1);
  };
  const movePointer = (x?: number, y?: number) => {
    if (x !== undefined && y !== undefined) (pointer.x = x), (pointer.y = y);
    pointer.inside = true;
  };
  const noop = () => undefined;

  const player: Player = {
    get scene() {
      return scene;
    },
    canvas,
    ready,
    input: { pointer: movePointer, key: noop, click: movePointer, down: movePointer, up: noop, swipe: noop, scroll: setScrollProgress },
    play() {
      playing = true;
      start();
      updateRunning();
    },
    pause() {
      playing = false;
      updateRunning();
    },
    async seek(to: number) {
      if (!started) start();
      await building;
      if (!gl || !motion) return;
      const target = Math.max(0, to);
      if (target < t - 1e-9) {
        t = 0;
        motion.offset(0, 0, { pointer, scroll: 0, reduced: staticMotion });
      }
      const dt = target - t;
      t = target;
      frame(dt);
    },
    time: () => t,
    async update(next: SceneDoc) {
      await building;
      if (JSON.stringify(next.objects[0]) !== JSON.stringify(scene.objects[0])) images = null;
      scene = next;
      if (!gl) return;
      teardown();
      building = build();
      await building;
      frame(0);
    },
    resize,
    stats: (): FrameStats => ({ triangles: prog ? 1 : 0, drawCalls: prog ? 1 : 0, geometries: prog ? 1 : 0, textures: textures.length, fps: deterministic ? undefined : Math.round(fps) || undefined }),
    inspect: (): InspectResult => ({ objects: [], camera: { position: [...scene.camera.position], target: [...(scene.camera.target ?? [0, 0, 0])] } }),
    snapshot(type = "image/png", quality?: number) {
      draw();
      return canvas.toDataURL(type, quality);
    },
    state: () => ({}),
    pick: () => null,
    emit(name: string, payload?: unknown) {
      for (const h of [...(listeners.get(name) ?? [])]) {
        try {
          h(payload);
        } catch {
          /* user callback */
        }
      }
      try {
        options.onEvent?.(name, payload);
      } catch {
        /* user callback */
      }
    },
    on(name: string, handler: (payload?: unknown) => void) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(handler);
      return () => set!.delete(handler);
    },
    setScrollProgress,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const c of cleanups) c();
      cleanups = [];
      motion?.dispose();
      teardown();
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
      canvas.remove();
    },
  };

  // Pointer (same convention as ../input.ts: -1..1 over the container, y up).
  listen(container, "pointermove", (e) => {
    const r = container.getBoundingClientRect();
    const pe = e as PointerEvent;
    movePointer(((pe.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, -(((pe.clientY - r.top) / Math.max(r.height, 1)) * 2 - 1));
  });
  listen(container, "pointerenter", () => (pointer.inside = true));
  listen(container, "pointerleave", () => (pointer.inside = false));
  listen(doc, "visibilitychange", updateRunning);
  measure();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    cleanups.push(() => ro.disconnect());
  }
  // Reduced motion (target.reducedMotion, default "static": a still at posterTime).
  const target = targetOf();
  const prefers = options.reducedMotion ?? (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const rm = target.reducedMotion ?? "static";
  if (prefers && !deterministic) {
    if (rm === "static") staticMotion = true;
    else if (rm === "slow") timeScale = 0.5;
  }
  // Lazy start: IntersectionObserver (200 px margin) + the safety net of ../player.ts armStartFallback.
  if (deterministic || target.lazy === false || typeof IntersectionObserver === "undefined") start();
  else {
    visible = false;
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) start();
        updateRunning();
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(container);
    const check = () => {
      if (started || disposed || doc.visibilityState === "hidden" || !container.isConnected) return;
      const r = container.getBoundingClientRect();
      const vh = win.innerHeight || doc.documentElement.clientHeight;
      const vw = win.innerWidth || doc.documentElement.clientWidth;
      if (!(r.bottom >= -200 && r.top <= vh + 200 && r.right >= 0 && r.left <= vw && (r.width > 0 || r.height > 0))) return;
      visible = true;
      start();
      updateRunning();
    };
    const timers = [setTimeout(check, 500), setTimeout(check, 2000)];
    let fr = win.requestAnimationFrame(() => (fr = win.requestAnimationFrame(check)));
    listen(win, "load", check);
    listen(win, "scroll", check, { passive: true });
    listen(doc, "visibilitychange", check);
    cleanups.push(() => {
      io.disconnect();
      for (const tm of timers) clearTimeout(tm);
      win.cancelAnimationFrame(fr);
    });
  }
  if (canvas.isConnected) resize();
  return player;
}
