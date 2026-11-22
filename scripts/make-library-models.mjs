#!/usr/bin/env node
// One-off maintainer script: downloads free, account-less models (CC0 / CC-BY)
// and prepares them for library/models/:
//   - keeps only the listed animation clips (optional),
//   - drops KHR_materials_variants (the runtime shows the default look; the
//     alternative textures would only add weight),
//   - downsizes embedded textures to `maxTexture` px (needs ImageMagick's
//     `magick` on the maintainer's machine; the runtime never needs it),
//   - compacts the binary chunk (unreferenced buffer views / accessors removed).
// Then add the provenance to library/sources.json (done for the models below)
// and run `node scripts/build-library.mjs`.
//
//   node scripts/make-library-models.mjs            download + write every model below
//   node scripts/make-library-models.mjs <name>…    only these
//
// Network is used here only (never by the runtime / tests).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KHRONOS = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";
const KAYKIT = "https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf";

const CLIPS = ["Idle", "Walking_A", "Running_A", "Jump_Full_Short", "Cheer", "Interact", "PickUp", "Sit_Chair_Idle", "Hit_A", "Death_A", "Block", "1H_Melee_Attack_Chop", "Throw", "Spellcast_Shoot"];

const PH = (id, out) => ({ name: id, out, polyhaven: id, maxTexture: 1024 });

export const MODELS = [
  { name: "sneaker", out: "models/products/sneaker.glb", url: `${KHRONOS}/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb`, maxTexture: 1024 },
  { name: "lounge-chair", out: "models/products/lounge-chair.glb", url: `${KHRONOS}/SheenChair/glTF-Binary/SheenChair.glb`, maxTexture: 1024 },
  { name: "velvet-sofa", out: "models/products/velvet-sofa.glb", url: `${KHRONOS}/GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb`, maxTexture: 1024 },
  { name: "iridescent-lamp", out: "models/products/iridescent-lamp.glb", url: `${KHRONOS}/IridescenceLamp/glTF-Binary/IridescenceLamp.glb`, maxTexture: 1024 },
  { name: "barbarian", out: "models/characters/barbarian.glb", url: `${KAYKIT}/Barbarian.glb`, maxTexture: 1024, clips: CLIPS },
  { name: "rogue", out: "models/characters/rogue.glb", url: `${KAYKIT}/Rogue_Hooded.glb`, maxTexture: 1024, clips: CLIPS },
  // Poly Haven (CC0): glTF 1k packed into a single .glb.
  PH("potted_plant_04", "models/props/potted-succulent.glb"),
  PH("modern_arm_chair_01", "models/props/modern-armchair.glb"),
  PH("rubber_duck_toy", "models/props/rubber-duck.glb"),
  PH("coffee_table_round_01", "models/props/coffee-table.glb"),
  PH("food_apple_01", "models/food/apple.glb"),
  PH("alarm_clock_01", "models/props/alarm-clock.glb"),
  PH("marble_bust_01", "models/props/marble-bust.glb"),
  PH("brass_vase_03", "models/props/brass-vase.glb"),
];

// Poly Haven glTF (separate .bin + textures) → one GLB buffer.
async function polyhavenGlb(id) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const g = files.gltf?.["1k"]?.gltf;
  if (!g) throw new Error(`${id}: no 1k glTF on Poly Haven`);
  const json = await (await fetch(g.url)).json();
  const include = g.include || {};
  const get = async (uri) => {
    const key = decodeURIComponent(uri);
    const hit = include[key] || include[uri];
    if (!hit) throw new Error(`${id}: missing include ${uri}`);
    return Buffer.from(await (await fetch(hit.url)).arrayBuffer());
  };
  // One buffer expected; images become buffer views appended after it.
  if ((json.buffers || []).length !== 1) throw new Error(`${id}: expected one buffer`);
  let bin = await get(json.buffers[0].uri);
  const parts = [bin];
  let offset = bin.length;
  for (const im of json.images || []) {
    if (!im.uri) continue;
    const data = await get(im.uri);
    const pad = offset % 4 ? 4 - (offset % 4) : 0;
    if (pad) parts.push(Buffer.alloc(pad)), (offset += pad);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    im.bufferView = json.bufferViews.length - 1;
    im.mimeType = /\.png$/i.test(im.uri) ? "image/png" : "image/jpeg";
    delete im.uri;
    parts.push(data);
    offset += data.length;
  }
  bin = Buffer.concat(parts);
  json.buffers = [{ byteLength: bin.length }];
  return { json, bin };
}

