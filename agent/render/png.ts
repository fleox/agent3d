import { inflateSync } from "node:zlib";

// Tiny PNG decoder (doctor + tests) (8-bit RGB / RGBA, non-interlaced): enough to
// assert a render is not blank.

export interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array; // width * height * channels
}

export function decodePng(buf: Uint8Array): DecodedPng {
  const b = Buffer.from(buf);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let o = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat: Buffer[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString("ascii", o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} not supported`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (!channels) throw new Error(`color type ${colorType} not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const up = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      cur[x] = v & 0xff;
    }
    pixels.set(cur, y * stride);
    prev = cur;
  }
  return { width, height, channels, pixels };
}

// Number of distinct colours (capped) and the luminance standard deviation.
export function pngVariance(png: DecodedPng): { distinct: number; stddev: number } {
  const seen = new Set<number>();
  let sum = 0;
  let sum2 = 0;
  const n = png.width * png.height;
  for (let i = 0; i < n; i++) {
    const o = i * png.channels;
    const r = png.pixels[o];
    const g = png.channels >= 3 ? png.pixels[o + 1] : r;
    const bl = png.channels >= 3 ? png.pixels[o + 2] : r;
    if (seen.size < 10000) seen.add((r << 16) | (g << 8) | bl);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    sum += l;
    sum2 += l * l;
  }
  const mean = sum / n;
  return { distinct: seen.size, stddev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}
