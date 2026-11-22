// Rigid-body physics for Agent3D scenes (pure TS over cannon-es, no DOM, no
// three): static / dynamic / kinematic / trigger bodies with rotation, box,
// sphere, cylinder, capsule, convex hull, triangle mesh and heightfield
// shapes (or compounds of them), friction / restitution materials and
// per-pair contact materials, damping, sleeping, collision layers, sub-steps
// for fast bodies, joints (hinge, point, distance, lock, spring), a character
// controller helper, raycasts, forces / impulses and begin / end contact
// events with contact point, normal and impulse.
//
// Deterministic: the same sequence of calls with the same fixed step gives
// the same result (cannon-es has no randomness; its wall-clock code paths are
// only used by variable stepping, which this module never calls). A rewind
// is a fresh PhysicsWorld (the host rebuilds the scene).
//
// Units: metres, seconds, kilograms; angular velocities in radians / s here
// (the ScriptApi converts degrees). Quaternions are [x, y, z, w].

import * as C from "cannon-es";

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export type BodyType = "static" | "dynamic" | "kinematic" | "trigger";

interface ShapeBase {
  offset?: V3; // in the body frame
  quat?: Q4;
}

export type ShapeDesc =
  | (ShapeBase & { type: "box"; half: V3 })
  | (ShapeBase & { type: "sphere"; radius: number })
  | (ShapeBase & { type: "cylinder"; radius: number; height: number; segments?: number })
  | (ShapeBase & { type: "capsule"; radius: number; height: number })
  | (ShapeBase & { type: "convex"; vertices: V3[]; faces: number[][] })
  // Exact triangles (static / kinematic only). Collides with every shape:
  // triangles become thin prisms grouped in spatial chunks.
  | (ShapeBase & { type: "trimesh"; vertices: ArrayLike<number>; indices?: ArrayLike<number> })
  // data[i][j]: height at x = i * elementSize, z = -j * elementSize (local),
  // heights along +y. The host offsets it to the terrain's corner.
  | (ShapeBase & { type: "heightfield"; data: number[][]; elementSize: number });

export interface BodyInit {
  id: string;
  type: BodyType;
  shapes: ShapeDesc[];
  position: V3;
  quaternion?: Q4;
  velocity?: V3;
  angularVelocity?: V3; // rad / s
  mass?: number;
  friction?: number;
  restitution?: number;
  material?: string;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  fixedRotation?: boolean;
  character?: boolean;
  sleep?: boolean;
  ccd?: boolean;
  layer?: string;
  collidesWith?: string[];
}

export interface WorldOptions {
  gravity?: V3;
  iterations?: number;
  substeps?: number;
  sleep?: boolean;
  materials?: Record<string, { friction?: number; restitution?: number }>;
  contacts?: { a: string; b: string; friction?: number; restitution?: number }[];
  layers?: string[];
}

export interface JointInit {
  id?: string;
  type: "hinge" | "point" | "distance" | "lock" | "spring";
  a: string;
  b?: string;
  pivot?: V3; // world
  axis?: V3; // world
  distance?: number;
  restLength?: number;
  stiffness?: number;
  damping?: number;
  motor?: { speed: number; maxForce?: number }; // rad / s
  limits?: [number, number]; // hinge angle limits, radians, relative to the start pose
  maxForce?: number;
  collideConnected?: boolean;
}

interface HingeLimit {
  A: C.Body;
  B: C.Body;
  pivotB: C.Vec3; // pivot in B's frame
  axisB: C.Vec3; // hinge axis in B's frame
  rel0: C.Quaternion; // B⁻¹·A at creation
  min: number;
  max: number;
}

