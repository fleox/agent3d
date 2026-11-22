// Kerning extraction for scripts/convert-font.mjs (developer tool, never shipped).
//
// opentype.js 1.x ignores GPOS extension lookups (type 9) and only reads the
// default script, so most Google Fonts come out without kerning. This module
// reads the raw tables itself:
//   - readSfntTables(bytes)            → { tag: Uint8Array } for TTF / OTF / WOFF (zlib via node:zlib)
//   - gposKerning(gpos)                → (leftGlyph, rightGlyph) => xAdvance adjustment (font units)
//                                         from every "kern" feature (all scripts), pair adjustment
//                                         lookups (type 2, formats 1 and 2, also behind type 9 extensions)
//   - kernTableKerning(kern)           → same for the legacy `kern` table (format 0)
// Pure: no I/O besides zlib inflate.

import { inflateSync } from "node:zlib";

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readSfntTables(bytes) {
  const dv = view(bytes);
  const sig = dv.getUint32(0);
  const tables = {};
  const tagAt = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (sig === 0x774f4646) {
    // WOFF 1.0
    const num = dv.getUint16(12);
    for (let i = 0; i < num; i++) {
      const o = 44 + i * 20;
      const tag = tagAt(o);
      const off = dv.getUint32(o + 4);
      const compLen = dv.getUint32(o + 8);
      const origLen = dv.getUint32(o + 12);
      const raw = bytes.subarray(off, off + compLen);
      tables[tag] = compLen < origLen ? new Uint8Array(inflateSync(raw)) : raw;
    }
    return tables;
  }
  if (sig === 0x774f4632) throw new Error("WOFF2 is not supported: use the TTF / OTF / WOFF file");
  const num = dv.getUint16(4);
  for (let i = 0; i < num; i++) {
    const o = 12 + i * 16;
    const tag = tagAt(o);
    const off = dv.getUint32(o + 8);
    const len = dv.getUint32(o + 12);
    tables[tag] = bytes.subarray(off, off + len);
  }
  return tables;
}

function coverage(dv, off) {
  const fmt = dv.getUint16(off);
  const map = new Map();
  if (fmt === 1) {
    const n = dv.getUint16(off + 2);
    for (let i = 0; i < n; i++) map.set(dv.getUint16(off + 4 + i * 2), i);
  } else if (fmt === 2) {
    const n = dv.getUint16(off + 2);
    for (let i = 0; i < n; i++) {
      const r = off + 4 + i * 6;
      const start = dv.getUint16(r), end = dv.getUint16(r + 2), idx = dv.getUint16(r + 4);
      for (let g = start; g <= end; g++) map.set(g, idx + g - start);
    }
  }
  return map;
}

function classDef(dv, off) {
  const map = new Map();
  const fmt = dv.getUint16(off);
  if (fmt === 1) {
    const start = dv.getUint16(off + 2), n = dv.getUint16(off + 4);
    for (let i = 0; i < n; i++) map.set(start + i, dv.getUint16(off + 6 + i * 2));
  } else if (fmt === 2) {
    const n = dv.getUint16(off + 2);
    for (let i = 0; i < n; i++) {
      const r = off + 4 + i * 6;
      const start = dv.getUint16(r), end = dv.getUint16(r + 2), cls = dv.getUint16(r + 4);
      for (let g = start; g <= end; g++) map.set(g, cls);
    }
  }
  return map;
}

const popcount = (v) => {
  let n = 0;
  for (; v; v >>= 1) n += v & 1;
  return n;
};

// ValueRecord → horizontal adjustment: xAdvance of the first glyph (+ xPlacement of the second, which moves it the same way).
function valueRecord(dv, off, fmt) {
  let o = off;
  const r = {};
  for (const [bit, name] of [[1, "xPla"], [2, "yPla"], [4, "xAdv"], [8, "yAdv"], [16, "a"], [32, "b"], [64, "c"], [128, "d"]]) {
    if (fmt & bit) {
      r[name] = dv.getInt16(o);
      o += 2;
    }
  }
  return r;
}

