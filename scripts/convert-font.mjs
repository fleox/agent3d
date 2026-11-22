#!/usr/bin/env node
// Builds a three.js typeface JSON font (library/fonts/<id>.typeface.json),
// restricted to Latin + Latin-1 supplement + common punctuation / € / Œ œ Ÿ,
// with the font's kerning pairs, from either:
//   - an existing typeface JSON (subset only):   node scripts/convert-font.mjs in.typeface.json out.json
//   - a TTF / OTF / WOFF (needs opentype.js, not a project dependency — pass its ESM
//     build with --opentype <path/to/opentype.module.js>, e.g. from `npm pack opentype.js@1.3.4`):
//         node scripts/convert-font.mjs in.ttf out.json --opentype ./opentype.module.js [--family "Name"]
//              [--merge extra.woff]   take the glyphs missing from the input from a second file
//                                     (e.g. the latin-ext subset of the same font)
// The outline conversion mirrors three/addons/loaders/TTFLoader.js. Kerning is
// read from GPOS ("kern" feature, pair adjustment lookups, also behind
// extension lookups) or the legacy `kern` table (scripts/font-kerning.mjs) and
// stored as `kerning: { "<left char>": { "<right char>": adjustment } }` in
// glyph units (same scale as `ha`). Pairs are kept between unaccented
// characters only; the runtime kerns accented letters like their base letter
// (é → e) when the pair is missing. `capHeight` / `xHeight` come from OS/2.
// One-off developer tool: it is never run at build or run time
// (scripts/build-fonts.mjs drives it for the bundled set).

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { gposKerning, kernTableKerning, readSfntTables } from "./font-kerning.mjs";

// Charset kept in every font.
export const CHARS = new Set();
for (let c = 0x20; c <= 0x7e; c++) CHARS.add(String.fromCharCode(c));
for (let c = 0xa0; c <= 0xff; c++) CHARS.add(String.fromCharCode(c));
for (const ch of "ŒœŸŠšŽžƒ€‘’‚“”„–—…•‹›™†‡°ˆ˜") CHARS.add(ch);

// Characters kerning pairs are stored for (accented letters fall back to their base letter at run time).
export const KERN_CHARS = [...CHARS].filter((c) => c.trim() && c.normalize("NFD").length === 1 && c !== "­");

// Adjustments smaller than this (glyph units, ≈ 0.4 % of the em) are dropped.
const KERN_MIN = 5;

function parseOt(opentype, path) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { font: opentype.parse(ab), tables: readSfntTables(new Uint8Array(ab)) };
}

export function convertOpentype(opentype, input, { family, merge } = {}) {
  const { font, tables } = parseOt(opentype, input);
  const scale = 100000 / ((font.unitsPerEm || 2048) * 72);
  const round = Math.round;
  const glyphs = {};
  const addGlyphs = (f, sc) => {
    const map = f.encoding.cmap.glyphIndexMap;
    for (const code of Object.keys(map)) {
      const glyph = f.glyphs.get(map[code]);
      const ch = String.fromCodePoint(Number(code));
      if (!CHARS.has(ch) || glyphs[ch]) continue;
      const token = { ha: round(glyph.advanceWidth * sc), x_min: round((glyph.xMin ?? 0) * sc), x_max: round((glyph.xMax ?? 0) * sc), o: "" };
      for (const cmd of glyph.path.commands) {
        if (cmd.type === "M") token.o += `m ${round(cmd.x * sc)} ${round(cmd.y * sc)} `;
        else if (cmd.type === "L") token.o += `l ${round(cmd.x * sc)} ${round(cmd.y * sc)} `;
        else if (cmd.type === "Q") token.o += `q ${round(cmd.x * sc)} ${round(cmd.y * sc)} ${round(cmd.x1 * sc)} ${round(cmd.y1 * sc)} `;
        else if (cmd.type === "C") token.o += `b ${round(cmd.x * sc)} ${round(cmd.y * sc)} ${round(cmd.x1 * sc)} ${round(cmd.y1 * sc)} ${round(cmd.x2 * sc)} ${round(cmd.y2 * sc)} `;
      }
      token.o = token.o.trim();
      glyphs[ch] = token;
    }
  };
  addGlyphs(font, scale);
  if (merge) {
    const extra = parseOt(opentype, merge).font;
    addGlyphs(extra, 100000 / ((extra.unitsPerEm || 2048) * 72));
  }

  // Kerning between the stored characters.
  const pairFn = gposKerning(tables.GPOS) ?? kernTableKerning(tables.kern);
  const kerning = {};
  let pairs = 0;
  if (pairFn) {
    const gid = new Map(KERN_CHARS.filter((c) => glyphs[c]).map((c) => [c, font.charToGlyphIndex(c)]));
    for (const [l, gl] of gid) {
      if (!gl) continue;
      for (const [r, gr] of gid) {
        if (!gr) continue;
        const v = round(pairFn(gl, gr) * scale);
        if (Math.abs(v) < KERN_MIN) continue;
        (kerning[l] ??= {})[r] = v;
        pairs++;
      }
    }
  }

  const names = font.names;
  const en = (k) => names[k]?.en;
  const os2 = font.tables.os2 ?? {};
  return {
    pairs,
    json: {
      glyphs,
      familyName: family ?? en("fontFamily"),
      ascender: round(font.ascender * scale),
      descender: round(font.descender * scale),
      underlinePosition: round((font.tables.post?.underlinePosition ?? -100) * scale),
      underlineThickness: round((font.tables.post?.underlineThickness ?? 50) * scale),
      boundingBox: { yMin: round(font.tables.head.yMin * scale), xMin: round(font.tables.head.xMin * scale), yMax: round(font.tables.head.yMax * scale), xMax: round(font.tables.head.xMax * scale) },
      resolution: 1000,
      ...(os2.sCapHeight ? { capHeight: round(os2.sCapHeight * scale) } : {}),
      ...(os2.sxHeight ? { xHeight: round(os2.sxHeight * scale) } : {}),
      ...(pairs ? { kerning } : {}),
      original_font_information: { copyright: en("copyright"), license_description: en("license"), license_url: en("licenseURL"), designer: en("designer") },
    },
  };
}

