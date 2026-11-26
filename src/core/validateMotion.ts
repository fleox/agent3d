// Validation of everything that moves: timeline (tracks, easing, relative
// values, stagger selectors, markers, segments, scroll range), interactions,
// camera shots / shake / lookAt, model animation blend + morph targets.
// Called by validateScene (src/core/validate.ts) once every id is declared.

import { CATALOG } from "./catalog";
import { isValidColor } from "./color";
import { EASE_EXAMPLES, EASE_NAMES, parseEase } from "./ease";
import { closest, didYouMean, listOptions } from "./suggest";
import { PHOTO_EFFECTS, PHOTO_EFFECT_IDS, type PhotoEffectId } from "./photoEffects";
import { expandPostFx } from "./postfx";
import type { Issue, PostFxDef } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const show = (v: unknown) => {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

export const TIMELINE_KEYS = ["duration", "loop", "autoplay", "trigger", "speed", "markers", "segments", "scroll", "tracks"];
export const TRACK_KEYS = ["target", "keys", "ease", "stagger", "staggerFrom", "colorSpace"];
export const COLOR_SPACES = ["oklch", "oklab", "rgb", "hsl"] as const;
export const STAGGER_FROM = ["start", "end", "center", "edges", "random"] as const;
export const INTERACTION_ON = ["click", "hover", "hoverEnd", "visible", "scroll", "key", "event"] as const;
export const INTERACTION_ACTIONS = ["play", "toggle", "seek", "set", "emit", "openUrl", "playClip"] as const;
export const SHOT_TYPES = ["dolly", "pushIn", "pullOut", "truck", "pedestal", "crane", "orbit", "zoom", "move", "path", "lookAt", "focus"] as const;
const SHOT_KEYS = ["type", "at", "duration", "ease", "distance", "height", "angle", "elevation", "fov", "position", "target", "points", "lookAhead", "lookAt", "object", "focus"];

// Animatable track properties.
const VEC3_PROPS = ["position", "rotation", "scale"];
const AXIS = ["x", "y", "z"];
const MATERIAL_TRACK_PROPS: Record<string, "number" | "color" | "boolean"> = {
  opacity: "number",
  color: "color",
  emissive: "color",
  emissiveIntensity: "number",
  metalness: "number",
  roughness: "number",
  transmission: "number",
  thickness: "number",
  ior: "number",
  iridescence: "number",
  iridescenceIOR: "number",
  clearcoat: "number",
  clearcoatRoughness: "number",
  sheen: "number",
  sheenColor: "color",
  sheenRoughness: "number",
  specularIntensity: "number",
  specularColor: "color",
  envMapIntensity: "number",
  attenuationColor: "color",
  attenuationDistance: "number",
  dispersion: "number",
  anisotropy: "number",
  anisotropyRotation: "number",
  wireframe: "boolean",
};
const CAMERA_TRACK_PROPS: Record<string, "vec3" | "number"> = { position: "vec3", target: "vec3", fov: "number", zoom: "number", focus: "number" };
const LIGHT_TRACK_PROPS: Record<string, "vec3" | "number" | "color" | "boolean"> = {
  intensity: "number",
  color: "color",
  position: "vec3",
  target: "vec3",
  visible: "boolean",
  angle: "number",
  penumbra: "number",
  distance: "number",
  decay: "number",
  groundColor: "color",
  width: "number",
  height: "number",
};
const ENV_TRACK_PROPS: Record<string, "number" | "color"> = {
  "fog.color": "color",
  "fog.near": "number",
  "fog.far": "number",
  "fog.density": "number",
  lightingIntensity: "number",
  exposure: "number",
  background: "color",
};

type ValueKind = "vec3" | "vec2" | "number" | "color" | "boolean" | "number|vec3";

// What the timeline validator needs to know about the scene.
export interface MotionIds {
  objects: Set<string>;
  lights: Set<string>;
  tags?: Set<string>;
  models?: Set<string>;
  photos?: Set<string>; // photo objects ("<id>.motion.progress" targets)
  parents?: Set<string>; // ids with children
  postfx?: Set<string>; // post effect types present in scene.postfx
  letters?: Set<string>; // text ids split into letters ("<id>/<n>" targets)
  letterCounts?: Map<string, number>; // letters of those texts (non-space characters; absent when the text has {data.*} placeholders)
  photoEffects?: Map<string, Set<string>>; // 3D photo ids → the effects they declare ("<id>.effects.<effect>.<param>" targets)
}

const REL = /^\s*[+\-*]=\s*-?\d*\.?\d+(?:e[+-]?\d+)?\s*$/i;
const isRel = (v: unknown) => typeof v === "string" && REL.test(v);

// Resolves a track target to the kind of value its keys must hold.
export function trackValueKind(target: string, ids: MotionIds): { kind?: ValueKind; error?: { message: string; hint: string }; warning?: { message: string; hint: string } } {
  const dot = target.indexOf(".");
  if (dot < 1) return { error: { message: `Track target "${target}" must be "<id>.<property>".`, hint: 'Examples: "logo.position", "logo.rotation.y", "logo.material.opacity", "camera.position", "key.intensity", "tag:letter.position.y".' } };
  const head = target.slice(0, dot);
  const prop = target.slice(dot + 1);
  if (head === "camera") {
    const k = CAMERA_TRACK_PROPS[prop];
    if (/^(position|target)\.[xyz]$/.test(prop)) return { kind: "number" };
    if (!k) return { error: { message: `Camera property "${prop}" is not animatable.`, hint: `${didYouMean(prop, Object.keys(CAMERA_TRACK_PROPS))}Use one of: ${listOptions(Object.keys(CAMERA_TRACK_PROPS))} (or position.x …).` } };
    return { kind: k };
  }
  if (head === "environment") {
    const k = ENV_TRACK_PROPS[prop];
    if (!k) return { error: { message: `Environment property "${prop}" is not animatable.`, hint: `${didYouMean(prop, Object.keys(ENV_TRACK_PROPS))}Use one of: ${listOptions(Object.keys(ENV_TRACK_PROPS))}.` } };
    return { kind: k };
  }
  if (head === "postfx") {
    const [type, param, ...more] = prop.split(".");
    const entry = CATALOG.postfx.find((p) => p.id === type);
    if (!entry || !param || more.length) return { error: { message: `Post effect track "${target}" must be "postfx.<type>.<param>".`, hint: `${type ? didYouMean(type, CATALOG.postfx.map((p) => p.id)) : ""}Example: "postfx.bloom.strength", "postfx.dof.focus".` } };
    if (ids.postfx && !ids.postfx.has(type)) return { error: { message: `"${target}" animates post effect "${type}", which is not in scene.postfx (nor brought by a look preset).`, hint: `Add { "type": "${type}" } to postfx first (or a look that includes it — see agent3d catalog postfx look).` } };
    const spec = entry.params.find((p) => p.name === param);
    if (!spec || (spec.type !== "number" && spec.type !== "integer" && spec.type !== "color")) {
      const ok = entry.params.filter((p) => p.type === "number" || p.type === "integer" || p.type === "color").map((p) => p.name);
      return { error: { message: `Parameter "${param}" of post effect "${type}" is not animatable.`, hint: `${didYouMean(param, ok)}Animatable: ${listOptions(ok)}.` } };
    }
    return { kind: spec.type === "color" ? "color" : "number" };
  }
  // Multi-target selectors.
  let heads: string[];
  if (head.startsWith("tag:")) {
    const tag = head.slice(4);
    if (ids.tags && !ids.tags.has(tag)) return { error: { message: `No object has the tag "${tag}" (selector "${head}").`, hint: `${didYouMean(tag, ids.tags)}Add "tags": ["${tag}"] to the objects to animate.` } };
    heads = [];
  } else if (head.startsWith("children:")) {
    const id = head.slice(9);
    if (!ids.objects.has(id)) return { error: { message: `Selector "${head}" refers to "${id}", which is not an object id.`, hint: `${didYouMean(id, ids.objects)}Use "children:<group id>".` } };
    if (ids.parents && !ids.parents.has(id)) return { error: { message: `"${id}" has no children (selector "${head}").`, hint: "Use children:<id> on a group with children (text letters count too)." } };
    heads = [];
  } else heads = head.split(",").map((h) => h.trim());
  let warning: { message: string; hint: string } | undefined;
  for (const h of heads) {
    const r = singleKind(h, prop, ids, target);
    if (r.error) return r;
    warning ??= r.warning;
  }
  if (!heads.length) return objectKind(prop, true);
  return { kind: singleKind(heads[0], prop, ids, target).kind, ...(warning ? { warning } : {}) };
}

function singleKind(head: string, prop: string, ids: MotionIds, target: string): { kind?: ValueKind; error?: { message: string; hint: string }; warning?: { message: string; hint: string } } {
  if (ids.lights.has(head) && !ids.objects.has(head)) {
    const k = LIGHT_TRACK_PROPS[prop];
    if (/^(position|target)\.[xyz]$/.test(prop)) return { kind: "number" };
    if (!k) return { error: { message: `Light property "${prop}" is not animatable.`, hint: `${didYouMean(prop, Object.keys(LIGHT_TRACK_PROPS))}Use one of: ${listOptions(Object.keys(LIGHT_TRACK_PROPS))}.` } };
    return { kind: k };
  }
  // A letter of a split text: "<textId>/<n>" (same properties as an object).
  let base = head;
  const letter = /^([a-zA-Z][a-zA-Z0-9_-]*)\/(\d+)$/.exec(head);
  if (letter) {
    if (!ids.objects.has(letter[1])) return { error: { message: `Track target "${target}" refers to letter ${letter[2]} of "${letter[1]}", which is not an object id.`, hint: `${didYouMean(letter[1], ids.objects)}Letters are addressed "<textId>/<n>" (n = 0, 1, … over non-space characters).` } };
    if (ids.letters && !ids.letters.has(letter[1])) return { error: { message: `"${letter[1]}" is not split into letters, so "${head}" does not exist.`, hint: `Set "splitLetters": true (or a "reveal") on the text object "${letter[1]}".` } };
    base = letter[1];
    const count = ids.letterCounts?.get(letter[1]);
    if (count !== undefined && Number(letter[2]) >= count) {
      const r = trackValueKind(`${letter[1]}.${prop}`, ids);
      if (r.error) return r;
      return { kind: r.kind, warning: { message: `"${head}" is out of range: "${letter[1]}" has ${count} letter${count === 1 ? "" : "s"} (${letter[1]}/0 … ${letter[1]}/${Math.max(0, count - 1)}), so this target animates nothing.`, hint: `Letters are numbered from 0 over non-space characters. Use ${letter[1]}/${Math.max(0, count - 1)} for the last one, or "children:${letter[1]}.${prop}" for all of them.` } };
    }
  }
  if (!ids.objects.has(base)) {
    const all = [...ids.objects, ...ids.lights, "camera", "environment", "postfx"];
    return { error: { message: `Track target "${target}" refers to "${head}", which is not an object id, a light id, "camera", "environment" or "postfx".`, hint: `${didYouMean(head, all)}Known ids: ${listOptions(all)}. Several targets: "a,b,c.<prop>", "tag:<tag>.<prop>", "children:<id>.<prop>".` } };
  }
  const parts = prop.split(".");
  if (parts[0] === "morph" || parts[0] === "animation") {
    if (ids.models && !ids.models.has(base)) return { error: { message: `"${prop}" needs a model object; "${base}" is not one.`, hint: "morph.<name> and animation.<clip>.weight|speed|time animate glTF models (kind \"model\")." } };
    if (parts[0] === "morph" && parts.length >= 2) return { kind: "number" };
    if (parts[0] === "animation" && parts.length >= 3 && ["weight", "speed", "time"].includes(parts[parts.length - 1])) return { kind: "number" };
    return { error: { message: `Invalid model track "${prop}".`, hint: 'Use "morph.<name>" (0..1) or "animation.<clip>.weight" | ".speed" | ".time".' } };
  }
  if (parts[0] === "effects") return photoEffectKind(base, parts.slice(1), ids);
  if (parts[0] === "motion") {
    if (ids.photos && !ids.photos.has(base)) return { error: { message: `"${prop}" needs a photo object; "${base}" is not one.`, hint: 'motion.progress (0..1) drives the auto move of a 3D photo (kind "photo").' } };
    if (prop === "motion.progress") return { kind: "number" };
    return { error: { message: `Photo motion property "${prop}" is not animatable.`, hint: `${didYouMean(prop, ["motion.progress"])}Use "motion.progress" (0..1 along the photo's motion.auto move).` } };
  }
  return objectKind(prop, false);
}

// "<photoId>.effects.<effect>.<param>[.x|.y]" (src/core/photoEffects.ts).
function photoEffectKind(id: string, parts: string[], ids: MotionIds): { kind?: ValueKind; error?: { message: string; hint: string } } {
  const declared = ids.photoEffects?.get(id);
  if (ids.photoEffects && !declared) return { error: { message: `"${id}" is not a 3D photo: effects.* tracks animate photo effects.`, hint: 'Use "<photoId>.effects.<effect>.<param>" on a kind "photo" object.' } };
  const [effect, param, axis, ...more] = parts;
  const spec = PHOTO_EFFECTS[effect as PhotoEffectId];
  if (!spec) return { error: { message: `Unknown photo effect "${effect ?? ""}".`, hint: `${didYouMean(effect ?? "", PHOTO_EFFECT_IDS)}Effects: ${listOptions(PHOTO_EFFECT_IDS)}.` } };
  if (declared && !declared.has(effect)) return { error: { message: `"${id}" has no ${effect} effect, so this track animates nothing.`, hint: `Add "effects": { "${effect}": {} } to the photo "${id}" first.` } };
  const params = spec.params as Record<string, { type: string; animatable?: boolean }>;
  const animatable = Object.keys(params).filter((k) => params[k].animatable !== false);
  const p = param ? params[param] : undefined;
  if (!p || p.animatable === false || more.length) return { error: { message: `Photo effect property "${effect}.${param ?? ""}" is not animatable.`, hint: `${didYouMean(param ?? "", animatable)}Animatable ${effect} params: ${listOptions(animatable)}.` } };
  if (axis !== undefined) {
    if (p.type === "vec2" && (axis === "x" || axis === "y")) return { kind: "number" };
    return { error: { message: `"${effect}.${param}.${axis}" is not animatable.`, hint: p.type === "vec2" ? 'Use ".x" or ".y".' : `Animate "${effect}.${param}" itself.` } };
  }
  return { kind: p.type === "vec2" ? "vec2" : p.type === "color" ? "color" : "number" };
}

function objectKind(prop: string, multi: boolean): { kind?: ValueKind; error?: { message: string; hint: string } } {
  const parts = prop.split(".");
  if (VEC3_PROPS.includes(parts[0])) {
    if (parts.length === 1) return { kind: parts[0] === "scale" ? "number|vec3" : "vec3" };
    if (parts.length === 2 && AXIS.includes(parts[1])) return { kind: "number" };
  }
  if (prop === "visible") return { kind: "boolean" };
  if (parts[0] === "material") {
    if (parts.length === 2 && MATERIAL_TRACK_PROPS[parts[1]]) return { kind: MATERIAL_TRACK_PROPS[parts[1]] };
    if (parts.length === 3 && parts[1] === "uniforms") return { kind: "number" };
  }
  if (multi && (parts[0] === "morph" || parts[0] === "animation" || prop === "motion.progress")) return { kind: "number" };
  const options = ["position", "position.x", "rotation", "rotation.y", "scale", "visible", ...Object.keys(MATERIAL_TRACK_PROPS).map((k) => `material.${k}`), "material.uniforms.<name>", "morph.<name>", "animation.<clip>.weight", "motion.progress"];
  return { error: { message: `Property "${prop}" is not animatable.`, hint: `${didYouMean(prop, options)}Animatable: ${listOptions(options)}.` } };
}

function keyValueOk(kind: ValueKind, value: unknown): boolean {
  const num = (x: unknown) => isNum(x) || isRel(x);
  const vec = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every(num);
  switch (kind) {
    case "vec3":
      return vec(value) || isRel(value);
    case "vec2":
      return Array.isArray(value) && value.length === 2 && value.every(num);
    case "number":
      return num(value);
    case "color":
      return isValidColor(value);
    case "boolean":
      return typeof value === "boolean";
    case "number|vec3":
      return num(value) || vec(value);
  }
}

const KIND_EXAMPLE: Record<ValueKind, string> = { vec3: '[0, 1, 0] or ["+=0", "+=1", "+=0"]', vec2: "[0.4, -0.2]", number: '1.5 or "+=1"', color: '"#ff8800"', boolean: "true", "number|vec3": "1.2, [1, 2, 1] or \"*=1.2\"" };

// ─── Collector ──────────────────────────────────────────────────────────

class C {
  issues: Issue[] = [];
  add(severity: Issue["severity"], code: string, path: string, message: string, hint?: string) {
    this.issues.push(hint ? { severity, code, path, message, hint } : { severity, code, path, message });
  }
  error(code: string, path: string, message: string, hint?: string) {
    this.add("error", code, path, message, hint);
  }
  warn(code: string, path: string, message: string, hint?: string) {
    this.add("warning", code, path, message, hint);
  }
  unknownKeys(o: Obj, allowed: readonly string[], path: string, what: string) {
    for (const k of Object.keys(o)) {
      if (allowed.includes(k)) continue;
      const s = closest(k, allowed);
      this.warn("unknown-field", `${path}.${k}`, `Unknown field "${k}" on ${what} (ignored by the runtime).`, s ? `Did you mean "${s}"? Otherwise remove it.` : `Remove it. Valid fields: ${listOptions(allowed)}.`);
    }
  }
  number(v: unknown, path: string, o: { min?: number; max?: number; exclusiveMin?: boolean } = {}): boolean {
    if (v === undefined) return true;
    if (!isNum(v)) return this.error("type", path, `Expected a number, got ${show(v)}.`), false;
    if (o.min !== undefined && (o.exclusiveMin ? v <= o.min : v < o.min)) return this.error("range", path, `${v} is below the minimum (${o.exclusiveMin ? ">" : "≥"} ${o.min}).`), false;
    if (o.max !== undefined && v > o.max) return this.error("range", path, `${v} is above the maximum (${o.max}).`), false;
    return true;
  }
  vec(v: unknown, path: string): boolean {
    if (v === undefined) return true;
    if (Array.isArray(v) && v.length === 3 && v.every(isNum)) return true;
    this.error("vec", path, `Expected [x, y, z] (3 numbers), got ${show(v)}.`, "Write it as an array of 3 numbers, e.g. [0, 1.5, 0].");
    return false;
  }
  ease(v: unknown, path: string) {
    if (v === undefined) return;
    if (typeof v !== "string") return this.error("type", path, `Expected an easing name, got ${show(v)}.`, `Examples: ${EASE_EXAMPLES.map((e) => `"${e}"`).join(", ")}.`);
    const p = parseEase(v);
    if ("error" in p) this.error("enum", path, `Invalid easing ${show(v)}: ${p.error}`, `${didYouMean(v, EASE_NAMES)}Named: ${listOptions(EASE_NAMES)}; parametric: "cubicBezier(x1, y1, x2, y2)", "spring(stiffness, damping)", "steps(n)".`);
  }
  loop(v: unknown, path: string) {
    if (v !== undefined && typeof v !== "boolean" && v !== "pingpong") this.error("enum", path, `Invalid loop ${show(v)}.`, 'Use true, false or "pingpong".');
  }
}

// ─── Scene walk helpers ─────────────────────────────────────────────────

function collect(scene: Obj, ids: MotionIds): MotionIds {
  const tags = new Set<string>(), models = new Set<string>(), parents = new Set<string>(), photos = new Set<string>();
  const photoEffects = new Map<string, Set<string>>();
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const o of list) {
      if (!isObj(o) || typeof o.id !== "string") continue;
      if (Array.isArray(o.tags)) for (const t of o.tags) if (typeof t === "string") tags.add(t);
      if (o.kind === "model") models.add(o.id);
      if (o.kind === "photo") photoEffects.set(o.id, new Set(isObj(o.effects) ? Object.keys(o.effects) : []));
      if (o.kind === "photo") photos.add(o.id);
      if ((Array.isArray(o.children) && o.children.length) || (o.kind === "text" && (o.splitLetters === true || isObj(o.reveal)))) parents.add(o.id);
      walk(o.children);
    }
  };
  walk(scene.objects);
  const postfx = new Set<string>();
  // Look presets expanded: { type: "look", preset: "product" } brings bloom, ao, grading… (tracks may animate them).
  if (Array.isArray(scene.postfx)) for (const f of expandPostFx(scene.postfx.filter((x): x is PostFxDef => isObj(x) && typeof x.type === "string"))) postfx.add(f.type);
  return { ...ids, tags, models, photos, parents, postfx, photoEffects };
}

