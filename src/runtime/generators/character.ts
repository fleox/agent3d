// Stylised chibi characters and mascots built from soft primitives on a real
// bone hierarchy, skinned into 1–3 meshes (solid, glowing bits, glass), with
// expressive faces and procedural animations that are pure functions of t.
// Implementation in ./character/ (parts kit, face, humanoid, mascots, animate).
//
// Pointer: `object.userData.setPointer(x, y)` (normalised -1..1) turns the
// head / eyes toward the pointer when eyesFollowPointer is true.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built } from "./geom";
import { animate, resetRig } from "./character/animate";
import { applyFace, EXPRESSIONS, type Expression } from "./character/face";
import { humanoid } from "./character/humanoid";
import { bird, blob, ghost, quadruped, robot } from "./character/mascots";
import { Kit, Parts } from "./character/parts";
import { ACCESSORIES, type Accessory, type Anim, type BuildArgs, type HairStyle, type Look, type Outfit, type Rig, type Style } from "./character/rig";

// Colours used when the scene does not set them (per style).
const STYLE_COLORS: Record<Style, Record<"skin" | "shirt" | "pants" | "hair" | "accent", string>> = {
  humanoid: { skin: "#f1c27d", shirt: "#3a86ff", pants: "#22223b", hair: "#3b2a20", accent: "#ff006e" },
  astronaut: { skin: "#f1c27d", shirt: "#f4f5f8", pants: "#d9dde6", hair: "#3b2a20", accent: "#ff7b29" },
  robot: { skin: "#dfe3ea", shirt: "#3a86ff", pants: "#2b2d42", hair: "#2b2d42", accent: "#38f9ff" },
  blob: { skin: "#ffd6e0", shirt: "#7b8cff", pants: "#3d3a6b", hair: "#3d3a6b", accent: "#ff6fa3" },
  cat: { skin: "#ffb36b", shirt: "#ff006e", pants: "#3d3a6b", hair: "#c8692c", accent: "#ff7aa2" },
  fox: { skin: "#f2833a", shirt: "#ff006e", pants: "#3d3a6b", hair: "#3a2a2e", accent: "#ff7aa2" },
  bird: { skin: "#ffd166", shirt: "#ff9f43", pants: "#3d3a6b", hair: "#ef476f", accent: "#ff7f11" },
  ghost: { skin: "#f4f6ff", shirt: "#c7d2fe", pants: "#3d3a6b", hair: "#3d3a6b", accent: "#ff8fb1" },
};

const BUILD: Record<Style, (a: BuildArgs) => Rig> = {
  humanoid: (a) => humanoid(a),
  astronaut: (a) => humanoid(a, true),
  robot,
  blob,
  cat: (a) => quadruped(a, false),
  fox: (a) => quadruped(a, true),
  bird,
  ghost,
};

