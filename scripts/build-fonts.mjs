#!/usr/bin/env node
// Rebuilds the bundled 3D-text fonts (library/fonts/<id>.typeface.json) from
// their original free sources (OFL / Apache). Developer tool only: it is the one
// place that downloads fonts, once, into a cache folder; nothing at build or
// run time ever fetches a font.
//
//   node scripts/build-fonts.mjs --opentype <opentype.module.js> [--cache .agent3d-tmp/fonts-src] [--only id,id]
//
// opentype.js is not a project dependency (`npm pack opentype.js@1.3.4`, then
// pass package/dist/opentype.module.js). Sources: google/fonts on GitHub for
// static families, the Fontsource npm packages (static instances generated
// from the Google Fonts variable fonts, latin + latin-ext subsets merged) for
// the others. Keep library/fonts/LICENSES.md in sync with FONTS below, then run
// `node scripts/build-library.mjs`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertFile } from "./convert-font.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GF = "https://raw.githubusercontent.com/google/fonts/main/ofl";
const FS = (pkg, ver, sub, w) => `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@${ver}/files/${pkg}-${sub}-${w}-normal.woff`;
const fontsource = (pkg, w, ver = "5.1.0") => ({ url: FS(pkg, ver, "latin", w), merge: FS(pkg, ver, "latin-ext", w) });

// id → source. `family` is the name stored in the JSON. Fonts whose OFL
// notice declares a Reserved Font Name (`rfn`) get a neutral family name: a
// subset is a modified version, which the OFL forbids to carry the RFN.
export const FONTS = [
  { id: "sans-bold", family: "Inter Bold", ...fontsource("inter", 700) },
  { id: "sans", family: "Inter", ...fontsource("inter", 400) },
  { id: "inter-black", family: "Inter Black", ...fontsource("inter", 900) },
  { id: "serif-bold", family: "A3D Serif Bold", rfn: "Playfair Display", ...fontsource("playfair-display", 700) },
  { id: "serif", family: "A3D Serif", rfn: "Playfair Display", ...fontsource("playfair-display", 400) },
  { id: "mono", family: "JetBrains Mono Bold", ...fontsource("jetbrains-mono", 700) },
  { id: "display", family: "Fredoka SemiBold", ...fontsource("fredoka", 600) },
  { id: "montserrat-extrabold", family: "Montserrat ExtraBold", ...fontsource("montserrat", 800) },
  { id: "space-grotesk-bold", family: "Space Grotesk Bold", ...fontsource("space-grotesk", 700) },
  { id: "bebas-neue", family: "Bebas Neue", url: `${GF}/bebasneue/BebasNeue-Regular.ttf` },
  { id: "anton", family: "Anton", url: `${GF}/anton/Anton-Regular.ttf` },
  { id: "pacifico", family: "Pacifico", url: `${GF}/pacifico/Pacifico-Regular.ttf` },
  { id: "lobster", family: "A3D Script Bold", rfn: "Lobster", url: `${GF}/lobster/Lobster-Regular.ttf` },
];

async function cached(url, cache) {
  const file = join(cache, url.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_"));
  if (existsSync(file)) return file;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (n, d) => {
    const i = args.indexOf(n);
    return i < 0 ? d : args[i + 1];
  };
  const opentypePath = flag("--opentype");
  if (!opentypePath) {
    console.error("usage: build-fonts.mjs --opentype <opentype.module.js> [--cache dir] [--only id,id]");
    process.exit(2);
  }
  const cache = resolve(flag("--cache", join(ROOT, ".agent3d-tmp", "fonts-src")));
  const only = flag("--only")?.split(",");
  mkdirSync(cache, { recursive: true });
  for (const f of FONTS) {
    if (only && !only.includes(f.id)) continue;
    const input = await cached(f.url, cache);
    const merge = f.merge ? await cached(f.merge, cache) : undefined;
    const out = join(ROOT, "library", "fonts", `${f.id}.typeface.json`);
    const r = await convertFile(input, out, { opentypePath, family: f.family, merge });
    console.error(`${f.id.padEnd(22)} ${f.family.padEnd(24)} ${String(r.glyphs).padStart(4)} glyphs ${String(r.pairs).padStart(5)} kern pairs ${(r.bytes / 1024).toFixed(1).padStart(6)} KB${r.missing.length ? `  missing: ${r.missing.join("")}` : ""}`);
  }
  // Sanity: the JSON of every font parses.
  for (const f of FONTS) JSON.parse(readFileSync(join(ROOT, "library", "fonts", `${f.id}.typeface.json`), "utf8"));
}
