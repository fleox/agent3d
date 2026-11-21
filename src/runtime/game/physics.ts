// Light physics for mini games (pure TS, no DOM, no three): axis-aligned boxes
// and spheres, gravity, velocity integration, restitution, friction,
// static / dynamic / kinematic / trigger bodies, contacts, collision events,
// raycasts and impulses. Deterministic for a fixed step.

export type V3 = [number, number, number];
export type BodyType = "static" | "dynamic" | "kinematic" | "trigger";

export interface BodyInit {
  id: string;
  type: BodyType;
  shape: "box" | "sphere";
  position: V3;
  size?: V3; // box full size
  radius?: number; // sphere
  velocity?: V3;
  mass?: number;
  restitution?: number;
  friction?: number;
  // Triggers and kinematic bodies ignore gravity; dynamic bodies can opt out.
  gravityScale?: number;
}

export interface Body {
  id: string;
  type: BodyType;
  shape: "box" | "sphere";
  position: V3;
  half: V3;
  radius: number;
  velocity: V3;
  mass: number;
  invMass: number;
  restitution: number;
  friction: number;
  gravityScale: number;
  grounded: boolean; // touched something below during the last step
}

export interface Contact {
  a: Body;
  b: Body;
  normal: V3; // from a to b
  depth: number;
}

