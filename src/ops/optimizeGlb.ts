// GLB rewriting for `assets optimize`: an in-memory model of a binary glTF
// where every bufferView owns its bytes (meshopt-compressed views are
// decoded on load), so textures can be replaced, geometry rebuilt (weld,
// simplify, vertex-cache reorder, meshopt filters) and the whole file
// re-packed — optionally with EXT_meshopt_compression (+ KHR_mesh_quantization
// for octahedral normals). Pure TS + the `meshoptimizer` wasm (embedded in
// its JS, works offline in Node); no Three.js.

// meshoptimizer is imported lazily (only `assets optimize` / export --optimize need it).
type Meshopt = typeof import("meshoptimizer");
let meshoptModule: Promise<Meshopt> | null = null;
async function meshopt(): Promise<Meshopt> {
  meshoptModule ??= import("meshoptimizer").then(async (m) => {
    await Promise.all([m.MeshoptEncoder.ready, m.MeshoptDecoder.ready, m.MeshoptSimplifier.ready]);
    return m;
  });
  return meshoptModule;
}

export const EXT_MESHOPT = "EXT_meshopt_compression";
export const EXT_WEBP = "EXT_texture_webp";
export const KHR_QUANT = "KHR_mesh_quantization";
export const KHR_DRACO = "KHR_draco_mesh_compression";

// ─── glTF JSON (the parts we touch) ─────────────────────────────────────

export interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
  extensions?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
  sparse?: unknown;
  [k: string]: unknown;
}

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  targets?: Record<string, number>[];
  extensions?: Record<string, unknown>;
  material?: number;
  [k: string]: unknown;
}

export interface GltfDoc {
  asset?: unknown;
  buffers?: { byteLength: number; uri?: string; extensions?: Record<string, unknown> }[];
  bufferViews?: GltfBufferView[];
  accessors?: GltfAccessor[];
  images?: { bufferView?: number; mimeType?: string; uri?: string; name?: string }[];
  textures?: { source?: number; sampler?: number; extensions?: Record<string, { source?: number } | undefined> }[];
  materials?: Record<string, unknown>[];
  meshes?: { primitives: GltfPrimitive[]; [k: string]: unknown }[];
  nodes?: { mesh?: number; extensions?: Record<string, unknown>; [k: string]: unknown }[];
  skins?: { inverseBindMatrices?: number; [k: string]: unknown }[];
  animations?: { samplers?: { input: number; output: number }[]; [k: string]: unknown }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  [k: string]: unknown;
}

// How a view can be meshopt-encoded.
export interface ViewMeta {
  mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
  stride: number;
  count: number;
  filter?: "OCTAHEDRAL" | "EXPONENTIAL";
}

export interface GlbModel {
  json: GltfDoc;
  views: Uint8Array[]; // decoded content of each bufferView
  meta: (ViewMeta | undefined)[];
  wasCompressed: boolean; // input used EXT_meshopt_compression
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function readGlbChunks(bytes: Uint8Array): { json: GltfDoc; bin: Uint8Array | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Not a binary glTF (.glb) file.");
  let off = 12;
  let json: GltfDoc | null = null;
  let bin: Uint8Array | null = null;
  while (off + 8 <= bytes.byteLength) {
    const len = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data)) as GltfDoc;
    else if (type === CHUNK_BIN && !bin) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error("The .glb has no JSON chunk.");
  return { json, bin };
}

export function writeGlbChunks(json: unknown, bin: Uint8Array | null): Uint8Array {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = (enc.byteLength + 3) & ~3;
  const binLen = bin ? (bin.byteLength + 3) & ~3 : 0;
  const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(enc, 20);
  out.fill(0x20, 20 + enc.byteLength, 20 + jsonLen); // JSON padding = spaces
  if (bin) {
    const o = 20 + jsonLen;
    view.setUint32(o, binLen, true);
    view.setUint32(o + 4, CHUNK_BIN, true);
    out.set(bin, o + 8);
  }
  return out;
}

const isFallbackBuffer = (b: { extensions?: Record<string, unknown> } | undefined) => !!(b?.extensions?.[EXT_MESHOPT] as { fallback?: boolean } | undefined)?.fallback;

