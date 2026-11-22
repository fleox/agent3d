import { describe, expect, it } from "vitest";
import { MemoryFs } from "../core/fs";
import { addAsset, downloadAsset, importAssetZip, listAssets, listLibrary, removeAsset, searchAssets, searchAssetsDetailed } from "./assets";
import { createProject } from "./project";
import { patchScene } from "./scene";
import type { FetchLike } from "./sources";
import { KENNEY_PACKS, QUATERNIUS_PACKS } from "./sources";
import { writeZipStored } from "./zip";

const enc = new TextEncoder();

// Stub fetch: URL (prefix) → JSON value or bytes. Records calls. No network.
function stubFetch(routes: Record<string, unknown>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" };
    const v = routes[key];
    const bytes = v instanceof Uint8Array ? v : enc.encode(JSON.stringify(v));
    return { ok: true, status: 200, json: async () => JSON.parse(new TextDecoder().decode(bytes)), arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes) };
  }) as FetchLike & { calls: string[] };
  f.calls = calls;
  return f;
}

const PH = "https://api.polyhaven.com";
const polyhavenRoutes = {
  [`${PH}/assets?t=hdris`]: { sunset_sky: { name: "Sunset Sky", type: 0, tags: ["sunset", "sky"], categories: ["outdoor"], authors: { "Greg Zaal": "All" } }, studio_small: { name: "Studio Small", type: 0, tags: ["studio"] } },
  [`${PH}/assets?t=textures`]: { wood_planks: { name: "Wood Planks", type: 1, tags: ["wood", "floor"], authors: { Rob: "All" } } },
  [`${PH}/assets?t=models`]: { pine_tree: { name: "Pine Tree", type: 2, tags: ["tree", "pine"] } },
  [`${PH}/files/sunset_sky`]: { hdri: { "1k": { hdr: { url: "https://dl.polyhaven.org/sunset_sky_1k.hdr" } }, "2k": { hdr: { url: "https://dl.polyhaven.org/sunset_sky_2k.hdr" } } } },
  [`${PH}/files/wood_planks`]: {
    Diffuse: { "1k": { jpg: { url: "https://dl.polyhaven.org/wood_diff.jpg" } } },
    nor_gl: { "1k": { jpg: { url: "https://dl.polyhaven.org/wood_nor.jpg" } } },
    Rough: { "1k": { jpg: { url: "https://dl.polyhaven.org/wood_rough.jpg" } } },
  },
  [`${PH}/files/pine_tree`]: { gltf: { "1k": { gltf: { url: "https://dl.polyhaven.org/pine.gltf", include: { "pine_tree.bin": { url: "https://dl.polyhaven.org/pine.bin" }, "textures/pine_diff_1k.jpg": { url: "https://dl.polyhaven.org/pine_diff.jpg" } } } } } },
  "https://dl.polyhaven.org/": new Uint8Array([1, 2, 3]),
};

