// Animated WebP muxer: still WebP frames (canvas.toDataURL("image/webp"), lossy
// VP8 with an optional ALPH chunk, or lossless VP8L) → one RIFF file with
// VP8X + ANIM + ANMF chunks. Exact per-frame durations (ms, no drift).

const enc = new TextEncoder();

function u24(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}
function chunk(tag: string, data: Uint8Array): Uint8Array {
  const pad = data.byteLength & 1;
  const out = new Uint8Array(8 + data.byteLength + pad);
  out.set(enc.encode(tag), 0);
  out.set(u32le(data.byteLength), 4);
  out.set(data, 8);
  return out;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.byteLength));
  return out;
}

// The image chunks of a still WebP (ALPH + VP8, or VP8L, or VP8), its size and alpha.
export function webpImageChunks(webp: Uint8Array): { chunks: Uint8Array; width: number; height: number; alpha: boolean } {
  const dv = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const tag = (o: number) => String.fromCharCode(webp[o], webp[o + 1], webp[o + 2], webp[o + 3]);
  if (webp.byteLength < 20 || tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new Error("not a WebP image");
  const keep: Uint8Array[] = [];
  let width = 0, height = 0, alpha = false;
  let o = 12;
  while (o + 8 <= webp.byteLength) {
    const t = tag(o);
    const size = dv.getUint32(o + 4, true);
    const body = webp.subarray(o + 8, o + 8 + size);
    if (t === "VP8X") {
      width = 1 + (body[4] | (body[5] << 8) | (body[6] << 16));
      height = 1 + (body[7] | (body[8] << 8) | (body[9] << 16));
      alpha = !!(body[0] & 0x10);
    } else if (t === "ALPH") {
      alpha = true;
      keep.push(chunk(t, body));
    } else if (t === "VP8 ") {
      if (!width) {
        width = (body[6] | (body[7] << 8)) & 0x3fff;
        height = (body[8] | (body[9] << 8)) & 0x3fff;
      }
      keep.push(chunk(t, body));
    } else if (t === "VP8L") {
      const b = body[1] | (body[2] << 8) | (body[3] << 16) | (body[4] << 24);
      if (!width) {
        width = (b & 0x3fff) + 1;
        height = ((b >>> 14) & 0x3fff) + 1;
      }
      if ((b >>> 28) & 1) alpha = true;
      keep.push(chunk(t, body));
    }
    o += 8 + size + (size & 1);
  }
  if (!keep.length) throw new Error("no image data in the WebP");
  return { chunks: concat(keep), width, height, alpha };
}

export function muxAnimatedWebp(frames: Uint8Array[], opts: { fps: number; loop?: number; background?: [number, number, number, number] }): Uint8Array {
  if (!frames.length) throw new Error("no frames");
  const parsed = frames.map(webpImageChunks);
  const { width, height } = parsed[0];
  const alpha = parsed.some((p) => p.alpha);
  const vp8x = new Uint8Array([0x02 | (alpha ? 0x10 : 0), 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]);
  const bg = opts.background ?? [0, 0, 0, 0];
  const anim = new Uint8Array([bg[2], bg[1], bg[0], bg[3], (opts.loop ?? 0) & 0xff, ((opts.loop ?? 0) >> 8) & 0xff]);
  const ms = (i: number) => Math.round((i * 1000) / opts.fps);
  const anmf = parsed.map((p, i) => {
    if (p.width !== width || p.height !== height) throw new Error("frame size mismatch");
    const head = new Uint8Array([...u24(0), ...u24(0), ...u24(width - 1), ...u24(height - 1), ...u24(Math.max(1, ms(i + 1) - ms(i))), 0x02 /* no blend, no dispose */]);
    return chunk("ANMF", concat([head, p.chunks]));
  });
  const body = concat([enc.encode("WEBP"), chunk("VP8X", vp8x), chunk("ANIM", anim), ...anmf]);
  return concat([enc.encode("RIFF"), new Uint8Array(u32le(body.byteLength)), body]);
}
