// Glue between the scene graph (World entries, three) and PhysicsWorld:
// builds bodies from objects (`body`), generator collision boxes
// (userData.bodies) and joints (scene.physics.joints); syncs scripted moves
// object → body and simulated poses body → object; draws debug wireframes.
// Loaded lazily (own chunk with cannon-es) only when a scene has bodies.

import * as THREE from "three";
import type { BodyDef, ObjectDef, PhysicsWorldDef } from "../../core/types";
import type { RuntimeIssue } from "../api";
import type { World, WorldEntry } from "../build/index";
import { DEG } from "../util";
import { PhysicsWorld, type ShapeDesc } from "./physics";
import { PhysicsDebug } from "./physicsDebug";
import { bodyInit, bodyPose } from "./physicsShapes";

export { PhysicsWorld } from "./physics";

export class PhysicsBridge {
  readonly engine: PhysicsWorld;
  private offsets = new Map<string, THREE.Vector3>();
  // World scale each body's shapes were built with (cannon shapes cannot scale).
  private scales = new Map<string, THREE.Vector3>();
  private scaleWarned = new Set<string>();
  private debug: PhysicsDebug | null = null;
  private world: World;

  constructor(
    private def: PhysicsWorldDef | undefined,
    world: World,
    private issue: (i: RuntimeIssue) => void,
  ) {
    this.world = world;
    const g = def?.gravity ?? [0, -9.81, 0];
    this.engine = new PhysicsWorld({
      gravity: [g[0], g[1], g[2]],
      iterations: def?.iterations,
      substeps: def?.substeps,
      sleep: def?.sleep,
      materials: def?.materials,
      contacts: def?.contacts,
      layers: def?.layers,
    });
    if (def?.debug) this.debug = new PhysicsDebug(world.scene);
  }

  // Bodies for every entry (scene order), then joints.
  attachAll(): void {
    this.world.scene.updateMatrixWorld(true);
    for (const e of this.world.entries.values()) {
      this.addEntry(e);
      this.addGeneratorBodies(e);
    }
    (this.def?.joints ?? []).forEach((j, i) => {
      const id = this.engine.addJoint({
        id: j.id ?? `joint-${i + 1}`,
        type: j.type,
        a: j.a,
        b: j.b,
        pivot: j.pivot,
        axis: j.axis,
        distance: j.distance,
        restLength: j.restLength,
        stiffness: j.stiffness,
        damping: j.damping,
        motor: j.motor ? { speed: j.motor.speed * DEG, maxForce: j.motor.maxForce } : undefined,
        limits: j.limits ? [j.limits[0] * DEG, j.limits[1] * DEG] : undefined,
        maxForce: j.maxForce,
        collideConnected: j.collideConnected,
      });
      if (!id) this.issue({ code: "physics", message: `physics.joints[${i}]: "${j.a}"${j.b ? ` or "${j.b}"` : ""} has no body.`, path: `physics.joints[${i}]` });
    });
    this.debug?.sync(this.engine.bodies);
  }

  addEntry(e: WorldEntry, override?: BodyDef): boolean {
    const def = override ?? (e.def as ObjectDef).body;
    if (!def || e.kind === "light") return false;
    const { init, offset, note } = bodyInit(e.id, { object: e.object, def, objectDef: e.def as ObjectDef, built: e.built });
    if (note) this.issue({ code: "physics", message: `objects#${e.id}.body: ${note}.`, path: `objects#${e.id}.body` });
    this.offsets.set(e.id, offset);
    this.scales.set(e.id, e.object.getWorldScale(new THREE.Vector3()));
    this.engine.add(init);
    return true;
  }