/** Signed hinge angle of A relative to B around the axis, since the joint was made (radians, −π … π). */
export function hingeAngle(l: Pick<HingeLimit, "A" | "B" | "axisB" | "rel0">): number {
  const rel = l.B.quaternion.conjugate().mult(l.A.quaternion);
  const d = rel.mult(l.rel0.conjugate());
  const s = d.x * l.axisB.x + d.y * l.axisB.y + d.z * l.axisB.z;
  let a = 2 * Math.atan2(s, d.w);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Rotates the dynamic side of a limited hinge back inside [min, max] (about
// the world pivot) and cancels the relative spin that pushes it out.
function enforceLimit(l: HingeLimit): void {
  const angle = hingeAngle(l);
  const over = angle > l.max ? angle - l.max : angle < l.min ? angle - l.min : 0;
  if (!over) return;
  const moveA = l.A.mass > 0 || l.B.mass <= 0;
  const body = moveA ? l.A : l.B;
  if (body.mass <= 0) return;
  const axis = l.B.quaternion.vmult(l.axisB);
  axis.normalize();
  const pivot = l.B.quaternion.vmult(l.pivotB).vadd(l.B.position);
  // Turning A by −over (or B by +over) brings the relative angle back to the limit.
  const turn = new C.Quaternion().setFromAxisAngle(axis, moveA ? -over : over);
  const r = body.position.vsub(pivot);
  body.position.copy(turn.vmult(r).vadd(pivot));
  body.quaternion.copy(turn.mult(body.quaternion));
  body.quaternion.normalize();
  const wRel = l.A.angularVelocity.vsub(l.B.angularVelocity).dot(axis);
  if (wRel * over > 0) {
    const dw = axis.scale(moveA ? wRel : -wRel);
    body.angularVelocity.vsub(dw, body.angularVelocity);
    // Keep the linear velocity consistent with turning about the pivot.
    const rr = body.position.vsub(pivot);
    body.velocity.vsub(dw.cross(rr), body.velocity);
  }
  body.aabbNeedsUpdate = true;
}

export interface ContactInfo {
  point: V3; // world contact point
  normal: V3; // from a towards b
  impulse: number; // N·s along the normal (largest of the step)
  speed: number; // relative approach speed along the normal at first contact (m/s)
}

export interface Body {
  readonly id: string;
  readonly type: BodyType;
  readonly shapes: ShapeDesc[];
  readonly position: V3;
  readonly quaternion: Q4;
  readonly velocity: V3;
  readonly angularVelocity: V3;
  readonly mass: number;
  readonly sleeping: boolean;
  readonly grounded: boolean;
  readonly character: boolean;
}

export interface RayHit {
  body: Body;
  distance: number;
  point: V3;
  normal: V3;
}

interface Rec {
  id: string;
  type: BodyType;
  shapes: ShapeDesc[];
  main: C.Body;
  extra: C.Body[]; // trimesh chunks (same pose as main)
  order: number;
  gravityScale: number;
  ccd: boolean;
  character: boolean;
  minExtent: number;
  userVel: C.Vec3; // kinematic: velocity set by scripts
  kinFrom: { p: C.Vec3; q: C.Quaternion } | null; // kinematic: pose before this step's scripted move
  forces: { f: C.Vec3; p: C.Vec3 | null }[]; // applied for the next step
  torques: C.Vec3[];
  lastGrounded: number; // world time
  jumpedAt: number;
  view: Body;
}

interface ContactNow {
  a: Rec;
  b: Rec;
  info: ContactInfo;
  trigger: boolean;
}

const v3 = (v: C.Vec3): V3 => [v.x, v.y, v.z];
const cv = (v: V3 | undefined, d: V3 = [0, 0, 0]) => new C.Vec3(...(v ?? d));
const cq = (q: Q4 | undefined) => (q ? new C.Quaternion(q[0], q[1], q[2], q[3]) : new C.Quaternion());

const DEFAULT_FRICTION = 0.5;
const DEFAULT_RESTITUTION = 0.2;
const PRISM_DEPTH = 0.08;
const CHUNK_TRIS = 48;

// Thin triangular prisms (top face = the triangle, extruded backwards).
function trianglePrisms(vertices: ArrayLike<number>, indices: ArrayLike<number> | undefined): { shape: C.ConvexPolyhedron; center: V3 }[] {
  const out: { shape: C.ConvexPolyhedron; center: V3 }[] = [];
  const count = indices ? indices.length : vertices.length / 3;
  const P = (k: number) => {
    const i = (indices ? indices[k]! : k) * 3;
    return new C.Vec3(vertices[i]!, vertices[i + 1]!, vertices[i + 2]!);
  };
  for (let t = 0; t + 2 < count; t += 3) {
    const a = P(t), b = P(t + 1), c = P(t + 2);
    const n = b.vsub(a).cross(c.vsub(a));
    const area = n.length();
    if (area < 1e-9) continue;
    n.scale(PRISM_DEPTH / area, n);
    // Centre strictly inside the prism (cannon checks face normals against it).
    const center = a.vadd(b).vadd(c).scale(1 / 3).vsub(n.scale(0.5));
    const verts = [a, b, c, a.vsub(n), b.vsub(n), c.vsub(n)].map((p) => p.vsub(center));
    const shape = new C.ConvexPolyhedron({ vertices: verts, faces: [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]] });
    out.push({ shape, center: v3(center) });
  }
  return out;
}

// Spatial chunks (sorted along the longest axis, recursively) so the
// broadphase culls far triangles.
function chunk<T extends { center: V3 }>(items: T[], size: number): T[][] {
  if (items.length <= size) return items.length ? [items] : [];
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const it of items) for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i]!, it.center[i]!)), (max[i] = Math.max(max[i]!, it.center[i]!));
  const ax = [0, 1, 2].reduce((best, i) => (max[i]! - min[i]! > max[best]! - min[best]! ? i : best), 0);
  const sorted = [...items].sort((p, q) => p.center[ax]! - q.center[ax]!);
  const half = sorted.length >> 1;
  return [...chunk(sorted.slice(0, half), size), ...chunk(sorted.slice(half), size)];
}

function minExtent(shapes: ShapeDesc[]): number {
  let m = Infinity;
  for (const s of shapes) {
    if (s.type === "box") m = Math.min(m, 2 * Math.min(...s.half));
    else if (s.type === "sphere" || s.type === "cylinder" || s.type === "capsule") m = Math.min(m, 2 * s.radius);
    else if (s.type === "convex") {
      const ext: V3 = [0, 1, 2].map((i) => Math.max(...s.vertices.map((p) => p[i]!)) - Math.min(...s.vertices.map((p) => p[i]!))) as V3;
      m = Math.min(m, ...ext);
    }
  }
  return Number.isFinite(m) ? Math.max(m, 0.01) : 1;
}

