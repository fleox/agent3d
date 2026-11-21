import { CATALOG, type CatalogSection } from "../../src/core/catalog";
import { readTemplateFiles, readTemplatesIndex } from "../host";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { positional, table, usage } from "./util";

const SECTIONS = Object.keys(CATALOG) as CatalogSection[];

export const catalogCommand: Command = {
  name: "catalog",
  usage: "catalog [<section>] [<id>]",
  summary: `What scenes can use, with parameters: ${SECTIONS.join(", ")}. No section → sections with counts; a section → its entries; an id → the full entry (params, defaults, ranges, example).`,
  options: [],
  async run({ io, positionals }) {
    const [section, id] = positionals;
    if (!section) {
      const sections = SECTIONS.map((s) => ({ section: s, count: CATALOG[s].length, ids: (CATALOG[s] as readonly { id: string }[]).map((e) => e.id) }));
      return printResult(io, { sections }, () => table(sections.map((s) => ({ ...s, ids: s.ids.join(", ") })), ["section", "count", "ids"]));
    }
    const key = SECTIONS.find((s) => s.toLowerCase() === section.toLowerCase() || s.toLowerCase() === `${section.toLowerCase()}s`);
    if (!key) usage(`Unknown catalog section "${section}".`, `Sections: ${SECTIONS.join(", ")}.`);
    const entries = CATALOG[key] as readonly { id: string; description: string }[];
    if (!id) return printResult(io, { section: key, entries }, () => table(entries.map((e) => ({ id: e.id, description: e.description })), ["id", "description"]));
    const entry = entries.find((e) => e.id === id) ?? entries.find((e) => e.id.toLowerCase() === id.toLowerCase());
    if (!entry) throw new CliError("notFound", `No "${id}" in ${key}.`, `Ids: ${entries.map((e) => e.id).join(", ")}.`);
    return printResult(io, { section: key, entry }, () => JSON.stringify(entry, null, 2));
  },
};

export const templatesCommand: Command = {
  name: "templates",
  usage: "templates <list|show> [<id>]",
  summary: "Starter projects (`agent3d new <dir> --template <id>`): list them, or show one (metadata + its scene summary).",
  subcommands: [
    { name: "list", usage: "templates list", summary: "Templates with id, title, kind, tags and description." },
    { name: "show", usage: "templates show <id>", summary: "A template's metadata, files and scene." },
  ],
  options: [],
  async run({ io, positionals }) {
    const [action = "list"] = positionals;
    const index = readTemplatesIndex();
    if (action === "list") return printResult(io, { templates: index }, () => table(index as unknown as Record<string, unknown>[], ["id", "kind", "title", "description"]));
    if (action === "show") {
      const id = positional(positionals, 1, "template id", "templates show <id>");
      const meta = index.find((t) => t.id === id);
      const files = readTemplateFiles(id);
      const sceneBytes = files["scene.json"];
      const scene = sceneBytes ? JSON.parse(new TextDecoder().decode(sceneBytes)) : null;
      let summary: unknown = null;
      if (scene) {
        try {
          summary = (await import("../../src/ops/scene")).summarizeScene(scene);
        } catch {
          summary = null;
        }
      }
      return printResult(io, { template: meta, files: Object.keys(files), summary, scene }, () => `${meta?.title} (${id})\n${meta?.description ?? ""}\nFiles: ${Object.keys(files).join(", ")}`);
    }
    usage(`Unknown templates action "${action}".`, "Use list or show.");
  },
};
