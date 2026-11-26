import { describe, expect, it } from "vitest";
import { scrollRect } from "./scrollTarget";
import { scrollProgressFor } from "./timeline/scroll";

// Minimal DOM stand-ins: parentElement chain, computed position, rects.
function box(top: number, height: number, position = "static", parent: FakeEl | null = null): FakeEl {
  return { parentElement: parent, position, isConnected: true, top, height, getBoundingClientRect() { return { top: this.top, height: this.height }; } } as FakeEl;
}
interface FakeEl { parentElement: FakeEl | null; position: string; isConnected: boolean; top: number; height: number; ownerDocument: unknown; getBoundingClientRect(): { top: number; height: number } }
function wire(...els: FakeEl[]) {
  const body = {};
  const doc = { body, defaultView: { getComputedStyle: (n: FakeEl) => ({ position: n.position }) } };
  for (const e of els) e.ownerDocument = doc;
}

describe("scrollRect", () => {
  it("uses the element itself when nothing is sticky", () => {
    const el = box(120, 400);
    wire(el);
    expect(scrollRect(el as unknown as Element)).toEqual({ top: 120, height: 400 });
  });

  it("follows the pin section of a sticky ancestor, minus the pinned height", () => {
    const section = box(-500, 3000);
    const sticky = box(0, 600, "sticky", section);
    const el = box(0, 600, "static", sticky);
    wire(section, sticky, el);
    const r = scrollRect(el as unknown as Element);
    expect(r).toEqual({ top: -500, height: 2400 });
    // "top top" → "bottom top": 0 when the pin starts, 1 when it ends.
    expect(scrollProgressFor(r.top, r.height, 900, "top top", "bottom top")).toBeCloseTo(500 / 2400, 6);
    section.top = -2400;
    const end = scrollRect(el as unknown as Element);
    expect(scrollProgressFor(end.top, end.height, 900, "top top", "bottom top")).toBe(1);
  });
});
