// Minimal PNG decoder (pure TS, no DOM, no Node): non-interlaced, bit depth
// 8 or 16 (16 keeps the high byte), grey / grey + alpha / RGB / RGBA /
// palette (8-bit, with tRNS). Decodes to straight (non-premultiplied) RGBA,
// so the depth under alpha-0 texels of a depth map survives — a browser
// canvas would zero it. Inflate goes through an injected raw-deflate
// decompressor (the zip one), or DecompressionStream("deflate-raw").

import { OpsError } from "./context";
import type { InflateRaw } from "./zip";

export interface RgbaImage {
  data: Uint8Array; // width * height * 4, straight alpha
  width: number;
  height: number;
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIG.every((b, i) => bytes[i] === b);
}

async function inflateRaw(data: Uint8Array, inflate?: InflateRaw): Promise<Uint8Array> {
  if (inflate) return inflate(data);
  const DS = (globalThis as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) throw new OpsError("io", "No inflate available to decode PNG files.", "Pass an `inflate` (raw deflate) implementation.");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePng(bytes: Uint8Array, opts: { inflate?: InflateRaw } = {}): Promise<RgbaImage> {
  if (!isPng(bytes)) throw new OpsError("invalid", "Not a PNG file.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const name = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (name === "IHDR") {
      width = dv.getUint32(pos + 8);
      height = dv.getUint32(pos + 12);
      depth = bytes[pos + 16];
      type = bytes[pos + 17];
      interlace = bytes[pos + 20];
    } else if (name === "PLTE") palette = body;
    else if (name === "tRNS") trns = body;
    else if (name === "IDAT") idat.push(body);
    else if (name === "IEND") break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!width || !height || !channels || interlace || !(depth === 8 || (depth === 16 && type !== 3)))
    throw new OpsError("invalid", `Unsupported PNG (${width}x${height}, colour type ${type}, ${depth}-bit${interlace ? ", interlaced" : ""}).`, "Use an 8-bit, non-interlaced PNG (grey, RGB or RGBA).");
  const total = idat.reduce((s, c) => s + c.length, 0);
  const z = new Uint8Array(total);
  let o = 0;
  for (const c of idat) z.set(c, (o += c.length) - c.length);
  // zlib stream: 2-byte header, raw deflate, 4-byte Adler-32.
  const raw = await inflateRaw(z.subarray(2, z.length - 4), opts.inflate);
  const bpp = Math.max(1, (channels * depth) / 8);
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) throw new OpsError("invalid", "Truncated PNG data.");
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const out = new Uint8Array(width * height * 4);
  const hi = depth === 16 ? 2 : 1;
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp;
      const d = (y * width + x) * 4;
      const ch = (k: number) => cur[s + k * hi];
      if (type === 0) {
        out[d] = out[d + 1] = out[d + 2] = ch(0);
        out[d + 3] = trns && trns.length >= 2 && ((trns[0] << 8) | trns[1]) >> (depth === 16 ? 8 : 0) === ch(0) ? 0 : 255;
      } else if (type === 4) {
        out[d] = out[d + 1] = out[d + 2] = ch(0);
        out[d + 3] = ch(1);
      } else if (type === 2) {
        out[d] = ch(0);
        out[d + 1] = ch(1);
        out[d + 2] = ch(2);
        out[d + 3] = 255;
      } else if (type === 6) {
        out[d] = ch(0);
        out[d + 1] = ch(1);
        out[d + 2] = ch(2);
        out[d + 3] = ch(3);
      } else {
        const idx = cur[x];
        out[d] = palette?.[idx * 3] ?? 0;
        out[d + 1] = palette?.[idx * 3 + 1] ?? 0;
        out[d + 2] = palette?.[idx * 3 + 2] ?? 0;
        out[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
    prev.set(cur);
  }
  return { data: out, width, height };
}
