// Pure helpers shared by the editor block and the publish transform:
// attribute encoding, URL safety and the published HTML.

export const PLUGIN_ID = "agent3d-scene";
export const BLOCK_ID = "agent3d-scene/scene";
export const NODE_NAME = "agent3dSceneScene";
// Where the settings page uploads export folders on the site's hosting.
export const DEFAULT_FOLDER = "agent3d";

export interface SceneAttrs {
  /** URL of the exported scene.json (root-absolute "/agent3d/<name>/scene.json", relative, or https). */
  src: string;
  /** Poster image URL (default: poster.webp next to scene.json). */
  poster: string;
  /** Runtime module URL (default: ../agent3d-runtime/agent3d-runtime.js from the scene folder). */
  runtime: string;
  /** Accessible label of the scene (one sentence). */
  label: string;
  /** Optional caption shown under the scene. */
  caption: string;
}

export interface UploadedScene {
  name: string;
  src: string;
  poster: string;
  runtime: string;
  label: string;
}

export interface PluginConfig {
  /** Folder (site path, no slashes) where export folders are uploaded. */
  folder: string;
  /** Scenes uploaded through the settings page. Managed by the plugin. */
  scenes: UploadedScene[];
}

export const DEFAULT_CONFIG: PluginConfig = { folder: DEFAULT_FOLDER, scenes: [] };
export const DEFAULT_ATTRS: SceneAttrs = { src: "", poster: "", runtime: "", label: "", caption: "" };

// UTF-8 safe base64 (btoa alone only takes Latin-1).
export function encodeAttrs(a: SceneAttrs): string {
  const bytes = new TextEncoder().encode(JSON.stringify(a));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Merges with DEFAULTS so fields added later get a value in old posts.
export function decodeAttrs(value: string | null | undefined): SceneAttrs {
  if (!value) return { ...DEFAULT_ATTRS };
  try {
    const json = new TextDecoder().decode(Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0)));
    const p = JSON.parse(json) as Partial<SceneAttrs>;
    return {
      src: String(p.src ?? ""),
      poster: String(p.poster ?? ""),
      runtime: String(p.runtime ?? ""),
      label: String(p.label ?? ""),
      caption: String(p.caption ?? ""),
    };
  } catch {
    return { ...DEFAULT_ATTRS };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Only same-site paths and https URLs: no javascript:, data:, protocol-relative…
export function safeUrl(url: string): string {
  const u = url.trim();
  if (!u) return "";
  if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return u;
  if (/^(\/(?!\/)|\.\.?\/)[^\s"'<>:]*$/.test(u)) return u;
  if (/^[A-Za-z0-9_-][^\s"'<>:]*$/.test(u)) return u; // plain relative path
  return "";
}

/** Folder URL of the scene (".../name/") from its scene.json URL. */
function sceneDir(src: string): string {
  return src.replace(/[^/]*$/, "");
}

/** Parent folder of a folder URL ("/agent3d/name/" → "/agent3d/"); "../" when it can't go up. */
function parentDir(dir: string): string {
  const m = /^(.*\/)[^/]+\/$/.exec(dir);
  return m && !/(^|\/)\.\.?\/$/.test(dir) ? m[1] : `${dir}../`;
}

/** Poster and runtime URLs derived from the scene URL when not set (export layout). */
export function withDefaults(a: SceneAttrs): SceneAttrs {
  const src = safeUrl(a.src);
  const dir = src ? sceneDir(src) : "";
  return {
    ...a,
    src,
    poster: safeUrl(a.poster) || (dir ? `${dir}poster.webp` : ""),
    runtime: safeUrl(a.runtime) || (dir ? `${parentDir(dir)}agent3d-runtime/agent3d-runtime.js` : ""),
  };
}

/** Prefixes root-absolute URLs with the site's base path (sites hosted in a sub-folder). */
export function withBase(url: string, basePath: string): string {
  if (!basePath || !url.startsWith("/") || url.startsWith("//")) return url;
  const base = basePath.replace(/\/+$/, "");
  return url === base || url.startsWith(base + "/") ? url : base + url;
}

/** The published HTML: the runtime module (browsers run a module URL once per page) + the element. */
export function sceneHtml(attrs: SceneAttrs, basePath = ""): string {
  const a = withDefaults(attrs);
  if (!a.src) return "";
  const src = escapeHtml(withBase(a.src, basePath));
  const poster = a.poster ? ` poster="${escapeHtml(withBase(a.poster, basePath))}"` : "";
  const label = escapeHtml(a.label.trim() || "3D scene");
  const caption = a.caption.trim() ? `<figcaption style="margin-top:.5rem;font-size:.875em;opacity:.75;text-align:center">${escapeHtml(a.caption.trim())}</figcaption>` : "";
  const script = a.runtime ? `<script type="module" src="${escapeHtml(withBase(a.runtime, basePath))}"></script>` : "";
  return `<figure class="agent3d-scene-block" style="margin:1.5rem 0">${script}<agent3d-scene src="${src}"${poster} aria-label="${label}" style="display:block;width:100%"></agent3d-scene>${caption}</figure>`;
}

const MARKER = /<div\s+([^>]*data-cms-block="agent3d-scene\/scene"[^>]*)>\s*<\/div>/g;

/** Publish time: every marker → the scene HTML (an invalid / empty scene renders nothing). */
export function renderSceneMarkers(html: string, basePath = ""): string {
  return html.replace(MARKER, (_m, attrs: string) => sceneHtml(decodeAttrs(/data-attrs="([^"]*)"/.exec(attrs)?.[1]), basePath));
}

/** Scenes found in an uploaded export folder: "<name>/scene.json" files (relative paths inside the folder). */
export function scenesInExport(paths: string[], folder: string): UploadedScene[] {
  const base = `/${folder.replace(/^\/+|\/+$/g, "")}`;
  const hasRuntime = paths.includes("agent3d-runtime/agent3d-runtime.js");
  return paths
    .map((p) => /^([^/]+)\/scene\.json$/.exec(p)?.[1])
    .filter((n): n is string => !!n && n !== "agent3d-runtime")
    .map((name) => ({
      name,
      src: `${base}/${name}/scene.json`,
      poster: paths.includes(`${name}/poster.webp`) ? `${base}/${name}/poster.webp` : "",
      runtime: hasRuntime ? `${base}/agent3d-runtime/agent3d-runtime.js` : "",
      label: "",
    }));
}

/** Strips the export folder's own name ("embed/agent3d-runtime/…" → "agent3d-runtime/…"). */
export function relativeToExport(webkitRelativePath: string): string {
  const parts = webkitRelativePath.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : webkitRelativePath;
}

/** Files of an export worth uploading (the demo page and snippet stay local). */
export function shouldUpload(rel: string): boolean {
  if (!rel || rel.split("/").some((p) => p.startsWith(".") || p === "..")) return false;
  return rel !== "index.html" && rel !== "snippet.html";
}
