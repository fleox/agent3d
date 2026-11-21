// Backend without the CLI (static hosting, `npm run dev`): projects live in
// the browser (IndexedDB) and the AI tools run in the page over a MemoryFs.

import { callAiTool, listAiTools, type ToolHost } from "../../ai/tools";
import { slugify } from "../../core/ids";
import type { LibraryIndex } from "../../core/library";
import type { SceneDoc } from "../../core/types";
import { OpsError } from "../../ops/context";
import { mimeFromPath } from "../../ops/refs";
import type { TemplateInfo } from "../../ops/templates";
import { PersistedFs, projectsDb } from "./idb";
import { ToolCallError, type Backend, type Capabilities, type CreateOptions, type ProjectRef, type ToolInfo } from "./types";

const LIBRARY_BASE = "./library/";
const RUNTIME_BASE = "./runtime/";

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) return null; // SPA fallback, not the file
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export class LocalBackend implements Backend {
  readonly mode = "local" as const;
  readonly version = undefined;
  capabilities: Capabilities = { render: false, exportFormats: ["poster"], exportHint: "local" };
  private fs: PersistedFs | null = null;
  private title = "";
  private kind = "";
  private libraryIndex: LibraryIndex | null = null;
  private singleRuntime: Uint8Array | null = null;
  private blobUrls: string[] = [];

  async init(): Promise<void> {
    // Export works only when the single-file runtime is served next to the Studio.
    this.singleRuntime = await fetchBytes(`${RUNTIME_BASE}agent3d-runtime.single.js`);
    if (this.singleRuntime) this.capabilities = { render: false, exportFormats: ["single-html", "poster"], exportHint: "local" };
  }

  get location(): string | null {
    return this.fs?.id ?? null;
  }

  private host(): ToolHost {
    const lib = this.libraryIndex ?? { assets: [] };
    return {
      library: {
        index: lib,
        read: async (id) => {
          const a = lib.assets.find((x) => x.id === id);
          const bytes = a ? await fetchBytes(LIBRARY_BASE + a.path) : null;
          if (!bytes) throw new OpsError("notFound", `Library asset ${id} is not available here.`);
          return bytes;
        },
      },
      ...(this.singleRuntime
        ? {
            runtimeFiles: async (format) => {
              if (format !== "single-html") throw new OpsError("invalid", "Only single-html exports work in the browser.", "Use the CLI for embed exports: agent3d export.");
              return { "agent3d-runtime.single.js": this.singleRuntime! };
            },
          }
        : {}),
    };
  }

  hasProject(): boolean {
    return !!this.fs;
  }
  canCreate(): boolean {
    return true;
  }
  projectTitle(): string {
    return this.title || "Untitled";
  }

  private requireFs(): PersistedFs {
    if (!this.fs) throw new ToolCallError("no-project", "No project is open.");
    return this.fs;
  }

  async loadScene(): Promise<SceneDoc> {
    return JSON.parse(await this.requireFs().readText("scene.json")) as SceneDoc;
  }

  async tools(): Promise<ToolInfo[]> {
    return listAiTools(this.host()).map(({ name, description, inputSchema, mutating }) => ({ name, description, inputSchema, mutating }));
  }

  async call<T = unknown>(name: string, input: Record<string, unknown>): Promise<T> {
    try {
      const r = (await callAiTool({ fs: this.requireFs(), host: this.host() }, name, input)) as T;
      if (name === "scene_apply" || name === "scene_patch" || name === "project_create") await this.refreshTitle();
      return r;
    } catch (e) {
      if (e instanceof OpsError) throw new ToolCallError(e.code, e.message, e.hint, e.details);
      if (e instanceof ToolCallError) throw e;
      throw new ToolCallError("io", (e as Error).message);
    }
  }

  private async refreshTitle(): Promise<void> {
    try {
      const s = await this.loadScene();
      this.title = s.title;
      this.kind = s.target?.kind ?? "";
    } catch {
      /* ignore */
    }
  }

  async library(): Promise<LibraryIndex> {
    if (!this.libraryIndex) {
      const bytes = await fetchBytes(`${LIBRARY_BASE}index.json`);
      try {
        this.libraryIndex = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as LibraryIndex) : { assets: [] };
      } catch {
        this.libraryIndex = { assets: [] };
      }
    }
    return this.libraryIndex;
  }

  async templates(): Promise<TemplateInfo[]> {
    return [];
  }
  templatePreview(): string | null {
    return null;
  }

  private blob(path: string, bytes: Uint8Array): string {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeFromPath(path) }));
    this.blobUrls.push(url);
    return url;
  }

  async fileUrl(path: string): Promise<string> {
    return this.blob(path, await this.requireFs().readBytes(path));
  }
  readFile(path: string): Promise<Uint8Array> {
    return this.requireFs().readBytes(path);
  }
  writeFile(path: string, bytes: Uint8Array): Promise<void> {
    return this.requireFs().writeBytes(path, bytes);
  }

  onChange(): () => void {
    return () => undefined;
  }

  async mountConfig() {
    await this.library();
    const fs = this.requireFs();
    const assetUrls: Record<string, string> = {};
    for (const p of await fs.list("assets/")) assetUrls[p] = this.blob(p, await fs.readBytes(p));
    const scriptSources: Record<string, string> = {};
    for (const p of await fs.list("scripts/")) scriptSources[p] = await fs.readText(p);
    return { libraryBase: LIBRARY_BASE, assetUrls, scriptSources };
  }

  async createProject(opts: CreateOptions): Promise<void> {
    const id = `${slugify(opts.name, "project")}-${Date.now().toString(36)}`;
    const fs = new PersistedFs(id, {}, () => ({ title: this.title, kind: this.kind }));
    this.fs = fs;
    this.title = opts.title ?? opts.name;
    await this.call("project_create", { name: slugify(opts.name, "project"), ...(opts.title ? { title: opts.title } : {}), ...(opts.kind ? { kind: opts.kind } : {}) });
    await fs.save();
  }

  async recent(): Promise<ProjectRef[]> {
    return projectsDb.list();
  }

  async open(id: string): Promise<void> {
    const p = await projectsDb.get(id);
    if (!p) throw new ToolCallError("notFound", "This project is no longer stored in this browser.");
    this.blobUrls.forEach((u) => URL.revokeObjectURL(u));
    this.blobUrls = [];
    this.title = p.title;
    this.kind = p.kind ?? "";
    this.fs = new PersistedFs(p.id, p.files, () => ({ title: this.title, kind: this.kind }));
  }

  async remove(id: string): Promise<void> {
    await projectsDb.remove(id);
    if (this.fs?.id === id) this.fs = null;
  }

  close(): void {
    this.fs = null;
  }
}
