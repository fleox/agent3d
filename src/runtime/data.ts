// Data bindings: personalise a scene from the page without editing scene.json.
//
//   scene.json   { "data": { "title": "Hello" }, "objects": [{ "kind": "text", "text": "{data.title}" }] }
//   page         <agent3d-scene src="…" data-title="Summer sale"></agent3d-scene>
//                el.setData({ title: "Winter sale" })
//
// Placeholders `{data.<key>}` (dots for nested keys, `|` for a fallback:
// `{data.cta|Shop now}`) are replaced in text objects' `text`, every object's
// `href`, `ariaLabel`, `title` and UI elements' `text`. A key without a value
// and without a fallback becomes an empty string. Substitution happens on a
// copy of the scene before the world is built (scene.json stays untouched),
// so renders, exports and the Studio all show the bound values.

import type { ObjectDef, SceneDoc } from "../core/types";

import { bindDataValue, hasDataPlaceholders, substituteData } from "../core/data";

export { bindDataValue, DATA_PLACEHOLDER, hasDataPlaceholders, substituteData } from "../core/data";

// The scene with every `{data.*}` placeholder resolved. Returns the same object
// when nothing is bound (cheap for the common case).
export function bindSceneData(scene: SceneDoc, data: Record<string, unknown> | undefined = scene.data): SceneDoc {
  let changed = false;
  const sub = (v: unknown): unknown => {
    if (!hasDataPlaceholders(v)) return v;
    changed = true;
    return substituteData(v as string, data);
  };
  // Generator params: deep, a whole-value placeholder keeps the raw data value
  // ("{data.values}" → [3, 5, 8]); placeholders inside longer strings are text.
  const bindParams = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!hasDataPlaceholders(v)) return v;
      changed = true;
      return bindDataValue(v, data);
    }
    if (Array.isArray(v)) {
      const out = v.map(bindParams);
      return out.every((x, i) => x === v[i]) ? v : out;
    }
    if (v && typeof v === "object") {
      let diff = false;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        const y = bindParams(x);
        if (y !== x) diff = true;
        if (y !== undefined) out[k] = y;
      }
      return diff ? out : v;
    }
    return v;
  };
  const mapObj = (o: ObjectDef): ObjectDef => {
    const rec = o as ObjectDef & { text?: unknown; href?: unknown; params?: unknown };
    const text = rec.kind === "text" ? sub(rec.text) : rec.text;
    const href = sub(rec.href);
    const params = rec.kind === "generator" && rec.params ? bindParams(rec.params) : rec.params;
    const children = o.children?.map(mapObj);
    if (text === rec.text && href === rec.href && params === rec.params && (!children || children.every((c, i) => c === o.children![i]))) return o;
    return { ...o, ...(rec.kind === "text" ? { text } : {}), ...(rec.href !== undefined ? { href } : {}), ...(params !== rec.params ? { params } : {}), ...(children ? { children } : {}) } as ObjectDef;
  };
  // Interaction links: { "openUrl": "{data.ctaUrl|https://example.com}" }.
  const interactions = scene.interactions?.map((it) => {
    const doList = (it as { do?: unknown[] }).do;
    if (!Array.isArray(doList)) return it;
    const next = doList.map((a) => {
      const rec = a as { openUrl?: unknown };
      if (!rec || typeof rec !== "object" || !hasDataPlaceholders(rec.openUrl)) return a;
      return { ...rec, openUrl: sub(rec.openUrl) };
    });
    return next.every((a, i) => a === doList[i]) ? it : { ...it, do: next };
  });
  const objects = (scene.objects ?? []).map(mapObj);
  const title = sub(scene.title) as string;
  const ariaLabel = sub(scene.ariaLabel) as string | undefined;
  const elements = scene.ui?.elements?.map((e) => {
    const rec = e as unknown as { text?: unknown };
    const text = sub(rec.text);
    return text === rec.text ? e : ({ ...e, text } as typeof e);
  });
  if (!changed) return scene;
  return {
    ...scene,
    title,
    ...(scene.ariaLabel !== undefined ? { ariaLabel } : {}),
    objects,
    ...(scene.ui && elements ? { ui: { ...scene.ui, elements } } : {}),
    ...(interactions ? { interactions: interactions as SceneDoc["interactions"] } : {}),
  };
}

// `data-*` attributes of the element → scene data (dataset keys are camelCased:
// data-cta-label → ctaLabel). Values stay strings; `data-json='{"a":1}'` merges a JSON object.
export function datasetToData(dataset: DOMStringMap | Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dataset)) {
    if (v === undefined) continue;
    if (k === "json") {
      try {
        const parsed = JSON.parse(v) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) Object.assign(out, parsed);
      } catch {
        /* ignored: invalid data-json */
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}
