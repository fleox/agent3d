// Minimal PNG encoder (pure TS, no DOM, no Node): 8-bit grey, grey + alpha,
// RGB or RGBA, non-interlaced, adaptive per-row filters. Compression goes
// through an injected zlib `deflate`, or CompressionStream("deflate") (Node
// ≥ 18, every browser). Used for generated maps (depth maps) the ops write.

import { crc32 } from "./zip";

export type DeflateZlib = (data: Uint8Array) => Promise<Uint8Array> | Uint8Array;

export async function deflateZlib(data: Uint8Array, deflate?: DeflateZlib): Promise<Uint8Array> {
  if (deflate) return deflate(data);
  const CS = (globalThis as { CompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).CompressionStream;
  if (!CS) throw new Error("No deflate available: pass `deflate` (CompressionStream is missing).");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CS("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Channels kept in the file: 1 grey, 2 grey + alpha, 3 RGB, 4 RGBA.
// `rgba` is width * height * 4 bytes. "auto" picks the smallest exact layout.
export async function encodePng(rgba: Uint8Array, width: number, height: number, opts: { channels?: 1 | 2 | 3 | 4 | "auto"; deflate?: DeflateZlib } = {}): Promise<Uint8Array> {
  if (rgba.length !== width * height * 4) throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`);
  let channels = opts.channels ?? "auto";
  if (channels === "auto") {
    let grey = true;
    let opaque = true;
    for (let i = 0; i < rgba.length && (grey || opaque); i += 4) {
      if (rgba[i] !== rgba[i + 1] || rgba[i] !== rgba[i + 2]) grey = false;
      if (rgba[i + 3] !== 255) opaque = false;
    }
    channels = grey ? (opaque ? 1 : 2) : opaque ? 3 : 4;
  }
  const colorType = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  const row = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const cand = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = x * channels;
      if (channels === 1) row[d] = rgba[s];
      else if (channels === 2) (row[d] = rgba[s]), (row[d + 1] = rgba[s + 3]);
      else for (let c = 0; c < channels; c++) row[d + c] = rgba[s + c];
    }
    // Adaptive filter: the one with the smallest sum of |signed bytes|.
    let best = 0;
    let bestScore = Infinity;
    const out = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? row[i - channels] : 0;
        const b = prev[i];
        const c = i >= channels ? prev[i - channels] : 0;
        let p: number;
        if (f === 0) p = 0;
        else if (f === 1) p = a;
        else if (f === 2) p = b;
        else if (f === 3) p = (a + b) >> 1;
        else {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[i] - p) & 0xff;
        cand[i] = v;
        score += v < 128 ? v : 256 - v;
        if (score >= bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
        out.set(cand);
      }
    }
    raw[y * (stride + 1)] = best;
    prev.set(row);
  }
  const idat = await deflateZlib(raw, opts.deflate);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const png = new Uint8Array(total);
  png.set(sig, 0);
  let o = 8;
  for (const c of chunks) png.set(c, o), (o += c.length);
  return png;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
