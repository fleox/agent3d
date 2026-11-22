// docs/catalog.md is generated from the catalog (src/core/catalog.ts).
// src/ops/docs.test.ts fails when the file is stale; regenerate with
// `UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts`.

import { CATALOG, GRADING_LOOKS, POSTFX_LOOKS, type CatalogEntry, type ParamSpec } from "../core/catalog";

const SECTIONS: { key: Exclude<keyof typeof CATALOG, "materialPresets">; title: string; intro: string }[] = [
  { key: "geometries", title: "Geometries", intro: 'Mesh / instances `geometry: { "type": "<id>", …params }`. Sizes in units (≈ metres).' },
  { key: "behaviours", title: "Behaviours", intro: 'Object or light `behaviours: [{ "type": "<id>", "when"?: "always|hover|click|visible|scroll", "delay"?: s, …params }]`. Angles in degrees, speeds in deg/s or cycles/s as noted.' },
  { key: "generators", title: "Generators", intro: 'Procedural content, zero download: `{ "kind": "generator", "generator": "<id>", "params": { … }, "seed"?: n }`.' },
  { key: "particlePresets", title: "Particle presets", intro: '`{ "kind": "particles", "preset": "<id>", "count"?, "area"?, "size"?, "color"?, … }` — object fields override the preset.' },
  { key: "instanceLayouts", title: "Instance layouts", intro: '`{ "kind": "instances", "geometry": { "type": "<geometry>", … }, "material"?: {…}, "colors"?: [...], "layout": { "type": "<id>", …params } }` — many copies of one geometry in one draw call. The params are the layout object\'s fields.' },
  { key: "shaders", title: "Shaders", intro: 'Material `{ "type": "shader", "shader": "<id>", "uniforms": { …params } }`.' },
  { key: "textures", title: "Procedural textures", intro: 'Any material texture slot (`map`, `normalMap`, `roughnessMap`, `metalnessMap`, `bumpMap`, `aoMap`, `emissiveMap`, `alphaMap`, `displacementMap`) accepts `{ "procedural": "<id>", …params }` instead of a file: generated at load time, seamless, zero bytes. Colour slots use `colors`; data slots use the pattern height; `normalMap` derives normals from it.' },
  { key: "lightRigs", title: "Light rigs", intro: '`environment.rig: "<id>"` or `{ "preset": "<id>", …params }` — named lighting setups added to `lights` (positions assume a subject ~1–3 units around the origin; use `scale` for bigger scenes, `rotation` to turn the rig).' },
  { key: "postfx", title: "Post effects", intro: 'Scene `postfx: [{ "type": "<id>", …params }]`.' },
  { key: "fonts", title: "Fonts", intro: 'Text objects `font: "<id>"` (bundled, no web font fetch).' },
  { key: "sounds", title: "Synth sounds", intro: 'Audio `sounds: { "<name>": { "preset": "<id>" } }` — synthesised with WebAudio, zero bytes.' },
];

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function paramType(p: ParamSpec): string {
  if (p.type === "enum") return (p.options ?? []).map((o) => `\`${o}\``).join(" \\| ");
  const range = p.min !== undefined || p.max !== undefined ? ` (${p.min ?? "−∞"}…${p.max ?? "∞"})` : "";
  return `${p.type}${range}`;
}

function paramTable(params: ParamSpec[]): string {
  if (!params.length) return "_No parameters._\n";
  const rows = params.map((p) => `| \`${p.name}\`${p.required ? " **(required)**" : ""} | ${cell(paramType(p))} | ${p.default === undefined ? "" : `\`${cell(JSON.stringify(p.default))}\``} | ${cell(p.description)} |`);
  return ["| Param | Type | Default | Description |", "|---|---|---|---|", ...rows].join("\n") + "\n";
}

function entry(e: CatalogEntry, withParams: boolean): string {
  const parts = [`### \`${e.id}\`\n`, `${e.description}${e.cost ? ` _Cost: ~${e.cost.replace(/^~/, "")} triangles._` : ""}${e.gpu ? ` _GPU cost: ${e.gpu}._` : ""}\n`];
  if (e.material) parts.push(`**\`material\` override** (object-level \`"material": { … }\`): ${e.material}\n`);
  if (withParams) parts.push(paramTable(e.params));
  if (e.example) parts.push("```json\n" + JSON.stringify(e.example) + "\n```\n");
  return parts.join("\n");
}

function postfxLooks(): string[] {
  const out = ["### Look presets", "", '`{ "type": "look", "preset": "<id>", "intensity"?: 0…1 }` expands into exactly this stack (`intensity` scales the amounts; effects listed next to the look override the matching entry param by param):', "", "| Preset | Description | Expands to |", "|---|---|---|"];
  for (const [id, l] of Object.entries(POSTFX_LOOKS)) out.push(`| \`${id}\` | ${cell(l.description)} | \`${cell(JSON.stringify(l.effects))}\` |`);
  out.push("", "### Grading looks", "", '`{ "type": "grading", "look": "<id>", "intensity"?: 0…1 }` — procedural LUTs (no texture); explicit grading params override them:', "", "| Look | Description | Values |", "|---|---|---|");
  for (const [id, g] of Object.entries(GRADING_LOOKS)) out.push(`| \`${id}\` | ${cell(g.description)} | \`${cell(JSON.stringify(g.values))}\` |`);
  out.push("");
  return out;
}

export function renderCatalogMarkdown(): string {
  const out: string[] = [
    "# Agent3D catalog",
    "",
    "<!-- Generated from src/core/catalog.ts by renderCatalogMarkdown() (src/ops/docs.ts). Do not edit by hand. -->",
    "",
    "Everything a scene can reference by id. Agents: query it with the `catalog_get` tool or `agent3d catalog [section] [id]`.",
    "",
    "## Contents",
    "",
    ...SECTIONS.map((s) => `- [${s.title}](#${s.title.toLowerCase().replace(/\s+/g, "-")}) (${CATALOG[s.key].length})`),
    "- [Material presets](#material-presets) (" + CATALOG.materialPresets.length + ")",
    "",
  ];
  for (const s of SECTIONS) {
    const list = CATALOG[s.key] as CatalogEntry[];
    const hasParams = list.some((e) => e.params.length);
    // Entries sharing one parameter list (particle presets): one table, then the ids.
    const shared = list.length > 1 && hasParams && list.every((e) => e.params === list[0].params && !e.example && !e.cost && !e.material && !e.gpu);
    out.push(`## ${s.title}`, "", s.intro, "");
    if (shared) out.push("Every entry takes these fields:", "", paramTable(list[0].params));
    else if (hasParams) for (const e of list) out.push(entry(e, true));
    if (s.key === "postfx") out.push(...postfxLooks());
    else {
      out.push("| Id | Description |", "|---|---|", ...list.map((e) => `| \`${e.id}\` | ${cell(e.description)} |`), "");
    }
  }
  out.push("## Material presets", "", 'Material `{ "preset": "<id>", …overrides }` — explicit properties override the preset.', "", "| Preset | Description | Sets |", "|---|---|---|");
  for (const p of CATALOG.materialPresets) out.push(`| \`${p.id}\` | ${cell(p.description)} | \`${cell(JSON.stringify(p.props))}\` |`);
  out.push("");
  return out.join("\n");
}
