// `{data.*}` placeholder substitution — pure, shared by the runtime
// (src/runtime/data.ts bindSceneData) and the export (src/ops/export.ts:
// title / aria-label / alt / og:title in the generated markup).
// Placeholders: `{data.<key>}` (dots for nested keys, `|` for a fallback:
// `{data.cta|Shop now}`); a key without a value nor fallback becomes "".

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


const WHOLE = /^\{data\.([a-zA-Z_$][\w$-]*(?:\.[a-zA-Z_$][\w$-]*)*)(?:\|([^}]*))?\}$/;

/**
 * Binds a value that may be exactly one placeholder: `"{data.values}"` becomes
 * the raw data value (array, number, object…) — for generator params like
 * bars3d `data`. A missing value gives the fallback (parsed as JSON when it is
 * a number / array / object, else the string) or undefined. Any other string
 * is substituted as text.
 */
export function bindDataValue(v: unknown, data: Record<string, unknown> | undefined): unknown {
  if (typeof v !== "string" || !v.includes("{data.")) return v;
  const m = WHOLE.exec(v.trim());
  if (!m) return substituteData(v, data);
  const raw = lookup(data, m[1]);
  if (raw !== undefined && raw !== null && raw !== "") return raw;
  if (m[2] === undefined) return undefined;
  try {
    return JSON.parse(m[2]) as unknown;
  } catch {
    return m[2];
  }
}