// Parses a .glb into a GlbModel. Throws (with a readable message) when the
// file keeps data outside the GLB (external .bin buffers).
export async function unpackGlb(bytes: Uint8Array): Promise<GlbModel> {
  const { json, bin } = readGlbChunks(bytes);
  const buffers = json.buffers ?? [];
  for (const [i, b] of buffers.entries()) {
    if (isFallbackBuffer(b)) continue;
    if (i !== 0 || b.uri !== undefined) throw new Error("This .glb references external buffers (.bin files): optimise the self-contained .glb instead.");
  }
  let wasCompressed = false;
  const meta: (ViewMeta | undefined)[] = [];
  const views: Uint8Array[] = [];
  for (const [i, v] of (json.bufferViews ?? []).entries()) {
    const ext = v.extensions?.[EXT_MESHOPT] as { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: ViewMeta["mode"]; filter?: string } | undefined;
    if (ext) {
      if (ext.buffer !== 0 || !bin) throw new Error(`bufferView ${i}: meshopt data outside the GLB binary chunk.`);
      const { MeshoptDecoder } = await meshopt();
      const out = new Uint8Array(ext.count * ext.byteStride);
      const src = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
      MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter && ext.filter !== "NONE" ? ext.filter : undefined);
      views.push(out);
      // The decoded bytes match the accessor types: re-encode without filter.
      meta.push({ mode: ext.mode, stride: ext.byteStride, count: ext.count });
      wasCompressed = true;
      delete v.extensions![EXT_MESHOPT];
      if (!Object.keys(v.extensions!).length) delete v.extensions;
      v.buffer = 0;
      continue;
    }
    if (v.buffer !== 0 || !bin) {
      if (isFallbackBuffer(buffers[v.buffer])) throw new Error(`bufferView ${i} points at a meshopt fallback buffer without compressed data.`);
      throw new Error(`bufferView ${i} is outside the GLB binary chunk.`);
    }
    views.push(bin.slice(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
    meta.push(undefined);
  }
  json.buffers = buffers.length ? [{ byteLength: 0 }] : [];
  removeExtension(json, EXT_MESHOPT);
  return { json, views, meta, wasCompressed };
}

export function addExtension(json: GltfDoc, name: string, required: boolean): void {
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), name])];
  if (required) json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), name])];
}

export function removeExtension(json: GltfDoc, name: string): void {
  if (json.extensionsUsed) json.extensionsUsed = json.extensionsUsed.filter((e) => e !== name);
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((e) => e !== name);
  if (json.extensionsUsed && !json.extensionsUsed.length) delete json.extensionsUsed;
  if (json.extensionsRequired && !json.extensionsRequired.length) delete json.extensionsRequired;
}

const encodable = (m: ViewMeta) => (m.mode === "ATTRIBUTES" ? m.stride % 4 === 0 && m.stride <= 256 : (m.stride === 2 || m.stride === 4) && (m.mode !== "TRIANGLES" || m.count % 3 === 0));

// Writes the model back to .glb bytes. With `compress`, views that have a
// meshopt layout are encoded (EXT_meshopt_compression, required) when it
// makes them smaller; their uncompressed size goes to a fallback buffer.
export async function packGlb(model: GlbModel, opts: { compress: boolean }): Promise<{ bytes: Uint8Array; compressedViews: number }> {
  const { json, views, meta } = model;
  const { MeshoptEncoder } = await meshopt();
  const chunks: Uint8Array[] = [];
  let off = 0;
  let fallbackOff = 0;
  let compressedViews = 0;
  const place = (data: Uint8Array) => {
    off = (off + 3) & ~3;
    const at = off;
    chunks.push(data);
    off += data.byteLength;
    return at;
  };
  const layout: { at: number; data: Uint8Array }[] = [];
  const bvs = json.bufferViews ?? [];
  for (const [i, v] of bvs.entries()) {
    const data = views[i];
    const m = meta[i];
    let encoded: Uint8Array | null = null;
    if (opts.compress && m && encodable(m)) {
      try {
        const e = MeshoptEncoder.encodeGltfBuffer(data, m.count, m.stride, m.mode);
        if (e.byteLength < data.byteLength * 0.97 || m!.filter) encoded = e; // filtered data must stay encoded (the decoder applies the filter)
      } catch {
        encoded = null;
      }
    }
    if (m?.filter && !encoded) throw new Error(`bufferView ${i}: a meshopt filter needs compression.`);
    if (encoded) {
      const at = (off = (off + 3) & ~3);
      chunks.push(encoded);
      layout.push({ at, data: encoded });
      off += encoded.byteLength;
      fallbackOff = (fallbackOff + 3) & ~3;
      v.buffer = 1;
      v.byteOffset = fallbackOff;
      v.byteLength = data.byteLength;
      fallbackOff += data.byteLength;
      v.extensions = { ...(v.extensions ?? {}), [EXT_MESHOPT]: { buffer: 0, byteOffset: at, byteLength: encoded.byteLength, byteStride: m!.stride, mode: m!.mode, count: m!.count, ...(m!.filter ? { filter: m!.filter } : {}) } };
      compressedViews++;
    } else {
      const at = place(data);
      layout.push({ at, data });
      v.buffer = 0;
      v.byteOffset = at;
      v.byteLength = data.byteLength;
    }
  }
  const binLen = (off + 3) & ~3;
  const bin = new Uint8Array(binLen);
  for (const l of layout) bin.set(l.data, l.at);
  json.buffers = [{ byteLength: binLen }];
  if (compressedViews) {
    json.buffers.push({ byteLength: (fallbackOff + 3) & ~3, extensions: { [EXT_MESHOPT]: { fallback: true } } });
    addExtension(json, EXT_MESHOPT, true);
  } else removeExtension(json, EXT_MESHOPT);
  if (!bvs.length) delete json.buffers;
  return { bytes: writeGlbChunks(json, bvs.length ? bin : null), compressedViews };
}

