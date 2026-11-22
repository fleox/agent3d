import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONTS } from "../../core/catalog";
import { glyphPath, textPath, type Typeface } from "./typeface";

describe("typeface preview paths", () => {
  it("converts m / l / q / b with flipped y (end point first in q and b)", () => {
    expect(glyphPath("m 0 0 l 10 0 q 20 10 15 5 b 30 0 22 4 26 2", 100)).toBe("M100 0L110 0Q115 -5 120 -10C122 -4 126 -2 130 0");
  });
  it("renders every bundled font name", () => {
    for (const f of FONTS) {
      const font = JSON.parse(readFileSync(join(__dirname, "../../../library/fonts", `${f.id}.typeface.json`), "utf8")) as Typeface;
      const p = textPath(font, "Agent 3D", 0.02);
      expect(p.d.length, f.id).toBeGreaterThan(50);
      expect(p.width, f.id).toBeGreaterThan(0);
      expect(p.d, f.id).not.toMatch(/NaN/);
    }
  });
});