// ─── Timeline ───────────────────────────────────────────────────────────

export const TIMELINE_TRIGGERS_ALL = ["load", "visible", "hover", "click", "scroll", "manual"] as const;
const SCROLL_POS = /^(top|center|bottom|-?\d*\.?\d+%|-?\d*\.?\d+px)\s+(top|center|bottom|-?\d*\.?\d+%|-?\d*\.?\d+px)$/;

function timeline(c: C, t: unknown, ids: MotionIds) {
  if (!isObj(t)) return c.error("type", "timeline", "timeline must be an object.", 'Example: { "duration": 4, "loop": true, "tracks": [] }.');
  c.unknownKeys(t, TIMELINE_KEYS, "timeline", "the timeline");
  if (t.duration === undefined || t.duration === null) c.error("required", "timeline.duration", 'Missing required field "duration" (length in seconds).', 'Add "duration": length in seconds.');
  else c.number(t.duration, "timeline.duration", { min: 0, exclusiveMin: true });
  c.loop(t.loop, "timeline.loop");
  const duration = isNum(t.duration) ? t.duration : Infinity;
  const markers = isObj(t.markers) ? (t.markers as Obj) : {};
  const segments = isObj(t.segments) ? (t.segments as Obj) : {};
  if (t.trigger !== undefined && !(TIMELINE_TRIGGERS_ALL as readonly string[]).includes(t.trigger as string)) {
    c.error("enum", "timeline.trigger", `Invalid value ${show(t.trigger)}.`, `${typeof t.trigger === "string" ? didYouMean(t.trigger, TIMELINE_TRIGGERS_ALL) : ""}Valid values: ${listOptions(TIMELINE_TRIGGERS_ALL)}.`);
  }
  if (t.autoplay !== undefined && typeof t.autoplay !== "boolean") {
    if (typeof t.autoplay !== "string") c.error("type", "timeline.autoplay", `Expected true, false or a segment name, got ${show(t.autoplay)}.`);
    else if (!(t.autoplay in segments)) c.error("unknown-ref", "timeline.autoplay", `autoplay "${t.autoplay}" is not a segment.`, `${didYouMean(t.autoplay, Object.keys(segments))}Define it in timeline.segments, e.g. "segments": { "${t.autoplay}": { "from": 0, "to": 2 } }.`);
  }
  c.number(t.speed, "timeline.speed", { min: 0, exclusiveMin: true });
  if (t.markers !== undefined) {
    if (!isObj(t.markers)) c.error("type", "timeline.markers", "markers must be an object { name: time }.", 'Example: "markers": { "reveal": 1.2, "end": 4 }.');
    else
      for (const [name, time] of Object.entries(markers)) {
        if (c.number(time, `timeline.markers.${name}`, { min: 0 }) && isNum(time) && time > duration) c.warn("range", `timeline.markers.${name}`, `Marker "${name}" (${time}s) is after timeline.duration (${duration}s).`, "Move it inside the timeline.");
      }
  }
  const timeRef = (v: unknown, path: string) => {
    if (isNum(v)) {
      if (v < 0 || v > duration) c.error("range", path, `${v}s is outside the timeline (0..${duration}s).`);
    } else if (typeof v === "string") {
      if (!(v in markers)) c.error("unknown-ref", path, `"${v}" is not a marker.`, `${didYouMean(v, Object.keys(markers))}Use seconds or a name from timeline.markers (${listOptions(Object.keys(markers))}).`);
    } else c.error("type", path, `Expected seconds or a marker name, got ${show(v)}.`);
  };
  if (t.segments !== undefined) {
    if (!isObj(t.segments)) c.error("type", "timeline.segments", "segments must be an object { name: { from, to } }.", 'Example: "segments": { "intro": { "from": 0, "to": 2 }, "hover-in": [2, 2.6] }.');
    else
      for (const [name, seg] of Object.entries(segments)) {
        const p = `timeline.segments.${name}`;
        if (name === "timeline") c.error("reserved", p, '"timeline" is reserved (it plays the whole timeline).', "Rename the segment.");
        if (Array.isArray(seg)) {
          if (seg.length !== 2) c.error("type", p, `A segment array is [from, to], got ${show(seg)}.`);
          else (timeRef(seg[0], `${p}[0]`), timeRef(seg[1], `${p}[1]`));
        } else if (isObj(seg)) {
          c.unknownKeys(seg, ["from", "to", "loop", "speed"], p, "a segment");
          timeRef(seg.from, `${p}.from`);
          timeRef(seg.to, `${p}.to`);
          c.loop(seg.loop, `${p}.loop`);
          c.number(seg.speed, `${p}.speed`, { min: 0, exclusiveMin: true });
        } else c.error("type", p, `Expected { "from", "to" } or [from, to], got ${show(seg)}.`);
      }
  }
  if (t.scroll !== undefined) {
    if (!isObj(t.scroll)) c.error("type", "timeline.scroll", "scroll must be an object.", 'Example: { "start": "top bottom", "end": "bottom top", "smoothing": 0.8 }.');
    else {
      c.unknownKeys(t.scroll, ["start", "end", "smoothing"], "timeline.scroll", "timeline.scroll");
      for (const k of ["start", "end"] as const) {
        const v = t.scroll[k];
        if (v !== undefined && (typeof v !== "string" || !SCROLL_POS.test(v.trim()))) c.error("type", `timeline.scroll.${k}`, `Invalid scroll position ${show(v)}.`, '"<element edge> <viewport edge>", edges top | center | bottom | N% | Npx, e.g. "top bottom", "center center", "bottom 20%".');
      }
      c.number(t.scroll.smoothing, "timeline.scroll.smoothing", { min: 0, max: 0.99 });
      if (t.trigger !== "scroll") c.warn("ignored", "timeline.scroll", 'timeline.scroll only applies with "trigger": "scroll".', 'Set "trigger": "scroll" or remove scroll.');
    }
  }
  if (t.tracks === undefined || t.tracks === null) return c.error("required", "timeline.tracks", 'Missing required field "tracks" (an array of tracks).', 'Add "tracks": [].');
  if (!Array.isArray(t.tracks)) return c.error("type", "timeline.tracks", "tracks must be an array.");
  const seen = new Set<string>();
  t.tracks.forEach((tr, i) => track(c, tr, `timeline.tracks[${i}]`, duration, seen, ids));
}

