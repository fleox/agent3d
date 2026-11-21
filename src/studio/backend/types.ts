// The Studio talks to a project through a Backend: the CLI's local REST API
// (`agent3d studio`, docs/studio-api.md) or in-browser projects (MemoryFs
// persisted to IndexedDB, AI tools run in the page).

import type { LibraryIndex } from "../../core/library";
import type { SceneDoc, TargetKind } from "../../core/types";
import type { JsonSchema } from "../../ai/types";
import type { TemplateInfo } from "../../ops/templates";

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  mutating: boolean;
}

export class ToolCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ToolCallError";
  }
}

export interface ProjectRef {
  id: string;
  title: string;
  updatedAt?: string;
  kind?: string;
}

export type ExportFormatId = "embed" | "single-html" | "poster" | "video";

export interface Capabilities {
  render: boolean;
  exportFormats: ExportFormatId[];
  // Why some formats are unavailable (shown in the export dialog).
  exportHint?: string;
}

export interface MountConfig {
  assetBase?: string;
  libraryBase?: string;
  assetUrls?: Record<string, string>;
  scriptSources?: Record<string, string>;
}

export interface CreateOptions {
  name: string;
  title?: string;
  template?: string;
  kind?: TargetKind;
}

export interface Backend {
  readonly mode: "cli" | "local";
  readonly version?: string;
  // Folder of the project (CLI) or its in-browser id.
  readonly location: string | null;
  readonly capabilities: Capabilities;
  hasProject(): boolean;
  projectTitle(): string;
  loadScene(): Promise<SceneDoc>;
  tools(): Promise<ToolInfo[]>;
  call<T = unknown>(name: string, input: Record<string, unknown>): Promise<T>;
  library(): Promise<LibraryIndex>;
  templates(): Promise<TemplateInfo[]>;
  // URL of templates/<id>/preview.png, or null when the host can't serve it.
  templatePreview(id: string): string | null;
  // URL of a project file (renders/…, assets/…) for <img>.
  fileUrl(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  // External changes to the project folder (paths relative to the project).
  onChange(cb: (paths: string[]) => void): () => void;
  mountConfig(): Promise<MountConfig>;
  createProject(opts: CreateOptions): Promise<void>;
  canCreate(): boolean;
  recent(): Promise<ProjectRef[]>;
  open(id: string): Promise<void>;
  remove?(id: string): Promise<void>;
}

// Tool results of mutating tools share this shape (src/ai/shared.ts mutationResult).
export interface MutationResult {
  status: "applied" | "refused" | "unchanged" | "dry-run";
  applied: boolean;
  plan?: { summary?: string };
  counts?: { errors: number; warnings: number; infos: number };
  issues?: import("../../core/types").Issue[];
  hint?: string;
}
