// Studio editor overlay: transform gizmos (TransformControls on a proxy, so
// nested objects edit their local transform and animated objects their
// authored pose), a free editor camera (OrbitControls) or the scene camera,
// click picking (objects + light handles), selection box, light helpers, the
// scene camera frustum and drop raycasts. Imported lazily by the Studio only —
// websites never load it. Talks to the Player through Player.editor (api.ts).

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { EditorBridge } from "../api";
import type { World, WorldEntry } from "../build/index";
import { setCameraAspect } from "../build/camera";
import { createEditorGrid, type EditorGrid } from "./grid";
import { DEFAULT_SNAP, finishTransform, frameSphere, localFromWorld, type GizmoMode, type LocalTransform, type SnapSettings, type Vec3 } from "./math";

export * from "./math";

export type EditorSelection = { kind: "object"; id: string } | { kind: "light"; id: string; part: "position" | "target" };
export type EditorView = "editor" | "camera";
export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export interface SceneEditorOptions {
  bridge: EditorBridge;
  // Pointer surface laid exactly over the canvas (receives gizmo / orbit / click events).
  dom: HTMLElement;
  // Click in the viewport: the hit's id chain (deepest first), a light handle, or nothing.
  onPick(hit: { chain: string[] } | { light: string; part: "position" | "target" } | null): void;
  // Drag finished on an object (local transform in scene units) or a light handle (world position).
  onTransformEnd(sel: EditorSelection, result: { transform?: LocalTransform; point?: Vec3 }): void;
  // Editor camera pose changed (persist it across remounts).
  onCameraChange?(pose: CameraPose): void;
  initialPose?: CameraPose | null;
}

const ACCENT = 0x7c8cff;
// 4 frame edges + 4 apex edges + 4 near edges (orthographic) + 2 up-tick edges.
const FRUSTUM_SEGMENTS = 14;
const toVec3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