function track(c: C, tr: unknown, path: string, duration: number, seen: Set<string>, ids: MotionIds) {
  if (!isObj(tr)) return c.error("type", path, "A track must be an object.", 'Example: { "target": "logo.rotation.y", "keys": [[0, 0], [4, 360]], "ease": "inOutSine" }.');
  c.unknownKeys(tr, TRACK_KEYS, path, "a track");
  c.ease(tr.ease, `${path}.ease`);
  c.number(tr.stagger, `${path}.stagger`, { min: 0 });
  if (tr.staggerFrom !== undefined && !(STAGGER_FROM as readonly string[]).includes(tr.staggerFrom as string)) c.error("enum", `${path}.staggerFrom`, `Invalid value ${show(tr.staggerFrom)}.`, `Valid values: ${listOptions(STAGGER_FROM)}.`);
  if (tr.colorSpace !== undefined && !(COLOR_SPACES as readonly string[]).includes(tr.colorSpace as string)) c.error("enum", `${path}.colorSpace`, `Invalid value ${show(tr.colorSpace)}.`, `Valid values: ${listOptions(COLOR_SPACES)} (default "oklch").`);
  let kind: ValueKind | undefined;
  if (tr.target === undefined || tr.target === null) c.error("required", `${path}.target`, 'Missing required field "target" ("<id>.<property>").', 'Add "target": "<id>.<property>".');
  else if (typeof tr.target !== "string") c.error("type", `${path}.target`, `Expected a string, got ${show(tr.target)}.`);
  else {
    const target = tr.target;
    if (seen.has(target)) c.warn("duplicate-track", `${path}.target`, `Another track already animates "${target}"; the last one wins.`, "Merge the keys into a single track.");
    seen.add(target);
    const r = trackValueKind(target, ids);
    if (r.error) c.error("track-target", `${path}.target`, r.error.message, r.error.hint);
    if (r.warning) c.warn("track-target", `${path}.target`, r.warning.message, r.warning.hint);
    kind = r.kind;
    const head = target.slice(0, Math.max(target.indexOf("."), 0));
    const multi = head.includes(",") || head.startsWith("tag:") || head.startsWith("children:");
    if (tr.stagger !== undefined && !multi) c.warn("ignored", `${path}.stagger`, "stagger only applies to multi-target selectors.", 'Use "a,b,c.<prop>", "tag:<tag>.<prop>" or "children:<id>.<prop>".');
  }
  if (tr.keys === undefined || tr.keys === null) return c.error("required", `${path}.keys`, 'Missing required field "keys" ([[time, value], …]).', 'Add "keys": [[time, value], …].');
  if (!Array.isArray(tr.keys) || tr.keys.length === 0) return c.error("type", `${path}.keys`, "keys must be a non-empty array of [time, value].", "Example: [[0, [0, 0, 0]], [2, [0, 1, 0]]].");
  let prev = -Infinity;
  let sorted = true;
  (tr.keys as unknown[]).forEach((k, i) => {
    const kp = `${path}.keys[${i}]`;
    if (!Array.isArray(k) || k.length < 2 || k.length > 3 || !isNum(k[0])) return c.error("type", kp, `Expected [time, value] or [time, value, ease], got ${show(k)}.`, `Example: [1.5, ${kind ? KIND_EXAMPLE[kind].split(" or ")[0] : "1"}] or [1.5, 1, "outBack"].`);
    const time = k[0] as number;
    if (time < 0) c.error("range", `${kp}[0]`, `Key time ${time} is negative.`, "Times are seconds from 0.");
    if (time < prev) sorted = false;
    prev = Math.max(prev, time);
    if (time > duration) c.warn("range", `${kp}[0]`, `Key time ${time}s is after timeline.duration (${duration}s) and is never reached.`, `Increase timeline.duration to ≥ ${time} or move the key.`);
    if (kind && !keyValueOk(kind, k[1])) c.error("track-value", `${kp}[1]`, `Value ${show(k[1])} does not match "${String(tr.target)}" (expects ${kind}).`, `Use a value like ${KIND_EXAMPLE[kind]}${kind === "vec3" && String(tr.target).match(/rotation$/) ? " (degrees)" : ""}.`);
    if (k.length === 3) c.ease(k[2], `${kp}[2]`);
  });
  if (!sorted) c.error("track-order", `${path}.keys`, "Keys are not sorted by time.", "Sort the [time, value] pairs by ascending time.");
}

