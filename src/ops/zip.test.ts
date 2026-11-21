import { describe, expect, it } from "vitest";
import { base64Decode, base64Encode, dataUri } from "./base64";
import { crc32, listZip, readZip, writeZipStored } from "./zip";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Hand-built zip with one deflated entry (method 8).
async function deflatedZip(name: string, content: string): Promise<Uint8Array> {
  const data = enc.encode(content);
  const comp = await deflateRaw(data);
  const nameB = enc.encode(name);
  const crc = crc32(data);
  const le = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xff);
  const local = [...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...le(8, 2), ...le(0, 4), ...le(crc, 4), ...le(comp.length, 4), ...le(data.length, 4), ...le(nameB.length, 2), ...le(0, 2)];
  const localFull = new Uint8Array([...local, ...nameB, ...comp]);
  const cd = [...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(8, 2), ...le(0, 4), ...le(crc, 4), ...le(comp.length, 4), ...le(data.length, 4), ...le(nameB.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(0, 4)];
  const cdFull = new Uint8Array([...cd, ...nameB]);
  const eocd = new Uint8Array([...le(0x06054b50, 4), 0, 0, 0, 0, ...le(1, 2), ...le(1, 2), ...le(cdFull.length, 4), ...le(localFull.length, 4), 0, 0]);
  return new Uint8Array([...localFull, ...cdFull, ...eocd]);
}

describe("zip", () => {
  it("round-trips stored entries", async () => {
    const zip = writeZipStored({ "a.txt": "hello", "dir/b.bin": new Uint8Array([1, 2, 3]), "__MACOSX/._a.txt": "junk" });
    expect(listZip(zip).map((e) => e.name)).toEqual(["a.txt", "dir/b.bin", "__MACOSX/._a.txt"]);
    const files = await readZip(zip);
    expect(Object.keys(files)).toEqual(["a.txt", "dir/b.bin"]);
    expect(dec.decode(files["a.txt"])).toBe("hello");
    expect([...files["dir/b.bin"]]).toEqual([1, 2, 3]);
    const filtered = await readZip(zip, { filter: (n) => n.endsWith(".bin") });
    expect(Object.keys(filtered)).toEqual(["dir/b.bin"]);
  });

  it("inflates deflated entries via DecompressionStream or an injected inflate", async () => {
    const text = "agent3d ".repeat(200);
    const zip = await deflatedZip("model.gltf", text);
    expect(dec.decode((await readZip(zip))["model.gltf"])).toBe(text);
    let called = 0;
    const viaInjected = await readZip(zip, {
      inflate: async (raw) => {
        called++;
        const s = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(s).arrayBuffer());
      },
    });
    expect(called).toBe(1);
    expect(dec.decode(viaInjected["model.gltf"])).toBe(text);
  });

  it("rejects non-zips", () => {
    expect(() => listZip(enc.encode("not a zip at all, definitely not"))).toThrow(/Not a ZIP/);
  });

  it("crc32", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("base64", () => {
  it("encodes like the platform", () => {
    for (const s of ["", "a", "ab", "abc", "abcd", "hello world!", "ÿþ"]) {
      const bytes = enc.encode(s);
      expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString("base64"));
      expect(dec.decode(base64Decode(base64Encode(bytes)))).toBe(s);
    }
    expect(dataUri(new Uint8Array([0xff]), "image/png")).toBe("data:image/png;base64,/w==");
  });
});