// ---------- GLB io ----------
export function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  let bin = Buffer.alloc(0);
  const off = 20 + jsonLen;
  if (off < buf.length) {
    const binLen = buf.readUInt32LE(off);
    bin = buf.subarray(off + 8, off + 8 + binLen);
  }
  return { json, bin };
}

export function writeGlb(json, bin) {
  const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const jsonBuf = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binBuf = pad(bin, 0);
  const total = 12 + 8 + jsonBuf.length + (binBuf.length ? 8 + binBuf.length : 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const parts = [head, jh, jsonBuf];
  if (binBuf.length) {
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(binBuf.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    parts.push(bh, binBuf);
  }
  return Buffer.concat(parts);
}

// ---------- transforms ----------
export function keepClips(json, names) {
  if (!names || !json.animations) return;
  json.animations = json.animations.filter((a) => names.includes(a.name));
}

export function dropVariants(json) {
  for (const m of json.meshes || []) for (const p of m.primitives) if (p.extensions) delete p.extensions.KHR_materials_variants;
  if (json.extensions) delete json.extensions.KHR_materials_variants;
  json.extensionsUsed = (json.extensionsUsed || []).filter((e) => e !== "KHR_materials_variants");
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((e) => e !== "KHR_materials_variants");
  // Lights embedded in samples are scene props, not product parts.
  for (const n of json.nodes || []) if (n.extensions) delete n.extensions.KHR_lights_punctual;
  if (json.extensions) delete json.extensions.KHR_lights_punctual;
  json.extensionsUsed = json.extensionsUsed.filter((e) => e !== "KHR_lights_punctual");
}

// Removes unused materials / textures / images / samplers, then rebuilds the
// binary chunk with only the referenced buffer views.
export function compact(json, bin) {
  // Materials in use.
  const usedMat = new Set();
  for (const m of json.meshes || []) for (const p of m.primitives) if (p.material !== undefined) usedMat.add(p.material);
  const matMap = remap(json.materials, usedMat);
  json.materials = (json.materials || []).filter((_, i) => usedMat.has(i));
  for (const m of json.meshes || []) for (const p of m.primitives) if (p.material !== undefined) p.material = matMap.get(p.material);
  // Textures referenced by materials (any `index` inside a *Texture object).
  const usedTex = new Set();
  const visit = (o, fn) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object" && /Texture$/i.test(k) && typeof v.index === "number") fn(v);
      visit(v, fn);
    }
  };
  visit(json.materials, (t) => usedTex.add(t.index));
  const texMap = remap(json.textures, usedTex);
  visit(json.materials, (t) => (t.index = texMap.get(t.index)));
  json.textures = (json.textures || []).filter((_, i) => usedTex.has(i));
  const usedImg = new Set();
  const usedSamp = new Set();
  const texSource = (t) => [t.source, t.extensions?.EXT_texture_webp?.source].filter((x) => x !== undefined);
  for (const t of json.textures) {
    for (const s of texSource(t)) usedImg.add(s);
    if (t.sampler !== undefined) usedSamp.add(t.sampler);
  }
  const imgMap = remap(json.images, usedImg);
  const sampMap = remap(json.samplers, usedSamp);
  for (const t of json.textures) {
    if (t.source !== undefined) t.source = imgMap.get(t.source);
    if (t.extensions?.EXT_texture_webp) t.extensions.EXT_texture_webp.source = imgMap.get(t.extensions.EXT_texture_webp.source);
    if (t.sampler !== undefined) t.sampler = sampMap.get(t.sampler);
  }
  json.images = (json.images || []).filter((_, i) => usedImg.has(i));
  json.samplers = (json.samplers || []).filter((_, i) => usedSamp.has(i));
  // Accessors in use.
  const usedAcc = new Set();
  for (const m of json.meshes || [])
    for (const p of m.primitives) {
      for (const a of Object.values(p.attributes)) usedAcc.add(a);
      if (p.indices !== undefined) usedAcc.add(p.indices);
      for (const t of p.targets || []) for (const a of Object.values(t)) usedAcc.add(a);
    }
  for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices);
  for (const a of json.animations || []) for (const s of a.samplers) usedAcc.add(s.input), usedAcc.add(s.output);
  const accMap = remap(json.accessors, usedAcc);
  for (const m of json.meshes || [])
    for (const p of m.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] = accMap.get(p.attributes[k]);
      if (p.indices !== undefined) p.indices = accMap.get(p.indices);
      for (const t of p.targets || []) for (const k of Object.keys(t)) t[k] = accMap.get(t[k]);
    }
  for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
  for (const a of json.animations || []) for (const s of a.samplers) (s.input = accMap.get(s.input)), (s.output = accMap.get(s.output));
  json.accessors = (json.accessors || []).filter((_, i) => usedAcc.has(i));
  // Buffer views in use → new binary chunk.
  const usedBv = new Set();
  for (const a of json.accessors) {
    if (a.bufferView !== undefined) usedBv.add(a.bufferView);
    if (a.sparse) usedBv.add(a.sparse.indices.bufferView), usedBv.add(a.sparse.values.bufferView);
  }
  for (const im of json.images) if (im.bufferView !== undefined) usedBv.add(im.bufferView);
  const chunks = [];
  let offset = 0;
  const bvMap = new Map();
  const views = [];
  (json.bufferViews || []).forEach((bv, i) => {
    if (!usedBv.has(i)) return;
    const data = bv.data ?? bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const padTo = offset % 4 ? 4 - (offset % 4) : 0;
    if (padTo) chunks.push(Buffer.alloc(padTo)), (offset += padTo);
    const nv = { ...bv, buffer: 0, byteOffset: offset, byteLength: data.length };
    delete nv.data;
    bvMap.set(i, views.length);
    views.push(nv);
    chunks.push(data);
    offset += data.length;
  });
  for (const a of json.accessors) {
    if (a.bufferView !== undefined) a.bufferView = bvMap.get(a.bufferView);
    if (a.sparse) (a.sparse.indices.bufferView = bvMap.get(a.sparse.indices.bufferView)), (a.sparse.values.bufferView = bvMap.get(a.sparse.values.bufferView));
  }
  for (const im of json.images) if (im.bufferView !== undefined) im.bufferView = bvMap.get(im.bufferView);
  json.bufferViews = views;
  const out = Buffer.concat(chunks);
  json.buffers = [{ byteLength: out.length }];
  for (const k of ["materials", "textures", "images", "samplers", "animations"]) if (Array.isArray(json[k]) && json[k].length === 0) delete json[k];
  return out;
}

