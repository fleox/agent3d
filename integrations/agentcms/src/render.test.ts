import { describe, expect, it } from "vitest";
import { aspectFromScene, decodeAttrs, encodeAttrs, relativeToExport, renderSceneMarkers, safeUrl, sceneHtml, scenesInExport, safeAspect, shouldUpload, withDefaults } from "./render";

const attrs = { src: "/agent3d/bakery/scene.json", poster: "", runtime: "", label: "Golden Crust: a warm 3D title", caption: "Fresh <bread>", aspect: "" };

describe("agent3d-scene block rendering", () => {
  it("round-trips attributes (UTF-8 safe)", () => {
    const a = { ...attrs, label: "Boulangerie dorée 🥐" };
    expect(decodeAttrs(encodeAttrs(a))).toEqual(a);
    expect(decodeAttrs("not base64!")).toEqual({ src: "", poster: "", runtime: "", label: "", caption: "", aspect: "" });
  });

  it("derives poster and runtime from the export layout", () => {
    const d = withDefaults(attrs);
    expect(d.poster).toBe("/agent3d/bakery/poster.webp");
    expect(d.runtime).toBe("/agent3d/agent3d-runtime/agent3d-runtime.js");
  });

  it("renders the runtime script, the element and an escaped caption", () => {
    const html = sceneHtml(attrs);
    expect(html).toContain('<script type="module" src="/agent3d/agent3d-runtime/agent3d-runtime.js"></script>');
    expect(html).toContain('<agent3d-scene src="/agent3d/bakery/scene.json" role="img" aria-label="Golden Crust: a warm 3D title"');
    expect(html).toContain('<img slot="poster" src="/agent3d/bakery/poster.webp" alt="Golden Crust: a warm 3D title"');
    expect(html).toContain("Fresh &lt;bread&gt;");
  });

  it("prefixes the base path of sites hosted in a sub-folder, once", () => {
    const html = sceneHtml(attrs, "/blog");
    expect(html).toContain('src="/blog/agent3d/bakery/scene.json"');
    expect(html).toContain('src="/blog/agent3d/agent3d-runtime/agent3d-runtime.js"');
    expect(sceneHtml({ ...attrs, src: "/blog/agent3d/bakery/scene.json" }, "/blog")).toContain('src="/blog/agent3d/bakery/scene.json"');
  });

  it("refuses unsafe URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("//evil.example/x.js")).toBe("");
    expect(safeUrl("data:text/html,x")).toBe("");
    expect(safeUrl('/x" onload="y')).toBe("");
    expect(safeUrl("https://cdn.example.com/a/scene.json")).toBe("https://cdn.example.com/a/scene.json");
    expect(sceneHtml({ ...attrs, src: "javascript:alert(1)" })).toBe("");
  });

  it("replaces markers at publish time", () => {
    const marker = `<p>Hi</p><div data-cms-block="agent3d-scene/scene" data-attrs="${encodeAttrs(attrs)}"></div>`;
    const out = renderSceneMarkers(marker);
    expect(out).toContain("<agent3d-scene");
    expect(out).not.toContain("data-cms-block");
  });

  it("finds scenes in an uploaded export folder", () => {
    const paths = ["agent3d-runtime/agent3d-runtime.js", "agent3d-runtime/chunks/a.js", "bakery/scene.json", "bakery/poster.webp", "index.html", "snippet.html"];
    expect(scenesInExport(paths, "agent3d")).toEqual([
      { name: "bakery", src: "/agent3d/bakery/scene.json", poster: "/agent3d/bakery/poster.webp", runtime: "/agent3d/agent3d-runtime/agent3d-runtime.js", label: "" },
    ]);
    expect(relativeToExport("embed/bakery/scene.json")).toBe("bakery/scene.json");
    expect(shouldUpload("index.html")).toBe(false);
    expect(shouldUpload(".DS_Store")).toBe(false);
    expect(shouldUpload("bakery/assets/library/fonts/sans-bold.typeface.json")).toBe(true);
  });

  it("reserves the aspect ratio and rejects bad values", () => {
    expect(safeAspect("4:1")).toBe("4:1");
    expect(safeAspect("21/9")).toBe("21:9");
    expect(safeAspect("1:0")).toBe("");
    expect(safeAspect('4:1" onload="x')).toBe("");
    const html = sceneHtml({ ...attrs, aspect: "4:1" });
    expect(html).toContain('aspect="4:1"');
    expect(html).toContain("aspect-ratio:4 / 1");
    expect(sceneHtml(attrs)).not.toContain("aspect");
    expect(aspectFromScene('{"target":{"kind":"banner","aspect":"4:1"}}')).toBe("4:1");
    expect(aspectFromScene("not json")).toBe("");
  });

  it("finds a cache-busted runtime folder and skips local-only files", () => {
    const paths = ["agent3d-runtime-3f9a1c/agent3d-runtime.js", "agent3d-runtime-3f9a1c/chunks/a.js", "hero/scene.json", "hero/poster.webp", "EMBED.md", "head.html", "frameworks/react/Agent3DScene.tsx"];
    expect(scenesInExport(paths, "agent3d", { hero: "16:9" })).toEqual([
      { name: "hero", src: "/agent3d/hero/scene.json", poster: "/agent3d/hero/poster.webp", runtime: "/agent3d/agent3d-runtime-3f9a1c/agent3d-runtime.js", label: "", aspect: "16:9" },
    ]);
    expect(shouldUpload("EMBED.md")).toBe(false);
    expect(shouldUpload("head.html")).toBe(false);
    expect(shouldUpload("frameworks/vue/Agent3DScene.vue")).toBe(false);
    expect(shouldUpload("hero/og-image.png")).toBe(true);
  });
});