export class PhysicsWorld {
  readonly world: C.World;
  private recs: Rec[] = [];
  private byId = new Map<string, Rec>();
  private byBody = new Map<C.Body, Rec>();
  private order = 0;
  private materials = new Map<string, C.Material>();
  private materialProps = new Map<C.Material, { name?: string; friction: number; restitution: number }>();
  private namedMaterials: Record<string, { friction?: number; restitution?: number }>;
  private pairOverrides = new Map<string, { friction?: number; restitution?: number }>();
  private layerBits = new Map<string, number>();
  private joints: { id: string; a: string; b?: string; constraint?: C.Constraint; spring?: C.Spring; anchor?: C.Body; limit?: HingeLimit }[] = [];
  private contactsNow = new Map<string, ContactNow>();
  private contactsPrev = new Map<string, ContactNow>();
  private beginHandlers: ((a: Body, b: Body, info: ContactInfo) => void)[] = [];
  private endHandlers: ((a: Body, b: Body) => void)[] = [];
  private substeps: number;
  private time = 0;
  private preVel = new Map<Rec, C.Vec3>();
  private stepDt = 1 / 60;

  constructor(opts: WorldOptions | V3 = {}) {
    const o: WorldOptions = Array.isArray(opts) ? { gravity: opts } : opts;
    this.world = new C.World({ gravity: cv(o.gravity, [0, -9.81, 0]), allowSleep: o.sleep ?? true });
    this.world.broadphase.useBoundingBoxes = true;
    (this.world.solver as C.GSSolver).iterations = o.iterations ?? 10;
    this.world.defaultContactMaterial.friction = DEFAULT_FRICTION;
    this.world.defaultContactMaterial.restitution = DEFAULT_RESTITUTION;
    this.substeps = Math.min(8, Math.max(1, Math.round(o.substeps ?? 1)));
    this.namedMaterials = o.materials ?? {};
    for (const c of o.contacts ?? []) this.pairOverrides.set([c.a, c.b].sort().join("|"), c);
    this.layerBits.set("default", 1);
    for (const l of o.layers ?? []) this.layerBit(l);
  }

  // ─── Bodies ─────────────────────────────────────────────────────────

  get bodies(): Body[] {
    return this.recs.map((r) => r.view);
  }

  get(id: string): Body | undefined {
    return this.byId.get(id)?.view;
  }

  private layerBit(name: string): number {
    let bit = this.layerBits.get(name);
    if (bit === undefined) {
      if (this.layerBits.size >= 16) return 1;
      bit = 1 << this.layerBits.size;
      this.layerBits.set(name, bit);
    }
    return bit;
  }

  layerMask(layers: string[] | undefined): number {
    if (!layers) return -1;
    return layers.reduce((m, l) => m | this.layerBit(l), 0);
  }

  private material(name: string | undefined, friction: number, restitution: number): C.Material {
    const key = `${name ?? ""}|${friction}|${restitution}`;
    let m = this.materials.get(key);
    if (m) return m;
    // friction / restitution -1: the contact material decides (cannon would
    // otherwise multiply the body values).
    m = new C.Material({ friction: -1, restitution: -1 });
    this.materialProps.set(m, { name, friction, restitution });
    this.materials.set(key, m);
    for (const other of this.materials.values()) {
      const pa = this.materialProps.get(m)!, pb = this.materialProps.get(other)!;
      const ov = pa.name && pb.name ? this.pairOverrides.get([pa.name, pb.name].sort().join("|")) : undefined;
      this.world.addContactMaterial(
        new C.ContactMaterial(m, other, {
          friction: ov?.friction ?? Math.sqrt(pa.friction * pb.friction),
          restitution: ov?.restitution ?? Math.max(pa.restitution, pb.restitution),
        }),
      );
    }
    return m;
  }

  add(init: BodyInit): Body {
    this.remove(init.id);
    const named = init.material ? this.namedMaterials[init.material] : undefined;
    const character = !!init.character;
    const friction = character ? 0 : (init.friction ?? named?.friction ?? DEFAULT_FRICTION);
    const restitution = character ? 0 : (init.restitution ?? named?.restitution ?? DEFAULT_RESTITUTION);
    const type = init.type;
    const dynamic = type === "dynamic";
    const mass = dynamic ? Math.max(init.mass ?? 1, 1e-4) : 0;
    const material = this.material(init.material, friction, restitution);
    const group = this.layerBit(init.layer ?? "default");
    const mask = this.layerMask(init.collidesWith);
    const make = () =>
      new C.Body({
        mass,
        type: dynamic ? C.Body.DYNAMIC : type === "static" ? C.Body.STATIC : C.Body.KINEMATIC,
        position: cv(init.position),
        quaternion: cq(init.quaternion),
        material,
        isTrigger: type === "trigger",
        linearDamping: init.linearDamping ?? 0.01,
        angularDamping: init.angularDamping ?? (character ? 1 : 0.01),
        fixedRotation: character || !!init.fixedRotation,
        allowSleep: dynamic && !character && init.sleep !== false,
        sleepSpeedLimit: 0.12,
        sleepTimeLimit: 0.6,
        collisionFilterGroup: group,
        collisionFilterMask: mask,
      });
    const main = make();
    const extra: C.Body[] = [];
    for (const s of init.shapes) this.addShape(main, s, extra, make);
    if (init.velocity) main.velocity.set(...init.velocity);
    if (init.angularVelocity && dynamic) main.angularVelocity.set(...init.angularVelocity);
    if (type === "kinematic" && init.velocity) main.velocity.set(...init.velocity);
    main.updateMassProperties();
    this.world.addBody(main);
    for (const b of extra) this.world.addBody(b);
    const rec: Rec = {
      id: init.id,
      type,
      shapes: init.shapes,
      main,
      extra,
      order: this.order++,
      gravityScale: init.gravityScale ?? 1,
      ccd: !!init.ccd,
      character,
      minExtent: minExtent(init.shapes),
      userVel: type === "kinematic" || type === "trigger" ? main.velocity.clone() : new C.Vec3(),
      kinFrom: null,
      forces: [],
      torques: [],
      lastGrounded: -Infinity,
      jumpedAt: -Infinity,
      view: null as unknown as Body,
    };
    rec.view = this.viewOf(rec);
    this.recs.push(rec);
    this.byId.set(rec.id, rec);
    this.byBody.set(main, rec);
    for (const b of extra) this.byBody.set(b, rec);
    return rec.view;
  }

