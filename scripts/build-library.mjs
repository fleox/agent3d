#!/usr/bin/env node
// Regenerates library/index.json from the files in library/ + library/sources.json (provenance).
//
//   node scripts/build-library.mjs           write library/index.json
//   node scripts/build-library.mjs --check   verify only: every file valid + listed, index.json up to date
//
// Pure Node (no dependencies). For each GLB it validates the glTF 2.0 container, refuses external
// URIs (everything must be embedded) and Draco/meshopt compression (the runtime uses a plain
// GLTFLoader), then reads animation clip names, triangle count and an approximate bounding box
// (accessor min/max of POSITION through the node transforms of the default scene).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB = path.join(ROOT, "library");
const CHECK = process.argv.includes("--check");
const KIND_DIRS = { models: "model", textures: "texture", hdri: "hdri", fonts: "font" };
const FORBIDDEN_EXT = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"];

const errors = [];
const fail = (msg) => errors.push(msg);

// ---------- GLB ----------
function parseGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (bad magic)");
  if (buf.readUInt32LE(4) !== 2) throw new Error(`unsupported GLB version ${buf.readUInt32LE(4)}`);
  if (buf.readUInt32LE(8) !== buf.length) throw new Error("GLB length header does not match file size");
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error("first chunk is not JSON");
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  if (!json.asset || !String(json.asset.version).startsWith("2.")) throw new Error("asset.version is not 2.x");
  return json;
}

