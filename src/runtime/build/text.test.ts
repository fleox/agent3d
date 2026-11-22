import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { FontLoader, type Font } from "three/addons/loaders/FontLoader.js";
import * as utils from "three/addons/utils/BufferGeometryUtils.js";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../../core/catalog";
import type { TextObjectDef } from "../../core/types";
import type { RuntimeContext } from "./context";
import { buildText, kerningOf, layoutText, revealDelay, revealImpl, textGeometry, textMetrics, type TypefaceData } from "./text";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fontJson = (id: string) => JSON.parse(readFileSync(join(root, "library", "fonts", `${id}.typeface.json`), "utf8"));
const fonts = new Map<string, Font>();
const font = (id: string) => {
  if (!fonts.has(id)) fonts.set(id, new FontLoader().parse(fontJson(id)));
  return fonts.get(id)!;
};
const data = (id: string) => font(id).data as unknown as TypefaceData;

function fakeCtx(): RuntimeContext {
  // fetch is only used to read the font file: serve it from the repo.
  globalThis.fetch = (async (url: string) => {
    const id = String(url).replace(/^.*fonts\//, "").replace(/\.typeface\.json$/, "");
    return new Response(readFileSync(join(root, "library", "fonts", `${id}.typeface.json`)));
  }) as typeof fetch;
  return {
    resolveAsset: (p: string) => `http://local/${p.replace("library:", "")}.typeface.json`,
    renderer: null,
    deterministic: true,
    track: <T,>(p: Promise<T>) => p,
    onUpdate: () => {},
    issue: () => {},
    shaders: async () => ({}),
    generators: async () => ({}),
  } as unknown as RuntimeContext;
}

describe("bundled fonts", () => {
  it("every catalog font parses, has the Latin-1 charset and metrics", () => {
    for (const f of CATALOG.fonts) {
      const j = fontJson(f.id);
      for (const ch of "AZaz09éàçñüßŒ€…") expect(j.glyphs[ch], `${f.id} ${ch}`).toBeDefined();
      expect(j.capHeight, f.id).toBeGreaterThan(0);
    }
  });

  it("proportional fonts carry kerning pairs (mono does not need them)", () => {
    for (const f of CATALOG.fonts) {
      const pairs = Object.values(fontJson(f.id).kerning ?? {}).reduce((n: number, r) => n + Object.keys(r as object).length, 0);
      if (f.id === "mono") expect(pairs).toBe(0);
      else expect(pairs, f.id).toBeGreaterThan(10);
    }
    expect(kerningOf(data("sans-bold"), "A", "V")).toBeLessThan(0);
    expect(kerningOf(data("sans-bold"), "T", "o")).toBeLessThan(0);
  });
});

describe("layoutText", () => {
  const d = data("sans-bold");
  const width = (text: string, extra: Partial<Parameters<typeof layoutText>[1]> = {}) => layoutText(d, { text, em: 1, ...extra }).width;

  it("applies kerning by default; kerning: false disables it", () => {
    expect(width("AVATAR WAVE")).toBeLessThan(width("AVATAR WAVE", { kerning: false }) - 0.05);
    expect(width("HHHH")).toBeCloseTo(width("HHHH", { kerning: false }), 6);
  });

  it("kerns accented letters like their base letter", () => {
    expect(kerningOf(d, "T", "ô")).toBe(kerningOf(d, "T", "o"));
    expect(kerningOf(d, "À", "V")).toBe(kerningOf(d, "A", "V"));
  });

  it("letterSpacing adds a fixed gap between characters", () => {
    expect(width("ABCD", { letterSpacing: 0.1 })).toBeCloseTo(width("ABCD") + 0.3, 6);
  });

  it("aligns lines and drops spaces from the glyph list", () => {
    const c = layoutText(d, { text: "AB CD", em: 1, align: "center" });
    expect(c.glyphs.map((g) => g.ch).join("")).toBe("ABCD");
    expect(c.glyphs[0].x).toBeCloseTo(-c.width / 2, 6);
    const l = layoutText(d, { text: "AB", em: 1, align: "left" });
    expect(l.glyphs[0].x).toBe(0);
    const r = layoutText(d, { text: "AB", em: 1, align: "right" });
    expect(r.glyphs[0].x).toBeCloseTo(-r.width, 6);
  });

  it("wraps words to maxWidth and honours explicit line breaks", () => {
    const one = width("hello");
    const t = layoutText(d, { text: "hello world hello world", em: 1, maxWidth: one * 2.4 });
    expect(t.lines.length).toBe(2);
    expect(t.width).toBeLessThanOrEqual(one * 2.4 + 1e-9);
    const n = layoutText(d, { text: "a\nb\nc", em: 1, lineHeight: 1.5 });
    expect(n.lines.map((l) => l.y + 0)).toEqual([0, -1.5, -3]);
    // A single word longer than maxWidth stays on its own line.
    expect(layoutText(d, { text: "extraordinary", em: 1, maxWidth: 0.5 }).lines.length).toBe(1);
  });
});

describe("text geometry", () => {
  it("size is the cap height and the block is centred", () => {
    const geo = textGeometry(font("sans-bold"), { text: "HELLO", size: 1, depth: 0.2 }, utils);
    const bb = geo.boundingBox!;
    expect(bb.max.y - bb.min.y).toBeGreaterThan(0.98);
    expect(bb.max.y - bb.min.y).toBeLessThan(1.1);
    expect(Math.abs(bb.max.x + bb.min.x)).toBeLessThan(0.05);
    expect(bb.max.z).toBeCloseTo(0.1, 3);
    expect(bb.min.z).toBeCloseTo(-0.1, 3);
    expect(geo.getAttribute("normal")).toBeDefined();
  });

  it("flat text is a single face layer; curve segments grow with the size", () => {
    const flat = textGeometry(font("sans-bold"), { text: "O", size: 1, depth: 0 }, utils);
    expect(flat.boundingBox!.max.z - flat.boundingBox!.min.z).toBe(0);
    expect(textMetrics(font("sans-bold"), { text: "O", size: 3 }).curveSegments).toBeGreaterThan(textMetrics(font("sans-bold"), { text: "O", size: 0.3 }).curveSegments);
  });

  it("splitLetters builds one child per non-space glyph, ids <id>/<n>, with outline layers", async () => {
    const def: TextObjectDef = { id: "title", kind: "text", text: "Hi yo", font: "sans-bold", splitLetters: true, outline: { width: 0.05, color: "#000000" } };
    const res = await buildText(def, fakeCtx());
    expect(res.letters.map((l) => l.id)).toEqual(["title/0", "title/1", "title/2", "title/3"]);
    expect(res.object.children.length).toBe(4);
    const first = res.letters[0].object as THREE.Mesh;
    expect(first.children[0].name).toBe("title/0/outline");
    // Letters are centred on their own pivot: geometry box centred on x.
    first.geometry.computeBoundingBox();
    const bb = first.geometry.boundingBox!;
    expect(Math.abs(bb.min.x + bb.max.x)).toBeLessThan(1e-6);
    // The outline is wider than the letter and sits behind its face.
    const ob = new THREE.Box3().setFromBufferAttribute((first.children[0] as THREE.Mesh).geometry.getAttribute("position") as THREE.BufferAttribute);
    expect(ob.max.x - ob.min.x).toBeGreaterThan(bb.max.x - bb.min.x + 0.05);
    expect(ob.max.z).toBeLessThan(bb.max.z);
  });

  it("single-mesh mode keeps one mesh (+ an outline child)", async () => {
    const res = await buildText({ id: "t", kind: "text", text: "AB", outline: true }, fakeCtx());
    expect(res.letters).toEqual([]);
    expect((res.object as THREE.Mesh).isMesh).toBe(true);
    expect(res.object.children.length).toBe(1);
  });
});

describe("reveal", () => {
  it("staggers delays in the requested order", () => {
    expect([0, 1, 2].map((i) => revealDelay({ stagger: 0.1 }, i, 3))).toEqual([0, 0.1, 0.2]);
    expect([0, 1, 2].map((i) => revealDelay({ stagger: 0.1, order: "reverse", delay: 1 }, i, 3)).map((x) => +x.toFixed(6))).toEqual([1.2, 1.1, 1]);
    expect(revealDelay({ stagger: 0.1, order: "center" }, 1, 3)).toBe(0);
    const rnd = [0, 1, 2, 3].map((i) => revealDelay({ order: "random" }, i, 4));
    expect(rnd).toEqual([0, 1, 2, 3].map((i) => revealDelay({ order: "random" }, i, 4)));
  });

  it("is a pure function of time: hidden at 0, at rest when done", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const inst = revealImpl({ effect: "rise", duration: 0.5 }, 1)({ type: "appear" }, { object: mesh } as never);
    inst.update(0, 0);
    expect(mesh.visible).toBe(false);
    expect(mesh.position.y).toBeLessThan(0);
    mesh.position.set(0, 0, 0);
    mesh.visible = true;
    inst.update(10, 0);
    expect(mesh.position.y).toBeCloseTo(0, 9);
    expect((mesh.material as THREE.Material).opacity).toBe(1);
    expect((mesh.material as THREE.Material).transparent).toBe(false);
  });
});