// ─── Interactions ───────────────────────────────────────────────────────

export function isAllowedUrl(u: unknown): boolean {
  if (typeof u !== "string" || !u.trim()) return false;
  const s = u.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme) return /^https?$/i.test(scheme[1]) && /^https?:\/\/[^/\s]+/i.test(s);
  return !s.startsWith("//") && !/\s/.test(s);
}

function interactions(c: C, list: unknown, scene: Obj, ids: MotionIds) {
  if (!Array.isArray(list)) return c.error("type", "interactions", "interactions must be an array.", 'Example: [{ "on": "click", "target": "product", "do": [{ "openUrl": "https://shop.example/p/1" }] }].');
  const tl = isObj(scene.timeline) ? scene.timeline : null;
  const segments = tl && isObj(tl.segments) ? Object.keys(tl.segments) : [];
  const markers = tl && isObj(tl.markers) ? (tl.markers as Obj) : {};
  list.forEach((it, i) => {
    const p = `interactions[${i}]`;
    if (!isObj(it)) return c.error("type", p, "An interaction must be an object.", 'Example: { "on": "hover", "target": "card", "do": [{ "play": "hover-in" }] }.');
    c.unknownKeys(it, ["on", "target", "key", "event", "at", "once", "do"], p, "an interaction");
    if (!(INTERACTION_ON as readonly string[]).includes(it.on as string)) c.error(it.on === undefined ? "required" : "enum", `${p}.on`, `Invalid "on" ${show(it.on)}.`, `${typeof it.on === "string" ? didYouMean(it.on, INTERACTION_ON) : ""}Valid values: ${listOptions(INTERACTION_ON)}.`);
    const on = it.on as string;
    if (it.target !== undefined) {
      if (typeof it.target !== "string" || !ids.objects.has(it.target)) c.error("unknown-ref", `${p}.target`, `target ${show(it.target)} is not an object id.`, `${typeof it.target === "string" ? didYouMean(it.target, ids.objects) : ""}Object ids: ${listOptions([...ids.objects])}.`);
      else if (!["click", "hover", "hoverEnd"].includes(on)) c.warn("ignored", `${p}.target`, `target is ignored for on "${on}".`, "Targets apply to click, hover and hoverEnd.");
    }
    if (on === "key" && (typeof it.key !== "string" || !it.key)) c.error("required", `${p}.key`, 'on "key" needs "key": a KeyboardEvent.code.', 'Example: "key": "Space", "ArrowRight", "KeyE".');
    if (on === "event" && (typeof it.event !== "string" || !it.event)) c.error("required", `${p}.event`, 'on "event" needs "event": a marker or emitted event name.', `Markers: ${listOptions(Object.keys(markers))}.`);
    if (on === "scroll") {
      if (it.at === undefined) c.error("required", `${p}.at`, 'on "scroll" needs "at": the scroll progress (0..1) to cross.', 'Example: "at": 0.5.');
      else c.number(it.at, `${p}.at`, { min: 0, max: 1 });
    }
    if (it.once !== undefined && typeof it.once !== "boolean") c.error("type", `${p}.once`, "once must be true or false.");
    if (!Array.isArray(it.do) || !it.do.length) return c.error("required", `${p}.do`, '"do" must be a non-empty array of actions.', `Actions: ${INTERACTION_ACTIONS.map((a) => `{ "${a}": … }`).join(", ")}.`);
    it.do.forEach((a, j) => action(c, a, `${p}.do[${j}]`, on, segments, markers, ids));
  });
}