  private viewOf(rec: Rec): Body {
    const host = this;
    return {
      id: rec.id,
      type: rec.type,
      shapes: rec.shapes,
      get position() { return v3(rec.main.position); },
      get quaternion() { const q = rec.main.quaternion; return [q.x, q.y, q.z, q.w] as Q4; },
      get velocity() { return v3(rec.main.velocity); },
      get angularVelocity() { return v3(rec.main.angularVelocity); },
      get mass() { return rec.main.mass; },
      get sleeping() { return rec.main.sleepState === C.Body.SLEEPING; },
      get grounded() { return host.isGrounded(rec); },
      character: rec.character,
    };
  }

  private addShape(body: C.Body, s: ShapeDesc, extra: C.Body[], make: () => C.Body): void {
    const off = cv(s.offset);
    const q = cq(s.quat);
    switch (s.type) {
      case "box":
        body.addShape(new C.Box(new C.Vec3(Math.max(s.half[0], 1e-3), Math.max(s.half[1], 1e-3), Math.max(s.half[2], 1e-3))), off, q);
        break;
      case "sphere":
        body.addShape(new C.Sphere(Math.max(s.radius, 1e-3)), off, q);
        break;
      case "cylinder":
        body.addShape(new C.Cylinder(s.radius, s.radius, Math.max(s.height, 1e-3), s.segments ?? 16), off, q);
        break;
      case "capsule": {
        const r = Math.max(s.radius, 1e-3);
        const mid = Math.max(s.height - 2 * r, 0);
        if (mid > 1e-3) body.addShape(new C.Cylinder(r, r, mid, 12), off, q);
        for (const sign of mid > 1e-3 ? [1, -1] : [0]) {
          const local = q.vmult(new C.Vec3(0, (sign * mid) / 2, 0));
          body.addShape(new C.Sphere(r), off.vadd(local), q);
        }
        break;
      }
      case "convex": {
        const shape = new C.ConvexPolyhedron({ vertices: s.vertices.map((p) => new C.Vec3(...p)), faces: s.faces });
        body.addShape(shape, off, q);
        break;
      }
      case "heightfield":
        body.addShape(new C.Heightfield(s.data, { elementSize: s.elementSize }), off, q);
        break;
      case "trimesh": {
        // Prisms in the shape frame, then placed with offset / quat.
        const prisms = trianglePrisms(s.vertices, s.indices);
        chunk(prisms, CHUNK_TRIS).forEach((group, i) => {
          const target = i === 0 ? body : make();
          for (const p of group) target.addShape(p.shape, off.vadd(q.vmult(new C.Vec3(...p.center))), q);
          if (i > 0) extra.push(target);
        });
        break;
      }
    }
  }

  remove(id: string): void {
    const rec = this.byId.get(id);
    if (!rec) return;
    for (const j of this.joints.filter((x) => x.a === id || x.b === id)) this.removeJoint(j.id);
    this.world.removeBody(rec.main);
    for (const b of rec.extra) this.world.removeBody(b);
    this.byId.delete(id);
    this.byBody.delete(rec.main);
    for (const b of rec.extra) this.byBody.delete(b);
    this.recs.splice(this.recs.indexOf(rec), 1);
    for (const [k, c] of this.contactsNow) if (c.a === rec || c.b === rec) this.contactsNow.delete(k);
    for (const [k, c] of this.contactsPrev) if (c.a === rec || c.b === rec) this.contactsPrev.delete(k);
  }

  // Teleport (scripts moved the object). Kinematic bodies sweep to the new pose
  // during the next step so they push dynamic bodies (moving platforms).
  setPose(id: string, position: V3, quaternion?: Q4): void {
    const rec = this.byId.get(id);
    if (!rec) return;
    const b = rec.main;
    if ((rec.type === "kinematic" || rec.type === "trigger") && !rec.kinFrom) rec.kinFrom = { p: b.position.clone(), q: b.quaternion.clone() };
    for (const body of [b, ...rec.extra]) {
      body.position.set(...position);
      if (quaternion) body.quaternion.set(...quaternion);
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      body.previousQuaternion.copy(body.quaternion);
      body.interpolatedQuaternion.copy(body.quaternion);
      body.aabbNeedsUpdate = true;
    }
    if (rec.type === "dynamic") b.wakeUp();
    else this.wakeAround(rec);
  }

  private wakeAround(rec: Rec): void {
    const box = this.aabb(rec);
    if (!box) return;
    for (const r of this.recs) {
      if (r.type !== "dynamic" || r.main.sleepState !== C.Body.SLEEPING) continue;
      const o = this.aabb(r);
      if (o && o.overlaps(box)) this.wakeIsland(r);
    }
  }

  private aabb(rec: Rec): C.AABB | null {
    const all = [rec.main, ...rec.extra].filter((b) => b.shapes.length);
    if (!all.length) return null;
    const box = new C.AABB();
    all.forEach((b, i) => {
      if (b.aabbNeedsUpdate) b.updateAABB();
      if (i === 0) box.copy(b.aabb);
      else box.extend(b.aabb);
    });
    // A small margin: touching counts.
    box.lowerBound.vsub(new C.Vec3(1e-3, 1e-3, 1e-3), box.lowerBound);
    box.upperBound.vadd(new C.Vec3(1e-3, 1e-3, 1e-3), box.upperBound);
    return box;
  }