describe("asset sources (stubbed fetch)", () => {
  it("ranks Poly Haven by name / tags / categories, not descriptions", async () => {
    const models = {
      modern_arm_chair_01: { name: "Modern Arm Chair 01", type: 2, tags: ["wood", "chair", "wooden"], categories: ["furniture", "seating"], description: "Modern wooden armchair with warm oak frame." },
      wine_barrel_01: { name: "Wine Barrel 01", type: 2, tags: ["barrel", "wine"], categories: ["containers"], description: "Barrel with worn oak staves." },
      tree_small_02: { name: "Tree Small 02", type: 2, tags: ["oak", "nature", "plant"], categories: ["nature"] },
      oak_tree_01: { name: "Oak Tree 01", type: 2, tags: ["tree", "nature"], categories: ["nature", "plants"] },
      island_tree_03: { name: "Island Tree 03", type: 2, tags: ["palm", "trees"], categories: ["nature"] },
    };
    const fetch = stubFetch({ [`${PH}/assets?t=models`]: models });
    const oak = await searchAssets({ query: "oak", kind: "model", source: "polyhaven" }, fetch);
    expect(oak.map((h) => h.id)).toEqual(["oak_tree_01", "tree_small_02"]);
    // plural / singular and one typo still match by name or tag
    expect((await searchAssets({ query: "trees", kind: "model", source: "polyhaven" }, fetch)).map((h) => h.id).slice(0, 2)).toEqual(expect.arrayContaining(["oak_tree_01", "tree_small_02"]));
    expect((await searchAssets({ query: "barel", kind: "model", source: "polyhaven" }, fetch)).map((h) => h.id)).toEqual(["wine_barrel_01"]);
    expect(await searchAssets({ query: "frame", kind: "model", source: "polyhaven" }, fetch)).toEqual([]);
  });

  it("searches Poly Haven and downloads an HDRI", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    const fetch = stubFetch(polyhavenRoutes);
    const hits = await searchAssets({ query: "sunset", source: "polyhaven" }, fetch);
    expect(hits[0]).toMatchObject({ source: "polyhaven", id: "sunset_sky", kind: "hdri", license: "CC0-1.0", author: "Greg Zaal" });
    const entry = await downloadAsset(fs, hits[0], fetch, { resolution: "2k" });
    expect(entry.path).toBe("assets/hdris/sunset_sky.hdr");
    expect(fetch.calls).toContain("https://dl.polyhaven.org/sunset_sky_2k.hdr");
    expect(entry.suggestion).toEqual({ environment: { lighting: { hdri: "assets/hdris/sunset_sky.hdr" }, background: { hdri: "assets/hdris/sunset_sky.hdr", blur: 0.5 } } });
    const listed = await listAssets(fs);
    expect(listed.assets[0]).toMatchObject({ path: "assets/hdris/sunset_sky.hdr", source: "polyhaven", license: "CC0-1.0", exists: true });
  });

  it("downloads a Poly Haven texture set and model with relative layout", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    const fetch = stubFetch(polyhavenRoutes);
    const [tex] = await searchAssets({ query: "wood", source: "polyhaven", kind: "texture" }, fetch);
    const t = await downloadAsset(fs, tex, fetch);
    expect(t.files).toEqual(["assets/textures/wood_planks/wood_planks_diff_1k.jpg", "assets/textures/wood_planks/wood_planks_nor_gl_1k.jpg", "assets/textures/wood_planks/wood_planks_rough_1k.jpg"]);
    expect(t.suggestion).toEqual({ material: { map: "assets/textures/wood_planks/wood_planks_diff_1k.jpg", normalMap: "assets/textures/wood_planks/wood_planks_nor_gl_1k.jpg", roughnessMap: "assets/textures/wood_planks/wood_planks_rough_1k.jpg" } });
    const [model] = await searchAssets({ query: "pine", source: "polyhaven", kind: "model" }, fetch);
    const m = await downloadAsset(fs, model, fetch, { name: "pine" });
    expect(m.path).toBe("assets/models/pine/pine_tree_1k.gltf");
    expect(m.files).toContain("assets/models/pine/textures/pine_diff_1k.jpg");
    expect(m.files).toContain("assets/models/pine/pine_tree.bin");
  });

  it("searches ambientCG and extracts the texture zip", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    const zip = writeZipStored({ "Wood_1K-JPG_Color.jpg": new Uint8Array([1]), "Wood_1K-JPG_NormalGL.jpg": new Uint8Array([2]), "Wood_1K-JPG_Roughness.jpg": new Uint8Array([3]), "Wood_1K-JPG_NormalDX.jpg": new Uint8Array([4]), "Wood.blend": new Uint8Array([5]) });
    const fetch = stubFetch({
      "https://ambientcg.com/api/v2/full_json?type=Material": {
        foundAssets: [{ assetId: "Wood096", displayName: "Wood 096", tags: ["wood"], previewImage: { "256-PNG": "https://acg/prev.png" }, downloadFolders: { default: { downloadFiletypeCategories: { zip: { downloads: [{ attribute: "1K-JPG", downloadLink: "https://ambientcg.com/get?file=Wood096_1K-JPG.zip" }, { attribute: "2K-JPG", downloadLink: "https://ambientcg.com/get?file=Wood096_2K-JPG.zip" }] } } } } }],
      },
      "https://ambientcg.com/get?file=Wood096_1K-JPG.zip": zip,
    });
    const hits = await searchAssets({ query: "wood", source: "ambientcg", kind: "texture" }, fetch);
    expect(hits[0]).toMatchObject({ id: "Wood096", kind: "texture", license: "CC0-1.0", downloads: { "1K-JPG": expect.any(String) } });
    const r = await downloadAsset(fs, hits[0], fetch, { resolution: "1k" });
    expect(r.files.sort()).toEqual(["assets/textures/wood096/Wood_1K-JPG_Color.jpg", "assets/textures/wood096/Wood_1K-JPG_NormalGL.jpg", "assets/textures/wood096/Wood_1K-JPG_Roughness.jpg"]);
    expect(r.suggestion).toMatchObject({ material: { map: "assets/textures/wood096/Wood_1K-JPG_Color.jpg" } });
  });

  it("keeps only CC0 / CC-BY Khronos models and records attribution", async () => {
    const RAW = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";
    const fetch = stubFetch({
      [`${RAW}/model-index.json`]: [
        { label: "Fox", name: "Fox", screenshot: "screenshot/screenshot.jpg", tags: ["animation"], variants: { "glTF-Binary": "Fox.glb" } },
        { label: "Damaged Helmet", name: "DamagedHelmet", variants: { "glTF-Binary": "DamagedHelmet.glb" } },
        { label: "Duck", name: "Duck", variants: { "glTF-Binary": "Duck.glb" } },
      ],
      [`${RAW}/Fox/metadata.json`]: { legal: [{ license: "CC0-1.0", artist: "PixelMannen", what: "Model" }, { license: "CC-BY-4.0", artist: "tomkranis", what: "Rigging" }] },
      [`${RAW}/DamagedHelmet/metadata.json`]: { legal: [{ license: "CC-BY-NC-4.0", artist: "x" }] },
      [`${RAW}/Duck/metadata.json`]: { legal: [{ license: "SCEA", artist: "Sony" }] },
      [`${RAW}/Fox/glTF-Binary/Fox.glb`]: new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
    });
    expect((await searchAssets({ query: "helmet", source: "khronos" }, fetch)).length).toBe(0);
    expect((await searchAssets({ query: "duck", source: "khronos" }, fetch)).length).toBe(0);
    const [fox] = await searchAssets({ query: "fox", source: "khronos" }, fetch);
    expect(fox).toMatchObject({ id: "Fox", license: "CC-BY-4.0", author: "PixelMannen, tomkranis", attribution: expect.stringContaining("tomkranis") });
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    const entry = await downloadAsset(fs, fox, fetch);
    expect(entry).toMatchObject({ path: "assets/models/fox.glb", license: "CC-BY-4.0", attribution: expect.stringContaining("Khronos") });
  });

  it("curated Kenney / Quaternius packs are manual downloads", async () => {
    const fetch = stubFetch({});
    const hits = await searchAssets({ query: "tree", source: "kenney" }, fetch);
    expect(hits[0]).toMatchObject({ source: "kenney", id: "nature-kit", manual: true, license: "CC0-1.0", downloads: {} });
    expect(fetch.calls).toEqual([]);
    const fs = new MemoryFs();
    await expect(downloadAsset(fs, hits[0], fetch)).rejects.toMatchObject({ code: "invalid", hint: expect.stringContaining("kenney.nl/assets/nature-kit") });
    expect((await searchAssets({ query: "fox", source: "quaternius" }, fetch))[0].id).toBe("ultimateanimatedanimals");
    expect(KENNEY_PACKS.every((p) => p.pageUrl.startsWith("https://kenney.nl/assets/"))).toBe(true);
    expect(QUATERNIUS_PACKS.every((p) => p.pageUrl.startsWith("https://quaternius.com/packs/"))).toBe(true);
  });

  it("all-source search tolerates failing sources and sorts manual hits last", async () => {
    const fetch = stubFetch(polyhavenRoutes);
    const r = await searchAssetsDetailed({ query: "tree" }, fetch);
    expect(r.errors.map((e) => e.source).sort()).toEqual(["ambientcg", "khronos"]);
    expect(r.hits[0].source).toBe("polyhaven");
    expect(r.hits[r.hits.length - 1].manual).toBe(true);
    await expect(searchAssets({ query: "tree", source: "khronos" }, fetch)).rejects.toMatchObject({ code: "io" });
    await expect(searchAssets({ query: "x", source: "nope" as never }, fetch)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("project assets", () => {
  it("add / list / remove, reporting usage", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    const e = await addAsset(fs, { path: "logo.svg", bytes: enc.encode("<svg/>"), source: "local", license: "CC0-1.0" });
    expect(e.path).toBe("assets/svg/logo.svg");
    await fs.writeBytes("assets/stray.png", new Uint8Array(3));
    await patchScene(fs, [{ op: "addObject", object: { id: "logo", kind: "svg", src: "assets/svg/logo.svg" } }]);
    const l = await listAssets(fs);
    expect(l.assets.find((a) => a.path === "assets/svg/logo.svg")!.usedBy).toEqual(["objects#logo.src"]);
    expect(l.assets.find((a) => a.path === "assets/stray.png")!.license).toBe("unknown");
    expect(await removeAsset(fs, "assets/svg/logo.svg")).toEqual({ removed: true, usedBy: ["objects#logo.src"] });
    await expect(removeAsset(fs, "assets/svg/logo.svg")).rejects.toMatchObject({ code: "notFound" });
    await expect(addAsset(fs, { path: "../x.png", bytes: new Uint8Array(1), source: "local", license: "CC0-1.0" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("imports a pack zip (glTF + textures only, optional filter)", async () => {
    const fs = new MemoryFs();
    await createProject(fs, { name: "p" });
    const zip = writeZipStored({
      "kenney_nature-kit/Models/GLB format/tree_pine.glb": new Uint8Array([1]),
      "kenney_nature-kit/Models/GLB format/rock_large.glb": new Uint8Array([2]),
      "kenney_nature-kit/Models/FBX format/tree_pine.fbx": new Uint8Array([3]),
      "kenney_nature-kit/License.txt": "CC0",
    });
    const r = await importAssetZip(fs, zip, { name: "nature-kit", source: "kenney", license: "CC0-1.0", author: "Kenney", filter: ["tree"] });
    expect(r.models).toEqual(["assets/models/nature-kit/tree_pine.glb"]);
    const all = await importAssetZip(fs, zip, { name: "nature-kit", source: "kenney", license: "CC0-1.0" });
    expect(all.models.sort()).toEqual(["assets/models/nature-kit/rock_large.glb", "assets/models/nature-kit/tree_pine.glb"]);
  });

  it("lists the library", () => {
    const index = { assets: [{ id: "nature/pine-tree", path: "models/nature/pine-tree.glb", kind: "model" as const, license: "CC0-1.0", tags: ["tree", "pine"], bytes: 20480, description: "Low-poly pine" }, { id: "hdri/studio", path: "hdri/studio.hdr", kind: "hdri" as const, license: "CC0-1.0", tags: ["studio"], bytes: 1, description: "Studio" }] };
    expect(listLibrary(index, { query: "pine" }).assets).toEqual([{ id: "nature/pine-tree", ref: "library:nature/pine-tree", kind: "model", license: "CC0-1.0", tags: ["tree", "pine"], description: "Low-poly pine", kb: 20 }]);
    expect(listLibrary(index, { kind: "hdri" }).total).toBe(1);
  });

  it("pages the library (limit, offset, 0 = all) and shows animation clips", () => {
    const assets = Array.from({ length: 120 }, (_, i) => ({ id: `models/x/m${i}.glb`, path: `models/x/m${i}.glb`, kind: "model" as const, license: "CC0-1.0", tags: ["x"], bytes: 1024, description: "" }));
    assets[3] = { ...assets[3], animations: ["Idle", "Walk"], triangles: 1200 } as (typeof assets)[number];
    const index = { assets };
    const first = listLibrary(index);
    expect(first.assets.length).toBe(50);
    expect(first).toMatchObject({ total: 120, offset: 0, more: true });
    expect(first.assets[3]).toMatchObject({ animations: ["Idle", "Walk"], triangles: 1200 });
    expect(listLibrary(index, { limit: 0 }).assets.length).toBe(120);
    const last = listLibrary(index, { limit: 50, offset: 100 });
    expect(last.assets.length).toBe(20);
    expect(last.more).toBe(false);
    expect(listLibrary(index, { query: "walk" }).assets.map((a) => a.id)).toEqual(["models/x/m3.glb"]);
  });
});
