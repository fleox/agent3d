// Backend over the CLI's local REST API (docs/studio-api.md).

import type { LibraryIndex } from "../../core/library";
import type { SceneDoc } from "../../core/types";
import type { TemplateInfo } from "../../ops/templates";
import { ToolCallError, type Backend, type Capabilities, type CreateOptions, type ProjectRef, type ToolInfo } from "./types";

export interface ApiInfo {
  version: string;
  project: { dir: string; manifest: { name?: string; title?: string } | null; exists: boolean } | null;
  runtimeUrl: string;
  assetBase: string;
  libraryBase: string;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; hint?: string; details?: unknown } };

export async function apiJson<T>(path: string, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(path, init);
  } catch (e) {
    throw new ToolCallError("offline", `The Studio server is not reachable (${(e as Error).message}).`, "Is `agent3d studio` still running?");
  }
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ToolCallError("bad-response", `Unexpected response from ${path} (HTTP ${res.status}).`);
  }
  if (!body.ok) throw new ToolCallError(body.error.code, body.error.message, body.error.hint, body.error.details);
  return body.data;
}

// GET /api/info — resolves null when there is no CLI API (static hosting / vite dev).
export async function detectApi(fetchImpl: typeof fetch = fetch): Promise<ApiInfo | null> {
  try {
    const res = await fetchImpl("./api/info", { headers: { accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const body = (await res.json()) as Envelope<ApiInfo>;
    return body.ok ? body.data : null;
  } catch {
    return null;
  }
}

const RECENT_KEY = "agent3d.studio.recentDirs";

export class RemoteBackend implements Backend {
  readonly mode = "cli" as const;
  readonly version: string;
  private toolsCache: Promise<ToolInfo[]> | null = null;

  constructor(private info: ApiInfo) {
    this.version = info.version;
    if (info.project?.exists) rememberDir(info.project.dir, this.projectTitle());
  }

  get location(): string | null {
    return this.info.project?.dir ?? null;
  }

  // Poster = a render_preview frame; video has no tool yet (CLI: agent3d export --format video).
  readonly capabilities: Capabilities = { render: true, exportFormats: ["embed", "single-html", "poster"], exportHint: "video" };

  hasProject(): boolean {
    return !!this.info.project?.exists;
  }

  canCreate(): boolean {
    // project_create needs a project folder; a server started without one has no fs.
    return !!this.info.project;
  }

  projectTitle(): string {
    const m = this.info.project?.manifest;
    return m?.title || m?.name || this.info.project?.dir.split("/").pop() || "Untitled";
  }

  async loadScene(): Promise<SceneDoc> {
    const res = await fetch(`./api/project/scene.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new ToolCallError("notFound", "scene.json could not be read.");
    return (await res.json()) as SceneDoc;
  }

  tools(): Promise<ToolInfo[]> {
    if (!this.toolsCache) this.toolsCache = apiJson<{ tools: ToolInfo[] }>("./api/tools").then((d) => d.tools);
    return this.toolsCache;
  }

  call<T = unknown>(name: string, input: Record<string, unknown>): Promise<T> {
    return apiJson<T>("./api/tools/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, input }) });
  }

  async library(): Promise<LibraryIndex> {
    try {
      return await apiJson<LibraryIndex>("./api/library");
    } catch {
      return { assets: [] };
    }
  }

  async templates(): Promise<TemplateInfo[]> {
    try {
      return (await apiJson<{ templates: TemplateInfo[] }>("./api/templates")).templates;
    } catch {
      return [];
    }
  }

  templatePreview(id: string): string | null {
    // Requested CLI route (see report); the <img> falls back to a placeholder on 404.
    return `./api/templates/${encodeURIComponent(id)}/preview.png`;
  }

  // Tools may return absolute paths inside the project (render_preview): make them relative.
  private rel(path: string): string {
    const dir = this.info.project?.dir;
    if (dir && path.startsWith(`${dir}/`)) return path.slice(dir.length + 1);
    const real = dir?.replace(/^\/private\//, "/");
    if (real && path.startsWith(`${real}/`)) return path.slice(real.length + 1);
    return path.replace(/^\.\//, "");
  }

  async fileUrl(path: string): Promise<string> {
    path = this.rel(path);
    return `${this.info.assetBase.replace(/\/?$/, "/")}${path.split("/").map(encodeURIComponent).join("/")}?v=${Date.now()}`;
  }

  async readFile(path: string): Promise<Uint8Array> {
    path = this.rel(path);
    const res = await fetch(`./api/project/${path.split("/").map(encodeURIComponent).join("/")}`, { cache: "no-store" });
    if (!res.ok) throw new ToolCallError("notFound", `No file ${path}.`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    await apiJson(`./api/project/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", body: bytes as unknown as BodyInit });
  }

  onChange(cb: (paths: string[]) => void): () => void {
    if (typeof EventSource === "undefined") return () => undefined;
    const es = new EventSource("./api/events");
    const onMsg = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as { paths?: string[] };
        if (Array.isArray(data.paths)) cb(data.paths);
      } catch {
        /* ignore malformed */
      }
    };
    es.addEventListener("change", onMsg as EventListener);
    return () => es.close();
  }

  async mountConfig() {
    return { assetBase: this.info.assetBase, libraryBase: this.info.libraryBase };
  }

  async createProject(opts: CreateOptions): Promise<void> {
    await this.call("project_create", { name: opts.name, ...(opts.title ? { title: opts.title } : {}), ...(opts.template ? { template: opts.template } : {}), ...(opts.kind ? { kind: opts.kind } : {}), force: true });
    this.info = (await detectApi()) ?? this.info;
  }

  async recent(): Promise<ProjectRef[]> {
    return readRecentDirs();
  }

  async open(): Promise<void> {
    // A CLI server edits one folder; switching means restarting `agent3d studio --project <dir>`.
  }
}

function readRecentDirs(): ProjectRef[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as ProjectRef[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rememberDir(dir: string, title: string): void {
  try {
    const list = [{ id: dir, title, updatedAt: new Date().toISOString() }, ...readRecentDirs().filter((r) => r.id !== dir)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
