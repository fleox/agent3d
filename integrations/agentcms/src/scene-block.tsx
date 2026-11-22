import { Node, mergeAttributes } from "@tiptap/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n, useCmsData, type BlockManifest, type SettingsSchema } from "@agent-cms/runtime";
import { BLOCK_ID, DEFAULT_ATTRS, DEFAULT_CONFIG, NODE_NAME, PLUGIN_ID, decodeAttrs, encodeAttrs, escapeHtml, withDefaults, type PluginConfig, type SceneAttrs } from "./render";

// "Agent3D scene" editor block.
//
// Storage: an EMPTY marker <div data-cms-block="agent3d-scene/scene"
// data-attrs="<base64 JSON>"></div> in the post's Markdown; at publish
// time renderSceneMarkers (render.ts) swaps it for the runtime module
// script + <agent3d-scene>. The editor shows the poster, and can play the
// live scene on demand (it loads the scene's runtime module from the site).

const t = (key: string) => i18n.t(key, { ns: PLUGIN_ID });

function posterPreview(a: SceneAttrs): string {
  const d = withDefaults(a);
  const label = escapeHtml(a.label || t("block.title"));
  const img = d.poster ? `<img src="${escapeHtml(d.poster)}" alt="" style="display:block;width:100%;height:auto;min-height:60px;object-fit:cover;background:#1b1c22" onerror="this.style.display='none'">` : "";
  const src = d.src ? escapeHtml(d.src) : escapeHtml(t("block.noScene"));
  return `<div style="position:relative;border:1px solid rgba(127,127,127,.35);border-radius:8px;overflow:hidden;background:#111216;color:#e8e8ee;font:13px/1.4 system-ui,sans-serif">${img}<div style="display:flex;gap:8px;align-items:center;padding:8px 10px"><strong>&#9651; ${label}</strong><span style="opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${src}</span></div></div>`;
}

function livePreview(dom: HTMLElement, a: SceneAttrs): void {
  const d = withDefaults(a);
  if (!d.src || !d.runtime) return;
  const doc = dom.ownerDocument;
  if (!doc.querySelector(`script[data-agent3d-runtime="${CSS.escape(d.runtime)}"]`)) {
    const s = doc.createElement("script");
    s.type = "module";
    s.src = d.runtime;
    s.setAttribute("data-agent3d-runtime", d.runtime);
    doc.head.appendChild(s);
  }
  const el = doc.createElement("agent3d-scene");
  el.setAttribute("src", d.src);
  if (d.poster) el.setAttribute("poster", d.poster);
  el.setAttribute("aria-label", a.label || "3D scene");
  el.style.cssText = "display:block;width:100%;border-radius:8px;overflow:hidden";
  dom.replaceChildren(el);
}

const SceneNode = Node.create({
  name: NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      // ONE attribute holding every field, stored base64 in data-attrs.
      attrs: {
        default: DEFAULT_ATTRS,
        parseHTML: (el: HTMLElement) => decodeAttrs(el.getAttribute("data-attrs")),
        renderHTML: (a: { attrs?: SceneAttrs }) => ({ "data-attrs": encodeAttrs(a.attrs ?? DEFAULT_ATTRS) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: `div[data-cms-block="${BLOCK_ID}"]` }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-cms-block": BLOCK_ID })];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.contentEditable = "false";
      let current = node.attrs.attrs as SceneAttrs;
      const paint = () => {
        dom.innerHTML = posterPreview(current);
        const d = withDefaults(current);
        if (d.src && d.runtime) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn-secondary";
          btn.style.cssText = "position:absolute;top:8px;right:8px";
          btn.textContent = t("block.play");
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            livePreview(dom, current);
          });
          dom.firstElementChild?.appendChild(btn);
        }
      };
      paint();
      return {
        dom,
        update(next) {
          if (next.type.name !== NODE_NAME) return false;
          current = next.attrs.attrs as SceneAttrs;
          paint();
          return true;
        },
        stopEvent: (event: Event) => event.target instanceof HTMLButtonElement,
        ignoreMutation: () => true,
      };
    };
  },
});

function SceneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" />
      <path d="m3 7 9 5 9-5M12 12v10" />
    </svg>
  );
}

