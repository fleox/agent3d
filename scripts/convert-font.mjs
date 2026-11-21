#!/usr/bin/env node
// Builds a three.js typeface JSON font (library/fonts/<id>.typeface.json),
// restricted to Latin + Latin-1 supplement + common punctuation / € / Œ œ Ÿ,
// from either:
//   - an existing typeface JSON (subset only):   node scripts/convert-font.mjs in.typeface.json out.json
//   - a TTF/OTF (needs opentype.js, not a project dependency — pass its ESM
//     build with --opentype <path/to/opentype.module.js>, e.g. from `npm pack opentype.js@1.3.4`):
//         node scripts/convert-font.mjs in.ttf out.json --opentype ./opentype.module.js [--family "Name"]
// The conversion mirrors three/addons/loaders/TTFLoader.js.
// One-off developer tool: it is never run at build or run time.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

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
const [input, output] = args;
if (!input || !output) {
  console.error("usage: convert-font.mjs <in.ttf|in.typeface.json> <out.typeface.json> [--opentype opentype.module.js] [--family Name]");
  process.exit(2);
}

// Charset kept in every font.
const CHARS = new Set();
for (let c = 0x20; c <= 0x7e; c++) CHARS.add(String.fromCharCode(c));
for (let c = 0xa0; c <= 0xff; c++) CHARS.add(String.fromCharCode(c));
for (const ch of "ŒœŸŠšŽžƒ€‘’‚“”„–—…•‹›™†‡°ˆ˜") CHARS.add(ch);

let json;
if (input.endsWith(".json")) {
  json = JSON.parse(readFileSync(input, "utf8"));
} else {
  if (!opentypePath) {
    console.error("A TTF input needs --opentype <path to opentype.module.js>");
    process.exit(2);
  }
  const mod = await import(pathToFileURL(resolve(opentypePath)).href);
  const opentype = mod.default ?? mod;
  const buf = readFileSync(input);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const scale = 100000 / ((font.unitsPerEm || 2048) * 72);
  const round = Math.round;
  const glyphs = {};
  const glyphIndexMap = font.encoding.cmap.glyphIndexMap;
  for (const code of Object.keys(glyphIndexMap)) {
    const glyph = font.glyphs.glyphs[glyphIndexMap[code]];
    const ch = String.fromCodePoint(Number(code));
    if (glyph.unicode === undefined || !CHARS.has(ch)) continue;
    const token = { ha: round(glyph.advanceWidth * scale), x_min: round((glyph.xMin ?? 0) * scale), x_max: round((glyph.xMax ?? 0) * scale), o: "" };
    for (const cmd of glyph.path.commands) {
      if (cmd.type === "M") token.o += `m ${round(cmd.x * scale)} ${round(cmd.y * scale)} `;
      else if (cmd.type === "L") token.o += `l ${round(cmd.x * scale)} ${round(cmd.y * scale)} `;
      else if (cmd.type === "Q") token.o += `q ${round(cmd.x * scale)} ${round(cmd.y * scale)} ${round(cmd.x1 * scale)} ${round(cmd.y1 * scale)} `;
      else if (cmd.type === "C") token.o += `b ${round(cmd.x * scale)} ${round(cmd.y * scale)} ${round(cmd.x1 * scale)} ${round(cmd.y1 * scale)} ${round(cmd.x2 * scale)} ${round(cmd.y2 * scale)} `;
    }
    token.o = token.o.trim();
    glyphs[ch] = token;
  }
  const names = font.names;
  const en = (k) => names[k]?.en;
  json = {
    glyphs,
    familyName: family ?? en("fontFamily"),
    ascender: round(font.ascender * scale),
    descender: round(font.descender * scale),
    underlinePosition: round((font.tables.post?.underlinePosition ?? -100) * scale),
    underlineThickness: round((font.tables.post?.underlineThickness ?? 50) * scale),
    boundingBox: { yMin: round(font.tables.head.yMin * scale), xMin: round(font.tables.head.xMin * scale), yMax: round(font.tables.head.yMax * scale), xMax: round(font.tables.head.xMax * scale) },
    resolution: 1000,
    original_font_information: { copyright: en("copyright"), license_description: en("license"), license_url: en("licenseURL"), designer: en("designer") },
  };
}

// Subset + trim metadata.
const glyphs = {};
for (const [ch, g] of Object.entries(json.glyphs)) if (CHARS.has(ch)) glyphs[ch] = { ha: g.ha, x_min: g.x_min, x_max: g.x_max, o: g.o };
const info = json.original_font_information ?? {};
const out = {
  glyphs,
  familyName: family ?? json.familyName,
  ascender: json.ascender,
  descender: json.descender,
  underlinePosition: json.underlinePosition,
  underlineThickness: json.underlineThickness,
  boundingBox: json.boundingBox,
  resolution: json.resolution,
  original_font_information: { copyright: info.copyright, license_description: info.license_description, license_url: info.license_url ?? info.licence_url, designer: info.designer },
};
writeFileSync(output, JSON.stringify(out));
const missing = [...CHARS].filter((c) => !glyphs[c] && c !== "­");
console.error(`${output}: ${Object.keys(glyphs).length} glyphs, ${(JSON.stringify(out).length / 1024).toFixed(1)} KB${missing.length ? `, missing: ${missing.join("")}` : ""}`);
