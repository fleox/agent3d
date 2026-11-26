// Photo-only lite runtime eligibility. `dist/runtime/agent3d-photo.js`
// (src/runtime/lite/, ~10 KB gzipped, no Three.js) renders a scene that is
// exactly one 3D photo (parallax mode, or a flat photo) seen by a fixed
// perspective camera over a plain background — the common "3D photo hero".
// Anything else needs the full runtime (agent3d-runtime.js, ~210 KB gzipped).
//
// Pure (no DOM, no Three.js): `export` uses it to pick the runtime, and the
// lite runtime re-checks it in the browser (an ineligible scene is handed to
// the full runtime loaded from the same folder).

import type { ObjectDef, PhotoObjectDef, SceneDoc } from "../core/types";

export const LITE_RUNTIME_FILE = "agent3d-photo.js";

export type LiteEligibility = { ok: true } | { ok: false; reasons: string[] };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const nonEmpty = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false);

export function liteRuntimeEligibility(scene: SceneDoc): LiteEligibility {
  const reasons: string[] = [];
  const no = (cond: unknown, why: string) => {
    if (cond) reasons.push(why);
  };
  const s = (scene ?? {}) as Partial<SceneDoc> & Record<string, unknown>;
  const target = s.target ?? ({} as SceneDoc["target"]);
  no(target.kind === "game", "target.kind is game");
  no(nonEmpty(s.timeline), "timeline");
  no(nonEmpty(s.interactions), "interactions");
  no(nonEmpty(s.postfx), "post effects (postfx)");
  no(nonEmpty(s.physics), "physics");
  no(nonEmpty(s.scripts), "scripts");
  no(s.ui?.elements?.length, "ui (HUD)");
  no(nonEmpty(s.audio), "audio");
  no(/\{data\./.test(JSON.stringify(scene ?? {})), "data bindings ({data.*} placeholders)");

  const cam = s.camera;
  if (!cam || cam.type !== "perspective") reasons.push("camera is not perspective");
  else {
    no(cam.controls && cam.controls !== "none", `camera.controls "${cam.controls}"`);
    no(cam.autoRotate, "camera.autoRotate");
    no(nonEmpty(cam.shots), "camera.shots");
    no(cam.shake, "camera.shake");
    no(cam.lookAt, "camera.lookAt");
    no(cam.follow, "camera.follow");
  }

  const env = s.environment;
  const bg = env?.background;
  no(bg !== undefined && (typeof bg !== "string" || (bg !== "transparent" && !HEX.test(bg))), "environment.background is not a #hex colour or transparent");
  no(env?.ground, "environment.ground");
  no(env?.contactShadows, "environment.contactShadows");
  no(env?.rig, "environment.rig (light rig)");
  for (const l of s.lights ?? []) {
    no(l.type === "rect", "rect lights (visible panels)");
    no(l.type === "spot" && l.volumetric, "volumetric spot lights");
  }

  const objects = (s.objects ?? []) as ObjectDef[];
  if (objects.length !== 1) reasons.push(`${objects.length} objects (the lite runtime shows exactly one photo)`);
  const o = objects[0];
  if (o && o.kind !== "photo") reasons.push(`object "${o.id}" is a ${o.kind}, not a photo`);
  else if (o) {
    const p = o as PhotoObjectDef;
    const flat = !p.depth;
    no(!flat && p.mode && p.mode !== "parallax", `photo mode "${p.mode}" (lite: parallax or a flat photo)`);
    no(nonEmpty(p.children), "photo has children");
    no(p.visible === false, "photo is hidden");
    no(nonEmpty(p.behaviours), "photo behaviours");
    no(p.body, "photo physics body");
    no(p.href, "photo link (href)");
    no(p.attach, "photo attached to the camera");
    no(Array.isArray(p.rotation) && p.rotation.some((r) => r !== 0), "photo is rotated");
    const sc = p.scale;
    no(sc !== undefined && (typeof sc === "number" ? !(sc > 0) : !Array.isArray(sc) || !(sc[0] > 0 && sc[1] > 0)), "photo scale is not positive");
    no(p.material?.color !== undefined && !(typeof p.material.color === "string" && HEX.test(p.material.color)), "photo material.color is not a #hex colour");
    no(typeof p.src !== "string" || !p.src, "photo has no src");
    // Effects (fog / light / reveal) run in the lite player too; their colours must be hex.
    for (const [id, fx] of Object.entries(p.effects ?? {})) {
      const c = (fx as { color?: unknown } | undefined)?.color;
      no(c !== undefined && !(typeof c === "string" && HEX.test(c)), `photo effects.${id}.color is not a #hex colour`);
    }
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
