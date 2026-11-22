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

export const DATA_PLACEHOLDER = /\{data\.([a-zA-Z_$][\w$-]*(?:\.[a-zA-Z_$][\w$-]*)*)(?:\|([^}]*))?\}/g;

function lookup(data: Record<string, unknown> | undefined, path: string): unknown {
  let cur: unknown = data;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function hasDataPlaceholders(s: unknown): boolean {
  if (typeof s !== "string" || !s.includes("{data.")) return false;
  DATA_PLACEHOLDER.lastIndex = 0;
  return DATA_PLACEHOLDER.test(s);
}

export function substituteData(s: string, data: Record<string, unknown> | undefined): string {
  if (!s.includes("{data.")) return s;
  return s.replace(DATA_PLACEHOLDER, (_m, path: string, fallback: string | undefined) => {
    const v = lookup(data, path);
    if (v === undefined || v === null || v === "") return fallback ?? "";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

// The scene with every `{data.*}` placeholder resolved. Returns the same object
// when nothing is bound (cheap for the common case).
export function bindSceneData(scene: SceneDoc, data: Record<string, unknown> | undefined = scene.data): SceneDoc {
  let changed = false;
  const sub = (v: unknown): unknown => {
    if (!hasDataPlaceholders(v)) return v;
    changed = true;
    return substituteData(v as string, data);
  };
  const mapObj = (o: ObjectDef): ObjectDef => {
    const rec = o as ObjectDef & { text?: unknown; href?: unknown };
    const text = rec.kind === "text" ? sub(rec.text) : rec.text;
    const href = sub(rec.href);
    const children = o.children?.map(mapObj);
    if (text === rec.text && href === rec.href && (!children || children.every((c, i) => c === o.children![i]))) return o;
    return { ...o, ...(rec.kind === "text" ? { text } : {}), ...(rec.href !== undefined ? { href } : {}), ...(children ? { children } : {}) } as ObjectDef;
  };
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