  setVelocity(id: string, v: V3): void {
    const rec = this.byId.get(id);
    if (!rec || rec.type === "static") return;
    rec.main.velocity.set(...v);
    if (rec.type !== "dynamic") rec.userVel.set(...v);
    rec.main.wakeUp();
  }

  setAngularVelocity(id: string, w: V3): void {
    const rec = this.byId.get(id);
    if (!rec || rec.type === "static") return;
    rec.main.angularVelocity.set(...w);
    rec.main.wakeUp();
  }

  applyImpulse(id: string, impulse: V3, point?: V3): void {
    const rec = this.byId.get(id);
    if (!rec || rec.type !== "dynamic") return;
    const rel = point ? new C.Vec3(...point).vsub(rec.main.position) : new C.Vec3();
    rec.main.applyImpulse(new C.Vec3(...impulse), rel);
    rec.main.wakeUp();
  }

  // Continuous force for the next fixed step (call every update to keep pushing).
  applyForce(id: string, force: V3, point?: V3): void {
    const rec = this.byId.get(id);
    if (!rec || rec.type !== "dynamic") return;
    rec.forces.push({ f: new C.Vec3(...force), p: point ? new C.Vec3(...point) : null });
    rec.main.wakeUp();
  }

  applyTorque(id: string, torque: V3): void {
    const rec = this.byId.get(id);
    if (!rec || rec.type !== "dynamic") return;
    rec.torques.push(new C.Vec3(...torque));
    rec.main.wakeUp();
  }

  wake(id: string): void {
    this.byId.get(id)?.main.wakeUp();
  }

  // ─── Joints ─────────────────────────────────────────────────────────

  addJoint(j: JointInit): string | null {
    const ra = this.byId.get(j.a);
    const rb = j.b ? this.byId.get(j.b) : undefined;
    if (!ra || (j.b && !rb)) return null;
    const id = j.id ?? `joint-${this.joints.length + 1}`;
    const A = ra.main;
    const pivot = new C.Vec3(...(j.pivot ?? (rb ? v3(rb.main.position) : v3(A.position))));
    let anchor: C.Body | undefined;
    let B: C.Body;
    if (rb) B = rb.main;
    else {
      anchor = new C.Body({ mass: 0, type: C.Body.STATIC, position: pivot.clone(), collisionFilterGroup: 0, collisionFilterMask: 0 });
      this.world.addBody(anchor);
      B = anchor;
    }
    const local = (body: C.Body, p: C.Vec3) => body.quaternion.conjugate().vmult(p.vsub(body.position));
    const localDir = (body: C.Body, d: C.Vec3) => body.quaternion.conjugate().vmult(d);
    const maxForce = j.maxForce ?? 1e6;
    const collideConnected = j.collideConnected ?? false;
    let constraint: C.Constraint | undefined;
    let spring: C.Spring | undefined;
    let limit: HingeLimit | undefined;
    switch (j.type) {
      case "hinge": {
        const axis = new C.Vec3(...(j.axis ?? [0, 1, 0]));
        if (axis.length() < 1e-9) axis.set(0, 1, 0);
        axis.normalize();
        const h = new C.HingeConstraint(A, B, { pivotA: local(A, pivot), pivotB: local(B, pivot), axisA: localDir(A, axis), axisB: localDir(B, axis), maxForce, collideConnected });
        if (j.limits) {
          // cannon's hinge has no limits: enforced after each sub-step (enforceLimit).
          limit = {
            A,
            B,
            pivotB: local(B, pivot),
            axisB: localDir(B, axis),
            rel0: B.quaternion.conjugate().mult(A.quaternion),
            min: Math.min(j.limits[0], j.limits[1]),
            max: Math.max(j.limits[0], j.limits[1]),
          };
        }
        if (j.motor) {
          h.enableMotor();
          // cannon drives B relative to A; with the world anchor as B, negate.
          h.setMotorSpeed(rb ? j.motor.speed : -j.motor.speed);
          h.setMotorMaxForce(j.motor.maxForce ?? 100);
        }
        constraint = h;
        break;
      }
      case "point":
        constraint = new C.PointToPointConstraint(A, local(A, pivot), B, local(B, pivot), maxForce);
        constraint.collideConnected = collideConnected;
        break;
      case "distance": {
        const d = j.distance ?? A.position.distanceTo(B.position);
        constraint = new C.DistanceConstraint(A, B, d, maxForce);
        constraint.collideConnected = collideConnected;
        break;
      }
      case "lock":
        constraint = new C.LockConstraint(A, B, { maxForce });
        constraint.collideConnected = collideConnected;
        break;
      case "spring": {
        const pa = j.pivot && rb ? local(A, pivot) : new C.Vec3();
        const pb = j.pivot ? local(B, pivot) : new C.Vec3();
        const wa = A.quaternion.vmult(pa).vadd(A.position), wb = B.quaternion.vmult(pb).vadd(B.position);
        spring = new C.Spring(A, B, { localAnchorA: pa, localAnchorB: pb, restLength: j.restLength ?? wa.distanceTo(wb), stiffness: j.stiffness ?? 50, damping: j.damping ?? 1 });
        break;
      }
    }
    if (constraint) this.world.addConstraint(constraint);
    this.joints.push({ id, a: j.a, b: j.b, constraint, spring, anchor, limit });
    return id;
  }