// ─── Accessors ──────────────────────────────────────────────────────────

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const F32 = 5126;
const U16 = 5123;
const U32 = 5125;
const I16 = 5122;

const elementSize = (a: GltfAccessor) => (COMPONENTS[a.type] ?? 1) * (COMPONENT_BYTES[a.componentType] ?? 4);

// Tightly packed element bytes of an accessor.
function accessorBytes(model: GlbModel, a: GltfAccessor): Uint8Array {
  const size = elementSize(a);
  const out = new Uint8Array(a.count * size);
  if (a.bufferView === undefined) return out;
  const bv = model.json.bufferViews![a.bufferView];
  const src = model.views[a.bufferView];
  const stride = bv.byteStride || size;
  const base = a.byteOffset ?? 0;
  if (stride === size) out.set(src.subarray(base, base + out.byteLength));
  else for (let i = 0; i < a.count; i++) out.set(src.subarray(base + i * stride, base + i * stride + size), i * size);
  return out;
}

function readFloats(bytes: Uint8Array, a: GltfAccessor): Float32Array {
  const n = a.count * (COMPONENTS[a.type] ?? 1);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(n);
  const cb = COMPONENT_BYTES[a.componentType];
  for (let i = 0; i < n; i++) {
    const o = i * cb;
    let v: number;
    switch (a.componentType) {
      case 5126: v = dv.getFloat32(o, true); break;
      case 5120: v = dv.getInt8(o); if (a.normalized) v = Math.max(v / 127, -1); break;
      case 5121: v = dv.getUint8(o); if (a.normalized) v /= 255; break;
      case 5122: v = dv.getInt16(o, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
      case 5123: v = dv.getUint16(o, true); if (a.normalized) v /= 65535; break;
      default: v = dv.getUint32(o, true);
    }
    out[i] = v;
  }
  return out;
}

function readIndices(bytes: Uint8Array, a: GltfAccessor): Uint32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(a.count);
  for (let i = 0; i < a.count; i++) out[i] = a.componentType === 5121 ? dv.getUint8(i) : a.componentType === U16 ? dv.getUint16(i * 2, true) : dv.getUint32(i * 4, true);
  return out;
}

function minMax(values: Float32Array, comps: number): { min: number[]; max: number[] } {
  const min = new Array<number>(comps).fill(Infinity);
  const max = new Array<number>(comps).fill(-Infinity);
  for (let i = 0; i < values.length; i++) {
    const c = i % comps;
    if (values[i] < min[c]) min[c] = values[i];
    if (values[i] > max[c]) max[c] = values[i];
  }
  return { min: min.map((v) => (Number.isFinite(v) ? v : 0)), max: max.map((v) => (Number.isFinite(v) ? v : 0)) };
}

// ─── Geometry rebuild ───────────────────────────────────────────────────

