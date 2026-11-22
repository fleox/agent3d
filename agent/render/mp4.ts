// A tiny MP4 (ISO BMFF) muxer for one H.264 video track: what `render --video
// out.mp4` writes from the WebCodecs chunks encoded in headless Chrome.
// Constant frame rate, "fast start" (moov before mdat) so browsers can play
// it while downloading. No audio.

export interface H264Chunk {
  data: Uint8Array; // AVCC (length-prefixed NAL units), as WebCodecs emits with avc.format = "avc"
  key: boolean;
}

export interface Mp4Options {
  width: number;
  height: number;
  fps: number;
  avcC: Uint8Array; // AVCDecoderConfigurationRecord (VideoDecoderConfig.description)
}

const enc = new TextEncoder();

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function u16(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
function box(type: string, ...body: Uint8Array[]): Uint8Array {
  const data = concat(body);
  return concat([u32(data.byteLength + 8), enc.encode(type), data]);
}
function fullBox(type: string, version: number, flags: number, ...body: Uint8Array[]): Uint8Array {
  return box(type, new Uint8Array([version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]), ...body);
}
const zeros = (n: number) => new Uint8Array(n);
const MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

function moov(opts: Mp4Options, chunks: H264Chunk[], mdatDataOffset: number): Uint8Array {
  const timescale = Math.round(opts.fps * 1000);
  const delta = 1000;
  const count = chunks.length;
  const duration = count * delta;
  const movieTimescale = 1000;
  const movieDuration = Math.round((count / opts.fps) * 1000);
  const mvhd = fullBox("mvhd", 0, 0, u32(0), u32(0), u32(movieTimescale), u32(movieDuration), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2));
  const tkhd = fullBox("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDuration), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(opts.width << 16), u32(opts.height << 16));
  const mdhd = fullBox("mdhd", 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4) /* "und" */, u16(0));
  const hdlr = fullBox("hdlr", 0, 0, u32(0), enc.encode("vide"), zeros(12), enc.encode("Agent3D video\0"));
  const vmhd = fullBox("vmhd", 0, 1, zeros(8));
  const dinf = box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1)));
  const name = zeros(32);
  const label = enc.encode("Agent3D H.264");
  name[0] = label.byteLength;
  name.set(label, 1);
  const avc1 = box(
    "avc1",
    zeros(6),
    u16(1), // data reference index
    zeros(16),
    u16(opts.width),
    u16(opts.height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1), // frame count
    name,
    u16(0x0018),
    u16(0xffff),
    box("avcC", opts.avcC),
  );
  const stsd = fullBox("stsd", 0, 0, u32(1), avc1);
  const stts = fullBox("stts", 0, 0, u32(1), u32(count), u32(delta));
  const keys = chunks.map((c, i) => (c.key ? i + 1 : 0)).filter(Boolean);
  const stss = fullBox("stss", 0, 0, u32(keys.length), ...keys.map(u32));
  const stsc = fullBox("stsc", 0, 0, u32(1), u32(1), u32(count), u32(1)); // one chunk holding every sample
  const stsz = fullBox("stsz", 0, 0, u32(0), u32(count), ...chunks.map((c) => u32(c.data.byteLength)));
  const stco = fullBox("stco", 0, 0, u32(1), u32(mdatDataOffset));
  const stbl = box("stbl", stsd, stts, stss, stsc, stsz, stco);
  const minf = box("minf", vmhd, dinf, stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);
  const trak = box("trak", tkhd, mdia);
  return box("moov", mvhd, trak);
}

export function muxMp4(chunks: H264Chunk[], opts: Mp4Options): Uint8Array {
  if (!chunks.length) throw new Error("no frames");
  if (!chunks[0].key) throw new Error("the first frame must be a key frame");
  const ftyp = box("ftyp", enc.encode("isom"), u32(0x200), enc.encode("isom"), enc.encode("iso2"), enc.encode("avc1"), enc.encode("mp41"));
  const payload = chunks.reduce((a, c) => a + c.data.byteLength, 0);
  const moovSize = moov(opts, chunks, 0).byteLength;
  const mdatHeader = concat([u32(payload + 8), enc.encode("mdat")]);
  const offset = ftyp.byteLength + moovSize + mdatHeader.byteLength;
  return concat([ftyp, moov(opts, chunks, offset), mdatHeader, ...chunks.map((c) => c.data)]);
}

// The H.264 codec string WebCodecs needs for a frame size (High profile; level from the macroblock count).
export function avcCodecFor(width: number, height: number, fps: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = mbs * fps;
  const levels: [number, number, number][] = [
    // [level_idc, max frame macroblocks, max macroblocks / s]
    [31, 3600, 108000],
    [40, 8192, 245760],
    [42, 8704, 522240],
    [50, 22080, 589824],
    [51, 36864, 983040],
    [52, 36864, 2073600],
  ];
  const level = levels.find(([, fs, mbps]) => mbs <= fs && rate <= mbps)?.[0] ?? 52;
  return `avc1.6400${level.toString(16).padStart(2, "0")}`;
}

// Minimal reader used by tests: top-level boxes and sample count.
export function readMp4Boxes(mp4: Uint8Array): { type: string; size: number }[] {
  const out: { type: string; size: number }[] = [];
  const dv = new DataView(mp4.buffer, mp4.byteOffset, mp4.byteLength);
  let o = 0;
  while (o + 8 <= mp4.byteLength) {
    const size = dv.getUint32(o);
    const type = String.fromCharCode(mp4[o + 4], mp4[o + 5], mp4[o + 6], mp4[o + 7]);
    out.push({ type, size });
    if (size < 8) break;
    o += size;
  }
  return out;
}