function action(c: C, a: unknown, p: string, on: string, segments: string[], markers: Obj, ids: MotionIds) {
  if (!isObj(a)) return c.error("type", p, "An action must be an object.", 'Example: { "play": "intro" }.');
  const kind = INTERACTION_ACTIONS.filter((k) => k in a);
  if (kind.length !== 1) return c.error("type", p, kind.length ? `An action has exactly one of ${listOptions(INTERACTION_ACTIONS)}; got ${listOptions(kind)}.` : `Unknown action ${show(a)}.`, `Actions: ${INTERACTION_ACTIONS.map((k) => `{ "${k}": … }`).join(", ")}.`);
  const k = kind[0];
  const segRef = (v: unknown, path: string) => {
    if (typeof v !== "string") return c.error("type", path, `Expected a segment name, got ${show(v)}.`);
    if (v !== "timeline" && !segments.includes(v)) c.error("unknown-ref", path, `"${v}" is not a timeline segment.`, `${didYouMean(v, segments)}Segments: ${listOptions(["timeline", ...segments])} — define it in timeline.segments.`);
  };
  switch (k) {
    case "play":
      c.unknownKeys(a, ["play", "reverse"], p, "a play action");
      segRef(a.play, `${p}.play`);
      if (a.reverse !== undefined && typeof a.reverse !== "boolean") c.error("type", `${p}.reverse`, "reverse must be true or false.");
      break;
    case "toggle":
      c.unknownKeys(a, ["toggle"], p, "a toggle action");
      segRef(a.toggle, `${p}.toggle`);
      break;
    case "seek":
      c.unknownKeys(a, ["seek"], p, "a seek action");
      if (!isNum(a.seek) && !(typeof a.seek === "string" && a.seek in markers)) c.error("type", `${p}.seek`, `seek needs seconds or a marker name, got ${show(a.seek)}.`, `Markers: ${listOptions(Object.keys(markers))}.`);
      break;
    case "set": {
      c.unknownKeys(a, ["set", "duration", "ease"], p, "a set action");
      const s = a.set;
      if (!isObj(s) || typeof s.path !== "string" || s.value === undefined) {
        c.error("type", `${p}.set`, 'set needs { "path": "<id>.<property>", "value": … }.', 'Example: { "set": { "path": "logo.material.color", "value": "#ff3366" }, "duration": 0.4, "ease": "outCubic" }.');
        break;
      }
      c.unknownKeys(s, ["path", "value"], `${p}.set`, "set");
      const r = trackValueKind(s.path, ids);
      if (r.error) c.error("track-target", `${p}.set.path`, r.error.message, r.error.hint);
      if (r.warning) c.warn("track-target", `${p}.set.path`, r.warning.message, r.warning.hint);
      else if (r.kind && !keyValueOk(r.kind, s.value)) c.error("track-value", `${p}.set.value`, `Value ${show(s.value)} does not match "${s.path}" (expects ${r.kind}).`, `Use a value like ${KIND_EXAMPLE[r.kind]}.`);
      c.number(a.duration, `${p}.duration`, { min: 0 });
      c.ease(a.ease, `${p}.ease`);
      break;
    }
    case "emit":
      c.unknownKeys(a, ["emit", "payload"], p, "an emit action");
      if (typeof a.emit !== "string" || !a.emit) c.error("type", `${p}.emit`, "emit needs an event name.");
      break;
    case "openUrl":
      c.unknownKeys(a, ["openUrl", "newTab"], p, "an openUrl action");
      if (!isAllowedUrl(a.openUrl)) c.error("url", `${p}.openUrl`, `openUrl ${show(a.openUrl)} is not allowed.`, 'Only http(s) URLs ("https://shop.example/p/1") or page-relative paths ("/shop") can be opened.');
      if (on !== "click" && on !== "key") c.error("gesture", `${p}.openUrl`, `openUrl only works on "click" or "key" interactions (a user gesture), not "${on}".`, 'Move it to an { "on": "click", "target": … } interaction.');
      if (a.newTab !== undefined && typeof a.newTab !== "boolean") c.error("type", `${p}.newTab`, "newTab must be true or false.");
      break;
    case "playClip":
      c.unknownKeys(a, ["playClip", "target", "loop", "speed", "crossfade"], p, "a playClip action");
      if (typeof a.target !== "string" || !ids.models?.has(a.target)) c.error("unknown-ref", `${p}.target`, `playClip needs "target": a model object id, got ${show(a.target)}.`, `Models: ${listOptions([...(ids.models ?? [])])}.`);
      if (typeof a.playClip !== "string" && !(isNum(a.playClip) && Number.isInteger(a.playClip) && a.playClip >= 0)) c.error("type", `${p}.playClip`, "playClip is a clip name or index.");
      c.number(a.speed, `${p}.speed`);
      c.number(a.crossfade, `${p}.crossfade`, { min: 0 });
      if (a.loop !== undefined && typeof a.loop !== "boolean") c.error("type", `${p}.loop`, "loop must be true or false.");
      break;
  }
}