export interface GeometryOptions {
  compress: boolean; // meshopt filters (lossy, invisible: 16-bit positions / UVs, 10-bit normals) + EXT_meshopt_compression
  simplify?: number; // keep this fraction of the triangles (0 < r < 1)
  simplifyError?: number; // max deviation, fraction of the mesh size (default 0.01)
}

export interface GeometryReport {
  trianglesBefore: number;
  trianglesAfter: number;
  verticesBefore: number;
  verticesAfter: number;
  welded: number; // duplicate vertices merged
  simplified: boolean;
  filters: string[]; // "POSITION: EXPONENTIAL 16 bits", …
  notes: string[];
}

type AccessorClass = "vertex" | "target" | "index" | "other";

const POSITION_BITS = 16;
const UV_BITS = 16;
const NORMAL_BITS = 10;

// Why the geometry of this model cannot be rebuilt (or null when it can).
export function geometryBlocker(json: GltfDoc): string | null {
  if ((json.extensionsUsed ?? []).includes(KHR_DRACO)) return "Draco-compressed geometry (KHR_draco_mesh_compression) cannot be decoded here: geometry kept as is.";
  if ((json.accessors ?? []).some((a) => a.sparse)) return "Sparse accessors: geometry kept as is.";
  for (const a of json.accessors ?? []) if (/^MAT/.test(a.type) && (COMPONENT_BYTES[a.componentType] ?? 4) < 4) return "Padded matrix accessors: geometry kept as is.";
  return null;
}

