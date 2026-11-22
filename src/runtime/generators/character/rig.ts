// Shared types of the character generator.

import type * as THREE from "three";
import type { FaceRig } from "./face";
import type { Kit, Parts } from "./parts";

export const STYLES = ["humanoid", "astronaut", "robot", "blob", "cat", "fox", "bird", "ghost"] as const;
export type Style = (typeof STYLES)[number];
export const ANIMATIONS = ["idle", "walk", "run", "wave", "jump", "dance", "cheer", "celebrate", "sit", "point", "talk", "none"] as const;
export type Anim = (typeof ANIMATIONS)[number];
export const HAIR_STYLES = ["short", "long", "bob", "bun", "ponytail", "spiky", "curly", "none"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export const OUTFITS = ["tshirt", "hoodie", "dress", "suit", "overalls"] as const;
export type Outfit = (typeof OUTFITS)[number];
export const ACCESSORIES = ["cap", "beanie", "glasses", "sunglasses", "headphones", "backpack", "scarf", "bowtie", "crown"] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export interface Look {
  skin: THREE.Color;
  shirt: THREE.Color;
  pants: THREE.Color;
  hair: THREE.Color;
  accent: THREE.Color;
  hairStyle: HairStyle;
  outfit: Outfit;
  accessories: Set<Accessory>;
}

export type RigKind = "biped" | "quad" | "bird" | "ghost";

export interface Rig {
  kind: RigKind;
  root: THREE.Group;
  // Named bones: hips, torso, head, armL/R, elbowL/R, handL/R, legL/R, kneeL/R,
  // legFL/FR/BL/BR (quadrupeds), wingL/R (bird), tail0…, ponytail, antenna.
  b: Record<string, THREE.Group>;
  face: FaceRig;
  tail: THREE.Group[];
  // Points (bone, local position) that must stay above the ground (y >= 0):
  // soles, pelvis, paws. Poses that would push them below are lifted.
  contacts?: [THREE.Object3D, [number, number, number]][];
}

export interface BuildArgs {
  look: Look;
  parts: Parts;
  kit: Kit;
}
