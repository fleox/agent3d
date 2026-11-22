// Best-effort lint: user-facing strings in Studio components go through the
// i18n bundles (t("…")), so a French UI is fully French. Flags literal text in
// JSX and literal title / placeholder / aria-label / label / hint / alt
// attributes. Technical tokens (acronyms, ids, key codes, file names) are allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { ParamSpec } from "../../core/catalog";
import * as SPECS from "../inspector/specs";
import { MATERIAL_TEXTURE_SLOTS } from "../../core/validate";
import { en } from "./en";
import { fr } from "./fr";

const ROOT = join(__dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".tsx") ? [join(dir, f)] : []));

// Not prose: product names, acronyms, axis letters, examples of technical input.
const ALLOWED = new Set(["HDRI", "SVG", "A", "B", "F", "W", "H", "URL", "fps", "Aa", "Agent3D Studio", "og-image.png", "sk-ant-…", "Space, KeyE, ArrowRight", "default, player, enemies", "—", "Promise"]);

function findings(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const out: string[] = [];
  for (const m of code.matchAll(/\b(title|placeholder|aria-label|label|ariaLabel|hint|alt)="([^"]*)"/g)) {
    const v = m[2];
    // Identifiers / file names (camelCase, dotted, lowercase single tokens) are technical values.
    if (/[A-Za-z]{2,}/.test(v) && !ALLOWED.has(v) && !/^[a-z][A-Za-z0-9.]*$/.test(v)) out.push(`${m[1]}="${v}"`);
  }
  // JSX text: between a tag end and the next tag, on its own (not code).
  for (const m of code.matchAll(/>\s*([A-Za-z][A-Za-z ,.'’!?…:-]{2,})\s*<\/?[A-Za-z]/g)) {
    const v = m[1].trim();
    if (/\b(as|=>|return|const)\b/.test(v) || ALLOWED.has(v)) continue;
    if (/^[a-z]+(\.[a-z]+)+$/i.test(v)) continue; // dotted identifiers
    if (v.split(" ").length >= 1 && /[a-z]{3,}/.test(v) && /^[A-Z]/.test(v)) out.push(`text "${v}"`);
  }
  return out;
}

describe("studio i18n coverage", () => {
  it("components have no hard-coded user-facing English strings", () => {
    const bad = files(ROOT).flatMap((f) => findings(readFileSync(f, "utf8")).map((x) => `${relative(ROOT, f)}: ${x}`));
    expect(bad).toEqual([]);
  });
  it("every inspector field has a translated label (en and fr)", () => {
    const names = new Set<string>([...MATERIAL_TEXTURE_SLOTS]);
    const add = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(add);
      else if (v && typeof v === "object") {
        if (typeof (v as ParamSpec).name === "string" && typeof (v as ParamSpec).type === "string") names.add((v as ParamSpec).name);
        else Object.values(v).forEach(add);
      }
    };
    Object.values(SPECS).forEach(add);
    const missing = (bundle: { fields: Record<string, string> }) => [...names].filter((n) => !(n in bundle.fields)).sort();
    expect({ en: missing(en), fr: missing(fr) }).toEqual({ en: [], fr: [] });
  });
  it("the lint catches literals", () => {
    expect(findings('<button title="Delete it">x</button>')).toEqual(['title="Delete it"']);
    expect(findings("<span>\n  Save changes\n</span>")).toEqual(['text "Save changes"']);
    expect(findings('<IconButton label={t("ui.close")} />')).toEqual([]);
  });
});