export async function rebuildGeometry(model: GlbModel, opts: GeometryOptions): Promise<GeometryReport> {
  const { MeshoptEncoder, MeshoptSimplifier } = await meshopt();
  const { json } = model;
  const accessors = json.accessors ?? [];
  const report: GeometryReport = { trianglesBefore: 0, trianglesAfter: 0, verticesBefore: 0, verticesAfter: 0, welded: 0, simplified: false, filters: [], notes: [] };

  // Usage of every accessor.
  const classOf = new Map<number, AccessorClass>();
  const users = new Map<number, Set<GltfPrimitive | "other">>();
  const use = (i: number | undefined, c: AccessorClass, by: GltfPrimitive | "other") => {
    if (i === undefined || !accessors[i]) return;
    const prev = classOf.get(i);
    if (!prev || prev === "other") classOf.set(i, c);
    if (!users.has(i)) users.set(i, new Set());
    users.get(i)!.add(by);
  };
  const prims: GltfPrimitive[] = [];
  for (const m of json.meshes ?? [])
    for (const p of m.primitives ?? []) {
      prims.push(p);
      for (const a of Object.values(p.attributes ?? {})) use(a, "vertex", p);
      for (const t of p.targets ?? []) for (const a of Object.values(t)) use(a, "target", p);
      use(p.indices, "index", p);
    }
  for (const s of json.skins ?? []) use(s.inverseBindMatrices, "other", "other");
  for (const an of json.animations ?? []) for (const s of an.samplers ?? []) (use(s.input, "other", "other"), use(s.output, "other", "other"));
  for (const n of json.nodes ?? []) {
    const inst = n.extensions?.EXT_mesh_gpu_instancing as { attributes?: Record<string, number> } | undefined;
    for (const a of Object.values(inst?.attributes ?? {})) use(a, "other", "other");
  }

  // Element bytes of every accessor (new data goes here).
  const data = new Map<number, Uint8Array>();
  for (const [i, a] of accessors.entries()) data.set(i, accessorBytes(model, a));

  const triCount = (p: GltfPrimitive) => {
    const mode = p.mode ?? 4;
    const n = p.indices !== undefined ? accessors[p.indices].count : accessors[p.attributes.POSITION]?.count ?? 0;
    return mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
  };
  for (const p of prims) report.trianglesBefore += triCount(p);
  const posSeen = new Set<number>();
  for (const p of prims) if (p.attributes.POSITION !== undefined && !posSeen.has(p.attributes.POSITION)) (posSeen.add(p.attributes.POSITION), (report.verticesBefore += accessors[p.attributes.POSITION].count));

  // Groups of triangle primitives sharing the same vertex streams.
  const groups = new Map<string, GltfPrimitive[]>();
  for (const p of prims) {
    if ((p.mode ?? 4) !== 4 || p.extensions?.[KHR_DRACO] || p.attributes.POSITION === undefined) continue;
    const key = JSON.stringify([p.attributes, p.targets ?? []]);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  let simplifiedAny = false;
  let errorCapped = false;
  const created = new Set<number>(); // index accessors added for non-indexed primitives
  for (const group of groups.values()) {
    const first = group[0];
    const streams = [...Object.values(first.attributes), ...(first.targets ?? []).flatMap((t) => Object.values(t))];
    const inGroup = (i: number) => [...(users.get(i) ?? [])].every((u) => u !== "other" && group.includes(u));
    if (!streams.every(inGroup)) continue; // shared with other primitives: leave as is
    if (group.some((p) => p.indices !== undefined && (users.get(p.indices)!.size > 1 || classOf.get(p.indices) !== "index"))) continue;
    const posAcc = accessors[first.attributes.POSITION];
    const vertexCount = posAcc.count;
    if (streams.some((s) => accessors[s].count !== vertexCount || accessors[s].bufferView === undefined)) continue;
    let lists = group.map((p) => (p.indices !== undefined ? readIndices(data.get(p.indices)!, accessors[p.indices]) : Uint32Array.from({ length: vertexCount }, (_, k) => k)));
    if (lists.some((l) => l.length % 3)) continue;

    // Weld: merge vertices whose every attribute is bitwise identical.
    const sizes = streams.map((s) => elementSize(accessors[s]));
    const streamData = streams.map((s) => data.get(s)!);
    const canon = new Uint32Array(vertexCount);
    const seen = new Map<string, number>();
    let welded = 0;
    for (let v = 0; v < vertexCount; v++) {
      let key = "";
      for (let k = 0; k < streams.length; k++) {
        const d = streamData[k];
        for (let b = v * sizes[k]; b < (v + 1) * sizes[k]; b++) key += String.fromCharCode(d[b]);
      }
      const hit = seen.get(key);
      if (hit === undefined) (seen.set(key, v), (canon[v] = v));
      else (canon[v] = hit), welded++;
    }
    if (welded) lists = lists.map((l) => l.map((i) => canon[i]));
    report.welded += welded;

    // Simplify (positions as float).
    if (opts.simplify !== undefined && opts.simplify < 1 && first.targets === undefined) {
      const pos = readFloats(data.get(first.attributes.POSITION)!, posAcc);
      lists = lists.map((l) => {
        const tris = l.length / 3;
        if (tris < 32) return l;
        const target = Math.max(3, Math.floor((tris * opts.simplify!) | 0) * 3);
        const [out, err] = MeshoptSimplifier.simplify(l, pos, 3, target, opts.simplifyError ?? 0.01, ["LockBorder"]);
        if (!out.length) return l;
        if (out.length > target * 1.05) errorCapped = true;
        simplifiedAny = simplifiedAny || out.length < l.length;
        void err;
        return out;
      });
    }

    // Reorder for the vertex cache + compact unused vertices.
    const all = new Uint32Array(lists.reduce((n, l) => n + l.length, 0));
    let o = 0;
    for (const l of lists) (all.set(l, o), (o += l.length));
    const [remap, unique] = MeshoptEncoder.reorderMesh(all, group.length === 1, true);
    o = 0;
    lists = lists.map((l) => {
      const r = all.slice(o, o + l.length);
      o += l.length;
      return r;
    });
    for (const [k, s] of streams.entries()) {
      const size = sizes[k];
      const src = streamData[k];
      const dst = new Uint8Array(unique * size);
      for (let v = 0; v < vertexCount; v++) {
        const to = remap[v];
        if (to !== 0xffffffff && to < unique) dst.set(src.subarray(v * size, (v + 1) * size), to * size);
      }
      data.set(s, dst);
      const a = accessors[s];
      a.count = unique;
      a.byteOffset = 0;
    }
    // Indices.
    for (const [k, p] of group.entries()) {
      const l = lists[k];
      const wide = unique > 65535;
      const bytes = new Uint8Array(wide ? new Uint32Array(l).buffer : new Uint16Array(l).buffer);
      let idx = p.indices;
      if (idx === undefined) {
        idx = accessors.length;
        accessors.push({ componentType: wide ? U32 : U16, count: l.length, type: "SCALAR" });
        created.add(idx);
        classOf.set(idx, "index");
        users.set(idx, new Set([p]));
        p.indices = idx;
      }
      const a = accessors[idx];
      a.componentType = wide ? U32 : U16;
      a.count = l.length;
      a.byteOffset = 0;
      delete a.min;
      delete a.max;
      data.set(idx, bytes);
    }
  }
  if (simplifiedAny) report.simplified = true;
  if (errorCapped) report.notes.push(`Simplification stopped early to stay within the error bound (${opts.simplifyError ?? 0.01} of the mesh size): raise --simplify-error to go further.`);

  // Index accessors: 8-bit indices are widened (meshopt needs 16 / 32 bits).
  for (const [i, a] of accessors.entries()) {
    if (classOf.get(i) === "index" && a.componentType === 5121) {
      data.set(i, new Uint8Array(new Uint16Array(readIndices(data.get(i)!, a)).buffer));
      a.componentType = U16;
    }
  }

  // Meshopt filters (only for accessors used solely as base attributes).
  const filters = new Map<number, ViewMeta["filter"]>();
  if (opts.compress) {
    const semantic = new Map<number, string>();
    for (const p of prims) for (const [name, a] of Object.entries(p.attributes)) semantic.set(a, semantic.has(a) && semantic.get(a) !== name ? "?" : name);
    for (const [i, a] of accessors.entries()) {
      if (classOf.get(i) !== "vertex" || a.componentType !== F32 || a.bufferView === undefined) continue;
      if ([...(users.get(i) ?? [])].some((u) => u === "other")) continue;
      const name = semantic.get(i) ?? "?";
      const values = readFloats(data.get(i)!, a);
      if ((name === "NORMAL" && a.type === "VEC3") || (name === "TANGENT" && a.type === "VEC4")) {
        const src = new Float32Array(a.count * 4);
        for (let v = 0; v < a.count; v++) {
          const c = a.type === "VEC3" ? 3 : 4;
          src[v * 4] = values[v * c];
          src[v * 4 + 1] = values[v * c + 1];
          src[v * 4 + 2] = values[v * c + 2];
          src[v * 4 + 3] = c === 4 ? values[v * c + 3] : 0;
        }
        data.set(i, MeshoptEncoder.encodeFilterOct(src, a.count, 8, NORMAL_BITS));
        a.componentType = I16;
        a.normalized = true;
        delete a.min;
        delete a.max;
        filters.set(i, "OCTAHEDRAL");
        addExtension(json, KHR_QUANT, true);
      } else if (name === "POSITION" || /^TEXCOORD_\d+$/.test(name)) {
        const comps = COMPONENTS[a.type];
        const bits = name === "POSITION" ? POSITION_BITS : UV_BITS;
        const enc = MeshoptEncoder.encodeFilterExp(values, a.count, comps * 4, bits, "SharedComponent");
        data.set(i, enc);
        filters.set(i, "EXPONENTIAL");
        if (name === "POSITION") Object.assign(a, minMax(decodeExp(enc), comps));
      }
    }
    const used = new Set([...filters.entries()].map(([i, f]) => `${semantic.get(i)}: ${f === "OCTAHEDRAL" ? `octahedral ${NORMAL_BITS} bits` : `exponential ${semantic.get(i) === "POSITION" ? POSITION_BITS : UV_BITS} bits`}`));
    report.filters = [...used].sort();
  }

  // POSITION min / max (required) from the final data.
  for (const p of prims) {
    for (const s of [p.attributes.POSITION, ...(p.targets ?? []).map((t) => t.POSITION)]) {
      if (s === undefined || filters.has(s)) continue;
      const a = accessors[s];
      if (a.bufferView === undefined) continue;
      Object.assign(a, minMax(readFloats(data.get(s)!, a), COMPONENTS[a.type]));
    }
  }

  // Re-lay every accessor into its own view; keep the other views (images, …).
  const oldViews = json.bufferViews ?? [];
  const keep = new Set<number>();
  for (const img of json.images ?? []) if (img.bufferView !== undefined) keep.add(img.bufferView);
  collectExtensionViews(json, keep);
  const remapView = new Map<number, number>();
  const newViews: GltfBufferView[] = [];
  const newData: Uint8Array[] = [];
  const newMeta: (ViewMeta | undefined)[] = [];
  for (const [i, v] of oldViews.entries()) {
    if (!keep.has(i)) continue;
    remapView.set(i, newViews.length);
    newViews.push(v);
    newData.push(model.views[i]);
    newMeta.push(model.meta[i]);
  }
  for (const [i, a] of accessors.entries()) {
    if (a.bufferView === undefined && !created.has(i)) continue; // all-zero / Draco accessors have no data
    const c = classOf.get(i) ?? "other";
    const size = elementSize(a);
    let bytes = data.get(i)!;
    const filter = filters.get(i);
    const stride = filter === "OCTAHEDRAL" ? 8 : c === "vertex" || c === "target" ? (size + 3) & ~3 : size;
    if (!filter && stride !== size) {
      const padded = new Uint8Array(a.count * stride);
      for (let v = 0; v < a.count; v++) padded.set(bytes.subarray(v * size, (v + 1) * size), v * stride);
      bytes = padded;
    }
    const bv: GltfBufferView = { buffer: 0, byteLength: bytes.byteLength };
    if (c === "vertex" || c === "target") (bv.byteStride = stride), (bv.target = 34962);
    if (c === "index") bv.target = 34963;
    let meta: ViewMeta | undefined;
    if (c === "index") {
      const triangles = [...(users.get(i) ?? [])].every((u) => u !== "other" && (u.mode ?? 4) === 4) && a.count % 3 === 0;
      meta = { mode: triangles ? "TRIANGLES" : "INDICES", stride: size, count: a.count };
    } else if (stride % 4 === 0 && stride <= 256) meta = { mode: "ATTRIBUTES", stride, count: a.count, ...(filter ? { filter } : {}) };
    a.bufferView = newViews.length;
    a.byteOffset = 0;
    newViews.push(bv);
    newData.push(bytes);
    newMeta.push(meta);
  }
  for (const img of json.images ?? []) if (img.bufferView !== undefined) img.bufferView = remapView.get(img.bufferView);
  remapExtensionViews(json, remapView);
  json.bufferViews = newViews;
  model.views = newData;
  model.meta = newMeta;

  for (const p of prims) report.trianglesAfter += triCount(p);
  const posAfter = new Set<number>();
  for (const p of prims) if (p.attributes.POSITION !== undefined && !posAfter.has(p.attributes.POSITION)) (posAfter.add(p.attributes.POSITION), (report.verticesAfter += accessors[p.attributes.POSITION].count));
  report.trianglesBefore = Math.round(report.trianglesBefore);
  report.trianglesAfter = Math.round(report.trianglesAfter);
  return report;
}

// bufferView references inside mesh primitive extensions (e.g. Draco).
function collectExtensionViews(json: GltfDoc, out: Set<number>) {
  for (const m of json.meshes ?? []) for (const p of m.primitives ?? []) for (const e of Object.values(p.extensions ?? {})) {
    const bv = (e as { bufferView?: unknown })?.bufferView;
    if (typeof bv === "number") out.add(bv);
  }
}

function remapExtensionViews(json: GltfDoc, remap: Map<number, number>) {
  for (const m of json.meshes ?? []) for (const p of m.primitives ?? []) for (const e of Object.values(p.extensions ?? {})) {
    const o = e as { bufferView?: unknown };
    if (o && typeof o.bufferView === "number") o.bufferView = remap.get(o.bufferView);
  }
}

// Decodes EXPONENTIAL filter data (int8 exponent << 24 | int24 mantissa).
export function decodeExp(bytes: Uint8Array): Float32Array {
  const n = bytes.byteLength / 4;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = dv.getInt32(i * 4, true);
    const e = v >> 24;
    const m = (v << 8) >> 8;
    out[i] = m * Math.pow(2, e);
  }
  return out;
}