export const character: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("character", raw, ctx);
  const style = p.str<Style>("style");
  const anim = p.str<Anim>("animation");
  const speed = p.num("animationSpeed");
  const height = p.num("height");
  const follow = p.bool("eyesFollowPointer");
  const shading = p.str<"smooth" | "lowpoly" | "toon">("shading");
  const expressionRaw = p.str<Expression>("expression");
  const expression: Expression = EXPRESSIONS.includes(expressionRaw) ? expressionRaw : "happy";
  const defaults = STYLE_COLORS[style];
  const col = (k: keyof typeof defaults) => (raw[k] !== undefined && raw[k] !== null ? p.color(k) : ctx.color(defaults[k]).clone());
  const accRaw = Array.isArray(raw.accessories) ? (raw.accessories as unknown[]) : [];
  const look: Look = {
    skin: col("skin"),
    shirt: col("shirt"),
    pants: col("pants"),
    hair: col("hair"),
    accent: col("accent"),
    hairStyle: p.str<HairStyle>("hairStyle"),
    outfit: p.str<Outfit>("outfit"),
    accessories: new Set(accRaw.filter((a): a is Accessory => typeof a === "string" && (ACCESSORIES as readonly string[]).includes(a))),
  };
  const kit = new Kit(shading !== "lowpoly");
  const parts = new Parts();
  const r = BUILD[style]({ look, parts, kit });

  const metal = style === "robot";
  const solid: THREE.Material =
    shading === "toon"
      ? new THREE.MeshToonMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: shading === "lowpoly", roughness: metal ? 0.38 : shading === "lowpoly" ? 0.8 : 0.58, metalness: metal ? 0.25 : 0 });
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const glass = new THREE.MeshPhysicalMaterial({ vertexColors: true, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0, clearcoat: 1, depthWrite: false, side: THREE.FrontSide });
  const meshes = parts.finish(r.root, { solid, glow, glass });
  const solidMesh = meshes.find((m) => m.name === "character-solid");

  // Normalise the rest pose to the requested height (feet at y = 0).
  r.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  r.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && m.name !== "character-glass") {
      m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!);
    }
  });
  const scale = height / Math.max(0.01, box.max.y - Math.min(0, box.min.y));
  const holder = new THREE.Group();
  holder.name = "character-scale";
  holder.scale.setScalar(scale);
  holder.position.y = -Math.min(0, box.min.y) * scale;
  holder.add(r.root);
  const root = new THREE.Group();
  root.name = "character";
  root.add(holder);

  const pointer = { x: 0, y: 0 };
  root.userData.setPointer = (x: number, y: number) => {
    pointer.x = Math.max(-1, Math.min(1, x));
    pointer.y = Math.max(-1, Math.min(1, y));
  };
  root.userData.bones = { ...r.b, eyes: r.face.eyeL.parent };
  root.userData.style = style;

  // Ground lock on a sample of skinned vertices (toes, tails, paws…): no
  // pose may sink below the ground (rest-pose bottom), the rig is lifted instead.
  const groundY = Math.min(0, box.min.y);
  const sample: number[] = [];
  if (solidMesh && style !== "ghost") {
    // Vertices are bound rigidly to one bone each: the lowest point of a bone's
    // part under any rotation is on its convex hull, approximated by the
    // extreme vertices along 26 directions (a few hundred samples in total).
    const pos = solidMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const skin = solidMesh.geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
    const groups = new Map<number, number[]>();
    for (let i = 0; i < pos.count; i++) {
      const b = skin.getX(i);
      let g = groups.get(b);
      if (!g) groups.set(b, (g = []));
      g.push(i);
    }
    const dirs: THREE.Vector3[] = [];
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) dirs.push(new THREE.Vector3(x, y, z).normalize());
    const picked = new Set<number>();
    const v = new THREE.Vector3();
    for (const g of groups.values())
      for (const d of dirs) {
        let best = -1;
        let bestDot = -Infinity;
        for (const i of g) {
          const dot = v.fromBufferAttribute(pos, i).dot(d);
          if (dot > bestDot) {
            bestDot = dot;
            best = i;
          }
        }
        picked.add(best);
      }
    sample.push(...picked);
  }
  const vtx = new THREE.Vector3();
  const lockToGround = () => {
    if (!solidMesh || !sample.length) return;
    r.root.updateMatrixWorld(true);
    let min = Infinity;
    for (const i of sample) {
      solidMesh.getVertexPosition(i, vtx);
      vtx.applyMatrix4(r.root.matrix);
      if (vtx.y < min) min = vtx.y;
    }
    if (min < groundY) r.root.position.y += groundY - min;
  };

  const update = (t: number): void => {
    const tt = t * speed;
    resetRig(r);
    const face = animate(r, anim, tt, style, expression, true);
    lockToGround();
    applyFace(r.face, face);
    if (follow) {
      r.b.head!.rotation.y += pointer.x * 0.5;
      r.b.head!.rotation.x -= pointer.y * 0.3;
    }
    root.updateMatrixWorld(true);
  };
  update(0);
  return built(root, { update });
};
