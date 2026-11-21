import { describe, expect, it } from "vitest";
import { createResolver } from "./assets";

describe("resolveAsset", () => {
  const r = createResolver({ assetBase: "https://x.test/banner/", libraryBase: "https://x.test/lib/", assetUrls: { "assets/logo.svg": "data:image/svg+xml,abc" } });
  it("prefers pre-resolved assetUrls", () => expect(r("assets/logo.svg")).toBe("data:image/svg+xml,abc"));
  it("resolves project paths against assetBase", () => {
    expect(r("assets/fox.glb")).toBe("https://x.test/banner/assets/fox.glb");
    expect(r("./assets/fox.glb")).toBe("https://x.test/banner/assets/fox.glb");
  });
  it("maps library ids (fonts get the typeface extension)", () => {
    expect(r("library:models/fox.glb")).toBe("https://x.test/lib/models/fox.glb");
    expect(r("library:fonts/sans-bold")).toBe("https://x.test/lib/fonts/sans-bold.typeface.json");
  });
  it("keeps absolute URLs", () => {
    expect(r("https://cdn.test/a.png")).toBe("https://cdn.test/a.png");
    expect(r("/abs/a.png")).toBe("/abs/a.png");
  });
  it("defaults the library under the asset base", () => {
    expect(createResolver({ assetBase: "./p" })("library:textures/a.jpg")).toBe("./p/assets/library/textures/a.jpg");
  });
});
