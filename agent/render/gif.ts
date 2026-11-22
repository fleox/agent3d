// Animated GIF encoder in pure TS (no native dependency) for `render --gif`.
//
// - One global palette (median cut over pixels sampled from every frame): no
//   palette flicker between frames.
// - Optional ordered (Bayer 4×4) dithering — stable from frame to frame, unlike
//   error diffusion which "boils" in animations.
// - Frame differencing: pixels unchanged since the previous frame become
//   transparent and each frame is cropped to the changed rectangle (big savings
//   on banners where only part of the picture moves). Scenes with alpha keep
//   full frames (disposal "restore to background").
// - Exact timing: per-frame delays in centiseconds accumulate without drift.

export interface GifFrame {
  rgba: Uint8Array; // width * height * 4
}

export interface GifOptions {
  width: number;
  height: number;
  fps: number;
  loop?: number; // 0 = forever (default), n = repeat n times, -1 = play once
  dither?: boolean; // default true
  colors?: number; // palette size 2..256 (default 256)
  // Alpha below this is transparent (scenes with target.transparent).
  alphaThreshold?: number;
}

type Box = { colors: Uint32Array; lo: number; hi: number };

function channel(c: number, ch: number): number {
  return (c >>> (ch * 8)) & 0xff;
}

// Median cut: `count` representative colours of the sampled RGB values (0xBBGGRR).
export function medianCut(samples: Uint32Array, count: number): [number, number, number][] {
  if (!samples.length) return [[0, 0, 0]];
  const boxes: Box[] = [{ colors: samples, lo: 0, hi: samples.length }];
  const range = (b: Box) => {
    let best = 0, bestRange = -1;
    for (let ch = 0; ch < 3; ch++) {
      let mn = 255, mx = 0;
      for (let i = b.lo; i < b.hi; i++) {
        const v = channel(b.colors[i], ch);
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      // Perceptual weights (green matters most).
      const r = (mx - mn) * (ch === 1 ? 1.2 : ch === 0 ? 1 : 0.8);
      if (r > bestRange) (bestRange = r), (best = ch);
    }
    return { ch: best, r: bestRange };
  };
  while (boxes.length < count) {
    let pick = -1, score = 0, pickCh = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo < 2) continue;
      const { ch, r } = range(b);
      const s = r * Math.sqrt(b.hi - b.lo);
      if (s > score) (score = s), (pick = i), (pickCh = ch);
    }
    if (pick < 0) break;
    const b = boxes[pick];
    const sub = b.colors.subarray(b.lo, b.hi).sort((x, y) => channel(x, pickCh) - channel(y, pickCh));
    b.colors.set(sub, b.lo);
    const mid = b.lo + ((b.hi - b.lo) >> 1);
    boxes.splice(pick, 1, { colors: b.colors, lo: b.lo, hi: mid }, { colors: b.colors, lo: mid, hi: b.hi });
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (let i = b.lo; i < b.hi; i++) {
      const c = b.colors[i];
      r += c & 0xff;
      g += (c >>> 8) & 0xff;
      bl += (c >>> 16) & 0xff;
    }
    const n = Math.max(1, b.hi - b.lo);
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  });
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

class Mapper {
  private cache = new Int16Array(32768).fill(-1);
  constructor(private palette: [number, number, number][], private offset: number) {}
  index(r: number, g: number, b: number): number {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = this.cache[key];
    if (hit >= 0) return hit;
    // Nearest colour to the cell centre (weighted RGB distance).
    const cr = (r & ~7) | 4, cg = (g & ~7) | 4, cb = (b & ~7) | 4;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.palette.length; i++) {
      const p = this.palette[i];
      const dr = p[0] - cr, dg = p[1] - cg, db = p[2] - cb;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bestD) (bestD = d), (best = i);
    }
    const idx = best + this.offset;
    this.cache[key] = idx;
    return idx;
  }
}

// GIF LZW (variable code size, clear when the table is full).
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out: number[] = [];
  let cur = 0, bits = 0;
  let size = minCodeSize + 1;
  const emit = (code: number) => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(cur & 0xff);
      cur >>>= 8;
      bits -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  let prefix = indices.length ? indices[0] : 0;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCodeSize + 1;
    }
    prefix = k;
  }
  if (indices.length) emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 0xff);
  return new Uint8Array(out);
}

class Bytes {
  private parts: number[] = [];
  private chunks: Uint8Array[] = [];
  byte(b: number) {
    this.parts.push(b & 0xff);
  }
  u16(n: number) {
    this.byte(n);
    this.byte(n >> 8);
  }
  str(s: string) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  raw(b: Uint8Array) {
    this.flush();
    this.chunks.push(b);
  }
  private flush() {
    if (this.parts.length) this.chunks.push(new Uint8Array(this.parts));
    this.parts = [];
  }
  done(): Uint8Array {
    this.flush();
    const out = new Uint8Array(this.chunks.reduce((a, c) => a + c.byteLength, 0));
    let o = 0;
    for (const c of this.chunks) (out.set(c, o), (o += c.byteLength));
    return out;
  }
}

function subBlocks(data: Uint8Array): Uint8Array {
  const n = Math.ceil(data.length / 255);
  const out = new Uint8Array(data.length + n + 1);
  let o = 0;
  for (let i = 0; i < data.length; i += 255) {
    const len = Math.min(255, data.length - i);
    out[o++] = len;
    out.set(data.subarray(i, i + len), o);
    o += len;
  }
  out[o] = 0;
  return out;
}