// ─── Camera motion + models ─────────────────────────────────────────────

function cameraMotion(c: C, cam: unknown, ids: MotionIds) {
  if (!isObj(cam)) return;
  if (cam.lookAt !== undefined && (typeof cam.lookAt !== "string" || !ids.objects.has(cam.lookAt))) {
    c.error("unknown-ref", "camera.lookAt", `camera.lookAt ${show(cam.lookAt)} is not an object id.`, `${typeof cam.lookAt === "string" ? didYouMean(cam.lookAt, ids.objects) : ""}Object ids: ${listOptions([...ids.objects])}.`);
  }
  if (cam.shake !== undefined) {
    if (!isObj(cam.shake)) c.error("type", "camera.shake", "shake must be an object.", 'Example: { "amount": 0.03, "rotation": 0.4, "speed": 0.5 }.');
    else {
      c.unknownKeys(cam.shake, ["amount", "rotation", "speed", "seed"], "camera.shake", "camera.shake");
      c.number(cam.shake.amount, "camera.shake.amount", { min: 0 });
      c.number(cam.shake.rotation, "camera.shake.rotation", { min: 0 });
      c.number(cam.shake.speed, "camera.shake.speed", { min: 0 });
      c.number(cam.shake.seed, "camera.shake.seed");
    }
  }
  if (cam.shots === undefined) return;
  if (!Array.isArray(cam.shots)) return c.error("type", "camera.shots", "shots must be an array.", 'Example: [{ "type": "pushIn", "at": 0, "duration": 3 }].');
  cam.shots.forEach((s, i) => {
    const p = `camera.shots[${i}]`;
    if (!isObj(s)) return c.error("type", p, "A shot must be an object.");
    c.unknownKeys(s, SHOT_KEYS, p, "a camera shot");
    if (!(SHOT_TYPES as readonly string[]).includes(s.type as string)) c.error(s.type === undefined ? "required" : "enum", `${p}.type`, `Invalid shot type ${show(s.type)}.`, `${typeof s.type === "string" ? didYouMean(s.type, SHOT_TYPES) : ""}Types: ${listOptions(SHOT_TYPES)}.`);
    if (s.at === undefined) c.error("required", `${p}.at`, 'Missing "at" (start time in seconds).');
    else c.number(s.at, `${p}.at`, { min: 0 });
    if (s.duration === undefined) c.error("required", `${p}.duration`, 'Missing "duration" (seconds).');
    else c.number(s.duration, `${p}.duration`, { min: 0 });
    c.ease(s.ease, `${p}.ease`);
    for (const k of ["distance", "height", "angle", "elevation"]) c.number(s[k], `${p}.${k}`);
    c.number(s.fov, `${p}.fov`, { min: 1, max: 179 });
    c.number(s.focus, `${p}.focus`, { min: 0 });
    c.number(s.lookAhead, `${p}.lookAhead`, { min: 0, max: 0.5 });
    c.vec(s.position, `${p}.position`);
    c.vec(s.target, `${p}.target`);
    for (const k of ["object", "lookAt"] as const) {
      const v = s[k];
      if (typeof v === "string" && !ids.objects.has(v)) c.error("unknown-ref", `${p}.${k}`, `"${v}" is not an object id.`, `${didYouMean(v, ids.objects)}Object ids: ${listOptions([...ids.objects])}.`);
    }
    if (Array.isArray(s.lookAt)) c.vec(s.lookAt, `${p}.lookAt`);
    if (s.type === "path") {
      if (!Array.isArray(s.points) || !s.points.length) c.error("required", `${p}.points`, 'A "path" shot needs "points": [[x, y, z], …] (the camera starts from where it is).');
      else s.points.forEach((pt, j) => c.vec(pt, `${p}.points[${j}]`));
    }
    if ((s.type === "lookAt" && s.object === undefined && s.target === undefined) || (s.type === "focus" && s.object === undefined && s.focus === undefined)) {
      c.error("required", p, `A "${s.type}" shot needs ${s.type === "lookAt" ? '"object" (or "target": [x, y, z])' : '"object" or "focus" (distance)'}.`);
    }
    if (s.type === "focus" && ids.postfx && !ids.postfx.has("dof")) c.warn("ignored", p, 'A "focus" shot drives the dof post effect, which is not in scene.postfx.', 'Add { "type": "dof" } to postfx.');
    if (s.type === "zoom" && s.fov === undefined) c.error("required", `${p}.fov`, 'A "zoom" shot needs "fov" (target field of view, degrees).');
    if (s.type === "move" && s.position === undefined && s.target === undefined && s.fov === undefined) c.error("required", p, 'A "move" shot needs "position", "target" and/or "fov".');
  });
}

