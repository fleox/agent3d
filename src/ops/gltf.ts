// Pure glTF / GLB inspection (no Three.js): triangle counts and animation
// clip names from the JSON chunk — accessor counts are in the JSON, so the
// binary buffers are never read. Same rules as scripts/build-library.mjs
// (scene node walk, instanced meshes counted once per node).

interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[] }[];
  meshes?: { primitives?: { attributes?: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { count?: number }[];
  animations?: { name?: string }[];
}

export interface GltfInfo {
  triangles: number;
  animations: string[];
}

// The JSON chunk of a .glb (magic "glTF", version 2, first chunk type "JSON"), or null.
export function glbJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return null; // "glTF"
  const len = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + len > bytes.byteLength) return null; // "JSON"
  try {
    return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
  } catch {
    return null;
  }
}

export function gltfInfo(json: unknown): GltfInfo | null {
  if (!json || typeof json !== "object") return null;
  const g = json as GltfJson;
  const acc = g.accessors ?? [];
  const meshTris = (mi: number): number => {
    let t = 0;
    for (const p of g.meshes?.[mi]?.primitives ?? []) {
      const pos = p.attributes?.POSITION;
      const count = p.indices !== undefined ? acc[p.indices]?.count : pos !== undefined ? acc[pos]?.count : 0;
      const mode = p.mode ?? 4;
      const n = Number(count) || 0;
      t += mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
    }
    return t;
  };
  let triangles = 0;
  const seen = new Set<number>();
  const visit = (ni: number, depth: number) => {
    const n = g.nodes?.[ni];
    if (!n || depth > 64 || seen.has(ni)) return;
    seen.add(ni);
    if (n.mesh !== undefined) triangles += meshTris(n.mesh);
    for (const c of n.children ?? []) visit(c, depth + 1);
  };
  const scene = g.scenes?.[g.scene ?? 0];
  if (scene) for (const ni of scene.nodes ?? []) visit(ni, 0);
  else (g.meshes ?? []).forEach((_, mi) => (triangles += meshTris(mi)));
  return { triangles: Math.round(triangles), animations: (g.animations ?? []).map((a, i) => a.name || `clip${i}`) };
}

// .glb bytes or .gltf text/bytes → info (null when unreadable).
export function modelInfo(path: string, bytes: Uint8Array): GltfInfo | null {
  if (/\.glb$/i.test(path)) return gltfInfo(glbJson(bytes));
  try {
    return gltfInfo(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

// ─── Bounds ─────────────────────────────────────────────────────────────
// Bounding box of the default scene in model units (node transforms
// applied, from the POSITION accessors' min / max — no buffer read), plus a
// guess of the up axis: glTF is +Y up, but some exporters leave models
// lying on their back (+Z up).

export interface ModelBounds {
  size: [number, number, number]; // w × h × d
  center: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  // "y" (glTF convention) or "z?" when the model is much deeper than tall —
  // maybe exported Z-up (check with `render --isolate <id>`).
  upAxis: "y" | "z?";
  hint?: string;
}

interface BoundsJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[]; normalized?: boolean; componentType?: number }[];
}

type Mat = number[];
const COMPONENT_MAX: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat, b: Mat): Mat {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function nodeMatrix(n: NonNullable<BoundsJson["nodes"]>[number]): Mat {
  if (n.matrix?.length === 16) return n.matrix.slice();
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

export function gltfBounds(json: unknown): ModelBounds | null {
  if (!json || typeof json !== "object") return null;
  const g = json as BoundsJson;
  const acc = g.accessors ?? [];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const seen = new Set<number>();
  const visit = (ni: number, parent: Mat, depth: number) => {
    const n = g.nodes?.[ni];
    if (!n || depth > 64 || seen.has(ni)) return;
    seen.add(ni);
    const m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined) {
      for (const p of g.meshes?.[n.mesh]?.primitives ?? []) {
        const pos = p.attributes?.POSITION !== undefined ? acc[p.attributes.POSITION] : undefined;
        if (!pos?.min || !pos.max) continue;
        const k = pos.normalized ? 1 / (COMPONENT_MAX[pos.componentType ?? 0] ?? 1) : 1;
        const a = pos.min.map((v) => v * k);
        const b = pos.max.map((v) => v * k);
        for (let i = 0; i < 8; i++) {
          const x = i & 1 ? b[0] : a[0];
          const y = i & 2 ? b[1] : a[1];
          const z = i & 4 ? b[2] : a[2];
          const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
          for (let c = 0; c < 3; c++) {
            lo[c] = Math.min(lo[c], w[c]);
            hi[c] = Math.max(hi[c], w[c]);
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c, m, depth + 1);
  };
  const scene = g.scenes?.[g.scene ?? 0];
  const roots = scene?.nodes ?? (g.nodes ?? []).map((_, i) => i);
  for (const ni of roots) visit(ni, IDENTITY, 0);
  if (!Number.isFinite(lo[0])) return null;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const size = [0, 1, 2].map((c) => r(hi[c] - lo[c])) as [number, number, number];
  const center = [0, 1, 2].map((c) => r((hi[c] + lo[c]) / 2)) as [number, number, number];
  const zUp = size[2] > size[1] * 2 && size[2] > size[0] * 1.2 && Math.abs(center[2]) > size[1] * 0.25;
  return {
    size,
    center,
    min: lo.map(r) as [number, number, number],
    max: hi.map(r) as [number, number, number],
    upAxis: zUp ? "z?" : "y",
    ...(zUp ? { hint: "Much deeper (Z) than tall (Y) and off-centre in Z: it may have been exported Z-up (lying on its back). Check with `agent3d render --isolate <id>`; if so set the object's rotation to [-90, 0, 0]." } : {}),
  };
}

// .glb bytes or .gltf text/bytes → bounds (null when unreadable).
export function modelBounds(path: string, bytes: Uint8Array): ModelBounds | null {
  if (/\.glb$/i.test(path)) return gltfBounds(glbJson(bytes));
  try {
    return gltfBounds(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export async function modelFileBounds(fs: { exists(p: string): Promise<boolean>; readBytes(p: string): Promise<Uint8Array> }, path: string): Promise<ModelBounds | null> {
  if (!/\.(glb|gltf)$/i.test(path) || !(await fs.exists(path))) return null;
  return modelBounds(path, await fs.readBytes(path));
}