// Drops views no longer referenced by accessors / images / extensions.
export function compactViews(model: GlbModel): void {
  const { json } = model;
  const used = new Set<number>();
  for (const a of json.accessors ?? []) if (a.bufferView !== undefined) used.add(a.bufferView);
  for (const img of json.images ?? []) if (img.bufferView !== undefined) used.add(img.bufferView);
  collectExtensionViews(json, used);
  const remap = new Map<number, number>();
  const views: GltfBufferView[] = [];
  const data: Uint8Array[] = [];
  const meta: (ViewMeta | undefined)[] = [];
  for (const [i, v] of (json.bufferViews ?? []).entries()) {
    if (!used.has(i)) continue;
    remap.set(i, views.length);
    views.push(v);
    data.push(model.views[i]);
    meta.push(model.meta[i]);
  }
  if (views.length === (json.bufferViews ?? []).length) return;
  for (const a of json.accessors ?? []) if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView);
  for (const img of json.images ?? []) if (img.bufferView !== undefined) img.bufferView = remap.get(img.bufferView);
  remapExtensionViews(json, remap);
  json.bufferViews = views;
  model.views = data;
  model.meta = meta;
}

// ─── Textures inside a model ────────────────────────────────────────────

export type ImageRole = "color" | "normal" | "data";