  removeJoint(id: string): void {
    const i = this.joints.findIndex((j) => j.id === id);
    if (i < 0) return;
    const j = this.joints[i]!;
    if (j.constraint) this.world.removeConstraint(j.constraint);
    if (j.anchor) this.world.removeBody(j.anchor);
    this.joints.splice(i, 1);
  }

  setMotorSpeed(id: string, speed: number): void {
    const j = this.joints.find((x) => x.id === id);
    if (j?.constraint instanceof C.HingeConstraint) {
      j.constraint.enableMotor();
      j.constraint.setMotorSpeed(j.b ? speed : -speed);
      this.byId.get(j.a)?.main.wakeUp();
    }
  }

  /** True when a joint holds this body. */
  hasJoints(id: string): boolean {
    return this.joints.some((j) => j.a === id || j.b === id);
  }

  jointIds(): string[] {
    return this.joints.map((j) => j.id);
  }

  // ─── Events ─────────────────────────────────────────────────────────

  onCollision(handler: (a: Body, b: Body, info: ContactInfo) => void): void {
    this.beginHandlers.push(handler);
  }

  onCollisionEnd(handler: (a: Body, b: Body) => void): void {
    this.endHandlers.push(handler);
  }

  // ─── Character controller ───────────────────────────────────────────

  private isGrounded(rec: Rec): boolean {
    for (const c of this.contactsNow.values()) {
      if (c.trigger) continue;
      if (c.a === rec && -c.info.normal[1] > 0.5) return true;
      if (c.b === rec && c.info.normal[1] > 0.5) return true;
    }
    return false;
  }

  grounded(id: string): boolean {
    const rec = this.byId.get(id);
    return !!rec && this.isGrounded(rec);
  }

  // Horizontal steering toward dir * speed (|dir| ≤ 1), keeping vertical
  // velocity. Call once per update. Turns the body into a character
  // (no rotation, no friction, never sleeps) on first use.
  moveCharacter(id: string, dir: [number, number], opts: { speed?: number; acceleration?: number; airControl?: number } = {}): void {
    const rec = this.byId.get(id);
    if (!rec || rec.type === "static") return;
    this.makeCharacter(rec);
    const b = rec.main;
    let [dx, dz] = dir;
    const len = Math.hypot(dx, dz);
    if (len > 1) (dx /= len), (dz /= len);
    const speed = opts.speed ?? 5;
    const accel = (opts.acceleration ?? 40) * (this.isGrounded(rec) || rec.type !== "dynamic" ? 1 : (opts.airControl ?? 0.35));
    const maxDv = accel * this.stepDt;
    const step = (cur: number, target: number) => cur + Math.max(-maxDv, Math.min(maxDv, target - cur));
    const vx = step(b.velocity.x, dx * speed), vz = step(b.velocity.z, dz * speed);
    b.velocity.set(vx, b.velocity.y, vz);
    if (rec.type !== "dynamic") rec.userVel.set(vx, b.velocity.y, vz);
    b.wakeUp();
  }

  // Jump when grounded (or within 0.12 s of leaving the ground). Returns true when it jumped.
  jump(id: string, speed = 6): boolean {
    const rec = this.byId.get(id);
    if (!rec || rec.type !== "dynamic") return false;
    this.makeCharacter(rec);
    const grounded = this.isGrounded(rec) || this.time - rec.lastGrounded <= 0.12;
    if (!grounded || this.time - rec.jumpedAt < 0.2) return false;
    rec.jumpedAt = this.time;
    rec.lastGrounded = -Infinity;
    rec.main.velocity.y = speed;
    rec.main.wakeUp();
    return true;
  }

  private makeCharacter(rec: Rec): void {
    if (rec.character) return;
    rec.character = true;
    (rec.view as { character: boolean }).character = true;
    const b = rec.main;
    b.fixedRotation = true;
    b.angularVelocity.set(0, 0, 0);
    b.allowSleep = false;
    b.updateMassProperties();
    const props = b.material ? this.materialProps.get(b.material) : undefined;
    b.material = this.material(props?.name, 0, 0);
  }

  // ─── Simulation ─────────────────────────────────────────────────────

