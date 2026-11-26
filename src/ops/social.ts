// Social video presets (`render --video x.mp4 --preset …`, `export --format
// video --preset …`, the `export` AI tool): frame size, one seamless loop of
// the photo motion, a bitrate social networks keep sharp, and a "cover" fit
// so a 3D photo fills a frame whose aspect differs from the scene's.
//
// Pure (no DOM, no Node): the CLI host reads the images' sizes and renders.

import type { ObjectDef, PhotoObjectDef, SceneDoc, Vec3 } from "../core/types";
import { closest } from "../core/suggest";
import { motionPeriod, motionSettings, photoSize } from "../runtime/build/photoCore";

export interface SocialPreset {
  id: SocialPresetId;
  width: number;
  height: number;
  aspect: string; // "9:16"
  maxDuration?: number; // seconds (stories)
  bitrate: number; // H.264 bits per second
  description: string;
}

export const SOCIAL_PRESET_IDS = ["vertical", "square", "landscape", "story"] as const;
export type SocialPresetId = (typeof SOCIAL_PRESET_IDS)[number];

export const SOCIAL_PRESETS: Record<SocialPresetId, SocialPreset> = {
  vertical: { id: "vertical", width: 1080, height: 1920, aspect: "9:16", bitrate: 10e6, description: "1080×1920 (9:16): Reels, TikTok, Shorts, LinkedIn / Instagram vertical video." },
  square: { id: "square", width: 1080, height: 1080, aspect: "1:1", bitrate: 8e6, description: "1080×1080 (1:1): Instagram / LinkedIn / Facebook feed." },
  landscape: { id: "landscape", width: 1920, height: 1080, aspect: "16:9", bitrate: 10e6, description: "1920×1080 (16:9): YouTube, LinkedIn, X, websites." },
  story: { id: "story", width: 1080, height: 1920, aspect: "9:16", maxDuration: 15, bitrate: 10e6, description: "1080×1920 (9:16), at most 15 s: Instagram / Facebook stories." },
};

export const SOCIAL_FPS = 30;

export function parseSocialPreset(name: string): SocialPreset | { error: string; hint: string } {
  const id = name.trim().toLowerCase();
  if ((SOCIAL_PRESET_IDS as readonly string[]).includes(id)) return SOCIAL_PRESETS[id as SocialPresetId];
  const s = closest(id, SOCIAL_PRESET_IDS);
  return { error: `Unknown video preset "${name}".`, hint: `${s ? `Did you mean "${s}"? ` : ""}Use ${SOCIAL_PRESET_IDS.join(", ")} (${SOCIAL_PRESET_IDS.map((p) => `${p} ${SOCIAL_PRESETS[p].width}x${SOCIAL_PRESETS[p].height}`).join(", ")}).` };
}

// Photo objects at the top level of the scene (motion and cover apply to them).
function photos(scene: SceneDoc): PhotoObjectDef[] {
  return (scene.objects ?? []).filter((o: ObjectDef): o is PhotoObjectDef => o.kind === "photo");
}

// Default length of a social video: one seamless loop of the first moving
// photo (start: orbit loops from its second cycle), else the timeline, else 5 s.
export function socialDuration(scene: SceneDoc, preset?: SocialPreset): { duration: number; start: number; source: string } {
  let out: { duration: number; start: number; source: string } | null = null;
  for (const p of photos(scene)) {
    const s = motionSettings(p.motion);
    if (s.progress !== null) continue; // driven by the timeline
    const m = motionPeriod(s);
    if (m.duration > 0) {
      out = { ...m, source: `one ${s.loop ? "loop" : "move"} of "${p.id}" (motion.auto "${s.auto}")` };
      break;
    }
  }
  const tl = scene.timeline?.duration;
  out ??= tl && tl > 0 ? { duration: tl, start: 0, source: "the timeline duration" } : { duration: 5, start: 0, source: "default 5 s" };
  if (preset?.maxDuration && out.duration > preset.maxDuration) out = { ...out, duration: preset.maxDuration, source: `${out.source}, capped to ${preset.maxDuration} s (${preset.id})` };
  return { ...out, duration: Math.round(out.duration * 1000) / 1000 };
}

const DEG = Math.PI / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export interface CoverResult {
  scene: SceneDoc;
  // How much the view was tightened (1 = untouched) and what was done.
  zoom: number;
  notes: string[];
}