function pairSubtable(dv, off) {
  const fmt = dv.getUint16(off);
  const cov = coverage(dv, off + dv.getUint16(off + 2));
  const vf1 = dv.getUint16(off + 4), vf2 = dv.getUint16(off + 6);
  const s1 = popcount(vf1) * 2, s2 = popcount(vf2) * 2;
  const value = (o) => (valueRecord(dv, o, vf1).xAdv ?? 0) + (valueRecord(dv, o + s1, vf2).xPla ?? 0);
  if (fmt === 1) {
    const sets = dv.getUint16(off + 8);
    const setOffs = [];
    for (let i = 0; i < sets; i++) setOffs.push(off + dv.getUint16(off + 10 + i * 2));
    return (l, r) => {
      const ci = cov.get(l);
      if (ci === undefined || ci >= sets) return undefined;
      const so = setOffs[ci];
      const n = dv.getUint16(so);
      const rec = 2 + s1 + s2;
      // Records are sorted by secondGlyph: binary search.
      let lo = 0, hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = dv.getUint16(so + 2 + mid * rec);
        if (g === r) return value(so + 2 + mid * rec + 2);
        if (g < r) lo = mid + 1;
        else hi = mid - 1;
      }
      return undefined;
    };
  }
  if (fmt === 2) {
    const cd1 = classDef(dv, off + dv.getUint16(off + 8));
    const cd2 = classDef(dv, off + dv.getUint16(off + 10));
    const c1n = dv.getUint16(off + 12), c2n = dv.getUint16(off + 14);
    const rec = s1 + s2;
    return (l, r) => {
      if (!cov.has(l)) return undefined;
      const c1 = cd1.get(l) ?? 0, c2 = cd2.get(r) ?? 0;
      if (c1 >= c1n || c2 >= c2n) return undefined;
      // A format-2 subtable answers every covered pair (class 0 = default), so it ends the search.
      return value(off + 16 + (c1 * c2n + c2) * rec);
    };
  }
  return () => undefined;
}

export function gposKerning(gpos) {
  if (!gpos) return null;
  const dv = view(gpos);
  const featureList = dv.getUint16(6), lookupList = dv.getUint16(8);
  const lookupIdx = new Set();
  const nf = dv.getUint16(featureList);
  for (let i = 0; i < nf; i++) {
    const r = featureList + 2 + i * 6;
    const tag = String.fromCharCode(gpos[r], gpos[r + 1], gpos[r + 2], gpos[r + 3]);
    if (tag !== "kern") continue;
    const fo = featureList + dv.getUint16(r + 4);
    const n = dv.getUint16(fo + 2);
    for (let k = 0; k < n; k++) lookupIdx.add(dv.getUint16(fo + 4 + k * 2));
  }
  if (!lookupIdx.size) return null;
  const lookups = [];
  for (const li of [...lookupIdx].sort((a, b) => a - b)) {
    const lo = lookupList + dv.getUint16(lookupList + 2 + li * 2);
    let type = dv.getUint16(lo);
    const n = dv.getUint16(lo + 4);
    const subs = [];
    for (let s = 0; s < n; s++) {
      let so = lo + dv.getUint16(lo + 6 + s * 2);
      if (type === 9) {
        const extType = dv.getUint16(so + 2);
        if (extType !== 2) continue;
        so = so + dv.getUint32(so + 4);
        subs.push(pairSubtable(dv, so));
      } else if (type === 2) subs.push(pairSubtable(dv, so));
    }
    if (subs.length) lookups.push(subs);
  }
  return (l, r) => {
    let total = 0;
    for (const subs of lookups) {
      for (const f of subs) {
        const v = f(l, r);
        if (v !== undefined) {
          total += v;
          break;
        }
      }
    }
    return total;
  };
}

export function kernTableKerning(kern) {
  if (!kern) return null;
  const dv = view(kern);
  const pairs = new Map();
  const version = dv.getUint16(0);
  if (version !== 0) return null;
  const n = dv.getUint16(2);
  let o = 4;
  for (let t = 0; t < n; t++) {
    const len = dv.getUint16(o + 2), coverageBits = dv.getUint16(o + 4);
    const format = coverageBits >> 8, horizontal = coverageBits & 1;
    if (format === 0 && horizontal) {
      const np = dv.getUint16(o + 6);
      for (let i = 0; i < np; i++) {
        const r = o + 14 + i * 6;
        pairs.set(dv.getUint16(r) * 65536 + dv.getUint16(r + 2), dv.getInt16(r + 4));
      }
    }
    o += len;
  }
  return pairs.size ? (l, r) => pairs.get(l * 65536 + r) ?? 0 : null;
}
