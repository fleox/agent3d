// Minimal ZIP reader / stored-only writer in pure TS (no Node, no DOM).
// Reader: stored (method 0) and deflate (method 8). Deflate goes through the
// injected `inflate(raw) → bytes` function, or DecompressionStream("deflate-raw")
// when the platform has it (browsers, Node ≥ 18).

export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array> | Uint8Array;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  offset: number; // local header offset
  dir: boolean;
}

export class ZipError extends Error {
  override name = "ZipError";
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const utf8 = new TextDecoder();

export function listZip(zip: Uint8Array): ZipEntry[] {
  // End of central directory: search backwards (comment ≤ 65535 bytes).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Not a ZIP file (end of central directory not found).");
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  if (p === 0xffffffff) throw new ZipError("ZIP64 archives are not supported.");
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(zip, p) !== 0x02014b50) throw new ZipError("Corrupt ZIP central directory.");
    const method = u16(zip, p + 10);
    const crc32 = u32(zip, p + 16);
    const compressedSize = u32(zip, p + 20);
    const size = u32(zip, p + 24);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const offset = u32(zip, p + 42);
    const name = utf8.decode(zip.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, size, crc32, offset, dir: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function defaultInflate(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (!DS) throw new ZipError("Deflated ZIP entries need an inflate function (no DecompressionStream on this platform).");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntry(zip: Uint8Array, entry: ZipEntry, inflate?: InflateRaw): Promise<Uint8Array> {
  const p = entry.offset;
  if (u32(zip, p) !== 0x04034b50) throw new ZipError(`Corrupt local header for ${entry.name}.`);
  const start = p + 30 + u16(zip, p + 26) + u16(zip, p + 28);
  const raw = zip.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method === 8) return await (inflate ?? defaultInflate)(raw);
  throw new ZipError(`Unsupported compression method ${entry.method} for ${entry.name}.`);
}

// Extracts the files whose name passes `filter` (default: every file).
export async function readZip(zip: Uint8Array, opts: { filter?: (name: string) => boolean; inflate?: InflateRaw; maxBytes?: number } = {}): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  let total = 0;
  for (const e of listZip(zip)) {
    if (e.dir || e.name.startsWith("__MACOSX/") || e.name.split("/").includes("..")) continue;
    if (opts.filter && !opts.filter(e.name)) continue;
    total += e.size;
    if (opts.maxBytes && total > opts.maxBytes) throw new ZipError(`ZIP content exceeds ${Math.round(opts.maxBytes / 1048576)} MB.`);
    out[e.name] = await readZipEntry(zip, e, opts.inflate);
  }
  return out;
}

// ─── CRC32 + stored writer (tests, simple archives) ─────────────────────

let CRC_TABLE: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function writeZipStored(files: Record<string, Uint8Array | string>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const w16 = (b: Uint8Array, o: number, v: number) => {
    b[o] = v & 0xff;
    b[o + 1] = (v >>> 8) & 0xff;
  };
  const w32 = (b: Uint8Array, o: number, v: number) => {
    b[o] = v & 0xff;
    b[o + 1] = (v >>> 8) & 0xff;
    b[o + 2] = (v >>> 16) & 0xff;
    b[o + 3] = (v >>> 24) & 0xff;
  };
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    w32(local, 0, 0x04034b50);
    w16(local, 4, 20);
    w16(local, 6, 0x0800); // UTF-8 names
    w16(local, 8, 0);
    w32(local, 14, crc);
    w32(local, 18, data.length);
    w32(local, 22, data.length);
    w16(local, 26, nameBytes.length);
    local.set(nameBytes, 30);
    const cd = new Uint8Array(46 + nameBytes.length);
    w32(cd, 0, 0x02014b50);
    w16(cd, 4, 20);
    w16(cd, 6, 20);
    w16(cd, 8, 0x0800);
    w32(cd, 16, crc);
    w32(cd, 20, data.length);
    w32(cd, 24, data.length);
    w16(cd, 28, nameBytes.length);
    w32(cd, 42, offset);
    cd.set(nameBytes, 46);
    chunks.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  w32(eocd, 0, 0x06054b50);
  w16(eocd, 8, central.length);
  w16(eocd, 10, central.length);
  w32(eocd, 12, cdSize);
  w32(eocd, 16, offset);
  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
