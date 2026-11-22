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
