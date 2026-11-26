import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { LibraryProvider } from "../core/library";
import { addAsset } from "./assets";
import { FILE_PROTOCOL_NOTE, buildExport, posterMarkup } from "./export";
import { createProject } from "./project";
import { patchScene } from "./scene";
import { CHUNK_FEATURES } from "./runtimeChunks";

const enc = new TextEncoder();
const runtime = {
  files: {
    "agent3d-runtime.js": enc.encode("export const x = 1; // </script> inside"),
    "chunks/postfx-abc.js": enc.encode("export default 1;"),
    "agent3d-runtime.single.js": enc.encode('globalThis.Agent3D = { mountScene() {} }; const s = "</script>";'),
  },
};
const library: LibraryProvider = {
  index: { assets: [{ id: "fonts/sans-bold.typeface.json", path: "fonts/sans-bold.typeface.json", kind: "font" as const, license: "Apache-2.0", tags: [], bytes: 100, description: "Font" }, { id: "nature/pine-tree", path: "models/nature/pine-tree.glb", kind: "model", license: "CC-BY-4.0", author: "Someone", tags: ["tree"], bytes: 4, description: "Pine" }] },
  read: async () => new Uint8Array([1, 2, 3, 4]),
};

async function project() {
  const fs = new MemoryFs();
  await createProject(fs, { name: "Spring Sale" });
  await addAsset(fs, { path: "assets/textures/wood.jpg", bytes: new Uint8Array([0xff, 0xd8, 1, 2]), source: "ambientcg", license: "CC0-1.0", author: "ambientCG" });
  await fs.writeText("assets/models/duck.gltf", JSON.stringify({ buffers: [{ uri: "duck.bin" }], images: [{ uri: "tex/duck.png" }, { uri: "data:image/png;base64,AA==" }] }));
  await fs.writeBytes("assets/models/duck.bin", new Uint8Array(8));
  await fs.writeBytes("assets/models/tex/duck.png", new Uint8Array([0x89, 0x50]));
  await fs.writeText("scripts/game.js", "export default (api) => ({ update() {} });");
  const r = await patchScene(fs, [
    { op: "addObject", object: { id: "floor", kind: "mesh", geometry: { type: "plane" }, material: { map: "assets/textures/wood.jpg" } } },
    { op: "addObject", object: { id: "tree", kind: "model", src: "library:nature/pine-tree" } },
    { op: "addObject", object: { id: "tree2", kind: "model", src: "library:nature/pine-tree" } },
    { op: "addObject", object: { id: "duck", kind: "model", src: "assets/models/duck.gltf" } },
    { op: "set", path: "scripts", value: ["scripts/game.js"] },
  ]);
  expect(r.applied).toBe(true);
  return fs;
}

