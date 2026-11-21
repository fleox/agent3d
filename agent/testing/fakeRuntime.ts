import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A stand-in runtime (dist/runtime/agent3d-runtime.js) for render-pipeline
// tests: real WebGL (scissored clears whose colour depends on t), the
// Player methods render.ts uses. Lets the CDP / server / sheet / video
// plumbing be tested without the real Three.js player.
export const FAKE_RUNTIME = `
export function mountScene(container, scene, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%"; canvas.style.height = "100%";
  container.appendChild(canvas);
  const pr = options.pixelRatio || 1;
  canvas.width = Math.round(container.clientWidth * pr); canvas.height = Math.round(container.clientHeight * pr);
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  let time = 0;
  const draw = () => {
    if (!gl) return;
    gl.disable(gl.SCISSOR_TEST);
    const bg = scene.environment && typeof scene.environment.background === "string" ? scene.environment.background : "#203040";
    const n = parseInt(bg.slice(1), 16);
    gl.clearColor(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    const s = Math.round(canvas.height / 2);
    const x = Math.round((canvas.width - s) * ((time % 4) / 4));
    gl.scissor(x, Math.round(canvas.height / 4), s, s);
    gl.clearColor(1, 0.3 + 0.1 * (time % 4), 0.2, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  const ready = Promise.resolve().then(() => { if (!gl) { options.onError && options.onError({ code: "webgl-unavailable", message: "no webgl" }); throw new Error("WebGL unavailable"); } draw(); });
  return {
    scene, canvas, ready,
    play() {}, pause() {},
    async seek(t) { time = t; draw(); },
    time: () => time,
    async update(s) { scene = s; draw(); },
    resize() {},
    stats: () => ({ triangles: 2, drawCalls: 2, geometries: 1, textures: 0 }),
    inspect: () => ({ objects: [{ id: "box", min: [-1, -1, -1], max: [1, 1, 1], inView: "full", screenCoverage: 0.2 }], camera: { position: [0, 0, 5], target: [0, 0, 0] } }),
    snapshot: (type, q) => canvas.toDataURL(type || "image/png", q),
    input: { pointer() {}, key() {}, click() {} },
    state: () => ({}),
    dispose() { canvas.remove(); },
  };
}
`;

export function writeFakeDist(dir: string): string {
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "runtime"), { recursive: true });
  writeFileSync(join(dist, "runtime", "agent3d-runtime.js"), FAKE_RUNTIME);
  writeFileSync(join(dist, "runtime", "agent3d-runtime.single.js"), FAKE_RUNTIME);
  return dist;
}

export const MINIMAL_SCENE = {
  version: 1,
  id: "test",
  title: "Test",
  target: { kind: "banner", aspect: "4:1" },
  camera: { type: "perspective", position: [0, 0, 5] },
  environment: { background: "#203040" },
  lights: [{ type: "ambient" }],
  objects: [{ id: "box", kind: "mesh", geometry: { type: "box" } }],
  timeline: { duration: 4, loop: true, tracks: [] },
};