const DATA_SLOTS = new Set(["metallicRoughnessTexture", "occlusionTexture", "clearcoatTexture", "clearcoatRoughnessTexture", "transmissionTexture", "thicknessTexture", "specularTexture", "sheenRoughnessTexture", "iridescenceTexture", "iridescenceThicknessTexture", "anisotropyTexture"]);
const NORMAL_SLOTS = new Set(["normalTexture", "clearcoatNormalTexture"]);

export function textureImage(t: NonNullable<GltfDoc["textures"]>[number]): number | undefined {
  return t.extensions?.[EXT_WEBP]?.source ?? t.extensions?.EXT_texture_avif?.source ?? t.extensions?.KHR_texture_basisu?.source ?? t.source;
}

// The role of each image (colour / normal / data) from the material slots using it.
export function imageRoles(json: GltfDoc): Map<number, ImageRole> {
  const roles = new Map<number, ImageRole>();
  const rank: Record<ImageRole, number> = { data: 0, normal: 1, color: 2 };
  const visit = (o: unknown, slot: string) => {
    if (!o || typeof o !== "object") return;
    const rec = o as Record<string, unknown>;
    if (typeof rec.index === "number" && slot.endsWith("Texture")) {
      const t = json.textures?.[rec.index];
      const img = t ? textureImage(t) : undefined;
      if (img !== undefined) {
        const role: ImageRole = NORMAL_SLOTS.has(slot) ? "normal" : DATA_SLOTS.has(slot) ? "data" : "color";
        const cur = roles.get(img);
        if (!cur || rank[role] > rank[cur]) roles.set(img, role);
      }
      return;
    }
    for (const [k, v] of Object.entries(rec)) visit(v, k);
  };
  for (const m of json.materials ?? []) visit(m, "");
  return roles;
}

