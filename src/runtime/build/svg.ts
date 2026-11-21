// SVG logos → extruded 3D meshes (centred, fitted to `size` width). Fill
// colours of the SVG are kept unless the object defines a material.

import * as THREE from "three";
import type { SvgObjectDef } from "../../core/types";
import { fetchText } from "../assets";
import { num } from "../util";
import type { RuntimeContext } from "./context";
import { createMaterial } from "./materials";

export async function buildSvg(def: SvgObjectDef, ctx: RuntimeContext): Promise<THREE.Group> {
  const { SVGLoader } = await import("three/addons/loaders/SVGLoader.js");
  const markup = def.src.trim().startsWith("<") ? def.src : await fetchText(ctx.resolveAsset(def.src));
  const data = new SVGLoader().parse(markup);
  const size = num(def.size, 2);
  const depthUnits = num(def.depth, 0.2);
  const bevelUnits = num(def.bevel, 0);

  // First pass: shapes + bounds in SVG units.
  const items: { shapes: THREE.Shape[]; color: THREE.Color; opacity: number }[] = [];
  const bounds = new THREE.Box2();
  for (const path of data.paths) {
    const style = (path.userData?.style ?? {}) as { fill?: string; fillOpacity?: number; opacity?: number };
    if (style.fill === "none") continue;
    const shapes = SVGLoader.createShapes(path);
    if (!shapes.length) continue;
    for (const s of shapes) for (const p of s.getPoints()) bounds.expandByPoint(p);
    const color = path.color ? path.color.clone() : new THREE.Color(0x000000);
    items.push({ shapes, color, opacity: num(style.fillOpacity, 1) * num(style.opacity, 1) });
  }
  const group = new THREE.Group();
  if (!items.length || bounds.isEmpty()) return group;
  const w = Math.max(bounds.max.x - bounds.min.x, 1e-6);
  const k = size / w; // svg units → world units
  const depth = Math.max(depthUnits / k, 0.0001);
  const bevel = bevelUnits / k;

  const override = def.material ? await createMaterial(def.material, ctx) : null;
  const inner = new THREE.Group();
  items.forEach((it, idx) => {
    const geo =
      depthUnits > 0
        ? new THREE.ExtrudeGeometry(it.shapes, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 12 })
        : new THREE.ShapeGeometry(it.shapes, 12);
    const mat =
      override ??
      new THREE.MeshStandardMaterial({
        color: it.color,
        roughness: 0.4,
        metalness: 0.1,
        transparent: it.opacity < 1,
        opacity: it.opacity,
        side: depthUnits > 0 ? THREE.FrontSide : THREE.DoubleSide,
      });
    const mesh = new THREE.Mesh(geo, mat);
    // Later paths sit slightly in front (SVG painter's order).
    mesh.position.z = idx * 0.001 / k;
    inner.add(mesh);
  });
  // SVG Y is down: flip, centre, scale, centre depth.
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cy = (bounds.min.y + bounds.max.y) / 2;
  inner.scale.set(k, -k, k);
  inner.position.set(-cx * k, cy * k, -(depthUnits / 2));
  group.add(inner);
  return group;
}