describe("outline offset polygon", () => {
  it("round-joins sharp convex corners instead of spiking (any width)", async () => {
    const { offsetRing } = await import("./text");
    // A very sharp CCW triangle (tip at (10, 0.5)).
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0.5 }, { x: 0, y: 1 }];
    const w = 0.4;
    const out = offsetRing(ring, w);
    for (const p of out) {
      const d = Math.min(...ring.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
      // Every offset point stays within the miter limit (2 × width) of the
      // ring — a raw miter at the tip would be ~ w / sin(2.9°) ≈ 8 units away.
      expect(d).toBeLessThanOrEqual(2 * w + 1e-6);
    }
    // The tip is rounded: several points, all exactly `w` from it.
    const tipPts = out.filter((p) => Math.abs(Math.hypot(p.x - 10, p.y - 0.5) - w) < 1e-6);
    expect(tipPts.length).toBeGreaterThan(3);
  });
  it("grows outer contours and shrinks holes", async () => {
    const THREE = await import("three");
    const { offsetShapes } = await import("./text");
    const sq = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(4, 0), new THREE.Vector2(4, 4), new THREE.Vector2(0, 4)]);
    sq.holes.push(new THREE.Path([new THREE.Vector2(1, 1), new THREE.Vector2(1, 3), new THREE.Vector2(3, 3), new THREE.Vector2(3, 1)]));
    const [o] = offsetShapes([sq], 0.2);
    const { shape, holes } = o.extractPoints(1);
    const xs = shape.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-0.2);
    expect(Math.max(...xs)).toBeCloseTo(4.2);
    expect(holes).toHaveLength(1);
    expect(Math.min(...holes[0].map((p) => p.x))).toBeCloseTo(1.2);
    // A hole narrower than twice the width disappears.
    expect(offsetShapes([sq], 1.2)[0].holes).toHaveLength(0);
  });
});