function useConfig(): PluginConfig {
  const { settings } = useCmsData();
  const raw = (settings.pluginConfigs?.[PLUGIN_ID] ?? {}) as Partial<PluginConfig>;
  return { ...DEFAULT_CONFIG, ...raw, scenes: Array.isArray(raw.scenes) ? raw.scenes : [] };
}

// Block tab: pick an uploaded scene or type URLs. Text fields commit on
// blur (updateAttrs moves the focus back to the editor).
function SceneInspector({ attrs, updateAttrs }: { attrs: Record<string, unknown>; updateAttrs: (patch: Record<string, unknown>) => void }) {
  const { t: tr } = useTranslation(PLUGIN_ID);
  const config = useConfig();
  const a = { ...DEFAULT_ATTRS, ...((attrs.attrs as Partial<SceneAttrs>) ?? {}) };
  const [draft, setDraft] = useState(a);
  useEffect(() => setDraft(a), [a.src, a.poster, a.runtime, a.label, a.caption]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (patch: Partial<SceneAttrs>) => updateAttrs({ attrs: { ...a, ...patch } });
  const field = (key: keyof SceneAttrs, placeholder?: string) => (
    <label className="block space-y-1" key={key}>
      <span className="label">{tr(`block.${key}`)}</span>
      <input
        className="input w-full"
        value={draft[key]}
        placeholder={placeholder}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        onBlur={() => draft[key] !== a[key] && commit({ [key]: draft[key] })}
      />
    </label>
  );
  const derived = withDefaults(draft);
  return (
    <div className="space-y-3">
      {config.scenes.length > 0 && (
        <label className="block space-y-1">
          <span className="label">{tr("block.uploaded")}</span>
          <select
            className="input w-full"
            value={config.scenes.find((s) => s.src === a.src)?.name ?? ""}
            onChange={(e) => {
              const s = config.scenes.find((x) => x.name === e.target.value);
              if (s) commit({ src: s.src, poster: s.poster, runtime: s.runtime, label: a.label || s.label || s.name });
            }}
          >
            <option value="">{tr("block.custom")}</option>
            {config.scenes.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {field("src", "/agent3d/my-scene/scene.json")}
      {field("label", tr("block.labelPlaceholder"))}
      {field("caption")}
      {field("poster", derived.poster)}
      {field("runtime", derived.runtime)}
      <p className="text-xs text-surface-500">{tr("block.help")}</p>
    </div>
  );
}

export const sceneBlock: BlockManifest = {
  id: BLOCK_ID,
  // The Tiptap node name: required for ids containing "/".
  nodeName: NODE_NAME,
  titleKey: "block.title",
  namespace: PLUGIN_ID,
  icon: SceneIcon,
  category: "embed",
  extensions: [SceneNode],
  // Asks for the scene URL (prefilled with the upload folder); the Block tab
  // (opened on insert) also lists the scenes uploaded in the settings page.
  insert: (chain) => {
    let src = "/agent3d/my-scene/scene.json";
    try {
      const answer = typeof window !== "undefined" && typeof window.prompt === "function" ? window.prompt(t("block.prompt"), src) : null;
      if (answer && answer.trim()) src = answer.trim();
    } catch {
      /* headless editors: keep the sample */
    }
    return chain.insertContent({ type: NODE_NAME, attrs: { attrs: { ...DEFAULT_ATTRS, src, label: "3D scene" } } }).run();
  },
  isActive: (editor) => editor.isActive(NODE_NAME),
  inspector: SceneInspector,
  attrsSchema: {
    src: { description: "URL of the exported scene.json: a root-absolute site path such as /agent3d/<name>/scene.json (as uploaded by the settings page), a relative path, or an https URL.", format: "url" },
    poster: { description: "Poster image URL shown before the first frame and without WebGL. Empty = poster.webp next to scene.json.", format: "url" },
    runtime: { description: "URL of agent3d-runtime.js. Empty = ../agent3d-runtime/agent3d-runtime.js from the scene folder (the embed export layout).", format: "url" },
    label: { description: "Accessible label: one sentence describing the scene (read by screen readers)." },
    caption: { description: "Optional caption shown under the scene (plain text)." },
  } satisfies SettingsSchema,
};