// After image formats changed: textures point at WebP images through
// EXT_texture_webp (required), at PNG / JPEG through `source`.
// Returns the fallback images no longer referenced this way.
export function normalizeTextureSources(json: GltfDoc): Set<number> {
  let webp = false;
  const dropped = new Set<number>();
  for (const t of json.textures ?? []) {
    const img = textureImage(t);
    if (img === undefined) continue;
    if (typeof t.source === "number" && t.source !== img) dropped.add(t.source);
    const isWebp = json.images?.[img]?.mimeType === "image/webp";
    if (t.extensions?.EXT_texture_avif || t.extensions?.KHR_texture_basisu) continue;
    if (isWebp) {
      t.extensions = { ...(t.extensions ?? {}), [EXT_WEBP]: { source: img } };
      delete t.source;
      webp = true;
    } else {
      t.source = img;
      if (t.extensions) {
        delete t.extensions[EXT_WEBP];
        if (!Object.keys(t.extensions).length) delete t.extensions;
      }
    }
  }
  if (webp) addExtension(json, EXT_WEBP, true);
  else removeExtension(json, EXT_WEBP);
  return dropped;
}

// Removes the candidate images (e.g. PNG fallbacks of WebP images) no texture uses any more.
export function pruneImages(json: GltfDoc, candidates: Set<number>): number {
  const images = json.images ?? [];
  const used = new Set<number>();
  for (const t of json.textures ?? []) {
    for (const s of [t.source, ...Object.values(t.extensions ?? {}).map((e) => e?.source)]) if (typeof s === "number") used.add(s);
  }
  const drop = new Set([...candidates].filter((i) => !used.has(i) && images[i]));
  if (!drop.size) return 0;
  const remap = new Map<number, number>();
  const kept: typeof images = [];
  images.forEach((img, i) => {
    if (!drop.has(i)) (remap.set(i, kept.length), kept.push(img));
  });
  for (const t of json.textures ?? []) {
    if (typeof t.source === "number") t.source = remap.get(t.source);
    for (const e of Object.values(t.extensions ?? {})) if (e && typeof e.source === "number") e.source = remap.get(e.source);
  }
  json.images = kept;
  if (!kept.length) delete json.images;
  return images.length - kept.length;
}
