// Base64 encoding / data: URIs in pure TS (no btoa / Buffer dependency).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(bytes: Uint8Array): string {
  let out = "";
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[v >> 18] + ALPHABET[(v >> 12) & 63] + ALPHABET[(v >> 6) & 63] + ALPHABET[v & 63];
  }
  if (i < n) {
    const v = (bytes[i] << 16) | ((i + 1 < n ? bytes[i + 1] : 0) << 8);
    out += ALPHABET[v >> 18] + ALPHABET[(v >> 12) & 63] + (i + 1 < n ? ALPHABET[(v >> 6) & 63] : "=") + "=";
  }
  return out;
}

export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (ALPHABET.indexOf(clean[i]) << 18) | (ALPHABET.indexOf(clean[i + 1]) << 12) | ((ALPHABET.indexOf(clean[i + 2] ?? "A") & 63) << 6) | (ALPHABET.indexOf(clean[i + 3] ?? "A") & 63);
    out[o++] = (v >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (v >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = v & 255;
  }
  return out.subarray(0, o);
}

export function dataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${base64Encode(bytes)}`;
}