  step(dt: number): void {
    this.stepDt = dt;
    let n = this.substeps;
    for (const r of this.recs) {
      if (!r.ccd || r.main.sleepState === C.Body.SLEEPING) continue;
      const travel = r.main.velocity.length() * dt;
      n = Math.max(n, Math.min(8, Math.ceil(travel / (0.5 * r.minExtent))));
    }
    const h = dt / n;
    this.wakeAhead(dt);
    // Kinematic sweeps (scripted moves this step).
    const sweeps: { rec: Rec; p: C.Vec3; q: C.Quaternion }[] = [];
    for (const r of this.recs) {
      if (!r.kinFrom) continue;
      const to = { p: r.main.position.clone(), q: r.main.quaternion.clone() };
      const d = to.p.vsub(r.kinFrom.p);
      if (d.length() < 2.5 && r.type === "kinematic") {
        for (const body of [r.main, ...r.extra]) {
          body.position.copy(r.kinFrom.p);
          body.quaternion.copy(r.kinFrom.q);
        }
        r.main.velocity.copy(d.scale(1 / dt).vadd(r.userVel));
        // Angular velocity from the quaternion delta.
        const dq = to.q.mult(r.kinFrom.q.conjugate());
        if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
        const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
        const angle = 2 * Math.acos(Math.min(1, dq.w));
        if (s > 1e-6) r.main.angularVelocity.set((dq.x / s) * angle / dt, (dq.y / s) * angle / dt, (dq.z / s) * angle / dt);
        else r.main.angularVelocity.set(0, 0, 0);
        for (const e of r.extra) (e.velocity.copy(r.main.velocity), e.angularVelocity.copy(r.main.angularVelocity));
        sweeps.push({ rec: r, ...to });
      }
      r.kinFrom = null;
    }
    const merged = new Map<string, ContactNow>();
    const g = this.world.gravity;
    for (let i = 0; i < n; i++) {
      for (const r of this.recs) {
        if (r.type !== "dynamic") continue;
        const b = r.main;
        if (r.gravityScale !== 1) b.force.vadd(g.scale(b.mass * (r.gravityScale - 1)), b.force);
        for (const f of r.forces) b.applyForce(f.f, f.p ? f.p.vsub(b.position) : new C.Vec3());
        for (const t of r.torques) b.torque.vadd(t, b.torque);
      }
      for (const j of this.joints) j.spring?.applyForce();
      this.preVel.clear();
      for (const r of this.recs) if (r.type !== "static") this.preVel.set(r, r.main.velocity.clone());
      this.world.step(h);
      for (const j of this.joints) if (j.limit) enforceLimit(j.limit);
      this.time += h;
      this.collectContacts(merged, h);
    }
    for (const r of this.recs) (r.forces = []), (r.torques = []);
    for (const s of sweeps) {
      for (const body of [s.rec.main, ...s.rec.extra]) {
        body.position.copy(s.p);
        body.quaternion.copy(s.q);
        body.velocity.copy(s.rec.userVel);
        body.angularVelocity.set(0, 0, 0);
        body.aabbNeedsUpdate = true;
      }
    }
    // Trigger ↔ kinematic / static overlaps (no contact equations for those pairs).
    for (const t of this.recs) {
      if (t.type !== "trigger") continue;
      for (const o of this.recs) {
        if (o === t || o.type === "dynamic" || o.type === "trigger" || o.type === "static") continue;
        if (!this.filterOk(t, o)) continue;
        const [a, b] = t.order < o.order ? [t, o] : [o, t];
        const key = `${a.id}|${b.id}`;
        if (merged.has(key) || !this.overlapRecs(a, b)) continue;
        const pa = a.main.position, pb = b.main.position;
        const d = pb.vsub(pa);
        const len = d.length() || 1;
        merged.set(key, { a, b, trigger: true, info: { point: v3(pa.vadd(pb).scale(0.5)), normal: [d.x / len, d.y / len, d.z / len], impulse: 0, speed: 0 } });
      }
    }
    // Sleeping bodies keep their resting contacts (the broadphase skips them).
    const resting = (r: Rec) => r.type === "static" || r.main.sleepState === C.Body.SLEEPING;
    for (const [key, c] of this.contactsNow) {
      if (merged.has(key) || !resting(c.a) || !resting(c.b) || !this.byId.has(c.a.id) || !this.byId.has(c.b.id)) continue;
      merged.set(key, { ...c, info: { ...c.info, impulse: 0, speed: 0 } });
    }
    this.contactsPrev = this.contactsNow;
    this.contactsNow = merged;
    for (const r of this.recs) if (this.isGrounded(r)) r.lastGrounded = this.time;
    for (const [key, c] of merged) {
      if (this.contactsPrev.has(key)) continue;
      for (const h of this.beginHandlers) h(c.a.view, c.b.view, c.info);
    }
    for (const [key, c] of this.contactsPrev) {
      if (merged.has(key) || !this.byId.has(c.a.id) || !this.byId.has(c.b.id)) continue;
      for (const h of this.endHandlers) h(c.a.view, c.b.view);
    }
  }

  // cannon treats a sleeping body as static during the step it gets hit
  // (the moving body bounces off it). Wake sleeping bodies that a moving body
  // will reach during this step so the impact transfers momentum.
  private wakeAhead(dt: number): void {
    let sleepers: { r: Rec; box: C.AABB }[] | null = null;
    for (const r of this.recs) {
      if (r.type === "static" || r.type === "trigger" || r.main.sleepState === C.Body.SLEEPING) continue;
      const v = r.main.velocity;
      const speed = v.length();
      if (speed < 0.5) continue;
      const box = this.aabb(r);
      if (!box) continue;
      if (!sleepers) {
        sleepers = [];
        for (const o of this.recs) {
          if (o.type !== "dynamic" || o.main.sleepState !== C.Body.SLEEPING) continue;
          const ob = this.aabb(o);
          if (ob) sleepers.push({ r: o, box: ob });
        }
      }
      if (!sleepers.length) return;
      const reach = new C.Vec3(Math.abs(v.x) * dt * 2 + 0.05, Math.abs(v.y) * dt * 2 + 0.05, Math.abs(v.z) * dt * 2 + 0.05);
      box.lowerBound.vsub(reach, box.lowerBound);
      box.upperBound.vadd(reach, box.upperBound);
      for (const s of sleepers) if (s.r.main.sleepState === C.Body.SLEEPING && s.box.overlaps(box)) this.wakeIsland(s.r);
    }
  }

  // Wake a sleeping body and every sleeping body resting on it (a stack wakes as a whole).
  private wakeIsland(start: Rec): void {
    const queue = [start];
    start.main.wakeUp();
    while (queue.length) {
      const r = queue.pop()!;
      for (const c of this.contactsNow.values()) {
        const o = c.a === r ? c.b : c.b === r ? c.a : null;
        if (o && o.type === "dynamic" && o.main.sleepState === C.Body.SLEEPING) {
          o.main.wakeUp();
          queue.push(o);
        }
      }
    }
  }