export interface RayHit {
  body: Body;
  distance: number;
  point: V3;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function aabbOf(b: Body): { min: V3; max: V3 } {
  const h: V3 = b.shape === "sphere" ? [b.radius, b.radius, b.radius] : b.half;
  return {
    min: [b.position[0] - h[0], b.position[1] - h[1], b.position[2] - h[2]],
    max: [b.position[0] + h[0], b.position[1] + h[1], b.position[2] + h[2]],
  };
}

// Narrow phase: returns the contact (normal from a to b) or null.
export function collide(a: Body, b: Body): Contact | null {
  if (a.shape === "box" && b.shape === "box") {
    const d: V3 = [b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]];
    let best = Infinity, axis = -1;
    for (let i = 0; i < 3; i++) {
      const o = a.half[i] + b.half[i] - Math.abs(d[i]);
      if (o <= 0) return null;
      if (o < best) {
        best = o;
        axis = i;
      }
    }
    const n: V3 = [0, 0, 0];
    n[axis] = d[axis] >= 0 ? 1 : -1;
    return { a, b, normal: n, depth: best };
  }
  if (a.shape === "sphere" && b.shape === "sphere") {
    const d: V3 = [b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    const r = a.radius + b.radius;
    if (dist >= r) return null;
    const n: V3 = dist > 1e-9 ? [d[0] / dist, d[1] / dist, d[2] / dist] : [0, 1, 0];
    return { a, b, normal: n, depth: r - dist };
  }
  // box vs sphere
  const box = a.shape === "box" ? a : b;
  const sph = a.shape === "box" ? b : a;
  const c = sph.position;
  const closest: V3 = [0, 0, 0];
  let inside = true;
  for (let i = 0; i < 3; i++) {
    const lo = box.position[i] - box.half[i], hi = box.position[i] + box.half[i];
    closest[i] = Math.min(Math.max(c[i], lo), hi);
    if (c[i] < lo || c[i] > hi) inside = false;
  }
  let n: V3;
  let depth: number;
  if (inside) {
    // Centre inside the box: push out along the shallowest face.
    let best = Infinity, axis = 0, sign = 1;
    for (let i = 0; i < 3; i++) {
      const dPos = box.position[i] + box.half[i] - c[i];
      const dNeg = c[i] - (box.position[i] - box.half[i]);
      if (dPos < best) { best = dPos; axis = i; sign = 1; }
      if (dNeg < best) { best = dNeg; axis = i; sign = -1; }
    }
    n = [0, 0, 0];
    n[axis] = sign;
    depth = best + sph.radius;
  } else {
    const d: V3 = [c[0] - closest[0], c[1] - closest[1], c[2] - closest[2]];
    const dist = Math.hypot(d[0], d[1], d[2]);
    if (dist >= sph.radius) return null;
    n = dist > 1e-9 ? [d[0] / dist, d[1] / dist, d[2] / dist] : [0, 1, 0];
    depth = sph.radius - dist;
  }
  // n points from box to sphere; flip when a is the sphere.
  if (a === sph) n = [-n[0], -n[1], -n[2]];
  return { a, b, normal: n, depth };
}

export function rayBody(body: Body, from: V3, dir: V3, maxDistance: number): number | null {
  if (body.shape === "sphere") {
    const oc: V3 = [from[0] - body.position[0], from[1] - body.position[1], from[2] - body.position[2]];
    const b = dot(oc, dir);
    const c = dot(oc, oc) - body.radius * body.radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    let t = -b - s;
    if (t < 0) t = -b + s;
    return t >= 0 && t <= maxDistance ? t : null;
  }
  const { min, max } = aabbOf(body);
  let t0 = 0, t1 = maxDistance;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-12) {
      if (from[i] < min[i] || from[i] > max[i]) return null;
      continue;
    }
    let ta = (min[i] - from[i]) / dir[i];
    let tb = (max[i] - from[i]) / dir[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

export class PhysicsWorld {
  gravity: V3;
  bodies: Body[] = [];
  private byId = new Map<string, Body>();
  private contactsNow: Contact[] = [];
  private pairsPrev = new Set<string>();
  private handlers: ((a: Body, b: Body, c: Contact) => void)[] = [];

  constructor(gravity: V3 = [0, -9.81, 0]) {
    this.gravity = gravity;
  }

  add(init: BodyInit): Body {
    const mass = init.type === "dynamic" ? Math.max(init.mass ?? 1, 1e-6) : 0;
    const size = init.size ?? [1, 1, 1];
    const body: Body = {
      id: init.id,
      type: init.type,
      shape: init.shape,
      position: [...init.position],
      half: [size[0] / 2, size[1] / 2, size[2] / 2],
      radius: init.radius ?? Math.max(...size) / 2,
      velocity: init.velocity ? [...init.velocity] : [0, 0, 0],
      mass,
      invMass: mass > 0 ? 1 / mass : 0,
      restitution: init.restitution ?? 0.2,
      friction: init.friction ?? 0.5,
      gravityScale: init.gravityScale ?? (init.type === "dynamic" ? 1 : 0),
      grounded: false,
    };
    this.remove(init.id);
    this.bodies.push(body);
    this.byId.set(body.id, body);
    return body;
  }

  get(id: string): Body | undefined {
    return this.byId.get(id);
  }

  remove(id: string): void {
    const b = this.byId.get(id);
    if (!b) return;
    this.byId.delete(id);
    this.bodies.splice(this.bodies.indexOf(b), 1);
  }

  onCollision(handler: (a: Body, b: Body, c: Contact) => void): void {
    this.handlers.push(handler);
  }

  applyImpulse(id: string, impulse: V3): void {
    const b = this.byId.get(id);
    if (!b || b.invMass === 0) return;
    for (let i = 0; i < 3; i++) b.velocity[i] += impulse[i] * b.invMass;
  }

  step(dt: number): Contact[] {
    const g = this.gravity;
    for (const b of this.bodies) {
      b.grounded = false;
      if (b.type === "static") continue;
      if (b.type === "dynamic") for (let i = 0; i < 3; i++) b.velocity[i] += g[i] * b.gravityScale * dt;
      for (let i = 0; i < 3; i++) b.position[i] += b.velocity[i] * dt;
    }
    const contacts: Contact[] = [];
    const n = this.bodies.length;
    const boxes = this.bodies.map(aabbOf);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const A = this.bodies[i], B = this.bodies[j];
        if (A.type !== "dynamic" && B.type !== "dynamic" && A.type !== "trigger" && B.type !== "trigger") continue;
        if (A.type === "trigger" && B.type === "trigger") continue;
        const ba = boxes[i], bb = boxes[j];
        if (ba.max[0] < bb.min[0] || ba.min[0] > bb.max[0] || ba.max[1] < bb.min[1] || ba.min[1] > bb.max[1] || ba.max[2] < bb.min[2] || ba.min[2] > bb.max[2]) continue;
        const c = collide(A, B);
        if (!c) continue;
        contacts.push(c);
        if (A.type !== "trigger" && B.type !== "trigger") this.resolve(c);
      }
    }
    this.contactsNow = contacts;
    const pairs = new Set<string>();
    for (const c of contacts) {
      const key = c.a.id < c.b.id ? c.a.id + "|" + c.b.id : c.b.id + "|" + c.a.id;
      pairs.add(key);
      if (!this.pairsPrev.has(key)) for (const h of this.handlers) h(c.a, c.b, c);
    }
    this.pairsPrev = pairs;
    return contacts;
  }

