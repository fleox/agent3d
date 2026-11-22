// A tiny WebM (Matroska) muxer for a VP8 video made of WebP stills — the
// way `export --format video` stays deterministic: the page seeks each
// frame exactly, snapshots it as lossy WebP (its payload IS a VP8 key
// frame), and we write the frames with exact timestamps (no real-time
// MediaRecorder, no dropped frames on slow software rendering).

const enc = new TextEncoder();

function vintSize(n: number): Uint8Array {
  // 8-byte size: 0x01 + 7 bytes big-endian.
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function idBytes(id: number): Uint8Array {
  const bytes: number[] = [];
  let v = id;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array(bytes);
}

function uintBytes(n: number): Uint8Array {
  const bytes: number[] = [];
  let v = Math.floor(n);
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return new Uint8Array(bytes);
}

function floatBytes(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

type El = [number, Uint8Array | El[] | number | string | { float: number }];

function encodeEl([id, value]: El): Uint8Array {
  let data: Uint8Array;
  if (Array.isArray(value)) data = concat(value.map(encodeEl));
  else if (value instanceof Uint8Array) data = value;
  else if (typeof value === "number") data = uintBytes(value);
  else if (typeof value === "string") data = enc.encode(value);
  else data = floatBytes(value.float);
  return concat([idBytes(id), vintSize(data.byteLength), data]);
}

export interface Vp8Frame {
  data: Uint8Array;
  width: number;
  height: number;
  // false for inter frames (WebCodecs VP8 / VP9); default true (WebP key frames).
  key?: boolean;
}

// The VP8 key frame inside a lossy WebP (RIFF "WEBP" → "VP8 " chunk, also
// inside an extended VP8X file). Lossless (VP8L) WebP can't be muxed.
export function webpToVp8(webp: Uint8Array): Vp8Frame {
  const dv = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const tag = (o: number) => String.fromCharCode(webp[o], webp[o + 1], webp[o + 2], webp[o + 3]);
  if (webp.byteLength < 20 || tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new Error("not a WebP image");
  let o = 12;
  while (o + 8 <= webp.byteLength) {
    const t = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (t === "VP8 ") {
      const data = webp.subarray(o + 8, o + 8 + size);
      if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) throw new Error("WebP VP8 chunk is not a key frame");
      const width = (data[6] | (data[7] << 8)) & 0x3fff;
      const height = (data[8] | (data[9] << 8)) & 0x3fff;
      return { data, width, height };
    }
    if (t === "VP8L") throw new Error("lossless WebP frame (use a quality below 1)");
    o += 8 + size + (size & 1);
  }
  throw new Error("no VP8 data in the WebP image");
}

// frames: VP8 (default) or VP9 frames, all the same size, at `fps`. Clusters
// start on key frames (seekable) and last at most ~5 s.
export function muxWebm(frames: Vp8Frame[], fps: number, opts: { codec?: "V_VP8" | "V_VP9" } = {}): Uint8Array {
  const codec = opts.codec ?? "V_VP8";
  if (!frames.length) throw new Error("no frames");
  const { width, height } = frames[0];
  const frameMs = 1000 / fps;
  const durationMs = frames.length * frameMs;
  const clusters: El[] = [];
  const CLUSTER_MS = 5000;
  let i = 0;
  while (i < frames.length) {
    const start = Math.round(i * frameMs);
    const blocks: El[] = [[0xe7, start]];
    let first = true;
    while (i < frames.length && Math.round(i * frameMs) - start < CLUSTER_MS && (first || frames[i].key === false || Math.round(i * frameMs) - start < 2000)) {
      first = false;
      const rel = Math.round(i * frameMs) - start;
      const header = new Uint8Array([0x81, (rel >> 8) & 0xff, rel & 0xff, frames[i].key === false ? 0x00 : 0x80]);
      blocks.push([0xa3, concat([header, frames[i].data])]);
      i++;
    }
    clusters.push([0x1f43b675, blocks]);
  }
  const ebml: El = [
    0x1a45dfa3,
    [
      [0x4286, 1],
      [0x42f7, 1],
      [0x42f2, 4],
      [0x42f3, 8],
      [0x4282, "webm"],
      [0x4287, 2],
      [0x4285, 2],
    ],
  ];
  const segment: El = [
    0x18538067,
    [
      [
        0x1549a966,
        [
          [0x2ad7b1, 1_000_000],
          [0x4d80, "agent3d"],
          [0x5741, "agent3d"],
          [0x4489, { float: durationMs }],
        ],
      ],
      [
        0x1654ae6b,
        [
          [
            0xae,
            [
              [0xd7, 1],
              [0x73c5, 1],
              [0x9c, 0],
              [0x22b59c, "und"],
              [0x86, codec],
              [0x258688, codec === "V_VP9" ? "VP9" : "VP8"],
              [0x83, 1],
              [0x23e383, Math.round(1e9 / fps)],
              [
                0xe0,
                [
                  [0xb0, width],
                  [0xba, height],
                ],
              ],
            ],
          ],
        ],
      ],
      ...clusters,
    ],
  ];
  return concat([encodeEl(ebml), encodeEl(segment)]);
}