export function encodeGif(frames: GifFrame[], opts: GifOptions): Uint8Array {
  const { width: w, height: h } = opts;
  if (!frames.length) throw new Error("no frames");
  const threshold = opts.alphaThreshold ?? 128;
  const px = w * h;
  let hasAlpha = false;
  for (const f of frames) {
    if (f.rgba.length !== px * 4) throw new Error("frame size mismatch");
    if (!hasAlpha) for (let i = 3; i < f.rgba.length; i += 16) if (f.rgba[i] < threshold) { hasAlpha = true; break; }
  }
  // Index 0 is reserved for transparency (alpha, or unchanged pixels).
  const colors = Math.max(2, Math.min(256, opts.colors ?? 256)) - 1;
  const target = 200_000;
  const step = Math.max(1, Math.floor((px * frames.length) / target));
  const samples: number[] = [];
  let k = 0;
  for (const f of frames) {
    for (let i = (k++ * 7) % step; i < px; i += step) {
      const o = i * 4;
      if (f.rgba[o + 3] < threshold) continue;
      samples.push(f.rgba[o] | (f.rgba[o + 1] << 8) | (f.rgba[o + 2] << 16));
    }
  }
  const palette = medianCut(Uint32Array.from(samples), colors);
  const mapper = new Mapper(palette, 1);
  const dither = opts.dither !== false;
  const amp = dither ? 255 / Math.cbrt(palette.length) / 2 : 0;

  const out = new Bytes();
  out.str("GIF89a");
  out.u16(w);
  out.u16(h);
  out.byte(0xf7); // global colour table, 8 bits, 256 entries
  out.byte(0);
  out.byte(0);
  const table = new Uint8Array(256 * 3);
  palette.forEach((c, i) => table.set(c, (i + 1) * 3));
  out.raw(table);
  if (opts.loop !== -1) {
    out.byte(0x21);
    out.byte(0xff);
    out.byte(11);
    out.str("NETSCAPE2.0");
    out.byte(3);
    out.byte(1);
    out.u16(opts.loop ?? 0);
    out.byte(0);
  }
  let prev: Uint8Array | null = null;
  const cs = (i: number) => Math.round((i * 100) / opts.fps);
  for (let fi = 0; fi < frames.length; fi++) {
    const rgba = frames[fi].rgba;
    const idx = new Uint8Array(px);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const o = p * 4;
        if (rgba[o + 3] < threshold) {
          idx[p] = 0;
          continue;
        }
        const d = amp * BAYER4[((y & 3) << 2) | (x & 3)];
        const r = Math.max(0, Math.min(255, rgba[o] + d)) | 0;
        const g = Math.max(0, Math.min(255, rgba[o + 1] + d)) | 0;
        const b = Math.max(0, Math.min(255, rgba[o + 2] + d)) | 0;
        idx[p] = mapper.index(r, g, b);
      }
    }
    // Changed rectangle (full frame for the first one and for alpha scenes).
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    let data = idx;
    if (prev && !hasAlpha) {
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (idx[p] !== prev[p]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      if (x1 < 0) (x0 = 0), (y0 = 0), (x1 = 0), (y1 = 0); // identical frame: 1 transparent pixel
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      data = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const p = (y + y0) * w + (x + x0);
          data[y * cw + x] = idx[p] === prev[p] ? 0 : idx[p];
        }
    }
    const transparent = hasAlpha || !!prev;
    // Graphic control extension.
    out.byte(0x21);
    out.byte(0xf9);
    out.byte(4);
    const disposal = hasAlpha ? 2 : 1;
    out.byte((disposal << 2) | (transparent ? 1 : 0));
    out.u16(Math.max(2, cs(fi + 1) - cs(fi)));
    out.byte(0);
    out.byte(0);
    // Image descriptor.
    out.byte(0x2c);
    out.u16(x0);
    out.u16(y0);
    out.u16(x1 - x0 + 1);
    out.u16(y1 - y0 + 1);
    out.byte(0);
    out.byte(8);
    out.raw(subBlocks(lzwEncode(data, 8)));
    prev = idx;
  }
  out.byte(0x3b);
  return out.done();
}

// ─── Decoder (tests): frames as palette indices + delays ────────────────

export function decodeGifInfo(gif: Uint8Array): { width: number; height: number; frames: number; delays: number[]; loop: boolean } {
  const s = String.fromCharCode(...gif.subarray(0, 6));
  if (s !== "GIF89a" && s !== "GIF87a") throw new Error("not a GIF");
  const width = gif[6] | (gif[7] << 8), height = gif[8] | (gif[9] << 8);
  let o = 13;
  if (gif[10] & 0x80) o += 3 * (1 << ((gif[10] & 7) + 1));
  const delays: number[] = [];
  let frames = 0, loop = false;
  const skipBlocks = () => {
    while (gif[o] !== 0) o += gif[o] + 1;
    o++;
  };
  while (o < gif.length) {
    const b = gif[o++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = gif[o++];
      if (label === 0xf9) delays.push(gif[o + 2] | (gif[o + 3] << 8));
      if (label === 0xff && String.fromCharCode(...gif.subarray(o + 1, o + 12)) === "NETSCAPE2.0") loop = true;
      skipBlocks();
    } else if (b === 0x2c) {
      frames++;
      const flags = gif[o + 8];
      o += 9;
      if (flags & 0x80) o += 3 * (1 << ((flags & 7) + 1));
      o++; // min code size
      skipBlocks();
    } else throw new Error(`bad GIF block 0x${b.toString(16)} at ${o - 1}`);
  }
  return { width, height, frames, delays, loop };
}
