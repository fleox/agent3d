// ParamSpec (src/core/catalog.ts) → form values: defaults, display strings
// and coercion of what a field produced back into a scene value.

import type { ParamSpec } from "../../core/catalog";
import { isValidColor } from "../../core/color";

export type Coerced = { ok: true; value: unknown } | { ok: false; error: string };

export function paramDefault(spec: ParamSpec): unknown {
  if (spec.default !== undefined) return spec.default;
  switch (spec.type) {
    case "number":
    case "integer":
      return spec.min !== undefined ? spec.min : 0;
    case "boolean":
      return false;
    case "color":
      return "#ffffff";
    case "colors":
      return ["#ffffff"];
    case "vec2":
      return [0, 0];
    case "vec3":
      return [0, 0, 0];
    case "enum":
      return spec.options?.[0];
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "";
  }
}

// The value a field shows: the explicit one, else the catalog default.
export function paramValue(spec: ParamSpec, current: unknown): unknown {
  return current === undefined ? paramDefault(spec) : current;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toNumberList(raw: unknown, len: number): number[] | null {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/).filter(Boolean) : null;
  if (!parts || parts.length !== len) return null;
  const nums = parts.map(toNumber);
  return nums.every((x): x is number => x !== null) ? nums : null;
}

export function clampNumber(spec: Pick<ParamSpec, "min" | "max" | "type">, n: number): number {
  let v = n;
  if (spec.min !== undefined) v = Math.max(spec.min, v);
  if (spec.max !== undefined) v = Math.min(spec.max, v);
  if (spec.type === "integer") v = Math.round(v);
  return v;
}

export function coerceParam(spec: ParamSpec, raw: unknown): Coerced {
  switch (spec.type) {
    case "number":
    case "integer": {
      const n = toNumber(raw);
      if (n === null) return { ok: false, error: "number" };
      return { ok: true, value: clampNumber(spec, n) };
    }
    case "boolean":
      return { ok: true, value: raw === true || raw === "true" || raw === 1 || raw === "1" };
    case "string":
      return { ok: true, value: raw === undefined || raw === null ? "" : String(raw) };
    case "color":
      return typeof raw === "string" && isValidColor(raw.trim()) ? { ok: true, value: raw.trim() } : { ok: false, error: "color" };
    case "colors": {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/).filter(Boolean) : null;
      if (!list || !list.length || !list.every((c) => typeof c === "string" && isValidColor(c))) return { ok: false, error: "colors" };
      return { ok: true, value: list.map((c) => String(c)) };
    }
    case "vec2":
    case "vec3": {
      const v = toNumberList(raw, spec.type === "vec2" ? 2 : 3);
      return v ? { ok: true, value: v } : { ok: false, error: spec.type };
    }
    case "enum":
      return typeof raw === "string" && (spec.options ?? []).includes(raw) ? { ok: true, value: raw } : { ok: false, error: "enum" };
    case "array":
    case "object": {
      let v = raw;
      if (typeof raw === "string") {
        try {
          v = JSON.parse(raw);
        } catch {
          return { ok: false, error: "json" };
        }
      }
      if (spec.type === "array" ? !Array.isArray(v) : !v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: spec.type };
      return { ok: true, value: v };
    }
  }
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Field produced `raw`: the value to store, or undefined to drop the key
// (equal to the catalog default keeps scenes small).
export function paramUpdate(spec: ParamSpec, raw: unknown, { keepDefault = false } = {}): Coerced & { drop?: boolean } {
  const c = coerceParam(spec, raw);
  if (!c.ok) return c;
  if (!keepDefault && spec.default !== undefined && sameValue(c.value, spec.default)) return { ...c, drop: true };
  return c;
}

// Pretty number for inputs: no float noise (0.30000000000000004 → 0.3).
export function formatNumber(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return "0";
  const f = Number(n.toFixed(digits));
  return Object.is(f, -0) ? "0" : String(f);
}
