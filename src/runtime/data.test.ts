import { describe, expect, it } from "vitest";
import type { SceneDoc } from "../core/types";
import { defaultScene } from "../core/validate";
import { bindSceneData, datasetToData, hasDataPlaceholders, substituteData } from "./data";

const scene = (): SceneDoc =>
  ({
    ...defaultScene({ id: "t", title: "{data.title|Sale}" }),
    data: { title: "Hello", price: 9, nested: { a: "deep" } },
    objects: [
      { id: "g", kind: "group", children: [{ id: "t1", kind: "text", text: "{data.title} — {data.price} €", href: "https://x.test/?p={data.price}" }] },
      { id: "t2", kind: "text", text: "plain" },
    ],
    ui: { elements: [{ id: "u", type: "text", text: "{data.nested.a} {score}" }] },
  }) as SceneDoc;

describe("data bindings", () => {
  it("substitutes placeholders with fallbacks", () => {
    expect(substituteData("{data.a}", { a: "x" })).toBe("x");
    expect(substituteData("{data.a|dflt}", {})).toBe("dflt");
    expect(substituteData("{data.a}", {})).toBe("");
    expect(substituteData("{data.a.b} {data.c}", { a: { b: 1 }, c: 0 })).toBe("1 0");
    expect(substituteData("{score} {state.x}", {})).toBe("{score} {state.x}");
    expect(hasDataPlaceholders("{data.x}")).toBe(true);
    expect(hasDataPlaceholders("{x}")).toBe(false);
  });
  it("binds text, href, title and ui text without mutating the source", () => {
    const s = scene();
    const b = bindSceneData(s);
    const t1 = (b.objects[0].children![0]) as { text: string; href: string };
    expect(t1.text).toBe("Hello — 9 €");
    expect(t1.href).toBe("https://x.test/?p=9");
    expect(b.title).toBe("Hello");
    expect(bindSceneData(s, {}).title).toBe("Sale");
    expect((b.ui!.elements[0] as { text: string }).text).toBe("deep {score}");
    expect(b.objects[1]).toBe(s.objects[1]);
    expect((s.objects[0].children![0] as { text: string }).text).toBe("{data.title} — {data.price} €");
  });
  it("returns the same scene when nothing is bound", () => {
    const s = defaultScene({ id: "x", title: "x" });
    expect(bindSceneData(s)).toBe(s);
  });
  it("maps data-* attributes (camelCase) and data-json", () => {
    expect(datasetToData({ title: "A", ctaLabel: "Go", json: '{"price": 3}' })).toEqual({ title: "A", ctaLabel: "Go", price: 3 });
    expect(datasetToData({ json: "{nope" })).toEqual({});
  });
});