function ancestorsVisible(o: THREE.Object3D | null): boolean {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

function designAspect(world: World): number {
  const m = /^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/.exec(world.def.target?.aspect ?? "");
  const a = m ? Number(m[1]) / Number(m[2]) : 16 / 9;
  return Number.isFinite(a) && a > 0 ? a : 16 / 9;
}

// One light's handles: position (sphere), optional target (diamond), guide line and cone / helper.
interface LightRig {
  id: string;
  light: THREE.Light;
  handle: THREE.Mesh;
  targetHandle: THREE.Mesh | null;
  line: THREE.Line | null;
  helper: (THREE.Object3D & { update?(): void }) | null;
}

export class SceneEditor {
  readonly overlay = new THREE.Scene();
  private bridge: EditorBridge;
  private dom: HTMLElement;
  private opts: SceneEditorOptions;
  private tc: TransformControls;
  private orbit: OrbitControls;
  private proxy = new THREE.Object3D();
  private editorCam: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 5000);
  private sceneCamPose = new THREE.Matrix4();
  private frustumCam = new THREE.PerspectiveCamera();
  private frustumOrtho = new THREE.OrthographicCamera();
  // Scene camera outline: apex → frame at the target distance + an "up" tick.
  private frustum: THREE.LineSegments;
  private frustumFill: THREE.Mesh;
  private box = new THREE.Box3();
  private boxHelper: THREE.Box3Helper;
  private lights: LightRig[] = [];
  private handleGeo = new THREE.SphereGeometry(1, 16, 12);
  private targetGeo = new THREE.OctahedronGeometry(1, 0);
  private raycaster = new THREE.Raycaster();
  private world: World | null = null;
  private selection: EditorSelection | null = null;
  private mode: GizmoMode = "translate";
  private snapOn = false;
  private snap: SnapSettings = { ...DEFAULT_SNAP };
  private shift = false;
  private view: EditorView = "editor";
  private enabled = true;
  private helpersOn = true;
  private grid: EditorGrid = createEditorGrid();
  private dragStart: LocalTransform | null = null;
  private dragStartPoint: Vec3 | null = null;
  private dragged = false;
  private down: { x: number; y: number; button: number } | null = null;
  private raf = 0;
  private poseInit = false;
  private offWorld: () => void;
  private disposed = false;

  constructor(opts: SceneEditorOptions) {
    this.opts = opts;
    this.bridge = opts.bridge;
    this.dom = opts.dom;
    this.overlay.add(this.proxy);

    // Gizmo first: its pointerdown runs before the orbit's, so grabbing a handle never orbits.
    this.tc = new TransformControls(this.editorCam, this.dom);
    this.tc.setSize(1.25);
    this.tc.addEventListener("dragging-changed", (e) => {
      const dragging = !!(e as unknown as { value: boolean }).value;
      this.orbit.enabled = !dragging && this.view === "editor" && this.enabled;
      if (dragging) this.beginDrag();
      else this.endDrag();
    });
    this.tc.addEventListener("objectChange", () => this.onGizmoChange());
    this.tc.addEventListener("change", () => this.requestRender());
    this.overlay.add(this.tc.getHelper());

    this.orbit = new OrbitControls(this.editorCam, this.dom);
    this.orbit.enableDamping = false;
    this.orbit.screenSpacePanning = true;
    this.orbit.rotateSpeed = 0.55;
    this.orbit.panSpeed = 0.9;
    this.orbit.addEventListener("change", () => {
      this.requestRender();
      this.opts.onCameraChange?.(this.pose());
    });
    if (opts.initialPose) {
      this.applyPose(opts.initialPose);
      this.poseInit = true;
    }

    this.boxHelper = new THREE.Box3Helper(this.box, ACCENT);
    const bm = this.boxHelper.material as THREE.LineBasicMaterial;
    bm.depthTest = false;
    bm.transparent = true;
    bm.opacity = 0.9;
    bm.toneMapped = false;
    this.boxHelper.visible = false;
    this.overlay.add(this.boxHelper);

    this.frustum = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(FRUSTUM_SEGMENTS * 6), 3)), new THREE.LineBasicMaterial({ color: 0xf2b654, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }));
    this.frustum.frustumCulled = false;
    this.frustumFill = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(6 * 3), 3)), new THREE.MeshBasicMaterial({ color: 0xf2b654, depthTest: false, transparent: true, opacity: 0.07, side: THREE.DoubleSide, toneMapped: false }));
    this.frustumFill.frustumCulled = false;
    this.overlay.add(this.frustum, this.frustumFill);

    this.dom.addEventListener("pointerdown", this.onDown);
    this.dom.addEventListener("pointerup", this.onUp);
    this.dom.addEventListener("contextmenu", this.onContext);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("blur", this.onBlur);

    this.offWorld = this.bridge.onWorld(() => this.attachWorld());
    this.bridge.setOverlay({ viewCamera: () => this.viewCamera(), draw: (r, cam) => this.draw(r, cam) });
    this.attachWorld();
  }

  // ─── Settings ─────────────────────────────────────────────────────────

  setSelection(sel: EditorSelection | null): void {
    const same = JSON.stringify(sel) === JSON.stringify(this.selection);
    this.selection = sel;
    if (!same && this.tc.dragging) this.tc.detach();
    this.updateAttachment();
    this.requestRender();
  }
  setMode(mode: GizmoMode): void {
    this.mode = mode;
    this.updateAttachment();
    this.requestRender();
  }
  setSpace(space: "local" | "world"): void {
    this.tc.setSpace(space);
    this.requestRender();
  }
  setSnap(on: boolean, settings?: Partial<SnapSettings>): void {
    this.snapOn = on;
    if (settings) this.snap = { ...this.snap, ...settings };
    this.applySnap();
  }
  setView(view: EditorView): void {
    this.view = view;
    this.tc.camera = this.activeCamera();
    this.orbit.enabled = view === "editor" && this.enabled && !this.tc.dragging;
    this.requestRender();
  }
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.tc.enabled = on;
    this.orbit.enabled = on && this.view === "editor";
    this.updateAttachment();
    this.requestRender();
  }
  setHelpers(on: boolean): void {
    this.helpersOn = on;
    this.applyHelpers();
    this.requestRender();
  }

  pose(): CameraPose {
    return { position: toVec3(this.editorCam.position), target: toVec3(this.orbit.target) };
  }

  // Scene camera pose as rendered (rig applied), for "view from scene camera".
  sceneCameraPose(): CameraPose | null {
    const w = this.world;
    if (!w) return null;
    return { position: toVec3(w.rig.rest.position), target: toVec3(w.rig.rest.target) };
  }

  // Put the editor camera where the scene camera is.
  resetToSceneCamera(): void {
    const p = this.sceneCameraPose();
    if (!p) return;
    this.applyPose(p);
    this.opts.onCameraChange?.(this.pose());
    this.requestRender();
  }

  frameSelection(): boolean {
    const w = this.world;
    if (!w) return false;
    let center: Vec3, radius: number;
    const sel = this.selection;
    if (sel?.kind === "object") {
      const e = w.entries.get(sel.id);
      if (!e) return false;
      this.box.setFromObject(e.object);
      if (this.box.isEmpty()) {
        center = toVec3(e.object.getWorldPosition(new THREE.Vector3()));
        radius = 1;
      } else {
        const s = this.box.getBoundingSphere(new THREE.Sphere());
        center = toVec3(s.center);
        radius = s.radius;
      }
    } else if (sel?.kind === "light") {
      const r = this.lights.find((l) => l.id === sel.id);
      if (!r) return false;
      const o = sel.part === "target" && r.targetHandle ? r.targetHandle : r.handle;
      center = toVec3(o.position);
      radius = 1.5;
    } else {
      // Nothing selected: frame every top-level object.
      const all = new THREE.Box3();
      for (const e of w.entries.values()) if (e.topLevel && e.kind !== "particles") all.union(new THREE.Box3().setFromObject(e.object));
      if (all.isEmpty()) return false;
      const s = all.getBoundingSphere(new THREE.Sphere());
      center = toVec3(s.center);
      radius = s.radius;
    }
    const cam = this.editorCam;
    const fov = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? (cam as THREE.PerspectiveCamera).fov : 45;
    const aspect = (cam as THREE.PerspectiveCamera).aspect ?? 1;
    const f = frameSphere(center, radius, toVec3(cam.position), fov, aspect);
    this.applyPose(f);
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const o = cam as THREE.OrthographicCamera;
      o.zoom = Math.max(0.05, (o.top - o.bottom) / (radius * 2.4));
      o.updateProjectionMatrix();
    }
    this.opts.onCameraChange?.(this.pose());
    this.requestRender();
    return true;
  }

  // World-space bounding box of an object as currently built (null when empty / unknown).
  objectBox(id: string): { min: Vec3; max: Vec3 } | null {
    const e = this.world?.entries.get(id);
    if (!e) return null;
    const b = new THREE.Box3().setFromObject(e.object);
    return b.isEmpty() ? null : { min: toVec3(b.min), max: toVec3(b.max) };
  }

  // World point under a normalised (-1..1) viewport point: the first visible
  // surface, else the ground plane y = 0, else 6 m along the ray.
  dropPoint(x: number, y: number): Vec3 {
    const w = this.world;
    const cam = this.activeCamera();
    cam.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), cam);
    if (w) {
      const roots = [...w.entries.values()].filter((e) => e.topLevel && e.kind !== "light" && e.kind !== "particles").map((e) => e.object);
      const hit = this.raycaster.intersectObjects(roots, true).find((h) => ancestorsVisible(h.object) && !(h.object as THREE.Points).isPoints);
      if (hit) return toVec3(hit.point);
    }
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    const ray = this.raycaster.ray;
    if (ray.intersectPlane(ground, p) && p.distanceTo(ray.origin) < 200) return toVec3(p);
    return toVec3(ray.at(6, p));
  }

  // Ids under a normalised point: a light handle, or the object chain (deepest first).
  pick(x: number, y: number): { chain: string[] } | { light: string; part: "position" | "target" } | null {
    const w = this.world;
    if (!w) return null;
    const cam = this.activeCamera();
    cam.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), cam);
    if (this.helpersOn) {
      const handles = this.lights.flatMap((l) => (l.targetHandle ? [l.handle, l.targetHandle] : [l.handle])).filter((h) => h.visible);
      const h = this.raycaster.intersectObjects(handles, false)[0];
      if (h) return { light: h.object.userData.lightId as string, part: h.object.userData.part as "position" | "target" };
    }
    const roots = [...w.entries.values()].filter((e) => e.topLevel && e.kind !== "light").map((e) => e.object);
    const hit = this.raycaster.intersectObjects(roots, true).find((h) => ancestorsVisible(h.object) && !(h.object as THREE.Points).isPoints);
    if (!hit) return null;
    const chain = w.idsFor(hit.object);
    return chain.length ? { chain } : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.offWorld();
    this.bridge.setOverlay(null);
    this.dom.removeEventListener("pointerdown", this.onDown);
    this.dom.removeEventListener("pointerup", this.onUp);
    this.dom.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("blur", this.onBlur);
    this.tc.detach();
    this.tc.dispose();
    this.orbit.dispose();
    this.clearLights();
    this.handleGeo.dispose();
    this.targetGeo.dispose();
    this.frustum.geometry.dispose();
    (this.frustum.material as THREE.Material).dispose();
    this.frustumFill.geometry.dispose();
    (this.frustumFill.material as THREE.Material).dispose();
    this.boxHelper.dispose();
    this.grid.mesh.removeFromParent();
    this.grid.dispose();
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private activeCamera(): THREE.Camera {
    return this.view === "camera" && this.world ? this.world.camera : this.editorCam;
  }

  private applyPose(p: CameraPose): void {
    this.editorCam.position.set(...p.position);
    this.orbit.target.set(...p.target);
    this.editorCam.lookAt(this.orbit.target);
    this.editorCam.updateMatrixWorld();
    this.orbit.update();
  }

  requestRender(): void {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.bridge.running()) this.bridge.render();
    });
  }

  private attachWorld(): void {
    const w = this.bridge.world();
    this.world = w;
    if (!w) return;
    // The editor grid (depth-tested, fades with distance and at grazing angles).
    if (this.grid.mesh.parent !== w.scene) w.scene.add(this.grid.mesh);
    this.applyHelpers();
    // The editor camera matches the scene camera's kind (perspective / orthographic).
    const wantOrtho = (w.camera as THREE.OrthographicCamera).isOrthographicCamera;
    const isOrtho = (this.editorCam as THREE.OrthographicCamera).isOrthographicCamera;
    if (wantOrtho !== !!isOrtho) {
      const pose = this.pose();
      this.editorCam = wantOrtho ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 5000) : new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 5000);
      this.orbit.object = this.editorCam;
      if (this.poseInit) this.applyPose(pose);
    }
    if (!this.poseInit) {
      const p = this.sceneCameraPose();
      if (p) {
        this.applyPose(p);
        this.poseInit = true;
      }
    }
    this.tc.camera = this.activeCamera();
    this.buildLights(w);
    if (this.tc.dragging) this.tc.detach();
    this.updateAttachment();
  }

  // Editor-only helpers in the World scene (the floor grid). Applied before a
  // render (draw() runs after the scene pass, too late for this frame), and
  // never touches scene content tagged `helper` (a ground's own grid, contact shadows).
  private applyHelpers(): void {
    const w = this.world;
    if (!w) return;
    for (const o of w.scene.children) if (o.userData.editorHelper) o.visible = this.helpersOn;
    const cam = this.editorCam;
    this.grid.setFocusDistance(this.view === "editor" ? cam.position.distanceTo(this.orbit.target) : w.camera.position.distanceTo(w.rig.rest.target));
  }

  private clearLights(): void {
    for (const r of this.lights) {
      for (const o of [r.handle, r.targetHandle, r.line, r.helper]) {
        if (!o) continue;
        o.removeFromParent();
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (o !== r.handle && o !== r.targetHandle) (o as THREE.Line).geometry?.dispose();
        m?.dispose?.();
        (o as unknown as { dispose?(): void }).dispose?.();
      }
    }
    this.lights = [];
  }

  private buildLights(w: World): void {
    this.clearLights();
    for (const e of w.entries.values()) {
      if (e.kind !== "light") continue;
      const light = e.object as THREE.Light;
      const type = (e.def as { type?: string }).type;
      if (type === "ambient" || type === "hemisphere") continue;
      const color = light.color.clone();
      const mk = (geo: THREE.BufferGeometry, part: "position" | "target") => {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: part === "position" ? color : 0xffffff, depthTest: false, transparent: true, opacity: part === "position" ? 1 : 0.85, toneMapped: false }));
        m.userData = { lightId: e.id, part };
        m.renderOrder = 10;
        this.overlay.add(m);
        return m;
      };
      const handle = mk(this.handleGeo, "position");
      const hasTarget = type === "directional" || type === "spot" || type === "rect";
      const targetHandle = hasTarget ? mk(this.targetGeo, "target") : null;
      let line: THREE.Line | null = null;
      if (hasTarget) {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]);
        line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.1, depthTest: false, transparent: true, opacity: 0.55, toneMapped: false }));
        this.overlay.add(line);
      }
      let helper: LightRig["helper"] = null;
      if (type === "spot") {
        helper = new THREE.SpotLightHelper(light as THREE.SpotLight, color);
      } else if (type === "point" && (light as THREE.PointLight).distance > 0) {
        helper = new THREE.PointLightHelper(light as THREE.PointLight, Math.min((light as THREE.PointLight).distance * 0.08, 0.6), color);
      }
      if (helper) {
        helper.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m) Object.assign(m, { depthTest: false, transparent: true, opacity: 0.45, toneMapped: false });
        });
        this.overlay.add(helper);
      }
      this.lights.push({ id: e.id, light, handle, targetHandle, line, helper });
    }
  }

  private selectedEntry(): WorldEntry | null {
    const sel = this.selection;
    if (!sel || !this.world) return null;
    return this.world.entries.get(sel.id) ?? null;
  }

  private updateAttachment(): void {
    const sel = this.selection;
    const e = this.selectedEntry();
    if (!this.enabled || !sel || !e || (sel.kind === "light") !== (e.kind === "light")) {
      if (this.tc.object && !this.tc.dragging) this.tc.detach();
      return;
    }
    // Lights only move.
    this.tc.setMode(sel.kind === "light" ? "translate" : this.mode);
    this.applySnap();
    if (!this.tc.dragging) this.syncProxy();
    if (this.tc.object !== this.proxy) this.tc.attach(this.proxy);
  }

  private snapping(): boolean {
    return this.snapOn !== this.shift;
  }

  private applySnap(): void {
    // Rotation snapping is a delta around the gizmo axis (TransformControls); translation
    // and scale snap in the parent's units when the drag is written back (finishTransform).
    this.tc.setRotationSnap(this.snapping() ? THREE.MathUtils.degToRad(this.snap.rotate) : null);
    this.tc.setTranslationSnap(null);
    this.tc.setScaleSnap(null);
  }

  // Proxy world transform = the authored (rest) pose in its parent's current world space.
  private syncProxy(): void {
    const sel = this.selection;
    const e = this.selectedEntry();
    if (!sel || !e) return;
    if (sel.kind === "light") {
      const l = e.object as THREE.DirectionalLight;
      const src = sel.part === "target" && l.target ? l.target.position : e.rest.position;
      this.proxy.position.copy(src);
      this.proxy.quaternion.identity();
      this.proxy.scale.set(1, 1, 1);
    } else {
      const parent = e.object.parent;
      parent?.updateWorldMatrix(true, false);
      const local = new THREE.Matrix4().compose(e.rest.position, e.rest.quaternion, e.rest.scale);
      const world = parent ? new THREE.Matrix4().multiplyMatrices(parent.matrixWorld, local) : local;
      world.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
    }
    this.proxy.updateMatrixWorld(true);
  }

  private restLocal(e: WorldEntry): LocalTransform {
    const def = e.def as { rotation?: number[] };
    const rot: Vec3 = [def.rotation?.[0] ?? 0, def.rotation?.[1] ?? 0, def.rotation?.[2] ?? 0];
    return { position: toVec3(e.rest.position), rotation: rot, scale: toVec3(e.rest.scale) };
  }

  private beginDrag(): void {
    const e = this.selectedEntry();
    const sel = this.selection;
    this.dragged = true;
    if (!e || !sel) return;
    if (sel.kind === "light") {
      const l = e.object as THREE.DirectionalLight;
      this.dragStartPoint = toVec3(sel.part === "target" && l.target ? l.target.position : e.rest.position);
      this.dragStart = null;
    } else {
      this.dragStart = this.restLocal(e);
      this.dragStartPoint = null;
    }
  }

  // Live preview: write the dragged pose into the live object (and its rest
  // pose, so a playing timeline / behaviours keep using it) — no rebuild.
  private current(): { transform?: LocalTransform; point?: Vec3 } | null {
    const e = this.selectedEntry();
    const sel = this.selection;
    if (!e || !sel) return null;
    this.proxy.updateMatrixWorld(true);
    if (sel.kind === "light") {
      if (!this.dragStartPoint) return null;
      const p = toVec3(this.proxy.position);
      const step = this.snap.translate;
      const snapped = (this.snapping() ? p.map((v, i) => (Math.abs(v - this.dragStartPoint![i]) > 1e-6 ? Math.round(v / step) * step : this.dragStartPoint![i])) : p).map((v) => Math.round(v * 1000) / 1000 || 0) as Vec3;
      return { point: snapped };
    }
    if (!this.dragStart) return null;
    const parent = e.object.parent;
    parent?.updateWorldMatrix(true, false);
    const local = localFromWorld(this.proxy.matrixWorld, parent ? parent.matrixWorld : null, this.dragStart);
    return { transform: finishTransform(this.dragStart, local, this.tc.mode as GizmoMode, this.snapping() ? this.snap : null) };
  }

  private onGizmoChange(): void {
    const e = this.selectedEntry();
    const sel = this.selection;
    const r = this.current();
    if (!e || !sel || !r) return;
    if (sel.kind === "light" && r.point) {
      const l = e.object as THREE.DirectionalLight;
      if (sel.part === "target" && l.target) {
        l.target.position.set(...r.point);
        l.target.updateMatrixWorld();
      } else {
        e.rest.position.set(...r.point);
        l.position.set(...r.point);
      }
    } else if (r.transform) {
      const t = r.transform;
      e.rest.position.set(...t.position);
      e.rest.quaternion.setFromEuler(new THREE.Euler(...t.rotation.map((d) => THREE.MathUtils.degToRad(d)) as Vec3, "XYZ"));
      e.rest.scale.set(...t.scale);
      e.object.position.copy(e.rest.position);
      e.object.quaternion.copy(e.rest.quaternion);
      e.object.scale.copy(e.rest.scale);
      // Show the snapped pose on the gizmo too.
      if (this.snapping() && this.tc.mode !== "rotate") this.syncProxy();
    }
    this.requestRender();
  }

  private endDrag(): void {
    const sel = this.selection;
    const r = this.current();
    const start = this.dragStart, startPoint = this.dragStartPoint;
    this.dragStart = null;
    this.dragStartPoint = null;
    if (!sel || !r) return;
    const same = r.point ? startPoint && r.point.every((v, i) => v === startPoint[i]) : start && r.transform && JSON.stringify(start) === JSON.stringify(r.transform);
    if (!same) this.opts.onTransformEnd(sel, r);
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, button: e.button };
    this.dragged = this.tc.dragging;
    if (this.shift !== e.shiftKey) {
      this.shift = e.shiftKey;
      this.applySnap();
    }
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || !this.enabled || d.button !== 0 || this.dragged || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const r = this.dom.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    this.opts.onPick(this.pick(x, y));
  };

  private onContext = (e: Event) => e.preventDefault();

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Shift") return;
    const was = this.snapping();
    this.shift = e.type === "keydown";
    if (was !== this.snapping()) this.applySnap();
  };

  private onBlur = () => {
    this.shift = false;
    this.applySnap();
  };

  // Called by the player at the start of each render: capture the scene
  // camera (before it is swapped for the editor camera) and fit the editor
  // camera's projection to the canvas.
  private viewCamera(): THREE.Camera | null {
    const w = this.bridge.world();
    if (w !== this.world) this.attachWorld();
    if (!this.world) return null;
    const sc = this.world.camera;
    sc.updateMatrixWorld();
    this.sceneCamPose.copy(sc.matrixWorld);
    if (this.view === "camera" || !this.enabled) return null;
    const cam = this.editorCam;
    if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera && (sc as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const p = cam as THREE.PerspectiveCamera, s = sc as THREE.PerspectiveCamera;
      if (p.fov !== s.fov || p.aspect !== s.aspect) {
        p.fov = s.fov;
        p.aspect = s.aspect;
        p.updateProjectionMatrix();
      }
    } else if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const o = cam as THREE.OrthographicCamera, s = sc as THREE.OrthographicCamera;
      if (o.left !== s.left || o.top !== s.top || o.right !== s.right) {
        Object.assign(o, { left: s.left, right: s.right, top: s.top, bottom: s.bottom });
        o.updateProjectionMatrix();
      }
    }
    return cam;
  }

  private updateFrustum(w: World): void {
    const sc = w.camera;
    const aspect = designAspect(w);
    const ortho = (sc as THREE.OrthographicCamera).isOrthographicCamera;
    const fc: THREE.PerspectiveCamera | THREE.OrthographicCamera = ortho ? this.frustumOrtho : this.frustumCam;
    this.sceneCamPose.decompose(fc.position, fc.quaternion, new THREE.Vector3());
    const dist = Math.max(0.5, fc.position.distanceTo(w.rig.rest.target));
    if (ortho) {
      const s = sc as THREE.OrthographicCamera;
      const h = (s.top - s.bottom) / 2 / (s.zoom || 1);
      Object.assign(fc, { left: -h * aspect, right: h * aspect, top: h, bottom: -h, near: 0, far: dist });
    } else {
      const p = fc as THREE.PerspectiveCamera;
      p.fov = w.def.camera?.fov ?? 45;
      p.near = Math.min(0.1, dist * 0.05);
      p.far = dist;
      setCameraAspect(p, w.def.camera, aspect, aspect);
    }
    fc.updateProjectionMatrix();
    fc.updateMatrixWorld(true);
    const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).unproject(fc);
    const far = [at(-1, -1, 1), at(1, -1, 1), at(1, 1, 1), at(-1, 1, 1)];
    const near = ortho ? [at(-1, -1, -1), at(1, -1, -1), at(1, 1, -1), at(-1, 1, -1)] : [fc.position, fc.position, fc.position, fc.position];
    // Up tick: a small triangle above the frame's top edge.
    const top = far[3].clone().lerp(far[2], 0.5);
    const up = far[3].clone().sub(far[0]).multiplyScalar(0.12);
    const half = far[2].clone().sub(far[3]).multiplyScalar(0.06);
    const tip = top.clone().add(up);
    const segs: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) segs.push(far[i], far[(i + 1) % 4], near[i], far[i]);
    if (ortho) for (let i = 0; i < 4; i++) segs.push(near[i], near[(i + 1) % 4]);
    else segs.push(fc.position, fc.position, fc.position, fc.position, fc.position, fc.position, fc.position, fc.position);
    segs.push(top.clone().sub(half), tip, tip, top.clone().add(half));
    const pos = this.frustum.geometry.getAttribute("position") as THREE.BufferAttribute;
    segs.slice(0, FRUSTUM_SEGMENTS * 2).forEach((v, i) => pos.setXYZ(i, v.x, v.y, v.z));
    pos.needsUpdate = true;
    const fill = this.frustumFill.geometry.getAttribute("position") as THREE.BufferAttribute;
    [far[0], far[1], far[2], far[0], far[2], far[3]].forEach((v, i) => fill.setXYZ(i, v.x, v.y, v.z));
    fill.needsUpdate = true;
  }

  private draw(r: THREE.WebGLRenderer, cam: THREE.Camera): void {
    const w = this.world;
    if (!w) return;
    this.applyHelpers();
    const editorView = this.view === "editor" && this.enabled;
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const ortho = (cam as THREE.OrthographicCamera).isOrthographicCamera;
    const screenScale = (p: THREE.Vector3, px: number) => {
      if (ortho) {
        const o = cam as THREE.OrthographicCamera;
        return ((o.top - o.bottom) / o.zoom) * (px / Math.max(r.domElement.clientHeight, 1));
      }
      const fov = (cam as THREE.PerspectiveCamera).fov ?? 45;
      return p.distanceTo(camPos) * Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 2 * (px / Math.max(r.domElement.clientHeight, 1));
    };

    // Selection box.
    const e = this.selectedEntry();
    if (e && e.kind !== "light" && this.enabled) {
      this.box.setFromObject(e.object);
      this.boxHelper.visible = !this.box.isEmpty();
    } else this.boxHelper.visible = false;

    // Lights.
    for (const l of this.lights) {
      const lp = l.light.position;
      const on = this.helpersOn && this.enabled;
      const selected = this.selection?.kind === "light" && this.selection.id === l.id;
      l.handle.visible = on;
      l.handle.position.copy(lp);
      l.handle.scale.setScalar(screenScale(lp, selected ? 7 : 5.5));
      const tgt = (l.light as THREE.DirectionalLight).target;
      if (l.targetHandle && tgt) {
        l.targetHandle.visible = on;
        l.targetHandle.position.copy(tgt.position);
        l.targetHandle.scale.setScalar(screenScale(tgt.position, selected ? 7 : 5.5));
        (l.targetHandle.material as THREE.MeshBasicMaterial).opacity = selected ? 0.95 : 0.55;
      }
      if (l.line && tgt) {
        l.line.visible = on;
        const pos = l.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        pos.setXYZ(0, lp.x, lp.y, lp.z);
        pos.setXYZ(1, tgt.position.x, tgt.position.y, tgt.position.z);
        pos.needsUpdate = true;
        l.line.geometry.computeBoundingSphere();
        l.line.computeLineDistances();
      }
      if (l.helper) {
        l.helper.visible = on && (selected || l.light.type === "SpotLight");
        l.light.updateMatrixWorld();
        l.helper.update?.();
      }
    }

    // Scene camera frustum (what the website shows), in the editor view only.
    // Hidden while the editor camera sits on the scene camera (its edges would frame the canvas).
    const sceneCamPos = new THREE.Vector3().setFromMatrixPosition(this.sceneCamPose);
    const sceneCamQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.sceneCamPose));
    const onSceneCam = this.editorCam.position.distanceTo(sceneCamPos) < 0.05 * Math.max(1, sceneCamPos.distanceTo(w.rig.rest.target)) && this.editorCam.quaternion.angleTo(sceneCamQ) < 0.05;
    this.frustum.visible = this.frustumFill.visible = editorView && this.helpersOn && !onSceneCam;
    if (this.frustum.visible) this.updateFrustum(w);

    if (this.tc.object && !this.tc.dragging) this.syncProxy();
    this.tc.getHelper().visible = !!this.tc.object && this.enabled;
    // TransformControls orient themselves from the camera they use.
    this.tc.camera = this.view === "camera" ? w.camera : this.editorCam;

    const auto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(null);
    r.clearDepth();
    r.render(this.overlay, cam);
    r.autoClear = auto;
  }
}