  private filterOk(a: Rec, b: Rec): boolean {
    return (a.main.collisionFilterGroup & b.main.collisionFilterMask) !== 0 && (b.main.collisionFilterGroup & a.main.collisionFilterMask) !== 0;
  }

  private collectContacts(into: Map<string, ContactNow>, h: number): void {
    for (const eq of this.world.contacts) {
      let ra = this.byBody.get(eq.bi), rb = this.byBody.get(eq.bj);
      if (!ra || !rb || ra === rb) continue;
      let normal = v3(eq.ni);
      let point = v3(eq.bi.position.vadd(eq.ri));
      if (rb.order < ra.order) {
        [ra, rb] = [rb, ra];
        normal = [-normal[0], -normal[1], -normal[2]];
        point = v3(eq.bj.position.vadd(eq.rj));
      }
      const key = `${ra.id}|${rb.id}`;
      const impulse = Math.abs(eq.multiplier) * h;
      const prev = into.get(key);
      if (prev) {
        if (impulse > prev.info.impulse) prev.info.impulse = impulse;
        continue;
      }
      const zero = new C.Vec3();
      const vrel = (this.preVel.get(rb) ?? zero).vsub(this.preVel.get(ra) ?? zero);
      const speed = Math.max(0, -(vrel.x * normal[0] + vrel.y * normal[1] + vrel.z * normal[2]));
      into.set(key, { a: ra, b: rb, trigger: ra.type === "trigger" || rb.type === "trigger", info: { point, normal, impulse, speed: this.contactsPrev.has(key) ? 0 : speed } });
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────

  contacts(): { a: Body; b: Body; info: ContactInfo; trigger: boolean }[] {
    return [...this.contactsNow.values()].map((c) => ({ a: c.a.view, b: c.b.view, info: c.info, trigger: c.trigger }));
  }

  contactsOf(id: string): Body[] {
    const out: Body[] = [];
    for (const c of this.contactsNow.values()) {
      if (c.a.id === id) out.push(c.b.view);
      else if (c.b.id === id) out.push(c.a.view);
    }
    return out;
  }

  // Exact shape overlap right now (works between any body types).
  overlaps(idA: string, idB: string): boolean {
    const a = this.byId.get(idA), b = this.byId.get(idB);
    if (!a || !b || a === b) return false;
    return this.overlapRecs(a, b);
  }

  private overlapRecs(a: Rec, b: Rec): boolean {
    const ba = this.aabb(a), bb = this.aabb(b);
    if (!ba || !bb || !ba.overlaps(bb)) return false;
    for (const x of [a.main, ...a.extra]) for (const y of [b.main, ...b.extra]) if (this.bodiesOverlap(x, y)) return true;
    return false;
  }

  // Mirrors cannon's Narrowphase.getContacts loop in "just test" mode.
  private bodiesOverlap(bi: C.Body, bj: C.Body): boolean {
    const np = this.world.narrowphase as unknown as Record<number, (...args: unknown[]) => boolean>;
    const qi = new C.Quaternion(), qj = new C.Quaternion(), xi = new C.Vec3(), xj = new C.Vec3();
    for (let i = 0; i < bi.shapes.length; i++) {
      bi.quaternion.mult(bi.shapeOrientations[i]!, qi);
      bi.quaternion.vmult(bi.shapeOffsets[i]!, xi);
      xi.vadd(bi.position, xi);
      const si = bi.shapes[i]!;
      for (let j = 0; j < bj.shapes.length; j++) {
        bj.quaternion.mult(bj.shapeOrientations[j]!, qj);
        bj.quaternion.vmult(bj.shapeOffsets[j]!, xj);
        xj.vadd(bj.position, xj);
        const sj = bj.shapes[j]!;
        if (xi.distanceTo(xj) > si.boundingSphereRadius + sj.boundingSphereRadius + 1e-3) continue;
        const resolver = np[si.type | sj.type];
        if (!resolver) continue;
        const hit = si.type < sj.type ? resolver.call(np, si, sj, xi, xj, qi, qj, bi, bj, si, sj, true) : resolver.call(np, sj, si, xj, xi, qj, qi, bj, bi, si, sj, true);
        if (hit) return true;
      }
    }
    return false;
  }

  raycast(from: V3, dir: V3, maxDistance = Infinity, opts: { ignore?: (b: Body) => boolean; mask?: number; triggers?: boolean } = {}): RayHit | null {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < 1e-12) return null;
    const dist = Number.isFinite(maxDistance) ? maxDistance : 1e4;
    const d: V3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    const start = new C.Vec3(...from);
    const end = new C.Vec3(from[0] + d[0] * dist, from[1] + d[1] * dist, from[2] + d[2] * dist);
    let best: RayHit | null = null;
    this.world.raycastAll(start, end, { skipBackfaces: true, collisionFilterMask: opts.mask ?? -1, checkCollisionResponse: false }, (r) => {
      const rec = this.byBody.get(r.body!);
      if (!rec) return;
      if (opts.triggers === false && rec.type === "trigger") return;
      if (opts.ignore?.(rec.view)) return;
      if (best && r.distance >= best.distance) return;
      best = { body: rec.view, distance: r.distance, point: v3(r.hitPointWorld), normal: v3(r.hitNormalWorld) };
    });
    return best;
  }
}