const COMPONENT_MAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mul(a, b) { // column-major 4x4: a * b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function apply(m, [x, y, z]) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

function analyseGlb(json) {
  const uris = [...(json.buffers || []), ...(json.images || [])].filter((x) => x.uri && !x.uri.startsWith("data:")).map((x) => x.uri);
  if (uris.length) throw new Error(`external URIs (must be embedded): ${uris.join(", ")}`);
  const bad = (json.extensionsUsed || []).filter((e) => FORBIDDEN_EXT.includes(e));
  if (bad.length) throw new Error(`unsupported compression extensions: ${bad.join(", ")}`);
  const acc = json.accessors || [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const visit = (ni, parent) => {
    const n = json.nodes[ni];
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        const pos = acc[p.attributes.POSITION];
        const count = p.indices !== undefined ? acc[p.indices].count : pos.count;
        const mode = p.mode ?? 4;
        triangles += mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
        if (!pos.min || !pos.max) continue;
        const k = pos.normalized ? 1 / COMPONENT_MAX[pos.componentType] : 1;
        const lo = pos.min.map((v) => v * k), hi = pos.max.map((v) => v * k);
        for (let i = 0; i < 8; i++) {
          const w = apply(m, [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
          for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], w[a]); max[a] = Math.max(max[a], w[a]); }
        }
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  const scene = (json.scenes || [])[json.scene ?? 0];
  for (const ni of scene?.nodes || []) visit(ni, identity());
  const r = (v) => Math.round(v * 1000) / 1000;
  const size = Number.isFinite(min[0]) ? [0, 1, 2].map((a) => r(max[a] - min[a])) : null;
  const center = Number.isFinite(min[0]) ? [0, 1, 2].map((a) => r((max[a] + min[a]) / 2)) : null;
  const minY = Number.isFinite(min[1]) ? r(min[1]) : null;
  return {
    animations: (json.animations || []).map((a, i) => a.name || `clip${i}`),
    size, center, minY,
    triangles: Math.round(triangles),
    skinned: (json.skins || []).length > 0,
    morphTargets: (json.meshes || []).some((m) => m.primitives.some((p) => p.targets?.length)),
    extensions: json.extensionsUsed || [],
  };
}

// ---------- images ----------
function imageSize(buf, file) {
  if (buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: scan for SOFn
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { format: "jpeg", width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.readUInt32BE(0) === 0x89504e47) return { format: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") {
    const t = buf.subarray(12, 16).toString();
    if (t === "VP8 ") return { format: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (t === "VP8L") { const b = buf.readUInt32LE(21); return { format: "webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    if (t === "VP8X") return { format: "webp", width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (buf.subarray(0, 2).toString() === "#?") {
    const head = buf.subarray(0, 512).toString("latin1");
    const m = /\n-Y (\d+) \+X (\d+)\n/.exec(head);
    if (!/FORMAT=32-bit_rle_rgbe/.test(head) || !m) throw new Error("bad Radiance header");
    return { format: "hdr", width: +m[2], height: +m[1] };
  }
  throw new Error(`unknown image format: ${file}`);
}

// ---------- fonts (provenance lives in library/fonts/LICENSES.md, owned by the fonts tooling) ----------
function fontMeta() {
  const f = path.join(LIB, "fonts", "LICENSES.md");
  const out = {};
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const cells = line.split("|").map((s) => s.trim());
    if (cells.length < 6 || !cells[2]?.startsWith("`")) continue;
    const file = cells[2].replace(/`/g, "");
    const lic = /Apache/i.test(cells[4]) ? "Apache-2.0" : /Open Font|OFL/i.test(cells[4]) ? "OFL-1.1" : cells[4];
    out[file] = { license: lic, author: cells[3].replace(/^.*?—\s*/, ""), source: cells[3].split(" — ")[0], origin: cells[5], catalogId: cells[1].replace(/`/g, "") };
  }
  return out;
}

// ---------- main ----------
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

const sources = JSON.parse(fs.readFileSync(path.join(LIB, "sources.json"), "utf8"));
const byPath = new Map(sources.assets.map((a) => [a.path, a]));
const fonts = fontMeta();
const assets = [];
const seen = new Set();
let total = 0;
for (const [dir, kind] of Object.entries(KIND_DIRS)) {
  for (const abs of walk(path.join(LIB, dir)).sort()) {
    const rel = path.relative(LIB, abs).split(path.sep).join("/");
    const base = path.basename(rel);
    if (base.startsWith(".") || base.endsWith(".md")) continue;
    const buf = fs.readFileSync(abs);
    total += buf.length;
    seen.add(rel);
    let meta = byPath.get(rel);
    if (!meta && kind === "font") {
      const fm = fonts[base];
      const id = base.replace(/\.typeface\.json$/, "");
      meta = fm
        ? { license: fm.license, author: fm.author, source: fm.source, sourceUrl: fm.origin, tags: ["font", "typeface", id], description: `${fm.source} — three.js typeface JSON (catalog font "${fm.catalogId}"); see fonts/LICENSES.md` }
        : { license: "see fonts/LICENSES.md", author: "", source: "", sourceUrl: "", tags: ["font", id], description: "three.js typeface JSON font" };
    }
    if (!meta) { fail(`${rel}: not listed in library/sources.json`); continue; }
    const entry = {
      id: rel, path: rel, kind,
      license: meta.license, author: meta.author, source: meta.source, sourceUrl: meta.sourceUrl,
      tags: meta.tags || [], bytes: buf.length, description: meta.description || "",
    };
    if (meta.attribution) entry.attribution = meta.attribution;
    if (meta.pack) entry.pack = meta.pack;
    try {
      if (kind === "model") {
        if (!rel.endsWith(".glb")) throw new Error("models must be single-file .glb");
        const info = analyseGlb(parseGlb(buf));
        if (info.animations.length) entry.animations = info.animations;
        entry.size = info.size;
        if (info.size) {
          const f = (v) => (v >= 10 ? Math.round(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
          entry.description += `${entry.description ? ". " : ""}Bounding box ≈ ${info.size.map(f).join(" × ")} (w × h × d, glTF units = metres, Y-up${info.skinned ? ", bind pose, faces +Z" : ""}).`;
        }
        entry.center = info.center;
        entry.minY = info.minY;
        entry.triangles = info.triangles;
        if (info.skinned) entry.skinned = true;
        if (info.morphTargets) entry.morphTargets = true;
        const ext = info.extensions.filter((e) => e !== "KHR_materials_emissive_strength");
        if (ext.length) entry.extensions = ext;
      } else if (kind === "texture" || kind === "hdri") {
        const im = imageSize(buf, rel);
        Object.assign(entry, { format: im.format, width: im.width, height: im.height });
        if (meta.set) Object.assign(entry, { set: meta.set, map: meta.map });
      } else if (kind === "font") {
        const j = JSON.parse(buf.toString("utf8"));
        if (!j.glyphs) throw new Error("not a typeface JSON (no glyphs)");
      }
    } catch (e) {
      fail(`${rel}: ${e.message}`);
      continue;
    }
    assets.push(entry);
  }
}
for (const p of byPath.keys()) if (!seen.has(p)) fail(`${p}: listed in sources.json but the file is missing`);
for (const a of assets) if (a.license.includes("CC-BY") && !a.attribution) fail(`${a.path}: CC-BY asset needs an "attribution" line`);

const index = { version: 1, generatedBy: "scripts/build-library.mjs", totalBytes: total, assets };
const text = JSON.stringify(index, null, 2) + "\n";
const target = path.join(LIB, "index.json");
if (CHECK) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (cur !== text) fail("library/index.json is out of date — run `node scripts/build-library.mjs`");
}
if (errors.length) {
  for (const e of errors) console.error("✗ " + e);
  process.exit(1);
}
if (!CHECK) fs.writeFileSync(target, text);
const counts = {};
for (const a of assets) counts[a.kind] = (counts[a.kind] || 0) + 1;
console.log(`${CHECK ? "ok" : "wrote library/index.json"}: ${assets.length} assets ${JSON.stringify(counts)}, ${(total / 1048576).toFixed(2)} MB`);