// Subset + trim metadata (also used for typeface JSON inputs).
export function finalize(json, family) {
  const glyphs = {};
  for (const [ch, g] of Object.entries(json.glyphs)) if (CHARS.has(ch)) glyphs[ch] = { ha: g.ha, x_min: g.x_min, x_max: g.x_max, o: g.o };
  let kerning;
  if (json.kerning) {
    kerning = {};
    for (const [l, row] of Object.entries(json.kerning)) {
      if (!glyphs[l]) continue;
      for (const [r, v] of Object.entries(row)) if (glyphs[r]) (kerning[l] ??= {})[r] = v;
    }
  }
  const info = json.original_font_information ?? {};
  return {
    glyphs,
    familyName: family ?? json.familyName,
    ascender: json.ascender,
    descender: json.descender,
    underlinePosition: json.underlinePosition,
    underlineThickness: json.underlineThickness,
    boundingBox: json.boundingBox,
    resolution: json.resolution,
    ...(json.capHeight ? { capHeight: json.capHeight } : {}),
    ...(json.xHeight ? { xHeight: json.xHeight } : {}),
    ...(kerning && Object.keys(kerning).length ? { kerning } : {}),
    original_font_information: { copyright: info.copyright, license_description: info.license_description, license_url: info.license_url ?? info.licence_url, designer: info.designer },
  };
}

export async function loadOpentype(path) {
  const mod = await import(pathToFileURL(resolve(path)).href);
  return mod.default ?? mod;
}

export async function convertFile(input, output, { opentypePath, family, merge } = {}) {
  let json;
  if (input.endsWith(".json")) json = JSON.parse(readFileSync(input, "utf8"));
  else {
    if (!opentypePath) throw new Error("A TTF / OTF / WOFF input needs --opentype <path to opentype.module.js>");
    json = convertOpentype(await loadOpentype(opentypePath), input, { family, merge }).json;
  }
  const out = finalize(json, family);
  const text = JSON.stringify(out);
  writeFileSync(output, text);
  const missing = [...CHARS].filter((c) => !out.glyphs[c] && c !== "­");
  const pairs = Object.values(out.kerning ?? {}).reduce((n, r) => n + Object.keys(r).length, 0);
  return { output, glyphs: Object.keys(out.glyphs).length, pairs, bytes: Buffer.byteLength(text), missing };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const opentypePath = flag("--opentype");
  const family = flag("--family");
  const merge = flag("--merge");
  const [input, output] = args;
  if (!input || !output) {
    console.error("usage: convert-font.mjs <in.ttf|in.woff|in.typeface.json> <out.typeface.json> [--opentype opentype.module.js] [--family Name] [--merge extra.woff]");
    process.exit(2);
  }
  try {
    const r = await convertFile(input, output, { opentypePath, family, merge });
    console.error(`${r.output}: ${r.glyphs} glyphs, ${r.pairs} kerning pairs, ${(r.bytes / 1024).toFixed(1)} KB${r.missing.length ? `, missing: ${r.missing.join("")}` : ""}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