// "Cover" fit for a frame of `aspect` (W / H): the scene is rendered at that
// aspect (target.aspect → the runtime keeps the vertical field of view, the
// sides are cropped), then the camera is tightened (fov / zoom) until every
// top-level photo facing the camera fills the frame — with a margin for
// mesh-mode tilts. `imageSize(src)` gives each photo's pixel size (null:
// unknown, the photo is skipped). Pure.
export function coverScene(scene: SceneDoc, aspect: number, imageSize: (src: string) => { width: number; height: number } | null): CoverResult {
  const notes: string[] = [];
  const out: SceneDoc = { ...scene, target: { ...scene.target, aspect: aspectString(aspect) }, camera: { ...scene.camera } };
  const cam = out.camera;
  const design = parseAspect(scene.target?.aspect);
  if (design && Math.abs(design - aspect) > 0.01) notes.push(`The scene (${scene.target?.aspect}) is cropped to ${aspectString(aspect)}: content near the ${aspect < design ? "left and right" : "top and bottom"} edges is cut — look at the frames.`);
  const C = cam.position;
  const T = cam.target ?? [0, 0, 0];
  const f = norm(sub(T, C));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const ortho = cam.type === "orthographic";
  const tanY = ortho ? 0 : Math.tan(((cam.fov ?? 45) * DEG) / 2);
  const halfH = ortho ? (cam.zoom ?? 10) / 2 : 0;
  let need = 1;
  for (const p of photos(scene)) {
    const rot = p.rotation ?? [0, 0, 0];
    if (rot.some((a) => Math.abs(a) > 0.5) || Math.abs(f[2]) < 0.97) {
      notes.push(`"${p.id}" is not facing the camera head-on: cover fit skipped for it.`);
      continue;
    }
    const img = imageSize(p.src);
    if (!img) {
      notes.push(`"${p.id}": unknown image size (${p.src}): cover fit skipped for it.`);
      continue;
    }
    const size = photoSize(p, img.width, img.height);
    const sc = p.scale ?? 1;
    const [sx, sy] = typeof sc === "number" ? [sc, sc] : [sc[0], sc[1]];
    const pos = p.position ?? [0, 0, 0];
    const hw = (size.width * Math.abs(sx)) / 2, hh = (size.height * Math.abs(sy)) / 2;
    // Mesh mode tilts the photo (± strength * 8°): keep a margin.
    const margin = p.mode === "mesh" ? 1.06 : 1.01;
    // Where the view axis and the frame corners meet the photo plane.
    const dist = ortho ? 1 : (pos[2] - C[2]) / f[2];
    if (!(dist > 0)) continue;
    const center: [number, number] = [C[0] + f[0] * dist, C[1] + f[1] * dist];
    const ex = ortho ? halfH * aspect : tanY * aspect * dist, ey = ortho ? halfH : tanY * dist;
    // Frame half extents along x / y (the camera's right / up projected on the plane).
    const fx = Math.abs(r[0]) * ex + Math.abs(u[0]) * ey, fy = Math.abs(r[1]) * ex + Math.abs(u[1]) * ey;
    const roomX = Math.min(pos[0] + hw - center[0], center[0] - (pos[0] - hw));
    const roomY = Math.min(pos[1] + hh - center[1], center[1] - (pos[1] - hh));
    if (roomX <= 0 || roomY <= 0) {
      notes.push(`"${p.id}" is off the view centre: cover fit skipped for it.`);
      continue;
    }
    need = Math.max(need, (fx * margin) / roomX, (fy * margin) / roomY);
  }
  if (need > 1.0001) {
    if (ortho) cam.zoom = ((cam.zoom ?? 10) / need);
    else cam.fov = (2 * Math.atan(tanY / need)) / DEG;
    notes.push(`Camera tightened ${need.toFixed(2)}× (${ortho ? `zoom ${cam.zoom!.toFixed(2)}` : `fov ${cam.fov!.toFixed(1)}°`}) so the photo covers the ${aspectString(aspect)} frame (no edges).`);
    if (cam.shots?.length || cam.controls === "scroll") notes.push("Camera shots / scroll paths keep their own fov: check the frames.");
  }
  return { scene: out, zoom: need, notes };
}

function parseAspect(a: string | undefined): number | undefined {
  const m = /^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/.exec(a ?? "");
  const v = m ? Number(m[1]) / Number(m[2]) : undefined;
  return v && Number.isFinite(v) && v > 0 ? v : undefined;
}

function aspectString(a: number): string {
  for (const [w, h] of [[9, 16], [1, 1], [16, 9], [4, 5], [4, 3], [3, 4], [21, 9], [4, 1], [3, 1], [2, 1]]) if (Math.abs(a - w / h) < 0.005) return `${w}:${h}`;
  return `${Math.round(a * 1000)}:1000`;
}

// Pixel size from an image's header (PNG, JPEG, WebP); null when unknown.
export function imageHeaderSize(b: Uint8Array): { width: number; height: number } | null {
  const be16 = (i: number) => (b[i] << 8) | b[i + 1];
  const be32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: be32(16), height: be32(20) };
  if (b.length >= 30 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...b.subarray(12, 16));
    if (kind === "VP8 " && b.length >= 30) return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (kind === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X" && b.length >= 30) return { width: le24(24) + 1, height: le24(27) + 1 };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = be16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: be16(i + 7), height: be16(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}