describe("buildExport", () => {
  it("builds the embed file map", async () => {
    const fs = await project();
    const r = await buildExport(fs, { format: "embed", runtime, library, poster: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
    expect(r.name).toBe("spring-sale");
    expect(Object.keys(r.files).sort()).toEqual(
      [
        "EMBED.md",
        "agent3d-runtime/agent3d-runtime.js",
        "agent3d-runtime/chunks/postfx-abc.js",
        "frameworks/agent3d-scene.d.ts",
        "frameworks/react/Agent3DScene.tsx",
        "frameworks/svelte/Agent3DScene.svelte",
        "frameworks/vue/Agent3DScene.vue",
        "index.html",
        "snippet.html",
        "spring-sale/CREDITS.txt",
        "spring-sale/assets/library/fonts/sans-bold.typeface.json",
        "spring-sale/assets/library/nature/pine-tree.glb",
        "spring-sale/assets/models/duck.bin",
        "spring-sale/assets/models/duck.gltf",
        "spring-sale/assets/models/tex/duck.png",
        "spring-sale/assets/textures/wood.jpg",
        "spring-sale/poster.png",
        "spring-sale/scene.json",
        "spring-sale/scripts/game.js",
      ].sort(),
    );
    const scene = JSON.parse(r.files["spring-sale/scene.json"] as string);
    expect(scene.objects.find((o: { id: string }) => o.id === "tree").src).toBe("assets/library/nature/pine-tree.glb");
    expect(JSON.stringify(scene)).not.toContain("library:");
    expect(r.integrity).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
    expect(r.snippet).toBe(
      `<script type="module" src="./agent3d-runtime/agent3d-runtime.js" integrity="${r.integrity}"></script>\n<agent3d-scene src="./spring-sale/scene.json" aspect="4:1" role="img" aria-label="Spring Sale — animated 3D banner">\n  <img slot="poster" src="./spring-sale/poster.png" alt="Spring Sale — animated 3D banner" decoding="async" style="display:block;width:100%;height:auto">\n</agent3d-scene>`,
    );
    const index = r.files["index.html"] as string;
    expect(index).toContain(r.snippet);
    expect(index).toContain("&lt;agent3d-scene");
    expect(index).toContain("Someone");
    // file:// fallback: a visible note + the poster image (classic script, runs without a server).
    expect(index).toContain(FILE_PROTOCOL_NOTE.split(" — ")[0]);
    expect(index).toContain('location.protocol === "file:"');
    expect(r.credits.filter((c) => c.path.includes("pine-tree"))).toHaveLength(1);
    expect(r.entry).toBe("index.html");
    expect(r.sizes.assetsKb).toBeGreaterThanOrEqual(0);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("emits wrappers, EMBED.md, preload hints, base URL and cache-busting", async () => {
    const fs = await project();
    const rt = {
      files: {
        "agent3d-runtime.js": enc.encode('import{a as b}from"./chunks/three-x.js";import"./chunks/util-y.js";const l=()=>import("./chunks/postfx-abc.js");'),
        "chunks/three-x.js": enc.encode('import{u}from"./util-y.js";export const a=1;' + " ".repeat(120 * 1024)),
        "chunks/util-y.js": enc.encode("export const u=1;"),
        "chunks/postfx-abc.js": enc.encode("export default 1;"),
      },
    };
    const r = await buildExport(fs, { format: "embed", runtime: rt, library, poster: new Uint8Array([0x52, 0x49]), posterSize: { width: 1200, height: 300 }, ogImage: new Uint8Array([0x89, 0x50]), baseUrl: "/static/3d", cacheBust: true });
    expect(r.runtimeDir).toMatch(/^agent3d-runtime-[0-9a-f]{10}$/);
    expect(r.files[`${r.runtimeDir}/chunks/three-x.js`]).toBeTruthy();
    expect(r.head!.split("\n")).toHaveLength(2);
    expect(r.head).toContain(`<link rel="modulepreload" href="/static/3d/${r.runtimeDir}/chunks/three-x.js" integrity="sha384-`);
    expect(r.head).not.toContain("postfx");
    expect(r.snippet).toContain("three-x.js");
    expect(r.snippet).not.toContain("util-y.js");
    expect(r.files["head.html"]).toContain("util-y.js");
    expect(r.snippet).toContain(`src="/static/3d/${r.runtimeDir}/agent3d-runtime.js"`);
    expect(r.snippet).toMatch(/src="\/static\/3d\/spring-sale\/scene\.json\?v=[0-9a-f]{10}"/);
    expect(r.snippet).toContain('width="1200" height="300"');
    expect(r.files["spring-sale/og-image.png"]).toBeTruthy();
    expect(r.files["index.html"]).toContain('property="og:image"');
    const react = r.files["frameworks/react/Agent3DScene.tsx"] as string;
    expect(react.startsWith('"use client";')).toBe(true);
    expect(react).toContain(`"/static/3d/${r.runtimeDir}/agent3d-runtime.js"`);
    expect(r.files["EMBED.md"]).toContain("Content-Security-Policy");
    expect(r.files["EMBED.md"]).toContain("WordPress");
    expect(r.files["frameworks/agent3d-scene.d.ts"]).toContain('"agent3d-scene": Agent3DSceneElement');
    await expect(buildExport(fs, { format: "embed", runtime: rt, library, baseUrl: "javascript:alert(1)" })).rejects.toMatchObject({ code: "invalid" });
    const plain = await buildExport(fs, { format: "embed", runtime: rt, library, integrity: false, extras: false });
    expect(plain.snippet).not.toContain("integrity");
    expect(plain.files["EMBED.md"]).toBeUndefined();
  });

  it("zips the embed folder", async () => {
    const fs = await project();
    const r = await buildExport(fs, { format: "zip", runtime, library });
    expect(Object.keys(r.files)).toEqual(["spring-sale-embed.zip"]);
    const { readZip } = await import("./zip");
    const files = await readZip(r.files["spring-sale-embed.zip"] as Uint8Array);
    expect(Object.keys(files)).toContain("spring-sale/scene.json");
    expect(Object.keys(files)).toContain("index.html");
    expect(new TextDecoder().decode(files["agent3d-runtime/agent3d-runtime.js"])).toContain("export const x = 1");
    expect(JSON.parse(new TextDecoder().decode(files["spring-sale/scene.json"])).title).toBe("Spring Sale");
  });

  it("builds a single self-contained html file", async () => {
    const fs = await project();
    const r = await buildExport(fs, { format: "single-html", name: "promo", runtime, library });
    expect(Object.keys(r.files)).toEqual(["promo.html"]);
    const html = r.files["promo.html"] as string;
    expect(html).toContain('<script type="application/json">{');
    expect(html).toContain("<script type=\"application/json\" data-assets>");
    expect(html).toContain('"assets/library/nature/pine-tree.glb":"data:model/gltf-binary;base64,AQIDBA=="');
    expect(html).toContain('"assets/models/duck.bin":"data:application/octet-stream;base64,');
    expect(html).toContain('<script type="text/agent3d-script" data-path="scripts/game.js">');
    expect(html).toContain("globalThis.Agent3D");
    // Runtime text containing </script> is escaped.
    expect(html).not.toMatch(/const s = "<\/script>"/);
    expect(html).not.toContain("https://");
  });

  it("refuses invalid scenes and missing runtimes", async () => {
    const fs = await project();
    await expect(buildExport(fs, { format: "embed", runtime: { files: {} }, library })).rejects.toMatchObject({ code: "invalid" });
    await fs.remove("assets/models/duck.bin");
    await expect(buildExport(fs, { format: "embed", runtime, library })).rejects.toMatchObject({ code: "notFound" });
    const scene = JSON.parse(await fs.readText("scene.json"));
    scene.camera = {};
    await fs.writeText("scene.json", JSON.stringify(scene));
    await expect(buildExport(fs, { format: "embed", runtime, library })).rejects.toMatchObject({ code: "validation" });
  });

  it("warns above the budget", async () => {
    const fs = await project();
    await addAsset(fs, { path: "assets/textures/big.jpg", bytes: new Uint8Array(700 * 1024), source: "local", license: "CC0-1.0" });
    await patchScene(fs, [{ op: "set", path: "objects#floor.material.map", value: "assets/textures/big.jpg" }]);
    const r = await buildExport(fs, { format: "embed", runtime, library });
    expect(r.issues.some((i) => i.code === "budget")).toBe(true);
  });
});

describe("export: data-bound labels, absolute og:image, poster cache-bust, wrapper props", () => {
  it("resolves {data.*} in title / ariaLabel everywhere in the generated markup", async () => {
    const fs = await project();
    await patchScene(fs, [
      { op: "set", path: "title", value: "{data.brand|Acme} spring sale" },
      { op: "set", path: "ariaLabel", value: "{data.headline} — 3D banner" },
      { op: "set", path: "data", value: { headline: "Up to 50% off" } },
    ]);
    const r = await buildExport(fs, { format: "embed", runtime, library, poster: new Uint8Array([0x52, 0x49]), ogImage: new Uint8Array([0x89, 0x50]) });
    expect(r.snippet).toContain('aria-label="Up to 50% off — 3D banner"');
    expect(r.snippet).toContain('alt="Up to 50% off — 3D banner"');
    const index = r.files["index.html"] as string;
    expect(index).toContain("<title>Acme spring sale — Agent3D embed</title>");
    expect(index).toContain('og:title" content="Acme spring sale"');
    expect(index).toContain('og:image" content="./spring-sale/og-image.png"');
    for (const f of ["index.html", "EMBED.md", "snippet.html"]) for (const k of ["{data.headline", "{data.brand"]) expect(r.files[f] as string).not.toContain(k);
  });
  it("makes og:image absolute with an https base URL and versions the poster with --cache-bust", async () => {
    const fs = await project();
    const r = await buildExport(fs, { format: "embed", runtime, library, poster: new Uint8Array([0x52, 0x49]), ogImage: new Uint8Array([0x89, 0x50]), baseUrl: "https://cdn.example.com/3d/", cacheBust: true });
    expect(r.files["index.html"]).toContain('og:image" content="https://cdn.example.com/3d/spring-sale/og-image.png"');
    expect(r.snippet).toMatch(/src="https:\/\/cdn\.example\.com\/3d\/spring-sale\/poster\.\w+\?v=[0-9a-f]{10}"/);
  });
  it("Vue and Svelte wrappers take loop, autoplay and interactive like React", async () => {
    const r = await buildExport(await project(), { format: "embed", runtime, library });
    for (const f of ["frameworks/vue/Agent3DScene.vue", "frameworks/svelte/Agent3DScene.svelte"]) {
      const src = r.files[f] as string;
      for (const p of ["loop", "autoplay", "interactive"]) expect(src).toContain(p);
    }
  });
});

describe("3D photo export", () => {
  it("copies the photo and its depth map, and loads the photo chunk only when used", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "Pic" });
    await addAsset(fs, { path: "assets/textures/pic.jpg", bytes: new Uint8Array([0xff, 0xd8, 1, 2]), source: "local", license: "CC0-1.0" });
    await addAsset(fs, { path: "assets/textures/pic.depth.png", bytes: new Uint8Array([0x89, 0x50, 1, 2]), source: "local", license: "CC0-1.0" });
    const before = JSON.parse(await fs.readText("scene.json"));
    expect(CHUNK_FEATURES.photo.needed(before, JSON.stringify(before))).toBe(false);
    await addAsset(fs, { path: "assets/depth/pic-plate.webp", bytes: new Uint8Array([0x52, 0x49, 1, 2]), source: "agent3d-plate", license: "CC0-1.0" });
    await addAsset(fs, { path: "assets/depth/pic-plate-depth.png", bytes: new Uint8Array([0x89, 0x50, 1, 3]), source: "agent3d-plate", license: "CC0-1.0" });
    const r = await patchScene(fs, [{ op: "addObject", object: { id: "pic", kind: "photo", src: "assets/textures/pic.jpg", depth: "assets/textures/pic.depth.png", plate: "assets/depth/pic-plate.webp", plateDepth: "assets/depth/pic-plate-depth.png" } }]);
    expect(r.applied).toBe(true);
    expect(CHUNK_FEATURES.photo.needed(r.scene, JSON.stringify(r.scene))).toBe(true);
    const out = await buildExport(fs, { format: "embed", runtime, library, extras: false });
    expect(Object.keys(out.files)).toEqual(expect.arrayContaining(["pic/assets/textures/pic.jpg", "pic/assets/textures/pic.depth.png", "pic/assets/depth/pic-plate.webp", "pic/assets/depth/pic-plate-depth.png"]));
  });
});

describe("export page weight (pageKb) and runtime chunks", () => {
  const big = (n: number, s = "") => enc.encode(s + " ".repeat(n));
  const rt = {
    files: {
      "agent3d-runtime.js": enc.encode('import{a}from"./chunks/three.module-AAAAAAAA.js";const p=()=>import(`./chunks/postfx-BBBBBBBB.js`);const g=()=>import(`./chunks/generators-CCCCCCCC.js`);const m=()=>import(`./chunks/model-DDDDDDDD.js`);'),
      "chunks/three.module-AAAAAAAA.js": big(5000, "export const a=1;"),
      "chunks/postfx-BBBBBBBB.js": big(3000),
      "chunks/generators-CCCCCCCC.js": big(4000),
      "chunks/model-DDDDDDDD.js": enc.encode("const l=()=>import(`./GLTFLoader-EEEEEEEE.js`);" + " ".repeat(1000)),
      "chunks/GLTFLoader-EEEEEEEE.js": big(2000),
    },
  };
  it("counts only the chunks the scene loads, separately from the folder", async () => {
    const fs = await project(); // has models, no generators
    await patchScene(fs, [{ op: "set", path: "postfx", value: [] }]);
    const og = new Uint8Array(50_000);
    const r = await buildExport(fs, { format: "embed", runtime: rt, library, ogImage: og, extras: false });
    expect(r.page.runtimeFiles.sort()).toEqual(["agent3d-runtime.js", "chunks/GLTFLoader-EEEEEEEE.js", "chunks/model-DDDDDDDD.js", "chunks/three.module-AAAAAAAA.js"]);
    expect(r.page.skippedChunks.sort()).toEqual(["chunks/generators-CCCCCCCC.js", "chunks/postfx-BBBBBBBB.js"]);
    expect(r.folderKb).toBe(r.totalKb);
    expect(r.folderKb - r.pageKb).toBeGreaterThan(50); // og-image + unused chunks + demo page
    expect(r.pageKbGzip).toBeGreaterThan(0);
    expect(r.pageKbGzip!).toBeLessThan(r.pageKb);
    // All chunks are copied by default (the runtime folder is shared by every scene of a site)…
    expect(Object.keys(r.files)).toContain("agent3d-runtime/chunks/postfx-BBBBBBBB.js");
    // …only the needed ones with pruneRuntime.
    const p = await buildExport(fs, { format: "embed", runtime: rt, library, extras: false, pruneRuntime: true });
    expect(p.page.pruned).toBe(true);
    expect(Object.keys(p.files)).not.toContain("agent3d-runtime/chunks/postfx-BBBBBBBB.js");
    expect(Object.keys(p.files)).toContain("agent3d-runtime/chunks/GLTFLoader-EEEEEEEE.js");
  });
  it("does not treat a dynamic import of an eagerly loaded file as an unknown chunk", async () => {
    const fs = await project();
    await patchScene(fs, [{ op: "set", path: "postfx", value: [] }]);
    // The model chunk also does import("three") (already loaded by the entry).
    const dyn = { files: { ...rt.files, "chunks/model-DDDDDDDD.js": enc.encode("const t=()=>import(`./three.module-AAAAAAAA.js`);const l=()=>import(`./GLTFLoader-EEEEEEEE.js`);") } };
    const r = await buildExport(fs, { format: "embed", runtime: dyn, library, extras: false, pruneRuntime: true });
    expect(r.page).toMatchObject({ pruned: true, unknownChunks: [] });
    expect(Object.keys(r.files)).not.toContain("agent3d-runtime/chunks/postfx-BBBBBBBB.js");
  });
  it("keeps every chunk when one has an unknown feature", async () => {
    const fs = await project();
    await patchScene(fs, [{ op: "set", path: "postfx", value: [] }]);
    const odd = { files: { ...rt.files, "agent3d-runtime.js": enc.encode(new TextDecoder().decode(rt.files["agent3d-runtime.js"]) + "const z=()=>import(`./chunks/mystery-FFFFFFFF.js`);"), "chunks/mystery-FFFFFFFF.js": big(10) } };
    const r = await buildExport(fs, { format: "embed", runtime: odd, library, extras: false, pruneRuntime: true });
    expect(r.page).toMatchObject({ pruned: false, unknownChunks: ["chunks/mystery-FFFFFFFF.js"] });
    expect(r.issues.some((i) => i.code === "prune-runtime")).toBe(true);
    expect(Object.keys(r.files)).toContain("agent3d-runtime/chunks/postfx-BBBBBBBB.js");
  });
});

describe("posterMarkup", () => {
  it("fetches a hero's poster first (LCP) and leaves other posters at normal priority", () => {
    expect(posterMarkup({ src: "p.webp", alt: "A", priority: true })).toContain('fetchpriority="high"');
    expect(posterMarkup({ src: "p.webp", alt: "A" })).not.toContain("fetchpriority");
  });
});

describe("photo-only lite runtime (runtimeChoice)", () => {
  const liteRt = { files: { ...runtime.files, "agent3d-photo.js": enc.encode("customElements.get('agent3d-scene');") } };
  async function photoProject(extra: Record<string, unknown> = {}) {
    const fs = new MemoryFs();
    await createProject(fs, { name: "Lake", target: { kind: "hero", aspect: "16:9" } });
    await addAsset(fs, { path: "assets/textures/lake.jpg", bytes: new Uint8Array([0xff, 0xd8, 1, 2]), source: "local", license: "CC0-1.0" });
    await addAsset(fs, { path: "assets/depth/lake-depth.png", bytes: new Uint8Array([0x89, 0x50, 1, 2]), source: "local", license: "CC0-1.0" });
    const scene = JSON.parse(await fs.readText("scene.json"));
    const next = {
      version: scene.version,
      id: "lake",
      title: "Lake",
      target: { kind: "hero", aspect: "16:9" },
      camera: { type: "perspective", fov: 35, position: [0, 0, 3.5], target: [0, 0, 0] },
      environment: { background: "#000000" },
      lights: [],
      objects: [{ id: "photo", kind: "photo", src: "assets/textures/lake.jpg", depth: "assets/depth/lake-depth.png", strength: 0.8 }],
      ...extra,
    };
    await fs.writeText("scene.json", JSON.stringify(next));
    return fs;
  }

  it("ships agent3d-photo.js alone for an eligible scene (no three.js, no modulepreload)", async () => {
    const fs = await photoProject();
    const r = await buildExport(fs, { format: "embed", runtime: liteRt, library, extras: false });
    expect(r.runtime).toBe("photo-lite");
    expect(r.runtimeReasons).toBeUndefined();
    expect(r.snippet).toContain('src="./agent3d-runtime/agent3d-photo.js" integrity="sha384-');
    expect(r.snippet).not.toContain("modulepreload");
    expect(r.head).toBeUndefined();
    expect(r.page).toMatchObject({ runtimeFiles: ["agent3d-photo.js"], skippedChunks: [], unknownChunks: [] });
    // The shared runtime folder keeps the full runtime (other scenes of the site)…
    expect(Object.keys(r.files)).toEqual(expect.arrayContaining(["agent3d-runtime/agent3d-photo.js", "agent3d-runtime/agent3d-runtime.js"]));
    // …pruned: only the lite file.
    const p = await buildExport(fs, { format: "embed", runtime: liteRt, library, extras: false, pruneRuntime: true });
    expect(Object.keys(p.files).filter((k) => k.startsWith("agent3d-runtime/"))).toEqual(["agent3d-runtime/agent3d-photo.js"]);
    expect(p.page.runtimeKb).toBeLessThan(1);
  });

  it("inlines the lite runtime in single-html exports", async () => {
    const fs = await photoProject();
    const r = await buildExport(fs, { format: "single-html", runtime: liteRt, library });
    expect(r.runtime).toBe("photo-lite");
    const html = r.files[r.entry] as string;
    expect(html).toContain("customElements.get('agent3d-scene')");
    expect(html).not.toContain("globalThis.Agent3D");
  });

  it("uses the full runtime when asked, when the scene is not eligible, or without the lite file", async () => {
    const fs = await photoProject();
    const full = await buildExport(fs, { format: "embed", runtime: liteRt, library, extras: false, runtimeChoice: "full" });
    expect(full.runtime).toBe("full");
    expect(full.runtimeReasons).toEqual(["runtime: full was requested"]);
    expect(full.snippet).toContain("agent3d-runtime.js");
    // The lite file is no lazy chunk of the full runtime.
    expect(full.page.skippedChunks).not.toContain("agent3d-photo.js");
    const pruned = await buildExport(fs, { format: "embed", runtime: liteRt, library, extras: false, runtimeChoice: "full", pruneRuntime: true });
    expect(Object.keys(pruned.files)).not.toContain("agent3d-runtime/agent3d-photo.js");
    const noLite = await buildExport(fs, { format: "embed", runtime, library, extras: false });
    expect(noLite.runtime).toBe("full");
    expect(noLite.runtimeReasons?.[0]).toContain("agent3d-photo.js");
    const timeline = await photoProject({ postfx: [{ type: "vignette" }] });
    const t = await buildExport(timeline, { format: "embed", runtime: liteRt, library, extras: false });
    expect(t.runtime).toBe("full");
    expect(t.runtimeReasons).toEqual(["post effects (postfx)"]);
    await expect(buildExport(fs, { format: "embed", runtime: liteRt, library, runtimeChoice: "lite" as "full" })).rejects.toThrow(/Unknown runtime/);
  });
});