function remap(list, used) {
  const map = new Map();
  let k = 0;
  (list || []).forEach((_, i) => {
    if (used.has(i)) map.set(i, k++);
  });
  return map;
}

// Downsizes embedded images with ImageMagick (maintainer tool) — marks the
// buffer view with the new bytes (`data`), compact() then packs it.
function downsizeImages(json, bin, maxSize) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "a3d-lib-"));
  for (const [i, im] of (json.images || []).entries()) {
    if (im.bufferView === undefined) continue;
    const bv = json.bufferViews[im.bufferView];
    const data = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    const inExt = im.mimeType === "image/png" ? "png" : im.mimeType === "image/webp" ? "webp" : "jpg";
    const src = path.join(tmp, `in${i}.${inExt}`);
    fs.writeFileSync(src, data);
    // Opaque PNGs (colour, normal, ORM maps) are re-encoded as JPEG: far lighter.
    const opaque = inExt === "png" && spawnSync("magick", ["identify", "-format", "%[opaque]", src], { encoding: "utf8" }).stdout.trim().toLowerCase() === "true";
    const ext = opaque ? "jpg" : inExt;
    const dst = path.join(tmp, `out${i}.${ext}`);
    const args = [src, "-resize", `${maxSize}x${maxSize}>`, "-strip"];
    if (ext === "jpg") args.push("-quality", opaque ? "88" : "85");
    if (ext === "webp") args.push("-quality", "82");
    if (ext === "png") args.push("-define", "png:compression-level=9");
    args.push(dst);
    const r = spawnSync("magick", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`magick failed (install ImageMagick): ${r.stderr || r.error}`);
    const out = fs.readFileSync(dst);
    if (out.length < data.length) {
      bv.data = out;
      if (opaque) im.mimeType = "image/jpeg";
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  const only = process.argv.slice(2);
  for (const m of MODELS) {
    if (only.length && !only.includes(m.name)) continue;
    let src, json, bin;
    if (m.polyhaven) {
      ({ json, bin } = await polyhavenGlb(m.polyhaven));
      src = bin;
    } else {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`${m.name}: HTTP ${res.status} for ${m.url}`);
      src = Buffer.from(await res.arrayBuffer());
      ({ json, bin } = readGlb(src));
    }
    keepClips(json, m.clips);
    dropVariants(json);
    if (m.maxTexture) downsizeImages(json, bin, m.maxTexture);
    const out = writeGlb(json, compact(json, bin));
    const dest = path.join(ROOT, "library", m.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
    console.log(`${m.name}: ${(src.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB  (${m.out})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