function models(c: C, list: unknown, path: string) {
  if (!Array.isArray(list)) return;
  list.forEach((o, i) => {
    if (!isObj(o)) return;
    const p = typeof o.id === "string" ? `objects#${o.id}` : `${path}[${i}]`;
    if (o.kind === "model") {
      if (o.morph !== undefined) {
        if (!isObj(o.morph)) c.error("type", `${p}.morph`, "morph must be an object { targetName: 0..1 }.", 'Example: "morph": { "smile": 0.6 }.');
        else for (const [k, v] of Object.entries(o.morph)) c.number(v, `${p}.morph.${k}`);
      }
      const a = o.animation;
      if (isObj(a)) {
        c.number(a.offset, `${p}.animation.offset`, { min: 0 });
        if (a.blend !== undefined) {
          if (!isObj(a.blend)) c.error("type", `${p}.animation.blend`, "blend must be an object { clipName: weight }.", 'Example: "blend": { "Wave": 0.5 }.');
          else for (const [k, v] of Object.entries(a.blend)) c.number(v, `${p}.animation.blend.${k}`, { min: 0 });
        }
      }
    }
    models(c, o.children, `${p}.children`);
  });
}

// Everything motion-related in a scene. `ids` comes from the main validator
// (objects / lights declared); tags, models, parents and postfx are collected here.
export function validateMotion(scene: Obj, base: MotionIds): Issue[] {
  const c = new C();
  const ids = collect(scene, base);
  if (scene.timeline !== undefined) timeline(c, scene.timeline, ids);
  if (scene.interactions !== undefined) interactions(c, scene.interactions, scene, ids);
  cameraMotion(c, scene.camera, ids);
  models(c, scene.objects, "objects");
  return c.issues;
}