  private resolve(c: Contact): void {
    const { a, b, normal: nrm, depth } = c;
    const inv = a.invMass + b.invMass;
    if (inv === 0) return;
    // Positional correction (slop keeps resting contacts stable).
    const corr = Math.max(depth - 0.001, 0) / inv;
    for (let i = 0; i < 3; i++) {
      a.position[i] -= nrm[i] * corr * a.invMass;
      b.position[i] += nrm[i] * corr * b.invMass;
    }
    if (nrm[1] > 0.5) b.grounded = true;
    if (nrm[1] < -0.5) a.grounded = true;
    const vr: V3 = [b.velocity[0] - a.velocity[0], b.velocity[1] - a.velocity[1], b.velocity[2] - a.velocity[2]];
    const vn = dot(vr, nrm);
    if (vn >= 0) return;
    const e = Math.abs(vn) < 1 ? 0 : Math.max(a.restitution, b.restitution);
    const j = (-(1 + e) * vn) / inv;
    for (let i = 0; i < 3; i++) {
      a.velocity[i] -= j * nrm[i] * a.invMass;
      b.velocity[i] += j * nrm[i] * b.invMass;
    }
    // Coulomb friction on the tangential relative velocity.
    const vr2: V3 = [b.velocity[0] - a.velocity[0], b.velocity[1] - a.velocity[1], b.velocity[2] - a.velocity[2]];
    const vn2 = dot(vr2, nrm);
    const tv: V3 = [vr2[0] - nrm[0] * vn2, vr2[1] - nrm[1] * vn2, vr2[2] - nrm[2] * vn2];
    const tl = Math.hypot(tv[0], tv[1], tv[2]);
    if (tl < 1e-9) return;
    // Spheres roll: only a fraction of sliding friction applies.
    const mu = Math.sqrt(a.friction * b.friction) * (a.shape === "sphere" || b.shape === "sphere" ? 0.08 : 1);
    const jt = Math.min(tl / inv, mu * j);
    for (let i = 0; i < 3; i++) {
      const t = tv[i] / tl;
      a.velocity[i] += jt * t * a.invMass;
      b.velocity[i] -= jt * t * b.invMass;
    }
  }

  contacts(): Contact[] {
    return this.contactsNow;
  }

  contactsOf(id: string): Body[] {
    const out: Body[] = [];
    for (const c of this.contactsNow) {
      if (c.a.id === id) out.push(c.b);
      else if (c.b.id === id) out.push(c.a);
    }
    return out;
  }

  overlaps(idA: string, idB: string): boolean {
    const a = this.byId.get(idA), b = this.byId.get(idB);
    if (!a || !b) return false;
    return collide(a, b) !== null;
  }

  raycast(from: V3, dir: V3, maxDistance = Infinity, ignore?: (b: Body) => boolean): RayHit | null {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < 1e-12) return null;
    const d: V3 = [dir[0] / len, dir[1] / len, dir[2] / len];
    let best: RayHit | null = null;
    for (const b of this.bodies) {
      if (ignore?.(b)) continue;
      const t = rayBody(b, from, d, maxDistance);
      if (t !== null && (!best || t < best.distance)) best = { body: b, distance: t, point: [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t] };
    }
    return best;
  }
}
