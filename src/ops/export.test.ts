import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import type { LibraryProvider } from "../core/library";
import { addAsset } from "./assets";
import { FILE_PROTOCOL_NOTE, buildExport } from "./export";
import { createProject } from "./project";
import { patchScene } from "./scene";

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
        "agent3d-runtime/agent3d-runtime.js",
        "agent3d-runtime/chunks/postfx-abc.js",
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
    expect(r.snippet).toBe('<script type="module" src="./agent3d-runtime/agent3d-runtime.js"></script>\n<agent3d-scene src="./spring-sale/scene.json" poster="./spring-sale/poster.png" aria-label="Spring Sale — animated 3D banner"></agent3d-scene>');
    const index = r.files["index.html"] as string;
    expect(index).toContain(r.snippet);
    expect(index).toContain("&lt;agent3d-scene");
    expect(index).toContain("Someone");
    // file:// fallback: a visible note + the poster image (classic script, runs without a server).
    expect(index).toContain(FILE_PROTOCOL_NOTE.split(" — ")[0]);
    expect(index).toContain('location.protocol === "file:"');
    expect(index).toContain('img.src = "./spring-sale/poster.png"');
    expect(r.credits.filter((c) => c.path.includes("pine-tree"))).toHaveLength(1);
    expect(r.entry).toBe("index.html");
    expect(r.sizes.assetsKb).toBeGreaterThanOrEqual(0);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
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
