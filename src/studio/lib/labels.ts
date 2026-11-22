import { tryTranslate } from "../i18n";

// Label of an inspector field (ParamSpec name): the translated `fields.<name>`
// message, else the prettified id (catalog parameter names).
export function fieldLabel(name: string): string {
  return tryTranslate(`fields.${name}`) ?? pretty(name);
}

// "reducedMotion" → "Reduced motion", "budgetKb" → "Budget KB", "torusKnot" → "Torus knot".
const ACRONYMS: Record<string, string> = { kb: "KB", dpr: "DPR", ior: "IOR", svg: "SVG", hdri: "HDRI", fov: "FOV", ui: "UI", id: "ID", url: "URL" };

export function pretty(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => ACRONYMS[w] ?? w);
  if (!words.length) return id;
  const first = words[0];
  words[0] = first === first.toUpperCase() ? first : first[0].toUpperCase() + first.slice(1);
  return words.join(" ");
}