  // Generators publishing local collision boxes (maze walls: userData.bodies
  // [{ min, max }]) become one static compound body with the object's id.
  addGeneratorBodies(e: WorldEntry): void {
    if (e.kind === "light" || (e.def as ObjectDef).body) return;
    const boxes = e.object.userData.bodies as { min: [number, number, number]; max: [number, number, number] }[] | undefined;
    if (!Array.isArray(boxes) || !boxes.length) return;
    e.object.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    e.object.matrixWorld.decompose(p, q, s);
    const shapes: ShapeDesc[] = boxes.map((b) => ({
      type: "box",
      half: [(Math.abs(b.max[0] - b.min[0]) * s.x) / 2, (Math.abs(b.max[1] - b.min[1]) * s.y) / 2, (Math.abs(b.max[2] - b.min[2]) * s.z) / 2],
      offset: [((b.min[0] + b.max[0]) / 2) * s.x, ((b.min[1] + b.max[1]) / 2) * s.y, ((b.min[2] + b.max[2]) / 2) * s.z],
    }));
    this.offsets.set(e.id, new THREE.Vector3());
    this.engine.add({ id: e.id, type: "static", shapes, position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w] });
  }

  has(id: string): boolean {
    return !!this.engine.get(id);
  }

  // Scripts moved the object: move its body. A changed scale rebuilds the
  // body's shapes at the new size (keeping its velocity) — except for bodies
  // held by joints, which would lose them (one warning).
  moved(id: string): void {
    const e = this.world.entries.get(id);
    const off = this.offsets.get(id);
    const body = this.engine.get(id);
    if (!e || !off || !body) return;
    const s0 = this.scales.get(id);
    if (s0 && (e.def as ObjectDef).body) {
      const s = e.object.getWorldScale(new THREE.Vector3());
      const changed = Math.abs(s.x - s0.x) > 1e-4 * Math.abs(s0.x) + 1e-6 || Math.abs(s.y - s0.y) > 1e-4 * Math.abs(s0.y) + 1e-6 || Math.abs(s.z - s0.z) > 1e-4 * Math.abs(s0.z) + 1e-6;
      if (changed) {
        if (this.engine.hasJoints(id)) {
          if (!this.scaleWarned.has(id)) {
            this.scaleWarned.add(id);
            this.issue({ code: "physics", message: `objects#${id}: its scale changed but its collider keeps the start size (the body is held by a joint).`, path: `objects#${id}.body` });
          }
        } else {
          const v = [...body.velocity] as [number, number, number];
          const w = [...body.angularVelocity] as [number, number, number];
          e.object.updateWorldMatrix(true, false);
          this.addEntry(e);
          this.engine.setVelocity(id, v);
          this.engine.setAngularVelocity(id, w);
          this.debug?.sync(this.engine.bodies);
          return;
        }
      }
    }
    const pose = bodyPose(e.object, off);
    this.engine.setPose(id, pose.position, pose.quaternion);
  }

  remove(id: string): void {
    this.engine.remove(id);
    this.offsets.delete(id);
    this.scales.delete(id);
  }

  step(dt: number): void {
    this.engine.step(dt);
    this.syncObjects();
    this.debug?.sync(this.engine.bodies);
  }

  // Simulated poses → objects (dynamic always, kinematic when moving).
  private syncObjects(): void {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const pq = new THREE.Quaternion();
    for (const b of this.engine.bodies) {
      if (b.type !== "dynamic" && b.type !== "kinematic") continue;
      if (b.sleeping) continue;
      if (b.type === "kinematic") {
        const v = b.velocity, w = b.angularVelocity;
        if (!v[0] && !v[1] && !v[2] && !w[0] && !w[1] && !w[2]) continue;
      }
      const e = this.world.entries.get(b.id);
      if (!e) continue;
      const o = e.object;
      q.set(...b.quaternion);
      p.set(...b.position).sub((this.offsets.get(b.id) ?? new THREE.Vector3()).clone().applyQuaternion(q));
      if (o.parent) {
        o.parent.updateWorldMatrix(true, false);
        o.parent.worldToLocal(p);
        o.parent.getWorldQuaternion(pq);
        q.premultiply(pq.invert());
      }
      o.position.copy(p);
      o.quaternion.copy(q);
      if (e.animated) {
        e.rest.position.copy(p);
        e.rest.quaternion.copy(q);
      }
    }
  }

  dispose(): void {
    this.debug?.dispose();
    this.debug = null;
  }
}
