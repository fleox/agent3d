// Templates: starter projects in templates/<id>/ (agent3d.json, scene.json,
// template.json, scripts/, assets/). The front door (CLI: package folder,
// Studio: bundled) reads the index and the files; ops only filter and
// instantiate them (createProject with templateFiles).

import type { ProjectFs } from "../core/fs";
import { closest } from "../core/suggest";
import type { TargetKind } from "../core/types";
import { OpsError } from "./context";
import { createProject, type CreateProjectResult } from "./project";

export interface TemplateInfo {
  id: string;
  title: string;
  description: string;
  kind: TargetKind;
  tags: string[];
  aspect: string;
}

export type TemplateIndex = TemplateInfo[];

export function listTemplates(index: TemplateIndex, filter: { kind?: TargetKind; query?: string } = {}): TemplateInfo[] {
  const words = (filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return (index ?? []).filter((t) => {
    if (filter.kind && t.kind !== filter.kind) return false;
    const hay = `${t.id} ${t.title} ${t.description} ${t.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function findTemplate(index: TemplateIndex, id: string): TemplateInfo {
  const t = (index ?? []).find((x) => x.id === id);
  if (!t) {
    const s = closest(id, (index ?? []).map((x) => x.id));
    throw new OpsError("notFound", `Unknown template "${id}".`, `${s ? `Did you mean "${s}"? ` : ""}List templates with templates_list / \`agent3d templates list\`.`);
  }
  return t;
}

// Parses templates/<id>/template.json content into a TemplateInfo (with checks).
export function parseTemplateInfo(json: unknown, fallbackId: string): TemplateInfo {
  const t = (json ?? {}) as Partial<TemplateInfo>;
  return {
    id: typeof t.id === "string" ? t.id : fallbackId,
    title: typeof t.title === "string" ? t.title : fallbackId,
    description: typeof t.description === "string" ? t.description : "",
    kind: (t.kind as TargetKind) ?? "banner",
    tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
    aspect: typeof t.aspect === "string" ? t.aspect : "16:9",
  };
}

export async function instantiateTemplate(fs: ProjectFs, id: string, files: Record<string, Uint8Array | string>, opts: { name: string; title?: string; force?: boolean }): Promise<CreateProjectResult> {
  return createProject(fs, { name: opts.name, title: opts.title, template: id, templateFiles: files, force: opts.force });
}
